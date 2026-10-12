"use client";

export default function PromptSuggestions({
  title,
  prompts,
  onPick,
  compact = false,
}: {
  title: string;
  prompts: string[];
  onPick: (text: string) => void;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <div className="mb-3 flex flex-wrap gap-2">
        {prompts.slice(0, 6).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onPick(p)}
            className="truncate rounded-full border border-ink-700 bg-ink-900 px-3 py-1 text-xs text-slate-300 transition hover:border-brand-600 hover:text-slate-100"
            title={p}
          >
            {p.length > 60 ? p.slice(0, 57) + "…" : p}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl py-12">
      <h2 className="text-center text-lg font-semibold text-slate-100">{title}</h2>
      <p className="mt-1 text-center text-sm text-slate-400">
        Click a prompt to edit it, then send.
      </p>
      <div className="mt-6 grid gap-2">
        {prompts.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onPick(p)}
            className="card px-4 py-3 text-left text-sm text-slate-300 transition hover:border-brand-600 hover:text-slate-100"
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}