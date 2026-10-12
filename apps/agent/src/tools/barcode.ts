import { q } from "../db.js";
import { tool } from "./types.js";

export const barcodeTools = [
  tool({
    name: "lookup_barcode",
    description:
      "Look up an item by its barcode / RFID tag. Returns SKU, name, prices, and current stock by warehouse.",
    parameters: {
      type: "object",
      properties: { barcode: { type: "string" } },
      required: ["barcode"],
    },
    async handler(args, ctx) {
      const item = (await q<any>(
        `SELECT id, sku, name, category, unit, selling_price, cost_price, reorder_point
           FROM items WHERE tenant_id=$1 AND barcode=$2 AND deleted_at IS NULL`,
        [ctx.tenantId, args.barcode],
      ))[0];
      if (!item) return { error: `No item found with barcode ${args.barcode}.` };

      const stock = await q(
        `SELECT w.code AS warehouse, s.quantity
           FROM stock s JOIN warehouses w ON w.id = s.warehouse_id
          WHERE s.item_id=$1 ORDER BY w.code`,
        [item.id],
      );
      delete item.id;
      return { item, stock };
    },
  }),

  tool({
    name: "set_item_barcode",
    description: "Assign a barcode to an item by SKU. Immediate.",
    parameters: {
      type: "object",
      properties: {
        sku: { type: "string" },
        barcode: { type: "string" },
      },
      required: ["sku", "barcode"],
    },
    async handler(args, ctx) {
      // Guard against duplicate barcodes within the tenant
      const dup = await q(
        `SELECT sku FROM items WHERE tenant_id=$1 AND barcode=$2 AND sku <> $3 AND deleted_at IS NULL`,
        [ctx.tenantId, args.barcode, args.sku],
      );
      if (dup.length) return { error: `Barcode ${args.barcode} is already assigned to ${dup[0].sku}.` };
      const rows = await q<any>(
        `UPDATE items SET barcode=$3 WHERE tenant_id=$1 AND sku=$2 RETURNING sku, name, barcode`,
        [ctx.tenantId, args.sku, args.barcode],
      );
      if (!rows.length) return { error: `Item ${args.sku} not found.` };
      return { status: "SET", item: rows[0] };
    },
  }),
];