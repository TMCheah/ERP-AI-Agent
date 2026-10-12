import { q } from "../db.js";
import { tool } from "./types.js";

export const fxTools = [
  tool({
    name: "set_fx_rate",
    description: "Set or update an exchange rate. Immediate.",
    parameters: {
      type: "object",
      properties: {
        base_currency: { type: "string" },
        quote_currency: { type: "string" },
        rate: { type: "number" },
        effective_date: { type: "string", description: "YYYY-MM-DD. Defaults to today." },
      },
      required: ["base_currency", "quote_currency", "rate"],
    },
    async handler(args, ctx) {
      const eff = args.effective_date ?? new Date().toISOString().slice(0, 10);
      await q(
        `INSERT INTO fx_rates (tenant_id, base_currency, quote_currency, rate, effective_date)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (tenant_id, base_currency, quote_currency, effective_date)
         DO UPDATE SET rate = EXCLUDED.rate`,
        [ctx.tenantId, args.base_currency.toUpperCase(), args.quote_currency.toUpperCase(), args.rate, eff],
      );
      return {
        status: "SET",
        pair: `${args.base_currency}/${args.quote_currency}`,
        rate: args.rate,
        effective_date: eff,
      };
    },
  }),

  tool({
    name: "list_fx_rates",
    description: "List current exchange rates.",
    parameters: {
      type: "object",
      properties: { base_currency: { type: "string" } },
      required: [],
    },
    async handler(args, ctx) {
      // Latest rate per (base,quote) pair
      const rows = await q(
        `SELECT DISTINCT ON (base_currency, quote_currency)
                base_currency, quote_currency, rate, effective_date
           FROM fx_rates
          WHERE tenant_id=$1
            AND ($2::text IS NULL OR base_currency=$2)
          ORDER BY base_currency, quote_currency, effective_date DESC`,
        [ctx.tenantId, args.base_currency?.toUpperCase() ?? null],
      );
      return { count: rows.length, rates: rows };
    },
  }),

  tool({
    name: "convert_currency",
    description: "Convert an amount from one currency to another using the latest rate.",
    parameters: {
      type: "object",
      properties: {
        amount: { type: "number" },
        from_currency: { type: "string" },
        to_currency: { type: "string" },
      },
      required: ["amount", "from_currency", "to_currency"],
    },
    async handler(args, ctx) {
      const from = args.from_currency.toUpperCase();
      const to = args.to_currency.toUpperCase();
      if (from === to) return { result: args.amount, rate: 1 };

      // Try direct
      let rate = (await q<any>(
        `SELECT rate FROM fx_rates WHERE tenant_id=$1 AND base_currency=$2 AND quote_currency=$3
          ORDER BY effective_date DESC LIMIT 1`,
        [ctx.tenantId, from, to],
      ))[0];
      let path = "direct";
      if (!rate) {
        // Try inverse
        const inv = (await q<any>(
          `SELECT rate FROM fx_rates WHERE tenant_id=$1 AND base_currency=$2 AND quote_currency=$3
            ORDER BY effective_date DESC LIMIT 1`,
          [ctx.tenantId, to, from],
        ))[0];
        if (inv) { rate = { rate: 1 / Number(inv.rate) }; path = "inverse"; }
      }
      if (!rate) {
        // Try via USD
        const a = (await q<any>(
          `SELECT rate FROM fx_rates WHERE tenant_id=$1 AND base_currency=$2 AND quote_currency='USD'
            ORDER BY effective_date DESC LIMIT 1`,
          [ctx.tenantId, from],
        ))[0];
        const b = (await q<any>(
          `SELECT rate FROM fx_rates WHERE tenant_id=$1 AND base_currency='USD' AND quote_currency=$2
            ORDER BY effective_date DESC LIMIT 1`,
          [ctx.tenantId, to],
        ))[0];
        if (a && b) { rate = { rate: Number(b.rate) / Number(a.rate) }; path = "via USD"; }
      }
      if (!rate) return { error: `No FX rate found for ${from} → ${to}.` };

      const result = Math.round(Number(args.amount) * Number(rate.rate) * 100) / 100;
      return { result, rate: Number(rate.rate), path, from, to };
    },
  }),
];