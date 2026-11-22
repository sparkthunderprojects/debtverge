import { useState } from "react";
import { useFeeRules, saveFeeRule, ruleSummary, type FeeRule } from "../../lib/fee-hooks";

/** Firm-level fee rules (managers). Fees are worked out from these on each case; nothing is taken until a manager approves it. */
export function FeeRulesPanel() {
  const { rules, reload } = useFeeRules();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<FeeRule["kind"]>("percent_of_receipt");
  const [value, setValue] = useState("");
  const [max, setMax] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const v = Number(value);
      await saveFeeRule({ name: name.trim(), kind, percent: kind === "percent_of_receipt" ? v : null, monthly: kind === "fixed_monthly" ? v : null, max: max.trim() ? Number(max) : null, active: true });
      setName(""); setValue(""); setMax(""); await reload();
    } catch (e2) { setErr((e2 as Error).message); } finally { setBusy(false); }
  }
  async function toggle(r: FeeRule) {
    setBusy(true); setErr(null);
    try { await saveFeeRule({ id: r.id, name: r.name, kind: r.kind, percent: r.percent, monthly: r.monthly_amount, max: r.max_per_month, active: !r.active }); await reload(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <details className="panel p-4">
      <summary className="cursor-pointer text-sm font-bold text-slate-800 dark:text-slate-100">Fee rules <span className="font-normal text-slate-400">({rules.filter((r) => r.active).length} active)</span></summary>
      <div className="mt-3 space-y-2">
        {rules.map((r) => (
          <div key={r.id} className="flex items-center justify-between text-xs">
            <span className={r.active ? "text-slate-700 dark:text-slate-200" : "text-slate-400 line-through"}><b>{r.name}</b>: {ruleSummary(r)}</span>
            <button disabled={busy} onClick={() => toggle(r)} className="text-slate-500 hover:text-slate-800">{r.active ? "Switch off" : "Switch on"}</button>
          </div>
        ))}
        <form onSubmit={add} className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-2 dark:border-slate-700">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Rule name" className="input w-44 text-xs" required />
          <select value={kind} onChange={(e) => setKind(e.target.value as FeeRule["kind"])} className="input w-auto text-xs"><option value="percent_of_receipt">% of each payment</option><option value="fixed_monthly">Fixed monthly £</option></select>
          <input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" placeholder={kind === "percent_of_receipt" ? "%" : "£"} className="input w-20 text-xs" required />
          <input value={max} onChange={(e) => setMax(e.target.value)} inputMode="decimal" placeholder="Max £/month" className="input w-28 text-xs" />
          <button disabled={busy} className="btn btn-primary bg-emerald-600 text-xs hover:bg-emerald-700">Add rule</button>
        </form>
        {err && <p className="text-xs text-rose-600">{err}</p>}
      </div>
    </details>
  );
}
