import { q } from "../db.js";
import { createApproval } from "./approvals.js";
import { tool } from "./types.js";

export const procurementTools = [
  tool({
    name: "create_purchase_requisition",
    description:
      "Create a purchase requisition (a request to buy something). Use this when the user says they want to order / buy / purchase items. Provide SKU, quantity, and required_by date if mentioned.",
    parameters: {
      type: "object",
      properties: {
        sku: { type: "string", description: "Item SKU, e.g. SKU-1001" },
        quantity: { type: "number" },
        required_by: { type: "string", description: "YYYY-MM-DD" },
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
        message: `Purchase requisition created and queued for approval (approval #${approval?.id}).`,
      };
    },
  }),

  tool({
    name: "list_purchase_requisitions",
    description: "List existing purchase requisitions.",
    parameters: {
      type: "object",
      properties: {
        status: { type: "string" },
        limit: { type: "integer" },
      },
      required: [],
    },
    async handler(args, ctx) {
      const rows = await q(
        `SELECT pr.reference, pr.quantity, pr.status, pr.required_by,
                i.sku, i.name AS item_name, pr.created_at
           FROM purchase_requisitions pr
           LEFT JOIN items i ON i.id = pr.item_id
          WHERE pr.tenant_id = $1
            AND ($2::text IS NULL OR pr.status = $2)
          ORDER BY pr.created_at DESC
          LIMIT $3`,
        [ctx.tenantId, args.status ?? null, Math.min(args.limit ?? 25, 100)],
      );
      return { count: rows.length, requisitions: rows };
    },
  }),

  tool({
    name: "list_vendors",
    description: "List vendors / suppliers.",
    parameters: {
      type: "object",
      properties: { search: { type: "string" }, limit: { type: "integer" } },
      required: [],
    },
    async handler(args, ctx) {
      const rows = await q(
        `SELECT code, name, email, rating
           FROM vendors
          WHERE tenant_id = $1
            AND ($2::text IS NULL OR name ILIKE '%' || $2 || '%')
          ORDER BY name LIMIT $3`,
        [ctx.tenantId, args.search ?? null, Math.min(args.limit ?? 25, 100)],
      );
      return { count: rows.length, vendors: rows };
    },
  }),
];