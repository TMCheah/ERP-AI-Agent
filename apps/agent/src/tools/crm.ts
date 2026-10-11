import { q } from "../db.js";
import { tool } from "./types.js";

export const crmTools = [
  tool({
    name: "list_leads",
    description: "List CRM sales leads, optionally filtered by pipeline stage.",
    parameters: {
      type: "object",
      properties: {
        stage: { type: "string", enum: ["NEW", "QUALIFIED", "PROPOSAL", "WON", "LOST"] },
        search: { type: "string" },
        limit: { type: "integer" },
      },
      required: [],
    },
    async handler(args, ctx) {
      const rows = await q(
        `SELECT name, company, email, stage, value, created_at
           FROM leads
          WHERE tenant_id = $1
            AND ($2::text IS NULL OR stage = $2)
            AND ($3::text IS NULL OR name ILIKE '%' || $3 || '%' OR company ILIKE '%' || $3 || '%')
          ORDER BY value DESC NULLS LAST
          LIMIT $4`,
        [ctx.tenantId, args.stage ?? null, args.search ?? null, Math.min(args.limit ?? 25, 100)],
      );
      return { count: rows.length, leads: rows };
    },
  }),
];