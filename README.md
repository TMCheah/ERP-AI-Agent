# ERP — Natural-Language-First Enterprise System

A working ERP where users interact with **one chat box** instead of dozens of forms. The LLM reads intent, calls typed tools, and writes to PostgreSQL — with approval gates on anything that moves money, stock, or people.

Built as a **monorepo** with a Next.js web app, an Express API service that hosts the agent, and PostgreSQL.

---

## Table of contents

- [What this is](#what-this-is)
- [What works today](#what-works-today)
- [Architecture](#architecture)
- [Tech stack](#tech-stack)
- [Quick start](#quick-start)
- [Configuring the LLM](#configuring-the-llm)
- [Using the system](#using-the-system)
- [Module coverage](#module-coverage)
- [Tool catalog](#tool-catalog)
- [Data model](#data-model)
- [Approval system](#approval-system)
- [Troubleshooting](#troubleshooting)
- [Roadmap](#roadmap)
- [Project layout](#project-layout)

---

## What this is

Traditional ERPs fail users in three ways:

1. **Form overload** — every screen has 40 fields, none of them explained.
2. **Rigid base framework** — client requirements never fit the provider's model, so you pay for workarounds that half-work.
3. **Migration friction** — the fields you need don't exist, so data never makes it in.

This system inverts the interface. Instead of forms, you type:

> *"Show me all pens with selling price above $5 and more than 100 in stock"*
>
> *"We need 500 units of SKU-1001 for the marketing team by November 1st"*
>
> *"Add a new HR named Henry, then create his user account"*
>
> *"Convert Rina Tan to a customer and open a ticket for her"*

The LLM identifies intent, calls the right tools, and returns either an answer (as a table) or an approval-gated action. **No forms. No fields. No validation errors.**

---

## What works today

### Fully working
- Login with JWT session cookies (`ADMIN` / `APPROVER` / `STAFF` roles)
- Streaming chat with Ollama, OpenAI, OpenRouter, Google Gemini, or any OpenAI-compatible endpoint
- Multi-step tool calling (the model can chain tools, e.g. create employee → create user)
- **~116 tools** across 13 modules (see [Tool catalog](#tool-catalog))
- Approval queue with approve/reject and immediate execution
- Full procurement chain: PR → PO → GRN → goods return
- Item catalog CRUD with soft-delete and opening stock
- Admin settings page with provider selection
- Prompt suggestion tabs per module
- Multi-conversation chat history
- Stock movements audit trail linked to GRN/returns/work orders
- Payroll, fixed assets with depreciation, FX conversion, time & attendance, hiring pipeline, performance reviews, contracts, RFQ, MRP, barcode lookup
- Rate limiting, idempotency keys, retry on transient DB errors
- Hallucination guard (forces a tool call if the model answers data questions from memory)

### Stubs / partial
- Manufacturing has BOM + work orders but no shop-floor terminal, no routing operations, no capacity planning
- Payroll uses a flat 11% tax rate — no real tax tables
- Reporting has 6 reports; no custom report builder
- Fixed assets do straight-line depreciation only (no revaluation, no partial disposal)
- No email, SMS, or push notifications
- No scheduled/cron jobs (SLA escalation would need Cloud Scheduler or similar)

### Not built
- Workflow engine (currently a single-step approval queue — see [Roadmap](#roadmap))
- Bank reconciliation
- Multi-currency on invoices (FX exists but invoices are single-currency)
- Barcode/RFID hardware integration (barcode lookup exists, scanning doesn't)
- Any kind of BPMN / visual flow editor

---

## Architecture

```
┌─────────────────────┐
│      Browser        │
│  Next.js UI :3000   │
└──────────┬──────────┘
           │  HTTPS, session cookie
           ▼
┌─────────────────────┐      SSE stream      ┌──────────────────────┐
│  Next.js (web)      │ ───────────────────► │  Express (agent)     │
│  apps/web           │                      │  apps/agent :8787    │
│                     │ ◄─── JSON + SSE ──── │                      │
│  - Auth middleware  │                      │  - Tool registry     │
│  - API proxies      │                      │  - LLM adapters      │
│  - Chat UI          │                      │  - Approval queue    │
└─────────────────────┘                      └──────────┬───────────┘
                                                        │
                                           ┌────────────┼────────────┐
                                           ▼            ▼            ▼
                                    ┌────────────┐ ┌───────────┐ ┌─────────┐
                                    │ PostgreSQL │ │  Ollama   │ │ OpenAI/ │
                                    │  :5432     │ │  :11434   │ │ etc.    │
                                    └────────────┘ └───────────┘ └─────────┘
```

- **`apps/web`** — Next.js 14 App Router. Serves the UI, enforces session, proxies `/api/chat`, `/api/approvals`, `/api/settings`, and `/api/chat/history` to the agent. Loads chat history from the DB on mount so tabs can be switched without losing context.
- **`apps/agent`** — Express + TypeScript. Hosts the tool registry (one file per module), LLM adapters, the streaming agent loop, the approval executor, and the settings API. Talks to PostgreSQL via `pg`.
- **PostgreSQL** — all persistent state: users, items, stock, movements, approvals, conversations, audit log.
- **LLM provider** — pluggable per-tenant via `agent_settings`. See [Configuring the LLM](#configuring-the-llm).

**Key security property:** the browser never talks to the agent directly. The Next.js server is the only client that holds the shared session and forwards the user's tenant/user/role headers. The agent trusts those headers *only* because it's on a private network (localhost in dev, VPC in prod).

---

## Tech stack

| Layer | Technology | Notes |
|---|---|---|
| Frontend | Next.js 14 (App Router) + React 18 | Server components for auth, client components for chat |
| Styling | Tailwind CSS | Dark corporate theme, no component library |
| Auth | `jose` JWT + HttpOnly cookie | 7-day expiry, verified in middleware |
| Backend | Node.js + Express 4 (TypeScript) | Hand-written routes, no framework magic |
| DB driver | `pg` (node-postgres) | Connection pool, parameterized queries |
| Database | PostgreSQL 16 (Docker) | Schema in `db/schema*.sql` |
| LLM orchestration | Custom agent loop | No LangChain, no ADK — a `for` loop that runs tool calls |
| LLM providers | Ollama, OpenAI, OpenRouter, Google, OpenAI-compatible | All via HTTP, no SDKs |
| Streaming | Server-Sent Events (SSE) | One-way server→client for chat |
| Rate limiting | `express-rate-limit` | 60 chat req/5min, 200 reads/min per user |
| Build | `tsx` (dev), `tsc` (prod), `next build` | No bundler for the agent |

**Not used:** PostgREST, Prisma, Drizzle, TypeORM, LangChain, LlamaIndex, Vercel AI SDK, tRPC.

---

## Quick start

### Prerequisites

- **Node.js 20.6+** (`node --version` — needed for native `--env-file`)
- **Docker Desktop** (for Postgres)
- **Ollama** — https://ollama.com/download
- **A tool-capable model** — run `ollama pull gemma4:12b`

### Setup

```powershell
# 1. Clone / open in your terminal
cd D:\ERP-AI-Agent

# 2. Start Postgres
docker compose up -d

# 3. Pull a tool-capable model
ollama pull gemma4:12b

# 4. Copy env files
copy .env.example .env
copy .env.example apps\web\.env.local
copy .env.example apps\agent\.env

# 5. Install all workspaces
npm install

# 6. Find the Postgres container name
docker ps
#    note the NAMES column, e.g. ERP-AI-Agent-db-1

# 7. Load schema (in order)
Get-Content db\schema.sql            | docker exec -i <container> psql -U erp -d erp
Get-Content db\seed.sql              | docker exec -i <container> psql -U erp -d erp

# 8. Run both services
npm run dev
```

Open **http://localhost:3000**.

### Demo logins (password: `password123`)

| Email | Role | What they can do |
|---|---|---|
| `admin@magent.test` | ADMIN | Everything — approve, run payroll, manage settings, create users |
| `approver@magent.test` | APPROVER | Approve requests, adjust stock, void invoices |
| `staff@magent.test` | STAFF | Read-only + create requests. No approvals. |

> "magent" is a placeholder tenant name from Looney Tunes. Rename it by editing `NEXT_PUBLIC_APP_NAME` in `.env` and `UPDATE tenants SET name='...'` in the DB.

---

## Configuring the LLM

Log in as `admin@magent.test` → **Settings**.

### Supported providers

| Provider | Model examples | Notes |
|---|---|---|
| **Ollama** | `gemma4:12b`, `qwen2.5:14b`, `llama3.1:8b`, `mistral-nemo`, `hermes3`, `phi4` | Must support **tool calling** — Gemma, Llama 2, and Mistral v0.1/0.2 do **not** |
| **OpenAI** | `gpt-4o-mini`, `gpt-4o` | Requires API key |
| **OpenRouter** | `anthropic/claude-3.5-sonnet`, `meta-llama/llama-3.1-70b-instruct`, etc. | One key, many models |
| **Google** | `gemini-1.5-pro`, `gemini-1.5-flash` | Uses Google's OpenAI-compatible endpoint |
| **OpenAI-compatible** | vLLM, LM Studio, LocalAI, etc. | Any endpoint that implements `/v1/chat/completions` with tools |

### Model requirements

The model **must** support function/tool calling. If it doesn't, the agent will hallucinate data — you'll ask *"show me all employees"* and get made-up names. The agent detects this (hallucination guard) and retries once, but the fix is to use a capable model.

**Verified tool-capable models:** qwen2.5 (all sizes), llama3.1/3.2/3.3, mistral-nemo, hermes3, phi4, command-r, firefunction-v2, gpt-4o-mini, claude-3.5.

**Known NOT to work:** gemma2, gemma3, llama2, mistral v0.1/0.2, deepseek-r1 (reasoning-only).

### Timeout

Hard-coded to **10 minutes per LLM turn** (in `apps/agent/src/llm.ts`). Multi-step tool loops can compound this — a 5-tool sequence on a 32B model can take minutes.

---

## Using the system

### Sidebar navigation

- **Chat** — the primary tab. Full multi-turn conversation with history.
- **Module tabs** (Financials, Inventory, People, …) — each opens Chat with **quick prompt suggestions** for that module. Clicking a suggestion fills the input box so you can edit and send.
- **Approvals** — pending queue with approve/reject buttons.
- **Settings** — LLM config, admin-only.

Switching tabs preserves chat history — messages are persisted per-conversation in the DB and reloaded on mount.

### Prompt examples

**Inventory**
```
Show me all pens in stock
What items are below reorder point?
Adjust SKU-1002 at WH-KUL down by 20 due to damage
Transfer 50 units of SKU-1002 from WH-KUL to WH-PEN
Lookup barcode PKG-BLUE-001
```

**Procurement**
```
List all vendors
We need 500 units of SKU-1001 by 2026-11-01
Create vendor V-003 'Ink Supplies Ltd' with email orders@ink.test
Create a PO for V-001 with 100 units of SKU-1001 at $2 each
Receive 30 units of SKU-1001 from PO-XXXX into WH-KUL
Receive the rest of PO-XXXX into WH-KUL
List goods receipts
Create a goods return from GRN-XXXX: return 10x SKU-9100, reason "damaged"
```

**Finance**
```
Show me all overdue invoices
Mark invoice INV-1002 as paid
Void invoice INV-1001 because the customer disputed it
Post a journal entry: debit 5000, credit 2000, $1,500 for supplies
List all GL accounts
```

**HCM**
```
Show me all employees
Create employee Jane Tan, jane@magent.test, Sales Manager
Create a login for employee 4 with role APPROVER
Change Sam Staff's department to Finance
Clock in sam@magent.test
Log 40 hours timesheet for sam@magent.test week of 2026-10-06
Create job opening Senior Engineer, Engineering
Add applicant Angela Wong to JOB-XXXX
```

**CRM**
```
List CRM leads in PROPOSAL stage
Create a lead for Rina Tan at Nova Retail, $25,000
Convert lead Rina Tan to a customer
Create a ticket: 'Login not working', priority HIGH, customer C-001
Assign ticket T-1001 to staff@magent.test
```

**Manufacturing**
```
List all BOMs
Show me the BOM for SKU-1001
Create a work order for 100 units of SKU-1001
Calculate MRP for SKU-1001, quantity 500
Complete work order WO-XXXX at WH-KUL
```

**Payroll / Assets / FX**
```
Create payroll for 2026-10-01 to 2026-10-31
Show payslips for PRUN-XXXX
Mark payroll PRUN-XXXX as paid
List fixed assets
Register asset FA-100 'Forklift' cost $25,000 purchased today, life 60 months
Depreciate FA-100 for 3 periods
Convert 1000 USD to MYR
```

**Reporting**
```
What is my total inventory valuation?
Show me the AR aging report
What's the trial balance?
Show headcount by department
Show me the sales pipeline
```

**Multi-step**
```
Add a new HR, his name is Henry. Create an employee and a user.
Create employee Jane Tan then open a job opening for her role
List all employees and all overdue invoices
```

---

## Module coverage

| Module | Coverage | Missing |
|---|---|---|
| Inventory | ~85% | Real-time alerts, RFID hardware |
| Procurement | ~90% | Vendor scorecards, scheduled contracts |
| Finance | ~70% | Bank rec, tax tables, invoice FX |
| HCM | ~75% | Benefits admin, org chart, real tax withholding |
| Manufacturing | ~75% | Shop-floor terminal, routing, capacity |
| CRM | ~70% | Activity logging, email integration, quotes |
| Projects | ~80% | Billing, dependencies, milestone profit |
| Reporting | ~85% | Custom report builder |
| Payroll | ~40% | Real tax tables, benefits, deductions |
| Fixed assets | ~70% | Revaluation, partial disposal |
| FX | ~60% | Historical conversion, invoice revaluation |
| Time & attendance | ~60% | Overtime rules, shift scheduling |
| Recruitment | ~70% | Interviews, offer letters |
| Performance | ~50% | Goals, 360 reviews |
| Contracts | ~60% | Renewals, alerts, amendments |
| RFQ | ~85% | — |
| Barcode | ~50% | RFID hardware, scanning app |
| Workflow engine | 0% | See [Roadmap](#roadmap) |

---

## Tool catalog

**~116 tools.** All live in `apps/agent/src/tools/`. Each file is one module.

| Module | File | Tools |
|---|---|---|
| Catalog | `items.ts` | create_item, update_item, deactivate_item, activate_item, list_items, get_item |
| Inventory | `inventory.ts` | query_inventory, list_warehouses, create_warehouse, transfer_stock, adjust_stock, list_stock_movements |
| Barcode | `barcode.ts` | lookup_barcode, set_item_barcode |
| Procurement | `procurement.ts` | create_purchase_requisition, list_purchase_requisitions, cancel_purchase_requisition, create_vendor, update_vendor, delete_vendor, list_vendors, create_purchase_order, list_purchase_orders, get_purchase_order |
| Goods receipt | `goods_receipt.ts` | receive_purchase_order, list_goods_receipts, get_goods_receipt, create_goods_return, list_goods_returns |
| Procurement extra | `procurement_extra.ts` | create_contract, list_contracts, terminate_contract, create_rfq, submit_rfq_quote, compare_rfq_quotes, award_rfq |
| Finance | `finance.ts` | list_invoices, create_invoice, update_invoice, mark_invoice_paid, void_invoice, list_gl_accounts, create_gl_account, create_journal_entry, list_journal_entries |
| FX | `fx.ts` | set_fx_rate, list_fx_rates, convert_currency |
| Fixed assets | `fixed_assets.ts` | create_fixed_asset, list_fixed_assets, depreciate_asset, dispose_asset |
| HCM | `hcm.ts` | find_employee, update_employee, deactivate_employee, request_leave, list_leave_requests |
| HCM admin | `hcm_admin.ts` | create_employee, create_user |
| HCM extra | `hcm_extra.ts` | clock_in, clock_out, log_timesheet, list_time_entries, create_job_opening, list_job_openings, add_applicant, update_applicant_status, hire_applicant, create_performance_review, list_performance_reviews |
| Payroll | `payroll.ts` | create_payroll_run, list_payroll_runs, list_payslips, mark_payroll_paid |
| CRM | `crm.ts` | list_leads, create_lead, update_lead, delete_lead, convert_lead_to_customer, list_customers, create_customer, update_customer, list_tickets, create_ticket, assign_ticket, close_ticket |
| Manufacturing | `manufacturing.ts` | create_bom, list_boms, get_bom_details, delete_bom, create_work_order, list_work_orders, complete_work_order |
| MRP | `mrp.ts` | calculate_mrp, forecast_demand |
| Projects | `projects.ts` | list_projects, create_project, update_project, list_project_tasks, add_project_task, update_project_task, complete_project_task, delete_project_task, log_time |
| Reporting | `reporting.ts` | report_inventory_valuation, report_ar_aging, report_trial_balance, report_headcount, report_low_stock, report_sales_pipeline |
| Approvals | `approvals.ts` | list_my_approvals, approve_request, reject_request |

### Adding a tool

1. Pick the module file (or create a new one in `apps/agent/src/tools/`)
2. Export a `tool({ name, description, parameters, handler })`
3. Register it in `apps/agent/src/tools/index.ts`
4. Restart `npm run dev`

The description is what the LLM sees when deciding which tool to call — write it like you're explaining the tool to a smart intern.

---

## Data model

All tables carry `tenant_id` for multi-tenancy (single-tenant today, but the schema supports many).

### Core
- `tenants`, `users`, `agent_settings`, `audit_log`, `idempotency_keys`

### Catalog & inventory
- `items` — SKU, name, category, unit, prices, reorder point, barcode, `deleted_at`
- `warehouses`, `stock` (item × warehouse qty), `stock_movements` (audit trail)

### Procurement
- `vendors`
- `purchase_requisitions` (PR) — pending approval → APPROVED/CANCELLED
- `purchase_orders` (PO) + `purchase_order_lines` (with `received_qty`)
- `goods_receipts` (GRN) + `goods_receipt_lines`
- `goods_returns` + `goods_return_lines`
- `contracts`, `rfqs`, `rfq_quotes`

### Finance
- `gl_accounts`, `invoices`, `journal_entries`
- `fx_rates`, `fixed_assets`

### HCM
- `employees` (with `deactivated_at`, `user_id`)
- `leave_requests`, `time_entries`, `timesheets`
- `job_openings`, `applicants`, `performance_reviews`
- `payroll_runs`, `payslips`

### CRM
- `leads`, `customers`, `tickets`

### Manufacturing & projects
- `boms`, `bom_lines`, `work_orders`
- `projects`, `project_tasks`

### Approvals & chat
- `approvals` — the queue
- `conversations`, `chat_messages`

### Schema files

| File | Purpose |
|---|---|
| `db/schema.sql` | Core tables, first 60% of the system |
| `db/seed.sql` | Demo tenant, users, items, warehouses, vendors |

Run them in that order. All are idempotent-ish (`IF NOT EXISTS`, `ON CONFLICT`).

---

## Approval system

Anything that moves money, stock, or people is gated. The pattern:

1. User asks the agent to do something (e.g. *"create a PO for 100 units of SKU-1001"*)
2. The tool calls `createApproval()` — writes a row to `approvals` with `status='PENDING'`
3. The agent returns `{ status: "PENDING_APPROVAL", approval_id: 42 }` — **nothing has happened yet**
4. The approver sees it in the **Approvals** tab and clicks Approve or Reject
5. On approve, `executeApproval()` runs the real DB writes
6. On reject, the approval is marked `REJECTED` and nothing executes

### What's gated

`purchase_requisition`, `purchase_order`, `invoice`, `journal_entry`, `stock_adjustment`, `stock_transfer`, `leave_request`, `work_order`, `goods_return`

### What's immediate

Master data (vendors, customers, items, employees, users, leads, projects, BOMs, GL accounts, warehouses, assets) and all reads.

### Approving from chat

APPROVER and ADMIN can also approve by chat:
```
List my pending approvals
Approve request #42
Reject request #43 with note: budget exceeded
```

### Roles

| Action | STAFF | APPROVER | ADMIN |
|---|---|---|---|
| Query anything | ✅ | ✅ | ✅ |
| Create master data | ✅ | ✅ | ✅ |
| Queue approvals | ✅ | ✅ | ✅ |
| Approve / reject | ❌ | ✅ | ✅ |
| Adjust stock / void invoices | ❌ | ✅ | ✅ |
| Run payroll / deactivate items | ❌ | ✅ | ✅ |
| Create users | ❌ | ❌ | ✅ |
| Change LLM settings | ❌ | ❌ | ✅ |

---

## Troubleshooting

### Agent won't start

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'X'
```
Run `npm install` from the **repo root** (not from `apps/agent`).

```
[agent] listening on http://localhost:8787
```
If this doesn't appear in the combined `npm run dev` output, run the agent alone to see its error:
```powershell
npm run dev -w apps/agent
```

### `ECONNREFUSED` on port 8787

The web app can't reach the agent. Either the agent crashed, or the port is taken.
```powershell
netstat -ano | findstr :8787
curl http://localhost:8787/health   # should print {"ok":true}
```

### Port 3000 or 8787 already in use

```powershell
Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique |
  ForEach-Object { Stop-Process -Id $_ -Force }
```
Change 3000 → 8787 for the agent.

### `relation "users" does not exist`

The schema wasn't loaded. Run the schema files (see [Quick start](#quick-start) step 7).

### `client password must be a string` (SASL error)

`DATABASE_URL` is missing. Create `apps/web/.env.local` and `apps/agent/.env` with:
```
DATABASE_URL=postgres://erp:erp@localhost:5432/erp
```
Restart `npm run dev`.

### Session stale after re-seeding

If you re-run `seed.sql`, all user IDs change. **Log out and log back in.** The old JWT points at a user that no longer exists.

### Model hallucinates data (Alice, Bob, Charlie)

You're using a non-tool-capable model. Switch to `gemma4:12b` or better in **Settings**. See [Configuring the LLM](#configuring-the-llm).

### Chat takes forever / times out

Multi-step tool chains on a large local model can take minutes. The timeout is 10 minutes per turn. Reduce `MAX_ITERATIONS` in `apps/agent/src/agent.ts` or switch to a smaller model.

### Both tables render twice in chat

You have an old `ChatPane.tsx`. Replace with the version in the Tier 2 delivery — the streaming bubble and the final message were duplicating.

### Windows: `docker exec -i` fails with `<` reserved

PowerShell doesn't do Unix redirection. Use:
```powershell
Get-Content db\schema.sql | docker exec -i <container> psql -U erp -d erp
```

---

## Roadmap

### Next: Workflow engine

Currently, approvals are a **single-step queue**, not a workflow. There's no notion of "PR needs Manager then Finance then CFO". The next major addition is a real engine:

| Layer | Table | Purpose |
|---|---|---|
| Definition | `workflow_definitions` | Named flow per entity type, versioned |
| Steps | `workflow_steps` | Ordered approvers, conditions (JSONLogic), roles |
| Instance | `workflow_instances` | One running request through a definition |
| History | `workflow_step_events` | Immutable event log per instance |

Admin UI would render definitions as Mermaid flowcharts, and the LLM would gain three tools: `list_workflows`, `update_workflow`, `explain_workflow`. Chat would handle edits like *"add CFO approval if amount > $50k to the PO workflow"*.

**Design considerations before building:**
- Use **JSONLogic** for conditions (small, LLM-friendly, well-specified)
- Start with **role-based sequential** approvers — parallel and delegation come later
- Keep the existing `approvals` table for entity types without a definition (backwards compat)
- SLA / escalation needs a background worker (Cloud Scheduler or a long-running job)

### Other pending work

- Bank reconciliation
- Real tax tables for payroll
- Multi-currency on invoices (FX module exists)
- Email / Slack notifications for approvals
- Custom report builder
- Vendor scorecards with trends
- Benefit administration (health, 401k, etc.)
- Shop-floor terminal for Manufacturing
- Barcode/RFID scanning app

---

## Project layout

```
erp-nl/
├── package.json                # Workspace root
├── docker-compose.yml          # Postgres
├── .env.example                # Template — copy to .env
├── README.md                   # ← you are here
│
├── db/
│   ├── schema.sql              # Core tables
│   └── seed.sql                # Demo data
│
├── apps/
│   ├── agent/                  # Express API — the "backend"
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts        # Express routes
│   │       ├── env.ts
│   │       ├── db.ts           # pg Pool
│   │       ├── llm.ts          # Provider adapters, streaming
│   │       ├── agent.ts        # The tool-calling loop
│   │       ├── prompt.ts       # System prompt
│   │       ├── approval-executor.ts  # Runs gated actions
│   │       └── tools/
│   │           ├── index.ts    # Tool registry
│   │           ├── types.ts
│   │           ├── helpers.ts  # Pagination, idempotency, retry
│   │           ├── items.ts
│   │           ├── inventory.ts
│   │           ├── barcode.ts
│   │           ├── procurement.ts
│   │           ├── procurement_extra.ts
│   │           ├── goods_receipt.ts
│   │           ├── finance.ts
│   │           ├── fx.ts
│   │           ├── fixed_assets.ts
│   │           ├── hcm.ts
│   │           ├── hcm_admin.ts
│   │           ├── hcm_extra.ts
│   │           ├── payroll.ts
│   │           ├── crm.ts
│   │           ├── manufacturing.ts
│   │           ├── mrp.ts
│   │           ├── projects.ts
│   │           ├── reporting.ts
│   │           └── approvals.ts
│   │
│   └── web/                    # Next.js frontend
│       ├── package.json
│       ├── next.config.mjs
│       ├── tailwind.config.ts
│       ├── middleware.ts       # Session guard
│       ├── lib/
│       │   ├── auth.ts         # JWT sign/verify
│       │   ├── agent.ts        # Agent proxy helpers
│       │   ├── modules.ts      # Sidebar config
│       │   └── promptTemplates.ts
│       ├── components/
│       │   ├── Sidebar.tsx
│       │   ├── ChatPane.tsx
│       │   ├── Message.tsx
│       │   └── PromptSuggestions.tsx
│       └── app/
│           ├── layout.tsx
│           ├── page.tsx
│           ├── login/page.tsx
│           ├── (app)/
│           │   ├── layout.tsx
│           │   ├── chat/page.tsx
│           │   ├── approvals/page.tsx
│           │   └── settings/page.tsx
│           └── api/
│               ├── auth/login/route.ts
│               ├── auth/logout/route.ts
│               ├── me/route.ts
│               ├── chat/route.ts
│               ├── chat/history/route.ts
│               ├── approvals/route.ts
│               ├── approvals/[id]/route.ts
│               └── settings/route.ts
```

---
