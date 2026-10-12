import { loadSettings, streamChat, type ChatMessage } from "./llm.js";
import { SYSTEM_PROMPT } from "./prompt.js";
import { toolMap, toolsForOllama } from "./tools/index.js";
import { withRetry } from "./tools/helpers.js";
import type { ToolCtx } from "./tools/types.js";

export type AgentEvent =
  | { type: "status"; text: string }
  | { type: "thinking"; text: string }
  | { type: "delta"; text: string }
  | { type: "tool_call"; id: string; name: string; args: any }
  | { type: "tool_result"; id: string; name: string; result: any }
  | { type: "message"; text: string }
  | { type: "error"; text: string }
  | { type: "done" };

const MAX_ITERATIONS = 25;

const DATA_SEEKING_RE =
  /\b(show|list|find|search|get|fetch|display|how many|how much|what('s| is)|which|who('s| is)|report|query|lookup|count|total|sum|forecast|calculate)\b/i;

export async function* runAgent(
  ctx: ToolCtx,
  history: { role: "user" | "assistant"; content: string }[],
  userInput: string,
): AsyncGenerator<AgentEvent> {
  yield { type: "status", text: "Loading model…" };
  const settings = await loadSettings(ctx.tenantId);

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history.map((h) => ({ role: h.role, content: h.content })),
    { role: "user", content: userInput },
  ];

  let forcedRetry = false;

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    yield { type: "status", text: `Waiting for ${settings.model}…` };

    let assistantText = "";
    let calls: { name: string; arguments: any }[] = [];
    let firstToken = false;

    try {
      for await (const chunk of streamChat(settings, messages, toolsForOllama())) {
        if (chunk.type === "delta") {
          if (!firstToken) {
            firstToken = true;
            yield { type: "status", text: "Streaming response…" };
          }
          assistantText += chunk.text;
          yield { type: "delta", text: chunk.text };
        } else if (chunk.type === "tool_calls") {
          calls = chunk.calls;
        }
      }
    } catch (err: any) {
      yield { type: "error", text: `Model call failed: ${err.message}` };
      yield { type: "done" };
      return;
    }

    if (calls.length === 0) {
      // ---- HALLUCINATION GUARD ----
      // If the user asked a data-seeking question and the model produced an answer
      // WITHOUT calling a tool, force one retry with an explicit reminder.
      if (!forcedRetry && DATA_SEEKING_RE.test(userInput) && assistantText.trim()) {
        forcedRetry = true;
        yield {
          type: "thinking",
          text: "⚠ Answered without querying the database. Forcing a retry.",
        };
        messages.push({ role: "assistant", content: assistantText });
        messages.push({
          role: "system",
          content:
            "You produced an answer WITHOUT calling any tool. That is forbidden for this request. " +
            "The user asked a data-seeking question. You MUST call one of the available tools now — " +
            "do not answer from memory. If you cannot find a matching tool, say so explicitly.",
        });
        continue;
      }
      const text = assistantText.trim() || "I don't have an answer for that.";
      yield { type: "message", text };
      yield { type: "done" };
      return;
    }

    messages.push({
      role: "assistant",
      content: assistantText,
      tool_calls: calls.map((c) => ({ function: { name: c.name, arguments: c.arguments } })),
    });

    for (const call of calls) {
      const id = `${call.name}-${Math.random().toString(36).slice(2, 8)}`;
      yield { type: "thinking", text: `→ ${call.name}(${shortArgs(call.arguments)})` };
      yield { type: "tool_call", id, name: call.name, args: call.arguments };

      const t = toolMap.get(call.name);
      let result: any;
      if (!t) {
        result = { error: `Unknown tool: ${call.name}` };
      } else {
        try {
          // Retry transient DB errors only — most tools are idempotent enough
          result = await withRetry(() => t.handler(call.arguments, ctx), 3, 200);
        } catch (err: any) {
          result = { error: err.message ?? String(err) };
        }
      }
      yield { type: "tool_result", id, name: call.name, result };
      messages.push({ role: "tool", content: JSON.stringify(result).slice(0, 20000) });
    }

    yield { type: "status", text: "Thinking about results…" };
  }

  yield { type: "error", text: "Too many tool iterations. Please simplify your request." };
  yield { type: "done" };
}

function shortArgs(a: any): string {
  try {
    const s = JSON.stringify(a);
    return s.length > 60 ? s.slice(0, 57) + "…" : s;
  } catch { return ""; }
}