import { one, q } from "./db.js";
import type { ToolCtx } from "./tools/types.js";

export async function executeApproval(
  ctx: ToolCtx,
  kind: string,
  payload: any,
  requestedBy: string,
): Promise<void> {

  // ============================================================
  // PR approved → create PR + DRAFT PO (with default vendor if set)
  // ============================================================
  if (kind === "purchase_requisition") {
    const { sku, quantity, required_by, notes, vendor_code } = payload;
    const item = (await q<any>(
      `SELECT id, name, default_vendor_id FROM items WHERE tenant_id=$1 AND sku=$2`,
      [ctx.tenantId, sku],
    ))[0];
    if (!item) throw new Error(`Unknown SKU: ${sku}`);

    const prRef = `PR-${Date.now().toString().slice(-8)}`;
    await q(
      `INSERT INTO purchase_requisitions
        (tenant_id, reference, item_id, quantity, required_by, requested_by, notes, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'APPROVED')`,
      [ctx.tenantId, prRef, item.id, quantity, required_by ?? null, requestedBy, notes ?? null],
    );

    // Resolve vendor: explicit → item default → null
    let vendorId: number | null = null;
    if (vendor_code) {
      const v = (await q<any>(
        `SELECT id FROM vendors WHERE tenant_id=$1 AND code=$2 AND deleted_at IS NULL`,
        [ctx.tenantId, vendor_code],
      ))[0];
      if (!v) throw new Error(`Unknown vendor: ${vendor_code}`);
      vendorId = v.id;
    } else if (item.default_vendor_id) {
      vendorId = item.default_vendor_id;
    }

    // Auto-create DRAFT PO
    const poRef = `PO-${Date.now().toString().slice(-8)}`;
    const po = (await q<any>(
      `INSERT INTO purchase_orders
        (tenant_id, reference, vendor_id, status, order_date, expected_date, notes, created_by)
       VALUES ($1,$2,$3,'DRAFT',CURRENT_DATE,$4,$5,$6)
       RETURNING id, reference`,
      [ctx.tenantId, poRef, vendorId, required_by ?? null, `Auto-generated from ${prRef}`, requestedBy],
    ))[0];

    await q(
      `INSERT INTO purchase_order_lines (po_id, item_id, quantity, unit_price)
       VALUES ($1,$2,$3,NULL)`,
      [po.id, item.id, quantity],
    );

    await q(
      `INSERT INTO audit_log (tenant_id, user_id, action, detail)
       VALUES ($1,$2,'po.auto_created_from_pr',$3)`,
      [ctx.tenantId, requestedBy, { pr_reference: prRef, po_reference: poRef, sku, quantity, vendor_id: vendorId }],
    );
    return;
  }

  // ============================================================
  // PO approved → materialize OPEN PO
  // ============================================================
  if (kind === "purchase_order") {
    const { vendor_code, lines, expected_date, notes } = payload;
    const vendor = (await q<any>(
      `SELECT id FROM vendors WHERE tenant_id=$1 AND code=$2 AND deleted_at IS NULL`,
      [ctx.tenantId, vendor_code],
    ))[0];
    if (!vendor) throw new Error(`Unknown vendor: ${vendor_code}`);

    const ref = `PO-${Date.now().toString().slice(-8)}`;
    const po = (await q<any>(
      `INSERT INTO purchase_orders
        (tenant_id, reference, vendor_id, expected_date, notes, created_by, status)
       VALUES ($1,$2,$3,$4,$5,$6,'OPEN') RETURNING id, reference`,
      [ctx.tenantId, ref, vendor.id, expected_date ?? null, notes ?? null, requestedBy],
    ))[0];

    for (const line of lines ?? []) {
      const item = (await q<any>(
        `SELECT id FROM items WHERE tenant_id=$1 AND sku=$2`,
        [ctx.tenantId, line.sku],
      ))[0];
      if (!item) throw new Error(`Unknown SKU on line: ${line.sku}`);
      await q(
        `INSERT INTO purchase_order_lines (po_id, item_id, quantity, unit_price)
         VALUES ($1,$2,$3,$4)`,
        [po.id, item.id, line.quantity, line.unit_price ?? null],
      );
    }
    return;
  }

  // ============================================================
  // AR Invoice approved → create invoice + DRAFT JE (Dr AR / Cr Revenue)
  // ============================================================
  if (kind === "invoice") {
    const { customer, amount, currency, due_date } = payload;
    const num = `INV-${Date.now().toString().slice(-8)}`;
    const inv = (await q<any>(
      `INSERT INTO invoices
        (tenant_id, number, customer, amount, currency, due_date, status, type, source)
       VALUES ($1,$2,$3,$4,$5,$6,'OPEN','AR','MANUAL')
       RETURNING id, number, amount`,
      [ctx.tenantId, num, customer, amount, currency ?? "USD", due_date],
    ))[0];

    // Chain: DRAFT journal entry
    await q(
      `INSERT INTO journal_entries
        (tenant_id, reference, memo, debit_account, credit_account, amount, created_by, status, source, source_ref)
       VALUES ($1,$2,$3,'1200','4000',$4,$5,'DRAFT','AR_INVOICE',$6)`,
      [ctx.tenantId, `JE-${Date.now().toString().slice(-8)}`,
       `AR invoice ${num} — ${customer}`, amount, requestedBy, num],
    );

    await q(
      `INSERT INTO audit_log (tenant_id, user_id, action, detail)
       VALUES ($1,$2,'invoice.auto_je_created',$3)`,
      [ctx.tenantId, requestedBy, { invoice: num, amount }],
    );
    return;
  }

  // ============================================================
  // JE approved → post journal entry
  // ============================================================
  if (kind === "journal_entry") {
    const { debit_account, credit_account, amount, memo } = payload;
    const ref = `JE-${Date.now().toString().slice(-8)}`;
    await q(
      `INSERT INTO journal_entries
        (tenant_id, reference, memo, debit_account, credit_account, amount, created_by, status, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'POSTED','MANUAL')`,
      [ctx.tenantId, ref, memo ?? null, debit_account, credit_account, amount, requestedBy],
    );
    return;
  }

  // ============================================================
  // Leave approved → create calendar event
  // ============================================================
  if (kind === "leave_request") {
    const { employee_email, from_date, to_date, reason } = payload;
    const emp = (await q<any>(
      `SELECT id, full_name FROM employees WHERE tenant_id=$1 AND email=$2`,
      [ctx.tenantId, employee_email],
    ))[0];
    if (!emp) throw new Error(`Unknown employee: ${employee_email}`);

    const ref = `LV-${Date.now().toString().slice(-6)}`;
    await q(
      `INSERT INTO leave_requests
        (tenant_id, employee_id, from_date, to_date, reason, status)
       VALUES ($1,$2,$3,$4,$5,'APPROVED')`,
      [ctx.tenantId, emp.id, from_date, to_date, reason ?? null],
    );
    await q(
      `INSERT INTO calendar_events
        (tenant_id, employee_id, title, description, start_date, end_date, kind, source_ref)
       VALUES ($1,$2,$3,$4,$5,$6,'LEAVE',$7)`,
      [ctx.tenantId, emp.id, `Leave: ${emp.full_name}`,
       reason ?? null, from_date, to_date, ref],
    );
    return;
  }

  // ============================================================
  // Stock adjustment → update stock
  // ============================================================
  if (kind === "stock_adjustment") {
    const { sku, warehouse_code, delta } = payload;
    const row = (await q<any>(
      `SELECT i.id AS item_id, w.id AS warehouse_id
         FROM items i, warehouses w
        WHERE i.tenant_id=$1 AND i.sku=$2 AND w.tenant_id=$1 AND w.code=$3`,
      [ctx.tenantId, sku, warehouse_code],
    ))[0];
    if (!row) throw new Error(`Unknown SKU or warehouse`);
    await q(
      `INSERT INTO stock (tenant_id, item_id, warehouse_id, quantity)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (item_id, warehouse_id)
       DO UPDATE SET quantity = stock.quantity + EXCLUDED.quantity`,
      [ctx.tenantId, row.item_id, row.warehouse_id, delta],
    );
    await q(
      `INSERT INTO stock_movements (tenant_id, item_id, to_warehouse_id, quantity, reason, moved_by)
       VALUES ($1,$2,$3,$4,'ADJUSTMENT',$5)`,
      [ctx.tenantId, row.item_id, row.warehouse_id, delta, ctx.userId],
    );
    return;
  }

  // ============================================================
  // Stock transfer → move between warehouses
  // ============================================================
  if (kind === "stock_transfer") {
    const { sku, from_warehouse_code, to_warehouse_code, quantity } = payload;
    const row = (await q<any>(
      `SELECT i.id AS item_id, wf.id AS from_id, wt.id AS to_id
         FROM items i, warehouses wf, warehouses wt
        WHERE i.tenant_id=$1 AND i.sku=$2
          AND wf.tenant_id=$1 AND wf.code=$3
          AND wt.tenant_id=$1 AND wt.code=$4`,
      [ctx.tenantId, sku, from_warehouse_code, to_warehouse_code],
    ))[0];
    if (!row) throw new Error(`Unknown SKU or warehouse`);

    const src = (await q<any>(
      `SELECT quantity FROM stock WHERE item_id=$1 AND warehouse_id=$2`,
      [row.item_id, row.from_id],
    ))[0];
    if (Number(src?.quantity ?? 0) < Number(quantity))
      throw new Error(`Insufficient stock at ${from_warehouse_code}`);

    await q(`UPDATE stock SET quantity = quantity - $3 WHERE item_id=$1 AND warehouse_id=$2`,
      [row.item_id, row.from_id, quantity]);
    await q(
      `INSERT INTO stock (tenant_id, item_id, warehouse_id, quantity)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (item_id, warehouse_id)
       DO UPDATE SET quantity = stock.quantity + EXCLUDED.quantity`,
      [ctx.tenantId, row.item_id, row.to_id, quantity],
    );
    await q(
      `INSERT INTO stock_movements (tenant_id, item_id, from_warehouse_id, to_warehouse_id, quantity, reason, moved_by)
       VALUES ($1,$2,$3,$4,$5,'TRANSFER',$6)`,
      [ctx.tenantId, row.item_id, row.from_id, row.to_id, quantity, ctx.userId],
    );
    return;
  }

  // ============================================================
  // Work order approved → materialize RELEASED
  // ============================================================
  if (kind === "work_order") {
    const { product_sku, quantity, planned_start, planned_end } = payload;
    const bom = (await q<any>(
      `SELECT b.id FROM boms b JOIN items i ON i.id = b.product_id
        WHERE b.tenant_id=$1 AND i.sku=$2 ORDER BY b.id DESC LIMIT 1`,
      [ctx.tenantId, product_sku],
    ))[0];
    const ref = `WO-${Date.now().toString().slice(-8)}`;
    await q(
      `INSERT INTO work_orders
        (tenant_id, reference, bom_id, quantity, status, planned_start, planned_end)
       VALUES ($1,$2,$3,$4,'RELEASED',$5,$6)`,
      [ctx.tenantId, ref, bom?.id ?? null, quantity, planned_start ?? null, planned_end ?? null],
    );
    return;
  }

  // ============================================================
  // Goods return → deduct stock
  // ============================================================
  if (kind === "goods_return") {
    const { grn_id, grn_reference, po_id, warehouse_id, lines, reason } = payload;
    const vendor = po_id
      ? (await q<any>(`SELECT vendor_id FROM purchase_orders WHERE id=$1`, [po_id]))[0]
      : null;
    const returnRef = `RET-${Date.now().toString().slice(-6)}`;
    const ret = (await q<any>(
      `INSERT INTO goods_returns
        (tenant_id, reference, grn_id, po_id, vendor_id, warehouse_id, reason, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'APPROVED',$8)
       RETURNING id, reference`,
      [ctx.tenantId, returnRef, grn_id, po_id, vendor?.vendor_id ?? null,
       warehouse_id, reason ?? null, requestedBy],
    ))[0];

    for (const l of lines ?? []) {
      const item = (await q<any>(
        `SELECT id FROM items WHERE tenant_id=$1 AND sku=$2`,
        [ctx.tenantId, l.sku],
      ))[0];
      if (!item) throw new Error(`Unknown SKU on return: ${l.sku}`);
      const stock = (await q<any>(
        `SELECT quantity FROM stock WHERE item_id=$1 AND warehouse_id=$2`,
        [item.id, warehouse_id],
      ))[0];
      if (Number(stock?.quantity ?? 0) < Number(l.quantity))
        throw new Error(`Insufficient stock for ${l.sku}`);

      await q(`INSERT INTO goods_return_lines (return_id, item_id, quantity) VALUES ($1,$2,$3)`,
        [ret.id, item.id, l.quantity]);
      await q(`UPDATE stock SET quantity = quantity - $3 WHERE item_id=$1 AND warehouse_id=$2`,
        [item.id, warehouse_id, l.quantity]);
      await q(
        `INSERT INTO stock_movements
           (tenant_id, item_id, from_warehouse_id, quantity, reason, reference, moved_by, return_id)
         VALUES ($1,$2,$3,$4,'GOODS_RETURN',$5,$6,$7)`,
        [ctx.tenantId, item.id, warehouse_id, l.quantity, returnRef, ctx.userId, ret.id],
      );
    }
    return;
  }

  throw new Error(`No executor for approval kind: ${kind}`);
}

// ============================================================
// Chain: GRN → DRAFT AP invoice + DRAFT Journal Entry
// Called by goods_receipt.ts after a GRN is created.
// ============================================================
export async function cascadeFromGRN(
  ctx: ToolCtx,
  args: {
    tenantId: string;
    grnId: number;
    grnReference: string;
    poId: number | null;
    poReference: string | null;
    warehouseId: number;
    lines: { sku: string; item_id: number; qty: number; unit_price: number | null; cost_price: number }[];
    requestedBy: string;
  },
): Promise<{ invoice_number: string | null; je_reference: string | null }> {
  const vendor = args.poId
    ? (await q<any>(`SELECT vendor_id FROM purchase_orders WHERE id=$1`, [args.poId]))[0]
    : null;

  // Total value = sum(qty × (unit_price || cost_price))
  let total = 0;
  for (const l of args.lines) {
    const price = l.unit_price ?? l.cost_price ?? 0;
    total += Number(l.qty) * Number(price);
  }
  if (total <= 0) return { invoice_number: null, je_reference: null };

  // ---- DRAFT AP invoice ----
  const invNum = `BILL-${Date.now().toString().slice(-8)}`;
  await q(
    `INSERT INTO invoices
       (tenant_id, number, customer, amount, currency, due_date, status, type,
        vendor_id, source, source_ref)
     VALUES ($1,$2,NULL,$3,'USD', CURRENT_DATE + INTERVAL '30 days',
             'DRAFT','AP',$4,'PO_RECEIPT',$5)`,
    [args.tenantId, invNum, total, vendor?.vendor_id ?? null, args.grnReference],
  );

  // ---- DRAFT Journal entry: Dr Inventory / Cr AP ----
  const jeRef = `JE-${Date.now().toString().slice(-8)}`;
  await q(
    `INSERT INTO journal_entries
       (tenant_id, reference, memo, debit_account, credit_account, amount,
        created_by, status, source, source_ref)
     VALUES ($1,$2,$3,'1300','2000',$4,$5,'DRAFT','GRN',$6)`,
    [args.tenantId, jeRef,
     `Goods receipt ${args.grnReference}${args.poReference ? ` from ${args.poReference}` : ""}`,
     total, args.requestedBy, args.grnReference],
  );

  await q(
    `INSERT INTO audit_log (tenant_id, user_id, action, detail)
     VALUES ($1,$2,'grn.chain_cascaded',$3)`,
    [args.tenantId, args.requestedBy,
     { grn: args.grnReference, ap_invoice: invNum, je: jeRef, total }],
  );

  return { invoice_number: invNum, je_reference: jeRef };
}

// ============================================================
// Chain: Work order completed → DRAFT production JE
// ============================================================
export async function cascadeFromWorkOrder(
  ctx: ToolCtx,
  args: {
    tenantId: string;
    woReference: string;
    producedValue: number;
    requestedBy: string;
  },
): Promise<{ je_reference: string | null }> {
  if (args.producedValue <= 0) return { je_reference: null };

  const jeRef = `JE-${Date.now().toString().slice(-8)}`;
  await q(
    `INSERT INTO journal_entries
       (tenant_id, reference, memo, debit_account, credit_account, amount,
        created_by, status, source, source_ref)
     VALUES ($1,$2,$3,'1300','2100',$4,$5,'DRAFT','WORK_ORDER',$6)`,
    [args.tenantId, jeRef,
     `Production complete ${args.woReference}`, args.producedValue,
     args.requestedBy, args.woReference],
  );

  await q(
    `INSERT INTO audit_log (tenant_id, user_id, action, detail)
     VALUES ($1,$2,'wo.chain_cascaded',$3)`,
    [args.tenantId, args.requestedBy,
     { wo: args.woReference, je: jeRef, value: args.producedValue }],
  );

  return { je_reference: jeRef };
}