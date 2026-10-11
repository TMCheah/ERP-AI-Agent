"use client";

/**
 * Tiny markdown renderer — handles paragraphs, bold, inline code, and
 * GitHub-style tables (which is what our agent is prompted to produce).
 */
function renderMarkdown(src: string): string {
  const lines = src.split("\n");
  const out: string[] = [];
  let i = 0;

  const inline = (s: string) =>
    s
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");

  while (i < lines.length) {
    const line = lines[i];

    // Table block
    if (line.trim().startsWith("|") && lines[i + 1]?.trim().match(/^\|[\s\-:|]+\|$/)) {
      const header = line.split("|").slice(1, -1).map((c) => c.trim());
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        rows.push(lines[i].split("|").slice(1, -1).map((c) => c.trim()));
        i++;
      }
      out.push("<table><thead><tr>");
      for (const h of header) out.push(`<th>${inline(h)}</th>`);
      out.push("</tr></thead><tbody>");
      for (const r of rows) {
        out.push("<tr>");
        for (const c of r) out.push(`<td>${inline(c)}</td>`);
        out.push("</tr>");
      }
      out.push("</tbody></table>");
      continue;
    }

    if (line.trim() === "") { i++; continue; }
    out.push(`<p>${inline(line)}</p>`);
    i++;
  }
  return out.join("");
}

export type ChatItem =
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "assistant"; text: string }
  | { id: string; kind: "thinking"; lines: string[] }
  | { id: string; kind: "tool"; name: string; args?: any; result?: any; done: boolean }
  | { id: string; kind: "error"; text: string };

export default function Message({ item }: { item: ChatItem }) {
  if (item.kind === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-md bg-brand-600 px-4 py-2.5 text-sm text-white shadow">
          {item.text}
        </div>
      </div>
    );
  }

  if (item.kind === "assistant") {
    return (
      <div className="flex gap-3">
        <Avatar />
        <div
          className="md max-w-[85%] rounded-2xl rounded-bl-md border border-ink-700 bg-ink-900 px-4 py-2.5 text-sm text-slate-200"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(item.text) }}
        />
      </div>
    );
  }

  if (item.kind === "thinking") {
    return (
      <div className="flex gap-3">
        <Avatar />
        <details className="max-w-[85%] rounded-lg border border-ink-800 bg-ink-900/40 px-3 py-2 text-xs text-slate-400">
          <summary className="cursor-pointer select-none">Reasoning ({item.lines.length})</summary>
          <ul className="mt-2 space-y-0.5">
            {item.lines.map((l, idx) => (
              <li key={idx} className="font-mono text-[11px]">• {l}</li>
            ))}
          </ul>
        </details>
      </div>
    );
  }

  if (item.kind === "tool") {
    return (
      <div className="flex gap-3">
        <Avatar />
        <div className="max-w-[85%] rounded-lg border border-ink-800 bg-ink-900/40 px-3 py-2 text-xs">
          <div className="flex items-center gap-2 text-slate-300">
            <span className={"h-1.5 w-1.5 rounded-full " + (item.done ? "bg-emerald-400" : "bg-amber-400 animate-pulse")} />
            <span className="font-mono">{item.name}</span>
            <span className="text-slate-500">{item.done ? "completed" : "running"}</span>
          </div>
          {item.args && (
            <pre className="mt-1.5 overflow-x-auto rounded bg-ink-950 p-2 text-[11px] text-slate-400">
              {JSON.stringify(item.args, null, 2)}
            </pre>
          )}
          {item.done && item.result && (
            <details className="mt-1.5">
              <summary className="cursor-pointer text-[11px] text-slate-500 hover:text-slate-300">
                Result
              </summary>
              <pre className="mt-1 max-h-64 overflow-auto rounded bg-ink-950 p-2 text-[11px] text-slate-400">
                {JSON.stringify(item.result, null, 2)}
              </pre>
            </details>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      <Avatar />
      <div className="max-w-[85%] rounded-lg border border-red-800 bg-red-950/40 px-3 py-2 text-xs text-red-300">
        {item.text}
      </div>
    </div>
  );
}

function Avatar() {
  return (
    <div className="mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-brand-600 text-[11px] font-bold text-white">
      AI
    </div>
  );
}