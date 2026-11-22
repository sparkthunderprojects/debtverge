import { useState } from "react";
import { Banknote, CheckCircle2, Loader2 } from "lucide-react";
import { useAuth } from "../../lib/auth";
import { formatCurrency } from "../../lib/format";
import { FeesPanel } from "./FeesPanel";
import { useDistributions, createDistributionRun, approveDistributionRun, cancelDistributionRun, markDistributionPaid, type DistributionRun } from "../../lib/distribution-hooks";

const gbp = (n: number) => formatCurrency(n, "GBP");
const STATUS_LABEL: Record<DistributionRun["status"], string> = {
  draft: "Waiting for approval", approved: "Approved, ready to pay", generated: "File generated", submitted: "Submitted", settled: "Paid", failed: "Cancelled",
};
const STATUS_STYLE: Record<DistributionRun["status"], string> = {
  draft: "bg-amber-50 text-amber-700", approved: "bg-sky-50 text-sky-700", generated: "bg-sky-50 text-sky-700", submitted: "bg-sky-50 text-sky-700", settled: "bg-emerald-50 text-emerald-700", failed: "bg-slate-100 text-slate-500",
};

export function DistributionPanel({ caseId }: { caseId: string }) {
  const { user, dvRole } = useAuth();
  const { runs, funds, loading, reload } = useDistributions(caseId);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const isManager = dvRole === "admin" || dvRole === "team_manager" || dvRole === "operations_manager";
  const hasOpen = runs.some((r) => r.status === "draft" || r.status === "approved");

  async function run(fn: () => Promise<void>) {
    setBusy(true); setErr(null);
    try { await fn(); await reload(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  if (loading) return <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-emerald-600" /></div>;

  return (
    <div className="space-y-4">
    <FeesPanel caseId={caseId} onChanged={reload} />
    <div className="panel space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Banknote className="h-4 w-4 text-emerald-600" />
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Pay creditors</h3>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500">Available to creditors: <b className="text-slate-800 dark:text-slate-100">{funds === null ? "n/a" : gbp(funds)}</b></span>
          <button disabled={busy || hasOpen || !funds || funds < 0.01} onClick={() => run(() => createDistributionRun(caseId))} className="btn btn-primary bg-emerald-600 hover:bg-emerald-700">Prepare payout</button>
        </div>
      </div>
      {err && <p className="text-xs text-rose-600">{err}</p>}
      {runs.length === 0 && <p className="text-sm text-slate-400">No payouts yet. Funds are shared between creditors in proportion to what each is owed.</p>}
      {runs.map((r) => {
        const mine = r.created_by === user?.id;
        return (
          <div key={r.id} className="rounded-lg border border-slate-100 p-3 dark:border-slate-700">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-bold text-slate-700 dark:text-slate-200">{r.file_reference}</span>
              <span className="text-slate-400">{new Date(r.created_at).toLocaleDateString("en-GB")}</span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${STATUS_STYLE[r.status]}`}>{STATUS_LABEL[r.status]}</span>
              <span className="ml-auto text-sm font-bold text-slate-800 dark:text-slate-100">{gbp(r.total_amount)}</span>
            </div>
            <table className="mt-2 w-full text-xs">
              <tbody>
                {r.items.map((i) => (
                  <tr key={i.id} className="border-t border-slate-50 dark:border-slate-700/50">
                    <td className="py-1 text-slate-600 dark:text-slate-300">{i.payee_name}</td>
                    <td className="py-1 text-slate-400">{i.payee_reference}</td>
                    <td className="py-1 text-right font-semibold">{gbp(i.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(r.status === "draft" || r.status === "approved") && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {r.status === "draft" && isManager && !mine && <button disabled={busy} onClick={() => run(() => approveDistributionRun(r.id))} className="btn btn-primary bg-emerald-600 hover:bg-emerald-700"><CheckCircle2 className="h-4 w-4" /> Approve</button>}
                {r.status === "draft" && isManager && mine && <span className="text-[11px] text-amber-600">You prepared this, so another manager must approve it.</span>}
                {r.status === "draft" && !isManager && <span className="text-[11px] text-slate-400">A manager needs to approve this.</span>}
                {r.status === "approved" && isManager && <button disabled={busy} onClick={() => run(() => markDistributionPaid(r.id))} className="btn btn-primary bg-emerald-600 hover:bg-emerald-700">Mark as paid</button>}
                <button disabled={busy} onClick={() => run(() => cancelDistributionRun(r.id))} className="btn text-xs text-slate-500">Cancel</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
    </div>
  );
}
