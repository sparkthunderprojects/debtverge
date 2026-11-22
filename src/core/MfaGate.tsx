import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ShieldCheck } from "lucide-react";
import { Spinner } from "@/core/ui";
import { supabase } from "@/core/supabase";
import { getAssurance, getSecurity, listVerifiedTotp, startEnrol, verifyCode, cancelEnrol } from "@/core/mfa-hooks";

type Step = "loading" | "ok" | "challenge" | "enrol";

/** Sits between sign-in and the app. Anyone who has two-step sign-in set up must pass it; a firm that requires it forces set-up. */
export function MfaGate({ children }: { children: ReactNode }) {
  const [step, setStep] = useState<Step>("loading");
  const [factorId, setFactorId] = useState<string | null>(null);

  const check = useCallback(async () => {
    try {
      const [a, sec, factors] = await Promise.all([getAssurance(), getSecurity(), listVerifiedTotp()]);
      if (factors.length > 0 && a.current !== "aal2") { setFactorId(factors[0].id); setStep("challenge"); }
      else if (sec.requireMfa && factors.length === 0) setStep("enrol");
      else setStep("ok");
    } catch { setStep("ok"); }   // if the check itself fails, the database still enforces access
  }, []);
  useEffect(() => { check(); }, [check]);

  if (step === "loading") return <div className="flex min-h-screen items-center justify-center"><Spinner className="h-7 w-7 text-emerald-600" /></div>;
  if (step === "challenge" && factorId) return <Challenge factorId={factorId} onDone={check} />;
  if (step === "enrol") return <Enrol onDone={check} forced />;
  return <>{children}</>;
}

function Shell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4 dark:bg-slate-900">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-lg dark:border-slate-700 dark:bg-slate-800">
        <div className="mb-4 flex items-center gap-2"><ShieldCheck className="h-6 w-6 text-emerald-600" /><h1 className="text-lg font-bold text-slate-900 dark:text-slate-100">{title}</h1></div>
        {children}
      </div>
    </div>
  );
}

function Challenge({ factorId, onDone }: { factorId: string; onDone: () => void }) {
  const [code, setCode] = useState(""); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true); setErr(null);
    try { await verifyCode(factorId, code); await onDone(); } catch (e) { setErr((e as Error).message); setCode(""); } finally { setBusy(false); }
  }
  return (
    <Shell title="Two-step sign-in">
      <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">Enter the 6-digit code from your authenticator app.</p>
      <input autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === "Enter" && code.replace(/\s/g, "").length === 6 && submit()}
        className="mb-3 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-center text-xl tracking-[0.4em] dark:border-slate-600 dark:bg-slate-900" placeholder="000000" />
      {err && <p className="mb-2 text-xs text-rose-600">{err}</p>}
      <button disabled={busy || code.replace(/\s/g, "").length !== 6} onClick={submit} className="w-full rounded-lg bg-emerald-600 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Checking..." : "Continue"}</button>
      <button onClick={() => supabase.auth.signOut()} className="mt-3 w-full text-xs text-slate-500 hover:underline">Sign out</button>
    </Shell>
  );
}

export function Enrol({ onDone, forced, onCancel }: { onDone: () => void; forced?: boolean; onCancel?: () => void }) {
  const [info, setInfo] = useState<{ factorId: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState(""); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  useEffect(() => { startEnrol().then(setInfo).catch((e) => setErr((e as Error).message)); }, []);
  async function submit() {
    if (!info) return;
    setBusy(true); setErr(null);
    try { await verifyCode(info.factorId, code); onDone(); } catch (e) { setErr((e as Error).message); setCode(""); } finally { setBusy(false); }
  }
  const body = (
    <>
      <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">{forced ? "Your firm requires two-step sign-in. " : ""}Scan this with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password...), then enter the 6-digit code it shows.</p>
      {info ? (
        <>
          <img src={info.qr} alt="Authenticator QR code" className="mx-auto mb-2 h-44 w-44 rounded-lg border border-slate-200 bg-white p-1" />
          <p className="mb-3 break-all text-center text-[11px] text-slate-500">Can't scan? Enter this key: <span className="font-mono">{info.secret}</span></p>
        </>
      ) : !err ? <div className="mb-3 flex justify-center"><Spinner className="h-5 w-5" /></div> : null}
      <input inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === "Enter" && code.replace(/\s/g, "").length === 6 && submit()}
        className="mb-3 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-center text-xl tracking-[0.4em] dark:border-slate-600 dark:bg-slate-900" placeholder="000000" />
      {err && <p className="mb-2 text-xs text-rose-600">{err}</p>}
      <button disabled={busy || !info || code.replace(/\s/g, "").length !== 6} onClick={submit} className="w-full rounded-lg bg-emerald-600 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Checking..." : "Turn on two-step sign-in"}</button>
      {forced ? <button onClick={() => supabase.auth.signOut()} className="mt-3 w-full text-xs text-slate-500 hover:underline">Sign out</button>
        : <button onClick={async () => { if (info) await cancelEnrol(info.factorId); onCancel?.(); }} className="mt-3 w-full text-xs text-slate-500 hover:underline">Cancel</button>}
    </>
  );
  return forced ? <Shell title="Set up two-step sign-in">{body}</Shell> : <div className="max-w-sm">{body}</div>;
}
