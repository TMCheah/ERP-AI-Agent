import { q } from "./db.js";
import type { ToolCtx } from "./tools/types.js";

export type ModuleCard = {
  id: string;
  kind: string;
  kind_label: string;
  title: string;
  subtitle: string | null;
  status: string;
  bucket: "pending" | "complete" | "draft";
  meta: { label: string; value: string }[];
  created_at: string;
  approval_id: number | null;
};

export async function getModuleCards(
  key: string,
  ctx: ToolCtx,
  bucket: "pending" | "complete" | "all",
): Promise<ModuleCard[]> {
  switch (key) {
    case "procurement":
    case "scm":
      return procurementCards(ctx, bucket);
    case "inventory":
      return inventoryCards(ctx, bucket);
    case "finance":
      return financeCards(ctx, bucket);
    case "hcm":
      return hcmCards(ctx, bucket);
    case "crm":
      return crmCards(ctx, bucket);
    case "manufacturing":
      return manufacturingCards(ctx, bucket);
    case "projects":
      return projectCards(ctx, bucket);
    default:
      return [];
  }
}

// ---------- helpers ----------
function fmtDate(d: any): string {
  if (!d) return "—";
  return new Date(d).toISOString().slice(0, 10);
}
function shortTime(d: any): string {
  if (!d) return "";
  const ms = Date.now() - new Date(d).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  return `${days}d ago`;
}

// ---------- PROCUREMENT ----------
async function procurementCards(ctx: ToolCtx, bucket: string): Promise<ModuleCard[]> {
  const prs = await q<any>(
    `SELECT pr.id, pr.reference, pr.quantity, pr.status, pr.required_by, pr.created_at,
            i.sku, i.name AS item_name,
            u.full_name AS requested_by,
            a.id AS approval_id
       FROM purchase_requisitions pr
       LEFT JOIN items i ON i.id = pr.item_id
       LEFT JOIN users u ON u.id = pr.requested_by
       LEFT JOIN approvals a ON a.kind='purchase_requisition'
         AND a.payload->>'sku' = i.sku
         AND a.payload->>'quantity' = pr.quantity::text
         AND a.status = 'APPROVED'
         AND a.tenant_id = pr.tenant_id
      WHERE pr.tenant_id = $1
      ORDER BY pr.created_at DESC LIMIT 100`,
    [ctx.tenantId],
  );

  const pos = await q<any>(
    `SELECT po.id, po.reference, po.status, po.order_date, po.expected_date, po.created_at,
            v.name AS vendor_name,
            (SELECT COUNT(*) FROM purchase_order_lines l WHERE l.po_id = po.id) AS line_count,
            (SELECT COALESCE(SUM(l.quantity),0) FROM purchase_order_lines l WHERE l.po_id = po.id) AS total_qty
       FROM purchase_orders po
       LEFT JOIN vendors v ON v.id = po.vendor_id
      WHERE po.tenant_id = $1
      ORDER BY po.created_at DESC LIMIT 100`,
    [ctx.tenantId],
  );

  const rows: ModuleCard[] = [];

  for (const pr of prs) {
    const isComplete = ["APPROVED", "CANCELLED"].includes(pr.status);
    rows.push({
      id: `pr-${pr.id}`,
      kind: "PR",
      kind_label: "Purchase Requisition",
      title: `${pr.reference}: ${pr.quantity} × ${pr.sku}`,
      subtitle: pr.item_name,
      status: pr.status,
      bucket: isComplete ? "complete" : "pending",
      meta: [
        { label: "SKU", value: pr.sku },
        { label: "Qty", value: String(pr.quantity) },
        { label: "By", value: fmtDate(pr.required_by) },
        { label: "Requester", value: pr.requested_by ?? "—" },
      ],
      created_at: pr.created_at,
      approval_id: pr.status === "PENDING_APPROVAL" ? pr.approval_id : null,
    });
  }

  for (const po of pos) {
    const isComplete = ["RECEIVED", "CANCELLED"].includes(po.status);
    const bucketOf: "draft" | "pending" | "complete" =
      po.status === "DRAFT" ? "draft" :
      ["RECEIVED", "CANCELLED"].includes(po.status) ? "complete" : "pending";


    rows.push({
      id: `po-${po.id}`,
      kind: "PO",
      kind_label: "Purchase Order",
      title: `${po.reference}: ${po.line_count} line(s)`,
      subtitle: po.vendor_name ? `Vendor: ${po.vendor_name}` : "Vendor not assigned",
      status: po.status,
      bucket: bucketOf,
      meta: [
        { label: "Lines", value: String(po.line_count) },
        { label: "Total Qty", value: String(po.total_qty) },
        { label: "Order", value: fmtDate(po.order_date) },
        { label: "Expected", value: fmtDate(po.expected_date) },
      ],
      created_at: po.created_at,
      approval_id: null,
    });
  }

  return filterBucket(rows, bucket);
}

// ---------- INVENTORY ----------
async function inventoryCards(ctx: ToolCtx, bucket: string): Promise<ModuleCard[]> {
  const items = await q<any>(
    `SELECT i.sku, i.name, i.category, i.unit, i.selling_price, i.reorder_point,
            COALESCE(SUM(s.quantity),0) AS on_hand
       FROM items i
       LEFT JOIN stock s ON s.item_id = i.id
      WHERE i.tenant_id=$1 AND i.deleted_at IS NULL
      GROUP BY i.id
      ORDER BY i.sku LIMIT 200`,
    [ctx.tenantId],
  );

  // Pending adjustments/transfers
  const pendingMoves = await q<any>(
    `SELECT id, kind, summary, status, created_at FROM approvals
      WHERE tenant_id=$1 AND status='PENDING'
        AND kind IN ('stock_adjustment','stock_transfer')
      ORDER BY created_at DESC LIMIT 50`,
    [ctx.tenantId],
  );

  const rows: ModuleCard[] = [];

  for (const it of items) {
    const onHand = Number(it.on_hand);
    const reorder = Number(it.reorder_point);
    const below = reorder > 0 && onHand <= reorder;
    rows.push({
      id: `item-${it.sku}`,
      kind: "ITEM",
      kind_label: "Item",
      title: `${it.sku} — ${it.name}`,
      subtitle: it.category,
      status: below ? "BELOW_REORDER" : "OK",
      bucket: below ? "pending" : "complete",
      meta: [
        { label: "On Hand", value: String(onHand) },
        { label: "Reorder At", value: String(reorder) },
        { label: "Price", value: `$${Number(it.selling_price).toFixed(2)}` },
        { label: "Unit", value: it.unit },
      ],
      created_at: new Date().toISOString(),
      approval_id: null,
    });
  }

  for (const p of pendingMoves) {
    rows.push({
      id: `appr-${p.id}`,
      kind: "APPROVAL",
      kind_label: p.kind === "stock_transfer" ? "Transfer" : "Adjustment",
      title: p.summary,
      subtitle: "Awaiting approval",
      status: "PENDING",
      bucket: "pending",
      meta: [{ label: "Kind", value: p.kind }],
      created_at: p.created_at,
      approval_id: p.id,
    });
  }

  return filterBucket(rows, bucket);
}

// ---------- FINANCE ----------
async function financeCards(ctx: ToolCtx, bucket: string): Promise<ModuleCard[]> {
  const invoices = await q<any>(
    `SELECT i.id, i.number, i.customer, i.amount, i.currency, i.due_date, i.status,
            i.type, i.source, i.source_ref, i.created_at,
            v.name AS vendor_name
       FROM invoices i
       LEFT JOIN vendors v ON v.id = i.vendor_id
      WHERE i.tenant_id=$1
      ORDER BY i.created_at DESC LIMIT 200`,
    [ctx.tenantId],
  );

  const jes = await q<any>(
    `SELECT id, reference, memo, debit_account, credit_account, amount,
            status, source, created_at
       FROM journal_entries
      WHERE tenant_id=$1
      ORDER BY created_at DESC LIMIT 100`,
    [ctx.tenantId],
  );

  const rows: ModuleCard[] = [];

  for (const inv of invoices) {
    const isOverdue = inv.status === "OPEN" && new Date(inv.due_date) < new Date();
    const status =
      inv.status === "DRAFT" ? "DRAFT" :
      inv.status === "PAID" ? "PAID" :
      inv.status === "VOID" ? "VOID" :
      isOverdue ? "OVERDUE" : inv.status;

    const bucketOf: "draft" | "pending" | "complete" =
      inv.status === "DRAFT" ? "draft" :
      inv.status === "PAID" || inv.status === "VOID" ? "complete" : "pending";

    const counterparty = inv.type === "AP" ? (inv.vendor_name ?? "—") : (inv.customer ?? "—");

    rows.push({
      id: `inv-${inv.id}`,
      kind: "INVOICE",
      kind_label: inv.type === "AP" ? "Vendor Bill" : "Invoice",
      title: `${inv.number} — ${counterparty}`,
      subtitle: `${inv.currency} ${Number(inv.amount).toFixed(2)}`,
      status,
      bucket: bucketOf,
      meta: [
        { label: "Amount", value: `${inv.currency} ${Number(inv.amount).toFixed(2)}` },
        { label: "Due", value: new Date(inv.due_date).toISOString().slice(0, 10) },
        ...(inv.source_ref ? [{ label: "Source", value: inv.source_ref }] : []),
      ],
      created_at: inv.created_at,
      approval_id: null,
    });
  }

  for (const je of jes) {
    rows.push({
      id: `je-${je.id}`,
      kind: "JE",
      kind_label: "Journal Entry",
      title: `${je.reference}: Dr ${je.debit_account} / Cr ${je.credit_account}`,
      subtitle: je.memo,
      status: je.status,
      bucket: je.status === "DRAFT" ? "draft" : "complete",
      meta: [
        { label: "Amount", value: `$${Number(je.amount).toFixed(2)}` },
        ...(je.source ? [{ label: "Source", value: je.source }] : []),
      ],
      created_at: je.created_at,
      approval_id: null,
    });
  }

  return filterBucket(rows, bucket);
}

// ---------- HCM ----------
async function hcmCards(ctx: ToolCtx, bucket: string): Promise<ModuleCard[]> {
  const employees = await q<any>(
    `SELECT id, employee_no, full_name, email, department, job_title,
            CASE WHEN deactivated_at IS NULL THEN 'ACTIVE' ELSE 'INACTIVE' END AS status
       FROM employees
      WHERE tenant_id=$1
      ORDER BY employee_no LIMIT 200`,
    [ctx.tenantId],
  );

  const leave = await q<any>(
    `SELECT lr.id, lr.from_date, lr.to_date, lr.reason, lr.status, lr.created_at,
            e.full_name, e.email
       FROM leave_requests lr
       JOIN employees e ON e.id = lr.employee_id
      WHERE lr.tenant_id=$1
      ORDER BY lr.created_at DESC LIMIT 100`,
    [ctx.tenantId],
  );

  const rows: ModuleCard[] = [];

  for (const e of employees) {
    rows.push({
      id: `emp-${e.id}`,
      kind: "EMPLOYEE",
      kind_label: "Employee",
      title: `${e.full_name}`,
      subtitle: `${e.job_title ?? "—"} · ${e.department ?? "—"}`,
      status: e.status,
      bucket: e.status === "ACTIVE" ? "pending" : "complete",
      meta: [
        { label: "No.", value: e.employee_no },
        { label: "Email", value: e.email ?? "—" },
      ],
      created_at: new Date().toISOString(),
      approval_id: null,
    });
  }

  for (const l of leave) {
    const done = ["APPROVED", "REJECTED"].includes(l.status);
    rows.push({
      id: `leave-${l.id}`,
      kind: "LEAVE",
      kind_label: "Leave Request",
      title: `${l.full_name}: ${fmtDate(l.from_date)} → ${fmtDate(l.to_date)}`,
      subtitle: l.reason,
      status: l.status,
      bucket: done ? "complete" : "pending",
      meta: [{ label: "Email", value: l.email ?? "—" }],
      created_at: l.created_at,
      approval_id: null,
    });
  }

  return filterBucket(rows, bucket);
}

// ---------- CRM ----------
async function crmCards(ctx: ToolCtx, bucket: string): Promise<ModuleCard[]> {
  const leads = await q<any>(
    `SELECT id, name, company, email, stage, value, created_at FROM leads
      WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 100`,
    [ctx.tenantId],
  );
  const customers = await q<any>(
    `SELECT id, code, name, email FROM customers
      WHERE tenant_id=$1 AND deleted_at IS NULL ORDER BY name LIMIT 100`,
    [ctx.tenantId],
  );
  const tickets = await q<any>(
    `SELECT t.id, t.reference, t.subject, t.priority, t.status, t.created_at,
            c.name AS customer, u.full_name AS assignee
       FROM tickets t
       LEFT JOIN customers c ON c.id = t.customer_id
       LEFT JOIN users u ON u.id = t.assignee_id
      WHERE t.tenant_id=$1 ORDER BY t.created_at DESC LIMIT 100`,
    [ctx.tenantId],
  );

  const rows: ModuleCard[] = [];

  for (const l of leads) {
    const done = ["WON", "LOST"].includes(l.stage);
    rows.push({
      id: `lead-${l.id}`,
      kind: "LEAD",
      kind_label: "Lead",
      title: `${l.name}${l.company ? ` · ${l.company}` : ""}`,
      subtitle: l.email,
      status: l.stage,
      bucket: done ? "complete" : "pending",
      meta: [{ label: "Value", value: `$${Number(l.value ?? 0).toFixed(2)}` }],
      created_at: l.created_at,
      approval_id: null,
    });
  }

  for (const t of tickets) {
    const done = t.status === "CLOSED";
    rows.push({
      id: `ticket-${t.id}`,
      kind: "TICKET",
      kind_label: "Ticket",
      title: `${t.reference}: ${t.subject}`,
      subtitle: t.customer ? `Customer: ${t.customer}` : null,
      status: t.status,
      bucket: done ? "complete" : "pending",
      meta: [
        { label: "Priority", value: t.priority },
        { label: "Assignee", value: t.assignee ?? "Unassigned" },
      ],
      created_at: t.created_at,
      approval_id: null,
    });
  }

  for (const c of customers) {
    rows.push({
      id: `cust-${c.id}`,
      kind: "CUSTOMER",
      kind_label: "Customer",
      title: `${c.name}`,
      subtitle: c.email,
      status: "ACTIVE",
      bucket: "complete",
      meta: [{ label: "Code", value: c.code }],
      created_at: new Date().toISOString(),
      approval_id: null,
    });
  }

  return filterBucket(rows, bucket);
}

// ---------- MANUFACTURING ----------
async function manufacturingCards(ctx: ToolCtx, bucket: string): Promise<ModuleCard[]> {
  const boms = await q<any>(
    `SELECT b.id, b.name, b.version, i.sku, i.name AS product,
            (SELECT COUNT(*) FROM bom_lines l WHERE l.bom_id = b.id) AS components
       FROM boms b JOIN items i ON i.id = b.product_id
      WHERE b.tenant_id=$1 ORDER BY b.id DESC LIMIT 100`,
    [ctx.tenantId],
  );
  const wos = await q<any>(
    `SELECT id, reference, quantity, status, planned_start, planned_end, created_at
       FROM work_orders WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 100`,
    [ctx.tenantId],
  );

  const rows: ModuleCard[] = [];

  for (const b of boms) {
    rows.push({
      id: `bom-${b.id}`,
      kind: "BOM",
      kind_label: "Bill of Materials",
      title: `${b.sku} — ${b.product}`,
      subtitle: `${b.name} (${b.version})`,
      status: "ACTIVE",
      bucket: "complete",
      meta: [{ label: "Components", value: String(b.components) }],
      created_at: new Date().toISOString(),
      approval_id: null,
    });
  }

  for (const w of wos) {
    const done = w.status === "COMPLETED";
    rows.push({
      id: `wo-${w.id}`,
      kind: "WO",
      kind_label: "Work Order",
      title: `${w.reference}: ${w.quantity} units`,
      subtitle: null,
      status: w.status,
      bucket: done ? "complete" : "pending",
      meta: [
        { label: "Start", value: fmtDate(w.planned_start) },
        { label: "End", value: fmtDate(w.planned_end) },
      ],
      created_at: w.created_at,
      approval_id: null,
    });
  }

  return filterBucket(rows, bucket);
}

// ---------- PROJECTS ----------
async function projectCards(ctx: ToolCtx, bucket: string): Promise<ModuleCard[]> {
  const projects = await q<any>(
    `SELECT p.id, p.code, p.name, p.status, p.budget, p.start_date, p.end_date,
            c.name AS customer,
            (SELECT COUNT(*) FROM project_tasks t WHERE t.project_id = p.id) AS tasks,
            (SELECT COUNT(*) FROM project_tasks t WHERE t.project_id = p.id AND t.status = 'DONE') AS done_tasks
       FROM projects p
       LEFT JOIN customers c ON c.id = p.customer_id
      WHERE p.tenant_id=$1 ORDER BY p.created_at DESC LIMIT 100`,
    [ctx.tenantId],
  );

  return filterBucket(
    projects.map((p) => ({
      id: `proj-${p.id}`,
      kind: "PROJECT",
      kind_label: "Project",
      title: `${p.code} — ${p.name}`,
      subtitle: p.customer ? `Customer: ${p.customer}` : null,
      status: p.status,
      bucket: (p.status === "DONE" ? "complete" : "pending") as "pending" | "complete",
      meta: [
        { label: "Tasks", value: `${p.done_tasks}/${p.tasks}` },
        { label: "Budget", value: p.budget ? `$${Number(p.budget).toFixed(2)}` : "—" },
      ],
      created_at: new Date().toISOString(),
      approval_id: null,
    })),
    bucket,
  );
}

function filterBucket(rows: ModuleCard[], bucket: string): ModuleCard[] {
  const sorted = rows.sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
  if (bucket === "all") return sorted;
  return sorted.filter((r) => r.bucket === bucket);
}

export { shortTime };