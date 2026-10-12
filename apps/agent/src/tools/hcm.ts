import { q } from "../db.js";
import { createApproval } from "./approvals.js";
import { tool } from "./types.js";

export const hcmTools = [
  tool({
    name: "find_employee",
    description: "Find employees by name, department, or job title. Excludes deactivated employees by default.",
    parameters: {
      type: "object",
      properties: {
        search: { type: "string" },
        department: { type: "string" },
        include_deactivated: { type: "boolean" },
        limit: { type: "integer" },
      },
      required: [],
    },
    async handler(args, ctx) {
      const rows = await q(
        `SELECT employee_no, full_name, email, department, job_title, hire_date,
                CASE WHEN deactivated_at IS NULL THEN 'ACTIVE' ELSE 'INACTIVE' END AS status
           FROM employees
          WHERE tenant_id = $1
            AND ($2::text IS NULL OR full_name ILIKE '%'||$2||'%' OR email ILIKE '%'||$2||'%')
            AND ($3::text IS NULL OR department = $3)
            AND ($4::boolean OR deactivated_at IS NULL)
          ORDER BY full_name LIMIT $5`,
        [
          ctx.tenantId,
          args.search ?? null,
          args.department ?? null,
          args.include_deactivated === true,
          Math.min(args.limit ?? 25, 100),
        ],
      );
      return { count: rows.length, employees: rows };
    },
  }),

  tool({
    name: "update_employee",
    description: "Update an employee's department, job title, email, or salary. Identify by employee_no or email.",
    parameters: {
      type: "object",
      properties: {
        employee_no: { type: "string" },
        email: { type: "string" },
        new_email: { type: "string" },
        department: { type: "string" },
        job_title: { type: "string" },
        salary: { type: "number" },
      },
      required: [],
    },
    async handler(args, ctx) {
      if (!args.employee_no && !args.email)
        return { error: "Provide employee_no or email to identify the employee." };
      const rows = await q<any>(
        `UPDATE employees
            SET email      = COALESCE($3, email),
                department = COALESCE($4, department),
                job_title  = COALESCE($5, job_title),
                salary     = COALESCE($6, salary)
          WHERE tenant_id=$1
            AND (($2::text IS NOT NULL AND employee_no = $2) OR ($7::text IS NOT NULL AND email = $7))
          RETURNING employee_no, full_name, email, department, job_title, salary`,
        [
          ctx.tenantId,
          args.employee_no ?? null,
          args.new_email ?? null,
          args.department ?? null,
          args.job_title ?? null,
          args.salary ?? null,
          args.email ?? null,
        ],
      );
      if (!rows.length) return { error: "Employee not found." };
      return { status: "UPDATED", employee: rows[0] };
    },
  }),

  tool({
    name: "deactivate_employee",
    description: "Deactivate (soft-delete) an employee. Keeps history. Identify by employee_no or email.",
    parameters: {
      type: "object",
      properties: {
        employee_no: { type: "string" },
        email: { type: "string" },
      },
      required: [],
    },
    async handler(args, ctx) {
      if (ctx.role !== "ADMIN" && ctx.role !== "APPROVER")
        return { error: "Only ADMIN or APPROVER can deactivate employees." };
      const rows = await q<any>(
        `UPDATE employees SET deactivated_at = now()
          WHERE tenant_id=$1 AND deactivated_at IS NULL
            AND (($2::text IS NOT NULL AND employee_no = $2) OR ($3::text IS NOT NULL AND email = $3))
          RETURNING employee_no, full_name`,
        [ctx.tenantId, args.employee_no ?? null, args.email ?? null],
      );
      if (!rows.length) return { error: "Employee not found or already deactivated." };
      return { status: "DEACTIVATED", employee: rows[0] };
    },
  }),

  tool({
    name: "request_leave",
    description: "Submit a leave request for an employee. Gated: queued for approval.",
    parameters: {
      type: "object",
      properties: {
        employee_email: { type: "string" },
        from_date: { type: "string" },
        to_date: { type: "string" },
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
        message: `Leave request queued (approval #${approval?.id}).`,
      };
    },
  }),

  tool({
    name: "list_leave_requests",
    description: "List leave requests, optionally by status or employee email.",
    parameters: {
      type: "object",
      properties: {
        status: { type: "string" },
        employee_email: { type: "string" },
        limit: { type: "integer" },
      },
      required: [],
    },
    async handler(args, ctx) {
      const rows = await q(
        `SELECT lr.id, e.full_name, e.email, lr.from_date, lr.to_date,
                lr.reason, lr.status, lr.created_at
           FROM leave_requests lr JOIN employees e ON e.id = lr.employee_id
          WHERE lr.tenant_id=$1
            AND ($2::text IS NULL OR lr.status=$2)
            AND ($3::text IS NULL OR e.email=$3)
          ORDER BY lr.created_at DESC LIMIT $4`,
        [ctx.tenantId, args.status ?? null, args.employee_email ?? null, Math.min(args.limit ?? 25, 100)],
      );
      return { count: rows.length, leave_requests: rows };
    },
  }),
];