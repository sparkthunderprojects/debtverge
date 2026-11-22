import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/core/supabase";

export interface PortalLinkView {
  found: boolean;
  status?: "active" | "paid" | "expired" | "cancelled";
  amount?: number;
  reason?: string | null;
  expires_at?: string;
  firm?: string;
  first_name?: string;
  reference?: string;
  total_debt?: number;
  paid_to_date?: number;
  remaining?: number;
  monthly_payment?: number | null;
  next_due?: string | null;
}

export interface PaymentLink {
  id: string;
  case_id: string;
  token: string;
  amount: number;
  reason: string | null;
  status: string;
  expires_at: string;
  created_at: string;
  last_viewed_at: string | null;
}

export interface ChangeRequest {
  id: string;
  case_id: string;
  request_type: "contact" | "care" | "note";
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  note: string | null;
  flags_vulnerability: boolean;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  decision_note: string | null;
  debt_cases?: { case_number: string; debtor_name: string } | null;
}

export const payUrl = (token: string) => `${window.location.origin}/pay/${token}`;

/* ---------- Client side (no login) ---------- */
export async function fetchPortalLink(token: string): Promise<PortalLinkView> {
  const { data, error } = await supabase.rpc("get_payment_link", { p_token: token });
  if (error) throw error;
  return data as PortalLinkView;
}

export async function submitChangeRequest(token: string, type: "contact" | "care" | "note", field: string | null, value: string, note: string) {
  const { data, error } = await supabase.rpc("submit_change_request", { p_token: token, p_type: type, p_field: field, p_value: value, p_note: note });
  if (error) throw error;
  const r = data as { ok: boolean; error?: string };
  if (!r.ok) throw new Error(r.error ?? "Could not submit");
}

/* ---------- Adviser side ---------- */
export async function createPaymentLink(caseId: string, organizationId: string, amount: number, reason: string, days = 14): Promise<PaymentLink> {
  const { data, error } = await supabase.from("payment_links").insert({
    case_id: caseId, organization_id: organizationId, amount, reason: reason || null,
    expires_at: new Date(Date.now() + days * 86400000).toISOString(),
  }).select("*").single();
  if (error) throw error;
  return data as PaymentLink;
}

export function usePaymentLinks(caseId: string | null) {
  const [data, setData] = useState<PaymentLink[]>([]);
  const load = useCallback(async () => {
    if (!caseId) { setData([]); return; }
    const { data: rows } = await supabase.from("payment_links").select("*").eq("case_id", caseId).order("created_at", { ascending: false }).limit(10);
    setData((rows ?? []) as PaymentLink[]);
  }, [caseId]);
  useEffect(() => { load(); }, [load]);
  return { data, reload: load };
}

export function useChangeRequests() {
  const [data, setData] = useState<ChangeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    const { data: rows } = await supabase
      .from("portal_change_requests")
      .select("*, debt_cases(case_number, debtor_name)")
      .order("flags_vulnerability", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(100);
    setData((rows ?? []) as ChangeRequest[]);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  return { data, loading, reload: load };
}

export async function decideChangeRequest(id: string, approve: boolean, note: string) {
  const { error } = await supabase.rpc("decide_change_request", { p_id: id, p_approve: approve, p_note: note || null });
  if (error) throw error;
}

/* ---------- Online payment (GoCardless via edge function) ---------- */
export interface LinkPaymentState { found: boolean; mandate?: string | null; last_attempt?: string | null }

export async function fetchPaymentState(token: string): Promise<LinkPaymentState> {
  const { data, error } = await supabase.rpc("get_link_payment_state", { p_token: token });
  if (error) throw error;
  return data as LinkPaymentState;
}

/** Returns the hosted payment/mandate URL, or throws a message fit to show the client. */
export async function startPaymentSession(token: string, mode: "bank_pay" | "direct_debit"): Promise<string> {
  const base = import.meta.env.VITE_SUPABASE_URL as string;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
  let res: Response;
  try {
    res = await fetch(`${base}/functions/v1/client-payment-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}` },
      body: JSON.stringify({ token, mode }),
    });
  } catch {
    throw new Error("We couldn't reach the payment service. Please try again.");
  }
  const out = await res.json().catch(() => ({}));
  if (res.ok && out.url) return out.url as string;
  if (res.status === 404 || res.status === 503) throw new Error("Online payment isn't switched on for your firm yet. Please contact your adviser to pay.");
  throw new Error(out.error ?? "We couldn't start the payment. Please try again.");
}
