import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";

export interface Complaint {
  id: string; case_id: string | null; reference: string; complainant: string; received_on: string; channel: string; category: string;
  summary: string; vulnerable: boolean; status: "open" | "acknowledged" | "investigating" | "final_response" | "closed";
  acknowledged_on: string | null; final_response_on: string | null; outcome: string | null; redress_amount: number | null; referred_to_fos: boolean;
}
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

export async function logComplaint(p: { caseId: string | null; complainant: string; summary: string; category: string; channel: string; vulnerable: boolean }) {
  const { error } = await supabase.rpc("dv_log_complaint", { p_case: p.caseId, p_complainant: p.complainant, p_summary: p.summary, p_category: p.category, p_channel: p.channel, p_received: null, p_vulnerable: p.vulnerable });
  if (error) throw new Error(error.message);
}
export async function updateComplaint(id: string, status: Complaint["status"], outcome: string | null, redress: number | null, note: string, fos: boolean | null) {
  const { error } = await supabase.rpc("dv_complaint_update", { p_id: id, p_status: status, p_outcome: outcome, p_redress: redress, p_note: note || null, p_fos: fos });
  if (error) throw new Error(error.message);
}
