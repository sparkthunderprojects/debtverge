import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Download, Loader2, Search, Users } from "lucide-react";
import { useAuth } from "@/core/auth";
import { formatCurrency } from "@/core/format";
import { downloadCsv } from "@/apps/debtverge/lib/report-hooks";
import { useTeam, memberLabel } from "@/apps/debtverge/lib/team-hooks";
import { fetchBook, STATUS_LABEL, PLAN_LABEL, FLAG_LABEL, type BookRow, type BookSort, type BookFlag, type BookQuery } from "@/apps/debtverge/lib/book-hooks";

const PAGE = 25;
const d = (s: string | null) => (s ? new Date(s.length > 10 ? s : s + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "-");
const ago = (s: string | null) => {
  if (!s) return "Never";
  const days = Math.floor((Date.now() - new Date(s).getTime()) / 86400000);
  return days <= 0 ? "Today" : days === 1 ? "Yesterday" : `${days} days ago`;
};

/** Every client on the firm's books. Filter, sort, page, open a case, and (managers) download the lot. */
export function ClientBookScreen({ onOpenCase }: { onOpenCase: (id: string) => void }) {
  const { dvRole } = useAuth();
  const isManager = dvRole !== "advisor";
  const { members } = useTeam();
  const [f, setF] = useState<BookQuery>({ q: "", status: "", plan: "", adviser: "", flag: "", sort: "name", dir: "asc", limit: PAGE, offset: 0 });
  const [rows, setRows] = useState<BookRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const set = (p: Partial<BookQuery>) => setF((cur) => ({ ...cur, offset: 0, ...p }));

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try { const r = await fetchBook(f); setRows(r); setTotal(r[0]?.total_count ?? 0); } catch (e) { setErr((e as Error).message); setRows([]); setTotal(0); } finally { setLoading(false); }
  }, [f]);
  useEffect(() => { const t = setTimeout(load, f.q ? 250 : 0); return () => clearTimeout(t); }, [load, f.q]);

  const sortBy = (s: BookSort) => set({ sort: s, dir: f.sort === s && f.dir === "asc" ? "desc" : "asc" });
  const Th = ({ s, children, right }: { s: BookSort; children: React.ReactNode; right?: boolean }) => (
    <th className={`px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-500 ${right ? "text-right" : "text-left"}`}>
      <button onClick={() => sortBy(s)} className="inline-flex items-center gap-1 hover:text-slate-800 dark:hover:text-slate-200">{children}{f.sort === s && (f.dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}</button>
    </th>
  );

  async function exportAll() {
    setExporting(true); setErr(null);
    try {
      const all: BookRow[] = [];
      for (let off = 0; off < 5000; off += 500) { const r = await fetchBook({ ...f, limit: 500, offset: off }); all.push(...r); if (r.length < 500) break; }
      downloadCsv(all.map((r) => ({
        "Case number": r.case_number, Client: r.debtor_name, Status: STATUS_LABEL[r.status] ?? r.status, Plan: PLAN_LABEL[r.plan_type] ?? r.plan_type, Adviser: r.adviser_name ?? "", "Total debt": r.total_debt ?? "",
        Creditors: r.creditor_count, "Monthly payment": r.installment_amount ?? "", Frequency: r.payment_frequency ?? "", "Next payment due": r.next_due_date ?? "", "Days in arrears": r.arrears_days,
        "Open complaints": r.open_complaints, "Last contact": r.last_contact ? r.last_contact.slice(0, 10) : "", Opened: r.created_at.slice(0, 10),
      })), `client-book-${new Date().toISOString().slice(0, 10)}.csv`);
    } catch (e) { setErr((e as Error).message); } finally { setExporting(false); }
  }

  const pages = Math.max(1, Math.ceil(total / PAGE)); const page = Math.floor(f.offset / PAGE) + 1;
  const sel = "input w-auto text-xs";
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Users className="h-5 w-5 text-emerald-600" />
        <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">Clients</h2>
        <span className="text-sm text-slate-400">{loading ? "" : `${total} on the books`}</span>
        {isManager && <button onClick={exportAll} disabled={exporting || total === 0} className="btn ml-auto text-xs"><Download className="h-3.5 w-3.5" />{exporting ? "Preparing…" : "Download CSV"}</button>}
      </div>
      <div className="panel flex flex-wrap items-center gap-2 p-3">
        <div className="relative"><Search className="absolute left-2 top-2 h-3.5 w-3.5 text-slate-400" /><input value={f.q} onChange={(e) => set({ q: e.target.value })} placeholder="Name or case number" className="input w-52 pl-7 text-xs" /></div>
        <select value={f.status} onChange={(e) => set({ status: e.target.value })} className={sel}><option value="">All statuses</option>{Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select value={f.plan} onChange={(e) => set({ plan: e.target.value })} className={sel}><option value="">All plans</option>{Object.entries(PLAN_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select value={f.adviser} onChange={(e) => set({ adviser: e.target.value })} className={sel}><option value="">All advisers</option>{members.map((m) => <option key={m.user_id} value={m.user_id}>{memberLabel(m)}</option>)}</select>
        <select value={f.flag} onChange={(e) => set({ flag: e.target.value as BookFlag })} className={sel}><option value="">Any situation</option>{Object.entries(FLAG_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        {(f.q || f.status || f.plan || f.adviser || f.flag) && <button onClick={() => set({ q: "", status: "", plan: "", adviser: "", flag: "" })} className="text-xs font-semibold text-emerald-700 hover:underline">Clear filters</button>}
      </div>
      {err && <p className="text-sm text-rose-600">{err}</p>}
      <div className="panel overflow-x-auto p-0">
        <table className="w-full min-w-[56rem] text-sm">
          <thead className="border-b border-slate-100 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/60"><tr>
            <Th s="name">Client</Th><Th s="status">Status</Th><Th s="adviser">Adviser</Th><Th s="debt" right>Total debt</Th><Th s="next_due">Next payment</Th><Th s="arrears">Arrears</Th><Th s="last_contact">Last contact</Th>
          </tr></thead>
          <tbody>
            {loading && <tr><td colSpan={7} className="py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-emerald-600" /></td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={7} className="py-10 text-center text-sm text-slate-400">No clients match these filters.</td></tr>}
            {!loading && rows.map((r) => (
              <tr key={r.case_id} onClick={() => onOpenCase(r.case_id)} className="cursor-pointer border-b border-slate-50 hover:bg-emerald-50/50 dark:border-slate-800 dark:hover:bg-emerald-500/5">
                <td className="px-3 py-2"><p className="font-semibold text-slate-800 dark:text-slate-100">{r.debtor_name}</p><p className="text-[11px] text-slate-400">{r.case_number} · {PLAN_LABEL[r.plan_type] ?? r.plan_type} · {r.creditor_count} creditor{r.creditor_count === 1 ? "" : "s"}</p></td>
                <td className="px-3 py-2"><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300">{STATUS_LABEL[r.status] ?? r.status}</span>
                  {r.open_complaints > 0 && <span className="ml-1 inline-flex items-center gap-0.5 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700"><AlertTriangle className="h-3 w-3" />Complaint</span>}</td>
                <td className="px-3 py-2 text-slate-600 dark:text-slate-300">{r.adviser_name ?? <span className="text-slate-400">Unassigned</span>}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-700 dark:text-slate-200">{r.total_debt === null ? "-" : formatCurrency(r.total_debt, "GBP")}</td>
                <td className="px-3 py-2 text-slate-600 dark:text-slate-300">{r.next_due_date ? <>{d(r.next_due_date)}{r.installment_amount ? <span className="block text-[11px] text-slate-400">{formatCurrency(r.installment_amount, "GBP")}</span> : null}</> : <span className="text-slate-400">None set</span>}</td>
                <td className="px-3 py-2">{r.arrears_days > 0 ? <span className="font-semibold text-rose-600">{r.arrears_days}d overdue</span> : <span className="text-slate-400">Up to date</span>}</td>
                <td className="px-3 py-2 text-slate-500">{ago(r.last_contact)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {total > PAGE && (
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>Showing {f.offset + 1}-{Math.min(f.offset + PAGE, total)} of {total}</span>
          <div className="flex items-center gap-2">
            <button disabled={page <= 1} onClick={() => setF({ ...f, offset: f.offset - PAGE })} className="btn text-xs"><ChevronLeft className="h-3.5 w-3.5" />Previous</button>
            <span>Page {page} of {pages}</span>
            <button disabled={page >= pages} onClick={() => setF({ ...f, offset: f.offset + PAGE })} className="btn text-xs">Next<ChevronRight className="h-3.5 w-3.5" /></button>
          </div>
        </div>
      )}
    </div>
  );
}
