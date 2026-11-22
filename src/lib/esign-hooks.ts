import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";

export interface SigningRequest { id: string; title: string; status: "pending" | "signed" | "cancelled"; token: string; expires_at: string; signed_at: string | null; signer_name: string | null; created_at: string }
export interface SigningView { found: boolean; title?: string; body?: string; firm?: string; client?: string; status?: "pending" | "signed" | "cancelled" | "expired"; signed_at?: string | null; signer_name?: string | null }

export const signUrl = (token: string) => `${window.location.origin}/sign/${token}`;

export function useSigningRequests(caseId: string | null) {
  const [requests, setRequests] = useState<SigningRequest[]>([]);
  const reload = useCallback(async () => {
    if (!caseId) { setRequests([]); return; }
    const { data } = await supabase.from("signing_requests").select("id,title,status,token,expires_at,signed_at,signer_name,created_at").eq("case_id", caseId).order("created_at", { ascending: false }).limit(10);
    setRequests((data ?? []) as SigningRequest[]);
  }, [caseId]);
  useEffect(() => { reload(); }, [reload]);
  return { requests, reload };
}

export async function createSigningRequest(caseId: string, title: string, body: string): Promise<string> {
  const { data, error } = await supabase.rpc("dv_create_signing_request", { p_case: caseId, p_title: title, p_body: body });
  if (error) throw new Error(error.message);
  return data as string;
}
export async function cancelSigningRequest(id: string) {
  const { error } = await supabase.rpc("dv_cancel_signing_request", { p_id: id });
  if (error) throw new Error(error.message);
}
export async function fetchSigning(token: string): Promise<SigningView> {
  const { data, error } = await supabase.rpc("dv_get_signing_request", { p_token: token });
  if (error) throw new Error(error.message);
  return data as SigningView;
}
export async function signDocument(token: string, name: string) {
  const { data, error } = await supabase.rpc("dv_sign_request", { p_token: token, p_name: name, p_agent: navigator.userAgent });
  if (error) throw new Error(error.message);
  const r = data as { ok: boolean; error?: string };
  if (!r.ok) throw new Error(r.error ?? "Could not sign");
}
