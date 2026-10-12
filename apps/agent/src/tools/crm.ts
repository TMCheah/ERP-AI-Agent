import { q } from "../db.js";
import { tool } from "./types.js";

export const crmTools = [
  // ---- LEADS ----
  tool({
    name: "list_leads",
    description: "List CRM leads, optional stage filter.",
    parameters: {
      type: "object",
      properties: {
        stage: { type: "string", enum: ["NEW", "QUALIFIED", "PROPOSAL", "WON", "LOST"] },
        search: { type: "string" },
        limit: { type: "integer" },
      },
      required: [],
    },
    async handler(args, ctx) {
      const rows = await q(
        `SELECT id, name, company, email, stage, value, created_at FROM leads
          WHERE tenant_id=$1
            AND ($2::text IS NULL OR stage=$2)
            AND ($3::text IS NULL OR name ILIKE '%'||$3||'%' OR company ILIKE '%'||$3||'%')
          ORDER BY value DESC NULLS LAST LIMIT $4`,
        [ctx.tenantId, args.stage ?? null, args.search ?? null, Math.min(args.limit ?? 25, 100)],
      );
      return { count: rows.length, leads: rows };
    },
  }),

  tool({
    name: "create_lead",
    description: "Create a CRM lead. Master data — immediate.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        company: { type: "string" },
        email: { type: "string" },
        stage: { type: "string", enum: ["NEW", "QUALIFIED", "PROPOSAL", "WON", "LOST"] },
        value: { type: "number" },
      },
      required: ["name"],
    },
    async handler(args, ctx) {
      const rows = await q<any>(
        `INSERT INTO leads (tenant_id, name, company, email, stage, value, owner_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id, name, company, email, stage, value`,
        [
          ctx.tenantId, args.name, args.company ?? null, args.email ?? null,
          args.stage ?? "NEW", args.value ?? 0, ctx.userId,
        ],
      );
      return { status: "CREATED", lead: rows[0] };
    },
  }),

  tool({
    name: "update_lead",
    description: "Update a lead's stage, value, email, or company.",
    parameters: {
      type: "object",
      properties: {
        lead_name: { type: "string" },
        stage: { type: "string", enum: ["NEW", "QUALIFIED", "PROPOSAL", "WON", "LOST"] },
        value: { type: "number" },
        company: { type: "string" },
        email: { type: "string" },
      },
      required: ["lead_name"],
    },
    async handler(args, ctx) {
      const rows = await q<any>(
        `UPDATE leads
            SET stage   = COALESCE($3, stage),
                value   = COALESCE($4, value),
                company = COALESCE($5, company),
                email   = COALESCE($6, email)
          WHERE tenant_id=$1 AND name=$2
          RETURNING id, name, company, email, stage, value`,
        [
          ctx.tenantId, args.lead_name,
          args.stage ?? null, args.value ?? null, args.company ?? null, args.email ?? null,
        ],
      );
      if (!rows.length) return { error: `Lead ${args.lead_name} not found.` };
      return { status: "UPDATED", lead: rows[0] };
    },
  }),

  tool({
    name: "delete_lead",
    description: "Delete a lead by name.",
    parameters: {
      type: "object",
      properties: { lead_name: { type: "string" } },
      required: ["lead_name"],
    },
    async handler(args, ctx) {
      const rows = await q<any>(
        `DELETE FROM leads WHERE tenant_id=$1 AND name=$2 RETURNING id, name`,
        [ctx.tenantId, args.lead_name],
      );
      if (!rows.length) return { error: `Lead ${args.lead_name} not found.` };
      return { status: "DELETED", lead: rows[0] };
    },
  }),

  tool({
    name: "convert_lead_to_customer",
    description:
      "Convert a WON lead into a customer account. Creates a new customer with an auto-generated code and marks the lead WON. Immediate.",
    parameters: {
      type: "object",
      properties: {
        lead_name: { type: "string" },
        customer_code: { type: "string", description: "Optional. Auto-generated as C-### if not provided." },
      },
      required: ["lead_name"],
    },
    async handler(args, ctx) {
      const lead = (await q<any>(
        `SELECT id, name, company, email FROM leads WHERE tenant_id=$1 AND name=$2`,
        [ctx.tenantId, args.lead_name],
      ))[0];
      if (!lead) return { error: `Lead ${args.lead_name} not found.` };

      // Generate code if needed
      let code = args.customer_code;
      if (!code) {
        const last = (await q<any>(
          `SELECT COALESCE(MAX(SUBSTRING(code FROM 'C-(\\d+)')::int), 0) + 1 AS n
             FROM customers WHERE tenant_id=$1`,
          [ctx.tenantId],
        ))[0];
        code = `C-${String(Number(last?.n ?? 1)).padStart(3, "0")}`;
      }

      const cust = (await q<any>(
        `INSERT INTO customers (tenant_id, code, name, email)
         VALUES ($1,$2,$3,$4) RETURNING id, code, name`,
        [ctx.tenantId, code, lead.company ?? lead.name, lead.email ?? null],
      ))[0];

      await q(`UPDATE leads SET stage='WON' WHERE id=$1`, [lead.id]);
      await q(
        `INSERT INTO audit_log (tenant_id, user_id, action, detail) VALUES ($1,$2,'lead.converted',$3)`,
        [ctx.tenantId, ctx.userId, { lead: args.lead_name, customer_code: code }],
      );

      return { status: "CONVERTED", customer: cust, lead_stage: "WON" };
    },
  }),

  // ---- CUSTOMERS ----
  tool({
    name: "list_customers",
    description: "List customers.",
    parameters: {
      type: "object",
      properties: { search: { type: "string" }, limit: { type: "integer" } },
      required: [],
    },
    async handler(args, ctx) {
      const rows = await q(
        `SELECT code, name, email, phone FROM customers
          WHERE tenant_id=$1 AND ($2::text IS NULL OR name ILIKE '%'||$2||'%')
          ORDER BY name LIMIT $3`,
        [ctx.tenantId, args.search ?? null, Math.min(args.limit ?? 25, 100)],
      );
      return { count: rows.length, customers: rows };
    },
  }),

  tool({
    name: "create_customer",
    description: "Create a customer. Master data — immediate.",
    parameters: {
      type: "object",
      properties: {
        code: { type: "string" },
        name: { type: "string" },
        email: { type: "string" },
        phone: { type: "string" },
      },
      required: ["code", "name"],
    },
    async handler(args, ctx) {
      const dup = await q(`SELECT id FROM customers WHERE tenant_id=$1 AND code=$2`, [ctx.tenantId, args.code]);
      if (dup.length) return { error: `Customer code ${args.code} already exists.` };
      const rows = await q<any>(
        `INSERT INTO customers (tenant_id, code, name, email, phone) VALUES ($1,$2,$3,$4,$5)
         RETURNING id, code, name`,
        [ctx.tenantId, args.code, args.name, args.email ?? null, args.phone ?? null],
      );
      return { status: "CREATED", customer: rows[0] };
    },
  }),

  tool({
    name: "update_customer",
    description: "Update a customer's name, email, or phone.",
    parameters: {
      type: "object",
      properties: {
        code: { type: "string" },
        name: { type: "string" },
        email: { type: "string" },
        phone: { type: "string" },
      },
      required: ["code"],
    },
    async handler(args, ctx) {
      const rows = await q<any>(
        `UPDATE customers
            SET name  = COALESCE($3, name),
                email = COALESCE($4, email),
                phone = COALESCE($5, phone)
          WHERE tenant_id=$1 AND code=$2
          RETURNING id, code, name, email, phone`,
        [ctx.tenantId, args.code, args.name ?? null, args.email ?? null, args.phone ?? null],
      );
      if (!rows.length) return { error: `Customer ${args.code} not found.` };
      return { status: "UPDATED", customer: rows[0] };
    },
  }),

  // ---- TICKETS ----
  tool({
    name: "list_tickets",
    description: "List support tickets, optional status filter.",
    parameters: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["OPEN", "IN_PROGRESS", "CLOSED"] },
        assignee_email: { type: "string" },
        limit: { type: "integer" },
      },
      required: [],
    },
    async handler(args, ctx) {
      const rows = await q(
        `SELECT t.id, t.reference, t.subject, t.priority, t.status,
                c.name AS customer, u.full_name AS assignee, t.created_at
           FROM tickets t
           LEFT JOIN customers c ON c.id = t.customer_id
           LEFT JOIN users u ON u.id = t.assignee_id
          WHERE t.tenant_id=$1
            AND ($2::text IS NULL OR t.status=$2)
            AND ($3::text IS NULL OR u.email=$3)
          ORDER BY t.created_at DESC LIMIT $4`,
        [ctx.tenantId, args.status ?? null, args.assignee_email ?? null, Math.min(args.limit ?? 25, 100)],
      );
      return { count: rows.length, tickets: rows };
    },
  }),

  tool({
    name: "create_ticket",
    description: "Create a support ticket. Immediate.",
    parameters: {
      type: "object",
      properties: {
        subject: { type: "string" },
        description: { type: "string" },
        priority: { type: "string", enum: ["LOW", "NORMAL", "HIGH", "URGENT"] },
        customer_code: { type: "string" },
        assignee_email: { type: "string" },
      },
      required: ["subject"],
    },
    async handler(args, ctx) {
      let customerId: number | null = null;
      let assigneeId: string | null = null;
      if (args.customer_code) {
        const c = (await q<any>(`SELECT id FROM customers WHERE tenant_id=$1 AND code=$2`, [ctx.tenantId, args.customer_code]))[0];
        if (!c) return { error: `Customer ${args.customer_code} not found.` };
        customerId = c.id;
      }
      if (args.assignee_email) {
        const u = (await q<any>(`SELECT id FROM users WHERE tenant_id=$1 AND email=$2`, [ctx.tenantId, args.assignee_email]))[0];
        if (!u) return { error: `User ${args.assignee_email} not found.` };
        assigneeId = u.id;
      }
      const ref = `T-${Date.now().toString().slice(-6)}`;
      const rows = await q<any>(
        `INSERT INTO tickets (tenant_id, reference, subject, description, priority, customer_id, assignee_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id, reference, subject, priority, status`,
        [ctx.tenantId, ref, args.subject, args.description ?? null, args.priority ?? "NORMAL", customerId, assigneeId],
      );
      return { status: "CREATED", ticket: rows[0] };
    },
  }),

  tool({
    name: "assign_ticket",
    description: "Assign a ticket to a user by email. Sets status to IN_PROGRESS if currently OPEN.",
    parameters: {
      type: "object",
      properties: {
        reference: { type: "string" },
        assignee_email: { type: "string" },
      },
      required: ["reference", "assignee_email"],
    },
    async handler(args, ctx) {
      const u = (await q<any>(
        `SELECT id, full_name FROM users WHERE tenant_id=$1 AND email=$2`,
        [ctx.tenantId, args.assignee_email],
      ))[0];
      if (!u) return { error: `User ${args.assignee_email} not found.` };
      const rows = await q<any>(
        `UPDATE tickets
            SET assignee_id = $3,
                status = CASE WHEN status = 'OPEN' THEN 'IN_PROGRESS' ELSE status END
          WHERE tenant_id=$1 AND reference=$2
          RETURNING reference, subject, status`,
        [ctx.tenantId, args.reference, u.id],
      );
      if (!rows.length) return { error: `Ticket ${args.reference} not found.` };
      return { status: "ASSIGNED", ticket: rows[0], assignee: u.full_name };
    },
  }),

  tool({
    name: "close_ticket",
    description: "Close a support ticket.",
    parameters: {
      type: "object",
      properties: { reference: { type: "string" } },
      required: ["reference"],
    },
    async handler(args, ctx) {
      const rows = await q<any>(
        `UPDATE tickets SET status='CLOSED' WHERE tenant_id=$1 AND reference=$2
         RETURNING reference, subject, status`,
        [ctx.tenantId, args.reference],
      );
      if (!rows.length) return { error: `Ticket ${args.reference} not found.` };
      return { status: "CLOSED", ticket: rows[0] };
    },
  }),
];