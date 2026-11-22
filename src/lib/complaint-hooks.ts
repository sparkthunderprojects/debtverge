import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";

export interface Complaint {
  id: string; case_id: string | null; reference: string; complainant: string; received_on: string; channel: string; category: string;
  summary: string; vulnerable: boolean; status: "open" | "acknowledged" | "investigating" | "final_response" | "closed";
  acknowledged_on: string | null; final_response_on: string | null; outcome: string | null; redress_amount: number | null; referred_to_fos: boolean;
  root_cause: string | null; fault: string | null; outcome_reasoning: string | null; final_response_ref: string | null;
  adjustments_confirmed: boolean; priority: "normal" | "high"; assigned_to: string | null; ack_outbox_id: string | null;
}
export const ROOT_CAUSE_LABEL: Record<string, string> = { fee_dispute: "Fee dispute", missed_payment_handling: "Missed payment handling", creditor_contact: "Creditor contact", advice_quality: "Advice quality", communication: "Communication", data_error: "Data error", delay: "Delay", other: "Other" };
export const FAULT_LABEL: Record<string, string> = { firm: "Our firm", creditor: "Creditor", client: "Client", third_party: "Third party", none: "No fault found" };
export const OUTCOME_LABEL: Record<string, string> = { upheld: "Upheld", partially_upheld: "Partially upheld", not_upheld: "Not upheld" };
export const CATEGORY_LABEL: Record<string, string> = { service: "Service", fees: "Fees", payments: "Payments", creditor_handling: "Creditor handling", data: "Data / privacy", conduct: "Conduct", other: "Other" };
export const STATUS_LABEL: Record<Complaint["status"], string> = { open: "Open", acknowledged: "Acknowledged", investigating: "Investigating", final_response: "Final response sent", closed: "Closed" };

const addBusinessDays = (from: Date, n: number) => { const d = new Date(from); let left = n; while (left > 0) { d.setDate(d.getDate() + 1); if (d.getDay() % 6 !== 0) left--; } return d; };
/** FCA DISP deadlines: acknowledge within 5 business days, final response within 8 weeks. */
export function deadlines(c: Complaint) {
  const rec = new Date(c.received_on + "T00:00:00");
  const ack = addBusinessDays(rec, 5);
  const fin = new Date(rec); fin.setDate(fin.getDate() + 56);
  const now = new Date(); now.setHours(0, 0, 0, 0);
  return {
    ackDue: ack, finalDue: fin,
    ackLate: !c.acknowledged_on && c.status === "open" && ack < now,
    finalLate: !c.final_response_on && c.status !== "closed" && fin < now,
    stage: ((): string | null => {
      if (c.status === "closed" || c.final_response_on) return null;
      const days = Math.floor((now.getTime() - rec.getTime()) / 86400000);
      if (days >= 49) return "Week 7: final response is due";
      if (days >= 42) return "Week 6: check progress";
      if (days >= 28) return "Week 4: check progress";
      return null;
    })(),
    ackWarn: !c.acknowledged_on && c.status === "open" && !(ack < now) && ack.getTime() - now.getTime() <= 2 * 86400000,
    finalSoon: !c.final_response_on && c.status !== "closed" && fin >= now && fin.getTime() - now.getTime() < 7 * 86400000,
  };
}

export function useComplaints(caseId?: string | null) {
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    let q = supabase.from("complaints").select("*").order("received_on", { ascending: false }).limit(100);
    if (caseId) q = q.eq("case_id", caseId);
    const { data } = await q;
    setComplaints(((data ?? []) as Complaint[]).map((c) => ({ ...c, redress_amount: c.redress_amount === null ? null : Number(c.redress_amount) })));
    setLoading(false);
  }, [caseId]);
  useEffect(() => { reload(); }, [reload]);
  return { complaints, loading, reload };
}

export async function logComplaint(p: { caseId: string | null; complainant: string; summary: string; category: string; channel: string; vulnerable: boolean; sourceCommId?: string | null; received?: string | null }) {
  const { error } = await supabase.rpc("dv_log_complaint", { p_case: p.caseId, p_complainant: p.complainant, p_summary: p.summary, p_category: p.category, p_channel: p.channel, p_received: p.received ?? null, p_vulnerable: p.vulnerable, p_source_comm: p.sourceCommId ?? null });
  if (error) throw new Error(error.message);
}
export interface ComplaintUpdate {
  status: Complaint["status"]; outcome?: string | null; note?: string | null; fos?: boolean | null; reasoning?: string | null;
  rootCause?: string | null; fault?: string | null; finalRef?: string | null; adjustments?: boolean | null; assignee?: string | null;
}
export async function updateComplaint(id: string, u: ComplaintUpdate) {
  const { error } = await supabase.rpc("dv_complaint_update", {
    p_id: id, p_status: u.status, p_outcome: u.outcome ?? null, p_note: u.note ?? null, p_fos: u.fos ?? null, p_reasoning: u.reasoning ?? null,
    p_root_cause: u.rootCause ?? null, p_fault: u.fault ?? null, p_final_ref: u.finalRef ?? null, p_adjustments: u.adjustments ?? null, p_assignee: u.assignee ?? null,
  });
  if (error) throw new Error(error.message);
}

export interface TimelineItem { kind: "event" | "message" | "note"; at: string; action?: string; note?: string | null; by?: string | null; channel?: string; direction?: string; body?: string; who?: string | null; note_kind?: string; withdrawn?: boolean }
export interface RedressRow { id: string; amount: number; reason: string; status: "requested" | "approved" | "rejected" | "paid"; requested_by: string; requested_at: string }
export interface ComplaintDetail { timeline: TimelineItem[]; redress: RedressRow[]; handler_name: string | null }
export async function fetchComplaintDetail(id: string): Promise<ComplaintDetail> {
  const { data, error } = await supabase.rpc("dv_complaint_detail", { p_id: id });
  if (error) throw new Error(error.message);
  const d = data as ComplaintDetail;
  return { ...d, redress: (d.redress ?? []).map((r) => ({ ...r, amount: Number(r.amount) })) };
}
export async function requestRedress(id: string, amount: number, reason: string) {
  const { error } = await supabase.rpc("dv_request_redress", { p_complaint: id, p_amount: amount, p_reason: reason });
  if (error) throw new Error(error.message);
}
export async function decideRedress(id: string, approve: boolean) {
  const { error } = await supabase.rpc("dv_decide_redress", { p_id: id, p_approve: approve });
  if (error) throw new Error(error.message);
}
export async function markRedressPaid(id: string) {
  const { error } = await supabase.rpc("dv_mark_redress_paid", { p_id: id });
  if (error) throw new Error(error.message);
}

export interface ComplaintsMi {
  total: number; open: number; upheld: number; partially_upheld: number; not_upheld: number; fos: number; vulnerable: number; redress_total: number;
  ack_in_time: number; ack_total: number; final_in_time: number; final_total: number; avg_days_to_final: number | null;
  by_category: { key: string; count: number }[]; by_root_cause: { key: string; count: number }[]; by_fault: { key: string; count: number }[];
  by_handler: { key: string; count: number; open: number }[];
}
export function useComplaintsMi(enabled: boolean, days = 90) {
  const [mi, setMi] = useState<ComplaintsMi | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    supabase.rpc("dv_complaints_mi", { p_from: from, p_to: null }).then(({ data }) => setMi((data as ComplaintsMi) ?? null));
  }, [enabled, days]);
  return mi;
}

export interface FlaggedMessage { id: string; channel: string; body: string; created_at: string }
export function useFlaggedMessages(caseId: string | null) {
  const [items, setItems] = useState<FlaggedMessage[]>([]);
  const reload = useCallback(async () => {
    if (!caseId) { setItems([]); return; }
    const { data } = await supabase.from("debtverge_communications").select("id,channel,body,created_at").eq("case_id", caseId).eq("possible_complaint", true).is("deleted_at", null).order("created_at", { ascending: false }).limit(5);
    setItems((data ?? []) as FlaggedMessage[]);
  }, [caseId]);
  useEffect(() => { reload(); }, [reload]);
  return { items, reload };
}
export async function dismissComplaintFlag(commId: string) {
  const { error } = await supabase.rpc("dv_dismiss_complaint_flag", { p_comm: commId });
  if (error) throw new Error(error.message);
}
