import { one, q } from "../db.js";
import { tool, type ToolCtx } from "./types.js";

/** Insert a pending approval. Returns the approval row. */
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

export const approvalTools: ReturnType<typeof tool>[] = [
  tool({
    name: "list_my_approvals",
    description:
      "List approval requests visible to the current user. Use this when the user asks about pending approvals, things to approve, or the approval queue.",
    parameters: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["PENDING", "APPROVED", "REJECTED", "ALL"],
          description: "Filter by status. Defaults to PENDING.",
        },
        limit: { type: "integer", description: "Max rows, default 20." },
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
];