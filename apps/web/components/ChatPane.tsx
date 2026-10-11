"use client";
import { useEffect, useRef, useState } from "react";
import Message, { type ChatItem } from "./Message";

export default function ChatPane() {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/me");
      if (!res.ok) return;
      const res2 = await fetch("/api/chat/history").catch(() => null);
      // History endpoint optional; skip silently if absent.
    })();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [items, status]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setBusy(true);
    setStatus("Sending…");

    const userId = crypto.randomUUID();
    setItems((p) => [...p, { id: userId, kind: "user", text }]);

    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text }),
    });

    if (!res.ok || !res.body) {
      setItems((p) => [...p, { id: crypto.randomUUID(), kind: "error", text: "Request failed" }]);
      setBusy(false);
      setStatus(null);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let thinkingId: string | null = null;
    let thinkingLines: string[] = [];
    const toolIds = new Map<string, string>();

    const flushThinking = () => {
      if (thinkingId && thinkingLines.length) {
        const id = thinkingId;
        const lines = [...thinkingLines];
        setItems((p) =>
          p.some((x) => x.id === id)
            ? p.map((x) => (x.id === id ? ({ ...x, lines } as any) : x))
            : [...p, { id, kind: "thinking", lines }],
        );
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split("\n\n");
      buf = parts.pop() ?? "";
      for (const part of parts) {
        const line = part.split("\n").find((l) => l.startsWith("data:"));
        if (!line) continue;
        let evt: any;
        try { evt = JSON.parse(line.slice(5).trim()); } catch { continue; }

        if (evt.type === "status") {
          setStatus(evt.text);
        } else if (evt.type === "thinking") {
          setStatus(null);
          if (!thinkingId) thinkingId = crypto.randomUUID();
          thinkingLines.push(evt.text);
          flushThinking();
        } else if (evt.type === "tool_call") {
          setStatus(null);
          const id = crypto.randomUUID();
          toolIds.set(evt.name, id);
          setItems((p) => [...p, { id, kind: "tool", name: evt.name, args: evt.args, done: false }]);
        } else if (evt.type === "tool_result") {
          const id = toolIds.get(evt.name);
          if (id) {
            setItems((p) =>
              p.map((x) => (x.id === id ? ({ ...x, result: evt.result, done: true } as any) : x)),
            );
          }
        } else if (evt.type === "message") {
          setStatus(null);
          setItems((p) => [...p, { id: crypto.randomUUID(), kind: "assistant", text: evt.text }]);
        } else if (evt.type === "error") {
          setStatus(null);
          setItems((p) => [...p, { id: crypto.randomUUID(), kind: "error", text: evt.text }]);
        } else if (evt.type === "done") {
          setStatus(null);
        }
      }
    }

    setBusy(false);
    setStatus(null);
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-ink-800 px-6 py-3">
        <div>
          <h1 className="text-sm font-semibold text-slate-100">Assistant</h1>
          <p className="text-[11px] text-slate-500">
            Ask anything about inventory, procurement, finance, people, or CRM.
          </p>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-slate-500">
          {status && (
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-500" />
              {status}
            </span>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        {items.length === 0 ? (
          <EmptyState onPick={(t) => setInput(t)} />
        ) : (
          <div className="mx-auto flex max-w-4xl flex-col gap-4">
            {items.map((it) => <Message key={it.id} item={it} />)}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <div className="border-t border-ink-800 bg-ink-900/40 px-6 py-4">
        <div className="mx-auto flex max-w-4xl items-end gap-3">
          <textarea
            className="input min-h-[44px] max-h-40 resize-none py-2.5"
            rows={1}
            placeholder="Ask the ERP…  (Enter to send, Shift+Enter for newline)"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            disabled={busy}
          />
          <button className="btn btn-primary h-[44px] px-5" onClick={send} disabled={busy || !input.trim()}>
            {busy ? "…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ onPick }: { onPick: (t: string) => void }) {
  const samples = [
    "Show me all pens with selling price above $5 and more than 100 in stock",
    "We need 500 units of SKU-1001 for the marketing team by 2026-11-01",
    "What invoices are overdue?",
    "Find employees in Engineering",
    "List my pending approvals",
  ];
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center justify-center py-24 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-600 text-xl font-bold text-white">
        AI
      </div>
      <h2 className="text-lg font-semibold text-slate-100">Talk to your ERP</h2>
      <p className="mt-1 max-w-md text-sm text-slate-400">
        No forms. No fields. Just describe what you need — the assistant will handle the rest.
      </p>
      <div className="mt-8 grid w-full gap-2">
        {samples.map((s) => (
          <button
            key={s}
            onClick={() => onPick(s)}
            className="card px-4 py-3 text-left text-sm text-slate-300 transition hover:border-brand-600 hover:text-slate-100"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}