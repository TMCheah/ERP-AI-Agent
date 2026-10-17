# Test Prompt Checklist

> Replace placeholder IDs such as `PO-XXXX`, `GRN-XXXX`, `RET-XXXXXX`, `BILL-XXXX`, `JE-XXXX`, `PRUN-XXXX`, `JOB-XXXX`, `RFQ-XXXX`, `CTR-XXXX`, and `WO-XXXX` with actual IDs when running tests.

---

## 1. READ

- Show me all pens with selling price above $5 and more than 100 in stock.
- What items are below reorder point?
- Show me everything in WH-KUL.
- List all purchase requisitions.
- Show me pending approvals.
- List vendors with rating above 4.
- Find employees in Engineering.
- Show me all employees.
- What invoices are overdue?
- List CRM leads in PROPOSAL stage.

## 2. WRITE — Approval-gated

- We need 500 units of SKU-1001 by 2026-11-01.
- Adjust SKU-1002 at WH-KUL down by 20.
- Post JE: debit 5000, credit 2000, $1500 for supplies.
- Request leave for sam@magent.test 2026-11-01 to 2026-11-05.

## 3. WRITE — Immediate, admin

- Create employee Henry, henry@magent.test, HR Manager.
- Create a login for employee 4 with role APPROVER.
- Add a new HR, his name is Henry. Create an employee and a user.

## 4. MULTI-TOOL

- List all employees and all overdue invoices.

## 5. Transfers

- Transfer 50 units of SKU-1002 from WH-KUL to WH-PEN.
- List stock movements for SKU-1001.

## 6. Warehouse

- Create warehouse WH-JB named Johor Bahru Hub.
- List all warehouses.

## 7. Goods Receipt

- Create a PO for V-001 with 100 units of SKU-1001 at $2 each.
- List all purchase orders.
- Receive PO-XXXX into WH-KUL.

## 8. Invoices

- Void invoice INV-1001 because the customer disputed it.
- Update invoice INV-1002 to $5,000.
- List journal entries.

## 9. People

- Change Sam Staff's department to Finance.
- Deactivate employee E-002.
- List leave requests.

## 10. CRM

- Update lead Rina Tan's value to $35,000.
- Convert lead Rina Tan to a customer.
- Assign ticket T-1001 to staff@magent.test.
- Close ticket T-1002.

## 11. Manufacturing

- Complete work order WO-XXXX at WH-KUL.
- Show me the BOM for SKU-1001.
- Delete the BOM for SKU-1001 v1.

## 12. Projects

- Update project PRJ-001 status to ON_HOLD.
- List tasks for PRJ-001.
- Mark "Design homepage" on PRJ-001 as done.
- Log 6 hours on PRJ-001 task "Design homepage".

## 13. Reports

- What is my total inventory valuation?
- Show me the AR aging report.
- What's the trial balance?
- Show headcount by department.
- What items are low on stock?
- Show me the sales pipeline.

## 14. Purchase Orders

- List purchase orders.
- Create a PO for V-001 with lines: 100x SKU-1001 at $2, 50x SKU-1002 at $2.
  - Approve it in the Approvals tab.
- Get PO-XXXX.
- Receive 30 units of SKU-1001 from PO-XXXX into WH-KUL.
- Get PO-XXXX.
- Receive the rest of PO-XXXX into WH-KUL.
- Get PO-XXXX.

## 15. Payroll

- Create payroll for 2026-10-01 to 2026-10-31.
- List payroll runs.
- Show payslips for PRUN-XXXX.
- Mark payroll PRUN-XXXX as paid.

## 16. Fixed Assets

- List fixed assets.
- Register asset FA-100 'Forklift' cost $25,000 purchased today, life 60 months.
- Depreciate FA-100 for 3 periods.
- List fixed assets.
- Dispose FA-100 with proceeds $18,000.

## 17. FX

- List FX rates.
- Convert 1000 USD to MYR.
- Set rate for USD/JPY to 149.50.
- Convert 500 USD to JPY.

## 18. Barcode

- Set barcode 'PKG-BLUE-001' for SKU-1001.
- Lookup barcode PKG-BLUE-001.

## 19. Time & Attendance

- Clock in sam@magent.test.
- List time entries.
- Clock out sam@magent.test.
- Log 40 hours timesheet for sam@magent.test week of 2026-10-06.

## 20. Hiring & Performance

- Create job opening Senior Engineer, Engineering.
- List job openings.
- Add applicant Angela Wong, angela@test.com to JOB-XXXX.
- Update applicant Angela Wong status to INTERVIEW.
- Hire applicant Angela Wong from JOB-XXXX as Software Engineer in Engineering at $9,500.
- Create performance review for sam@magent.test period 2026-Q3 rating 4, comments "Solid quarter".
- List performance reviews.

## 21. Contracts & RFQ

- Create contract with V-001 titled "Stationery Supply" value $50,000 starting 2026-11-01 ending 2027-11-01.
- List contracts.
- Terminate contract CTR-XXXX.
- Create an RFQ for 500 x SKU-1001.
- Submit quote from V-001 for RFQ-XXXX at $1.95, lead 14 days.
- Submit quote from V-002 for RFQ-XXXX at $2.10, lead 7 days.
- Compare quotes for RFQ-XXXX.
- Award RFQ-XXXX to V-001.

> **Expect:** RFQ awarded → a purchase order approval is queued.

## 22. MRP + Forecast

- Calculate MRP for SKU-1001, quantity 500.
- Forecast demand for SKU-1001 over 180 days.

## 23. Item CRUD

- List all items.
- Create item SKU-9001 "Stapler HD-50" category Stationery at selling $15 cost $8 reorder 50.
- Get item SKU-9001.
- Update SKU-9001 selling price to $16.50 and reorder point to 75.
- Get item SKU-9001.
- Deactivate item SKU-9001 reason discontinued.
- List items.
- List items include_deactivated.
- Activate item SKU-9001.

> **Expect:** SKU-9001 appears/disappears from list_items as you toggle.

## 24. Item with Opening Stock

- Create item SKU-9002 "Sticky Notes 3x3" category Stationery with opening stock 500 at WH-KUL.
- Get item SKU-9002.
- List stock movements for SKU-9002.

> **Expect:** a movement with reason OPENING.

## 25. Full Procurement Chain with GRN

- Create item SKU-9100 "Cardboard Box L" category Packaging at cost $3.
- Create a PO for V-001 with lines: 200x SKU-9100 at $3, 100x SKU-1001 at $2.
- List purchase orders.
  - Approve the PO in the Approvals tab.
- Receive 50 units of SKU-9100 from PO-XXXX into WH-KUL.
- List goods receipts.
- Get GRN-XXXX.
- Get PO-XXXX.
- List stock movements for SKU-9100.

> **Expect:**
> - A GRN reference like GRN-XXXXXX is returned.
> - PO status becomes PARTIALLY_RECEIVED.
> - `get PO` shows received_qty: 50, outstanding: 150 on SKU-9100 and received_qty: 0, outstanding: 100 on SKU-1001.
> - Stock movement for SKU-9100 has reason='PO_RECEIPT' and a grn_reference.

## 26. Partial Receive → Full Receive

- Receive the rest of PO-XXXX into WH-KUL.
- Get PO-XXXX.

> **Expect:** status → RECEIVED, received_qty == quantity on both lines.

## 27. Goods Return

- Create a goods return from GRN-XXXX: return 10x SKU-9100, reason "damaged in transit".
  - Approve it.
- List goods returns.
- List stock movements for SKU-9100.

> **Expect:**
> - A RET-XXXXXX reference appears.
> - Stock for SKU-9100 drops by 10.
> - Movement has reason='GOODS_RETURN'.

## 28. Deactivated Items Excluded from Inventory

- Deactivate item SKU-2001 reason "discontinued".
- Show me all items in stock.
- List items.

> **Expect:** SKU-2001 gone from query_inventory (default) but visible in list_items include_deactivated.

## 29. Drafts Page

- Click Drafts in the sidebar → empty page (until you create something below).
- Create a PR via chat: `We need 20 units of SKU-1001`
- Approve it in Approvals → a DRAFT PO is auto-created.
- Refresh Drafts → the DRAFT PO card appears with a → procurement link.

## 30. Chain 1 — PR → DRAFT PO

- Chat: `We need 30 units of SKU-1001`
- Approve in Approvals.
- Procurement module → Draft tab → the DRAFT PO is there.
- Its notes say `Auto-generated from PR-XXXX`.

## 31. Chain 2 + 3 — GRN → DRAFT AP Invoice + DRAFT JE

- Create an OPEN PO via chat: `Create a PO for V-001 with 50 units of SKU-1001 at $2 each`
- Approve it.
- Receive: `Receive 50 units of SKU-1001 from PO-XXXX into WH-KUL`

> **Expect:** message includes `Auto-created DRAFT AP invoice BILL-XXXX` and `JE JE-XXXX`.

- Financials → Draft tab → BILL and JE cards are there, both linked to the GRN reference.
- Drafts page → same two cards, filterable by module finance.

## 32. Chain 4 — Work Order → DRAFT Production JE

- Complete a work order: `Complete work order WO-XXXX at WH-KUL`
- Financials → Draft tab → a JE with source WORK_ORDER and Dr 1300 / Cr 2100.

## 33. Chain 5 — AR Invoice → DRAFT JE

- Create an invoice: `Create an invoice for Globex Corp for $5000 due in 30 days`
- Approve it in Approvals.
- Financials → the OPEN invoice appears in Pending.
- And a DRAFT JE appears in Draft tab (Dr 1200 / Cr 4000).

## 34. Chain 6 — Leave → Calendar Event

- Request leave: `Request leave for sam@magent.test from 2026-11-01 to 2026-11-05`
- Approve it.
- Verify in the DB:

  ```bash
  docker exec -it <container> psql -U erp -d erp -c \
    "SELECT title, start_date, end_date, kind FROM calendar_events;"
> **Expect:**
> Leave: Sam Staff | 2026-11-01 | 2026-11-05 | LEAVE

## 35. Chain 7 — Default Vendor

- Set default vendor V-001 for SKU-1002.
- We need 10 units of SKU-1002
- Approve the PR.
- Procurement → Draft → the DRAFT PO has vendor Pilot Supplies Sdn Bhd (V-001).