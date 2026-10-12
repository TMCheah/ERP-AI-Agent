import { q } from "../db.js";
import { tool } from "./types.js";

export const reportingTools = [
  tool({
    name: "report_inventory_valuation",
    description:
      "Total inventory valuation (quantity × cost price) grouped by category, with a grand total. Use for 'what is my inventory worth'.",
    parameters: {
      type: "object",
      properties: {
        warehouse_code: { type: "string" },
      },
      required: [],
    },
    async handler(args, ctx) {
      const params: any[] = [ctx.tenantId];
      let whFilter = "";
      if (args.warehouse_code) { params.push(args.warehouse_code); whFilter = `AND w.code = $${params.length}`; }

      const rows = await q(
        `SELECT i.category,
                COUNT(DISTINCT i.id) AS sku_count,
                SUM(s.quantity)::numeric AS total_units,
                ROUND(SUM(s.quantity * i.cost_price)::numeric, 2) AS total_cost_value,
                ROUND(SUM(s.quantity * i.selling_price)::numeric, 2) AS total_retail_value
           FROM items i
           LEFT JOIN stock s ON s.item_id = i.id
           LEFT JOIN warehouses w ON w.id = s.warehouse_id ${whFilter}
          WHERE i.tenant_id = $1
          GROUP BY i.category
          ORDER BY total_cost_value DESC NULLS LAST`,
        params,
      );
      const grandCost = rows.reduce((s: number, r: any) => s + Number(r.total_cost_value ?? 0), 0);
      return { report: "inventory_valuation", grand_total_cost: grandCost, rows };
    },
  }),

  tool({
    name: "report_ar_aging",
    description:
      "Accounts receivable aging report. Buckets unpaid invoices into Current, 1-30, 31-60, 61-90, and 90+ days past due.",
    parameters: { type: "object", properties: {}, required: [] },
    async handler(_args, ctx) {
      const rows = await q(
        `SELECT
           CASE
             WHEN due_date >= CURRENT_DATE THEN 'Current'
             WHEN CURRENT_DATE - due_date <= 30 THEN '1-30 days'
             WHEN CURRENT_DATE - due_date <= 60 THEN '31-60 days'
             WHEN CURRENT_DATE - due_date <= 90 THEN '61-90 days'
             ELSE '90+ days'
           END AS bucket,
           COUNT(*) AS invoice_count,
           ROUND(SUM(amount)::numeric, 2) AS total_amount
         FROM invoices
        WHERE tenant_id=$1 AND status <> 'PAID' AND status <> 'VOID'
        GROUP BY bucket
        ORDER BY
          CASE bucket
            WHEN 'Current' THEN 1
            WHEN '1-30 days' THEN 2
            WHEN '31-60 days' THEN 3
            WHEN '61-90 days' THEN 4
            ELSE 5
          END`,
        [ctx.tenantId],
      );
      const grand = rows.reduce((s: number, r: any) => s + Number(r.total_amount ?? 0), 0);
      return { report: "ar_aging", grand_total: grand, buckets: rows };
    },
  }),

  tool({
    name: "report_trial_balance",
    description:
      "Trial balance. Sums all journal entry debits and credits per account, and includes the chart of accounts. Useful for 'what's the trial balance'.",
    parameters: { type: "object", properties: {}, required: [] },
    async handler(_args, ctx) {
      const rows = await q(
        `WITH debits AS (
           SELECT debit_account AS code, SUM(amount) AS dr FROM journal_entries
            WHERE tenant_id=$1 GROUP BY debit_account
         ), credits AS (
           SELECT credit_account AS code, SUM(amount) AS cr FROM journal_entries
            WHERE tenant_id=$1 GROUP BY credit_account
         )
         SELECT a.code, a.name, a.type,
                COALESCE(d.dr, 0)::numeric AS total_debit,
                COALESCE(c.cr, 0)::numeric AS total_credit
           FROM gl_accounts a
           LEFT JOIN debits d ON d.code = a.code
           LEFT JOIN credits c ON c.code = a.code
          WHERE a.tenant_id=$1
          ORDER BY a.code`,
        [ctx.tenantId],
      );
      const totals = rows.reduce(
        (s: any, r: any) => ({
          debit: s.debit + Number(r.total_debit),
          credit: s.credit + Number(r.total_credit),
        }),
        { debit: 0, credit: 0 },
      );
      return { report: "trial_balance", totals, accounts: rows };
    },
  }),

  tool({
    name: "report_headcount",
    description: "Headcount by department with total salary cost.",
    parameters: { type: "object", properties: {}, required: [] },
    async handler(_args, ctx) {
      const rows = await q(
        `SELECT COALESCE(department, 'Unassigned') AS department,
                COUNT(*) AS headcount,
                ROUND(SUM(COALESCE(salary,0))::numeric, 2) AS total_salary,
                ROUND(AVG(COALESCE(salary,0))::numeric, 2) AS avg_salary
           FROM employees
          WHERE tenant_id=$1 AND deactivated_at IS NULL
          GROUP BY department
          ORDER BY headcount DESC`,
        [ctx.tenantId],
      );
      const total = rows.reduce((s: number, r: any) => s + Number(r.headcount), 0);
      return { report: "headcount", total_employees: total, rows };
    },
  }),

  tool({
    name: "report_low_stock",
    description:
      "Items at or below reorder point, aggregated across warehouses. Use for 'what needs reordering'.",
    parameters: { type: "object", properties: {}, required: [] },
    async handler(_args, ctx) {
      const rows = await q(
        `SELECT i.sku, i.name, i.reorder_point,
                COALESCE(SUM(s.quantity),0) AS on_hand,
                i.reorder_point - COALESCE(SUM(s.quantity),0) AS shortfall
           FROM items i
           LEFT JOIN stock s ON s.item_id = i.id
          WHERE i.tenant_id=$1
          GROUP BY i.id
          HAVING i.reorder_point > 0 AND COALESCE(SUM(s.quantity),0) <= i.reorder_point
          ORDER BY shortfall DESC`,
        [ctx.tenantId],
      );
      return { report: "low_stock", count: rows.length, items: rows };
    },
  }),

  tool({
    name: "report_sales_pipeline",
    description:
      "CRM pipeline summary: count and total value of leads grouped by stage.",
    parameters: { type: "object", properties: {}, required: [] },
    async handler(_args, ctx) {
      const rows = await q(
        `SELECT stage, COUNT(*) AS lead_count, ROUND(SUM(COALESCE(value,0))::numeric, 2) AS total_value
           FROM leads
          WHERE tenant_id=$1
          GROUP BY stage
          ORDER BY CASE stage WHEN 'NEW' THEN 1 WHEN 'QUALIFIED' THEN 2 WHEN 'PROPOSAL' THEN 3 WHEN 'WON' THEN 4 ELSE 5 END`,
        [ctx.tenantId],
      );
      const open = rows.filter((r: any) => r.stage !== "WON" && r.stage !== "LOST")
        .reduce((s: number, r: any) => s + Number(r.total_value ?? 0), 0);
      return { report: "sales_pipeline", open_pipeline_value: open, rows };
    },
  }),
];