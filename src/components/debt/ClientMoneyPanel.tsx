import { useState } from "react";
import { AlertTriangle, Landmark, Loader2 } from "lucide-react";
import { formatCurrency } from "../../lib/format";
import { useCass, setHold, releaseHold, reconcile, HOLD_REASONS } from "../../lib/cass-hooks";

const gbp = (n: number) => formatCurrency(n, "GBP");
const inDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

/** Manager view of client money: what is held, what is overdue to be paid on, and the daily bank reconciliation. */
export function ClientMoneyPanel({ onOpenCase }: { onOpenCase?: (id: string) => void }) {
  const { rows, recons, loading, error, reload } = useCass(true);
  const [bank, setBank] = useState("");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [holdFor, setHoldFor] = useState<string | null>(null);
  const [reason, setReason] = useState("awaiting_creditor_details");
  const [review, setReview] = useState(inDays(7));

  const total = rows.reduce((s, r) => s + r.held, 0);
  const breaches = rows.filter((r) => r.breach);
  const last = recons[0];
  const reconToday = last && last.created_at.slice(0, 10) === new Date().toISOString().slice(0, 10);

  async function run(fn: () => Promise<void>) {
    setBusy(true); setMsg(null);
    try { await fn(); await reload(); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  }
  const doRecon = (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(bank);
    if (!Number.isFinite(n) || bank.trim() === "") return;
    run(async () => {
      const diff = await reconcile(n, note);
      setMsg(Math.abs(diff) < 0.005 ? { ok: true, text: "Reconciled: bank and ledger agree." } : { ok: false, text: `Difference of ${gbp(diff)} between the bank and the ledger. Investigate before close of day.` });
      setBank(""); setNote("");
    });
  };

  if (loading) return <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-emerald-600" /></div>;
  if (error) return <div className="panel p-4 text-xs text-rose-600">{error}</div>;

  return (
    <div className="panel space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2"><Landmark className="h-4 w-4 text-emerald-600" /><h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Client money</h3></div>
        <div className="flex items-center gap-4 text-xs text-slate-500">
          <span>Held: <b className="text-slate-800 dark:text-slate-100">{gbp(total)}</b></span>
          <span className={breaches.length ? "font-bold text-rose-600" : ""}>Over 5 business days: <b>{breaches.length}</b></span>
          <span className={reconToday ? "text-emerald-600" : "font-bold text-amber-600"}>{reconToday ? "Reconciled today" : "Not reconciled today"}</span>
        </div>
      </div>

      {breaches.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg bg-rose-50 p-3 text-xs text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Money is being held on {breaches.length} case{breaches.length > 1 ? "s" : ""} for more than 5 business days with no recorded reason. Pay it on to creditors or record why it is being retained.</span>
        </div>
      )}

      {rows.length === 0 ? <p className="text-sm text-slate-400">No client money is being held.</p> : (
        <table className="w-full text-xs">
          <thead><tr className="border-b border-slate-100 text-left text-[11px] uppercase tracking-wide text-slate-400 dark:border-slate-700"><th className="py-1.5">Case</th><th className="text-right">Held</th><th className="text-right">Days</th><th className="pl-3">Status</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.case_id} className="border-b border-slate-50 align-top dark:border-slate-700/50">
                <td className="py-1.5"><button onClick={() => onOpenCase?.(r.case_id)} className="font-semibold text-slate-800 hover:underline dark:text-slate-100">{r.debtor_name}</button><span className="ml-1 text-slate-400">{r.case_number}</span></td>
                <td className="text-right font-semibold">{gbp(r.held)}</td>
                <td className={`text-right ${r.breach ? "font-bold text-rose-600" : "text-slate-500"}`}>{r.business_days}</td>
                <td className="pl-3">
                  {r.hold_reason ? <span className="text-amber-700">Retained: {HOLD_REASONS[r.hold_reason] ?? r.hold_reason} (review {new Date(r.hold_review + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" })})</span>
                    : r.breach ? <span className="font-bold text-rose-600">Breach</span> : <span className="text-slate-400">Within 5 days</span>}
                </td>
                <td className="text-right">
                  {r.hold_reason ? <button disabled={busy} onClick={() => run(async () => { await releaseHold(r.case_id); })} className="text-[11px] text-slate-500 hover:text-slate-800">Release</button>
                    : <button disabled={busy} onClick={() => setHoldFor(holdFor === r.case_id ? null : r.case_id)} className="text-[11px] font-semibold text-emerald-700 hover:underline">Record reason</button>}
                  {holdFor === r.case_id && (
                    <div className="mt-2 space-y-1 text-left">
                      <select value={reason} onChange={(e) => setReason(e.target.value)} className="input w-full text-xs">{Object.entries(HOLD_REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                      <input type="date" value={review} max={inDays(30)} onChange={(e) => setReview(e.target.value)} className="input w-full text-xs" />
                      <button disabled={busy} onClick={() => run(async () => { await setHold(r.case_id, reason, "", review); setHoldFor(null); })} className="btn btn-primary w-full bg-emerald-600 text-xs hover:bg-emerald-700">Save</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <form onSubmit={doRecon} className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3 dark:border-slate-700">
        <label className="text-[11px] text-slate-500">Client account balance (£)<input value={bank} onChange={(e) => setBank(e.target.value)} inputMode="decimal" className="input mt-0.5 block w-40 text-sm" placeholder="0.00" /></label>
        <label className="flex-1 text-[11px] text-slate-500">Note<input value={note} onChange={(e) => setNote(e.target.value)} className="input mt-0.5 block w-full text-sm" placeholder="Optional" /></label>
        <button disabled={busy || !bank.trim()} className="btn btn-primary bg-emerald-600 hover:bg-emerald-700">Reconcile</button>
      </form>
      {msg && <p className={`text-xs ${msg.ok ? "text-emerald-600" : "text-rose-600"}`}>{msg.text}</p>}
      {recons.length > 0 && <p className="text-[11px] text-slate-400">Last: {new Date(last.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}, difference {gbp(last.difference)}</p>}
    </div>
  );
}
