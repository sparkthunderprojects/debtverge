import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";

export interface MfaMember { user_id: string; email: string | null; full_name: string | null; role_name: string; mfa_enrolled: boolean }
export interface SecurityState { requireMfa: boolean; canManage: boolean }

/** Verified authenticator-app (TOTP) factors for the signed-in user. */
export async function listVerifiedTotp() {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) throw new Error(error.message);
  return (data?.totp ?? []).filter((f) => f.status === "verified");
}
export async function getAssurance() {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) throw new Error(error.message);
  return { current: data.currentLevel, next: data.nextLevel };
}
export async function getSecurity(): Promise<SecurityState> {
  const { data } = await supabase.rpc("dv_get_security");
  const d = (data ?? {}) as { require_mfa?: boolean; can_manage?: boolean };
  return { requireMfa: !!d.require_mfa, canManage: !!d.can_manage };
}
/** Starts enrolment. Any half-finished (unverified) factor from a previous try is removed first, so the user is never stuck. */
export async function startEnrol() {
  const { data: all } = await supabase.auth.mfa.listFactors();
  for (const f of all?.all ?? []) if (f.factor_type === "totp" && f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `DebtVerge ${new Date().toISOString().slice(0, 10)}` });
  if (error) throw new Error(error.message);
  return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
}
export async function verifyCode(factorId: string, code: string) {
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.replace(/\s/g, "") });
  if (error) throw new Error(error.message.toLowerCase().includes("invalid") ? "That code is not right. Check the time on your phone and try the newest code." : error.message);
}
export async function cancelEnrol(factorId: string) { await supabase.auth.mfa.unenroll({ factorId }); }
export async function removeTotp(factorId: string) {
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) throw new Error(error.message);
}
export async function setRequireMfa(on: boolean) {
  const { error } = await supabase.rpc("dv_set_require_mfa", { p_on: on });
  if (error) throw new Error(error.message);
}

export function useMfaMembers() {
  const [members, setMembers] = useState<MfaMember[] | null>(null);
  const reload = useCallback(async () => {
    const { data, error } = await supabase.rpc("dv_mfa_status");
    setMembers(error ? null : ((data ?? []) as MfaMember[]));
  }, []);
  useEffect(() => { reload(); }, [reload]);
  return { members, reload };
}
