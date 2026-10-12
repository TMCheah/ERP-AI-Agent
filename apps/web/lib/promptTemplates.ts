import type { ModuleKey } from "./modules";

export const MODULE_PROMPTS: Record<ModuleKey, { title: string; prompts: string[] }> = {
  chat: {
    title: "Try one of these",
    prompts: [
      "Show me all pens with selling price above $5 and more than 100 in stock",
      "What invoices are overdue?",
      "List my pending approvals",
      "Show me all employees",
      "What's the total value of my sales pipeline?",
    ],
  },
  finance: {
    title: "Financials",
    prompts: [
      "Show me all overdue invoices",
      "List all GL accounts",
      "Create an invoice for Globex Corp for $5,000 due in 30 days",
      "Post a journal entry: debit 5000 Office Supplies, credit 2000 AP, $1,500",
      "Mark invoice INV-1002 as paid",
    ],
  },
  scm: {
    title: "Supply Chain",
    prompts: [
      "What items are below reorder point?",
      "List all purchase orders",
      "Show me everything in transit",
      "Which vendors have a rating above 4?",
    ],
  },
  inventory: {
    title: "Inventory",
    prompts: [
      "Show me all pens in stock",
      "What items are below reorder point?",
      "Adjust SKU-1002 at WH-KUL down by 20 due to damage",
      "Show me everything in WH-PEN",
    ],
  },
  hcm: {
    title: "People / HCM",
    prompts: [
      "Show me all employees",
      "Find employees in Engineering",
      "Create employee Jane Tan, jane@magent.test, Sales Manager",
      "Create a login for employee 4 with role APPROVER",
      "Request leave for sam@magent.test 2026-11-01 to 2026-11-05",
    ],
  },
  manufacturing: {
    title: "Manufacturing",
    prompts: [
      "List all BOMs",
      "List all work orders",
      "Create a work order for 100 units of SKU-1001",
      "Create a BOM for SKU-1001 named Pen Assembly Kit with 2x SKU-1002",
    ],
  },
  crm: {
    title: "CRM",
    prompts: [
      "List CRM leads in PROPOSAL stage",
      "Create a lead for Rina Tan at Nova Retail, $25,000",
      "Move lead Rina Tan to QUALIFIED",
      "List open support tickets",
      "Create a ticket for Magent: 'Login not working', priority HIGH",
    ],
  },
  procurement: {
    title: "Procurement",
    prompts: [
      "List all vendors",
      "List all purchase requisitions",
      "We need 500 units of SKU-1001 for the marketing team by 2026-11-01",
      "Create vendor V-003 'Ink Supplies Ltd' with email orders@ink.test",
      "Create a PO for V-001 with 100 units of SKU-1001 at $2.00 each",
    ],
  },
  projects: {
    title: "Projects",
    prompts: [
      "List all active projects",
      "Create a project PRJ-003 'Mobile App' with budget $80,000",
      "Add a task to PRJ-001: 'Design homepage' due 2026-11-15",
      "Log 4 hours on PRJ-001 task 'Design homepage'",
    ],
  },
  approvals: {
    title: "Approvals",
    prompts: [
      "List my pending approvals",
      "Approve request #1",
      "Reject request #2 with note: budget exceeded",
    ],
  },
  settings: {
    title: "Settings",
    prompts: [
      "What model are we using?",
      "Show me the current LLM provider",
    ],
  },
};