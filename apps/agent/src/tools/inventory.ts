import { one, q } from "../db.js";
import { createApproval } from "./approvals.js";
import { tool } from "./types.js";

export const inventoryTools = [
  tool({
    name: "query_inventory",
    description:
      "Search inventory. Use for ANY question about stock levels, products, SKUs, prices, or warehouse contents. Excludes deactivated items.",
    parameters: {
      type: "object",
      properties: {
        search: { type: "string" },
        category: { type: "string" },
        warehouse_code: { type: "string" },
        min_price: { type: "number" },
        max_price: { type: "number" },
        min_quantity: { type: "number" },
        max_quantity: { type: "number" },
        limit: { type: "integer" },
      },
      required: [],
    },
    async handler(args, ctx) {
      const limit = Math.min(args.limit ?? 25, 200);
      const where: string[] = ["i.tenant_id = $1", "i.deleted_at IS NULL"];
      const params: any[] = [ctx.tenantId];

      if (args.search) {
        params.push(`%${args.search}%`);
        where.push(`(i.name ILIKE $${params.length} OR i.sku ILIKE $${params.length})`);
      }
      if (args.category) { params.push(args.category); where.push(`i.category = $${params.length}`); }
      if (args.min_price != null) { params.push(args.min_price); where.push(`i.selling_price >= $${params.length}`); }
      if (args.max_price != null) { params.push(args.max_price); where.push(`i.selling_price <= $${params.length}`); }

      let whParamIdx: number | null = null;
      if (args.warehouse_code) { params.push(args.warehouse_code); whParamIdx = params.length; }

      const having: string[] = [];
      if (args.min_quantity != null) { params.push(args.min_quantity); having.push(`SUM(s.quantity) >= $${params.length}`); }
      if (args.max_quantity != null) { params.push(args.max_quantity); having.push(`SUM(s.quantity) <= $${params.length}`); }
      params.push(limit);

      const sql = `
        SELECT i.sku, i.name, i.category, i.unit,
               i.selling_price, i.cost_price, i.reorder_point,
               COALESCE(SUM(s.quantity),0) AS total_quantity,
               STRING_AGG(DISTINCT w.code || ': ' || s.quantity, ', ') AS by_warehouse
          FROM items i
          LEFT JOIN stock s ON s.item_id = i.id
          LEFT JOIN warehouses w ON w.id = s.warehouse_id
              ${whParamIdx ? `AND w.code = $${whParamIdx}` : ""}
         WHERE ${where.join(" AND ")}
         GROUP BY i.id
         ${having.length ? `HAVING ${having.join(" AND ")}` : ""}
         ORDER BY i.name LIMIT $${params.length}`;
      const rows = await q(sql, params);
      return { count: rows.length, items: rows };
    },
  }),

  tool({
    name: "list_warehouses",
    description: "List all warehouses in the tenant.",
    parameters: { type: "object", properties: {}, required: [] },
    async handler(_args, ctx) {
      const rows = await q(
        `SELECT code, name FROM warehouses WHERE tenant_id=$1 ORDER BY code`,
        [ctx.tenantId],
      );
      return { count: rows.length, warehouses: rows };
    },
  }),

  tool({
    name: "create_warehouse",
    description: "Create a new warehouse. Master data — immediate.",
    parameters: {
      type: "object",
      properties: {
        code: { type: "string", description: "Short code like WH-JB." },
        name: { type: "string" },
      },
      required: ["code", "name"],
    },
    async handler(args, ctx) {
      const dup = await q(`SELECT id FROM warehouses WHERE tenant_id=$1 AND code=$2`, [ctx.tenantId, args.code]);
      if (dup.length) return { error: `Warehouse ${args.code} already exists.` };
      const rows = await q<any>(
        `INSERT INTO warehouses (tenant_id, code, name) VALUES ($1,$2,$3) RETURNING id, code, name`,
        [ctx.tenantId, args.code, args.name],
      );
      return { status: "CREATED", warehouse: rows[0] };
    },
  }),

  tool({
    name: "transfer_stock",
    description:
      "Transfer stock from one warehouse to another. Gated: queued for approval.",
    parameters: {
      type: "object",
      properties: {
        sku: { type: "string" },
        from_warehouse_code: { type: "string" },
        to_warehouse_code: { type: "string" },
        quantity: { type: "number" },
        reason: { type: "string" },
      },
      required: ["sku", "from_warehouse_code", "to_warehouse_code", "quantity"],
    },
    async handler(args, ctx) {
      if (Number(args.quantity) <= 0) return { error: "Quantity must be positive." };
      if (args.from_warehouse_code === args.to_warehouse_code)
        return { error: "Source and destination warehouses are the same." };

      const check = await q<any>(
        `SELECT s.quantity FROM stock s
           JOIN items i ON i.id = s.item_id
           JOIN warehouses w ON w.id = s.warehouse_id
          WHERE i.tenant_id=$1 AND i.sku=$2 AND w.code=$3`,
        [ctx.tenantId, args.sku, args.from_warehouse_code],
      );
      const available = Number(check[0]?.quantity ?? 0);
      if (available < Number(args.quantity)) {
        return {
          error: `Only ${available} units of ${args.sku} at ${args.from_warehouse_code}. Cannot transfer ${args.quantity}.`,
        };
      }

      const approval = await createApproval(
        ctx,
        "stock_transfer",
        `Transfer ${args.quantity} x ${args.sku}: ${args.from_warehouse_code} → ${args.to_warehouse_code}`,
        args,
      );
      return {
        status: "PENDING_APPROVAL",
        approval_id: approval?.id,
        message: `Stock transfer queued (approval #${approval?.id}).`,
      };
    },
  }),

  tool({
    name: "adjust_stock",
    description: "Adjust stock quantity for an item in a warehouse. Gated: queued for approval.",
    parameters: {
      type: "object",
      properties: {
        sku: { type: "string" },
        warehouse_code: { type: "string" },
        delta: { type: "number" },
        reason: { type: "string" },
      },
      required: ["sku", "warehouse_code", "delta"],
    },
    async handler(args, ctx) {
      if (ctx.role === "STAFF") return { error: "Not permitted: only APPROVER or ADMIN can adjust stock." };

      if (Number(args.delta) < 0) {
        const check = await q<any>(
          `SELECT s.quantity FROM stock s
             JOIN items i ON i.id = s.item_id
             JOIN warehouses w ON w.id = s.warehouse_id
            WHERE i.tenant_id=$1 AND i.sku=$2 AND w.code=$3`,
          [ctx.tenantId, args.sku, args.warehouse_code],
        );
        const available = Number(check[0]?.quantity ?? 0);
        if (available + Number(args.delta) < 0) {
          return {
            error: `Adjustment would leave ${available + Number(args.delta)} units. Only ${available} on hand at ${args.warehouse_code}.`,
          };
        }
      }

      const approval = await createApproval(
        ctx,
        "stock_adjustment",
        `Adjust ${args.sku} at ${args.warehouse_code} by ${args.delta > 0 ? "+" : ""}${args.delta}`,
        args,
      );
      return {
        status: "PENDING_APPROVAL",
        approval_id: approval?.id,
        message: `Stock adjustment queued (approval #${approval?.id}).`,
      };
    },
  }),

  tool({
    name: "list_stock_movements",
    description:
      "List recent stock movements (transfers, receipts, adjustments, returns). Optionally filter by SKU.",
    parameters: {
      type: "object",
      properties: {
        sku: { type: "string" },
        limit: { type: "integer" },
      },
      required: [],
    },
    async handler(args, ctx) {
      const rows = await q(
        `SELECT sm.created_at, i.sku, i.name AS item,
                fw.code AS from_wh, tw.code AS to_wh,
                sm.quantity, sm.reason, sm.reference,
                g.reference AS grn_reference,
                r.reference AS return_reference
           FROM stock_movements sm
           JOIN items i ON i.id = sm.item_id
           LEFT JOIN warehouses fw ON fw.id = sm.from_warehouse_id
           LEFT JOIN warehouses tw ON tw.id = sm.to_warehouse_id
           LEFT JOIN goods_receipts g ON g.id = sm.grn_id
           LEFT JOIN goods_returns r ON r.id = sm.return_id
          WHERE sm.tenant_id = $1
            AND ($2::text IS NULL OR i.sku = $2)
          ORDER BY sm.created_at DESC LIMIT $3`,
        [ctx.tenantId, args.sku ?? null, Math.min(args.limit ?? 25, 100)],
      );
      return { count: rows.length, movements: rows };
    },
  }),
];