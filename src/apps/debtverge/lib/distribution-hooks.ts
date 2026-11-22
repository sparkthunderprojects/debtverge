import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/core/supabase";

export interface DistributionItem { id: string; payee_name: string; payee_reference: string | null; amount: number; status: string }
export interface DistributionRun {
  id: string; file_reference: string | null; status: "draft" | "approved" | "generated" | "submitted" | "settled" | "failed";
  total_amount: number; total_items: number; created_by: string | null; approved_by: string | null; run_date: string; created_at: string;
  items: DistributionItem[];
}

export function useDistributions(caseId: string | null) {
  const [runs, setRuns] = useState<DistributionRun[]>([]);
  const [funds, setFunds] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    if (!caseId) { setRuns([]); setFunds(null); setLoading(false); return; }
    const [r, f] = await Promise.all([
      supabase.from("disbursement_runs").select("*").eq("case_id", caseId).order("created_at", { ascending: false }).limit(10),
      supabase.rpc("dv_case_distributable", { p_case: caseId }),
    ]);
    const list = (r.data ?? []) as Omit<DistributionRun, "items">[];
    const ids = list.map((x) => x.id);
    const items = ids.length ? ((await supabase.from("disbursement_run_items").select("*").in("disbursement_run_id", ids)).data ?? []) as (DistributionItem & { disbursement_run_id: string })[] : [];
    setRuns(list.map((x) => ({ ...x, total_amount: Number(x.total_amount), items: items.filter((i) => i.disbursement_run_id === x.id).map((i) => ({ ...i, amount: Number(i.amount) })) })));
    setFunds(f.data === null || f.data === undefined ? null : Number(f.data));
    setLoading(false);
  }, [caseId]);
  useEffect(() => { setLoading(true); reload(); }, [reload]);
  return { runs, funds, loading, reload };
}

async function rpc(fn: string, args: Record<string, unknown>) {
  const { error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
}
export const createDistributionRun = (caseId: string) => rpc("dv_create_distribution_run", { p_case: caseId });
export const approveDistributionRun = (id: string) => rpc("dv_approve_distribution_run", { p_run: id });
export const cancelDistributionRun = (id: string) => rpc("dv_cancel_distribution_run", { p_run: id });
export const markDistributionPaid = (id: string) => rpc("dv_mark_distribution_paid", { p_run: id });
