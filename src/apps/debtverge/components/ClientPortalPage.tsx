import { useEffect, useState } from "react";
import { CheckCircle2, Clock, CreditCard, Landmark, Loader2, ShieldCheck, UserCog } from "lucide-react";
import { fetchPortalLink, fetchPaymentState, startPaymentSession, submitChangeRequest, type PortalLinkView, type LinkPaymentState } from "@/apps/debtverge/lib/portal-hooks";

const gbp = (n = 0) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);

/** Public, no-login page opened from a payment link: what's due, plan progress, and change requests. */
export function ClientPortalPage({ token }: { token: string }) {
  const [view, setView] = useState<PortalLinkView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showChange, setShowChange] = useState(false);
  const [pay, setPay] = useState<LinkPaymentState | null>(null);
  const [starting, setStarting] = useState<"bank_pay" | "direct_debit" | null>(null);
  const [payError, setPayError] = useState<string | null>(null);
  const done = new URLSearchParams(window.location.search).get("done");

  useEffect(() => {
    fetchPortalLink(token).then(setView).catch(() => setError("We couldn't load this page. Please try again."));
    fetchPaymentState(token).then(setPay).catch(() => undefined);
  }, [token]);

  // After returning from the bank, the payment is confirmed in the background: check a few times.
  useEffect(() => {
    if (done !== "bank_pay") return;
    let n = 0;
    const t = setInterval(() => {
      n += 1;
      fetchPortalLink(token).then(setView).catch(() => undefined);
      fetchPaymentState(token).then(setPay).catch(() => undefined);
      if (n >= 12) clearInterval(t);
    }, 5000);
    return () => clearInterval(t);
  }, [done, token]);

  const begin = async (mode: "bank_pay" | "direct_debit") => {
    setStarting(mode); setPayError(null);
    try { window.location.href = await startPaymentSession(token, mode); }
    catch (e) { setPayError(e instanceof Error ? e.message : "Something went wrong"); setStarting(null); }
  };

  const progress = view?.total_debt ? Math.min(100, Math.round(((view.paid_to_date ?? 0) / view.total_debt) * 100)) : 0;

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8 dark:bg-slate-900">
      <div className="mx-auto max-w-md space-y-4">
        <div className="text-center">
          <p className="text-xs font-bold uppercase tracking-widest text-emerald-600">{view?.firm ?? "DebtVerge"}</p>
          <h1 className="mt-1 text-xl font-bold text-slate-900 dark:text-slate-100">Your payment</h1>
        </div>

        {!view && !error && <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-emerald-600" /></div>}
        {error && <div className="rounded-xl bg-rose-50 p-4 text-sm text-rose-700">{error}</div>}
        {view && !view.found && (
          <div className="rounded-2xl bg-white p-6 text-center shadow-sm dark:bg-slate-800">
            <p className="font-semibold text-slate-800 dark:text-slate-100">This link isn't valid.</p>
            <p className="mt-1 text-sm text-slate-500">Please contact your adviser for a new one.</p>
          </div>
        )}

        {view?.found && (
          <>
            <div className="rounded-2xl bg-white p-6 shadow-sm dark:bg-slate-800">
              <p className="text-sm text-slate-500">Hi {view.first_name},</p>
              {view.status === "active" ? (
                <>
                  <p className="mt-1 text-sm text-slate-500">{view.reason ?? "Payment due"}</p>
                  <p className="mt-3 text-4xl font-bold text-slate-900 dark:text-slate-100">{gbp(view.amount)}</p>
                  <p className="mt-1 flex items-center gap-1 text-xs text-slate-400"><Clock className="h-3 w-3" /> Link valid until {new Date(view.expires_at!).toLocaleDateString("en-GB")}</p>
                  <div className="mt-5 space-y-2">
                    <button onClick={() => begin("bank_pay")} disabled={starting !== null} className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-sm font-bold text-white disabled:opacity-60">
                      {starting === "bank_pay" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Landmark className="h-4 w-4" />} Pay {gbp(view.amount)} by bank
                    </button>
                    {pay?.mandate === "active" ? (
                      <p className="flex items-center justify-center gap-1 text-xs text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> Direct Debit is set up for your monthly payments</p>
                    ) : (
                      <button onClick={() => begin("direct_debit")} disabled={starting !== null} className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 py-3 text-sm font-bold text-slate-600 disabled:opacity-60 dark:border-slate-600 dark:text-slate-300">
                        {starting === "direct_debit" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />} Set up Direct Debit instead
                      </button>
                    )}
                  </div>
                  {payError && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-center text-xs text-amber-800">{payError}</p>}
                  {done === "bank_pay" && <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-center text-xs text-emerald-800">Thanks. We're confirming your payment with the bank. This page updates by itself.</p>}
                  {done === "direct_debit" && <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-center text-xs text-emerald-800">Thanks. Your Direct Debit is being set up. You'll get confirmation from your bank.</p>}
                </>
              ) : (
                <div className="mt-3 flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                  {view.status === "paid" ? "Thank you, this payment has been received." : "This link is no longer active. Please contact your adviser."}
                </div>
              )}
            </div>

            <div className="rounded-2xl bg-white p-6 shadow-sm dark:bg-slate-800">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Your plan · {view.reference}</p>
              <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
                <div className="h-full rounded-full bg-emerald-500" style={{ width: `${progress}%` }} />
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div><p className="text-lg font-bold text-slate-900 dark:text-slate-100">{gbp(view.paid_to_date)}</p><p className="text-[11px] text-slate-400">Paid so far</p></div>
                <div><p className="text-lg font-bold text-slate-900 dark:text-slate-100">{gbp(view.remaining)}</p><p className="text-[11px] text-slate-400">Left to pay</p></div>
                <div><p className="text-lg font-bold text-emerald-600">{progress}%</p><p className="text-[11px] text-slate-400">Complete</p></div>
              </div>
              {view.monthly_payment != null && <p className="mt-3 text-center text-xs text-slate-500">Monthly payment {gbp(view.monthly_payment)}{view.next_due ? ` · next due ${new Date(view.next_due).toLocaleDateString("en-GB")}` : ""}</p>}
            </div>

            <div className="rounded-2xl bg-white p-6 shadow-sm dark:bg-slate-800">
              <button onClick={() => setShowChange((v) => !v)} className="flex w-full items-center justify-between text-left">
                <span className="flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-100"><UserCog className="h-4 w-4 text-emerald-600" /> Update your details</span>
                <span className="text-xs text-emerald-600">{showChange ? "Close" : "Open"}</span>
              </button>
              {showChange && <ChangeForm token={token} />}
            </div>

            <p className="flex items-center justify-center gap-1 text-[11px] text-slate-400"><ShieldCheck className="h-3 w-3" /> Secure link. We will never ask for your full card number by text or email.</p>
          </>
        )}
      </div>
    </div>
  );
}

const FIELDS: { value: string; label: string }[] = [
  { value: "mobile_phone", label: "Mobile number" },
  { value: "primary_email", label: "Email address" },
  { value: "landline_phone", label: "Landline" },
  { value: "address_street", label: "Street address" },
  { value: "address_city", label: "Town / city" },
  { value: "address_postcode", label: "Postcode" },
  { value: "__care", label: "Something your adviser should know" },
];

function ChangeForm({ token }: { token: string }) {
  const [field, setField] = useState("mobile_phone");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const isCare = field === "__care";

  const send = async () => {
    if (!value.trim()) return;
    setBusy(true); setErr(null);
    try {
      if (isCare) await submitChangeRequest(token, "care", null, "", value.trim());
      else await submitChangeRequest(token, "contact", field, value.trim(), "");
      setDone(true); setValue("");
    } catch (e) { setErr(e instanceof Error ? e.message : "Something went wrong"); }
    finally { setBusy(false); }
  };

  if (done) return (
    <div className="mt-4 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300">
      Thanks, your adviser will review this and let you know. <button onClick={() => setDone(false)} className="ml-1 underline">Send another</button>
    </div>
  );
  return (
    <div className="mt-4 space-y-3">
      <select value={field} onChange={(e) => setField(e.target.value)} className="input text-sm">
        {FIELDS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
      </select>
      {isCare
        ? <textarea value={value} onChange={(e) => setValue(e.target.value)} rows={4} maxLength={2000} placeholder="Tell us anything that affects how we should support you" className="input text-sm" />
        : <input value={value} onChange={(e) => setValue(e.target.value)} maxLength={500} placeholder="New value" className="input text-sm" />}
      {err && <p className="text-xs text-rose-600">{err}</p>}
      <button onClick={send} disabled={busy || !value.trim()} className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-2.5 text-sm font-bold text-white disabled:opacity-50">
        {busy && <Loader2 className="h-4 w-4 animate-spin" />} Send to my adviser
      </button>
      <p className="text-[11px] text-slate-400">Changes are checked by your adviser before they're applied.</p>
    </div>
  );
}
