import { useState } from "react";
import { Inbox, Send, X, Check, Ban, ArrowRight, Loader2 } from "lucide-react";
import type { DebtCase } from "@/lib/types";
import { formatCurrency } from "@/lib/format";
import { generateCaseNumber } from "@/lib/debt-hooks";
import {
  useHandovers, usePlatforms, acceptHandover, rejectHandover, sendHandover,
  OUTBOUND_TARGETS, type CaseHandover, type PlatformKey,
} from "@/lib/ecosystem-hooks";

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
  accepted: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
  completed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
  rejected: "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300",
  cancelled: "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400",
};

function platformName(list: { key: string; name: string }[], key: string) {
  return list.find((p) => p.key === key)?.name ?? key;
}

/** Sidebar entry: inbound referrals from other platforms, with accept / decline. */
export function ReferralsButton({ onAccepted }: { onAccepted: (caseId: string) => void }) {
  const { inbound, loading, error, reload } = useHandovers();
  const platforms = usePlatforms();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const pending = inbound.filter((h) => h.status === "pending");

  const accept = async (h: CaseHandover) => {
    setBusy(h.id); setLocalError(null);
    try {
      const created = await acceptHandover(h, await generateCaseNumber());
      await reload();
      setOpen(false);
      onAccepted(created.id);
    } catch (e) { setLocalError(e instanceof Error ? e.message : "Could not accept referral"); }
    finally { setBusy(null); }
  };
  const decline = async (h: CaseHandover) => {
    setBusy(h.id); setLocalError(null);
    try { await rejectHandover(h.id); await reload(); }
    catch (e) { setLocalError(e instanceof Error ? e.message : "Could not decline referral"); }
    finally { setBusy(null); }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="relative flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-600 transition-colors hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
        title="Incoming referrals"
      >
        <Inbox className="h-4 w-4" />
        {pending.length > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">{pending.length}</span>
        )}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={() => setOpen(false)}>
          <div className="flex h-full w-full max-w-md flex-col bg-white shadow-2xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-700">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">Incoming referrals</h3>
                <p className="text-xs text-slate-400">Cases handed over from other platforms</p>
              </div>
              <button onClick={() => setOpen(false)} className="btn btn-ghost p-1.5"><X className="h-4 w-4" /></button>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
              {(error || localError) && <div className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">{localError ?? error}</div>}
              {loading ? <div className="skeleton h-24 rounded-xl" /> : inbound.length === 0 ? (
                <p className="py-10 text-center text-sm text-slate-400">No referrals yet.</p>
              ) : inbound.map((h) => (
                <div key={h.id} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-slate-800 dark:text-slate-100">{h.client_name}</p>
                      <p className="flex items-center gap-1 text-[11px] text-slate-400">
                        {platformName(platforms, h.source_platform)} <ArrowRight className="h-3 w-3" /> {platformName(platforms, h.target_platform)}
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_STYLE[h.status]}`}>{h.status}</span>
                  </div>
                  {h.reason && <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">{h.reason}</p>}
                  <div className="mt-2 flex gap-4 text-[11px] text-slate-500 dark:text-slate-400">
                    {h.payload.total_debt != null && <span>Debt <b>{formatCurrency(h.payload.total_debt, "GBP", { compact: true })}</b></span>}
                    {h.payload.monthly_disposable_income != null && <span>DI/mo <b>{formatCurrency(h.payload.monthly_disposable_income, "GBP", { compact: true })}</b></span>}
                    {h.payload.creditors && <span>{h.payload.creditors.length} creditors</span>}
                  </div>
                  {h.status === "pending" && (
                    <div className="mt-3 flex gap-2">
                      <button disabled={busy === h.id} onClick={() => accept(h)} className="btn btn-primary flex-1 bg-emerald-600 py-1.5 text-xs hover:bg-emerald-700">
                        {busy === h.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Accept as DMP case
                      </button>
                      <button disabled={busy === h.id} onClick={() => decline(h)} className="btn btn-secondary py-1.5 text-xs"><Ban className="h-3.5 w-3.5" /> Decline</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** Header action: hand the open case on to Drafting or IVA with a data snapshot. */
export function HandOverButton({ caseData, controlled }: { caseData: DebtCase; controlled?: { open: boolean; onClose: () => void } }) {
  const platforms = usePlatforms();
  const { outbound, reload } = useHandovers();
  const [innerOpen, setInnerOpen] = useState(false);
  const open = controlled ? controlled.open : innerOpen;
  const setOpen = (v: boolean) => { if (controlled) { if (!v) controlled.onClose(); } else setInnerOpen(v); };
  const [target, setTarget] = useState<PlatformKey>("draftverge");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const history = outbound.filter((h) => h.source_case_id === caseData.id);
  const alreadyPending = history.some((h) => h.status === "pending" && h.target_platform === target);

  const submit = async () => {
    setBusy(true); setError(null);
    try { await sendHandover(caseData, target, reason.trim()); setReason(""); await reload(); }
    catch (e) { setError(e instanceof Error ? e.message : "Handover failed"); }
    finally { setBusy(false); }
  };

  return (
    <>
      {!controlled && (<button onClick={() => setOpen(true)} className="btn btn-secondary px-2.5 py-1.5 text-xs" title="Hand this case over to another platform">
        <Send className="h-3.5 w-3.5" /> Hand over
      </button>)}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">Hand over {caseData.case_number}</h3>
              <button onClick={() => setOpen(false)} className="btn btn-ghost p-1.5"><X className="h-4 w-4" /></button>
            </div>
            <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">Sends {caseData.debtor_name}'s case, creditors and figures to the receiving platform as a snapshot. This case stays here until you close it.</p>
            <div className="mb-3 grid grid-cols-2 gap-2">
              {OUTBOUND_TARGETS.map((k) => (
                <button key={k} onClick={() => setTarget(k)}
                  className={`rounded-xl border-2 p-3 text-left transition-all ${target === k ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10" : "border-slate-200 dark:border-slate-700"}`}>
                  <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{platformName(platforms, k)}</p>
                  <p className="text-[11px] text-slate-400">{platforms.find((p) => p.key === k)?.stage}</p>
                </button>
              ))}
            </div>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for handover (shown to the receiving team)" rows={3} className="input mb-3 text-sm" />
            {error && <div className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">{error}</div>}
            <button disabled={busy || alreadyPending} onClick={submit} className="btn btn-primary w-full bg-emerald-600 text-sm hover:bg-emerald-700">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {alreadyPending ? "Already pending with this platform" : `Send to ${platformName(platforms, target)}`}
            </button>
            {history.length > 0 && (
              <div className="mt-4 border-t border-slate-200 pt-3 dark:border-slate-700">
                <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">History</p>
                {history.map((h) => (
                  <div key={h.id} className="flex items-center justify-between py-1 text-xs text-slate-600 dark:text-slate-300">
                    <span>{platformName(platforms, h.target_platform)} · {new Date(h.created_at).toLocaleDateString()}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_STYLE[h.status]}`}>{h.status}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
