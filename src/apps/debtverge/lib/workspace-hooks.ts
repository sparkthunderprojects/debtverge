import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/core/supabase";
import type { Organization } from "@/core/types";

// ============================================================
// Organizations
// ============================================================

export function useOrganizations() {
  const [data, setData] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data: rows, error: err } = await supabase.from("organizations").select("*").order("name");
    if (err) { setError(err.message); setLoading(false); return; }
    setData(rows ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  return { data, loading, error, reload: load };
}
