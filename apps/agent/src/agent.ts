import { loadSettings, resolveSettings, streamChat, friendlyModelError, type ChatMessage } from "./llm.js";
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
  // Pick ONE provider for this whole request (Ollama -> Gemini fallback happens only here).
  const resolved = await resolveSettings(await loadSettings(ctx.tenantId));
  const settings = resolved.settings;
  if (resolved.fellBack) {
    yield { type: "thinking", text: `⚠ Ollama unavailable (${resolved.reason}). Using ${settings.model} for this request.` };
  }

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history.map((h) => ({ role: h.role, content: h.content })),
    { role: "user", content: userInput },
  ];

  let forcedRetry = false;
  let usedAnyTool = false; // true once the model has called at least one tool in this request

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    yield { type: "status", text: `Waiting for ${settings.model}…` };

    let assistantText = "";
    let calls: { id: string; name: string; arguments: any; extra_content?: any }[] = [];
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
      yield { type: "error", text: friendlyModelError(err, settings, (ctx as any).role) };
      yield { type: "done" };
      return;
    }

    if (calls.length === 0) {
      // ---- HALLUCINATION GUARD ----
      // If the user asked a data-seeking question and the model produced an answer
      // WITHOUT calling a tool, force one retry with an explicit reminder.
      if (!forcedRetry && !usedAnyTool && DATA_SEEKING_RE.test(userInput) && assistantText.trim()) {
        forcedRetry = true;
        yield {
          type: "thinking",
          text: "⚠ Answered without querying the database. Forcing a retry.",
        };
        messages.push({ role: "assistant", content: assistantText.trim() || " " });
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

    usedAnyTool = true;
    messages.push({
      role: "assistant",
      content: assistantText,
      tool_calls: calls.map((c) => ({
        id: c.id,
        type: "function",
        function: {
          name: c.name,
          arguments: JSON.stringify(c.arguments), // MUST be a string for OpenAI/Gemini
        },
        // Gemini 3 thought signature: send back exactly as received (no-op for other providers)
        ...(c.extra_content ? { extra_content: c.extra_content } : {}),
      })),
    });

    for (const call of calls) {
      const id = call.id;
      yield { type: "thinking", text: `→ ${call.name}(${shortArgs(call.arguments)})` };
      yield { type: "tool_call", id, name: call.name, args: call.arguments };

      const t = toolMap.get(call.name);
      let result: any;
      if (!t) {
        result = { error: `Unknown tool: ${call.name}` };
      } else {
        try {
          result = await withRetry(() => t.handler(call.arguments, ctx), 3, 200);
        } catch (err: any) {
          result = { error: err.message ?? String(err) };
        }
      }
      yield { type: "tool_result", id, name: call.name, result };
      
      // The tool response must include the ID
      messages.push({ 
        role: "tool", 
        tool_call_id: call.id, 
        content: JSON.stringify(result).slice(0, 20000) 
      });
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