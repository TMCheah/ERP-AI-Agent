import { q } from "../db.js";
import { createApproval } from "./approvals.js";
import { tool } from "./types.js";

export const inventoryTools = [
  tool({
    name: "query_inventory",
    description:
      "Search the inventory. Use for ANY question about stock levels, products, SKUs, prices, or what is in a warehouse. Supports fuzzy name/SKU search and numeric filters.",
    parameters: {
      type: "object",
      properties: {
        search: { type: "string", description: "Fuzzy match against item name or SKU." },
        category: { type: "string" },
        warehouse_code: { type: "string", description: "e.g. WH-KUL. Omit to aggregate all warehouses." },
        min_price: { type: "number", description: "Minimum selling price." },
        max_price: { type: "number", description: "Maximum selling price." },
        min_quantity: { type: "number", description: "Minimum total quantity on hand." },
        max_quantity: { type: "number" },
        limit: { type: "integer", description: "Max rows, default 25." },
      },
      required: [],
    },
    async handler(args, ctx) {
      const limit = Math.min(args.limit ?? 25, 200);
      const where: string[] = ["i.tenant_id = $1"];
      const params: any[] = [ctx.tenantId];

      if (args.search) {
        params.push(`%${args.search}%`);
        where.push(`(i.name ILIKE $${params.length} OR i.sku ILIKE $${params.length})`);
      }
      if (args.category) {
        params.push(args.category);
        where.push(`i.category = $${params.length}`);
      }
      if (args.min_price != null) {
        params.push(args.min_price);
        where.push(`i.selling_price >= $${params.length}`);
      }
      if (args.max_price != null) {
        params.push(args.max_price);
        where.push(`i.selling_price <= $${params.length}`);
      }

      const whJoinFilter = args.warehouse_code ? `AND w.code = $WH` : "";
      let whParamIdx = null as number | null;
      if (args.warehouse_code) {
        params.push(args.warehouse_code);
        whParamIdx = params.length;
      }

      const having: string[] = [];
      if (args.min_quantity != null) {
        params.push(args.min_quantity);
        having.push(`SUM(s.quantity) >= $${params.length}`);
      }
      if (args.max_quantity != null) {
        params.push(args.max_quantity);
        having.push(`SUM(s.quantity) <= $${params.length}`);
      }

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
         ORDER BY i.name
         LIMIT $${params.length}`;

      const rows = await q(sql, params);
      return { count: rows.length, items: rows };
    },
  }),

  tool({
    name: "adjust_stock",
    description:
      "Adjust stock quantity for an item in a warehouse. This creates an approval request; it does NOT change stock immediately.",
    parameters: {
      type: "object",
      properties: {
        sku: { type: "string" },
        warehouse_code: { type: "string" },
        delta: { type: "number", description: "Positive to add, negative to remove." },
        reason: { type: "string" },
      },
      required: ["sku", "warehouse_code", "delta"],
    },
    async handler(args, ctx) {
      if (ctx.role === "STAFF") {
        return { error: "Not permitted: only APPROVER or ADMIN can adjust stock." };
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
        message: `Stock adjustment queued for approval (approval #${approval?.id}).`,
      };
    },
  }),
];