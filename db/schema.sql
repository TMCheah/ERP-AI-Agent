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
  model TEXT NOT NULL DEFAULT 'gemma4:12b',
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

-- ============ Customers (CRM) ============
CREATE TABLE customers (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

CREATE TABLE tickets (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  reference TEXT NOT NULL,
  subject TEXT NOT NULL,
  description TEXT,
  customer_id BIGINT REFERENCES customers(id),
  priority TEXT NOT NULL DEFAULT 'NORMAL',
  status TEXT NOT NULL DEFAULT 'OPEN',
  assignee_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ Purchase Orders ============
CREATE TABLE purchase_orders (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  reference TEXT NOT NULL,
  vendor_id BIGINT REFERENCES vendors(id),
  status TEXT NOT NULL DEFAULT 'DRAFT',
  order_date DATE NOT NULL DEFAULT CURRENT_DATE,
  expected_date DATE,
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE purchase_order_lines (
  id BIGSERIAL PRIMARY KEY,
  po_id BIGINT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  item_id BIGINT REFERENCES items(id),
  quantity NUMERIC(14,2) NOT NULL,
  unit_price NUMERIC(12,2)
);

-- ============ Manufacturing ============
CREATE TABLE boms (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL REFERENCES items(id),
  version TEXT NOT NULL DEFAULT 'v1',
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, product_id, version)
);

CREATE TABLE bom_lines (
  id BIGSERIAL PRIMARY KEY,
  bom_id BIGINT NOT NULL REFERENCES boms(id) ON DELETE CASCADE,
  component_id BIGINT NOT NULL REFERENCES items(id),
  quantity NUMERIC(14,4) NOT NULL,
  unit TEXT DEFAULT 'EA'
);

CREATE TABLE work_orders (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  reference TEXT NOT NULL,
  bom_id BIGINT REFERENCES boms(id),
  quantity NUMERIC(14,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'PLANNED',
  planned_start DATE,
  planned_end DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ Projects ============
CREATE TABLE projects (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  customer_id BIGINT REFERENCES customers(id),
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  budget NUMERIC(14,2),
  start_date DATE,
  end_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

CREATE TABLE project_tasks (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  assignee_id UUID REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'TODO',
  due_date DATE,
  hours_logged NUMERIC(10,2) DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ Conversations ============
CREATE TABLE conversations (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'New chat',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ Stock movements (audit for transfers / receipts / adjustments) ============
CREATE TABLE stock_movements (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  item_id BIGINT NOT NULL REFERENCES items(id),
  from_warehouse_id BIGINT REFERENCES warehouses(id),
  to_warehouse_id BIGINT REFERENCES warehouses(id),
  quantity NUMERIC(14,2) NOT NULL,
  reason TEXT,
  reference TEXT,
  moved_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ Payroll ============
CREATE TABLE IF NOT EXISTS payroll_runs (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  reference TEXT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT',  -- DRAFT | APPROVED | PAID
  total_gross NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_net NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payslips (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  payroll_run_id BIGINT NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_id BIGINT NOT NULL REFERENCES employees(id),
  gross NUMERIC(14,2) NOT NULL,
  tax NUMERIC(14,2) NOT NULL DEFAULT 0,
  deductions NUMERIC(14,2) NOT NULL DEFAULT 0,
  net NUMERIC(14,2) NOT NULL,
  paid_at TIMESTAMPTZ
);

-- ============ Fixed assets ============
CREATE TABLE IF NOT EXISTS fixed_assets (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT,
  purchase_date DATE NOT NULL,
  cost NUMERIC(14,2) NOT NULL,
  salvage_value NUMERIC(14,2) NOT NULL DEFAULT 0,
  useful_life_months INT NOT NULL DEFAULT 60,
  accumulated_depreciation NUMERIC(14,2) NOT NULL DEFAULT 0,
  last_depreciated_on DATE,
  status TEXT NOT NULL DEFAULT 'ACTIVE',   -- ACTIVE | DISPOSED
  disposed_at TIMESTAMPTZ,
  disposal_proceeds NUMERIC(14,2),
  UNIQUE (tenant_id, code)
);

-- ============ FX rates ============
CREATE TABLE IF NOT EXISTS fx_rates (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  base_currency TEXT NOT NULL,
  quote_currency TEXT NOT NULL,
  rate NUMERIC(20,8) NOT NULL,
  effective_date DATE NOT NULL,
  UNIQUE (tenant_id, base_currency, quote_currency, effective_date)
);

-- ============ Time & attendance ============
CREATE TABLE IF NOT EXISTS time_entries (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id BIGINT NOT NULL REFERENCES employees(id),
  clock_in TIMESTAMPTZ NOT NULL DEFAULT now(),
  clock_out TIMESTAMPTZ,
  note TEXT
);

CREATE TABLE IF NOT EXISTS timesheets (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id BIGINT NOT NULL REFERENCES employees(id),
  week_start DATE NOT NULL,
  hours NUMERIC(6,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT',  -- DRAFT | SUBMITTED | APPROVED
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ Recruitment ============
CREATE TABLE IF NOT EXISTS job_openings (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  reference TEXT NOT NULL,
  title TEXT NOT NULL,
  department TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN',  -- OPEN | CLOSED | FILLED
  posted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS applicants (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  job_id BIGINT NOT NULL REFERENCES job_openings(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT,
  status TEXT NOT NULL DEFAULT 'APPLIED',  -- APPLIED | SCREENING | INTERVIEW | OFFER | HIRED | REJECTED
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ Performance reviews ============
CREATE TABLE IF NOT EXISTS performance_reviews (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id BIGINT NOT NULL REFERENCES employees(id),
  reviewer_id UUID REFERENCES users(id),
  period TEXT NOT NULL,
  rating INT CHECK (rating BETWEEN 1 AND 5),
  comments TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ Contracts ============
CREATE TABLE IF NOT EXISTS contracts (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  reference TEXT NOT NULL,
  vendor_id BIGINT REFERENCES vendors(id),
  title TEXT NOT NULL,
  value NUMERIC(14,2),
  start_date DATE NOT NULL,
  end_date DATE,
  status TEXT NOT NULL DEFAULT 'ACTIVE',   -- ACTIVE | EXPIRED | TERMINATED
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ RFQ ============
CREATE TABLE IF NOT EXISTS rfqs (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  reference TEXT NOT NULL,
  item_id BIGINT REFERENCES items(id),
  quantity NUMERIC(14,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN',     -- OPEN | AWARDED | CANCELLED
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rfq_quotes (
  id BIGSERIAL PRIMARY KEY,
  rfq_id BIGINT NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
  vendor_id BIGINT NOT NULL REFERENCES vendors(id),
  unit_price NUMERIC(12,2) NOT NULL,
  lead_time_days INT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ============ Idempotency ============
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY,
  tenant_id UUID NOT NULL,
  user_id UUID NOT NULL,
  tool_name TEXT NOT NULL,
  response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ Goods receipts (GRN) ============
CREATE TABLE IF NOT EXISTS goods_receipts (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  reference TEXT NOT NULL,
  po_id BIGINT REFERENCES purchase_orders(id),
  warehouse_id BIGINT NOT NULL REFERENCES warehouses(id),
  received_by UUID REFERENCES users(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, reference)
);

CREATE TABLE IF NOT EXISTS goods_receipt_lines (
  id BIGSERIAL PRIMARY KEY,
  grn_id BIGINT NOT NULL REFERENCES goods_receipts(id) ON DELETE CASCADE,
  po_line_id BIGINT REFERENCES purchase_order_lines(id),
  item_id BIGINT NOT NULL REFERENCES items(id),
  quantity NUMERIC(14,2) NOT NULL
);

-- ============ Goods returns (to vendor) ============
CREATE TABLE IF NOT EXISTS goods_returns (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  reference TEXT NOT NULL,
  grn_id BIGINT REFERENCES goods_receipts(id),
  po_id BIGINT REFERENCES purchase_orders(id),
  vendor_id BIGINT REFERENCES vendors(id),
  warehouse_id BIGINT NOT NULL REFERENCES warehouses(id),
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, reference)
);

CREATE TABLE IF NOT EXISTS goods_return_lines (
  id BIGSERIAL PRIMARY KEY,
  return_id BIGINT NOT NULL REFERENCES goods_returns(id) ON DELETE CASCADE,
  item_id BIGINT NOT NULL REFERENCES items(id),
  quantity NUMERIC(14,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS calendar_events (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_id BIGINT REFERENCES employees(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  kind TEXT NOT NULL DEFAULT 'LEAVE',
  source_ref TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE chat_messages ADD COLUMN conversation_id BIGINT REFERENCES conversations(id) ON DELETE CASCADE;
ALTER TABLE employees ADD COLUMN user_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE employees ADD COLUMN deactivated_at TIMESTAMPTZ;
ALTER TABLE items ADD COLUMN IF NOT EXISTS barcode TEXT;
ALTER TABLE purchase_order_lines ADD COLUMN IF NOT EXISTS received_qty NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE vendors    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE customers  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE items      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS grn_id BIGINT REFERENCES goods_receipts(id);
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS return_id BIGINT REFERENCES goods_returns(id);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'AR';   -- AR | AP
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS vendor_id BIGINT REFERENCES vendors(id);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS customer_id BIGINT REFERENCES customers(id);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS source TEXT;      -- MANUAL | PO_RECEIPT | WORK_ORDER
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS source_ref TEXT;  -- GRN-XXXX / PO-XXXX / etc.
ALTER TABLE invoices ALTER COLUMN customer DROP NOT NULL;       -- AP invoices have no customer
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'POSTED';  -- DRAFT | POSTED
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS source TEXT;      -- AR_INVOICE | GRN | WORK_ORDER
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS source_ref TEXT;
ALTER TABLE items ADD COLUMN IF NOT EXISTS default_vendor_id BIGINT REFERENCES vendors(id);
ALTER TABLE agent_settings ADD COLUMN IF NOT EXISTS is_demo_mode BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX idx_items_tenant ON items(tenant_id);
CREATE INDEX idx_stock_item ON stock(item_id);
CREATE INDEX idx_approvals_tenant_status ON approvals(tenant_id, status);
CREATE INDEX idx_chat_user ON chat_messages(user_id, created_at);
CREATE INDEX idx_stock_movements_tenant ON stock_movements(tenant_id, created_at DESC);
CREATE INDEX idx_stock_movements_item ON stock_movements(item_id);
CREATE INDEX IF NOT EXISTS idx_items_barcode ON items(tenant_id, barcode);
CREATE INDEX IF NOT EXISTS idx_grn_tenant ON goods_receipts(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_grn_po ON goods_receipts(po_id);
CREATE INDEX IF NOT EXISTS idx_returns_tenant ON goods_returns(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_type_status ON invoices(tenant_id, type, status);
CREATE INDEX IF NOT EXISTS idx_invoices_source ON invoices(tenant_id, source, source_ref);
CREATE INDEX IF NOT EXISTS idx_je_status ON journal_entries(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_calendar_tenant_dates ON calendar_events(tenant_id, start_date, end_date);