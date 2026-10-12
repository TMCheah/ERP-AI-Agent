import { one, q } from "../db.js";
import { executeApproval } from "../approval-executor.js";
import { tool, type ToolCtx } from "./types.js";

export async function createApproval(
  ctx: ToolCtx,
  kind: string,
  summary: string,
  payload: Record<string, any>,
) {
  const row = await one(
    `INSERT INTO approvals (tenant_id, kind, summary, payload, requested_by)
     VALUES ($1,$2,$3,$4,$5) RETURNING id, status, kind, summary, created_at`,
    [ctx.tenantId, kind, summary, payload, ctx.userId],
  );
  await q(
    `INSERT INTO audit_log (tenant_id, user_id, action, detail)
     VALUES ($1,$2,'approval.requested',$3)`,
    [ctx.tenantId, ctx.userId, { kind, summary }],
  );
  return row;
}

export const approvalTools = [
  tool({
    name: "list_my_approvals",
    description:
      "List approval requests visible to the current user. Use when the user asks about pending approvals or the approval queue.",
    parameters: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["PENDING", "APPROVED", "REJECTED", "ALL"] },
        limit: { type: "integer" },
      },
      required: [],
    },
    async handler(args: { status?: string; limit?: number }, ctx) {
      const status = args.status ?? "PENDING";
      const limit = Math.min(args.limit ?? 20, 100);
      const rows = await q(
        `SELECT a.id, a.kind, a.summary, a.status, a.created_at,
                u.full_name AS requested_by
           FROM approvals a
           LEFT JOIN users u ON u.id = a.requested_by
          WHERE a.tenant_id = $1
            AND ($2 = 'ALL' OR a.status = $2)
          ORDER BY a.created_at DESC
          LIMIT $3`,
        [ctx.tenantId, status, limit],
      );
      return { count: rows.length, approvals: rows };
    },
  }),

  tool({
    name: "approve_request",
    description:
      "Approve a pending approval by ID. Executes the underlying action immediately. Requires APPROVER or ADMIN role. Use when the user says 'approve PR #42' or similar.",
    parameters: {
      type: "object",
      properties: {
        approval_id: { type: "integer" },
        note: { type: "string" },
      },
      required: ["approval_id"],
    },
    async handler(args: { approval_id: number; note?: string }, ctx) {
      if (ctx.role === "STAFF") return { error: "Approver role required to approve." };
      const row = await one<any>(
        `SELECT * FROM approvals WHERE id=$1 AND tenant_id=$2`,
        [args.approval_id, ctx.tenantId],
      );
      if (!row) return { error: `Approval #${args.approval_id} not found.` };
      if (row.status !== "PENDING") return { error: `Approval #${args.approval_id} is already ${row.status}.` };

      try {
        await executeApproval(ctx, row.kind, row.payload, row.requested_by);
      } catch (err: any) {
        return { error: `Execution failed: ${err.message}` };
      }
      await q(
        `UPDATE approvals SET status='APPROVED', decided_by=$1, decided_at=now(), decision_note=$2 WHERE id=$3`,
        [ctx.userId, args.note ?? null, args.approval_id],
      );
      await q(
        `INSERT INTO audit_log (tenant_id, user_id, action, detail) VALUES ($1,$2,'approval.approved',$3)`,
        [ctx.tenantId, ctx.userId, { id: args.approval_id, kind: row.kind }],
      );
      return { status: "APPROVED", approval_id: args.approval_id, kind: row.kind };
    },
  }),

  tool({
    name: "reject_request",
    description:
      "Reject a pending approval by ID with an optional note. Requires APPROVER or ADMIN role.",
    parameters: {
      type: "object",
      properties: {
        approval_id: { type: "integer" },
        note: { type: "string" },
      },
      required: ["approval_id"],
    },
    async handler(args: { approval_id: number; note?: string }, ctx) {
      if (ctx.role === "STAFF") return { error: "Approver role required to reject." };
      const row = await one<any>(
        `SELECT * FROM approvals WHERE id=$1 AND tenant_id=$2`,
        [args.approval_id, ctx.tenantId],
      );
      if (!row) return { error: `Approval #${args.approval_id} not found.` };
      if (row.status !== "PENDING") return { error: `Approval #${args.approval_id} is already ${row.status}.` };

      await q(
        `UPDATE approvals SET status='REJECTED', decided_by=$1, decided_at=now(), decision_note=$2 WHERE id=$3`,
        [ctx.userId, args.note ?? null, args.approval_id],
      );
      await q(
        `INSERT INTO audit_log (tenant_id, user_id, action, detail) VALUES ($1,$2,'approval.rejected',$3)`,
        [ctx.tenantId, ctx.userId, { id: args.approval_id, kind: row.kind }],
      );
      return { status: "REJECTED", approval_id: args.approval_id, kind: row.kind };
    },
  }),
];