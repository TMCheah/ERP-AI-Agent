-- Wipe (dev only)
TRUNCATE audit_log, chat_messages, approvals, leads, leave_requests, employees,
         journal_entries, invoices, gl_accounts, purchase_requisitions, vendors,
         stock, items, warehouses, agent_settings, users, tenants RESTART IDENTITY CASCADE;

INSERT INTO tenants (id, name) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Magent');

INSERT INTO users (tenant_id, email, password_hash, full_name, role) VALUES
  ('11111111-1111-1111-1111-111111111111','admin@magent.test',    crypt('password123', gen_salt('bf')),'Ada Admin',    'ADMIN'),
  ('11111111-1111-1111-1111-111111111111','approver@magent.test', crypt('password123', gen_salt('bf')),'Paul Approver','APPROVER'),
  ('11111111-1111-1111-1111-111111111111','staff@magent.test',    crypt('password123', gen_salt('bf')),'Sam Staff',   'STAFF');

INSERT INTO agent_settings (tenant_id) VALUES ('11111111-1111-1111-1111-111111111111');

INSERT INTO warehouses (tenant_id, code, name) VALUES
  ('11111111-1111-1111-1111-111111111111','WH-KUL','Kuala Lumpur DC'),
  ('11111111-1111-1111-1111-111111111111','WH-PEN','Penang Hub');

INSERT INTO items (tenant_id, sku, name, category, unit, selling_price, cost_price, reorder_point) VALUES
  ('11111111-1111-1111-1111-111111111111','SKU-1001','Pilot G2 Pen (Blue)','Stationery','EA', 6.50, 2.10, 200),
  ('11111111-1111-1111-1111-111111111111','SKU-1002','Pilot G2 Pen (Black)','Stationery','EA', 6.50, 2.10, 200),
  ('11111111-1111-1111-1111-111111111111','SKU-1003','Bic Cristal Pen','Stationery','EA', 1.20, 0.40, 500),
  ('11111111-1111-1111-1111-111111111111','SKU-2001','A4 Copier Paper 80gsm','Paper','RM', 4.90, 3.10, 300),
  ('11111111-1111-1111-1111-111111111111','SKU-3001','Logitech M170 Mouse','IT','EA', 12.00, 7.00, 50),
  ('11111111-1111-1111-1111-111111111111','SKU-3002','Dell 24" Monitor','IT','EA', 189.00, 140.00, 20);

INSERT INTO stock (tenant_id, item_id, warehouse_id, quantity)
SELECT '11111111-1111-1111-1111-111111111111', i.id, w.id,
       CASE
         WHEN i.sku='SKU-1001' THEN 420
         WHEN i.sku='SKU-1002' THEN 150
         WHEN i.sku='SKU-1003' THEN 80
         WHEN i.sku='SKU-2001' THEN 900
         WHEN i.sku='SKU-3001' THEN 45
         WHEN i.sku='SKU-3002' THEN 12
       END
FROM items i CROSS JOIN warehouses w
WHERE i.tenant_id='11111111-1111-1111-1111-111111111111';

INSERT INTO vendors (tenant_id, code, name, email, rating) VALUES
  ('11111111-1111-1111-1111-111111111111','V-001','Pilot Supplies Sdn Bhd','sales@pilot.test', 4.5),
  ('11111111-1111-1111-1111-111111111111','V-002','PaperWorld','orders@paperworld.test', 4.0);

INSERT INTO gl_accounts (tenant_id, code, name, type) VALUES
  ('11111111-1111-1111-1111-111111111111','1000','Cash','ASSET'),
  ('11111111-1111-1111-1111-111111111111','1200','Accounts Receivable','ASSET'),
  ('11111111-1111-1111-1111-111111111111','2000','Accounts Payable','LIABILITY'),
  ('11111111-1111-1111-1111-111111111111','4000','Sales Revenue','REVENUE'),
  ('11111111-1111-1111-1111-111111111111','5000','Office Supplies Expense','EXPENSE');

INSERT INTO invoices (tenant_id, number, customer, amount, currency, due_date, status) VALUES
  ('11111111-1111-1111-1111-111111111111','INV-1001','Globex Corp', 12500.00,'USD', CURRENT_DATE - 10,'OVERDUE'),
  ('11111111-1111-1111-1111-111111111111','INV-1002','Initech',     4200.00, 'USD', CURRENT_DATE + 15,'OPEN'),
  ('11111111-1111-1111-1111-111111111111','INV-1003','Umbrella Ltd', 9800.00, 'USD', CURRENT_DATE - 3, 'OVERDUE');

INSERT INTO employees (tenant_id, employee_no, full_name, email, department, job_title, hire_date, salary) VALUES
  ('11111111-1111-1111-1111-111111111111','E-001','Ada Admin','admin@magent.test','Engineering','Engineering Manager','2022-03-01', 12000),
  ('11111111-1111-1111-1111-111111111111','E-002','Sam Staff','staff@magent.test','Engineering','Software Engineer','2023-07-15', 8000),
  ('11111111-1111-1111-1111-111111111111','E-003','Paul Approver','approver@magent.test','Finance','Finance Lead','2021-01-10', 11000);

INSERT INTO leads (tenant_id, name, company, email, stage, value) VALUES
  ('11111111-1111-1111-1111-111111111111','Rina Tan','Nova Retail','rina@nova.test','QUALIFIED', 25000),
  ('11111111-1111-1111-1111-111111111111','Kevin Lim','Delta Logistics','kevin@delta.test','PROPOSAL', 48000);

INSERT INTO customers (tenant_id, code, name, email) VALUES
  ('11111111-1111-1111-1111-111111111111','C-001','Globex Corp','ap@globex.test'),
  ('11111111-1111-1111-1111-111111111111','C-002','Initech','billing@initech.test'),
  ('11111111-1111-1111-1111-111111111111','C-003','Umbrella Ltd','ar@umbrella.test');

INSERT INTO projects (tenant_id, code, name, status, budget, start_date) VALUES
  ('11111111-1111-1111-1111-111111111111','PRJ-001','Q4 Website Rebuild','ACTIVE', 50000, CURRENT_DATE),
  ('11111111-1111-1111-1111-111111111111','PRJ-002','ERP Rollout','ACTIVE', 120000, CURRENT_DATE);

INSERT INTO tickets (tenant_id, reference, subject, description, priority, status) VALUES
  ('11111111-1111-1111-1111-111111111111','T-1001','Login not working','Cannot sign in with SSO','HIGH','OPEN'),
  ('11111111-1111-1111-1111-111111111111','T-1002','Invoice mismatch','PO says 100 units, invoice says 120','NORMAL','OPEN');

INSERT INTO boms (tenant_id, product_id, version, name)
SELECT '11111111-1111-1111-1111-111111111111', id, 'v1', 'Pen Assembly Kit'
FROM items WHERE sku='SKU-1001' AND tenant_id='11111111-1111-1111-1111-111111111111';

-- add a demo conversation
INSERT INTO conversations (tenant_id, user_id, title)
SELECT '11111111-1111-1111-1111-111111111111', id, 'Welcome'
FROM users WHERE email='admin@magent.test';

-- ============ Seed FX rates (USD base) ============
INSERT INTO fx_rates (tenant_id, base_currency, quote_currency, rate, effective_date)
VALUES
  ('11111111-1111-1111-1111-111111111111','USD','MYR', 4.70, CURRENT_DATE),
  ('11111111-1111-1111-1111-111111111111','USD','SGD', 1.35, CURRENT_DATE),
  ('11111111-1111-1111-1111-111111111111','USD','EUR', 0.92, CURRENT_DATE),
  ('11111111-1111-1111-1111-111111111111','USD','GBP', 0.79, CURRENT_DATE)
ON CONFLICT DO NOTHING;

-- ============ Seed a fixed asset ============
INSERT INTO fixed_assets (tenant_id, code, name, category, purchase_date, cost, salvage_value, useful_life_months)
VALUES
  ('11111111-1111-1111-1111-111111111111','FA-001','Delivery Van','Vehicle', CURRENT_DATE - 180, 45000, 5000, 60),
  ('11111111-1111-1111-1111-111111111111','FA-002','Office Servers','IT', CURRENT_DATE - 400, 12000, 0, 36)
ON CONFLICT DO NOTHING;