"use client";
import { useEffect, useState } from "react";

type Approval = {
  id: number;
  kind: string;
  summary: string;
  payload: any;
  status: string;
  created_at: string;
  requested_by_name: string;
  decision_note: string | null;
};

export default function ApprovalsPage() {
  const [rows, setRows] = useState<Approval[]>([]);
  const [status, setStatus] = useState("PENDING");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);
  const [note, setNote] = useState("");

  async function load() {
    setLoading(true);
    const res = await fetch(`/api/approvals?status=${status}`);
    const j = await res.json();
    setRows(j.approvals ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [status]);

  async function decide(id: number, decision: "APPROVED" | "REJECTED") {
    setBusy(id);
    const res = await fetch(`/api/approvals/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision, note }),
    });
    setBusy(null);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(j.error ?? "Failed");
      return;
    }
    setNote("");
    load();
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-ink-800 px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">Approvals</h1>
          <p className="text-xs text-slate-400">Review and action queued requests</p>
        </div>
        <div className="flex items-center gap-2">
          <select className="input w-40" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="PENDING">Pending</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
            <option value="ALL">All</option>
          </select>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : rows.length === 0 ? (
          <div className="card p-8 text-center text-sm text-slate-400">
            Nothing here. Ask the assistant to create a purchase requisition to see one appear.
          </div>
        ) : (
          <div className="space-y-3">
            {rows.map((r) => (
              <div key={r.id} className="card p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-ink-700 px-2 py-0.5 font-mono text-[11px] text-slate-300">
                        #{r.id}
                      </span>
                      <span className="rounded bg-brand-600/20 px-2 py-0.5 text-[11px] font-medium text-brand-500">
                        {r.kind}
                      </span>
                      <span
                        className={
                          "rounded px-2 py-0.5 text-[11px] font-medium " +
                          (r.status === "PENDING"
                            ? "bg-amber-500/20 text-amber-400"
                            : r.status === "APPROVED"
                            ? "bg-emerald-500/20 text-emerald-400"
                            : "bg-red-500/20 text-red-400")
                        }
                      >
                        {r.status}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-slate-200">{r.summary}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      Requested by {r.requested_by_name ?? "—"} ·{" "}
                      {new Date(r.created_at).toLocaleString()}
                    </p>
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-300">
                        Payload
                      </summary>
                      <pre className="mt-1 overflow-x-auto rounded bg-ink-950 p-2 text-[11px] text-slate-400">
{JSON.stringify(r.payload, null, 2)}
                      </pre>
                    </details>
                  </div>

                  {r.status === "PENDING" && (
                    <div className="flex w-56 flex-col gap-2">
                      <input
                        className="input"
                        placeholder="Optional note"
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                      />
                      <div className="flex gap-2">
                        <button
                          className="btn btn-primary flex-1"
                          disabled={busy === r.id}
                          onClick={() => decide(r.id, "APPROVED")}
                        >
                          Approve
                        </button>
                        <button
                          className="btn btn-danger flex-1"
                          disabled={busy === r.id}
                          onClick={() => decide(r.id, "REJECTED")}
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}