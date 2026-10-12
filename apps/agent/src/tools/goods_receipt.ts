import { q } from "../db.js";
import { createApproval } from "./approvals.js";
import { tool } from "./types.js";
import { ref } from "./helpers.js";

export const goodsReceiptTools = [
  tool({
    name: "receive_purchase_order",
    description:
      "Receive a purchase order partially or in full. Creates a GRN (goods receipt note) document. Pass lines with received_qty per SKU; any SKU not listed receives nothing. Adds stock at the warehouse, increments line.received_qty, records stock movements linked to the GRN, and updates PO status to PARTIALLY_RECEIVED or RECEIVED.",
    parameters: {
      type: "object",
      properties: {
        reference: { type: "string", description: "PO reference, e.g. PO-12345678." },
        warehouse_code: { type: "string" },
        lines: {
          type: "array",
          items: {
            type: "object",
            properties: {
              sku: { type: "string" },
              received_qty: { type: "number" },
            },
            required: ["sku", "received_qty"],
          },
          description: "Optional. Omit to receive all outstanding quantities.",
        },
        notes: { type: "string" },
      },
      required: ["reference", "warehouse_code"],
    },
    async handler(args, ctx) {
      const po = (await q<any>(
        `SELECT id, status FROM purchase_orders WHERE tenant_id=$1 AND reference=$2`,
        [ctx.tenantId, args.reference],
      ))[0];
      if (!po) return { error: `PO ${args.reference} not found.` };
      if (po.status === "RECEIVED") return { error: `PO ${args.reference} already fully received.` };
      if (po.status === "CANCELLED") return { error: `PO ${args.reference} is cancelled.` };

      const wh = (await q<any>(
        `SELECT id, code FROM warehouses WHERE tenant_id=$1 AND code=$2`,
        [ctx.tenantId, args.warehouse_code],
      ))[0];
      if (!wh) return { error: `Warehouse ${args.warehouse_code} not found.` };

      const allLines = await q<any>(
        `SELECT l.id, l.item_id, l.quantity, l.received_qty, i.sku
           FROM purchase_order_lines l JOIN items i ON i.id = l.item_id
          WHERE l.po_id = $1 ORDER BY l.id`,
        [po.id],
      );
      if (!allLines.length) return { error: `PO ${args.reference} has no lines.` };

      const requested = new Map<string, number>();
      if (args.lines?.length) {
        for (const l of args.lines) requested.set(l.sku, Number(l.received_qty));
      }

      // Build plan first, then commit atomically
      const plan: { line: any; qty: number }[] = [];
      for (const line of allLines) {
        const remaining = Number(line.quantity) - Number(line.received_qty);
        if (remaining <= 0) continue;
        const toReceive = args.lines?.length ? (requested.get(line.sku) ?? 0) : remaining;
        if (toReceive <= 0) continue;
        if (toReceive > remaining) {
          return {
            error: `SKU ${line.sku}: cannot receive ${toReceive} — only ${remaining} outstanding on PO.`,
          };
        }
        plan.push({ line, qty: toReceive });
      }
      if (!plan.length) return { error: "Nothing to receive — all lines are already complete." };

      // Create GRN header
      const grnRef = ref("GRN", 6);
      const grn = (await q<any>(
        `INSERT INTO goods_receipts (tenant_id, reference, po_id, warehouse_id, received_by, notes)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, reference`,
        [ctx.tenantId, grnRef, po.id, wh.id, ctx.userId, args.notes ?? null],
      ))[0];

      const events: any[] = [];
      let totalReceived = 0;

      for (const p of plan) {
        // GRN line
        await q(
          `INSERT INTO goods_receipt_lines (grn_id, po_line_id, item_id, quantity)
           VALUES ($1,$2,$3,$4)`,
          [grn.id, p.line.id, p.line.item_id, p.qty],
        );
        // Stock
        await q(
          `INSERT INTO stock (tenant_id, item_id, warehouse_id, quantity)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (item_id, warehouse_id)
           DO UPDATE SET quantity = stock.quantity + EXCLUDED.quantity`,
          [ctx.tenantId, p.line.item_id, wh.id, p.qty],
        );
        // Movement (linked to GRN)
        await q(
          `INSERT INTO stock_movements (tenant_id, item_id, to_warehouse_id, quantity, reason, reference, moved_by, grn_id)
           VALUES ($1,$2,$3,$4,'PO_RECEIPT',$5,$6,$7)`,
          [ctx.tenantId, p.line.item_id, wh.id, p.qty, args.reference, ctx.userId, grn.id],
        );
        // Line progress
        await q(
          `UPDATE purchase_order_lines SET received_qty = received_qty + $2 WHERE id=$1`,
          [p.line.id, p.qty],
        );
        totalReceived += p.qty;
        events.push({
          sku: p.line.sku,
          received_now: p.qty,
          remaining_after: Number(p.line.quantity) - Number(p.line.received_qty) - p.qty,
        });
      }

      // Recompute PO status
      const stillOpen = (await q<any>(
        `SELECT COUNT(*) AS n FROM purchase_order_lines
          WHERE po_id=$1 AND received_qty < quantity`,
        [po.id],
      ))[0];
      const newStatus = Number(stillOpen.n) > 0 ? "PARTIALLY_RECEIVED" : "RECEIVED";
      await q(`UPDATE purchase_orders SET status=$2 WHERE id=$1`, [po.id, newStatus]);

      await q(
        `INSERT INTO audit_log (tenant_id, user_id, action, detail) VALUES ($1,$2,'grn.created',$3)`,
        [ctx.tenantId, ctx.userId, { grn: grnRef, po: args.reference, warehouse: args.warehouse_code, lines: events }],
      );

      return {
        status: "CREATED",
        grn_reference: grnRef,
        po_reference: args.reference,
        warehouse: args.warehouse_code,
        po_status: newStatus,
        lines: events,
        message: `GRN ${grnRef} created. PO ${args.reference} is now ${newStatus}.`,
      };
    },
  }),

  tool({
    name: "list_goods_receipts",
    description: "List goods receipt notes (GRNs). Optionally filter by PO reference or warehouse.",
    parameters: {
      type: "object",
      properties: {
        po_reference: { type: "string" },
        warehouse_code: { type: "string" },
        limit: { type: "integer" },
      },
      required: [],
    },
    async handler(args, ctx) {
      const params: any[] = [ctx.tenantId];
      const filters: string[] = [];
      if (args.po_reference) { params.push(args.po_reference); filters.push(`po.reference = $${params.length}`); }
      if (args.warehouse_code) { params.push(args.warehouse_code); filters.push(`w.code = $${params.length}`); }
      params.push(Math.min(args.limit ?? 25, 100));
      const where = filters.length ? `AND ${filters.join(" AND ")}` : "";

      const rows = await q(
        `SELECT g.reference, po.reference AS po_reference, w.code AS warehouse,
                u.full_name AS received_by, g.created_at,
                (SELECT COUNT(*) FROM goods_receipt_lines l WHERE l.grn_id = g.id) AS line_count
           FROM goods_receipts g
           LEFT JOIN purchase_orders po ON po.id = g.po_id
           LEFT JOIN warehouses w ON w.id = g.warehouse_id
           LEFT JOIN users u ON u.id = g.received_by
          WHERE g.tenant_id=$1 ${where}
          ORDER BY g.created_at DESC LIMIT $${params.length}`,
        params,
      );
      return { count: rows.length, goods_receipts: rows };
    },
  }),

  tool({
    name: "get_goods_receipt",
    description: "Get a GRN's details and its lines by GRN reference.",
    parameters: {
      type: "object",
      properties: { reference: { type: "string" } },
      required: ["reference"],
    },
    async handler(args, ctx) {
      const grn = (await q<any>(
        `SELECT g.id, g.reference, g.notes, g.created_at,
                po.reference AS po_reference, w.code AS warehouse,
                u.full_name AS received_by
           FROM goods_receipts g
           LEFT JOIN purchase_orders po ON po.id = g.po_id
           LEFT JOIN warehouses w ON w.id = g.warehouse_id
           LEFT JOIN users u ON u.id = g.received_by
          WHERE g.tenant_id=$1 AND g.reference=$2`,
        [ctx.tenantId, args.reference],
      ))[0];
      if (!grn) return { error: `GRN ${args.reference} not found.` };

      const lines = await q(
        `SELECT i.sku, i.name AS item_name, grl.quantity
           FROM goods_receipt_lines grl JOIN items i ON i.id = grl.item_id
          WHERE grl.grn_id = $1 ORDER BY grl.id`,
        [grn.id],
      );
      delete grn.id;
      return { goods_receipt: grn, lines };
    },
  }),

  tool({
    name: "create_goods_return",
    description:
      "Return received goods to a vendor. Gated: queued for approval. Requires the GRN reference and SKUs + quantities to return. Deducts stock and creates a return document on approval.",
    parameters: {
      type: "object",
      properties: {
        grn_reference: { type: "string" },
        lines: {
          type: "array",
          items: {
            type: "object",
            properties: {
              sku: { type: "string" },
              quantity: { type: "number" },
            },
            required: ["sku", "quantity"],
          },
        },
        reason: { type: "string" },
      },
      required: ["grn_reference", "lines"],
    },
    async handler(args, ctx) {
      const grn = (await q<any>(
        `SELECT id, reference, po_id, warehouse_id FROM goods_receipts
          WHERE tenant_id=$1 AND reference=$2`,
        [ctx.tenantId, args.grn_reference],
      ))[0];
      if (!grn) return { error: `GRN ${args.grn_reference} not found.` };

      // Validate each requested SKU exists on the GRN with enough quantity
      for (const l of args.lines) {
        const row = (await q<any>(
          `SELECT grl.quantity FROM goods_receipt_lines grl
             JOIN items i ON i.id = grl.item_id
            WHERE grl.grn_id=$1 AND i.sku=$2`,
          [grn.id, l.sku],
        ))[0];
        if (!row) return { error: `SKU ${l.sku} is not on GRN ${args.grn_reference}.` };
        if (Number(l.quantity) <= 0) return { error: `SKU ${l.sku}: quantity must be positive.` };
        if (Number(l.quantity) > Number(row.quantity)) {
          return { error: `SKU ${l.sku}: cannot return ${l.quantity} — GRN received only ${row.quantity}.` };
        }
      }

      const approval = await createApproval(
        ctx,
        "goods_return",
        `Return from ${args.grn_reference}: ${args.lines.length} line(s)`,
        {
          grn_id: grn.id,
          grn_reference: grn.reference,
          po_id: grn.po_id,
          warehouse_id: grn.warehouse_id,
          lines: args.lines,
          reason: args.reason ?? null,
        },
      );

      return {
        status: "PENDING_APPROVAL",
        approval_id: approval?.id,
        message: `Goods return queued (approval #${approval?.id}).`,
      };
    },
  }),

  tool({
    name: "list_goods_returns",
    description: "List goods returns to vendors.",
    parameters: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["PENDING", "APPROVED", "REJECTED"] },
        limit: { type: "integer" },
      },
      required: [],
    },
    async handler(args, ctx) {
      const rows = await q(
        `SELECT r.reference, g.reference AS grn_reference, v.name AS vendor,
                r.reason, r.status, r.created_at
           FROM goods_returns r
           LEFT JOIN goods_receipts g ON g.id = r.grn_id
           LEFT JOIN vendors v ON v.id = r.vendor_id
          WHERE r.tenant_id=$1 AND ($2::text IS NULL OR r.status=$2)
          ORDER BY r.created_at DESC LIMIT $3`,
        [ctx.tenantId, args.status ?? null, Math.min(args.limit ?? 25, 100)],
      );
      return { count: rows.length, goods_returns: rows };
    },
  }),
];