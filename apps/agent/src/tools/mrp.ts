import { q } from "../db.js";
import { tool } from "./types.js";

export const mrpTools = [
  tool({
    name: "calculate_mrp",
    description:
      "Material Requirements Planning. Given a product SKU and quantity, walks the BOM and computes what components are needed vs. what's in stock, showing shortfalls. Use for 'do I have enough to produce X'.",
    parameters: {
      type: "object",
      properties: {
        product_sku: { type: "string" },
        quantity: { type: "number" },
        warehouse_code: { type: "string", description: "Optional. If omitted, checks total stock." },
      },
      required: ["product_sku", "quantity"],
    },
    async handler(args, ctx) {
      const bom = (await q<any>(
        `SELECT b.id, b.name FROM boms b JOIN items i ON i.id = b.product_id
          WHERE b.tenant_id=$1 AND i.sku=$2 ORDER BY b.id DESC LIMIT 1`,
        [ctx.tenantId, args.product_sku],
      ))[0];
      if (!bom) return { error: `No BOM found for ${args.product_sku}.` };

      const whFilter = args.warehouse_code ? `AND w.code = $2` : ``;
      const params: any[] = [bom.id];
      if (args.warehouse_code) params.push(args.warehouse_code);

      const lines = await q<any>(
        `SELECT i.sku, i.name AS component_name,
                l.quantity AS per_unit,
                l.quantity * $3::numeric AS required,
                COALESCE(SUM(s.quantity),0) AS on_hand
           FROM bom_lines l
           JOIN items i ON i.id = l.component_id
           LEFT JOIN stock s ON s.item_id = i.id
           LEFT JOIN warehouses w ON w.id = s.warehouse_id ${whFilter}
          WHERE l.bom_id = $1
          GROUP BY i.id, i.sku, i.name, l.quantity
          ORDER BY i.sku`,
        [...params, args.quantity],
      );

      const report = lines.map((l: any) => ({
        sku: l.sku,
        name: l.component_name,
        per_unit: Number(l.per_unit),
        required: Number(l.required),
        on_hand: Number(l.on_hand),
        shortfall: Math.max(Number(l.required) - Number(l.on_hand), 0),
      }));

      const canBuild = report.every((r) => r.shortfall === 0);
      const bottleneck = report.reduce(
        (min: any, r) => (r.shortfall > (min?.shortfall ?? 0) ? r : min),
        null,
      );

      return {
        report: "mrp",
        bom: bom.name,
        product: args.product_sku,
        quantity_requested: args.quantity,
        can_build_full_quantity: canBuild,
        components: report,
        worst_shortfall: bottleneck,
      };
    },
  }),

  tool({
    name: "forecast_demand",
    description:
      "Simple demand forecast. Averages recent purchase requisition quantities for an item over the last N periods (default 90 days) to project monthly demand. Use for 'what will demand be for X'.",
    parameters: {
      type: "object",
      properties: {
        sku: { type: "string" },
        lookback_days: { type: "integer", description: "Default 90." },
      },
      required: ["sku"],
    },
    async handler(args, ctx) {
      const lookback = Math.min(Math.max(args.lookback_days ?? 90, 7), 365);
      const row = (await q<any>(
        `SELECT
           COALESCE(SUM(pr.quantity),0) AS total_qty,
           COUNT(*) AS periods,
           COALESCE(AVG(pr.quantity),0) AS avg_qty
         FROM purchase_requisitions pr
         JOIN items i ON i.id = pr.item_id
        WHERE pr.tenant_id=$1 AND i.sku=$2
          AND pr.created_at >= now() - ($3 || ' days')::interval`,
        [ctx.tenantId, args.sku, lookback],
      ))[0];

      const totalQty = Number(row.total_qty);
      const monthlyEstimate = (totalQty / lookback) * 30;

      return {
        report: "demand_forecast",
        sku: args.sku,
        lookback_days: lookback,
        total_historical_qty: totalQty,
        requisition_count: Number(row.periods),
        avg_per_requisition: Number(row.avg_qty),
        projected_monthly_demand: Math.round(monthlyEstimate * 100) / 100,
      };
    },
  }),
];