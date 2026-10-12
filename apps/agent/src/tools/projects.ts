import { q } from "../db.js";
import { tool } from "./types.js";

export const projectTools = [
  tool({
    name: "list_projects",
    description: "List projects, optional status filter.",
    parameters: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["ACTIVE", "ON_HOLD", "DONE"] },
        limit: { type: "integer" },
      },
      required: [],
    },
    async handler(args, ctx) {
      const rows = await q(
        `SELECT p.code, p.name, p.status, p.budget, p.start_date, p.end_date,
                c.name AS customer,
                (SELECT COUNT(*) FROM project_tasks t WHERE t.project_id = p.id) AS tasks
           FROM projects p LEFT JOIN customers c ON c.id = p.customer_id
          WHERE p.tenant_id=$1 AND ($2::text IS NULL OR p.status=$2)
          ORDER BY p.created_at DESC LIMIT $3`,
        [ctx.tenantId, args.status ?? null, Math.min(args.limit ?? 25, 100)],
      );
      return { count: rows.length, projects: rows };
    },
  }),

  tool({
    name: "create_project",
    description: "Create a project. Immediate.",
    parameters: {
      type: "object",
      properties: {
        code: { type: "string" },
        name: { type: "string" },
        customer_code: { type: "string" },
        budget: { type: "number" },
        start_date: { type: "string" },
        end_date: { type: "string" },
      },
      required: ["code", "name"],
    },
    async handler(args, ctx) {
      let customerId: number | null = null;
      if (args.customer_code) {
        const c = (await q<any>(`SELECT id FROM customers WHERE tenant_id=$1 AND code=$2`, [ctx.tenantId, args.customer_code]))[0];
        if (!c) return { error: `Customer ${args.customer_code} not found.` };
        customerId = c.id;
      }
      const rows = await q<any>(
        `INSERT INTO projects (tenant_id, code, name, customer_id, budget, start_date, end_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, code, name, status`,
        [ctx.tenantId, args.code, args.name, customerId, args.budget ?? null,
         args.start_date ?? null, args.end_date ?? null],
      );
      return { status: "CREATED", project: rows[0] };
    },
  }),

  tool({
    name: "update_project",
    description: "Update a project's name, status, budget, or dates.",
    parameters: {
      type: "object",
      properties: {
        code: { type: "string" },
        name: { type: "string" },
        status: { type: "string", enum: ["ACTIVE", "ON_HOLD", "DONE"] },
        budget: { type: "number" },
        end_date: { type: "string" },
      },
      required: ["code"],
    },
    async handler(args, ctx) {
      const rows = await q<any>(
        `UPDATE projects
            SET name     = COALESCE($3, name),
                status   = COALESCE($4, status),
                budget   = COALESCE($5, budget),
                end_date = COALESCE($6, end_date)
          WHERE tenant_id=$1 AND code=$2
          RETURNING id, code, name, status, budget, start_date, end_date`,
        [
          ctx.tenantId, args.code,
          args.name ?? null, args.status ?? null,
          args.budget ?? null, args.end_date ?? null,
        ],
      );
      if (!rows.length) return { error: `Project ${args.code} not found.` };
      return { status: "UPDATED", project: rows[0] };
    },
  }),

  tool({
    name: "list_project_tasks",
    description: "List tasks for a project.",
    parameters: {
      type: "object",
      properties: {
        project_code: { type: "string" },
        status: { type: "string", enum: ["TODO", "IN_PROGRESS", "DONE"] },
        limit: { type: "integer" },
      },
      required: ["project_code"],
    },
    async handler(args, ctx) {
      const rows = await q(
        `SELECT t.id, t.title, t.status, t.due_date, t.hours_logged, u.full_name AS assignee
           FROM project_tasks t
           LEFT JOIN users u ON u.id = t.assignee_id
           JOIN projects p ON p.id = t.project_id
          WHERE t.tenant_id=$1 AND p.code=$2
            AND ($3::text IS NULL OR t.status=$3)
          ORDER BY t.due_date NULLS LAST LIMIT $4`,
        [ctx.tenantId, args.project_code, args.status ?? null, Math.min(args.limit ?? 50, 200)],
      );
      return { count: rows.length, tasks: rows };
    },
  }),

  tool({
    name: "add_project_task",
    description: "Add a task to a project.",
    parameters: {
      type: "object",
      properties: {
        project_code: { type: "string" },
        title: { type: "string" },
        due_date: { type: "string" },
        assignee_email: { type: "string" },
      },
      required: ["project_code", "title"],
    },
    async handler(args, ctx) {
      const p = (await q<any>(`SELECT id FROM projects WHERE tenant_id=$1 AND code=$2`, [ctx.tenantId, args.project_code]))[0];
      if (!p) return { error: `Project ${args.project_code} not found.` };
      let assigneeId: string | null = ctx.userId;
      if (args.assignee_email) {
        const u = (await q<any>(`SELECT id FROM users WHERE tenant_id=$1 AND email=$2`, [ctx.tenantId, args.assignee_email]))[0];
        if (!u) return { error: `User ${args.assignee_email} not found.` };
        assigneeId = u.id;
      }
      const rows = await q<any>(
        `INSERT INTO project_tasks (tenant_id, project_id, title, due_date, assignee_id)
         VALUES ($1,$2,$3,$4,$5) RETURNING id, title, status, due_date`,
        [ctx.tenantId, p.id, args.title, args.due_date ?? null, assigneeId],
      );
      return { status: "CREATED", task: rows[0] };
    },
  }),

  tool({
    name: "update_project_task",
    description: "Update a project task's title, status, or due date.",
    parameters: {
      type: "object",
      properties: {
        project_code: { type: "string" },
        task_title: { type: "string" },
        new_title: { type: "string" },
        status: { type: "string", enum: ["TODO", "IN_PROGRESS", "DONE"] },
        due_date: { type: "string" },
      },
      required: ["project_code", "task_title"],
    },
    async handler(args, ctx) {
      const rows = await q<any>(
        `UPDATE project_tasks t
            SET title    = COALESCE($4, t.title),
                status   = COALESCE($5, t.status),
                due_date = COALESCE($6, t.due_date)
           FROM projects p
          WHERE t.project_id = p.id AND t.tenant_id=$1 AND p.code=$2 AND t.title=$3
          RETURNING t.id, t.title, t.status, t.due_date`,
        [
          ctx.tenantId, args.project_code, args.task_title,
          args.new_title ?? null, args.status ?? null, args.due_date ?? null,
        ],
      );
      if (!rows.length) return { error: `Task "${args.task_title}" on ${args.project_code} not found.` };
      return { status: "UPDATED", task: rows[0] };
    },
  }),

  tool({
    name: "complete_project_task",
    description: "Mark a project task as DONE.",
    parameters: {
      type: "object",
      properties: {
        project_code: { type: "string" },
        task_title: { type: "string" },
      },
      required: ["project_code", "task_title"],
    },
    async handler(args, ctx) {
      const rows = await q<any>(
        `UPDATE project_tasks t SET status='DONE'
           FROM projects p
          WHERE t.project_id = p.id AND t.tenant_id=$1 AND p.code=$2 AND t.title=$3
          RETURNING t.id, t.title, t.status`,
        [ctx.tenantId, args.project_code, args.task_title],
      );
      if (!rows.length) return { error: `Task "${args.task_title}" on ${args.project_code} not found.` };
      return { status: "COMPLETED", task: rows[0] };
    },
  }),

  tool({
    name: "delete_project_task",
    description: "Delete a project task.",
    parameters: {
      type: "object",
      properties: {
        project_code: { type: "string" },
        task_title: { type: "string" },
      },
      required: ["project_code", "task_title"],
    },
    async handler(args, ctx) {
      const rows = await q<any>(
        `DELETE FROM project_tasks t
           USING projects p
          WHERE t.project_id = p.id AND t.tenant_id=$1 AND p.code=$2 AND t.title=$3
          RETURNING t.id, t.title`,
        [ctx.tenantId, args.project_code, args.task_title],
      );
      if (!rows.length) return { error: `Task "${args.task_title}" on ${args.project_code} not found.` };
      return { status: "DELETED", task: rows[0] };
    },
  }),

  tool({
    name: "log_time",
    description: "Log hours against a project task.",
    parameters: {
      type: "object",
      properties: {
        project_code: { type: "string" },
        task_title: { type: "string" },
        hours: { type: "number" },
      },
      required: ["project_code", "task_title", "hours"],
    },
    async handler(args, ctx) {
      const rows = await q<any>(
        `UPDATE project_tasks t SET hours_logged = t.hours_logged + $3
           FROM projects p
          WHERE t.project_id = p.id AND t.tenant_id=$1 AND p.code=$2 AND t.title=$3
          RETURNING t.id, t.title, t.hours_logged`,
        [ctx.tenantId, args.project_code, args.task_title, args.hours],
      );
      if (!rows.length) return { error: `Task "${args.task_title}" on ${args.project_code} not found.` };
      return { status: "LOGGED", task: rows[0] };
    },
  }),
];