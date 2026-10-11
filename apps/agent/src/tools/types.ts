export type ToolCtx = {
  tenantId: string;
  userId: string;
  role: "ADMIN" | "APPROVER" | "STAFF";
};

export type ToolDef = {
  name: string;
  description: string;
  parameters: Record<string, any>; // JSON Schema
  handler: (args: any, ctx: ToolCtx) => Promise<any>;
};

export function tool(def: ToolDef): ToolDef {
  return def;
}