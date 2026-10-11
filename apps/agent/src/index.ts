import cors from "cors";
import express from "express";
import { pool, q } from "./db.js";
import { env } from "./env.js";
import { runAgent, type AgentEvent } from "./agent.js";
import { createApproval } from "./tools/approvals.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

// ---------- helpers ----------
type Ctx = { tenantId: string; userId: string; role: "ADMIN" | "APPROVER" | "STAFF" };

function ctxFromHeaders(req: express.Request): Ctx | null {
  const tenantId = req.header("x-tenant-id");
  const userId = req.header("x-user-id");
  const role = req.header("x-user-role") as Ctx["role"] | undefined;
  if (!tenantId || !userId || !role) return null;
  return { tenantId, userId, role };
}

app.get("/health", (_req, res) => res.json({ ok: true }));

// ---------- chat (SSE) ----------
app.post("/chat", async (req, res) => {
  const ctx = ctxFromHeaders(req);
  if (!ctx) return res.status(400).json({ error: "Missing user context headers" });

  const { message } = req.body as { message: string };
  if (!message?.trim()) return res.status(400).json({ error: "message required" });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const send = (e: AgentEvent) => res.write(`data: ${JSON.stringify(e)}\n\n`);

  try {
    // Verify the user still exists (catches stale JWTs cleanly)
    const user = await q(
      `SELECT id FROM users WHERE id = $1 AND tenant_id = $2`,
      [ctx.userId, ctx.tenantId],
    );
    if (user.length === 0) {
      send({
        type: "error",
        text: "Your session is stale (the user no longer exists). Please sign out and sign in again.",
      });
      send({ type: "done" });
      res.end();
      return;
    }

    await q(
      `INSERT INTO chat_messages (tenant_id, user_id, role, content) VALUES ($1,$2,'user',$3)`,
      [ctx.tenantId, ctx.userId, message],
    );
    const history = await q<{ role: "user" | "assistant"; content: string }>(
      `SELECT role, content FROM chat_messages
        WHERE user_id = $1 ORDER BY created_at DESC LIMIT 12`,
      [ctx.userId],
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
        `INSERT INTO chat_messages (tenant_id, user_id, role, content) VALUES ($1,$2,'assistant',$3)`,
        [ctx.tenantId, ctx.userId, assistantText],
      );
    }
  } catch (err: any) {
    console.error("[agent] /chat error:", err);
    send({ type: "error", text: err.message ?? "Internal error" });
    send({ type: "done" });
  }

  res.end();
});

// ---------- approvals ----------
app.get("/approvals", async (req, res) => {
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

app.post("/approvals/:id", async (req, res) => {
  const ctx = ctxFromHeaders(req);
  if (!ctx) return res.status(400).json({ error: "Missing user context headers" });
  if (ctx.role === "STAFF") return res.status(403).json({ error: "Approver role required" });

  const id = Number(req.params.id);
  const { decision, note } = req.body as { decision: "APPROVED" | "REJECTED"; note?: string };
  if (decision !== "APPROVED" && decision !== "REJECTED")
    return res.status(400).json({ error: "decision must be APPROVED or REJECTED" });

  const row = await q<any>(
    `SELECT * FROM approvals WHERE id=$1 AND tenant_id=$2`,
    [id, ctx.tenantId],
  ).then((r) => r[0]);
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
    `UPDATE approvals SET status=$1, decided_by=$2, decided_at=now(), decision_note=$3
      WHERE id=$4`,
    [decision, ctx.userId, note ?? null, id],
  );
  await q(
    `INSERT INTO audit_log (tenant_id, user_id, action, detail) VALUES ($1,$2,$3,$4)`,
    [ctx.tenantId, ctx.userId, `approval.${decision.toLowerCase()}`, { id, kind: row.kind }],
  );

  res.json({ ok: true });
});

// ---------- approval execution ----------
async function executeApproval(
  ctx: Ctx,
  kind: string,
  payload: any,
  requestedBy: string,
) {
  if (kind === "purchase_requisition") {
    const { sku, quantity, required_by, notes } = payload;
    const item = (
      await q<any>(`SELECT id FROM items WHERE tenant_id=$1 AND sku=$2`, [ctx.tenantId, sku])
    )[0];
    if (!item) throw new Error(`Unknown SKU: ${sku}`);
    const ref = `PR-${Date.now().toString().slice(-8)}`;
    await q(
      `INSERT INTO purchase_requisitions
        (tenant_id, reference, item_id, quantity, required_by, requested_by, notes, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'APPROVED')`,
      [ctx.tenantId, ref, item.id, quantity, required_by ?? null, requestedBy, notes ?? null],
    );
    return;
  }

  if (kind === "stock_adjustment") {
    const { sku, warehouse_code, delta, reason } = payload;
    const row = (
      await q<any>(
        `SELECT i.id AS item_id, w.id AS warehouse_id
           FROM items i, warehouses w
          WHERE i.tenant_id=$1 AND i.sku=$2 AND w.tenant_id=$1 AND w.code=$3`,
        [ctx.tenantId, sku, warehouse_code],
      )
    )[0];
    if (!row) throw new Error(`Unknown SKU or warehouse (${sku}, ${warehouse_code})`);
    await q(
      `INSERT INTO stock (tenant_id, item_id, warehouse_id, quantity)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (item_id, warehouse_id)
       DO UPDATE SET quantity = stock.quantity + EXCLUDED.quantity`,
      [ctx.tenantId, row.item_id, row.warehouse_id, delta],
    );
    await q(
      `INSERT INTO audit_log (tenant_id, user_id, action, detail) VALUES ($1,$2,'stock.adjusted',$3)`,
      [ctx.tenantId, requestedBy, { sku, warehouse_code, delta, reason }],
    );
    return;
  }

  if (kind === "journal_entry") {
    const { debit_account, credit_account, amount, memo } = payload;
    const ref = `JE-${Date.now().toString().slice(-8)}`;
    await q(
      `INSERT INTO journal_entries
        (tenant_id, reference, memo, debit_account, credit_account, amount, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [ctx.tenantId, ref, memo ?? null, debit_account, credit_account, amount, requestedBy],
    );
    return;
  }

  if (kind === "leave_request") {
    const { employee_email, from_date, to_date, reason } = payload;
    const emp = (
      await q<any>(`SELECT id FROM employees WHERE tenant_id=$1 AND email=$2`, [
        ctx.tenantId,
        employee_email,
      ])
    )[0];
    if (!emp) throw new Error(`Unknown employee: ${employee_email}`);
    await q(
      `INSERT INTO leave_requests
        (tenant_id, employee_id, from_date, to_date, reason, status)
       VALUES ($1,$2,$3,$4,$5,'APPROVED')`,
      [ctx.tenantId, emp.id, from_date, to_date, reason ?? null],
    );
    return;
  }

  throw new Error(`No executor for approval kind: ${kind}`);
}

// ---------- settings (ADMIN only) ----------
app.get("/settings", async (req, res) => {
  const ctx = ctxFromHeaders(req);
  if (!ctx) return res.status(400).json({ error: "Missing user context headers" });
  const rows = await q(
    `SELECT provider, base_url, model, temperature FROM agent_settings WHERE tenant_id=$1`,
    [ctx.tenantId],
  );
  res.json({ settings: rows[0] ?? null });
});

app.put("/settings", async (req, res) => {
  const ctx = ctxFromHeaders(req);
  if (!ctx) return res.status(400).json({ error: "Missing user context headers" });
  if (ctx.role !== "ADMIN") return res.status(403).json({ error: "Admin only" });

  const { provider, base_url, model, api_key, temperature } = req.body;
  await q(
    `INSERT INTO agent_settings (tenant_id, provider, base_url, model, api_key, temperature, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6, now())
     ON CONFLICT (tenant_id) DO UPDATE
       SET provider=EXCLUDED.provider,
           base_url=EXCLUDED.base_url,
           model=EXCLUDED.model,
           api_key=COALESCE(EXCLUDED.api_key, agent_settings.api_key),
           temperature=EXCLUDED.temperature,
           updated_at=now()`,
    [ctx.tenantId, provider, base_url, model, api_key ?? null, temperature ?? 0.1],
  );
  res.json({ ok: true });
});

// ---------- history ----------
app.get("/history", async (req, res) => {
  const ctx = ctxFromHeaders(req);
  if (!ctx) return res.status(400).json({ error: "Missing user context headers" });
  const rows = await q(
    `SELECT role, content, created_at FROM chat_messages
      WHERE user_id=$1 ORDER BY created_at ASC LIMIT 200`,
    [ctx.userId],
  );
  res.json({ messages: rows });
});

const server = app.listen(env.PORT, () => {
  console.log(`[agent] listening on http://localhost:${env.PORT}`);
});

process.on("unhandledRejection", (err) => {
  console.error("[agent] unhandledRejection:", err);
});
process.on("uncaughtException", (err) => {
  console.error("[agent] uncaughtException:", err);
});

process.on("SIGINT", async () => {
  await pool.end();
  server.close(() => process.exit(0));
});