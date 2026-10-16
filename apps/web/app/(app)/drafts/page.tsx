"use client";
import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import ModuleCard, { type ModuleCardRow } from "@/components/ModuleCard";

type DraftRow = ModuleCardRow & { module: string; source_ref: string | null };

export default function DraftsPage() {
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/drafts");
      const j = await res.json();
      setRows(j.rows ?? []);
    } catch {
      setRows([]);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const modules = useMemo(() => {
    const m = new Set<string>();
    rows.forEach((r) => m.add(r.module));
    return Array.from(m).sort();
  }, [rows]);

  const visible = filter === "all" ? rows : rows.filter((r) => r.module === filter);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-ink-800 px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">Drafts</h1>
          <p className="text-xs text-slate-400">
            Uncommitted documents across all modules. Review, then promote them from their module.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="input w-40 text-xs"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">All modules ({rows.length})</option>
            {modules.map((m) => (
              <option key={m} value={m}>
                {m} ({rows.filter((r) => r.module === m).length})
              </option>
            ))}
          </select>
          <button className="btn btn-ghost text-xs" onClick={load}>
            ⟳ Refresh
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : visible.length === 0 ? (
          <div className="card p-12 text-center text-sm text-slate-400">
            No drafts. Everything is either pending approval or complete.
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
            {visible.map((r) => (
              <div key={r.id} className="relative">
                <ModuleCard row={r} />
                <Link
                  href={`/modules/${r.module}?bucket=draft`}
                  className="absolute right-3 top-3 rounded bg-ink-700 px-2 py-0.5 text-[10px] text-slate-300 hover:bg-ink-600"
                >
                  → {r.module}
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}