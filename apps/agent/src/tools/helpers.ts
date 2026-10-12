import { q, one } from "../db.js";
import type { ToolCtx } from "./types.js";

// ---------- Pagination ----------
export type PageArgs = { limit?: number; offset?: number };

export function pageClause(
  params: any[],
  args: PageArgs,
  defaultLimit = 25,
): { limitIdx: number; offsetIdx: number } {
  const limit = Math.min(Math.max(args.limit ?? defaultLimit, 1), 200);
  const offset = Math.max(args.offset ?? 0, 0);
  params.push(limit);
  const limitIdx = params.length;
  params.push(offset);
  const offsetIdx = params.length;
  return { limitIdx, offsetIdx };
}

// ---------- Idempotency ----------
export async function checkIdempotency(
  ctx: ToolCtx,
  toolName: string,
  key: string | undefined,
): Promise<any | null> {
  if (!key) return null;
  const row = await one<{ response: any }>(
    `SELECT response FROM idempotency_keys WHERE key=$1 AND tenant_id=$2`,
    [key, ctx.tenantId],
  );
  if (row) return { ...row.response, idempotent_replay: true };
  return null;
}

export async function recordIdempotency(
  ctx: ToolCtx,
  toolName: string,
  key: string | undefined,
  response: any,
): Promise<void> {
  if (!key) return;
  await q(
    `INSERT INTO idempotency_keys (key, tenant_id, user_id, tool_name, response)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (key) DO NOTHING`,
    [key, ctx.tenantId, ctx.userId, toolName, response],
  );
}

// ---------- Retry ----------
export async function withRetry<T>(
  fn: () => Promise<T>,
  attempts = 3,
  delayMs = 150,
): Promise<T> {
  let lastErr: any;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      // Retry only on transient class errors (deadlock, serialization, connection reset)
      const code = err?.code;
      const transient = ["40001", "40P01", "57P03", "08006", "08001", "08004"];
      if (!transient.includes(code) || i === attempts - 1) throw err;
      await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
    }
  }
  throw lastErr;
}

// ---------- Read audit (use sparingly — sensitive reads only) ----------
export async function auditRead(
  ctx: ToolCtx,
  toolName: string,
  detail: any = {},
): Promise<void> {
  await q(
    `INSERT INTO audit_log (tenant_id, user_id, action, detail) VALUES ($1,$2,$3,$4)`,
    [ctx.tenantId, ctx.userId, `read.${toolName}`, detail],
  );
}

// ---------- Reference generator ----------
export function ref(prefix: string, digits = 6): string {
  return `${prefix}-${Date.now().toString().slice(-digits)}`;
}