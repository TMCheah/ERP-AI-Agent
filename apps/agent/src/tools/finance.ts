import { q } from "../db.js";
import { createApproval } from "./approvals.js";
import { tool } from "./types.js";

export const financeTools = [
  tool({
    name: "list_invoices",
    description:
      "List customer invoices, optionally filtered by status (OPEN, PAID, OVERDUE) or customer name.",
    parameters: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["OPEN", "PAID", "OVERDUE"] },
        customer: { type: "string" },
        limit: { type: "integer" },
      },
      required: [],
    },
    async handler(args, ctx) {
      const rows = await q(
        `SELECT number, customer, amount, currency, due_date, status
           FROM invoices
          WHERE tenant_id = $1
            AND ($2::text IS NULL OR status = $2)
            AND ($3::text IS NULL OR customer ILIKE '%' || $3 || '%')
          ORDER BY due_date ASC
          LIMIT $4`,
        [ctx.tenantId, args.status ?? null, args.customer ?? null, Math.min(args.limit ?? 25, 100)],
      );
      const total = rows.reduce((s: number, r: any) => s + Number(r.amount), 0);
      return { count: rows.length, total_amount: total, invoices: rows };
    },
  }),

  tool({
    name: "create_journal_entry",
    description:
      "Create a general-ledger journal entry. Requires approval before posting.",
    parameters: {
      type: "object",
      properties: {
        debit_account: { type: "string", description: "GL code, e.g. 5000" },
        credit_account: { type: "string", description: "GL code, e.g. 2000" },
        amount: { type: "number" },
        memo: { type: "string" },
      },
      required: ["debit_account", "credit_account", "amount"],
    },
    async handler(args, ctx) {
      if (ctx.role === "STAFF") {
        return { error: "Not permitted: only APPROVER or ADMIN can post journal entries." };
      }
      const approval = await createApproval(
        ctx,
        "journal_entry",
        `Journal entry: Dr ${args.debit_account} / Cr ${args.credit_account} for ${args.amount}`,
        args,
      );
      return {
        status: "PENDING_APPROVAL",
        approval_id: approval?.id,
        message: `Journal entry queued for approval (approval #${approval?.id}).`,
      };
    },
  }),
];