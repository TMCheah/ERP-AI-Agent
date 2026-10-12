# Test Prompt Checklist

> Replace placeholder IDs such as `PO-XXXX`, `PRUN-XXXX`, `JOB-XXXX`, `RFQ-XXXX`, `CTR-XXXX`, and `WO-XXXX` with actual IDs when running tests.

## READ

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

## WRITE — Approval-gated

- We need 500 units of SKU-1001 by 2026-11-01.
- Adjust SKU-1002 at WH-KUL down by 20.
- Post JE: debit 5000, credit 2000, $1500 for supplies.
- Request leave for sam@magent.test 2026-11-01 to 2026-11-05.

## WRITE — Immediate, admin

- Create employee Henry, henry@magent.test, HR Manager.
- Create a login for employee 4 with role APPROVER.
- Add a new HR, his name is Henry. Create an employee and a user.

## MULTI-TOOL

- List all employees and all overdue invoices.

## Transfers

- Transfer 50 units of SKU-1002 from WH-KUL to WH-PEN.
- List stock movements for SKU-1001.

## Warehouse

- Create warehouse WH-JB named Johor Bahru Hub.
- List all warehouses.

## Goods receipt

- Create a PO for V-001 with 100 units of SKU-1001 at $2 each.
- List all purchase orders.
- Receive PO-XXXX into WH-KUL.

## Invoices

- Void invoice INV-1001 because the customer disputed it.
- Update invoice INV-1002 to $5,000.
- List journal entries.

## People

- Change Sam Staff's department to Finance.
- Deactivate employee E-002.
- List leave requests.

## CRM

- Update lead Rina Tan's value to $35,000.
- Convert lead Rina Tan to a customer.
- Assign ticket T-1001 to staff@acme.test.
- Close ticket T-1002.

## Manufacturing

- Complete work order WO-XXXX at WH-KUL.
- Show me the BOM for SKU-1001.
- Delete the BOM for SKU-1001 v1.

## Projects

- Update project PRJ-001 status to ON_HOLD.
- List tasks for PRJ-001.
- Mark "Design homepage" on PRJ-001 as done.
- Log 6 hours on PRJ-001 task "Design homepage".

## Reports

- What is my total inventory valuation?
- Show me the AR aging report.
- What's the trial balance?
- Show headcount by department.
- What items are low on stock?
- Show me the sales pipeline.

## Purchase Orders

- List purchase orders.
- Create a PO for V-001 with lines: 100x SKU-1001 at $2, 50x SKU-1002 at $2.
  - Note: Approve it in the Approvals tab.
- Get PO-XXXX.
- Receive 30 units of SKU-1001 from PO-XXXX into WH-KUL.
- Get PO-XXXX.
- Receive the rest of PO-XXXX into WH-KUL.
- Get PO-XXXX.

## Payroll

- Create payroll for 2026-10-01 to 2026-10-31.
- List payroll runs.
- Show payslips for PRUN-XXXX.
- Mark payroll PRUN-XXXX as paid.

## Fixed assets

- List fixed assets.
- Register asset FA-100 'Forklift' cost $25,000 purchased today, life 60 months.
- Depreciate FA-100 for 3 periods.
- List fixed assets.
- Dispose FA-100 with proceeds $18,000.

## FX

- List FX rates.
- Convert 1000 USD to MYR.
- Set rate for USD/JPY to 149.50.
- Convert 500 USD to JPY.

## Barcode

- Set barcode 'PKG-BLUE-001' for SKU-1001.
- Lookup barcode PKG-BLUE-001.

## Time & attendance

- Clock in sam@magent.test.
- List time entries.
- Clock out sam@magent.test.
- Log 40 hours timesheet for sam@magent.test week of 2026-10-06.

## Hiring & performance

- Create job opening Senior Engineer, Engineering.
- List job openings.
- Add applicant Angela Wong, angela@test.com to JOB-XXXX.
- Update applicant Angela Wong status to INTERVIEW.
- Hire applicant Angela Wong from JOB-XXXX as Software Engineer in Engineering at $9,500.
- Create performance review for sam@magent.test period 2026-Q3 rating 4, comments "Solid quarter".
- List performance reviews.

## Contracts & RFQ

- Create contract with V-001 titled "Stationery Supply" value $50,000 starting 2026-11-01 ending 2027-11-01.
- List contracts.
- Terminate contract CTR-XXXX.
- Create an RFQ for 500 x SKU-1001.
- Submit quote from V-001 for RFQ-XXXX at $1.95, lead 14 days.
- Submit quote from V-002 for RFQ-XXXX at $2.10, lead 7 days.
- Compare quotes for RFQ-XXXX.
- Award RFQ-XXXX to V-001.
  - Expected: RFQ awarded → a purchase order approval is queued.

## MRP + forecast

- Calculate MRP for SKU-1001, quantity 500.
- Forecast demand for SKU-1001 over 180 days.

## 🆕 Item CRUD

- List all items.
- Create item SKU-9001 "Stapler HD-50" category Stationery at selling $15 cost $8 reorder 50.
- Get item SKU-9001.
- Update SKU-9001 selling price to $16.50 and reorder point to 75.
- Get item SKU-9001.
- Deactivate item SKU-9001 reason discontinued.
- List items.
- List items include_deactivated.
- Activate item SKU-9001.

> Expect: SKU-9001 appears/disappears from list_items as you toggle.

## 🆕 Item with opening stock

- Create item SKU-9002 "Sticky Notes 3x3" category Stationery with opening stock 500 at WH-KUL.
- Get item SKU-9002.
- List stock movements for SKU-9002.

> Expect: a movement with reason OPENING.

## 🆕 Full procurement chain with GRN

- Create item SKU-9100 "Cardboard Box L" category Packaging at cost $3.
- Create a PO for V-001 with lines: 200x SKU-9100 at $3, 100x SKU-1001 at $2.
- List purchase orders.
  - Note: Approve the PO in the Approvals tab.
- Receive 50 units of SKU-9100 from PO-XXXX into WH-KUL.
- List goods receipts.
- Get GRN-XXXX.
- Get PO-XXXX.
- List stock movements for SKU-9100.

> Expect:
> - A GRN reference like GRN-XXXXXX is returned.
> - PO status becomes PARTIALLY_RECEIVED.
> - get PO shows received_qty: 50, outstanding: 150 on SKU-9100 and received_qty: 0, outstanding: 100 on SKU-1001.
> - Stock movement for SKU-9100 has reason='PO_RECEIPT' and a grn_reference.

## 🆕 Partial receive → full receive

- Receive the rest of PO-XXXX into WH-KUL.
- Get PO-XXXX.

> Expect: status → RECEIVED, received_qty == quantity on both lines.

## 🆕 Goods return

- Create a goods return from GRN-XXXX: return 10x SKU-9100, reason "damaged in transit".
  - Note: Approve it.
- List goods returns.
- List stock movements for SKU-9100.

> Expect:
> - A RET-XXXXXX reference appears.
> - Stock for SKU-9100 drops by 10.
> - Movement has reason='GOODS_RETURN'.

## 🆕 Deactivated items excluded from inventory

- Deactivate item SKU-2001 reason "discontinued".
- Show me all items in stock.
- List items.

> Expect: SKU-2001 gone from query_inventory (default) but visible in list_items include_deactivated.