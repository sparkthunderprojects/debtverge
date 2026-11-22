import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/core/supabase";
import { createDebtCase, createDebtCreditor, addAuditMilestone } from "./debt-hooks";
import type { DebtCase, DebtType } from "@/core/types";

export type PlatformKey = "leadverge" | "qualifyverge" | "debtverge" | "draftverge" | "ivaverge";
export type HandoverStatus = "pending" | "accepted" | "rejected" | "completed" | "cancelled";

export interface EcosystemPlatform {
  key: PlatformKey;
  name: string;
  stage: string;
  sort_order: number;
}

export interface HandoverPayload {
  total_debt?: number;
  monthly_disposable_income?: number;
  creditors?: { name: string; type: string; balance: number; reference?: string; rate?: number }[];
  source_case_number?: string;
  plan_type?: string;
  notes?: string;
}

export interface CaseHandover {
  id: string;
  organization_id: string;
  source_platform: PlatformKey;
  target_platform: PlatformKey;
  source_case_id: string | null;
  target_case_id: string | null;
  status: HandoverStatus;
  reason: string | null;
  client_name: string;
  payload: HandoverPayload;
  created_at: string;
  resolved_at: string | null;
}

export const THIS_PLATFORM: PlatformKey = "debtverge";

/** Platforms a DMP case can be handed on to. */
export const OUTBOUND_TARGETS: PlatformKey[] = ["draftverge", "ivaverge"];

export function usePlatforms() {
  const [data, setData] = useState<EcosystemPlatform[]>([]);
  useEffect(() => {
    supabase.from("ecosystem_platforms").select("*").eq("is_active", true).order("sort_order")
      .then(({ data: rows }) => setData((rows ?? []) as EcosystemPlatform[]));
  }, []);
  return data;
}

async function currentOrganizationId(): Promise<string> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) throw new Error("Not signed in");
  const { data, error } = await supabase.from("organization_users").select("organization_id").eq("user_id", uid).limit(1).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Your account is not linked to an organisation");
  return data.organization_id as string;
}

/** Handovers addressed to this platform (inbound) and sent by it (outbound). */
export function useHandovers() {
  const [inbound, setInbound] = useState<CaseHandover[]>([]);
  const [outbound, setOutbound] = useState<CaseHandover[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [i, o] = await Promise.all([
      supabase.from("case_handovers").select("*").eq("target_platform", THIS_PLATFORM).order("created_at", { ascending: false }),
      supabase.from("case_handovers").select("*").eq("source_platform", THIS_PLATFORM).order("created_at", { ascending: false }),
    ]);
    if (i.error || o.error) setError((i.error ?? o.error)!.message);
    else setError(null);
    setInbound((i.data ?? []) as CaseHandover[]);
    setOutbound((o.data ?? []) as CaseHandover[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  return { inbound, outbound, loading, error, reload: load };
}

const DEBT_TYPES: DebtType[] = ["credit_card", "personal_loan", "mortgage_arrears", "utility_arrears", "council_tax", "overdraft", "store_card", "hire_purchase", "other"];

/** Accept an inbound referral: create a DMP case from the snapshot and link it back. */
export async function acceptHandover(h: CaseHandover, caseNumber: string): Promise<DebtCase> {
  const newCase = await createDebtCase({
    case_number: caseNumber,
    debtor_name: h.client_name,
    status: "intake",
    plan_type: "dmp",
    notes: [h.reason, h.payload.notes].filter(Boolean).join(" | ") || undefined,
    organization_id: h.organization_id,
  });
  const patch: Record<string, number> = {};
  if (h.payload.total_debt != null) patch.total_debt = h.payload.total_debt;
  if (h.payload.monthly_disposable_income != null) patch.monthly_disposable_income = h.payload.monthly_disposable_income;
  if (Object.keys(patch).length) await supabase.from("debt_cases").update(patch).eq("id", newCase.id);
  for (const c of h.payload.creditors ?? []) {
    await createDebtCreditor({
      case_id: newCase.id,
      creditor_name: c.name,
      debt_type: (DEBT_TYPES.includes(c.type as DebtType) ? c.type : "other") as DebtType,
      account_reference: c.reference,
      current_balance: c.balance,
      interest_rate: c.rate,
    });
  }
  await addAuditMilestone({
    case_id: newCase.id,
    milestone: "Handover accepted",
    description: `Received from ${h.source_platform}${h.reason ? ` - ${h.reason}` : ""}`,
  });
  await supabase.from("case_handovers").update({
    status: "accepted", target_case_id: newCase.id, resolved_at: new Date().toISOString(),
  }).eq("id", h.id);
  return newCase as DebtCase;
}

export async function rejectHandover(id: string) {
  const { error } = await supabase.from("case_handovers").update({ status: "rejected", resolved_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}

/** Send a DMP case on to another platform with a snapshot of the case data. */
export async function sendHandover(c: DebtCase, target: PlatformKey, reason: string) {
  const organization_id = await currentOrganizationId();
  const { data: creditors } = await supabase.from("debt_creditors").select("creditor_name,debt_type,current_balance,account_reference,interest_rate").eq("case_id", c.id);
  const payload: HandoverPayload = {
    source_case_number: c.case_number,
    total_debt: c.total_debt,
    monthly_disposable_income: c.monthly_disposable_income,
    plan_type: c.plan_type,
    creditors: (creditors ?? []).map((r) => ({ name: r.creditor_name, type: r.debt_type, balance: r.current_balance, reference: r.account_reference ?? undefined, rate: r.interest_rate ?? undefined })),
  };
  const { error } = await supabase.from("case_handovers").insert({
    organization_id, source_platform: THIS_PLATFORM, target_platform: target,
    source_case_id: c.id, client_name: c.debtor_name, reason: reason || null, payload,
  });
  if (error) throw error;
  await addAuditMilestone({ case_id: c.id, milestone: "Handover sent", description: `Handed over to ${target}${reason ? ` - ${reason}` : ""}` });
}
