import { q } from "../db.js";
import { tool } from "./types.js";
import { ref } from "./helpers.js";

export const procurementExtraTools = [
  // ---------- Contracts ----------
  tool({
    name: "create_contract",
    description: "Create a vendor contract. Immediate.",
    parameters: {
      type: "object",
      properties: {
        vendor_code: { type: "string" },
        title: { type: "string" },
        value: { type: "number" },
        start_date: { type: "string", description: "YYYY-MM-DD" },
        end_date: { type: "string", description: "YYYY-MM-DD" },
      },
      required: ["vendor_code", "title", "start_date"],
    },
    async handler(args, ctx) {
      const v = (await q<any>(
        `SELECT id FROM vendors WHERE tenant_id=$1 AND code=$2 AND deleted_at IS NULL`,
        [ctx.tenantId, args.vendor_code],
      ))[0];
      if (!v) return { error: `Vendor ${args.vendor_code} not found.` };
      const row = (await q<any>(
        `INSERT INTO contracts (tenant_id, reference, vendor_id, title, value, start_date, end_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id, reference, title, status`,
        [ctx.tenantId, ref("CTR", 4), v.id, args.title, args.value ?? null, args.start_date, args.end_date ?? null],
      ))[0];
      return { status: "CREATED", contract: row };
    },
  }),

  tool({
    name: "list_contracts",
    description: "List contracts, optional status or vendor filter.",
    parameters: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["ACTIVE", "EXPIRED", "TERMINATED"] },
        vendor_code: { type: "string" },
        limit: { type: "integer" },
      },
      required: [],
    },
    async handler(args, ctx) {
      const params: any[] = [ctx.tenantId];
      const filters: string[] = [];
      if (args.status) { params.push(args.status); filters.push(`c.status = $${params.length}`); }
      if (args.vendor_code) { params.push(args.vendor_code); filters.push(`v.code = $${params.length}`); }
      params.push(Math.min(args.limit ?? 25, 100));
      const where = filters.length ? `AND ${filters.join(" AND ")}` : "";

      const rows = await q(
        `SELECT c.reference, c.title, v.name AS vendor_name, c.value,
                c.start_date, c.end_date, c.status
           FROM contracts c LEFT JOIN vendors v ON v.id = c.vendor_id
          WHERE c.tenant_id=$1 ${where}
          ORDER BY c.created_at DESC LIMIT $${params.length}`,
        params,
      );
      return { count: rows.length, contracts: rows };
    },
  }),

  tool({
    name: "terminate_contract",
    description: "Terminate a contract by reference.",
    parameters: {
      type: "object",
      properties: { reference: { type: "string" } },
      required: ["reference"],
    },
    async handler(args, ctx) {
      const rows = await q<any>(
        `UPDATE contracts SET status='TERMINATED' WHERE tenant_id=$1 AND reference=$2
         RETURNING reference, title, status`,
        [ctx.tenantId, args.reference],
      );
      if (!rows.length) return { error: `Contract ${args.reference} not found.` };
      return { status: "TERMINATED", contract: rows[0] };
    },
  }),

  // ---------- RFQ ----------
  tool({
    name: "create_rfq",
    description: "Open a Request for Quote for an item and quantity.",
    parameters: {
      type: "object",
      properties: {
        sku: { type: "string" },
        quantity: { type: "number" },
        notes: { type: "string" },
      },
      required: ["sku", "quantity"],
    },
    async handler(args, ctx) {
      const item = (await q<any>(
        `SELECT id FROM items WHERE tenant_id=$1 AND sku=$2 AND deleted_at IS NULL`,
        [ctx.tenantId, args.sku],
      ))[0];
      if (!item) return { error: `SKU ${args.sku} not found.` };
      const row = (await q<any>(
        `INSERT INTO rfqs (tenant_id, reference, item_id, quantity, notes)
         VALUES ($1,$2,$3,$4,$5) RETURNING id, reference, status`,
        [ctx.tenantId, ref("RFQ", 4), item.id, args.quantity, args.notes ?? null],
      ))[0];
      return { status: "CREATED", rfq: row };
    },
  }),

  tool({
    name: "submit_rfq_quote",
    description: "Record a vendor's quote against an RFQ.",
    parameters: {
      type: "object",
      properties: {
        rfq_reference: { type: "string" },
        vendor_code: { type: "string" },
        unit_price: { type: "number" },
        lead_time_days: { type: "integer" },
        notes: { type: "string" },
      },
      required: ["rfq_reference", "vendor_code", "unit_price"],
    },
    async handler(args, ctx) {
      const r = (await q<any>(
        `SELECT id FROM rfqs WHERE tenant_id=$1 AND reference=$2`,
        [ctx.tenantId, args.rfq_reference],
      ))[0];
      if (!r) return { error: `RFQ ${args.rfq_reference} not found.` };
      const v = (await q<any>(
        `SELECT id FROM vendors WHERE tenant_id=$1 AND code=$2`,
        [ctx.tenantId, args.vendor_code],
      ))[0];
      if (!v) return { error: `Vendor ${args.vendor_code} not found.` };
      const row = (await q<any>(
        `INSERT INTO rfq_quotes (rfq_id, vendor_id, unit_price, lead_time_days, notes)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [r.id, v.id, args.unit_price, args.lead_time_days ?? null, args.notes ?? null],
      ))[0];
      return { status: "RECORDED", quote_id: row.id };
    },
  }),

  tool({
    name: "compare_rfq_quotes",
    description: "Compare quotes for an RFQ side by side.",
    parameters: {
      type: "object",
      properties: { rfq_reference: { type: "string" } },
      required: ["rfq_reference"],
    },
    async handler(args, ctx) {
      const r = (await q<any>(
        `SELECT r.id, r.reference, r.quantity, r.status, i.sku, i.name AS item_name
           FROM rfqs r JOIN items i ON i.id = r.item_id
          WHERE r.tenant_id=$1 AND r.reference=$2`,
        [ctx.tenantId, args.rfq_reference],
      ))[0];
      if (!r) return { error: `RFQ ${args.rfq_reference} not found.` };
      const quotes = await q(
        `SELECT v.code AS vendor_code, v.name AS vendor_name, q.unit_price,
                q.lead_time_days, q.notes,
                ROUND((q.unit_price * $2)::numeric, 2) AS total_price
           FROM rfq_quotes q JOIN vendors v ON v.id = q.vendor_id
          WHERE q.rfq_id = $1
          ORDER BY q.unit_price ASC`,
        [r.id, r.quantity],
      );
      const cheapest = quotes[0] as any;
      const fastest = [...quotes].sort((a: any, b: any) => (a.lead_time_days ?? 9999) - (b.lead_time_days ?? 9999))[0];
      return {
        rfq: { reference: r.reference, sku: r.sku, item: r.item_name, quantity: r.quantity, status: r.status },
        quotes,
        cheapest_vendor: cheapest?.vendor_code,
        fastest_vendor: fastest?.vendor_code,
      };
    },
  }),

  tool({
    name: "award_rfq",
    description:
      "Award an RFQ to a winning vendor. Creates a purchase requisition for that vendor's quoted price and marks the RFQ AWARDED. Gated: the resulting PO is queued for approval.",
    parameters: {
      type: "object",
      properties: {
        rfq_reference: { type: "string" },
        vendor_code: { type: "string" },
      },
      required: ["rfq_reference", "vendor_code"],
    },
    async handler(args, ctx) {
      const r = (await q<any>(
        `SELECT r.id, r.quantity, r.status, i.sku
           FROM rfqs r JOIN items i ON i.id = r.item_id
          WHERE r.tenant_id=$1 AND r.reference=$2`,
        [ctx.tenantId, args.rfq_reference],
      ))[0];
      if (!r) return { error: `RFQ ${args.rfq_reference} not found.` };
      if (r.status !== "OPEN") return { error: `RFQ is already ${r.status}.` };

      const quote = (await q<any>(
        `SELECT q.id, q.unit_price FROM rfq_quotes q
           JOIN vendors v ON v.id = q.vendor_id
          WHERE q.rfq_id=$1 AND v.code=$2`,
        [r.id, args.vendor_code],
      ))[0];
      if (!quote) return { error: `No quote from ${args.vendor_code} for ${args.rfq_reference}.` };

      const approval = await (await import("./approvals.js")).createApproval(
        ctx,
        "purchase_order",
        `PO (via RFQ ${r.reference}) from ${args.vendor_code}: ${r.quantity} x ${r.sku} @ ${quote.unit_price}`,
        {
          vendor_code: args.vendor_code,
          lines: [{ sku: r.sku, quantity: r.quantity, unit_price: quote.unit_price }],
          notes: `Awarded from RFQ ${r.reference}`,
        },
      );

      await q(`UPDATE rfqs SET status='AWARDED' WHERE id=$1`, [r.id]);

      return {
        status: "AWARDED",
        rfq_reference: r.reference,
        vendor: args.vendor_code,
        approval_id: approval?.id,
        message: `RFQ awarded to ${args.vendor_code}. Purchase order queued (approval #${approval?.id}).`,
      };
    },
  }),
];