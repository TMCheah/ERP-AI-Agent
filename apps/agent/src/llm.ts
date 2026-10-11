import { env } from "./env.js";

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: any[];
};

export type LlmSettings = {
  provider: string;
  base_url: string;
  model: string;
  api_key?: string | null;
  temperature: number;
};

export async function loadSettings(tenantId: string): Promise<LlmSettings> {
  // Avoid circular import by lazy-importing db
  const { one } = await import("./db.js");
  const row = await one<any>(
    `SELECT provider, base_url, model, api_key, temperature FROM agent_settings WHERE tenant_id = $1`,
    [tenantId],
  );
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

/**
 * One non-streaming chat turn. Returns either a natural-language answer
 * (message.content) or tool calls (message.tool_calls).
 */
export async function chatOnce(
  settings: LlmSettings,
  messages: ChatMessage[],
  tools: any[],
): Promise<ChatMessage> {
  if (settings.provider === "openai-compatible") {
    const res = await fetch(`${settings.base_url.replace(/\/$/, "")}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(settings.api_key ? { Authorization: `Bearer ${settings.api_key}` } : {}),
      },
      body: JSON.stringify({
        model: settings.model,
        messages,
        tools,
        temperature: settings.temperature,
      }),
    });
    if (!res.ok) throw new Error(`LLM error ${res.status}: ${await res.text()}`);
    const json: any = await res.json();
    const m = json.choices?.[0]?.message ?? {};
    return {
      role: "assistant",
      content: m.content ?? "",
      tool_calls: (m.tool_calls ?? []).map((tc: any) => ({
        function: {
          name: tc.function?.name,
          arguments: safeParse(tc.function?.arguments),
        },
      })),
    };
  }

  // ---- Ollama ----
  const res = await fetch(`${settings.base_url.replace(/\/$/, "")}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: settings.model,
      messages,
      tools,
      stream: false,
      options: { temperature: settings.temperature },
    }),
  });
  if (!res.ok) throw new Error(`Ollama error ${res.status}: ${await res.text()}`);
  const json: any = await res.json();
  const m = json.message ?? {};
  return {
    role: "assistant",
    content: m.content ?? "",
    tool_calls: (m.tool_calls ?? []).map((tc: any) => ({
      function: {
        name: tc.function?.name,
        arguments:
          typeof tc.function?.arguments === "string"
            ? safeParse(tc.function.arguments)
            : tc.function?.arguments ?? {},
      },
    })),
  };
}

function safeParse(s: any) {
  if (typeof s !== "string") return s ?? {};
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}