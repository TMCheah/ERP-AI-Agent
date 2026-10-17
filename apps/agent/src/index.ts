import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import { pool, q } from "./db.js";
import { env } from "./env.js";
import { runAgent, type AgentEvent } from "./agent.js";
import { executeApproval } from "./approval-executor.js";
import { getModuleCards } from "./modules.js";
import { listAllDrafts } from "./drafts.js";
import { testConnection, demoSettings, type LlmSettings } from "./llm.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

// ---------- Rate limiting ----------
// 60 chat requests per 5 min per user (default for POST /chat and /approvals/:id)
const chatLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 60,
  keyGenerator: (req) => req.header("x-user-id") ?? "anon",
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please slow down." },
});

// 200 reads per minute per user
const readLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  keyGenerator: (req) => req.header("x-user-id") ?? "anon",
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many reads. Please slow down." },
});

type Ctx = { tenantId: string; userId: string; role: "ADMIN" | "APPROVER" | "STAFF" };

function ctxFromHeaders(req: express.Request): Ctx | null {
  const tenantId = req.header("x-tenant-id");
  const userId = req.header("x-user-id");
  const role = req.header("x-user-role") as Ctx["role"] | undefined;
  if (!tenantId || !userId || !role) return null;
  return { tenantId, userId, role };
}

app.get("/health", (_req, res) => res.json({ ok: true }));

// ---------- Conversations ----------
app.get("/conversations", readLimiter, async (req, res) => {
  const ctx = ctxFromHeaders(req);
  if (!ctx) return res.status(400).json({ error: "Missing user context" });
  const rows = await q(
    `SELECT id, title, updated_at FROM conversations WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 50`,
    [ctx.userId],
  );
  res.json({ conversations: rows });
});

app.post("/conversations", async (req, res) => {
  const ctx = ctxFromHeaders(req);
  if (!ctx) return res.status(400).json({ error: "Missing user context" });
  const title = (req.body?.title as string) || "New chat";
  const row = (await q<any>(
    `INSERT INTO conversations (tenant_id, user_id, title) VALUES ($1,$2,$3) RETURNING id, title, created_at`,
    [ctx.tenantId, ctx.userId, title],
  ))[0];
  res.json({ conversation: row });
});

app.get("/conversations/:id/messages", readLimiter, async (req, res) => {
  const ctx = ctxFromHeaders(req);
  if (!ctx) return res.status(400).json({ error: "Missing user context" });
  const rows = await q(
    `SELECT role, content, created_at FROM chat_messages
      WHERE conversation_id=$1 AND user_id=$2 ORDER BY created_at ASC LIMIT 500`,
    [Number(req.params.id), ctx.userId],
  );
  res.json({ messages: rows });
});

// ---------- Chat ----------
app.post("/chat", chatLimiter, async (req, res) => {
  const ctx = ctxFromHeaders(req);
  if (!ctx) return res.status(400).json({ error: "Missing user context headers" });
  const { message, conversation_id } = req.body as { message: string; conversation_id?: number };
  if (!message?.trim()) return res.status(400).json({ error: "message required" });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const send = (e: AgentEvent) => res.write(`data: ${JSON.stringify(e)}\n\n`);

  try {
    const user = await q(`SELECT id FROM users WHERE id=$1 AND tenant_id=$2`, [ctx.userId, ctx.tenantId]);
    if (user.length === 0) {
      send({ type: "error", text: "Your session is stale. Please sign out and in." });
      send({ type: "done" });
      return res.end();
    }

    let convId = conversation_id;
    if (!convId) {
      const existing = await q<any>(
        `SELECT id FROM conversations WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 1`,
        [ctx.userId],
      );
      if (existing.length) convId = existing[0].id;
      else {
        const created = await q<any>(
          `INSERT INTO conversations (tenant_id, user_id, title) VALUES ($1,$2,$3) RETURNING id`,
          [ctx.tenantId, ctx.userId, message.slice(0, 60)],
        );
        convId = created[0].id;
      }
    }

    await q(
      `INSERT INTO chat_messages (tenant_id, user_id, conversation_id, role, content)
       VALUES ($1,$2,$3,'user',$4)`,
      [ctx.tenantId, ctx.userId, convId, message],
    );
    await q(`UPDATE conversations SET updated_at=now() WHERE id=$1`, [convId]);

    const history = await q<{ role: "user" | "assistant"; content: string }>(
      `SELECT role, content FROM chat_messages
        WHERE user_id=$1 AND conversation_id=$2 ORDER BY created_at DESC LIMIT 12`,
      [ctx.userId, convId],
    );
    history.reverse();
    history.pop();

    let assistantText = "";
    for await (const evt of runAgent(ctx, history, message)) {
      if (evt.type === "message") assistantText += evt.text;
      send(evt);
    }
    if (assistantText) {
      await q(
        `INSERT INTO chat_messages (tenant_id, user_id, conversation_id, role, content)
         VALUES ($1,$2,$3,'assistant',$4)`,
        [ctx.tenantId, ctx.userId, convId, assistantText],
      );
    }
  } catch (err: any) {
    console.error("[agent] /chat error:", err);
    send({ type: "error", text: err.message ?? "Internal error" });
    send({ type: "done" });
  }
  res.end();
});

app.get("/drafts", readLimiter, async (req, res) => {
  const ctx = ctxFromHeaders(req);
  if (!ctx) return res.status(400).json({ error: "Missing user context headers" });
  try {
    const rows = await listAllDrafts(ctx);
    res.json({ count: rows.length, rows });
  } catch (err: any) {
    console.error("[agent] /drafts error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- Approvals ----------
app.get("/approvals", readLimiter, async (req, res) => {
  const ctx = ctxFromHeaders(req);
  if (!ctx) return res.status(400).json({ error: "Missing user context headers" });
  try {
    const status = (req.query.status as string) || "PENDING";
    const rows = await q(
      `SELECT a.id, a.kind, a.summary, a.payload, a.status, a.created_at,
              a.decided_at, a.decision_note,
              ru.full_name AS requested_by_name,
              du.full_name AS decided_by_name
         FROM approvals a
         LEFT JOIN users ru ON ru.id = a.requested_by
         LEFT JOIN users du ON du.id = a.decided_by
        WHERE a.tenant_id = $1 AND ($2 = 'ALL' OR a.status = $2)
        ORDER BY a.created_at DESC LIMIT 200`,
      [ctx.tenantId, status],
    );
    res.json({ approvals: rows });
  } catch (err: any) {
    console.error("[agent] /approvals error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/approvals/:id", chatLimiter, async (req, res) => {
  const ctx = ctxFromHeaders(req);
  if (!ctx) return res.status(400).json({ error: "Missing user context headers" });
  if (ctx.role === "STAFF") return res.status(403).json({ error: "Approver role required" });

  const id = Number(req.params.id);
  const { decision, note } = req.body as { decision: "APPROVED" | "REJECTED"; note?: string };
  if (decision !== "APPROVED" && decision !== "REJECTED")
    return res.status(400).json({ error: "decision must be APPROVED or REJECTED" });

  const row = (await q<any>(`SELECT * FROM approvals WHERE id=$1 AND tenant_id=$2`, [id, ctx.tenantId]))[0];
  if (!row) return res.status(404).json({ error: "Not found" });
  if (row.status !== "PENDING") return res.status(409).json({ error: "Already decided" });

  if (decision === "APPROVED") {
    try {
      await executeApproval(ctx, row.kind, row.payload, row.requested_by);
    } catch (err: any) {
      return res.status(500).json({ error: `Execution failed: ${err.message}` });
    }
  }

  await q(
    `UPDATE approvals SET status=$1, decided_by=$2, decided_at=now(), decision_note=$3 WHERE id=$4`,
    [decision, ctx.userId, note ?? null, id],
  );
  await q(
    `INSERT INTO audit_log (tenant_id, user_id, action, detail) VALUES ($1,$2,$3,$4)`,
    [ctx.tenantId, ctx.userId, `approval.${decision.toLowerCase()}`, { id, kind: row.kind }],
  );
  res.json({ ok: true });
});

// ---------- Settings ----------
app.get("/settings", readLimiter, async (req, res) => {
  const ctx = ctxFromHeaders(req);
  if (!ctx) return res.status(400).json({ error: "Missing user context headers" });
  const rows = await q(
    `SELECT provider, base_url, model, temperature, is_demo_mode FROM agent_settings WHERE tenant_id=$1`,
    [ctx.tenantId],
  );
  res.json({ settings: rows[0] ?? null });
});

app.put("/settings", async (req, res) => {
  const ctx = ctxFromHeaders(req);
  if (!ctx) return res.status(400).json({ error: "Missing user context headers" });
  if (ctx.role !== "ADMIN") return res.status(403).json({ error: "Admin only" });

  const { provider, base_url, model, api_key, temperature, is_demo_mode } = req.body;
  await q(
    `INSERT INTO agent_settings (tenant_id, provider, base_url, model, api_key, temperature, is_demo_mode, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7, now())
     ON CONFLICT (tenant_id) DO UPDATE
       SET provider=EXCLUDED.provider,
           base_url=EXCLUDED.base_url,
           model=EXCLUDED.model,
           api_key=COALESCE(EXCLUDED.api_key, agent_settings.api_key),
           temperature=EXCLUDED.temperature,
           is_demo_mode=EXCLUDED.is_demo_mode,
           updated_at=now()`,
    [ctx.tenantId, provider, base_url, model, api_key || null, temperature ?? 0.1, is_demo_mode ?? false],
  );
  res.json({ ok: true });
});

// ---------- Settings: connection test ----------
app.post("/settings/test", chatLimiter, async (req, res) => {
  const ctx = ctxFromHeaders(req);
  if (!ctx) return res.status(400).json({ error: "Missing user context headers" });
  if (ctx.role !== "ADMIN") return res.status(403).json({ error: "Admin only" });

  const { provider, base_url, model, api_key, temperature, is_demo_mode } = req.body ?? {};
  let settings: LlmSettings;
  if (is_demo_mode) {
    settings = demoSettings();
  } else {
    let key: string | null = api_key || null;
    if (!key) {
      // "Leave blank to keep existing": reuse the saved key, but only for the same provider
      const saved = (await q<any>(
        `SELECT provider, api_key FROM agent_settings WHERE tenant_id=$1`,
        [ctx.tenantId],
      ))[0];
      if (saved?.provider === provider) key = saved.api_key ?? null;
    }
    settings = { provider, base_url, model, api_key: key, temperature: Number(temperature ?? 0.1) };
  }

  try {
    res.json(await testConnection(settings));
  } catch (err: any) {
    res.status(500).json({ ok: false, message: err.message ?? "Test failed" });
  }
});

app.get("/modules/:key/list", readLimiter, async (req, res) => {
  const ctx = ctxFromHeaders(req);
  if (!ctx) return res.status(400).json({ error: "Missing user context headers" });
  const key = req.params.key;
  const bucket = (req.query.bucket as string) || "all";
  if (!["pending", "complete", "all"].includes(bucket)) {
    return res.status(400).json({ error: "bucket must be pending | complete | all" });
  }
  try {
    const rows = await getModuleCards(key, ctx, bucket as any);
    res.json({ module: key, bucket, count: rows.length, rows });
  } catch (err: any) {
    console.error("[agent] /modules error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- Safety nets ----------
process.on("unhandledRejection", (err) => console.error("[agent] unhandledRejection:", err));
process.on("uncaughtException", (err) => console.error("[agent] uncaughtException:", err));

const server = app.listen(env.PORT, () => {
  console.log(`[agent] listening on http://localhost:${env.PORT}`);
});

process.on("SIGINT", async () => {
  await pool.end();
  server.close(() => process.exit(0));
});