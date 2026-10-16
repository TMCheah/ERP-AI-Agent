"use client";

export type ModuleCardRow = {
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

const STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-amber-500/20 text-amber-400",
  PENDING_APPROVAL: "bg-amber-500/20 text-amber-400",
  DRAFT: "bg-slate-500/20 text-slate-400 italic",
  OPEN: "bg-blue-500/20 text-blue-400",
  OVERDUE: "bg-red-500/20 text-red-400",
  BELOW_REORDER: "bg-amber-500/20 text-amber-400",
  APPROVED: "bg-emerald-500/20 text-emerald-400",
  ACTIVE: "bg-emerald-500/20 text-emerald-400",
  OK: "bg-emerald-500/20 text-emerald-400",
  RECEIVED: "bg-emerald-500/20 text-emerald-400",
  PARTIALLY_RECEIVED: "bg-blue-500/20 text-blue-400",
  PAID: "bg-emerald-500/20 text-emerald-400",
  COMPLETED: "bg-emerald-500/20 text-emerald-400",
  DONE: "bg-emerald-500/20 text-emerald-400",
  CLOSED: "bg-emerald-500/20 text-emerald-400",
  POSTED: "bg-emerald-500/20 text-emerald-400",
  WON: "bg-emerald-500/20 text-emerald-400",
  CANCELLED: "bg-slate-500/20 text-slate-500",
  VOID: "bg-slate-500/20 text-slate-500",
  REJECTED: "bg-red-500/20 text-red-400",
  INACTIVE: "bg-slate-500/20 text-slate-500",
  NEW: "bg-blue-500/20 text-blue-400",
  QUALIFIED: "bg-blue-500/20 text-blue-400",
  PROPOSAL: "bg-purple-500/20 text-purple-400",
  IN_PROGRESS: "bg-blue-500/20 text-blue-400",
  PLANNED: "bg-slate-500/20 text-slate-400",
  RELEASED: "bg-blue-500/20 text-blue-400",
  ON_HOLD: "bg-amber-500/20 text-amber-400",
  LOST: "bg-red-500/20 text-red-400",
};

const KIND_ICONS: Record<string, string> = {
  PR: "📋",
  PO: "🛒",
  ITEM: "📦",
  INVOICE: "💵",
  JE: "📓",
  EMPLOYEE: "👤",
  LEAVE: "🌴",
  LEAD: "🎯",
  TICKET: "🎫",
  CUSTOMER: "🏢",
  BOM: "🌳",
  WO: "🏭",
  PROJECT: "◈",
  APPROVAL: "⏳",
};

export default function ModuleCard({
  row,
  onApprove,
  onReject,
  busy,
}: {
  row: ModuleCardRow;
  onApprove?: (id: number) => void;
  onReject?: (id: number) => void;
  busy?: boolean;
}) {
  const statusClass = STATUS_COLORS[row.status] ?? "bg-ink-700 text-slate-300";
  const icon = KIND_ICONS[row.kind] ?? "•";

  return (
    <div className="card p-4 transition hover:border-ink-600">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-ink-700 px-2 py-0.5 text-[11px] font-medium text-slate-300">
              {icon} {row.kind_label}
            </span>
            <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${statusClass}`}>
              {row.status}
            </span>
          </div>
          <p className="mt-2 text-sm font-medium text-slate-100">{row.title}</p>
          {row.subtitle && <p className="mt-0.5 text-xs text-slate-400">{row.subtitle}</p>}

          {row.meta.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1">
              {row.meta.map((m, i) => (
                <div key={i} className="text-[11px]">
                  <span className="text-slate-500">{m.label}: </span>
                  <span className="font-mono text-slate-300">{m.value}</span>
                </div>
              ))}
            </div>
          )}

          <p className="mt-2 text-[10px] text-slate-500">
            {new Date(row.created_at).toLocaleString()}
          </p>
        </div>

        {row.approval_id != null && onApprove && onReject && (
          <div className="flex flex-shrink-0 flex-col gap-1.5">
            <button
              className="btn btn-primary px-3 py-1.5 text-xs"
              disabled={busy}
              onClick={() => onApprove(row.approval_id!)}
            >
              Approve
            </button>
            <button
              className="btn btn-danger px-3 py-1.5 text-xs"
              disabled={busy}
              onClick={() => onReject(row.approval_id!)}
            >
              Reject
            </button>
          </div>
        )}
      </div>
    </div>
  );
}