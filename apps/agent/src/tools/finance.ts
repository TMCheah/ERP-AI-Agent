import { q } from "../db.js";
import { createApproval } from "./approvals.js";
import { tool } from "./types.js";

export const financeTools = [
  tool({
    name: "list_invoices",
    description: "List invoices, optional status / customer filter.",
    parameters: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["OPEN", "PAID", "OVERDUE", "VOID"] },
        customer: { type: "string" },
        limit: { type: "integer" },
      },
      required: [],
    },
    async handler(args, ctx) {
      const rows = await q(
        `SELECT number, customer, amount, currency, due_date, status FROM invoices
          WHERE tenant_id=$1
            AND ($2::text IS NULL OR status=$2)
            AND ($3::text IS NULL OR customer ILIKE '%'||$3||'%')
          ORDER BY due_date ASC LIMIT $4`,
        [ctx.tenantId, args.status ?? null, args.customer ?? null, Math.min(args.limit ?? 25, 100)],
      );
      const total = rows.reduce((s: number, r: any) => s + Number(r.amount), 0);
      return { count: rows.length, total_amount: total, invoices: rows };
    },
  }),

  tool({
    name: "create_invoice",
    description: "Create a customer invoice. Gated: queued for approval.",
    parameters: {
      type: "object",
      properties: {
        customer: { type: "string" },
        amount: { type: "number" },
        currency: { type: "string" },
        due_date: { type: "string" },
      },
      required: ["customer", "amount", "due_date"],
    },
    async handler(args, ctx) {
      const approval = await createApproval(
        ctx,
        "invoice",
        `Invoice ${args.customer} for ${args.amount} ${args.currency ?? "USD"}`,
        args,
      );
      return {
        status: "PENDING_APPROVAL",
        approval_id: approval?.id,
        message: `Invoice queued (approval #${approval?.id}).`,
      };
    },
  }),

  tool({
    name: "update_invoice",
    description: "Update an invoice's amount, currency, due date, or customer. Immediate.",
    parameters: {
      type: "object",
      properties: {
        number: { type: "string" },
        customer: { type: "string" },
        amount: { type: "number" },
        due_date: { type: "string" },
      },
      required: ["number"],
    },
    async handler(args, ctx) {
      const rows = await q<any>(
        `UPDATE invoices
            SET customer = COALESCE($3, customer),
                amount   = COALESCE($4, amount),
                due_date = COALESCE($5, due_date)
          WHERE tenant_id=$1 AND number=$2 AND status <> 'VOID'
          RETURNING number, customer, amount, currency, due_date, status`,
        [ctx.tenantId, args.number, args.customer ?? null, args.amount ?? null, args.due_date ?? null],
      );
      if (!rows.length) return { error: `Invoice ${args.number} not found or void.` };
      return { status: "UPDATED", invoice: rows[0] };
    },
  }),

  tool({
    name: "mark_invoice_paid",
    description: "Mark an invoice as PAID by its number.",
    parameters: {
      type: "object",
      properties: { number: { type: "string" } },
      required: ["number"],
    },
    async handler(args, ctx) {
      const rows = await q<any>(
        `UPDATE invoices SET status='PAID' WHERE tenant_id=$1 AND number=$2 AND status <> 'VOID'
         RETURNING number, status`,
        [ctx.tenantId, args.number],
      );
      if (!rows.length) return { error: `Invoice ${args.number} not found or void.` };
      return { status: "UPDATED", invoice: rows[0] };
    },
  }),

  tool({
    name: "void_invoice",
    description: "Void an invoice. Keeps it in the ledger but marks it VOID.",
    parameters: {
      type: "object",
      properties: {
        number: { type: "string" },
        reason: { type: "string" },
      },
      required: ["number"],
    },
    async handler(args, ctx) {
      if (ctx.role === "STAFF") return { error: "Only APPROVER or ADMIN can void invoices." };
      const rows = await q<any>(
        `UPDATE invoices SET status='VOID' WHERE tenant_id=$1 AND number=$2
         RETURNING number, status`,
        [ctx.tenantId, args.number],
      );
      if (!rows.length) return { error: `Invoice ${args.number} not found.` };
      await q(
        `INSERT INTO audit_log (tenant_id, user_id, action, detail) VALUES ($1,$2,'invoice.void',$3)`,
        [ctx.tenantId, ctx.userId, { number: args.number, reason: args.reason ?? null }],
      );
      return { status: "VOID", invoice: rows[0] };
    },
  }),

  tool({
    name: "list_gl_accounts",
    description: "List general ledger accounts (chart of accounts).",
    parameters: {
      type: "object",
      properties: { type: { type: "string", enum: ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"] } },
      required: [],
    },
    async handler(args, ctx) {
      const rows = await q(
        `SELECT code, name, type FROM gl_accounts
          WHERE tenant_id=$1 AND ($2::text IS NULL OR type=$2)
          ORDER BY code`,
        [ctx.tenantId, args.type ?? null],
      );
      return { count: rows.length, accounts: rows };
    },
  }),

  tool({
    name: "create_gl_account",
    description: "Create a general ledger account.",
    parameters: {
      type: "object",
      properties: {
        code: { type: "string" },
        name: { type: "string" },
        type: { type: "string", enum: ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"] },
      },
      required: ["code", "name", "type"],
    },
    async handler(args, ctx) {
      const dup = await q(`SELECT id FROM gl_accounts WHERE tenant_id=$1 AND code=$2`, [ctx.tenantId, args.code]);
      if (dup.length) return { error: `GL account ${args.code} already exists.` };
      const rows = await q<any>(
        `INSERT INTO gl_accounts (tenant_id, code, name, type) VALUES ($1,$2,$3,$4)
         RETURNING id, code, name, type`,
        [ctx.tenantId, args.code, args.name, args.type],
      );
      return { status: "CREATED", account: rows[0] };
    },
  }),

  tool({
    name: "create_journal_entry",
    description: "Create a journal entry (Dr/Cr). Gated: queued for approval.",
    parameters: {
      type: "object",
      properties: {
        debit_account: { type: "string" },
        credit_account: { type: "string" },
        amount: { type: "number" },
        memo: { type: "string" },
      },
      required: ["debit_account", "credit_account", "amount"],
    },
    async handler(args, ctx) {
      const approval = await createApproval(
        ctx,
        "journal_entry",
        `JE Dr ${args.debit_account} / Cr ${args.credit_account} ${args.amount}`,
        args,
      );
      return {
        status: "PENDING_APPROVAL",
        approval_id: approval?.id,
        message: `Journal entry queued (approval #${approval?.id}).`,
      };
    },
  }),

  tool({
    name: "list_journal_entries",
    description: "List recent journal entries.",
    parameters: {
      type: "object",
      properties: { limit: { type: "integer" } },
      required: [],
    },
    async handler(args, ctx) {
      const rows = await q(
        `SELECT reference, memo, debit_account, credit_account, amount, created_at
           FROM journal_entries
          WHERE tenant_id=$1
          ORDER BY created_at DESC LIMIT $2`,
        [ctx.tenantId, Math.min(args.limit ?? 25, 100)],
      );
      return { count: rows.length, entries: rows };
    },
  }),
];