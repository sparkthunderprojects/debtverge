import type {
  DebtVergeCommunication, CommsChannel, DebtCase, DebtSolutionPipeline,
} from "@/lib/types";

// ============================================================
// Shared Types — Omnichannel Communications 3-Column Layout
// ============================================================

export interface QueueItem {
  caseId: string;
  caseNumber: string;
  debtorName: string;
  totalDebt: number;
  monthlyDisposableIncome: number;
  planType: DebtSolutionPipeline;
  lastMessage: DebtVergeCommunication | null;
  messageCount: number;
  unreadCount: number;
  threadId: string;
  hasVulnerability: boolean;
  isClosed: boolean;
  assignedAgentId: string | null;
  assignedAgentName: string | null;
  topic: string | null;
  channel: CommsChannel | null;
  debtorEmail: string | null;
  debtorPhone: string | null;
  householdSize: number;
}

// ============================================================
// Queue Folders (left column triage sections)
// ============================================================

export type FilterTab = "my_assigned" | "unassigned" | "fca_urgent" | "closed" | "all";

export const FILTER_TABS: { id: FilterTab; label: string }[] = [
  { id: "my_assigned", label: "My Assigned" },
  { id: "unassigned", label: "Unassigned Queue" },
  { id: "fca_urgent", label: "FCA Urgent / Vulnerable" },
  { id: "closed", label: "Closed" },
];

// ============================================================
// Department Filters
// ============================================================

export type DepartmentFilter = "general_inquiries" | "dmp_team" | "iva_insolvency" | "client_relations";

export const DEPARTMENT_FILTERS: { id: DepartmentFilter; label: string; color: string }[] = [
  { id: "general_inquiries", label: "General Inquiries", color: "bg-slate-400" },
  { id: "dmp_team", label: "DMP Team", color: "bg-blue-500" },
  { id: "iva_insolvency", label: "IVA Insolvency", color: "bg-violet-500" },
  { id: "client_relations", label: "Client Relations", color: "bg-emerald-500" },
];

export function departmentForPipeline(pipeline: DebtSolutionPipeline): DepartmentFilter {
  if (pipeline === "DMP") return "dmp_team";
  if (pipeline === "IVA") return "iva_insolvency";
  if (pipeline === "DRO") return "iva_insolvency";
  return "client_relations";
}

// ============================================================
// Pipeline Badges
// ============================================================

export const PIPELINE_BADGE: Record<DebtSolutionPipeline, string> = {
  DMP: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300",
  IVA: "bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300",
  DRO: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
  Settlement: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
};

// ============================================================
// Interactive Action Cards (composer dropdown)
// ============================================================

export interface ActionCardDefinition {
  id: string;
  label: string;
  icon: string;
  description: string;
}

export const ACTION_CARDS: ActionCardDefinition[] = [
  { id: "open_banking", label: "Request Open Banking", icon: "Landmark", description: "Send an Open Banking consent link so the client can share transaction data securely." },
  { id: "payslip", label: "Request Payslip", icon: "FileText", description: "Request the client upload their latest payslip for income verification." },
  { id: "direct_debit", label: "Send Direct Debit Auth", icon: "CreditCard", description: "Send a Direct Debit instruction form for the agreed monthly payment." },
];

// ============================================================
// VoIP Call Log Type (stored as internal_note with special body)
// ============================================================

export interface VoipCallLog {
  durationSeconds: number;
  direction: "inbound" | "outbound";
  outcome: "completed" | "missed" | "voicemail" | "declined";
  phoneNumber: string;
}

export function isVoipCallLog(msg: DebtVergeCommunication): VoipCallLog | null {
  if (msg.channel !== "internal_note") return null;
  const body = msg.content.body;
  if (!body.startsWith("[VOIP]")) return null;
  try {
    const json = body.slice(6).trim();
    return JSON.parse(json) as VoipCallLog;
  } catch {
    return null;
  }
}

// ============================================================
// SFS Quick-Adjust Expense Categories
// ============================================================

export interface SfsQuickAdjustField {
  id: string;
  label: string;
  defaultAmount: number;
}

export const SFS_QUICK_ADJUST_FIELDS: SfsQuickAdjustField[] = [
  { id: "rent", label: "Rent / Mortgage", defaultAmount: 750 },
  { id: "utilities", label: "Utilities", defaultAmount: 180 },
  { id: "council_tax", label: "Council Tax", defaultAmount: 145 },
];

// ============================================================
// Shared Helpers
// ============================================================

export function mapPlanToPipeline(planType: DebtCase["plan_type"]): DebtSolutionPipeline {
  const map: Record<string, DebtSolutionPipeline> = {
    dmp: "DMP", iva: "IVA", dro: "DRO", settlement: "Settlement", pending: "DMP",
  };
  return map[planType] ?? "DMP";
}

export function rowToComm(row: Record<string, unknown>): DebtVergeCommunication {
  return {
    id: row.id as string,
    caseId: row.case_id as string,
    threadId: row.thread_id as string,
    channel: row.channel as CommsChannel,
    direction: row.direction as "inbound" | "outbound",
    sender: {
      name: row.sender_name as string,
      emailOrPhone: row.sender_email_or_phone as string,
      type: row.sender_type as "client" | "agent" | "system",
    },
    recipient: {
      name: row.recipient_name as string,
      emailOrPhone: row.recipient_email_or_phone as string,
    },
    agentId: row.agent_id as string | null,
    agentName: row.agent_name as string | null,
    content: {
      subject: (row.subject as string) ?? undefined,
      body: row.body as string,
      attachments: (row.attachments as string[]) ?? [],
    },
    status: row.status as "delivered" | "read" | "failed" | "queued",
    matchedAutomatically: row.matched_automatically as boolean,
    timestamp: row.created_at as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

// ============================================================
// Avatar initials helper
// ============================================================

export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Avatar color derived from name hash
const AVATAR_COLORS = [
  "bg-blue-500", "bg-emerald-500", "bg-amber-500", "bg-rose-500",
  "bg-violet-500", "bg-teal-500", "bg-cyan-500", "bg-orange-500",
];

export function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash << 5) - hash + name.charCodeAt(i);
    hash |= 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}
