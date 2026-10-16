export type ModuleKey =
  | "chat" | "drafts"
  | "procurement" | "inventory" | "finance" | "hcm"
  | "manufacturing" | "crm" | "projects" | "scm"
  | "approvals" | "settings";

export const MODULES: { key: ModuleKey; label: string; icon: string; href: string }[] = [
  { key: "chat",          label: "Chat",          icon: "💬", href: "/chat" },
  { key: "drafts",        label: "Drafts",        icon: "📝", href: "/drafts" },
  { key: "procurement",   label: "Procurement",   icon: "⛬", href: "/modules/procurement" },
  { key: "inventory",     label: "Inventory",     icon: "▣", href: "/modules/inventory" },
  { key: "finance",       label: "Financials",    icon: "＄", href: "/modules/finance" },
  { key: "hcm",           label: "People",        icon: "☺", href: "/modules/hcm" },
  { key: "manufacturing", label: "Manufacturing", icon: "⚙", href: "/modules/manufacturing" },
  { key: "crm",           label: "CRM",           icon: "★", href: "/modules/crm" },
  { key: "projects",      label: "Projects",      icon: "◈", href: "/modules/projects" },
  { key: "scm",           label: "Supply Chain",  icon: "⇄", href: "/modules/scm" },
  { key: "approvals",     label: "Approvals",     icon: "✓", href: "/approvals" },
  { key: "settings",      label: "Settings",      icon: "⚙", href: "/settings" },
];

export const MODULE_LABELS: Record<string, string> = {
  procurement: "Procurement",
  inventory: "Inventory",
  finance: "Financials",
  hcm: "People",
  manufacturing: "Manufacturing",
  crm: "CRM",
  projects: "Projects",
  scm: "Supply Chain",
  drafts: "Drafts",
};