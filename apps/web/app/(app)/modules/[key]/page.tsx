"use client";
import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import ModuleCard, { type ModuleCardRow } from "@/components/ModuleCard";
import { MODULE_LABELS } from "@/lib/modules";

type Bucket = "pending" | "draft" | "complete" | "all";

const BUCKETS: Bucket[] = ["pending", "draft", "complete", "all"];

export default function ModulePage() {
  const params = useParams<{ key: string }>();
  const key = params.key;
  const label = MODULE_LABELS[key] ?? key;

  const [allRows, setAllRows] = useState<ModuleCardRow[]>([]);
  const [bucket, setBucket] = useState<Bucket>("pending");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/modules/${key}?bucket=all`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Failed to load");
      setAllRows(j.rows ?? []);
    } catch (err: any) {
      setError(err.message);
      setAllRows([]);
    }
    setLoading(false);
  }, [key]);

  useEffect(() => { load(); }, [load]);

  async function decide(approvalId: number, decision: "APPROVED" | "REJECTED") {
    setBusy(approvalId);
    try {
      await fetch(`/api/approvals/${approvalId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
    } finally {
      setBusy(null);
      load();
    }
  }

  const counts = {
    pending: allRows.filter((r) => r.bucket === "pending").length,
    draft: allRows.filter((r) => r.bucket === "draft").length,
    complete: allRows.filter((r) => r.bucket === "complete").length,
    all: allRows.length,
  };

  const rows = bucket === "all" ? allRows : allRows.filter((r) => r.bucket === bucket);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-ink-800 px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">{label}</h1>
          <p className="text-xs text-slate-400">
            {bucket === "all" ? "All records" : `${bucket} · ${counts[bucket]}`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex rounded-md border border-ink-700 bg-ink-900 p-0.5">
            {BUCKETS.map((b) => (
              <button
                key={b}
                onClick={() => setBucket(b)}
                className={
                  "rounded px-3 py-1 text-xs font-medium capitalize transition " +
                  (bucket === b
                    ? "bg-brand-600 text-white"
                    : "text-slate-400 hover:text-slate-200")
                }
              >
                {b} {counts[b] > 0 && <span className="ml-1 opacity-70">{counts[b]}</span>}
              </button>
            ))}
          </div>
          <Link href={`/chat?m=${key}`} className="btn btn-ghost text-xs" title="Chat about this module">
            💬 Chat
          </Link>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : error ? (
          <div className="card p-6 text-sm text-red-300">{error}</div>
        ) : rows.length === 0 ? (
          <div className="card p-12 text-center text-sm text-slate-400">
            Nothing in {bucket}. Try the Chat tab to create records.
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
            {rows.map((r) => (
              <ModuleCard
                key={r.id}
                row={r}
                busy={busy === r.approval_id}
                onApprove={(id) => decide(id, "APPROVED")}
                onReject={(id) => decide(id, "REJECTED")}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}