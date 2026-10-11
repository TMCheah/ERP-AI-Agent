import { chatOnce, loadSettings, type ChatMessage } from "./llm.js";
import { SYSTEM_PROMPT } from "./prompt.js";
import { toolMap, toolsForOllama } from "./tools/index.js";
import type { ToolCtx } from "./tools/types.js";

export type AgentEvent =
  | { type: "status"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool_call"; name: string; args: any }
  | { type: "tool_result"; name: string; result: any }
  | { type: "message"; text: string }
  | { type: "error"; text: string }
  | { type: "done" };

const MAX_ITERATIONS = 8;

export async function* runAgent(
  ctx: ToolCtx,
  history: { role: "user" | "assistant"; content: string }[],
  userInput: string,
): AsyncGenerator<AgentEvent> {
  yield { type: "status", text: "Loading model settings…" };
  const settings = await loadSettings(ctx.tenantId);

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history.map((h) => ({ role: h.role, content: h.content })),
    { role: "user", content: userInput },
  ];

  yield { type: "status", text: `Thinking with ${settings.model}…` };

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    let reply: ChatMessage;
    try {
      reply = await chatOnce(settings, messages, toolsForOllama());
    } catch (err: any) {
      yield { type: "error", text: `Model call failed: ${err.message}` };
      yield { type: "done" };
      return;
    }

    const calls = reply.tool_calls ?? [];

    if (calls.length === 0) {
      const text = (reply.content ?? "").trim() || "I don't have an answer for that.";
      yield { type: "message", text };
      yield { type: "done" };
      return;
    }

    // Record the assistant turn (with tool_calls) so the model has context.
    messages.push({
      role: "assistant",
      content: reply.content ?? "",
      tool_calls: calls,
    });

    for (const call of calls) {
      const name = call.function?.name;
      const args = call.function?.arguments ?? {};
      yield { type: "thinking", text: `Decided to call ${name}` };
      yield { type: "tool_call", name, args };

      const t = toolMap.get(name);
      let result: any;
      if (!t) {
        result = { error: `Unknown tool: ${name}` };
      } else {
        try {
          result = await t.handler(args, ctx);
        } catch (err: any) {
          result = { error: err.message };
        }
      }

      yield { type: "tool_result", name, result };
      messages.push({
        role: "tool",
        content: JSON.stringify(result).slice(0, 20000),
      });
    }

    yield { type: "status", text: "Composing answer…" };
  }

  yield { type: "error", text: "Too many tool iterations. Please rephrase your request." };
  yield { type: "done" };
}