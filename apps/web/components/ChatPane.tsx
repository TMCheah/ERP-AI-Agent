"use client";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Message, { type ChatItem } from "./Message";
import PromptSuggestions from "./PromptSuggestions";
import { MODULE_PROMPTS } from "@/lib/promptTemplates";
import type { ModuleKey } from "@/lib/modules";

export default function ChatPane() {
  const params = useSearchParams();
  const module = (params.get("m") as ModuleKey) || "chat";

  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load history on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/chat/history");
        if (res.ok) {
          const j = await res.json();
          if (Array.isArray(j.messages)) {
            setItems(
              j.messages.map((m: any) => ({
                id: crypto.randomUUID(),
                kind: m.role === "user" ? "user" : "assistant",
                text: m.content,
              })),
            );
          }
        }
      } catch {}
      setHistoryLoaded(true);
    })();
  }, []);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [items, status]);

  function pickPrompt(text: string) {
    setInput(text);
    inputRef.current?.focus();
  }

  async function send() {
  const text = input.trim();
  if (!text || busy) return;
  setInput("");
  setBusy(true);
  setStatus("Sending…");

  setItems((p) => [...p, { id: crypto.randomUUID(), kind: "user", text }]);

  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: text }),
  });

  if (!res.ok || !res.body) {
    setItems((p) => [...p, { id: crypto.randomUUID(), kind: "error", text: `Request failed (${res.status})` }]);
    setBusy(false); setStatus(null);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  let thinkingId: string | null = null;
  let thinkingLines: string[] = [];

  const flushThinking = () => {
    if (thinkingLines.length) {
      if (!thinkingId) thinkingId = crypto.randomUUID();
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
        thinkingLines.push(evt.text);
        flushThinking();
      } else if (evt.type === "delta") {
        // Tokens are arriving — show a lightweight status, but don't render them.
        setStatus("Writing…");
      } else if (evt.type === "tool_call") {
        setStatus(null);
        setItems((p) => [...p, { id: evt.id, kind: "tool", name: evt.name, args: evt.args, done: false }]);
      } else if (evt.type === "tool_result") {
        setItems((p) => p.map((x) => x.id === evt.id ? ({ ...x, result: evt.result, done: true } as any) : x));
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

  const suggestions = MODULE_PROMPTS[module] ?? MODULE_PROMPTS.chat;
  const showBigSuggestions = historyLoaded && items.length === 0;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-ink-800 px-6 py-3">
        <div>
          <h1 className="text-sm font-semibold text-slate-100">
            {module === "chat" ? "Assistant" : suggestions.title}
          </h1>
          <p className="text-[11px] text-slate-500">
            {module === "chat"
              ? "Ask anything across every module."
              : `Quick prompts for ${suggestions.title}. Click one to edit, or type your own.`}
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
        {showBigSuggestions ? (
          <PromptSuggestions title={suggestions.title} prompts={suggestions.prompts} onPick={pickPrompt} />
        ) : (
          <div className="mx-auto flex max-w-4xl flex-col gap-4">
            {items.map((it) => <Message key={it.id} item={it} />)}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <div className="border-t border-ink-800 bg-ink-900/40 px-6 py-4">
        <div className="mx-auto max-w-4xl">
          {items.length > 0 && (
            <PromptSuggestions
              title={suggestions.title}
              prompts={suggestions.prompts}
              onPick={pickPrompt}
              compact
            />
          )}
          <div className="flex items-end gap-3">
            <textarea
              ref={inputRef}
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
    </div>
  );
}