import { q } from "./db.js";
import type { ToolCtx } from "./tools/types.js";

export type DraftRow = {
  id: string;
  kind: string;
  kind_label: string;
  title: string;
  subtitle: string | null;
  module: string;
  meta: { label: string; value: string }[];
  created_at: string;
  source_ref: string | null;
};

export async function listAllDrafts(ctx: ToolCtx): Promise<DraftRow[]> {
  const rows: DraftRow[] = [];

  // ---------- POs in DRAFT ----------
  const pos = await q<any>(
    `SELECT po.id, po.reference, po.notes, po.order_date, po.created_at,
            v.name AS vendor_name,
            (SELECT COUNT(*) FROM purchase_order_lines l WHERE l.po_id=po.id) AS lines,
            (SELECT COALESCE(SUM(l.quantity),0) FROM purchase_order_lines l WHERE l.po_id=po.id) AS total_qty
       FROM purchase_orders po
       LEFT JOIN vendors v ON v.id = po.vendor_id
      WHERE po.tenant_id=$1 AND po.status='DRAFT'
      ORDER BY po.created_at DESC LIMIT 100`,
    [ctx.tenantId],
  );
  for (const p of pos) {
    rows.push({
      id: `po-${p.id}`,
      kind: "PO",
      kind_label: "Purchase Order",
      title: `${p.reference}: ${p.lines} line(s)`,
      subtitle: p.vendor_name ? `Vendor: ${p.vendor_name}` : "Vendor not assigned",
      module: "procurement",
      meta: [
        { label: "Total Qty", value: String(p.total_qty) },
        { label: "Ordered", value: new Date(p.order_date).toISOString().slice(0, 10) },
      ],
      created_at: p.created_at,
      source_ref: p.notes,
    });
  }

  // ---------- Invoices in DRAFT ----------
  const invoices = await q<any>(
    `SELECT i.id, i.number, i.customer, i.amount, i.currency, i.due_date,
            i.type, i.source, i.source_ref, i.created_at,
            v.name AS vendor_name
       FROM invoices i
       LEFT JOIN vendors v ON v.id = i.vendor_id
      WHERE i.tenant_id=$1 AND i.status='DRAFT'
      ORDER BY i.created_at DESC LIMIT 100`,
    [ctx.tenantId],
  );
  for (const inv of invoices) {
    rows.push({
      id: `inv-${inv.id}`,
      kind: "INVOICE",
      kind_label: inv.type === "AP" ? "Vendor Bill" : "Invoice",
      title: `${inv.number} — ${inv.customer ?? inv.vendor_name ?? "—"}`,
      subtitle: `${inv.currency} ${Number(inv.amount).toFixed(2)}`,
      module: "finance",
      meta: [
        { label: "Due", value: new Date(inv.due_date).toISOString().slice(0, 10) },
        { label: "Source", value: inv.source ?? "MANUAL" },
      ],
      created_at: inv.created_at,
      source_ref: inv.source_ref,
    });
  }

  // ---------- Journal entries in DRAFT ----------
  const jes = await q<any>(
    `SELECT id, reference, memo, debit_account, credit_account, amount, source, source_ref, created_at
       FROM journal_entries
      WHERE tenant_id=$1 AND status='DRAFT'
      ORDER BY created_at DESC LIMIT 100`,
    [ctx.tenantId],
  );
  for (const je of jes) {
    rows.push({
      id: `je-${je.id}`,
      kind: "JE",
      kind_label: "Journal Entry",
      title: `${je.reference}: Dr ${je.debit_account} / Cr ${je.credit_account}`,
      subtitle: je.memo,
      module: "finance",
      meta: [
        { label: "Amount", value: `$${Number(je.amount).toFixed(2)}` },
        { label: "Source", value: je.source ?? "MANUAL" },
      ],
      created_at: je.created_at,
      source_ref: je.source_ref,
    });
  }

  // ---------- Work orders in PLANNED (treated as draft) ----------
  const wos = await q<any>(
    `SELECT id, reference, quantity, planned_start, planned_end, created_at
       FROM work_orders
      WHERE tenant_id=$1 AND status='PLANNED'
      ORDER BY created_at DESC LIMIT 100`,
    [ctx.tenantId],
  );
  for (const w of wos) {
    rows.push({
      id: `wo-${w.id}`,
      kind: "WO",
      kind_label: "Work Order",
      title: `${w.reference}: ${w.quantity} units`,
      subtitle: null,
      module: "manufacturing",
      meta: [
        { label: "Start", value: w.planned_start ? new Date(w.planned_start).toISOString().slice(0, 10) : "—" },
      ],
      created_at: w.created_at,
      source_ref: null,
    });
  }

  return rows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}