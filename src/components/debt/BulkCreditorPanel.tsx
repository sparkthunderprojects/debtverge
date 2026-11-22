import { useRef, useState } from "react";
import { CheckCircle2, FileUp, Loader2 } from "lucide-react";
import { csvToRows, previewBulk, applyBulk, STATUS_TEXT, type BulkRow, type PreviewRow } from "../../lib/bulk-creditor-hooks";

const n = (v: number | null) => (v === null || v === undefined ? "–" : String(v));
const change = (o: number | null, v: number | null) => (v === null ? "" : `${n(o)} → ${n(v)}`);

/** Manager tool: update creditor balances, offers and rates across cases from a CSV, with a preview before anything changes. */
export function BulkCreditorPanel() {
  const input = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<BulkRow[]>([]);
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const willUpdate = preview?.filter((p) => p.status === "will_update").length ?? 0;

  function reset() { setRows([]); setPreview(null); setErr(null); if (input.current) input.current.value = ""; }

  async function onFile(f: File | undefined) {
    setDone(null); setErr(null); setPreview(null);
    if (!f) return;
    if (f.size > 2_000_000) { setErr("File is too large (2 MB maximum)."); return; }
    const parsed = csvToRows(await f.text());
    if (parsed.error) { setErr(parsed.error); setRows([]); return; }
    setBusy(true);
    try { setRows(parsed.rows); setPreview(await previewBulk(parsed.rows)); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  async function apply() {
    setBusy(true); setErr(null);
    try { const r = await applyBulk(rows); setDone(`${r.updated} creditor${r.updated === 1 ? "" : "s"} updated, ${r.skipped} skipped.`); reset(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="panel p-4">
      <h3 className="mb-1 flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-100"><FileUp className="h-4 w-4" /> Creditor bulk update</h3>
      <p className="mb-3 text-xs text-slate-500">Upload a CSV with columns <b>case_number</b>, <b>account_reference</b> (or creditor name), and any of <b>balance</b>, <b>offer</b>, <b>rate</b>. You see a preview first; nothing changes until you apply. Every change is audited.</p>
      <div className="flex flex-wrap items-center gap-2">
        <input ref={input} type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} className="text-xs" />
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        {preview && willUpdate > 0 && (
          <button onClick={apply} disabled={busy} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">Apply {willUpdate} update{willUpdate === 1 ? "" : "s"}</button>
        )}
        {preview && <button onClick={reset} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600">Cancel</button>}
      </div>
      {err && <p className="mt-2 text-xs text-rose-600">{err}</p>}
      {done && <p className="mt-2 flex items-center gap-1 text-xs text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5" /> {done}</p>}
      {preview && (
        <div className="mt-3 max-h-80 overflow-auto rounded-lg border border-slate-200 dark:border-slate-700">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800"><tr>
              {["Row", "Case", "Creditor", "Balance", "Offer", "Rate %", "Result"].map((h) => <th key={h} className="px-2 py-1.5 font-semibold text-slate-600 dark:text-slate-300">{h}</th>)}
            </tr></thead>
            <tbody>{preview.map((p) => (
              <tr key={p.idx} className="border-t border-slate-100 dark:border-slate-800">
                <td className="px-2 py-1.5">{p.idx + 1}</td><td className="px-2 py-1.5">{p.case_number}</td><td className="px-2 py-1.5">{p.creditor_name ?? p.match_key}</td>
                <td className="px-2 py-1.5">{change(p.old_balance, p.new_balance)}</td><td className="px-2 py-1.5">{change(p.old_offer, p.new_offer)}</td><td className="px-2 py-1.5">{change(p.old_rate, p.new_rate)}</td>
                <td className={`px-2 py-1.5 font-medium ${p.status === "will_update" ? "text-emerald-600" : p.status === "unchanged" ? "text-slate-400" : "text-rose-600"}`}>{STATUS_TEXT[p.status]}</td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
