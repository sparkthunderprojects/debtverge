import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/core/supabase";

export interface CassRow {
  case_id: string; case_number: string; debtor_name: string; assigned_to: string | null;
  held: number; oldest_receipt: string | null; business_days: number;
  hold_reason: string | null; hold_review: string | null; breach: boolean;
}
export interface Reconciliation { id: string; recon_date: string; bank_balance: number; ledger_total: number; difference: number; note: string | null; created_at: string }

export const HOLD_REASONS: Record<string, string> = {
  awaiting_creditor_details: "Awaiting creditor details",
  creditor_dispute: "Creditor dispute",
  client_request: "Client request",
  payment_returned: "Payment returned",
  fees_being_agreed: "Fees being agreed",
  other: "Other",
};

export function useCass(enabled: boolean) {
  const [rows, setRows] = useState<CassRow[]>([]);
  const [recons, setRecons] = useState<Reconciliation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    if (!enabled) { setLoading(false); return; }
    const [p, r] = await Promise.all([
      supabase.rpc("dv_cass_position"),
      supabase.from("cass_reconciliations").select("*").order("created_at", { ascending: false }).limit(5),
    ]);
    setError(p.error?.message ?? null);
    setRows(((p.data ?? []) as CassRow[]).map((x) => ({ ...x, held: Number(x.held) })));
    setRecons(((r.data ?? []) as Reconciliation[]).map((x) => ({ ...x, bank_balance: Number(x.bank_balance), ledger_total: Number(x.ledger_total), difference: Number(x.difference) })));
    setLoading(false);
  }, [enabled]);
  useEffect(() => { reload(); }, [reload]);
  return { rows, recons, loading, error, reload };
}

async function rpc<T = unknown>(fn: string, args: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}
export const setHold = (caseId: string, reason: string, note: string, review: string) => rpc("dv_cass_set_hold", { p_case: caseId, p_reason: reason, p_note: note || null, p_review: review });
export const releaseHold = (caseId: string) => rpc("dv_cass_release_hold", { p_case: caseId });
export const reconcile = (bank: number, note: string) => rpc<number>("dv_cass_reconcile", { p_bank_balance: bank, p_note: note || null });
