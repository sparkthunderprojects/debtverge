import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import { fetchSigning, signDocument, type SigningView } from "@/apps/debtverge/lib/esign-hooks";

/** Public page a client opens from their signing link. No login: the link itself is the key. */
export function SignPage({ token }: { token: string }) {
  const [view, setView] = useState<SigningView | null>(null);
  const [name, setName] = useState("");
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => { fetchSigning(token).then(setView).catch((e) => setErr((e as Error).message)); }, [token]);

  async function sign(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try { await signDocument(token, name); setDone(true); } catch (e2) { setErr((e2 as Error).message); } finally { setBusy(false); }
  }

  if (!view && !err) return <div className="flex min-h-screen items-center justify-center bg-slate-50"><Loader2 className="h-6 w-6 animate-spin text-emerald-600" /></div>;
  const shell = (children: React.ReactNode) => <div className="min-h-screen bg-slate-50 px-4 py-8"><div className="mx-auto max-w-2xl space-y-4">{children}</div></div>;

  if (!view?.found) return shell(<div className="rounded-xl bg-white p-6 text-center shadow-sm"><h1 className="text-lg font-bold text-slate-900">This link is not valid</h1><p className="mt-1 text-sm text-slate-500">Please ask your adviser to send you a new one.</p></div>);
  if (done || view.status === "signed") return shell(
    <div className="rounded-xl bg-white p-8 text-center shadow-sm">
      <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" />
      <h1 className="mt-3 text-lg font-bold text-slate-900">Thank you, this is signed</h1>
      <p className="mt-1 text-sm text-slate-500">{view.firm} has a copy. You do not need to do anything else.</p>
    </div>);
  if (view.status !== "pending") return shell(<div className="rounded-xl bg-white p-6 text-center shadow-sm"><h1 className="text-lg font-bold text-slate-900">This request is no longer open</h1><p className="mt-1 text-sm text-slate-500">Please ask {view.firm} to send you a new one.</p></div>);

  return shell(
    <>
      <div className="rounded-xl bg-white p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{view.firm}</p>
        <h1 className="mt-1 text-xl font-bold text-slate-900">{view.title}</h1>
        <p className="mt-1 text-sm text-slate-500">Please read this carefully, then sign at the bottom.</p>
        <pre className="mt-4 whitespace-pre-wrap rounded-lg bg-slate-50 p-4 font-sans text-sm leading-relaxed text-slate-800">{view.body}</pre>
      </div>
      <form onSubmit={sign} className="space-y-3 rounded-xl bg-white p-6 shadow-sm">
        <label className="block text-sm font-semibold text-slate-800">Type your full name to sign
          <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-base" placeholder={view.client ?? "Full name"} autoComplete="name" />
        </label>
        <label className="flex items-start gap-2 text-sm text-slate-700"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-1" /> I have read this document and I agree to it. I understand typing my name is my electronic signature.</label>
        {err && <p className="text-sm text-rose-600">{err}</p>}
        <button disabled={busy || !agree || name.trim().length < 3} className="w-full rounded-lg bg-emerald-600 px-4 py-3 text-base font-bold text-white disabled:opacity-40">Sign document</button>
        <p className="flex items-center justify-center gap-1 text-[11px] text-slate-400"><ShieldCheck className="h-3.5 w-3.5" /> The date, time and a fingerprint of this document are recorded.</p>
      </form>
    </>);
}
