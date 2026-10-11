import { one, q } from "../db.js";
import { createApproval } from "./approvals.js";
import { tool } from "./types.js";

export const hcmAdminTools = [
  tool({
    name: "create_employee",
    description:
      "Create a new employee record in HCM. Returns the new employee_id, which you can pass into create_user to link a login account to this employee. Use this when the user says things like 'add a new employee', 'onboard Henry', 'hire someone'. This executes immediately (no approval) because it only creates a profile — it does not grant system access.",
    parameters: {
      type: "object",
      properties: {
        full_name: { type: "string", description: "Employee's full name." },
        email: { type: "string", description: "Work email. Required — ask the user if not provided." },
        department: { type: "string" },
        job_title: { type: "string" },
        hire_date: { type: "string", description: "YYYY-MM-DD. Defaults to today." },
        salary: { type: "number" },
      },
      required: ["full_name", "email"],
    },
    async handler(args, ctx) {
      // Auto-generate an employee number if not given
      const last = await one<{ n: string }>(
        `SELECT COALESCE(MAX(SUBSTRING(employee_no FROM 'E-(\\d+)')::int), 0) + 1 AS n
           FROM employees WHERE tenant_id = $1`,
        [ctx.tenantId],
      );
      const employeeNo = `E-${String(last?.n ?? 1).padStart(3, "0")}`;

      const row = await one<{ id: number; employee_no: string; full_name: string }>(
        `INSERT INTO employees
           (tenant_id, employee_no, full_name, email, department, job_title, hire_date, salary)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING id, employee_no, full_name`,
        [
          ctx.tenantId,
          employeeNo,
          args.full_name,
          args.email,
          args.department ?? null,
          args.job_title ?? null,
          args.hire_date ?? new Date().toISOString().slice(0, 10),
          args.salary ?? null,
        ],
      );

      await q(
        `INSERT INTO audit_log (tenant_id, user_id, action, detail)
         VALUES ($1,$2,'employee.created',$3)`,
        [ctx.tenantId, ctx.userId, { employee_id: row?.id, employee_no: employeeNo }],
      );

      return {
        status: "CREATED",
        employee_id: row?.id,
        employee_no: employeeNo,
        full_name: row?.full_name,
        message: `Created employee ${employeeNo} (${row?.full_name}).`,
      };
    },
  }),

  tool({
    name: "create_user",
    description:
      "Create a login account for an employee. ADMIN-only. Requires an existing employee_id from create_employee. Assigns a system role (ADMIN, APPROVER, or STAFF) — ask the user which role if unclear. Generates a temporary password and returns it once. This executes immediately because it is admin-gated; it does NOT go through the approval queue.",
    parameters: {
      type: "object",
      properties: {
        employee_id: {
          type: "integer",
          description: "The employee_id returned by create_employee.",
        },
        email: { type: "string", description: "Login email. Usually the same as the employee email." },
        full_name: { type: "string" },
        role: {
          type: "string",
          enum: ["ADMIN", "APPROVER", "STAFF"],
          description: "System role. HR users typically get APPROVER.",
        },
      },
      required: ["employee_id", "email", "full_name", "role"],
    },
    async handler(args, ctx) {
      if (ctx.role !== "ADMIN") {
        return {
          error:
            "Only ADMIN can create user accounts. Ask an administrator to perform this step, or request it through the approval queue.",
        };
      }

      // Verify the employee belongs to this tenant
      const emp = await one<{ id: number; email: string | null }>(
        `SELECT id, email FROM employees WHERE id = $1 AND tenant_id = $2`,
        [args.employee_id, ctx.tenantId],
      );
      if (!emp) return { error: `Employee #${args.employee_id} not found.` };

      // Reject duplicate emails
      const existing = await one(
        `SELECT id FROM users WHERE email = $1`,
        [args.email],
      );
      if (existing) return { error: `A user with email ${args.email} already exists.` };

      // Generate a temporary password and hash it in Postgres (pgcrypto)
      const tempPassword = randomPassword(12);
      const row = await one<{ id: string }>(
        `INSERT INTO users (tenant_id, email, password_hash, full_name, role)
         VALUES ($1,$2, crypt($3, gen_salt('bf')), $4, $5)
         RETURNING id`,
        [ctx.tenantId, args.email, tempPassword, args.full_name, args.role],
      );

      await q(
        `UPDATE employees SET user_id = $1 WHERE id = $2 AND tenant_id = $3`,
        [row?.id, args.employee_id, ctx.tenantId],
      );

      await q(
        `INSERT INTO audit_log (tenant_id, user_id, action, detail)
         VALUES ($1,$2,'user.created',$3)`,
        [ctx.tenantId, ctx.userId, { user_id: row?.id, email: args.email, role: args.role }],
      );

      return {
        status: "CREATED",
        user_id: row?.id,
        email: args.email,
        role: args.role,
        employee_id: args.employee_id,
        temporary_password: tempPassword,
        warning:
          "Return this temporary password to the user exactly once. They must change it on first login.",
      };
    },
  }),
];

function randomPassword(len: number): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}