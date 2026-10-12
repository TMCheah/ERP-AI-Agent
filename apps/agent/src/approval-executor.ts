import { one, q } from "./db.js";
import type { ToolCtx } from "./tools/types.js";

export async function executeApproval(
  ctx: ToolCtx,
  kind: string,
  payload: any,
  requestedBy: string,
): Promise<void> {
  if (kind === "purchase_requisition") {
    const { sku, quantity, required_by, notes } = payload;
    const item = (await q<any>(`SELECT id FROM items WHERE tenant_id=$1 AND sku=$2`, [ctx.tenantId, sku]))[0];
    if (!item) throw new Error(`Unknown SKU: ${sku}`);
    const ref = `PR-${Date.now().toString().slice(-8)}`;
    await q(
      `INSERT INTO purchase_requisitions (tenant_id, reference, item_id, quantity, required_by, requested_by, notes, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'APPROVED')`,
      [ctx.tenantId, ref, item.id, quantity, required_by ?? null, requestedBy, notes ?? null],
    );
    return;
  }

  if (kind === "stock_adjustment") {
    const { sku, warehouse_code, delta, reason } = payload;
    const row = (await q<any>(
      `SELECT i.id AS item_id, w.id AS warehouse_id
         FROM items i, warehouses w
        WHERE i.tenant_id=$1 AND i.sku=$2 AND w.tenant_id=$1 AND w.code=$3`,
      [ctx.tenantId, sku, warehouse_code],
    ))[0];
    if (!row) throw new Error(`Unknown SKU or warehouse (${sku}, ${warehouse_code})`);
    await q(
      `INSERT INTO stock (tenant_id, item_id, warehouse_id, quantity)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (item_id, warehouse_id)
       DO UPDATE SET quantity = stock.quantity + EXCLUDED.quantity`,
      [ctx.tenantId, row.item_id, row.warehouse_id, delta],
    );
    return;
  }

  if (kind === "journal_entry") {
    const { debit_account, credit_account, amount, memo } = payload;
    const ref = `JE-${Date.now().toString().slice(-8)}`;
    await q(
      `INSERT INTO journal_entries (tenant_id, reference, memo, debit_account, credit_account, amount, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [ctx.tenantId, ref, memo ?? null, debit_account, credit_account, amount, requestedBy],
    );
    return;
  }

  if (kind === "leave_request") {
    const { employee_email, from_date, to_date, reason } = payload;
    const emp = (await q<any>(`SELECT id FROM employees WHERE tenant_id=$1 AND email=$2`, [ctx.tenantId, employee_email]))[0];
    if (!emp) throw new Error(`Unknown employee: ${employee_email}`);
    await q(
      `INSERT INTO leave_requests (tenant_id, employee_id, from_date, to_date, reason, status)
       VALUES ($1,$2,$3,$4,$5,'APPROVED')`,
      [ctx.tenantId, emp.id, from_date, to_date, reason ?? null],
    );
    return;
  }

  if (kind === "purchase_order") {
    const { vendor_code, lines, expected_date, notes } = payload;
    const vendor = (await q<any>(`SELECT id FROM vendors WHERE tenant_id=$1 AND code=$2`, [ctx.tenantId, vendor_code]))[0];
    if (!vendor) throw new Error(`Unknown vendor: ${vendor_code}`);
    const ref = `PO-${Date.now().toString().slice(-8)}`;
    const po = (await q<any>(
      `INSERT INTO purchase_orders (tenant_id, reference, vendor_id, expected_date, notes, created_by, status)
       VALUES ($1,$2,$3,$4,$5,$6,'OPEN') RETURNING id`,
      [ctx.tenantId, ref, vendor.id, expected_date ?? null, notes ?? null, requestedBy],
    ))[0];
    for (const line of lines ?? []) {
      const item = (await q<any>(`SELECT id FROM items WHERE tenant_id=$1 AND sku=$2`, [ctx.tenantId, line.sku]))[0];
      if (!item) throw new Error(`Unknown SKU on line: ${line.sku}`);
      await q(
        `INSERT INTO purchase_order_lines (po_id, item_id, quantity, unit_price)
         VALUES ($1,$2,$3,$4)`,
        [po.id, item.id, line.quantity, line.unit_price ?? null],
      );
    }
    return;
  }

  if (kind === "invoice") {
    const { customer, amount, currency, due_date } = payload;
    const num = `INV-${Date.now().toString().slice(-8)}`;
    await q(
      `INSERT INTO invoices (tenant_id, number, customer, amount, currency, due_date, status)
       VALUES ($1,$2,$3,$4,$5,$6,'OPEN')`,
      [ctx.tenantId, num, customer, amount, currency ?? "USD", due_date],
    );
    return;
  }

  if (kind === "stock_transfer") {
    const { sku, from_warehouse_code, to_warehouse_code, quantity, reason } = payload;
    const row = (await q<any>(
      `SELECT i.id AS item_id, wf.id AS from_id, wt.id AS to_id
         FROM items i, warehouses wf, warehouses wt
        WHERE i.tenant_id=$1 AND i.sku=$2
          AND wf.tenant_id=$1 AND wf.code=$3
          AND wt.tenant_id=$1 AND wt.code=$4`,
      [ctx.tenantId, sku, from_warehouse_code, to_warehouse_code],
    ))[0];
    if (!row) throw new Error(`Unknown SKU or warehouse (${sku}, ${from_warehouse_code}/${to_warehouse_code})`);

    // Guard against negative source
    const src = (await q<any>(
      `SELECT quantity FROM stock WHERE item_id=$1 AND warehouse_id=$2`,
      [row.item_id, row.from_id],
    ))[0];
    if (Number(src?.quantity ?? 0) < Number(quantity)) {
      throw new Error(`Insufficient stock at ${from_warehouse_code}: ${src?.quantity ?? 0} available.`);
    }

    await q(
      `UPDATE stock SET quantity = quantity - $3 WHERE item_id=$1 AND warehouse_id=$2`,
      [row.item_id, row.from_id, quantity],
    );
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

  if (kind === "work_order") {
    const { product_sku, quantity, planned_start, planned_end } = payload;
    const bom = (await q<any>(
      `SELECT b.id FROM boms b JOIN items i ON i.id = b.product_id
        WHERE b.tenant_id=$1 AND i.sku=$2 ORDER BY b.id DESC LIMIT 1`,
      [ctx.tenantId, product_sku],
    ))[0];
    const ref = `WO-${Date.now().toString().slice(-8)}`;
    await q(
      `INSERT INTO work_orders (tenant_id, reference, bom_id, quantity, status, planned_start, planned_end)
       VALUES ($1,$2,$3,$4,'RELEASED',$5,$6)`,
      [ctx.tenantId, ref, bom?.id ?? null, quantity, planned_start ?? null, planned_end ?? null],
    );
    return;
  }

  if (kind === "stock_transfer") {
    const { sku, from_warehouse_code, to_warehouse_code, quantity, reason } = payload;
    const row = (await q<any>(
      `SELECT i.id AS item_id, wf.id AS from_id, wt.id AS to_id
         FROM items i, warehouses wf, warehouses wt
        WHERE i.tenant_id=$1 AND i.sku=$2
          AND wf.tenant_id=$1 AND wf.code=$3
          AND wt.tenant_id=$1 AND wt.code=$4`,
      [ctx.tenantId, sku, from_warehouse_code, to_warehouse_code],
    ))[0];
    if (!row) throw new Error(`Unknown SKU or warehouse (${sku}, ${from_warehouse_code}/${to_warehouse_code})`);

    const src = (await q<any>(
      `SELECT quantity FROM stock WHERE item_id=$1 AND warehouse_id=$2`,
      [row.item_id, row.from_id],
    ))[0];
    if (Number(src?.quantity ?? 0) < Number(quantity)) {
      throw new Error(`Insufficient stock at ${from_warehouse_code}: ${src?.quantity ?? 0} available.`);
    }

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

  if (kind === "goods_return") {
    const { grn_id, grn_reference, po_id, warehouse_id, lines, reason } = payload;

    // Resolve vendor via PO (if GRN came from one)
    const vendor = po_id
      ? (await q<any>(`SELECT vendor_id FROM purchase_orders WHERE id=$1`, [po_id]))[0]
      : null;

    const returnRef = `RET-${Date.now().toString().slice(-6)}`;
    const ret = (await q<any>(
      `INSERT INTO goods_returns
        (tenant_id, reference, grn_id, po_id, vendor_id, warehouse_id, reason, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'APPROVED',$8)
       RETURNING id, reference`,
      [
        ctx.tenantId, returnRef, grn_id, po_id,
        vendor?.vendor_id ?? null, warehouse_id, reason ?? null, requestedBy,
      ],
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
      if (Number(stock?.quantity ?? 0) < Number(l.quantity)) {
        throw new Error(`Insufficient stock for ${l.sku}: ${stock?.quantity ?? 0} available.`);
      }

      await q(
        `INSERT INTO goods_return_lines (return_id, item_id, quantity) VALUES ($1,$2,$3)`,
        [ret.id, item.id, l.quantity],
      );
      await q(
        `UPDATE stock SET quantity = quantity - $3 WHERE item_id=$1 AND warehouse_id=$2`,
        [item.id, warehouse_id, l.quantity],
      );
      await q(
        `INSERT INTO stock_movements
           (tenant_id, item_id, from_warehouse_id, quantity, reason, reference, moved_by, return_id)
         VALUES ($1,$2,$3,$4,'GOODS_RETURN',$5,$6,$7)`,
        [ctx.tenantId, item.id, warehouse_id, l.quantity, returnRef, ctx.userId, ret.id],
      );
    }

    await q(
      `INSERT INTO audit_log (tenant_id, user_id, action, detail) VALUES ($1,$2,'goods_return.created',$3)`,
      [ctx.tenantId, ctx.userId, { reference: returnRef, grn: grn_reference, lines: lines?.length ?? 0 }],
    );
    return;
  }

  throw new Error(`No executor for approval kind: ${kind}`);
}