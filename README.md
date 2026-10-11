# Natural-Language-First ERP

Chat with a local LLM (Ollama). It calls tools. Tools read/write Postgres.
Anything risky is queued for approval.

## Quick start

1. Install Postgres: `docker compose up -d`
2. Install Ollama: https://ollama.com/download
3. Pull a tool-calling model: `ollama pull gemma4:12b`
4. `cp .env.example .env`
5. `npm install`
6. `npm run db:reset`  (creates schema + seed data)
7. `npm run dev`
8. Open http://localhost:3000

## Seed logins (password: `password123`)
- admin@magent.test    (ADMIN)
- approver@magent.test (APPROVER)
- staff@magent.test    (STAFF)

## Try these prompts
- "Show me all pens with selling price above $5 and more than 100 in stock"
- "We need 500 units of SKU-1001 for the marketing team by 2026-11-01"
- "What invoices are overdue?"
- "Find employees in Engineering"
- "List my pending approvals"