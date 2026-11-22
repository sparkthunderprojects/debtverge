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
