import { supabase } from "./supabase";

export interface BookRow {
  case_id: string; case_number: string; debtor_name: string; status: string; plan_type: string; adviser_id: string | null; adviser_name: string | null;
  total_debt: number | null; creditor_count: number; installment_amount: number | null; payment_frequency: string | null; next_due_date: string | null;
  arrears_days: number; open_complaints: number; last_contact: string | null; created_at: string; total_count: number;
}
export type BookSort = "name" | "case_number" | "status" | "adviser" | "debt" | "next_due" | "arrears" | "last_contact" | "created";
export type BookFlag = "" | "arrears" | "complaint" | "quiet_30d" | "no_schedule";
export interface BookQuery { q: string; status: string; plan: string; adviser: string; flag: BookFlag; sort: BookSort; dir: "asc" | "desc"; limit: number; offset: number }

export const STATUS_LABEL: Record<string, string> = {
  intake: "Intake", sfs_pending: "SFS pending", sfs_approved: "SFS approved", creditor_pack_sent: "Creditor pack sent", payment_schedule_active: "Payment active", completed: "Completed", closed: "Closed",
};
export const PLAN_LABEL: Record<string, string> = { dmp: "DMP", settlement: "Settlement", pending: "Pending", iva: "IVA" };
export const FLAG_LABEL: Record<Exclude<BookFlag, "">, string> = { arrears: "In arrears", complaint: "Open complaint", quiet_30d: "No contact for 30 days", no_schedule: "No payment schedule" };

export async function fetchBook(b: BookQuery): Promise<BookRow[]> {
  const { data, error } = await supabase.rpc("dv_client_book", {
    p_q: b.q.trim() || null, p_status: b.status || null, p_plan: b.plan || null, p_adviser: b.adviser || null, p_flag: b.flag || null,
    p_sort: b.sort, p_dir: b.dir, p_limit: b.limit, p_offset: b.offset,
  });
  if (error) throw new Error(error.message);
  return ((data ?? []) as BookRow[]).map((r) => ({ ...r, total_debt: r.total_debt === null ? null : Number(r.total_debt), installment_amount: r.installment_amount === null ? null : Number(r.installment_amount), total_count: Number(r.total_count) }));
}

export interface SuiteKpis {
  due_today_count: number; due_today_amount: number; next7_count: number; next7_amount: number; overdue_count: number; overdue_amount: number; overdue_clients: number;
  received_90d: number; received_90d_count: number; shortfalls_90d: number; links_open_count: number; links_open_amount: number; links_paid_30d: number;
}
export interface SuiteCaseRef { case_id: string; case_number: string; debtor_name: string }
export interface SuiteOverdue extends SuiteCaseRef { adviser: string | null; due_date: string; days: number; amount: number; status: string; reason: string | null }
export interface SuiteUpcoming extends SuiteCaseRef { adviser: string | null; due_date: string; amount: number }
export interface SuiteReceipt extends SuiteCaseRef { date: string; amount: number; reference: string | null; shortfall: boolean; shortfall_amount: number | null }
export interface SuiteLink extends SuiteCaseRef { id: string; amount: number; reason: string | null; channel: string | null; status: string; created_at: string; expires_at: string | null; paid_at: string | null }
export interface PaymentSuite { kpis: SuiteKpis; overdue: SuiteOverdue[]; upcoming: SuiteUpcoming[]; receipts: SuiteReceipt[]; links: SuiteLink[] }

export async function fetchPaymentSuite(): Promise<PaymentSuite> {
  const { data, error } = await supabase.rpc("dv_payment_suite");
  if (error) throw new Error(error.message);
  const d = data as PaymentSuite;
  const n = (v: unknown) => Number(v ?? 0);
  return {
    kpis: Object.fromEntries(Object.entries(d.kpis).map(([k, v]) => [k, n(v)])) as unknown as SuiteKpis,
    overdue: d.overdue.map((r) => ({ ...r, amount: n(r.amount), days: n(r.days) })),
    upcoming: d.upcoming.map((r) => ({ ...r, amount: n(r.amount) })),
    receipts: d.receipts.map((r) => ({ ...r, amount: n(r.amount) })),
    links: d.links.map((r) => ({ ...r, amount: n(r.amount) })),
  };
}

export interface OpsRun extends SuiteCaseRef { id: string; run_date: string; status: string; total_amount: number; total_items: number; created_by_me: boolean }
export interface OpsBankTxn { id: string; date: string; amount: number; direction: string | null; reference: string | null; counterparty: string | null; status: string; notes: string | null }
export interface PaymentSuiteOps {
  payouts: { awaiting_count: number; awaiting_amount: number; failed_count: number; approved_count: number; approved_amount: number; settled_30d_amount: number; runs: OpsRun[] };
  /** Null for anyone who is not a manager: reconciliation, client money and fees are manager-only. */
  reconciliation: { by_status: { status: string; count: number; amount: number }[]; unmatched: OpsBankTxn[]; feeds: { name: string; type: string | null; last_import_at: string | null; last_import_count: number | null; active: boolean }[] } | null;
  client_money: { last: { date: string; bank_balance: number; ledger_total: number; difference: number; note: string | null } | null; history: { date: string; bank_balance: number; ledger_total: number; difference: number }[]; open_holds: number } | null;
  fees: { by_status: { status: string; count: number; amount: number }[] } | null;
}

export async function fetchPaymentSuiteOps(): Promise<PaymentSuiteOps> {
  const { data, error } = await supabase.rpc("dv_payment_suite_ops");
  if (error) throw new Error(error.message);
  const d = data as PaymentSuiteOps;
  const n = (v: unknown) => Number(v ?? 0);
  const p = d.payouts;
  return {
    payouts: { ...p, awaiting_count: n(p.awaiting_count), awaiting_amount: n(p.awaiting_amount), failed_count: n(p.failed_count), approved_count: n(p.approved_count), approved_amount: n(p.approved_amount), settled_30d_amount: n(p.settled_30d_amount), runs: p.runs.map((r) => ({ ...r, total_amount: n(r.total_amount), total_items: n(r.total_items) })) },
    reconciliation: d.reconciliation && { ...d.reconciliation, by_status: d.reconciliation.by_status.map((r) => ({ ...r, count: n(r.count), amount: n(r.amount) })), unmatched: d.reconciliation.unmatched.map((r) => ({ ...r, amount: n(r.amount) })) },
    client_money: d.client_money && {
      open_holds: n(d.client_money.open_holds),
      last: d.client_money.last && { ...d.client_money.last, bank_balance: n(d.client_money.last.bank_balance), ledger_total: n(d.client_money.last.ledger_total), difference: n(d.client_money.last.difference) },
      history: d.client_money.history.map((h) => ({ ...h, bank_balance: n(h.bank_balance), ledger_total: n(h.ledger_total), difference: n(h.difference) })),
    },
    fees: d.fees && { by_status: d.fees.by_status.map((r) => ({ ...r, count: n(r.count), amount: n(r.amount) })) },
  };
}
