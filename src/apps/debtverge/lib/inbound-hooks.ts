import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/core/supabase";

export interface UnassignedMessage { id: string; channel: "sms" | "whatsapp" | "email"; sender_name: string; sender_email_or_phone: string; body: string; received_at: string; to_number: string | null }
export interface FirmNumber { id: string; e164: string; label: string | null }

/** Messages that arrived on the firm's number but could not be matched to exactly one case. Managers only (the database refuses anyone else). */
export function useUnassigned() {
  const [items, setItems] = useState<UnassignedMessage[]>([]);
  const [numbers, setNumbers] = useState<FirmNumber[]>([]);
  const [allowed, setAllowed] = useState(false);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    const [m, n] = await Promise.all([supabase.rpc("dv_list_unassigned"), supabase.rpc("dv_list_org_numbers")]);
    if (m.error) { setAllowed(false); } else { setAllowed(true); setItems((m.data ?? []) as UnassignedMessage[]); setNumbers((n.data ?? []) as FirmNumber[]); }
    setLoading(false);
  }, []);
  useEffect(() => { reload(); const t = setInterval(reload, 60000); return () => clearInterval(t); }, [reload]);
  return { items, numbers, allowed, loading, reload };
}

export async function assignUnassigned(msg: string, caseId: string) {
  const { error } = await supabase.rpc("dv_assign_unassigned", { p_msg: msg, p_case: caseId });
  if (error) throw new Error(error.message);
}
export async function dismissUnassigned(msg: string, reason: string) {
  const { error } = await supabase.rpc("dv_dismiss_unassigned", { p_msg: msg, p_reason: reason });
  if (error) throw new Error(error.message);
}
export async function addFirmNumber(e164: string, label: string) {
  const { error } = await supabase.rpc("dv_add_org_number", { p_e164: e164.replace(/[\s()-]/g, ""), p_label: label });
  if (error) throw new Error(error.message);
}
export async function removeFirmNumber(id: string) {
  const { error } = await supabase.rpc("dv_remove_org_number", { p_id: id });
  if (error) throw new Error(error.message);
}
export async function searchCases(q: string): Promise<{ id: string; case_number: string; debtor_name: string }[]> {
  const t = q.trim().replace(/[%,()]/g, "");
  if (t.length < 2) return [];
  const { data } = await supabase.from("debt_cases").select("id, case_number, debtor_name").is("deleted_at", null)
    .or(`case_number.ilike.%${t}%,debtor_name.ilike.%${t}%`).limit(8);
  return (data ?? []) as { id: string; case_number: string; debtor_name: string }[];
}
