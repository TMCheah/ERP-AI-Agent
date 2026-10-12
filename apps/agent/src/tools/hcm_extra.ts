import { q } from "../db.js";
import { tool } from "./types.js";
import { ref } from "./helpers.js";

async function findEmployee(ctx: any, email: string) {
  return (await q<any>(
    `SELECT id, full_name FROM employees WHERE tenant_id=$1 AND email=$2`,
    [ctx.tenantId, email],
  ))[0];
}

export const hcmExtraTools = [
  // ---------- Time & attendance ----------
  tool({
    name: "clock_in",
    description: "Clock in an employee (by email). Immediate.",
    parameters: {
      type: "object",
      properties: { employee_email: { type: "string" }, note: { type: "string" } },
      required: ["employee_email"],
    },
    async handler(args, ctx) {
      const e = await findEmployee(ctx, args.employee_email);
      if (!e) return { error: `Employee ${args.employee_email} not found.` };
      const open = (await q(`SELECT id FROM time_entries WHERE employee_id=$1 AND clock_out IS NULL`, [e.id]))[0];
      if (open) return { error: `${e.full_name} is already clocked in.` };
      const row = (await q<any>(
        `INSERT INTO time_entries (tenant_id, employee_id, note) VALUES ($1,$2,$3)
         RETURNING id, clock_in`,
        [ctx.tenantId, e.id, args.note ?? null],
      ))[0];
      return { status: "CLOCKED_IN", employee: e.full_name, entry_id: row.id, clock_in: row.clock_in };
    },
  }),

  tool({
    name: "clock_out",
    description: "Clock out the currently-open time entry for an employee.",
    parameters: {
      type: "object",
      properties: { employee_email: { type: "string" } },
      required: ["employee_email"],
    },
    async handler(args, ctx) {
      const e = await findEmployee(ctx, args.employee_email);
      if (!e) return { error: `Employee ${args.employee_email} not found.` };
      const row = (await q<any>(
        `UPDATE time_entries SET clock_out=now()
          WHERE id = (SELECT id FROM time_entries WHERE employee_id=$1 AND clock_out IS NULL ORDER BY clock_in DESC LIMIT 1)
          RETURNING id, clock_in, clock_out`,
        [e.id],
      ))[0];
      if (!row) return { error: `${e.full_name} has no open clock-in.` };
      const hours = (new Date(row.clock_out).getTime() - new Date(row.clock_in).getTime()) / 3_600_000;
      return {
        status: "CLOCKED_OUT",
        employee: e.full_name,
        hours: Math.round(hours * 100) / 100,
      };
    },
  }),

  tool({
    name: "log_timesheet",
    description: "Log a timesheet entry for an employee for a given week.",
    parameters: {
      type: "object",
      properties: {
        employee_email: { type: "string" },
        week_start: { type: "string", description: "YYYY-MM-DD, Monday." },
        hours: { type: "number" },
      },
      required: ["employee_email", "week_start", "hours"],
    },
    async handler(args, ctx) {
      const e = await findEmployee(ctx, args.employee_email);
      if (!e) return { error: `Employee ${args.employee_email} not found.` };
      const row = (await q<any>(
        `INSERT INTO timesheets (tenant_id, employee_id, week_start, hours)
         VALUES ($1,$2,$3,$4) RETURNING id, week_start, hours, status`,
        [ctx.tenantId, e.id, args.week_start, args.hours],
      ))[0];
      return { status: "LOGGED", timesheet: row };
    },
  }),

  tool({
    name: "list_time_entries",
    description: "List recent time entries, optional employee filter.",
    parameters: {
      type: "object",
      properties: {
        employee_email: { type: "string" },
        limit: { type: "integer" },
      },
      required: [],
    },
    async handler(args, ctx) {
      const params: any[] = [ctx.tenantId];
      let extra = "";
      if (args.employee_email) { params.push(args.employee_email); extra = `AND e.email = $${params.length}`; }
      params.push(Math.min(args.limit ?? 50, 200));
      const rows = await q(
        `SELECT e.full_name, e.email, t.clock_in, t.clock_out, t.note
           FROM time_entries t JOIN employees e ON e.id = t.employee_id
          WHERE t.tenant_id=$1 ${extra}
          ORDER BY t.clock_in DESC LIMIT $${params.length}`,
        params,
      );
      return { count: rows.length, entries: rows };
    },
  }),

  // ---------- Recruitment ----------
  tool({
    name: "create_job_opening",
    description: "Open a new job requisition. Immediate.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        department: { type: "string" },
      },
      required: ["title"],
    },
    async handler(args, ctx) {
      const row = (await q<any>(
        `INSERT INTO job_openings (tenant_id, reference, title, department)
         VALUES ($1,$2,$3,$4) RETURNING id, reference, title, status`,
        [ctx.tenantId, ref("JOB", 4), args.title, args.department ?? null],
      ))[0];
      return { status: "CREATED", job: row };
    },
  }),

  tool({
    name: "list_job_openings",
    description: "List job openings, optional status filter.",
    parameters: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["OPEN", "CLOSED", "FILLED"] },
        limit: { type: "integer" },
      },
      required: [],
    },
    async handler(args, ctx) {
      const rows = await q(
        `SELECT j.reference, j.title, j.department, j.status,
                (SELECT COUNT(*) FROM applicants a WHERE a.job_id = j.id) AS applicants
           FROM job_openings j
          WHERE j.tenant_id=$1 AND ($2::text IS NULL OR j.status=$2)
          ORDER BY j.posted_at DESC LIMIT $3`,
        [ctx.tenantId, args.status ?? null, Math.min(args.limit ?? 25, 100)],
      );
      return { count: rows.length, jobs: rows };
    },
  }),

  tool({
    name: "add_applicant",
    description: "Add an applicant to a job opening (by job reference like JOB-1234).",
    parameters: {
      type: "object",
      properties: {
        job_reference: { type: "string" },
        full_name: { type: "string" },
        email: { type: "string" },
        notes: { type: "string" },
      },
      required: ["job_reference", "full_name"],
    },
    async handler(args, ctx) {
      const job = (await q<any>(
        `SELECT id FROM job_openings WHERE tenant_id=$1 AND reference=$2`,
        [ctx.tenantId, args.job_reference],
      ))[0];
      if (!job) return { error: `Job ${args.job_reference} not found.` };
      const row = (await q<any>(
        `INSERT INTO applicants (tenant_id, job_id, full_name, email, notes)
         VALUES ($1,$2,$3,$4,$5) RETURNING id, full_name, status`,
        [ctx.tenantId, job.id, args.full_name, args.email ?? null, args.notes ?? null],
      ))[0];
      return { status: "CREATED", applicant: row };
    },
  }),

  tool({
    name: "update_applicant_status",
    description: "Move an applicant through the pipeline. Identify by name and job reference.",
    parameters: {
      type: "object",
      properties: {
        job_reference: { type: "string" },
        applicant_name: { type: "string" },
        status: { type: "string", enum: ["APPLIED", "SCREENING", "INTERVIEW", "OFFER", "HIRED", "REJECTED"] },
      },
      required: ["job_reference", "applicant_name", "status"],
    },
    async handler(args, ctx) {
      const rows = await q<any>(
        `UPDATE applicants a
            SET status=$4
           FROM job_openings j
          WHERE a.job_id=j.id AND a.tenant_id=$1 AND j.reference=$2 AND a.full_name=$3
          RETURNING a.id, a.full_name, a.status`,
        [ctx.tenantId, args.job_reference, args.applicant_name, args.status],
      );
      if (!rows.length) return { error: `Applicant "${args.applicant_name}" on ${args.job_reference} not found.` };
      return { status: "UPDATED", applicant: rows[0] };
    },
  }),

  tool({
    name: "hire_applicant",
    description:
      "Convert a hired applicant into a real employee. Creates an employee record, marks the applicant HIRED, and marks the job FILLED if no other applicants remain in INTERVIEW/OFFER.",
    parameters: {
      type: "object",
      properties: {
        job_reference: { type: "string" },
        applicant_name: { type: "string" },
        department: { type: "string" },
        job_title: { type: "string" },
        salary: { type: "number" },
      },
      required: ["job_reference", "applicant_name"],
    },
    async handler(args, ctx) {
      const row = (await q<any>(
        `SELECT a.id, a.full_name, a.email, j.id AS job_id
           FROM applicants a JOIN job_openings j ON j.id = a.job_id
          WHERE a.tenant_id=$1 AND j.reference=$2 AND a.full_name=$3`,
        [ctx.tenantId, args.job_reference, args.applicant_name],
      ))[0];
      if (!row) return { error: `Applicant "${args.applicant_name}" on ${args.job_reference} not found.` };

      const last = (await q<any>(
        `SELECT COALESCE(MAX(SUBSTRING(employee_no FROM 'E-(\\d+)')::int), 0) + 1 AS n
           FROM employees WHERE tenant_id=$1`,
        [ctx.tenantId],
      ))[0];
      const employeeNo = `E-${String(Number(last?.n ?? 1)).padStart(3, "0")}`;

      const emp = (await q<any>(
        `INSERT INTO employees (tenant_id, employee_no, full_name, email, department, job_title, hire_date, salary)
         VALUES ($1,$2,$3,$4,$5,$6,CURRENT_DATE,$7) RETURNING id, employee_no`,
        [
          ctx.tenantId, employeeNo, row.full_name, row.email ?? null,
          args.department ?? null, args.job_title ?? null, args.salary ?? null,
        ],
      ))[0];

      await q(`UPDATE applicants SET status='HIRED' WHERE id=$1`, [row.id]);

      // Mark job FILLED if no other candidate is in late-stage
      const others = (await q<any>(
        `SELECT COUNT(*) AS n FROM applicants WHERE job_id=$1 AND status IN ('INTERVIEW','OFFER')`,
        [row.job_id],
      ))[0];
      if (Number(others.n) === 0) await q(`UPDATE job_openings SET status='FILLED' WHERE id=$1`, [row.job_id]);

      return { status: "HIRED", employee: emp, employee_no: employeeNo };
    },
  }),

  // ---------- Performance ----------
  tool({
    name: "create_performance_review",
    description: "Record a performance review for an employee.",
    parameters: {
      type: "object",
      properties: {
        employee_email: { type: "string" },
        period: { type: "string", description: "e.g. '2026-Q1' or '2026-H1'." },
        rating: { type: "integer", minimum: 1, maximum: 5 },
        comments: { type: "string" },
      },
      required: ["employee_email", "period", "rating"],
    },
    async handler(args, ctx) {
      const e = await findEmployee(ctx, args.employee_email);
      if (!e) return { error: `Employee ${args.employee_email} not found.` };
      const row = (await q<any>(
        `INSERT INTO performance_reviews (tenant_id, employee_id, reviewer_id, period, rating, comments)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING id, period, rating`,
        [ctx.tenantId, e.id, ctx.userId, args.period, args.rating, args.comments ?? null],
      ))[0];
      return { status: "CREATED", review: row, employee: e.full_name };
    },
  }),

  tool({
    name: "list_performance_reviews",
    description: "List performance reviews, optional employee filter.",
    parameters: {
      type: "object",
      properties: {
        employee_email: { type: "string" },
        limit: { type: "integer" },
      },
      required: [],
    },
    async handler(args, ctx) {
      const params: any[] = [ctx.tenantId];
      let extra = "";
      if (args.employee_email) { params.push(args.employee_email); extra = `AND e.email = $${params.length}`; }
      params.push(Math.min(args.limit ?? 50, 200));
      const rows = await q(
        `SELECT e.full_name, e.department, pr.period, pr.rating, pr.comments,
                u.full_name AS reviewer, pr.created_at
           FROM performance_reviews pr
           JOIN employees e ON e.id = pr.employee_id
           LEFT JOIN users u ON u.id = pr.reviewer_id
          WHERE pr.tenant_id=$1 ${extra}
          ORDER BY pr.created_at DESC LIMIT $${params.length}`,
        params,
      );
      return { count: rows.length, reviews: rows };
    },
  }),
];