export type ModuleKey =
  | "chat"
  | "finance"
  | "scm"
  | "inventory"
  | "hcm"
  | "manufacturing"
  | "crm"
  | "procurement"
  | "projects"
  | "approvals"
  | "settings";

export const MODULES: { key: ModuleKey; label: string; icon: string; href: string }[] = [
  { key: "chat",          label: "Chat",          icon: "💬", href: "/chat" },
  { key: "finance",       label: "Financials",    icon: "＄", href: "/chat?m=finance" },
  { key: "scm",           label: "Supply Chain",  icon: "⇄", href: "/chat?m=scm" },
  { key: "inventory",     label: "Inventory",     icon: "▣", href: "/chat?m=inventory" },
  { key: "hcm",           label: "People",        icon: "☺", href: "/chat?m=hcm" },
  { key: "manufacturing", label: "Manufacturing", icon: "⚙", href: "/chat?m=manufacturing" },
  { key: "crm",           label: "CRM",           icon: "★", href: "/chat?m=crm" },
  { key: "procurement",   label: "Procurement",   icon: "⛬", href: "/chat?m=procurement" },
  { key: "projects",      label: "Projects",      icon: "◈", href: "/chat?m=projects" },
  { key: "approvals",     label: "Approvals",     icon: "✓", href: "/approvals" },
  { key: "settings",      label: "Settings",      icon: "⚙", href: "/settings" },
];