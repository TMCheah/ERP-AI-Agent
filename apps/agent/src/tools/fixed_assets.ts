import { q } from "../db.js";
import { tool } from "./types.js";

/** Straight-line monthly depreciation. */
function monthlyDep(a: { cost: number; salvage: number; life: number }): number {
  if (a.life <= 0) return 0;
  return Math.round(((a.cost - a.salvage) / a.life) * 100) / 100;
}

export const fixedAssetTools = [
  tool({
    name: "create_fixed_asset",
    description: "Register a fixed asset. Master data — immediate.",
    parameters: {
      type: "object",
      properties: {
        code: { type: "string" },
        name: { type: "string" },
        category: { type: "string" },
        purchase_date: { type: "string", description: "YYYY-MM-DD" },
        cost: { type: "number" },
        salvage_value: { type: "number" },
        useful_life_months: { type: "integer" },
      },
      required: ["code", "name", "purchase_date", "cost"],
    },
    async handler(args, ctx) {
      const rows = await q<any>(
        `INSERT INTO fixed_assets (tenant_id, code, name, category, purchase_date, cost, salvage_value, useful_life_months)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING id, code, name, status`,
        [
          ctx.tenantId, args.code, args.name, args.category ?? null,
          args.purchase_date, args.cost, args.salvage_value ?? 0, args.useful_life_months ?? 60,
        ],
      );
      return { status: "CREATED", asset: rows[0] };
    },
  }),

  tool({
    name: "list_fixed_assets",
    description: "List fixed assets, optional status filter.",
    parameters: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["ACTIVE", "DISPOSED"] },
        category: { type: "string" },
        limit: { type: "integer" },
      },
      required: [],
    },
    async handler(args, ctx) {
      const rows = await q(
        `SELECT code, name, category, purchase_date, cost, salvage_value,
                useful_life_months, accumulated_depreciation, last_depreciated_on, status,
                ROUND((cost - accumulated_depreciation)::numeric, 2) AS book_value
           FROM fixed_assets
          WHERE tenant_id=$1
            AND ($2::text IS NULL OR status=$2)
            AND ($3::text IS NULL OR category=$3)
          ORDER BY code LIMIT $4`,
        [ctx.tenantId, args.status ?? null, args.category ?? null, Math.min(args.limit ?? 50, 200)],
      );
      return { count: rows.length, assets: rows };
    },
  }),

  tool({
    name: "depreciate_asset",
    description:
      "Run monthly depreciation for one asset (by code) or all ACTIVE assets up to today. Straight-line. Immediate.",
    parameters: {
      type: "object",
      properties: {
        code: { type: "string", description: "Optional. Omit to depreciate all active assets." },
        periods: { type: "integer", description: "How many monthly periods to apply. Defaults to 1." },
      },
      required: [],
    },
    async handler(args, ctx) {
      const periods = Math.max(args.periods ?? 1, 1);
      const where = args.code ? `AND code=$2` : ``;
      const params: any[] = [ctx.tenantId];
      if (args.code) params.push(args.code);

      const assets = await q<any>(
        `SELECT id, code, cost, salvage_value, useful_life_months,
                accumulated_depreciation
           FROM fixed_assets
          WHERE tenant_id=$1 AND status='ACTIVE' ${where}`,
        params,
      );
      if (!assets.length) return { error: "No matching active assets." };

      const results: any[] = [];
      for (const a of assets) {
        const dep = monthlyDep({
          cost: Number(a.cost),
          salvage: Number(a.salvage_value),
          life: Number(a.useful_life_months),
        }) * periods;
        const maxDep = Number(a.cost) - Number(a.salvage_value);
        const newAccum = Math.min(Number(a.accumulated_depreciation) + dep, maxDep);
        const applied = newAccum - Number(a.accumulated_depreciation);
        await q(
          `UPDATE fixed_assets
              SET accumulated_depreciation=$2, last_depreciated_on=CURRENT_DATE
            WHERE id=$1`,
          [a.id, newAccum],
        );
        results.push({ code: a.code, depreciation_applied: applied, new_book_value: Number(a.cost) - newAccum });
      }

      await q(
        `INSERT INTO audit_log (tenant_id, user_id, action, detail) VALUES ($1,$2,'assets.depreciated',$3)`,
        [ctx.tenantId, ctx.userId, { assets: results.length, periods }],
      );
      return { status: "DEPRECIATED", periods, assets: results };
    },
  }),

  tool({
    name: "dispose_asset",
    description: "Mark an asset DISPOSED with proceeds. Immediate.",
    parameters: {
      type: "object",
      properties: {
        code: { type: "string" },
        proceeds: { type: "number" },
      },
      required: ["code"],
    },
    async handler(args, ctx) {
      const rows = await q<any>(
        `UPDATE fixed_assets
            SET status='DISPOSED', disposed_at=now(), disposal_proceeds=$3
          WHERE tenant_id=$1 AND code=$2 AND status='ACTIVE'
          RETURNING code, name, cost, accumulated_depreciation, disposal_proceeds`,
        [ctx.tenantId, args.code, args.proceeds ?? 0],
      );
      if (!rows.length) return { error: `Asset ${args.code} not found or already disposed.` };
      const r = rows[0];
      const bookValue = Number(r.cost) - Number(r.accumulated_depreciation);
      const gainLoss = Number(r.disposal_proceeds ?? 0) - bookValue;
      return { status: "DISPOSED", asset: r, book_value: bookValue, gain_loss: gainLoss };
    },
  }),
];