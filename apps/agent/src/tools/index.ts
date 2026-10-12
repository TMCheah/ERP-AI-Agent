import { approvalTools } from "./approvals.js";
import { barcodeTools } from "./barcode.js";
import { crmTools } from "./crm.js";
import { financeTools } from "./finance.js";
import { fixedAssetTools } from "./fixed_assets.js";
import { fxTools } from "./fx.js";
import { goodsReceiptTools } from "./goods_receipt.js";
import { hcmTools } from "./hcm.js";
import { hcmAdminTools } from "./hcm_admin.js";
import { hcmExtraTools } from "./hcm_extra.js";
import { inventoryTools } from "./inventory.js";
import { itemTools } from "./items.js";
import { manufacturingTools } from "./manufacturing.js";
import { mrpTools } from "./mrp.js";
import { payrollTools } from "./payroll.js";
import { procurementTools } from "./procurement.js";
import { procurementExtraTools } from "./procurement_extra.js";
import { projectTools } from "./projects.js";
import { reportingTools } from "./reporting.js";
import type { ToolDef } from "./types.js";

export const allTools: ToolDef[] = [
  // Inventory & catalog
  ...itemTools,
  ...inventoryTools,
  ...barcodeTools,

  // Procurement & sourcing
  ...procurementTools,
  ...procurementExtraTools,
  ...goodsReceiptTools,

  // Finance
  ...financeTools,
  ...fxTools,
  ...fixedAssetTools,

  // HCM
  ...hcmTools,
  ...hcmAdminTools,
  ...hcmExtraTools,
  ...payrollTools,

  // CRM
  ...crmTools,

  // Manufacturing & MRP
  ...manufacturingTools,
  ...mrpTools,

  // Projects
  ...projectTools,

  // Reporting
  ...reportingTools,

  // Approvals (cross-cutting)
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