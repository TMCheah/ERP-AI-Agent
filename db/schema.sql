CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============ Core ============
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'STAFF',   -- ADMIN | APPROVER | STAFF
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE agent_settings (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'ollama',        -- ollama | openai-compatible
  base_url TEXT NOT NULL DEFAULT 'http://localhost:11434',
  model TEXT NOT NULL DEFAULT 'qwen2.5:7b',
  api_key TEXT,
  temperature NUMERIC(3,2) NOT NULL DEFAULT 0.10,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ Inventory ============
CREATE TABLE warehouses (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  UNIQUE (tenant_id, code)
);

CREATE TABLE items (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT,
  unit TEXT NOT NULL DEFAULT 'EA',
  selling_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  cost_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  reorder_point INT NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, sku)
);

CREATE TABLE stock (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  item_id BIGINT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  warehouse_id BIGINT NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  quantity NUMERIC(14,2) NOT NULL DEFAULT 0,
  UNIQUE (item_id, warehouse_id)
);

-- ============ Procurement ============
CREATE TABLE vendors (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  rating NUMERIC(3,1) DEFAULT 0,
  UNIQUE (tenant_id, code)
);

CREATE TABLE purchase_requisitions (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  reference TEXT NOT NULL,
  item_id BIGINT REFERENCES items(id),
  quantity NUMERIC(14,2) NOT NULL,
  required_by DATE,
  requested_by UUID REFERENCES users(id),
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ Finance ============
CREATE TABLE gl_accounts (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,   -- ASSET | LIABILITY | EQUITY | REVENUE | EXPENSE
  UNIQUE (tenant_id, code)
);

CREATE TABLE invoices (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  number TEXT NOT NULL,
  customer TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  due_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN',  -- OPEN | PAID | OVERDUE
  UNIQUE (tenant_id, number)
);

CREATE TABLE journal_entries (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  reference TEXT NOT NULL,
  memo TEXT,
  debit_account TEXT NOT NULL,
  credit_account TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ HCM ============
CREATE TABLE employees (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_no TEXT NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT,
  department TEXT,
  job_title TEXT,
  hire_date DATE,
  salary NUMERIC(14,2),
  UNIQUE (tenant_id, employee_no)
);

CREATE TABLE leave_requests (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id BIGINT REFERENCES employees(id),
  from_date DATE NOT NULL,
  to_date DATE NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ CRM ============
CREATE TABLE leads (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  company TEXT,
  email TEXT,
  stage TEXT NOT NULL DEFAULT 'NEW',  -- NEW | QUALIFIED | PROPOSAL | WON | LOST
  value NUMERIC(14,2) DEFAULT 0,
  owner_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ Approvals (the gate) ============
CREATE TABLE approvals (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,               -- purchase_requisition | stock_adjustment | journal_entry | leave_request
  summary TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING', -- PENDING | APPROVED | REJECTED
  requested_by UUID REFERENCES users(id),
  decided_by UUID REFERENCES users(id),
  decided_at TIMESTAMPTZ,
  decision_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ Chat ============
CREATE TABLE chat_messages (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,   -- user | assistant
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL,
  user_id UUID,
  action TEXT NOT NULL,
  detail JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_items_tenant ON items(tenant_id);
CREATE INDEX idx_stock_item ON stock(item_id);
CREATE INDEX idx_approvals_tenant_status ON approvals(tenant_id, status);
CREATE INDEX idx_chat_user ON chat_messages(user_id, created_at);