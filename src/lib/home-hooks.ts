import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import type { DebtCase } from "./types";

export interface HomeTask { id: string; case_id: string; title: string; kind: string; due_date: string | null; assigned_to: string | null }

export interface HomeData {
  tasks: HomeTask[];
  cases: DebtCase[];
  collected30d: number;
  shortfalls30d: number;
  pendingChangeRequests: number;
  flaggedChangeRequests: number;
  pendingReferrals: number;
  highVulnerability: number;
  distributionsScheduled: number;
  distributionsFailed: number;
  names: Record<string, string>;
}

const EMPTY: HomeData = {
  tasks: [], cases: [], collected30d: 0, shortfalls30d: 0, pendingChangeRequests: 0, flaggedChangeRequests: 0,
  pendingReferrals: 0, highVulnerability: 0, distributionsScheduled: 0, distributionsFailed: 0, names: {},
};

export const todayISO = () => new Date().toISOString().slice(0, 10);

export function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  return Math.round((new Date(iso).getTime() - new Date(todayISO()).getTime()) / 86400000);
}

/** One load of everything the role home screens need. Row access is enforced by RLS. */
export function useHomeData() {
  const [data, setData] = useState<HomeData>(EMPTY);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const [cases, pays, crs, refs, vuln, dists, tks] = await Promise.all([
      supabase.from("debt_cases").select("*").order("created_at", { ascending: false }),
      supabase.from("debt_payments").select("amount,is_shortfall,shortfall_amount,payment_date").gte("payment_date", since),
      supabase.from("portal_change_requests").select("flags_vulnerability").eq("status", "pending"),
      supabase.from("case_handovers").select("id").eq("target_platform", "debtverge").eq("status", "pending"),
      supabase.from("debt_vulnerability_assessments").select("vulnerability_level").in("vulnerability_level", ["high", "critical"]),
      supabase.from("debt_distributions").select("status"),
      supabase.from("case_tasks").select("id,case_id,title,kind,due_date,assigned_to").eq("status", "open"),
    ]);
    const caseRows = (cases.data ?? []) as DebtCase[];
    const ids = Array.from(new Set(caseRows.map((c) => c.assigned_to).filter(Boolean))) as string[];
    const names: Record<string, string> = {};
    if (ids.length) {
      const { data: profs } = await supabase.from("profiles").select("id, full_name, email").in("id", ids);
      for (const p of profs ?? []) names[p.id as string] = (p.full_name as string) || (p.email as string) || "Advisor";
    }
    const payRows = pays.data ?? [];
    setData({
      tasks: (tks.data ?? []) as HomeTask[],
      cases: caseRows,
      collected30d: payRows.reduce((s, p) => s + Number(p.amount ?? 0), 0),
      shortfalls30d: payRows.filter((p) => p.is_shortfall).length,
      pendingChangeRequests: (crs.data ?? []).length,
      flaggedChangeRequests: (crs.data ?? []).filter((r) => r.flags_vulnerability).length,
      pendingReferrals: (refs.data ?? []).length,
      highVulnerability: (vuln.data ?? []).length,
      distributionsScheduled: (dists.data ?? []).filter((d) => d.status === "scheduled").length,
      distributionsFailed: (dists.data ?? []).filter((d) => d.status === "failed").length,
      names,
    });
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  return { data, loading, reload: load };
}
