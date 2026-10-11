import { q } from "../db.js";
import { createApproval } from "./approvals.js";
import { tool } from "./types.js";

export const hcmTools = [
  tool({
    name: "find_employee",
    description: "Find employees by name, department, or job title.",
    parameters: {
      type: "object",
      properties: {
        search: { type: "string" },
        department: { type: "string" },
        limit: { type: "integer" },
      },
      required: [],
    },
    async handler(args, ctx) {
      const rows = await q(
        `SELECT employee_no, full_name, email, department, job_title, hire_date, salary
           FROM employees
          WHERE tenant_id = $1
            AND ($2::text IS NULL OR full_name ILIKE '%' || $2 || '%' OR email ILIKE '%' || $2 || '%')
            AND ($3::text IS NULL OR department = $3)
          ORDER BY full_name LIMIT $4`,
        [ctx.tenantId, args.search ?? null, args.department ?? null, Math.min(args.limit ?? 25, 100)],
      );
      return { count: rows.length, employees: rows };
    },
  }),

  tool({
    name: "request_leave",
    description: "Submit a leave request for an employee. Requires approval.",
    parameters: {
      type: "object",
      properties: {
        employee_email: { type: "string" },
        from_date: { type: "string", description: "YYYY-MM-DD" },
        to_date: { type: "string", description: "YYYY-MM-DD" },
        reason: { type: "string" },
      },
      required: ["employee_email", "from_date", "to_date"],
    },
    async handler(args, ctx) {
      const approval = await createApproval(
        ctx,
        "leave_request",
        `Leave for ${args.employee_email} ${args.from_date} → ${args.to_date}`,
        args,
      );
      return {
        status: "PENDING_APPROVAL",
        approval_id: approval?.id,
        message: `Leave request queued for approval (approval #${approval?.id}).`,
      };
    },
  }),
];