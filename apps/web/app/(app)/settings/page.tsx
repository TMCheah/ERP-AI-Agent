"use client";
import { useEffect, useState } from "react";

export default function SettingsPage() {
  const [form, setForm] = useState({
    provider: "ollama",
    base_url: "http://localhost:11434",
    model: "qwen2.5:7b",
    api_key: "",
    temperature: 0.1,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/settings");
      const j = await res.json();
      if (j.settings) {
        setForm({
          provider: j.settings.provider,
          base_url: j.settings.base_url,
          model: j.settings.model,
          api_key: "",
          temperature: Number(j.settings.temperature),
        });
      }
      setLoading(false);
    })();
  }, []);

  async function save() {
    setSaving(true);
    setMsg(null);
    setError(null);
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setSaving(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "Failed to save");
      return;
    }
    setMsg("Saved. New chats will use this model.");
  }

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-ink-800 px-6 py-4">
        <h1 className="text-lg font-semibold text-slate-100">Settings</h1>
        <p className="text-xs text-slate-400">Configure the LLM provider. Admin only.</p>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="card max-w-2xl p-6">
          {loading ? (
            <p className="text-sm text-slate-400">Loading…</p>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="label">Provider</label>
                <select
                  className="input"
                  value={form.provider}
                  onChange={(e) => setForm({ ...form, provider: e.target.value })}
                >
                  <option value="ollama">Ollama (local)</option>
                  <option value="openai-compatible">OpenAI-compatible API</option>
                </select>
              </div>

              <div>
                <label className="label">Base URL</label>
                <input
                  className="input"
                  value={form.base_url}
                  onChange={(e) => setForm({ ...form, base_url: e.target.value })}
                  placeholder="http://localhost:11434"
                />
              </div>

              <div>
                <label className="label">Model</label>
                <input
                  className="input"
                  value={form.model}
                  onChange={(e) => setForm({ ...form, model: e.target.value })}
                  placeholder="qwen2.5:7b"
                />
                <p className="mt-1 text-xs text-slate-500">
                  Ollama: <code>qwen2.5:7b</code>, <code>llama3.1:8b</code>. Must support tool calling.
                </p>
              </div>

              <div>
                <label className="label">API key (optional)</label>
                <input
                  className="input"
                  type="password"
                  value={form.api_key}
                  onChange={(e) => setForm({ ...form, api_key: e.target.value })}
                  placeholder="Leave blank to keep existing"
                />
              </div>

              <div>
                <label className="label">Temperature</label>
                <input
                  className="input"
                  type="number"
                  step="0.05"
                  min="0"
                  max="1"
                  value={form.temperature}
                  onChange={(e) => setForm({ ...form, temperature: Number(e.target.value) })}
                />
              </div>

              {msg && (
                <div className="rounded-md border border-emerald-800 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300">
                  {msg}
                </div>
              )}
              {error && (
                <div className="rounded-md border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-300">
                  {error}
                </div>
              )}

              <div className="pt-2">
                <button className="btn btn-primary" onClick={save} disabled={saving}>
                  {saving ? "Saving…" : "Save settings"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}