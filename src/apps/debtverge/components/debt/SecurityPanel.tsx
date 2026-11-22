import { useCallback, useEffect, useState } from "react";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import { Enrol } from "@/core/MfaGate";
import { getAssurance, getSecurity, listVerifiedTotp, removeTotp, setRequireMfa, useMfaMembers, type SecurityState } from "@/core/mfa-hooks";

/** Everyone: turn two-step sign-in on or off for themselves. Admins and operations managers: require it firm-wide and see who has it. */
export function SecurityPanel() {
  const [factorId, setFactorId] = useState<string | null>(null);
  const [aal2, setAal2] = useState(false);
  const [sec, setSec] = useState<SecurityState>({ requireMfa: false, canManage: false });
  const [enrolling, setEnrolling] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { members, reload } = useMfaMembers();

  const load = useCallback(async () => {
    try {
      const [f, a, s] = await Promise.all([listVerifiedTotp(), getAssurance(), getSecurity()]);
      setFactorId(f[0]?.id ?? null); setAal2(a.current === "aal2"); setSec(s);
    } catch { /* leave as is */ }
    reload();
  }, [reload]);
  useEffect(() => { load(); }, [load]);

  async function run(fn: () => Promise<void>) { setErr(null); try { await fn(); await load(); } catch (e) { setErr((e as Error).message); } }
  const missing = (members ?? []).filter((m) => !m.mfa_enrolled);

  return (
    <div className="panel p-4">
      <h3 className="mb-1 flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-100">
        {factorId ? <ShieldCheck className="h-4 w-4 text-emerald-600" /> : <ShieldAlert className="h-4 w-4 text-amber-600" />} Two-step sign-in
      </h3>
      {err && <p className="mb-2 text-xs text-rose-600">{err}</p>}
      {enrolling ? <Enrol onDone={() => { setEnrolling(false); load(); }} onCancel={() => setEnrolling(false)} /> : factorId ? (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-emerald-700 dark:text-emerald-400">On for your account.</span>
          {sec.requireMfa ? <span className="text-xs text-slate-500">Your firm requires it, so it can't be turned off.</span> :
            <button onClick={() => aal2 && run(() => removeTotp(factorId))} disabled={!aal2} title={aal2 ? "" : "Sign in with your code first"} className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold disabled:opacity-50 dark:border-slate-600">Turn off</button>}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-slate-600 dark:text-slate-300">Add a code from your phone to sign-in. It protects client data if your password is ever stolen.</span>
          <button onClick={() => setEnrolling(true)} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white">Turn on</button>
        </div>
      )}
      {sec.canManage && members && (
        <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-800">
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={sec.requireMfa} disabled={!factorId || !aal2} onChange={(e) => run(() => setRequireMfa(e.target.checked))} />
            <span><span className="font-semibold">Require two-step sign-in for everyone in the firm.</span>
              <span className="block text-xs text-slate-500">Staff without it are asked to set it up at next sign-in, and cannot see cases until they do. {!factorId ? "Turn it on for yourself first." : !aal2 ? "Sign in with your code first." : ""}</span></span>
          </label>
          <p className="mt-3 text-xs font-bold uppercase tracking-wide text-slate-500">Staff {missing.length > 0 ? `(${missing.length} without it)` : "(all set)"}</p>
          <ul className="mt-1 divide-y divide-slate-100 text-sm dark:divide-slate-800">
            {members.map((m) => (
              <li key={m.user_id} className="flex items-center gap-2 py-1.5">
                <span className="font-medium">{m.full_name || m.email}</span><span className="text-xs text-slate-500">{m.role_name}</span>
                <span className={`ml-auto text-xs font-semibold ${m.mfa_enrolled ? "text-emerald-600" : "text-amber-600"}`}>{m.mfa_enrolled ? "On" : "Not set up"}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
