import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";

export interface VoidedCase { id: string; case_number: string; debtor_name: string; voided_at: string; erased_at: string | null }

export function useVoidedCases() {
  const [items, setItems] = useState<VoidedCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    const { data, error } = await supabase.rpc("dv_list_voided_cases");
    if (error) setError(error.message); else { setItems((data ?? []) as VoidedCase[]); setError(null); }
    setLoading(false);
  }, []);
  useEffect(() => { reload(); }, [reload]);
  return { items, loading, error, reload };
}
export async function restoreCase(id: string) {
  const { error } = await supabase.rpc("dv_restore_case", { p_case: id });
  if (error) throw new Error(error.message);
}
export async function eraseCase(id: string, reason: string): Promise<number> {
  const { data, error } = await supabase.rpc("dv_erase_case", { p_case: id, p_reason: reason });
  if (error) throw new Error(error.message);
  return (data as { fields_erased: number }).fields_erased;
}
