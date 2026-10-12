import { q } from "../db.js";
import { tool } from "./types.js";

export const itemTools = [
  tool({
    name: "create_item",
    description:
      "Create a new item (SKU) in the catalog. Master data — immediate. Optionally provide opening_stock + warehouse_code together to seed initial inventory.",
    parameters: {
      type: "object",
      properties: {
        sku: { type: "string", description: "Unique SKU code, e.g. SKU-4001." },
        name: { type: "string" },
        category: { type: "string" },
        unit: { type: "string", description: "Unit of measure: EA, RM, KG, etc. Defaults to EA." },
        selling_price: { type: "number" },
        cost_price: { type: "number" },
        reorder_point: { type: "integer" },
        barcode: { type: "string" },
        opening_stock: { type: "number", description: "Optional. Requires warehouse_code." },
        warehouse_code: { type: "string", description: "Optional. Requires opening_stock." },
      },
      required: ["sku", "name"],
    },
    async handler(args, ctx) {
      if ((args.opening_stock != null) !== (args.warehouse_code != null)) {
        return { error: "Provide both opening_stock and warehouse_code, or neither." };
      }

      const dup = await q(
        `SELECT id FROM items WHERE tenant_id=$1 AND sku=$2`,
        [ctx.tenantId, args.sku],
      );
      if (dup.length) return { error: `SKU ${args.sku} already exists.` };

      if (args.barcode) {
        const dupBar = await q(
          `SELECT sku FROM items WHERE tenant_id=$1 AND barcode=$2`,
          [ctx.tenantId, args.barcode],
        );
        if (dupBar.length) return { error: `Barcode ${args.barcode} already used by ${(dupBar[0] as any).sku}.` };
      }

      let whId: number | null = null;
      if (args.warehouse_code) {
        const wh = (await q<any>(
          `SELECT id FROM warehouses WHERE tenant_id=$1 AND code=$2`,
          [ctx.tenantId, args.warehouse_code],
        ))[0];
        if (!wh) return { error: `Warehouse ${args.warehouse_code} not found.` };
        whId = wh.id;
      }

      const row = (await q<any>(
        `INSERT INTO items (tenant_id, sku, name, category, unit, selling_price, cost_price, reorder_point, barcode)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id, sku, name, category, unit, selling_price, cost_price, reorder_point, barcode`,
        [
          ctx.tenantId, args.sku, args.name, args.category ?? null, args.unit ?? "EA",
          args.selling_price ?? 0, args.cost_price ?? 0, args.reorder_point ?? 0,
          args.barcode ?? null,
        ],
      ))[0];

      let openingStockInfo: any = null;
      if (whId && args.opening_stock != null) {
        await q(
          `INSERT INTO stock (tenant_id, item_id, warehouse_id, quantity) VALUES ($1,$2,$3,$4)`,
          [ctx.tenantId, row.id, whId, args.opening_stock],
        );
        await q(
          `INSERT INTO stock_movements (tenant_id, item_id, to_warehouse_id, quantity, reason, reference, moved_by)
           VALUES ($1,$2,$3,$4,'OPENING','INITIAL',$5)`,
          [ctx.tenantId, row.id, whId, args.opening_stock, ctx.userId],
        );
        openingStockInfo = { warehouse: args.warehouse_code, quantity: args.opening_stock };
      }

      await q(
        `INSERT INTO audit_log (tenant_id, user_id, action, detail) VALUES ($1,$2,'item.created',$3)`,
        [ctx.tenantId, ctx.userId, { sku: args.sku, opening: openingStockInfo }],
      );

      return { status: "CREATED", item: row, opening_stock: openingStockInfo };
    },
  }),

  tool({
    name: "update_item",
    description: "Update an item's name, category, unit, prices, reorder point, or barcode. Identify by SKU.",
    parameters: {
      type: "object",
      properties: {
        sku: { type: "string" },
        name: { type: "string" },
        category: { type: "string" },
        unit: { type: "string" },
        selling_price: { type: "number" },
        cost_price: { type: "number" },
        reorder_point: { type: "integer" },
        barcode: { type: "string" },
      },
      required: ["sku"],
    },
    async handler(args, ctx) {
      if (args.barcode) {
        const dup = await q(
          `SELECT sku FROM items WHERE tenant_id=$1 AND barcode=$2 AND sku <> $3`,
          [ctx.tenantId, args.barcode, args.sku],
        );
        if (dup.length) return { error: `Barcode already used by ${(dup[0] as any).sku}.` };
      }
      const rows = await q<any>(
        `UPDATE items
            SET name          = COALESCE($2, name),
                category      = COALESCE($3, category),
                unit          = COALESCE($4, unit),
                selling_price = COALESCE($5, selling_price),
                cost_price    = COALESCE($6, cost_price),
                reorder_point = COALESCE($7, reorder_point),
                barcode       = COALESCE($8, barcode)
          WHERE tenant_id=$9 AND sku=$1 AND deleted_at IS NULL
          RETURNING sku, name, category, unit, selling_price, cost_price, reorder_point, barcode`,
        [
          args.sku, args.name ?? null, args.category ?? null, args.unit ?? null,
          args.selling_price ?? null, args.cost_price ?? null, args.reorder_point ?? null,
          args.barcode ?? null, ctx.tenantId,
        ],
      );
      if (!rows.length) return { error: `Item ${args.sku} not found or already deactivated.` };
      await q(
        `INSERT INTO audit_log (tenant_id, user_id, action, detail) VALUES ($1,$2,'item.updated',$3)`,
        [ctx.tenantId, ctx.userId, { sku: args.sku }],
      );
      return { status: "UPDATED", item: rows[0] };
    },
  }),

  tool({
    name: "deactivate_item",
    description:
      "Soft-delete an item. Keeps history and existing references. Item stops appearing in list_items and query_inventory by default.",
    parameters: {
      type: "object",
      properties: {
        sku: { type: "string" },
        reason: { type: "string" },
      },
      required: ["sku"],
    },
    async handler(args, ctx) {
      if (ctx.role === "STAFF") return { error: "Only APPROVER or ADMIN can deactivate items." };
      const rows = await q<any>(
        `UPDATE items SET deleted_at=now()
          WHERE tenant_id=$1 AND sku=$2 AND deleted_at IS NULL
          RETURNING id, sku, name`,
        [ctx.tenantId, args.sku],
      );
      if (!rows.length) return { error: `Item ${args.sku} not found or already deactivated.` };
      await q(
        `INSERT INTO audit_log (tenant_id, user_id, action, detail) VALUES ($1,$2,'item.deactivated',$3)`,
        [ctx.tenantId, ctx.userId, { sku: args.sku, reason: args.reason ?? null }],
      );
      return { status: "DEACTIVATED", item: rows[0] };
    },
  }),

  tool({
    name: "activate_item",
    description: "Reactivate a previously deactivated item.",
    parameters: {
      type: "object",
      properties: { sku: { type: "string" } },
      required: ["sku"],
    },
    async handler(args, ctx) {
      const rows = await q<any>(
        `UPDATE items SET deleted_at=NULL
          WHERE tenant_id=$1 AND sku=$2 AND deleted_at IS NOT NULL
          RETURNING id, sku, name`,
        [ctx.tenantId, args.sku],
      );
      if (!rows.length) return { error: `Item ${args.sku} not found or already active.` };
      return { status: "ACTIVATED", item: rows[0] };
    },
  }),

  tool({
    name: "list_items",
    description:
      "List catalog items (SKUs). Excludes deactivated by default. Use for browsing the product catalog. Use query_inventory when stock levels or warehouse distributions matter.",
    parameters: {
      type: "object",
      properties: {
        search: { type: "string" },
        category: { type: "string" },
        include_deactivated: { type: "boolean" },
        limit: { type: "integer" },
      },
      required: [],
    },
    async handler(args, ctx) {
      const rows = await q(
        `SELECT i.sku, i.name, i.category, i.unit, i.selling_price, i.cost_price,
                i.reorder_point, i.barcode,
                CASE WHEN i.deleted_at IS NULL THEN 'ACTIVE' ELSE 'INACTIVE' END AS status,
                COALESCE(SUM(s.quantity),0) AS total_stock
           FROM items i
           LEFT JOIN stock s ON s.item_id = i.id
          WHERE i.tenant_id=$1
            AND ($2::text IS NULL OR i.name ILIKE '%'||$2||'%' OR i.sku ILIKE '%'||$2||'%')
            AND ($3::text IS NULL OR i.category=$3)
            AND ($4::boolean OR i.deleted_at IS NULL)
          GROUP BY i.id
          ORDER BY i.sku
          LIMIT $5`,
        [
          ctx.tenantId, args.search ?? null, args.category ?? null,
          args.include_deactivated === true,
          Math.min(args.limit ?? 50, 200),
        ],
      );
      return { count: rows.length, items: rows };
    },
  }),

  tool({
    name: "get_item",
    description: "Get full details of one item by SKU, including stock by warehouse.",
    parameters: {
      type: "object",
      properties: { sku: { type: "string" } },
      required: ["sku"],
    },
    async handler(args, ctx) {
      const item = (await q<any>(
        `SELECT id, sku, name, category, unit, selling_price, cost_price, reorder_point, barcode,
                CASE WHEN deleted_at IS NULL THEN 'ACTIVE' ELSE 'INACTIVE' END AS status
           FROM items WHERE tenant_id=$1 AND sku=$2`,
        [ctx.tenantId, args.sku],
      ))[0];
      if (!item) return { error: `Item ${args.sku} not found.` };
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
];