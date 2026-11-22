import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";

export interface FeeRule { id: string; name: string; kind: "percent_of_receipt" | "fixed_monthly"; percent: number | null; monthly_amount: number | null; max_per_month: number | null; active: boolean }
export interface FeeCharge { id: string; amount: number; status: "due" | "taken" | "waived"; charged_on: string; rule_id: string }

export const ruleSummary = (r: FeeRule) => (r.kind === "percent_of_receipt" ? `${r.percent}% of each payment received` : `£${r.monthly_amount} each month`) + (r.max_per_month ? `, max £${r.max_per_month} a month` : "");

export function useFeeRules() {
  const [rules, setRules] = useState<FeeRule[]>([]);
  const reload = useCallback(async () => {
    const { data } = await supabase.from("fee_rules").select("*").order("created_at");
    setRules(((data ?? []) as FeeRule[]).map((r) => ({ ...r, percent: r.percent === null ? null : Number(r.percent), monthly_amount: r.monthly_amount === null ? null : Number(r.monthly_amount), max_per_month: r.max_per_month === null ? null : Number(r.max_per_month) })));
  }, []);
  useEffect(() => { reload(); }, [reload]);
  return { rules, reload };
}
export function useCaseFees(caseId: string | null) {
  const [charges, setCharges] = useState<FeeCharge[]>([]);
  const reload = useCallback(async () => {
    if (!caseId) { setCharges([]); return; }
    const { data } = await supabase.from("fee_charges").select("id,amount,status,charged_on,rule_id").eq("case_id", caseId).order("charged_on", { ascending: false });
    setCharges(((data ?? []) as FeeCharge[]).map((c) => ({ ...c, amount: Number(c.amount) })));
  }, [caseId]);
  useEffect(() => { reload(); }, [reload]);
  return { charges, reload };
}
async function rpc<T = unknown>(fn: string, args: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}
export const saveFeeRule = (r: { id?: string; name: string; kind: FeeRule["kind"]; percent: number | null; monthly: number | null; max: number | null; active: boolean }) =>
  rpc("dv_save_fee_rule", { p_id: r.id ?? null, p_name: r.name, p_kind: r.kind, p_percent: r.percent, p_monthly: r.monthly, p_max: r.max, p_active: r.active });
export const postFees = (caseId: string) => rpc<number>("dv_post_fees", { p_case: caseId });
export const decideFee = (id: string, take: boolean) => rpc("dv_decide_fee", { p_charge: id, p_take: take });
