import { env } from "./env.js";

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string; // Required for role="tool"
  tool_calls?: any[];
};

export type LlmSettings = {
  provider: string;
  base_url: string;
  model: string;
  api_key?: string | null;
  temperature: number;
  /** "server" = this app's demo Gemini key from .env, "user" = a key the user entered in Settings */
  key_source?: "server" | "user";
};

export type StreamChunk =
  | { type: "delta"; text: string }
  | { type: "tool_calls"; calls: { id: string; name: string; arguments: any; extra_content?: any }[] }
  | { type: "done"; finish_reason?: string };

/**
 * Supported providers, in priority order (this is also the order shown in Settings):
 * 1. Google Gemini  2. Ollama (local)  3. Ollama Cloud  4+. other BYOK providers.
 */
export const PROVIDERS = {
  google:              { kind: "openai", base_url: "https://generativelanguage.googleapis.com/v1beta/openai", label: "Google Gemini",              needsKey: true  },
  ollama:              { kind: "ollama", base_url: "http://localhost:11434",                                  label: "Ollama (local)",             needsKey: false },
  "ollama-cloud":      { kind: "ollama", base_url: "https://ollama.com",                                      label: "Ollama Cloud",               needsKey: true  },
  openai:              { kind: "openai", base_url: "https://api.openai.com/v1",                               label: "OpenAI",                     needsKey: true  },
  openrouter:          { kind: "openai", base_url: "https://openrouter.ai/api/v1",                            label: "OpenRouter",                 needsKey: true  },
  "openai-compatible": { kind: "openai", base_url: "http://localhost:8000/v1",                                label: "Custom (OpenAI-compatible)", needsKey: false },
} as const;

export type ProviderId = keyof typeof PROVIDERS;

/** Default Gemini model, overridable with GEMINI_MODEL. */
export const DEFAULT_GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";

/** 10 minutes — local models like Gemma4:12b can take a while, and multi-step tool loops multiply it. */
export const LLM_TIMEOUT_MS = 600_000;

/** Server-side Gemini key (used for demo mode and as the fallback when Ollama is unreachable). */
function serverGeminiKey(): string {
  return process.env.GEMINI_API_KEY || process.env.DEMO_MODE_API_KEY || "";
}

/** Demo mode: Google Gemini with the server's key from .env. */
export function demoSettings(): LlmSettings {
  return {
    provider: "google",
    base_url: PROVIDERS.google.base_url,
    model: DEFAULT_GEMINI_MODEL,
    api_key: serverGeminiKey(),
    temperature: 0.1,
    key_source: "server",
  };
}

export async function loadSettings(tenantId: string): Promise<LlmSettings> {
  const { one } = await import("./db.js");
  const row = await one<any>(
    `SELECT provider, base_url, model, api_key, temperature, is_demo_mode
       FROM agent_settings WHERE tenant_id = $1`,
    [tenantId],
  );

  // ---- DEMO MODE OVERRIDE ----
  if (row?.is_demo_mode) return demoSettings();

  // No saved settings yet: Google Gemini first (if the server has a key), otherwise local Ollama.
  if (!row) {
    if (serverGeminiKey()) return demoSettings();
    return {
      provider: "ollama",
      base_url: env.OLLAMA_URL,
      model: env.OLLAMA_MODEL,
      temperature: 0.1,
    };
  }
  return {
    provider: row.provider,
    base_url: row.base_url,
    model: row.model,
    api_key: row.api_key,
    temperature: Number(row.temperature ?? 0.1),
  };
}

/** Google Gemini settings to fall back to when Ollama can't be reached, or null if no server key is set. */
function googleFallback(s: LlmSettings): LlmSettings | null {
  const key = serverGeminiKey();
  if (!key) return null;
  return {
    provider: "google",
    base_url: PROVIDERS.google.base_url,
    model: DEFAULT_GEMINI_MODEL,
    api_key: key,
    temperature: s.temperature,
    key_source: "server",
  };
}

/** Fills in a missing base URL / key so a half-filled BYOK setting still works. */
function withDefaults(s: LlmSettings, provider: (typeof PROVIDERS)[ProviderId]): LlmSettings {
  return {
    ...s,
    base_url: s.base_url || provider.base_url,
    // The user's own key always wins; Google falls back to the server key.
    api_key: s.api_key || (s.provider === "google" ? serverGeminiKey() : s.api_key),
    key_source: s.key_source ?? (!s.api_key && s.provider === "google" && serverGeminiKey() ? "server" : "user"),
    model: s.model || (s.provider === "google" ? DEFAULT_GEMINI_MODEL : s.model),
  };
}

/**
 * Picks the provider for a WHOLE request, before the first model call.
 * If Ollama (local or cloud) can't be reached, the entire request uses Google Gemini instead.
 * Switching mid-request is not allowed: Gemini rejects tool calls in the history that were made
 * by another model, because they lack Gemini's thought signatures.
 */
export async function resolveSettings(
  settings: LlmSettings,
): Promise<{ settings: LlmSettings; fellBack: boolean; reason?: string }> {
  const provider = (PROVIDERS as any)[settings.provider] ?? PROVIDERS.ollama;
  if (provider.kind !== "ollama") return { settings, fellBack: false };

  const s = withDefaults(settings, provider);
  let reason = "";
  try {
    const res = await fetch(`${s.base_url.replace(/\/$/, "")}/api/tags`, {
      headers: s.api_key ? { Authorization: `Bearer ${s.api_key}` } : {},
      signal: AbortSignal.timeout(5_000),
    });
    if (res.ok) return { settings, fellBack: false };
    reason = `HTTP ${res.status}`;
  } catch (err: any) {
    reason = err?.name === "TimeoutError" ? "no response within 5 seconds" : (err?.message ?? String(err));
  }

  const fallback = googleFallback(settings);
  if (!fallback) return { settings, fellBack: false, reason }; // no Gemini key: let Ollama's own error show
  console.warn(`[llm] Ollama unavailable at ${s.base_url} (${reason}); using Google Gemini for this request`);
  return { settings: fallback, fellBack: true, reason };
}

/** Streams a single LLM turn. Yields deltas + final tool calls. */
export async function* streamChat(
  settings: LlmSettings,
  messages: ChatMessage[],
  tools: any[],
): AsyncGenerator<StreamChunk> {
  const provider = (PROVIDERS as any)[settings.provider] ?? PROVIDERS.ollama;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  try {
    const s = withDefaults(settings, provider);
    if (provider.needsKey && !s.api_key) {
      throw new Error(`No API key set for ${provider.label}. Add your key in Settings.`);
    }

    // The Ollama -> Gemini fallback is decided once per request in resolveSettings(),
    // never here: switching provider mid-request breaks Gemini's thought signatures.
    if (provider.kind === "ollama") {
      yield* streamOllama(s, messages, tools, controller.signal);
    } else {
      yield* streamOpenAI(s, messages, tools, controller.signal);
    }
  } finally {
    clearTimeout(timer);
  }
}

async function* streamOllama(
  s: LlmSettings,
  messages: ChatMessage[],
  tools: any[],
  signal: AbortSignal,
): AsyncGenerator<StreamChunk> {
  const url = `${s.base_url.replace(/\/$/, "")}/api/chat`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(s.api_key ? { Authorization: `Bearer ${s.api_key}` } : {}), // Ollama Cloud
    },
    body: JSON.stringify({
      model: s.model,
      messages: toOllamaMessages(messages),
      ...(tools?.length ? { tools } : {}),
      stream: true,
      options: { temperature: s.temperature },
    }),
    signal,
  });
  if (!res.ok) throw new LlmHttpError(res.status, `Ollama ${res.status}: ${await res.text()}`);
  if (!res.body) throw new Error("Ollama: empty body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const toolCalls: { id: string; name: string; arguments: any }[] = [];

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let chunk: any;
      try { chunk = JSON.parse(line); } catch { continue; }
      const msg = chunk.message ?? {};
      if (msg.content) yield { type: "delta", text: msg.content };
      for (const tc of msg.tool_calls ?? []) {
        toolCalls.push({
          id: tc.id || `call_${Math.random().toString(36).slice(2, 8)}`,
          name: tc.function?.name,
          arguments:
            typeof tc.function?.arguments === "string"
              ? safeParse(tc.function.arguments)
              : tc.function?.arguments ?? {},
        });
      }
      if (chunk.done) break;
    }
  }
  if (toolCalls.length) yield { type: "tool_calls", calls: toolCalls };
  yield { type: "done" };
}

async function* streamOpenAI(
  s: LlmSettings,
  messages: ChatMessage[],
  tools: any[],
  signal: AbortSignal,
): AsyncGenerator<StreamChunk> {
  const url = `${s.base_url.replace(/\/$/, "")}/chat/completions`;
  const res = await postChat(
    url,
    {
      "Content-Type": "application/json",
      ...(s.api_key ? { Authorization: `Bearer ${s.api_key}` } : {}),
      // OpenRouter likes these; harmless for OpenAI/Gemini
      "HTTP-Referer": "http://localhost:3000",
      "X-Title": "Magent ERP",
    },
    {
      model: s.model,
      messages,
      ...(tools?.length ? { tools } : {}),
      stream: true,
      temperature: s.temperature,
    },
    signal,
  );
  if (!res.ok) throw new LlmHttpError(res.status, `LLM ${res.status}: ${await res.text()}`);
  if (!res.body) throw new Error("LLM: empty body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const accum: Record<number, { id: string; name: string; args: string; extra?: any }> = {};
  let finishReason: string | undefined;
  // Some streams put Gemini's thought signature on the delta/choice instead of on the tool call.
  let looseExtra: any = undefined;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") continue;
      let chunk: any;
      try { chunk = JSON.parse(payload); } catch { continue; }
      const choice = chunk.choices?.[0] ?? {};
      if (choice.finish_reason) finishReason = choice.finish_reason;
      const delta = choice.delta ?? {};
      for (const ec of [choice.extra_content, delta.extra_content]) {
        if (ec) looseExtra = { ...(looseExtra ?? {}), ...ec };
      }
      if (typeof delta.content === "string" && delta.content.length) {
        yield { type: "delta", text: delta.content };
      }
      for (const tc of delta.tool_calls ?? []) {
        const i = toolCallSlot(accum, tc);
        if (!accum[i]) accum[i] = { id: tc.id ?? "", name: "", args: "" };
        if (tc.id) accum[i].id = tc.id; // Capture the ID (e.g. from Gemini)
        // Gemini 3 attaches a thought signature here; it must be sent back unchanged next turn.
        if (tc.extra_content) accum[i].extra = { ...(accum[i].extra ?? {}), ...tc.extra_content };
        if (tc.function?.name) accum[i].name += tc.function.name;
        if (tc.function?.arguments) accum[i].args += tc.function.arguments;
      }
    }
  }

  const calls = Object.values(accum)
    .filter((c) => c.name)
    .map((c) => ({
      id: c.id || `call_${Math.random().toString(36).slice(2, 8)}`,
      name: c.name,
      arguments: safeParse(c.args),
      ...(c.extra ? { extra_content: c.extra } : {}),
    })) as { id: string; name: string; arguments: any; extra_content?: any }[];

  // Signature arrived outside the tool call: attach it to the first call (Gemini expects it there).
  if (calls.length && looseExtra && !calls.some((c) => c.extra_content)) {
    calls[0].extra_content = looseExtra;
  }

  if (calls.length) yield { type: "tool_calls", calls };
  yield { type: "done", finish_reason: finishReason };
}

export type ConnectionTestResult = {
  ok: boolean;
  provider: string;
  model: string;
  latency_ms: number;
  /** true = the model called our test tool, false = it replied with text only, null = not checked */
  tool_calling: boolean | null;
  message: string;
};

/**
 * Sends one tiny request with the given settings to check that the URL, key and model work,
 * and whether the model supports tool calling (required for this app).
 * Never throws — always returns a result the Settings page can show.
 */
export async function testConnection(settings: LlmSettings): Promise<ConnectionTestResult> {
  const provider = (PROVIDERS as any)[settings.provider] ?? PROVIDERS.ollama;
  const s = withDefaults(settings, provider);
  const started = Date.now();
  const result = (ok: boolean, message: string, tool_calling: boolean | null = null): ConnectionTestResult => ({
    ok, provider: s.provider, model: s.model, latency_ms: Date.now() - started, tool_calling, message,
  });

  if (!s.model) return result(false, "No model set. Enter a model name, e.g. gemini-3.5-flash-lite.");
  if (provider.needsKey && !s.api_key) {
    return result(false, `No API key set for ${provider.label}.`);
  }

  const pingTool = {
    type: "function",
    function: {
      name: "ping",
      description: "Connection test. Call this tool when asked to.",
      parameters: { type: "object", properties: {} },
    },
  };
  const messages = [{ role: "user", content: "This is a connection test. Call the ping tool now." }];
  const signal = AbortSignal.timeout(30_000);

  try {
    let toolCalled = false;
    if (provider.kind === "ollama") {
      const res = await fetch(`${s.base_url.replace(/\/$/, "")}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(s.api_key ? { Authorization: `Bearer ${s.api_key}` } : {}),
        },
        body: JSON.stringify({ model: s.model, messages, tools: [pingTool], stream: false }),
        signal,
      });
      if (!res.ok) {
        const text = (await res.text()).slice(0, 300);
        if (res.status === 401 || res.status === 403) return result(false, `API key rejected (${res.status}). ${keyFailureHint(s)} ${text}`);
        if (res.status === 404) return result(false, `Model not found (404). Check the model name. ${text}`);
        return result(false, `Ollama ${res.status}: ${text}`);
      }
      const data: any = await res.json();
      toolCalled = (data.message?.tool_calls ?? []).length > 0;
    } else {
      const res = await postChat(
        `${s.base_url.replace(/\/$/, "")}/chat/completions`,
        {
          "Content-Type": "application/json",
          ...(s.api_key ? { Authorization: `Bearer ${s.api_key}` } : {}),
          "HTTP-Referer": "http://localhost:3000",
          "X-Title": "Magent ERP",
        },
        { model: s.model, messages, tools: [pingTool], stream: false, temperature: 0 },
        signal,
      );
      if (!res.ok) {
        const text = (await res.text()).slice(0, 300);
        const hint = isKeyProblem(res.status, text) ? ` ${keyFailureHint(s)}` : "";
        if (res.status === 401 || res.status === 403) return result(false, `API key rejected (${res.status}).${hint} ${text}`);
        if (res.status === 400 && /api key/i.test(text)) return result(false, `API key rejected.${hint} ${text}`);
        if (res.status === 404) return result(false, `Model or URL not found (404). Check the model name and base URL. ${text}`);
        if (res.status === 429) return result(false, `Rate limit or quota exceeded (429).${hint} ${text}`);
        return result(false, `LLM ${res.status}: ${text}`);
      }
      const data: any = await res.json();
      toolCalled = (data.choices?.[0]?.message?.tool_calls ?? []).length > 0;
    }

    return toolCalled
      ? result(true, "Connected. The model supports tool calling.", true)
      : result(true, "Connected, but the model did not call the test tool. It may not support tool calling, so the agent could make up data.", false);
  } catch (err: any) {
    if (err?.name === "TimeoutError") return result(false, "No response within 30 seconds.");
    return result(false, `Could not reach ${s.base_url}: ${err?.message ?? err}`);
  }
}

/**
 * Ollama's native API wants tool-call arguments as an OBJECT, while OpenAI/Gemini want a JSON
 * STRING (which is how agent.ts stores them). Convert for Ollama, and drop Gemini-only fields.
 */
function toOllamaMessages(messages: ChatMessage[]): any[] {
  return messages.map((m) => {
    if (!m.tool_calls?.length) return m;
    return {
      ...m,
      tool_calls: m.tool_calls.map((tc: any) => ({
        ...(tc.id ? { id: tc.id } : {}),
        type: "function",
        function: {
          name: tc.function?.name,
          arguments:
            typeof tc.function?.arguments === "string"
              ? safeParse(tc.function.arguments)
              : tc.function?.arguments ?? {},
        },
      })),
    };
  });
}

/**
 * Which slot a streamed tool-call fragment belongs to. Uses `index` when the provider sends it;
 * otherwise matches by `id`, so two parallel calls without an index don't get merged into one.
 */
function toolCallSlot(accum: Record<number, { id: string }>, tc: any): number {
  if (typeof tc.index === "number") return tc.index;
  const slots = Object.keys(accum).map(Number);
  if (tc.id) {
    const existing = slots.find((k) => accum[k].id === tc.id);
    return existing ?? slots.length;
  }
  return slots.length ? Math.max(...slots) : 0;
}

/** An HTTP error from a model provider, keeping the status code so we can explain it. */
export class LlmHttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "LlmHttpError";
  }
}

/** True when the failure is about the API key itself: rejected, missing permission, or out of quota. */
function isKeyProblem(status: number, text: string): boolean {
  return status === 401 || status === 403 || status === 429 || (status === 400 && /api key/i.test(text));
}

function usesServerKey(s: LlmSettings): boolean {
  return s.key_source === "server" || (s.provider === "google" && !s.api_key && Boolean(serverGeminiKey()));
}

/** Tells the user which other key they can switch to. */
function keyFailureHint(s: LlmSettings, role?: string): string {
  const who = role && role !== "ADMIN" ? "Ask an admin (or log in as an admin) to open" : "Open";
  if (usesServerKey(s)) {
    return `The demo Gemini key provided by this app isn't working right now. You can use your own API key instead: ${who} Settings → turn off Demo Mode → choose a provider → paste your key → Test connection → Save.`;
  }
  if (serverGeminiKey()) {
    return `Your API key isn't working. This app also provides a demo Gemini key: ${who} Settings → turn on Demo Mode → Save, then try again.`;
  }
  return "Check the API key in Settings and use Test connection.";
}

/** The chat error message, with a hint about the other key when the key itself is the problem. */
export function friendlyModelError(err: any, s: LlmSettings, role?: string): string {
  const base = `Model call failed: ${err?.message ?? err}`;
  const isKeyError =
    (err instanceof LlmHttpError && isKeyProblem(err.status, err.message)) ||
    /No API key set/i.test(err?.message ?? "");
  return isKeyError ? `${keyFailureHint(s, role)}\n\n(${base})` : base;
}

/**
 * POSTs a chat request. Some newer models (e.g. recent Claude and OpenAI reasoning models) only
 * accept their default temperature and return 400 otherwise; in that case retry once without it.
 */
async function postChat(url: string, headers: Record<string, string>, body: any, signal: AbortSignal): Promise<Response> {
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal });
  if (res.status !== 400 || !("temperature" in body)) return res;
  const text = await res.clone().text();
  if (!/temperature/i.test(text)) return res;
  console.warn(`[llm] ${body.model} rejected the temperature setting; retrying without it`);
  const { temperature: _ignored, ...rest } = body;
  return fetch(url, { method: "POST", headers, body: JSON.stringify(rest), signal });
}

function safeParse(s: any) {
  if (typeof s !== "string") return s ?? {};
  if (!s.trim()) return {};
  try { return JSON.parse(s); } catch { return {}; }
}