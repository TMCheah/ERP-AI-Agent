import { q } from "../db.js";
import { createApproval } from "./approvals.js";
import { tool } from "./types.js";
import { cascadeFromWorkOrder } from "../approval-executor.js";

export const manufacturingTools = [
  tool({
    name: "create_bom",
    description:
      "Create or update a Bill of Materials for a product. Master data — immediate.",
    parameters: {
      type: "object",
      properties: {
        product_sku: { type: "string" },
        version: { type: "string" },
        name: { type: "string" },
        components: {
          type: "array",
          items: {
            type: "object",
            properties: { sku: { type: "string" }, quantity: { type: "number" } },
            required: ["sku", "quantity"],
          },
        },
      },
      required: ["product_sku", "name", "components"],
    },
    async handler(args, ctx) {
      const product = (await q<any>(
        `SELECT id FROM items WHERE tenant_id=$1 AND sku=$2`,
        [ctx.tenantId, args.product_sku],
      ))[0];
      if (!product) return { error: `Product SKU ${args.product_sku} not found.` };

      const version = args.version ?? "v1";
      const bom = (await q<any>(
        `INSERT INTO boms (tenant_id, product_id, version, name) VALUES ($1,$2,$3,$4)
         ON CONFLICT (tenant_id, product_id, version) DO UPDATE SET name=EXCLUDED.name
         RETURNING id, name, version`,
        [ctx.tenantId, product.id, version, args.name],
      ))[0];

      await q(`DELETE FROM bom_lines WHERE bom_id=$1`, [bom.id]);
      for (const c of args.components) {
        const item = (await q<any>(
          `SELECT id, unit FROM items WHERE tenant_id=$1 AND sku=$2`,
          [ctx.tenantId, c.sku],
        ))[0];
        if (!item) return { error: `Component SKU ${c.sku} not found.` };
        await q(
          `INSERT INTO bom_lines (bom_id, component_id, quantity, unit) VALUES ($1,$2,$3,$4)`,
          [bom.id, item.id, c.quantity, item.unit],
        );
      }
      return { status: "CREATED", bom };
    },
  }),

  tool({
    name: "list_boms",
    description: "List Bills of Materials.",
    parameters: { type: "object", properties: { limit: { type: "integer" } }, required: [] },
    async handler(args, ctx) {
      const rows = await q(
        `SELECT b.id, b.name, b.version, i.sku AS product_sku, i.name AS product_name,
                (SELECT COUNT(*) FROM bom_lines l WHERE l.bom_id = b.id) AS components
           FROM boms b JOIN items i ON i.id = b.product_id
          WHERE b.tenant_id=$1 ORDER BY b.id DESC LIMIT $2`,
        [ctx.tenantId, Math.min(args.limit ?? 25, 100)],
      );
      return { count: rows.length, boms: rows };
    },
  }),

  tool({
    name: "get_bom_details",
    description: "Get a BOM's components in detail by product SKU.",
    parameters: {
      type: "object",
      properties: { product_sku: { type: "string" } },
      required: ["product_sku"],
    },
    async handler(args, ctx) {
      const bom = (await q<any>(
        `SELECT b.id, b.name, b.version, i.sku AS product_sku, i.name AS product_name
           FROM boms b JOIN items i ON i.id = b.product_id
          WHERE b.tenant_id=$1 AND i.sku=$2
          ORDER BY b.id DESC LIMIT 1`,
        [ctx.tenantId, args.product_sku],
      ))[0];
      if (!bom) return { error: `No BOM found for ${args.product_sku}.` };
      const lines = await q(
        `SELECT i.sku, i.name AS component_name, l.quantity, l.unit
           FROM bom_lines l JOIN items i ON i.id = l.component_id
          WHERE l.bom_id=$1 ORDER BY l.id`,
        [bom.id],
      );
      delete bom.id;
      return { bom, components: lines };
    },
  }),

  tool({
    name: "delete_bom",
    description: "Delete a BOM by product SKU and version.",
    parameters: {
      type: "object",
      properties: {
        product_sku: { type: "string" },
        version: { type: "string" },
      },
      required: ["product_sku"],
    },
    async handler(args, ctx) {
      const version = args.version ?? "v1";
      const rows = await q<any>(
        `DELETE FROM boms b USING items i
          WHERE b.product_id = i.id AND b.tenant_id=$1 AND i.sku=$2 AND b.version=$3
          RETURNING b.id, b.name`,
        [ctx.tenantId, args.product_sku, version],
      );
      if (!rows.length) return { error: `BOM for ${args.product_sku} ${version} not found.` };
      return { status: "DELETED", bom: rows[0] };
    },
  }),

  tool({
    name: "create_work_order",
    description: "Create a work order to produce a product. Gated: queued for approval.",
    parameters: {
      type: "object",
      properties: {
        product_sku: { type: "string" },
        quantity: { type: "number" },
        planned_start: { type: "string" },
        planned_end: { type: "string" },
      },
      required: ["product_sku", "quantity"],
    },
    async handler(args, ctx) {
      const approval = await createApproval(
        ctx,
        "work_order",
        `Work order: ${args.quantity} x ${args.product_sku}`,
        args,
      );
      return {
        status: "PENDING_APPROVAL",
        approval_id: approval?.id,
        message: `Work order queued (approval #${approval?.id}).`,
      };
    },
  }),

  tool({
    name: "list_work_orders",
    description: "List work orders.",
    parameters: {
      type: "object",
      properties: { status: { type: "string" }, limit: { type: "integer" } },
      required: [],
    },
    async handler(args, ctx) {
      const rows = await q(
        `SELECT id, reference, quantity, status, planned_start, planned_end, created_at
           FROM work_orders
          WHERE tenant_id=$1 AND ($2::text IS NULL OR status=$2)
          ORDER BY created_at DESC LIMIT $3`,
        [ctx.tenantId, args.status ?? null, Math.min(args.limit ?? 25, 100)],
      );
      return { count: rows.length, work_orders: rows };
    },
  }),

  tool({
    name: "complete_work_order",
    description:
      "Complete a work order. Adds the produced quantity to stock at the given warehouse, deducts component quantities per BOM (if any), and records movements. Immediate.",
    parameters: {
      type: "object",
      properties: {
        reference: { type: "string" },
        warehouse_code: { type: "string" },
      },
      required: ["reference", "warehouse_code"],
    },
    async handler(args, ctx) {
      const wo = (await q<any>(
        `SELECT id, bom_id, quantity, status FROM work_orders WHERE tenant_id=$1 AND reference=$2`,
        [ctx.tenantId, args.reference],
      ))[0];
      if (!wo) return { error: `Work order ${args.reference} not found.` };
      if (wo.status === "COMPLETED") return { error: "Work order already completed." };

      const wh = (await q<any>(
        `SELECT id FROM warehouses WHERE tenant_id=$1 AND code=$2`,
        [ctx.tenantId, args.warehouse_code],
      ))[0];
      if (!wh) return { error: `Warehouse ${args.warehouse_code} not found.` };

      // Produce the finished good
      const bom = wo.bom_id
        ? (await q<any>(`SELECT product_id FROM boms WHERE id=$1`, [wo.bom_id]))[0]
        : null;

      if (bom?.product_id) {
        await q(
          `INSERT INTO stock (tenant_id, item_id, warehouse_id, quantity)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (item_id, warehouse_id)
           DO UPDATE SET quantity = stock.quantity + EXCLUDED.quantity`,
          [ctx.tenantId, bom.product_id, wh.id, wo.quantity],
        );
        await q(
          `INSERT INTO stock_movements (tenant_id, item_id, to_warehouse_id, quantity, reason, reference, moved_by)
           VALUES ($1,$2,$3,$4,'WO_COMPLETE',$5,$6)`,
          [ctx.tenantId, bom.product_id, wh.id, wo.quantity, args.reference, ctx.userId],
        );

        // Consume components
        const comps = await q<any>(
          `SELECT component_id, quantity FROM bom_lines WHERE bom_id=$1`,
          [wo.bom_id],
        );
        for (const c of comps) {
          const used = Number(c.quantity) * Number(wo.quantity);
          await q(
            `UPDATE stock SET quantity = quantity - $3
              WHERE tenant_id=$1 AND item_id=$2 AND warehouse_id=$4 AND quantity >= $3`,
            [ctx.tenantId, c.component_id, used, wh.id],
          );
          await q(
            `INSERT INTO stock_movements (tenant_id, item_id, from_warehouse_id, quantity, reason, reference, moved_by)
             VALUES ($1,$2,$3,$4,'WO_CONSUME',$5,$6)`,
            [ctx.tenantId, c.component_id, wh.id, used, args.reference, ctx.userId],
          );
        }
      }

      await q(`UPDATE work_orders SET status='COMPLETED' WHERE id=$1`, [wo.id]);
      await q(
        `INSERT INTO audit_log (tenant_id, user_id, action, detail) VALUES ($1,$2,'wo.completed',$3)`,
        [ctx.tenantId, ctx.userId, { reference: args.reference, warehouse: args.warehouse_code }],
      );

      // ---------- Cascade: DRAFT production JE ----------
      let producedValue = 0;
      if (bom?.product_id) {
        // value = sum(component_qty × wo_qty × component.cost_price)
        const comps = await q<any>(
          `SELECT bl.quantity, i.cost_price
             FROM bom_lines bl JOIN items i ON i.id = bl.component_id
            WHERE bl.bom_id = $1`,
          [wo.bom_id],
        );
        for (const c of comps) {
          producedValue +=
            Number(c.quantity) * Number(wo.quantity) * Number(c.cost_price ?? 0);
        }
      }
      let cascade: any = { je_reference: null };
      try {
        cascade = await cascadeFromWorkOrder(ctx, {
          tenantId: ctx.tenantId,
          woReference: args.reference,
          producedValue,
          requestedBy: ctx.userId,
        });
      } catch (err) {
        console.error("[wo] cascade failed:", err);
      }

      return {
        status: "COMPLETED",
        reference: args.reference,
        warehouse: args.warehouse_code,
        produced: wo.quantity,
        cascade,
      };
    },
  }),
];