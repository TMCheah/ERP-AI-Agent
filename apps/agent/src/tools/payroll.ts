import { one, q } from "../db.js";
import { tool } from "./types.js";
import { ref } from "./helpers.js";

const TAX_RATE = 0.11;  // 11% flat (demo — replace with real tax tables)

export const payrollTools = [
  tool({
    name: "create_payroll_run",
    description:
      "Generate a payroll run for a period. Creates one payslip per active employee using their monthly salary, applies flat tax and zero deductions. Gated: queued for approval since payroll commits money.",
    parameters: {
      type: "object",
      properties: {
        period_start: { type: "string", description: "YYYY-MM-DD" },
        period_end: { type: "string", description: "YYYY-MM-DD" },
      },
      required: ["period_start", "period_end"],
    },
    async handler(args, ctx) {
      if (ctx.role === "STAFF") return { error: "Only APPROVER or ADMIN can run payroll." };

      const employees = await q<any>(
        `SELECT id, full_name, COALESCE(salary,0) AS salary
           FROM employees
          WHERE tenant_id=$1 AND deactivated_at IS NULL AND salary IS NOT NULL`,
        [ctx.tenantId],
      );
      if (!employees.length) return { error: "No active employees with salaries." };

      const run = (await q<any>(
        `INSERT INTO payroll_runs (tenant_id, reference, period_start, period_end, status)
         VALUES ($1,$2,$3,$4,'DRAFT') RETURNING id, reference`,
        [ctx.tenantId, ref("PRUN"), args.period_start, args.period_end],
      ))[0];

      let grossTotal = 0;
      let netTotal = 0;
      for (const e of employees) {
        const gross = Number(e.salary);
        const tax = Math.round(gross * TAX_RATE * 100) / 100;
        const net = gross - tax;
        grossTotal += gross;
        netTotal += net;
        await q(
          `INSERT INTO payslips (tenant_id, payroll_run_id, employee_id, gross, tax, deductions, net)
           VALUES ($1,$2,$3,$4,$5,0,$6)`,
          [ctx.tenantId, run.id, e.id, gross, tax, net],
        );
      }
      await q(
        `UPDATE payroll_runs SET total_gross=$2, total_net=$3 WHERE id=$1`,
        [run.id, grossTotal, netTotal],
      );
      await q(
        `INSERT INTO audit_log (tenant_id, user_id, action, detail) VALUES ($1,$2,'payroll.run.created',$3)`,
        [ctx.tenantId, ctx.userId, { reference: run.reference, employees: employees.length }],
      );

      return {
        status: "CREATED",
        payroll_run: run.reference,
        employees: employees.length,
        total_gross: grossTotal,
        total_net: netTotal,
        message: `Payroll run ${run.reference} created for ${employees.length} employees. Total net: ${netTotal}.`,
      };
    },
  }),

  tool({
    name: "list_payroll_runs",
    description: "List payroll runs.",
    parameters: {
      type: "object",
      properties: { status: { type: "string" }, limit: { type: "integer" } },
      required: [],
    },
    async handler(args, ctx) {
      const rows = await q(
        `SELECT reference, period_start, period_end, status, total_gross, total_net, created_at
           FROM payroll_runs
          WHERE tenant_id=$1 AND ($2::text IS NULL OR status=$2)
          ORDER BY created_at DESC LIMIT $3`,
        [ctx.tenantId, args.status ?? null, Math.min(args.limit ?? 25, 100)],
      );
      return { count: rows.length, payroll_runs: rows };
    },
  }),

  tool({
    name: "list_payslips",
    description: "List payslips for a payroll run (by reference) or for an employee (by email).",
    parameters: {
      type: "object",
      properties: {
        payroll_run_reference: { type: "string" },
        employee_email: { type: "string" },
        limit: { type: "integer" },
      },
      required: [],
    },
    async handler(args, ctx) {
      const params: any[] = [ctx.tenantId];
      const filters: string[] = [];
      if (args.payroll_run_reference) {
        params.push(args.payroll_run_reference);
        filters.push(`pr.reference = $${params.length}`);
      }
      if (args.employee_email) {
        params.push(args.employee_email);
        filters.push(`e.email = $${params.length}`);
      }
      params.push(Math.min(args.limit ?? 50, 200));
      const where = filters.length ? `AND ${filters.join(" AND ")}` : "";

      const rows = await q(
        `SELECT pr.reference AS payroll_run, pr.period_start, pr.period_end,
                e.employee_no, e.full_name, e.email,
                ps.gross, ps.tax, ps.deductions, ps.net, ps.paid_at
           FROM payslips ps
           JOIN payroll_runs pr ON pr.id = ps.payroll_run_id
           JOIN employees e ON e.id = ps.employee_id
          WHERE ps.tenant_id=$1 ${where}
          ORDER BY pr.period_end DESC, e.full_name
          LIMIT $${params.length}`,
        params,
      );
      return { count: rows.length, payslips: rows };
    },
  }),

  tool({
    name: "mark_payroll_paid",
    description: "Mark a payroll run as PAID and stamp paid_at on all its payslips.",
    parameters: {
      type: "object",
      properties: { reference: { type: "string" } },
      required: ["reference"],
    },
    async handler(args, ctx) {
      if (ctx.role === "STAFF") return { error: "Only APPROVER or ADMIN can mark payroll paid." };
      const run = (await q<any>(
        `SELECT id FROM payroll_runs WHERE tenant_id=$1 AND reference=$2`,
        [ctx.tenantId, args.reference],
      ))[0];
      if (!run) return { error: `Payroll run ${args.reference} not found.` };
      await q(`UPDATE payroll_runs SET status='PAID' WHERE id=$1`, [run.id]);
      await q(`UPDATE payslips SET paid_at=now() WHERE payroll_run_id=$1`, [run.id]);
      return { status: "PAID", reference: args.reference };
    },
  }),
];