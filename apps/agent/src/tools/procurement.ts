import { q } from "../db.js";
import { createApproval } from "./approvals.js";
import { tool } from "./types.js";

export const procurementTools = [
  tool({
    name: "create_purchase_requisition",
    description: "Create a purchase requisition. Gated: queued for approval.",
    parameters: {
      type: "object",
      properties: {
        sku: { type: "string" },
        quantity: { type: "number" },
        required_by: { type: "string" },
        notes: { type: "string" },
      },
      required: ["sku", "quantity"],
    },
    async handler(args, ctx) {
      const approval = await createApproval(
        ctx,
        "purchase_requisition",
        `Purchase ${args.quantity} x ${args.sku}${args.required_by ? ` by ${args.required_by}` : ""}`,
        args,
      );
      return {
        status: "PENDING_APPROVAL",
        approval_id: approval?.id,
        message: `Requisition queued (approval #${approval?.id}).`,
      };
    },
  }),

  tool({
    name: "list_purchase_requisitions",
    description: "List purchase requisitions.",
    parameters: {
      type: "object",
      properties: { status: { type: "string" }, limit: { type: "integer" } },
      required: [],
    },
    async handler(args, ctx) {
      const rows = await q(
        `SELECT pr.id, pr.reference, pr.quantity, pr.status, pr.required_by,
                i.sku, i.name AS item_name, pr.created_at
           FROM purchase_requisitions pr LEFT JOIN items i ON i.id = pr.item_id
          WHERE pr.tenant_id = $1 AND ($2::text IS NULL OR pr.status = $2)
          ORDER BY pr.created_at DESC LIMIT $3`,
        [ctx.tenantId, args.status ?? null, Math.min(args.limit ?? 25, 100)],
      );
      return { count: rows.length, requisitions: rows };
    },
  }),

  tool({
    name: "cancel_purchase_requisition",
    description: "Cancel a purchase requisition by ID. Sets status to CANCELLED.",
    parameters: {
      type: "object",
      properties: { requisition_id: { type: "integer" } },
      required: ["requisition_id"],
    },
    async handler(args, ctx) {
      const rows = await q<any>(
        `UPDATE purchase_requisitions SET status='CANCELLED'
          WHERE id=$1 AND tenant_id=$2 AND status NOT IN ('CANCELLED','RECEIVED')
          RETURNING id, reference, status`,
        [args.requisition_id, ctx.tenantId],
      );
      if (!rows.length) return { error: `Requisition #${args.requisition_id} not found or already closed.` };
      return { status: "CANCELLED", requisition: rows[0] };
    },
  }),

  tool({
    name: "create_vendor",
    description: "Create a vendor. Master data — immediate.",
    parameters: {
      type: "object",
      properties: {
        code: { type: "string" },
        name: { type: "string" },
        email: { type: "string" },
      },
      required: ["code", "name"],
    },
    async handler(args, ctx) {
      const dup = await q(`SELECT id FROM vendors WHERE tenant_id=$1 AND code=$2`, [ctx.tenantId, args.code]);
      if (dup.length) return { error: `Vendor code ${args.code} already exists.` };
      const rows = await q<any>(
        `INSERT INTO vendors (tenant_id, code, name, email) VALUES ($1,$2,$3,$4)
         RETURNING id, code, name`,
        [ctx.tenantId, args.code, args.name, args.email ?? null],
      );
      return { status: "CREATED", vendor: rows[0] };
    },
  }),

  tool({
    name: "update_vendor",
    description: "Update a vendor's name, email, or rating.",
    parameters: {
      type: "object",
      properties: {
        code: { type: "string" },
        name: { type: "string" },
        email: { type: "string" },
        rating: { type: "number" },
      },
      required: ["code"],
    },
    async handler(args, ctx) {
      const rows = await q<any>(
        `UPDATE vendors
            SET name   = COALESCE($3, name),
                email  = COALESCE($4, email),
                rating = COALESCE($5, rating)
          WHERE tenant_id=$1 AND code=$2
          RETURNING id, code, name, email, rating`,
        [ctx.tenantId, args.code, args.name ?? null, args.email ?? null, args.rating ?? null],
      );
      if (!rows.length) return { error: `Vendor ${args.code} not found.` };
      return { status: "UPDATED", vendor: rows[0] };
    },
  }),

  tool({
    name: "delete_vendor",
    description:
      "Delete a vendor by code. Only allowed when the vendor has no purchase orders. Immediate.",
    parameters: {
      type: "object",
      properties: { code: { type: "string" } },
      required: ["code"],
    },
    async handler(args, ctx) {
      const v = (await q<any>(`SELECT id FROM vendors WHERE tenant_id=$1 AND code=$2`, [ctx.tenantId, args.code]))[0];
      if (!v) return { error: `Vendor ${args.code} not found.` };
      const used = (await q<any>(`SELECT COUNT(*) AS n FROM purchase_orders WHERE vendor_id=$1`, [v.id]))[0];
      if (Number(used.n) > 0) return { error: `Cannot delete vendor ${args.code}: ${used.n} purchase order(s) reference it.` };
      await q(`DELETE FROM vendors WHERE id=$1`, [v.id]);
      return { status: "DELETED", vendor_code: args.code };
    },
  }),

  tool({
    name: "list_vendors",
    description: "List vendors, optional search.",
    parameters: {
      type: "object",
      properties: { search: { type: "string" }, limit: { type: "integer" } },
      required: [],
    },
    async handler(args, ctx) {
      const rows = await q(
        `SELECT code, name, email, rating FROM vendors
          WHERE tenant_id=$1 AND ($2::text IS NULL OR name ILIKE '%'||$2||'%')
          ORDER BY name LIMIT $3`,
        [ctx.tenantId, args.search ?? null, Math.min(args.limit ?? 25, 100)],
      );
      return { count: rows.length, vendors: rows };
    },
  }),

  tool({
    name: "create_purchase_order",
    description: "Create a purchase order. Gated: queued for approval.",
    parameters: {
      type: "object",
      properties: {
        vendor_code: { type: "string" },
        lines: {
          type: "array",
          items: {
            type: "object",
            properties: {
              sku: { type: "string" },
              quantity: { type: "number" },
              unit_price: { type: "number" },
            },
            required: ["sku", "quantity"],
          },
        },
        expected_date: { type: "string" },
        notes: { type: "string" },
      },
      required: ["vendor_code", "lines"],
    },
    async handler(args, ctx) {
      const approval = await createApproval(
        ctx,
        "purchase_order",
        `PO for ${args.vendor_code}: ${args.lines.length} line(s)`,
        args,
      );
      return {
        status: "PENDING_APPROVAL",
        approval_id: approval?.id,
        message: `Purchase order queued (approval #${approval?.id}).`,
      };
    },
  }),

  tool({
    name: "list_purchase_orders",
    description: "List purchase orders with receiving progress.",
    parameters: {
      type: "object",
      properties: { status: { type: "string" }, limit: { type: "integer" } },
      required: [],
    },
    async handler(args, ctx) {
      const rows = await q(
        `SELECT po.reference, po.status, po.order_date, po.expected_date,
                v.name AS vendor_name,
                (SELECT COUNT(*) FROM purchase_order_lines l WHERE l.po_id=po.id) AS lines,
                (SELECT COUNT(*) FROM purchase_order_lines l WHERE l.po_id=po.id AND l.received_qty >= l.quantity) AS lines_complete
           FROM purchase_orders po LEFT JOIN vendors v ON v.id = po.vendor_id
          WHERE po.tenant_id=$1 AND ($2::text IS NULL OR po.status=$2)
          ORDER BY po.created_at DESC LIMIT $3`,
        [ctx.tenantId, args.status ?? null, Math.min(args.limit ?? 25, 100)],
      );
      return { count: rows.length, purchase_orders: rows };
    },
  }),

  tool({
    name: "get_purchase_order",
    description: "Get a PO's details and line-level receiving progress.",
    parameters: {
      type: "object",
      properties: { reference: { type: "string" } },
      required: ["reference"],
    },
    async handler(args, ctx) {
      const po = (await q<any>(
        `SELECT po.id, po.reference, po.status, po.order_date, po.expected_date,
                po.notes, v.code AS vendor_code, v.name AS vendor_name
           FROM purchase_orders po LEFT JOIN vendors v ON v.id = po.vendor_id
          WHERE po.tenant_id=$1 AND po.reference=$2`,
        [ctx.tenantId, args.reference],
      ))[0];
      if (!po) return { error: `PO ${args.reference} not found.` };
      const lines = await q(
        `SELECT i.sku, i.name AS item_name, l.quantity, l.received_qty,
                (l.quantity - l.received_qty) AS outstanding, l.unit_price
           FROM purchase_order_lines l LEFT JOIN items i ON i.id = l.item_id
          WHERE l.po_id = $1 ORDER BY l.id`,
        [po.id],
      );
      delete po.id;
      return { purchase_order: po, lines };
    },
  }),
];