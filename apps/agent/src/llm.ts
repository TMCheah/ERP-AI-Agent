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
};

export type StreamChunk =
  | { type: "delta"; text: string }
  | { type: "tool_calls"; calls: { id: string; name: string; arguments: any }[] }
  | { type: "done"; finish_reason?: string };

export const PROVIDERS = {
  ollama:              { kind: "ollama", base_url: "http://localhost:11434",                              label: "Ollama (local)" },
  openai:              { kind: "openai", base_url: "https://api.openai.com/v1",                           label: "OpenAI" },
  openrouter:          { kind: "openai", base_url: "https://openrouter.ai/api/v1",                        label: "OpenRouter" },
  google:              { kind: "openai", base_url: "https://generativelanguage.googleapis.com/v1beta/openai", label: "Google Gemini (OpenAI-compat)" },
  "openai-compatible": { kind: "openai", base_url: "http://localhost:8000/v1",                            label: "Custom (OpenAI-compatible)" },
} as const;

export type ProviderId = keyof typeof PROVIDERS;

/** 10 minutes — local models like Gemma4:12b can take a while, and multi-step tool loops multiply it. */
export const LLM_TIMEOUT_MS = 600_000;

export async function loadSettings(tenantId: string): Promise<LlmSettings> {
  const { one } = await import("./db.js");
  const row = await one<any>(
    `SELECT provider, base_url, model, api_key, temperature, is_demo_mode 
       FROM agent_settings WHERE tenant_id = $1`,
    [tenantId],
  );

  // ---- DEMO MODE OVERRIDE ----
  if (row?.is_demo_mode) {
    return {
      provider: "google",
      base_url: "https://generativelanguage.googleapis.com/v1beta/openai",
      model: "gemma-4-31b-it", 
      api_key: process.env.DEMO_MODE_API_KEY || "",
      temperature: 0.1,
    };
  }

  if (!row) {
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
    if (provider.kind === "ollama") {
      yield* streamOllama(settings, messages, tools, controller.signal);
    } else {
      yield* streamOpenAI(settings, messages, tools, controller.signal);
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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: s.model,
      messages,
      tools,
      stream: true,
      options: { temperature: s.temperature },
    }),
    signal,
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
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
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(s.api_key ? { Authorization: `Bearer ${s.api_key}` } : {}),
      // OpenRouter likes these; harmless for OpenAI/Gemini
      "HTTP-Referer": "http://localhost:3000",
      "X-Title": "Magent ERP",
    },
    body: JSON.stringify({
      model: s.model,
      messages,
      tools,
      stream: true,
      temperature: s.temperature,
    }),
    signal,
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`);
  if (!res.body) throw new Error("LLM: empty body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const accum: Record<number, { id: string; name: string; args: string }> = {};

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
      const delta = chunk.choices?.[0]?.delta ?? {};
      if (typeof delta.content === "string" && delta.content.length) {
        yield { type: "delta", text: delta.content };
      }
      for (const tc of delta.tool_calls ?? []) {
        const i = tc.index ?? 0;
        if (!accum[i]) accum[i] = { id: tc.id ?? "", name: "", args: "" };
        if (tc.id) accum[i].id = tc.id; // Capture the ID (e.g. from Gemini)
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
    }));
}

function safeParse(s: any) {
  if (typeof s !== "string") return s ?? {};
  if (!s.trim()) return {};
  try { return JSON.parse(s); } catch { return {}; }
}