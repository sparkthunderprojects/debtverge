import { useMemo, useState } from "react";
import { BarChart3, Download, Loader2 } from "lucide-react";
import { REPORTS, runReport, downloadCsv, type ReportKind, type ReportRow } from "../../lib/report-hooks";
import { memberLabel, useTeam } from "../../lib/team-hooks";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const label = (k: string) => k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

/** Manager report builder: fixed catalogue of reports run by a firm-scoped, audited database function. */
export function ReportsPanel() {
  const { members } = useTeam();
  const names = useMemo(() => Object.fromEntries(members.map((m) => [m.user_id, memberLabel(m)])), [members]);
  const [kind, setKind] = useState<ReportKind>("cases_by_status");
  const [from, setFrom] = useState(iso(new Date(Date.now() - 90 * 86400000)));
  const [to, setTo] = useState(iso(new Date()));
  const [rows, setRows] = useState<ReportRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const def = REPORTS.find((r) => r.kind === kind)!;

  const shown = (rows ?? []).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, (k === "advisor" || k === "assigned_to") && typeof v === "string" ? names[v] ?? v : v])));

  async function run() {
    setBusy(true); setErr(null);
    try { setRows(await runReport(kind, def.dated ? from : undefined, def.dated ? to : undefined)); }
    catch (e) { setErr((e as Error).message); setRows(null); }
    finally { setBusy(false); }
  }

  return (
    <div className="panel p-4">
      <h3 className="mb-1 flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-100"><BarChart3 className="h-4 w-4" /> Reports</h3>
      <p className="mb-3 text-xs text-slate-500">{def.help} Only cases you can see are included. Each run is recorded in the audit trail.</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-slate-500">Report
          <select value={kind} onChange={(e) => { setKind(e.target.value as ReportKind); setRows(null); }} className="mt-1 block rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800">
            {REPORTS.map((r) => <option key={r.kind} value={r.kind}>{r.label}</option>)}
          </select>
        </label>
        {def.dated && (<>
          <label className="text-xs text-slate-500">From<input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="mt-1 block rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800" /></label>
          <label className="text-xs text-slate-500">To<input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="mt-1 block rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800" /></label>
        </>)}
        <button onClick={run} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900">
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Run
        </button>
        {rows && rows.length > 0 && (
          <button onClick={() => downloadCsv(shown, `${kind}-${iso(new Date())}.csv`)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold dark:border-slate-600">
            <Download className="h-3.5 w-3.5" /> CSV
          </button>
        )}
      </div>
      {err && <p className="mt-2 text-xs text-rose-600">{err}</p>}
      {rows && !rows.length && <p className="mt-3 text-sm text-slate-500">Nothing to report for this selection.</p>}
      {rows && rows.length > 0 && (
        <div className="mt-3 max-h-80 overflow-auto rounded-lg border border-slate-200 dark:border-slate-700">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800"><tr>{Object.keys(shown[0]).map((c) => <th key={c} className="px-2 py-1.5 font-semibold text-slate-600 dark:text-slate-300">{label(c)}</th>)}</tr></thead>
            <tbody>{shown.slice(0, 500).map((r, i) => (
              <tr key={i} className="border-t border-slate-100 dark:border-slate-800">{Object.values(r).map((v, j) => <td key={j} className="px-2 py-1.5">{v === null ? "" : String(v)}</td>)}</tr>
            ))}</tbody>
          </table>
          {shown.length > 500 && <p className="p-2 text-xs text-slate-500">Showing 500 of {shown.length} rows. Download the CSV for all of them.</p>}
        </div>
      )}
    </div>
  );
}
