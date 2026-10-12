"use client";
import { useEffect, useState } from "react";

const PROVIDER_DEFAULTS: Record<string, { base_url: string; model: string; hint: string }> = {
  ollama:              { base_url: "http://localhost:11434", model: "gemma4:12b",           hint: "Local Ollama. Model must support tools (gemma4:12b, etc.)." },
  openai:              { base_url: "https://api.openai.com/v1", model: "gpt-4o-mini",       hint: "Requires API key. gpt-4o-mini is cheap and capable." },
  openrouter:          { base_url: "https://openrouter.ai/api/v1", model: "anthropic/claude-3.5-sonnet", hint: "Access many models via one key." },
  google:              { base_url: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-1.5-pro", hint: "Google AI Studio key. Uses Google's OpenAI-compatible endpoint." },
  "openai-compatible": { base_url: "http://localhost:8000/v1", model: "your-model",          hint: "Any OpenAI-compatible server (vLLM, LM Studio, LocalAI, etc.)." },
};

export default function SettingsPage() {
  const [form, setForm] = useState({
    provider: "ollama",
    base_url: "http://localhost:11434",
    model: "gemma4:12b",
    api_key: "",
    temperature: 0.0,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/settings");
      const j = await res.json().catch(() => ({}));
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

  function onProviderChange(p: string) {
    const d = PROVIDER_DEFAULTS[p];
    setForm((f) => ({
      ...f,
      provider: p,
      base_url: d?.base_url ?? f.base_url,
      model: d?.model ?? f.model,
      api_key: p === "ollama" ? "" : f.api_key,
    }));
  }

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
    setMsg("Saved. New chats use this model.");
  }

  const hint = PROVIDER_DEFAULTS[form.provider]?.hint;
  const needsKey = form.provider !== "ollama";

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-ink-800 px-6 py-4">
        <h1 className="text-lg font-semibold text-slate-100">Settings</h1>
        <p className="text-xs text-slate-400">Configure the LLM provider. Admin only. Timeout is 10 minutes per turn.</p>
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
                  onChange={(e) => onProviderChange(e.target.value)}
                >
                  {Object.keys(PROVIDER_DEFAULTS).map((k) => (
                    <option key={k} value={k}>{k}</option>
                  ))}
                </select>
                {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
              </div>

              <div>
                <label className="label">Base URL</label>
                <input
                  className="input"
                  value={form.base_url}
                  onChange={(e) => setForm({ ...form, base_url: e.target.value })}
                />
              </div>

              <div>
                <label className="label">Model</label>
                <input
                  className="input"
                  value={form.model}
                  onChange={(e) => setForm({ ...form, model: e.target.value })}
                />
              </div>

              {needsKey && (
                <div>
                  <label className="label">API key</label>
                  <input
                    className="input"
                    type="password"
                    placeholder="Leave blank to keep existing"
                    value={form.api_key}
                    onChange={(e) => setForm({ ...form, api_key: e.target.value })}
                  />
                </div>
              )}

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
                <div className="rounded-md border border-emerald-800 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300">{msg}</div>
              )}
              {error && (
                <div className="rounded-md border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-300">{error}</div>
              )}

              <button className="btn btn-primary" onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save settings"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}