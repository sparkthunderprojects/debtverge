import { useState } from "react";
import { formatCurrency } from "@/core/format";
import { useAuth } from "@/core/auth";
import { useCaseFees, postFees, decideFee } from "../../lib/fee-hooks";

const gbp = (n: number) => formatCurrency(n, "GBP");

/** Fees on one case: work out what is due from the firm's rules, then a manager takes or waives each one. */
export function FeesPanel({ caseId, onChanged }: { caseId: string; onChanged?: () => void }) {
  const { dvRole } = useAuth();
  const isManager = dvRole !== "advisor";
  const { charges, reload } = useCaseFees(caseId);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function run(fn: () => Promise<void>) {
    setBusy(true); setMsg(null);
    try { await fn(); await reload(); onChanged?.(); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  }
  const due = charges.filter((c) => c.status === "due").reduce((s, c) => s + c.amount, 0);
  const taken = charges.filter((c) => c.status === "taken").reduce((s, c) => s + c.amount, 0);
  return (
    <div className="panel space-y-2 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Fees</h3>
        <div className="flex items-center gap-3 text-xs text-slate-500">
          <span>Due: <b className="text-slate-800 dark:text-slate-100">{gbp(due)}</b></span><span>Taken: <b className="text-slate-800 dark:text-slate-100">{gbp(taken)}</b></span>
          <button disabled={busy} onClick={() => run(async () => { const n = await postFees(caseId); setMsg(n ? `${n} new fee${n > 1 ? "s" : ""} worked out.` : "No new fees to charge."); })} className="btn text-xs">Work out fees</button>
        </div>
      </div>
      {charges.length === 0 ? <p className="text-sm text-slate-400">No fees charged on this case.</p> : (
        <table className="w-full text-xs"><tbody>
          {charges.map((c) => (
            <tr key={c.id} className="border-t border-slate-50 dark:border-slate-700/50">
              <td className="py-1 text-slate-500">{new Date(c.charged_on + "T00:00:00").toLocaleDateString("en-GB")}</td>
              <td className="font-semibold">{gbp(c.amount)}</td>
              <td className="capitalize text-slate-500">{c.status}</td>
              <td className="text-right">
                {c.status === "due" && isManager && <><button disabled={busy} onClick={() => run(async () => { await decideFee(c.id, true); })} className="mr-2 font-semibold text-emerald-700 hover:underline">Take</button><button disabled={busy} onClick={() => run(async () => { await decideFee(c.id, false); })} className="text-slate-500 hover:text-slate-800">Waive</button></>}
              </td>
            </tr>
          ))}
        </tbody></table>
      )}
      {msg && <p className="text-xs text-slate-500">{msg}</p>}
    </div>
  );
}
