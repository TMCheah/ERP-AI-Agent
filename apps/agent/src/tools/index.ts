import { approvalTools } from "./approvals.js";
import { crmTools } from "./crm.js";
import { financeTools } from "./finance.js";
import { hcmTools } from "./hcm.js";
import { hcmAdminTools } from "./hcm_admin.js";
import { inventoryTools } from "./inventory.js";
import { procurementTools } from "./procurement.js";
import type { ToolDef } from "./types.js";

export const allTools: ToolDef[] = [
  ...inventoryTools,
  ...procurementTools,
  ...financeTools,
  ...hcmTools,
  ...hcmAdminTools,
  ...crmTools,
  ...approvalTools,
];

export const toolMap = new Map(allTools.map((t) => [t.name, t]));

export function toolsForOllama() {
  return allTools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}