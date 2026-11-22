import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, Download, Loader2, Search, ShieldAlert } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  COACHING_TYPES, OUTCOME_LABEL, PRIORITY_LABEL, REVIEW_OUTCOME_LABEL, REVIEW_STATUS_LABEL, RISK_TYPES, assignReview, assignCoaching, cancelCoaching, csvOf, downloadText, fetchAdviserQa, fetchAudit,
  fetchCoachingList, fetchDashboard, fetchPeople, fetchQueue, fetchReport, fetchRisks, fetchTelephony, fetchUnreviewed, fmtDate, fmtDuration, fmtWhen, resolveRisk, reviewCoaching, saveTelephony, searchCalls,
  CHECKLIST, fetchScript, saveScript, type CallScript, type ScriptPoint, type AdviserQa, type AuditRow, type CoachingRow, type Dashboard, type Person, type QueueRow, type Report, type RiskListRow, type SearchFilters, type SearchRow, type TelephonySettings, type UnreviewedRow,
} from "@/apps/debtverge/lib/call-hooks";

const Busy = () => <Loader2 className="h-5 w-5 animate-spin text-slate-400" />;
const Err = ({ m }: { m: string }) => <p className="text-sm text-rose-600">{m}</p>;
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const OUT_COLOUR: Record<string, string> = { compliant: "#10b981", minor_issues: "#f59e0b", major_issues: "#f97316", non_compliant: "#e11d48" };

function useLoad<T>(f: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null); const [err, setErr] = useState<string | null>(null);
  const reload = useCallback(() => { setErr(null); f().then(setData).catch((e) => setErr((e as Error).message)); }, deps);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setData(null); reload(); }, [reload]);
  return { data, err, reload };
}
function Kpi({ label, value, tone, onClick }: { label: string; value: ReactNode; tone?: "bad" | "good"; onClick?: () => void }) {
  const bad = tone === "bad" && Number(value) > 0;
  return <button onClick={onClick} disabled={!onClick} className="panel p-3 text-left disabled:cursor-default"><p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</p><p className={`mt-1 text-xl font-bold tabular-nums ${bad ? "text-rose-600" : tone === "good" ? "text-emerald-600" : ""}`}>{value}</p></button>;
}
const Badge = ({ s }: { s: string | null }) => <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold dark:bg-slate-700">{s ? REVIEW_STATUS_LABEL[s] ?? s : "Not reviewed"}</span>;

/* ---------------- Dashboard ---------------- */
export function DashboardSection({ open, goto }: { open: (callId: string) => void; goto: (t: string) => void }) {
  const [days, setDays] = useState(30);
  const { data: d, err } = useLoad<Dashboard>(() => fetchDashboard(days), [days]);
  const un = useLoad<UnreviewedRow[]>(() => fetchUnreviewed(8), []);
  if (err) return <Err m={err} />; if (!d) return <Busy />;
  const chart = Object.entries(d.outcomes).map(([k, v]) => ({ name: REVIEW_OUTCOME_LABEL[k] ?? k, key: k, value: v }));
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2"><label className="label !mb-0">Period</label><select className="input !w-auto !py-1" value={days} onChange={(e) => setDays(Number(e.target.value))}>{[7, 30, 90, 365].map((n) => <option key={n} value={n}>Last {n} days</option>)}</select></div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        <Kpi label="Calls" value={d.calls} /><Kpi label="Recorded" value={d.recorded} /><Kpi label="Reviewed" value={d.reviewed} /><Kpi label="Average score" value={d.avg_score != null ? `${d.avg_score}%` : "–"} tone={d.avg_score != null && d.avg_score >= 85 ? "good" : undefined} />
        <Kpi label="Awaiting a reviewer" value={d.awaiting_reviewer} onClick={() => goto("workflows")} /><Kpi label="In progress" value={d.in_progress} onClick={() => goto("workflows")} />
        <Kpi label="Awaiting approval" value={d.pending_approval} onClick={() => goto("workflows")} /><Kpi label="Overdue reviews" value={d.overdue} tone="bad" onClick={() => goto("workflows")} /><Kpi label="Escalated" value={d.escalated} tone="bad" onClick={() => goto("workflows")} />
        <Kpi label="Flagged, not reviewed" value={d.flagged_unreviewed} tone="bad" /><Kpi label="No recording notice" value={d.no_notice} tone="bad" /><Kpi label="Recording gaps" value={d.recording_gaps} tone="bad" />
        <Kpi label="Open risks" value={d.open_risks} tone="bad" onClick={() => goto("risks")} /><Kpi label="Coaching open" value={d.coaching_open} onClick={() => goto("coaching")} /><Kpi label="Coaching overdue" value={d.coaching_overdue} tone="bad" onClick={() => goto("coaching")} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="panel p-4"><p className="mb-2 text-sm font-bold">Review outcomes</p>
          {chart.length === 0 ? <p className="text-sm text-slate-500">No approved reviews in this period.</p> : (
            <div className="h-48"><ResponsiveContainer><BarChart data={chart}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="name" tick={{ fontSize: 11 }} /><YAxis allowDecimals={false} tick={{ fontSize: 11 }} /><Tooltip /><Bar dataKey="value" radius={[4, 4, 0, 0]}>{chart.map((c) => <Cell key={c.key} fill={OUT_COLOUR[c.key] ?? "#64748b"} />)}</Bar></BarChart></ResponsiveContainer></div>)}</div>
        <div className="panel p-4"><p className="mb-2 text-sm font-bold">Needs attention</p>
          {d.attention.length === 0 ? <p className="text-sm text-slate-500">Nothing needs attention.</p> : <ul className="divide-y divide-slate-100 dark:divide-slate-700">{d.attention.map((a, i) => <li key={i}><button onClick={() => open(a.call_id)} className="flex w-full items-center gap-2 py-2 text-left text-sm hover:underline"><AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" /><span className="flex-1">{a.label}</span><span className="text-xs text-slate-400">{fmtWhen(a.at)}</span></button></li>)}</ul>}</div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="panel p-4"><p className="mb-2 text-sm font-bold">Latest calls</p><ul className="divide-y divide-slate-100 dark:divide-slate-700">{d.recent.map((r) => <li key={r.call_id}><button onClick={() => open(r.call_id)} className="flex w-full items-center gap-2 py-2 text-left text-sm hover:underline"><span className="flex-1">{r.adviser ?? "Unknown"} · {OUTCOME_LABEL[r.outcome] ?? r.outcome}<span className="text-xs text-slate-400"> · {fmtWhen(r.started_at)}</span></span><Badge s={r.review_status} /></button></li>)}</ul></div>
        <div className="panel p-4"><p className="mb-2 text-sm font-bold">Calls that suggest a review</p>
          {!un.data ? <Busy /> : un.data.length === 0 ? <p className="text-sm text-slate-500">Nothing is waiting.</p> : <ul className="divide-y divide-slate-100 dark:divide-slate-700">{un.data.map((u) => <li key={u.call_id}><button onClick={() => open(u.call_id)} className="flex w-full items-center gap-2 py-2 text-left text-sm hover:underline"><span className="flex-1">{u.adviser_name ?? "Unknown"}<span className="text-xs text-slate-400"> · {fmtWhen(u.started_at)} · {fmtDuration(u.duration_seconds)}</span></span><span className="text-[11px] text-amber-700">{u.reasons.join(", ").replace(/_/g, " ")}</span></button></li>)}</ul>}</div>
      </div>
    </div>
  );
}

/* ---------------- Call search ---------------- */
export function SearchSection({ open }: { open: (callId: string) => void }) {
  const [f, setF] = useState<SearchFilters>({ from: daysAgo(30), to: today() });
  const [rows, setRows] = useState<SearchRow[] | null>(null); const [total, setTotal] = useState(0); const [page, setPage] = useState(0);
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [people, setPeople] = useState<Person[]>([]);
  const PAGE = 25;
  const run = useCallback(async (p: number) => { setBusy(true); setErr(null); try { const r = await searchCalls(f, PAGE, p * PAGE); setRows(r.rows); setTotal(r.total); setPage(p); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } }, [f]);
  useEffect(() => { void run(0); fetchPeople().then(setPeople).catch(() => undefined); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: keyof SearchFilters, v: string | boolean) => setF({ ...f, [k]: v === "" ? undefined : v });
  const exportCsv = async () => { const r = await searchCalls(f, 100, 0); downloadText("call-search.csv", csvOf(["When", "Adviser", "Direction", "Phone", "Seconds", "Outcome", "Review", "Score", "Summary"], r.rows.map((x) => [x.started_at, x.adviser, x.direction, x.phone, x.duration_seconds, x.outcome, x.review_status ?? "none", x.score, x.summary]))); };
  return (
    <div className="space-y-3">
      <div className="panel grid gap-3 p-4 sm:grid-cols-4">
        <div><label className="label">From</label><input type="date" className="input" value={f.from ?? ""} onChange={(e) => set("from", e.target.value)} /></div>
        <div><label className="label">To</label><input type="date" className="input" value={f.to ?? ""} onChange={(e) => set("to", e.target.value)} /></div>
        <div><label className="label">Adviser</label><select className="input" value={f.adviser ?? ""} onChange={(e) => set("adviser", e.target.value)}><option value="">Anyone</option>{people.map((p) => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}</select></div>
        <div><label className="label">Direction</label><select className="input" value={f.direction ?? ""} onChange={(e) => set("direction", e.target.value)}><option value="">Both</option><option value="inbound">Incoming</option><option value="outbound">Outgoing</option></select></div>
        <div><label className="label">Outcome</label><select className="input" value={f.outcome ?? ""} onChange={(e) => set("outcome", e.target.value)}><option value="">Any</option>{Object.entries(OUTCOME_LABEL).filter(([k]) => k !== "pending").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div><label className="label">Review</label><select className="input" value={f.review_status ?? ""} onChange={(e) => set("review_status", e.target.value)}><option value="">Any</option>{Object.entries(REVIEW_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div><label className="label">Phone number</label><input className="input" value={f.phone ?? ""} onChange={(e) => set("phone", e.target.value)} placeholder="Last digits" /></div>
        <div><label className="label">Words in the summary</label><input className="input" value={f.q ?? ""} onChange={(e) => set("q", e.target.value)} /></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!f.flagged} onChange={(e) => set("flagged", e.target.checked)} /> Vulnerability or complaint</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!f.no_notice} onChange={(e) => set("no_notice", e.target.checked)} /> No recording notice</label>
        <div className="flex gap-2 sm:col-span-2 sm:justify-end"><button onClick={() => run(0)} disabled={busy} className="btn btn-primary"><Search className="h-4 w-4" /> Search</button><button onClick={exportCsv} className="btn btn-secondary"><Download className="h-4 w-4" /> CSV</button></div>
      </div>
      {err && <Err m={err} />}{!rows && !err && <Busy />}
      {rows && (
        <div className="panel overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-400 dark:border-slate-700"><th className="p-2">When</th><th>Adviser</th><th>Call</th><th>Outcome</th><th>Flags</th><th>Review</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.call_id} onClick={() => open(r.call_id)} className="cursor-pointer border-b border-slate-100 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-700/40">
            <td className="p-2 whitespace-nowrap">{fmtWhen(r.started_at)}</td><td>{r.adviser ?? "–"}</td><td>{r.direction === "inbound" ? "In" : "Out"} · {fmtDuration(r.duration_seconds)}{r.has_recording ? " · ●" : ""}<p className="max-w-xs truncate text-xs text-slate-500">{r.summary}</p></td><td>{OUTCOME_LABEL[r.outcome] ?? r.outcome}</td>
            <td>{r.vulnerability_flag && <ShieldAlert className="inline h-4 w-4 text-amber-600" />}{r.possible_complaint && <AlertTriangle className="inline h-4 w-4 text-rose-600" />}{r.recording_notice_given === false && <span className="ml-1 text-[11px] text-rose-600">no notice</span>}</td>
            <td><Badge s={r.review_status} />{r.score != null && <span className="ml-1 text-xs">{r.score}%</span>}</td></tr>)}</tbody></table>
          {rows.length === 0 && <p className="p-4 text-sm text-slate-500">No calls match.</p>}
          <div className="flex items-center justify-between p-2 text-xs text-slate-500"><span>{total} calls</span><span className="flex gap-2"><button disabled={page === 0 || busy} className="btn btn-secondary px-2 py-1 text-xs" onClick={() => run(page - 1)}>Previous</button><button disabled={(page + 1) * PAGE >= total || busy} className="btn btn-secondary px-2 py-1 text-xs" onClick={() => run(page + 1)}>Next</button></span></div></div>
      )}
    </div>
  );
}

/* ---------------- Adviser QA ---------------- */
export function QaSection({ openCoach }: { openCoach: (adviserId: string) => void }) {
  const [days, setDays] = useState(30);
  const { data: d, err } = useLoad<AdviserQa>(() => fetchAdviserQa(days), [days]);
  if (err) return <Err m={err} />; if (!d) return <Busy />;
  const sc = useLoad<CallScript>(fetchScript, []);
  const label = (k: string) => sc.data?.labels[k] ?? CHECKLIST.find((c) => c.key === k)?.label ?? k.replace(/_/g, " ");
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2"><label className="label !mb-0">Period</label><select className="input !w-auto !py-1" value={days} onChange={(e) => setDays(Number(e.target.value))}>{[30, 90, 180, 365].map((n) => <option key={n} value={n}>Last {n} days</option>)}</select></div>
      <div className="panel overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-400 dark:border-slate-700"><th className="p-2">Adviser</th><th>Calls</th><th>Reviewed</th><th>Average score</th><th>Change</th><th>Compliant</th><th>Minor</th><th>Major</th><th>Non-compliant</th><th>Coaching</th><th /></tr></thead>
        <tbody>{d.advisers.map((a) => { const delta = a.avg_score != null && a.previous_avg_score != null ? a.avg_score - a.previous_avg_score : null; return (
          <tr key={a.adviser_id} className="border-b border-slate-100 dark:border-slate-700"><td className="p-2 font-semibold">{a.name}</td><td>{a.calls}</td><td>{a.reviewed}</td><td>{a.avg_score != null ? `${a.avg_score}%` : "–"}</td><td className={delta == null ? "" : delta < 0 ? "text-rose-600" : "text-emerald-600"}>{delta == null ? "–" : `${delta > 0 ? "+" : ""}${delta}`}</td><td>{a.compliant}</td><td>{a.minor_issues}</td><td>{a.major_issues}</td><td className={a.non_compliant ? "font-bold text-rose-600" : ""}>{a.non_compliant}</td><td>{a.coaching_open}</td><td><button className="text-xs text-brand-600 underline" onClick={() => openCoach(a.adviser_id)}>Coach</button></td></tr>); })}</tbody></table>
        {d.advisers.length === 0 && <p className="p-4 text-sm text-slate-500">No calls in this period.</p>}</div>
      <p className="text-[11px] text-slate-500">Scores come only from approved human reviews. “Change” compares with the previous period of the same length.</p>
      <div className="panel p-4"><p className="mb-2 text-sm font-bold">Most common “No” answers</p>{d.common_failures.length === 0 ? <p className="text-sm text-slate-500">No failures recorded.</p> : <ul className="space-y-1.5">{d.common_failures.map((c) => <li key={c.item} className="flex items-center gap-2 text-sm"><span className="w-64 shrink-0 truncate">{label(c.item)}</span><span className="h-2 rounded bg-rose-400" style={{ width: `${Math.min(100, c.count * 8)}%` }} /><span className="text-xs text-slate-500">{c.count}</span></li>)}</ul>}</div>
    </div>
  );
}

/* ---------------- Workflows ---------------- */
const QFILTERS: [string, string][] = [["open", "All open"], ["mine", "Mine"], ["unassigned", "Unassigned"], ["pending_approval", "Awaiting approval"], ["overdue", "Overdue"], ["escalated", "Escalated"], ["completed", "Completed"]];
export function WorkflowSection({ open }: { open: (callId: string) => void }) {
  const [f, setF] = useState("open");
  const { data, err, reload } = useLoad<QueueRow[]>(() => fetchQueue(f), [f]);
  const un = useLoad<UnreviewedRow[]>(() => fetchUnreviewed(25), []);
  const [busy, setBusy] = useState<string | null>(null); const [e2, setE2] = useState<string | null>(null);
  const putForward = async (id: string) => { setBusy(id); setE2(null); try { const due = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10); await assignReview(id, null, "normal", due); reload(); un.reload(); } catch (e) { setE2((e as Error).message); } finally { setBusy(null); } };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">{QFILTERS.map(([k, v]) => <button key={k} onClick={() => setF(k)} className={`rounded-full px-3 py-1 text-xs font-semibold ${f === k ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300"}`}>{v}</button>)}</div>
      {err && <Err m={err} />}{!data && !err && <Busy />}
      {data && <div className="panel overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-400 dark:border-slate-700"><th className="p-2">Call</th><th>Adviser</th><th>Reviewer</th><th>Status</th><th>Priority</th><th>Due</th><th>Result</th></tr></thead>
        <tbody>{data.map((r) => <tr key={r.review_id} onClick={() => open(r.call_id)} className="cursor-pointer border-b border-slate-100 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-700/40"><td className="p-2 whitespace-nowrap">{fmtWhen(r.call_started_at)}</td><td>{r.adviser_name ?? "–"}</td><td>{r.reviewer_name ?? <span className="text-amber-700">unassigned</span>}{r.mine ? " (you)" : ""}</td><td><Badge s={r.status} />{r.is_escalated && <span className="ml-1 text-[11px] font-bold text-rose-600">escalated{r.escalated_to_name ? ` to ${r.escalated_to_name}` : ""}</span>}</td><td>{PRIORITY_LABEL[r.priority] ?? r.priority}</td><td className={r.overdue ? "font-bold text-rose-600" : ""}>{r.due_date ? fmtDate(r.due_date) : "–"}</td><td>{r.outcome ? `${REVIEW_OUTCOME_LABEL[r.outcome] ?? r.outcome}${r.score != null ? ` · ${r.score}%` : ""}` : "–"}</td></tr>)}</tbody></table>
        {data.length === 0 && <p className="p-4 text-sm text-slate-500">Nothing here.</p>}</div>}
      <div className="panel p-4"><p className="mb-2 text-sm font-bold">Calls that look like they need a review</p>{e2 && <Err m={e2} />}
        {!un.data ? <Busy /> : un.data.length === 0 ? <p className="text-sm text-slate-500">Nothing is waiting.</p> : <ul className="divide-y divide-slate-100 dark:divide-slate-700">{un.data.map((u) => <li key={u.call_id} className="flex items-center gap-2 py-2 text-sm"><button className="flex-1 text-left hover:underline" onClick={() => open(u.call_id)}>{u.adviser_name ?? "Unknown"} · {fmtWhen(u.started_at)} · {fmtDuration(u.duration_seconds)}<span className="ml-2 text-[11px] text-amber-700">{u.reasons.join(", ").replace(/_/g, " ")}</span></button><button disabled={busy === u.call_id} className="btn btn-secondary px-2.5 py-1 text-xs" onClick={() => putForward(u.call_id)}>Put forward</button></li>)}</ul>}</div>
    </div>
  );
}

/* ---------------- Risks ---------------- */
export function RiskSection({ open }: { open: (callId: string) => void }) {
  const [st, setSt] = useState("open");
  const { data, err, reload } = useLoad<RiskListRow[]>(() => fetchRisks(st), [st]);
  const [res, setRes] = useState<{ id: string; note: string } | null>(null); const [e2, setE2] = useState<string | null>(null);
  return (
    <div className="space-y-3"><div className="flex gap-1.5">{["open", "resolved", "all"].map((k) => <button key={k} onClick={() => setSt(k)} className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${st === k ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300"}`}>{k}</button>)}</div>
      {err && <Err m={err} />}{e2 && <Err m={e2} />}{!data && !err && <Busy />}
      {data && (data.length === 0 ? <p className="panel p-4 text-sm text-slate-500">No risk indicators.</p> : <ul className="space-y-2">{data.map((r) => (
        <li key={r.id} className="panel flex flex-wrap items-center gap-2 p-3 text-sm"><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold uppercase dark:bg-slate-700">{r.severity}</span><b>{RISK_TYPES[r.risk_type] ?? r.risk_type}</b><span className="flex-1">{r.description}</span><span className="text-xs text-slate-400">{fmtWhen(r.raised_at)}{r.raised_by_name ? ` · ${r.raised_by_name}` : ""}</span>
          <button className="text-xs text-brand-600 underline" onClick={() => open(r.call_id)}>Open call</button>
          {r.status === "open" ? (res?.id === r.id ? <><input className="input !w-56 !py-1 text-xs" placeholder="How it was resolved" value={res.note} onChange={(e) => setRes({ id: r.id, note: e.target.value })} /><button disabled={res.note.trim().length < 5} className="btn btn-primary px-2 py-1 text-xs" onClick={() => resolveRisk(r.id, res.note).then(() => { setRes(null); reload(); }).catch((e) => setE2((e as Error).message))}>Resolve</button></> : <button className="btn btn-secondary px-2 py-1 text-xs" onClick={() => setRes({ id: r.id, note: "" })}>Resolve</button>) : <span className="text-xs text-emerald-700">Resolved{r.resolution_note ? `: ${r.resolution_note}` : ""}</span>}</li>))}</ul>)}</div>
  );
}

/* ---------------- Coaching ---------------- */
export function CoachingSection({ preselect }: { preselect?: string }) {
  const [scope, setScope] = useState("open");
  const { data, err, reload } = useLoad<CoachingRow[]>(() => fetchCoachingList(scope), [scope]);
  const [people, setPeople] = useState<Person[]>([]);
  const [form, setForm] = useState({ adviser: preselect ?? "", type: "feedback", title: "", description: "", priority: "normal", due: "" });
  const [msg, setMsg] = useState<string | null>(null); const [rate, setRate] = useState<{ id: string; rating: number; text: string } | null>(null);
  useEffect(() => { fetchPeople().then(setPeople).catch(() => undefined); }, []);
  useEffect(() => { if (preselect) setForm((f) => ({ ...f, adviser: preselect })); }, [preselect]);
  const guard = async (f: () => Promise<unknown>, ok?: () => void) => { setMsg(null); try { await f(); ok?.(); reload(); } catch (e) { setMsg((e as Error).message); } };
  return (
    <div className="space-y-4">
      <div className="panel grid gap-3 p-4 sm:grid-cols-3"><p className="text-sm font-bold sm:col-span-3">Assign coaching</p>
        <div><label className="label">Adviser</label><select className="input" value={form.adviser} onChange={(e) => setForm({ ...form, adviser: e.target.value })}><option value="">Choose…</option>{people.map((p) => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}</select></div>
        <div><label className="label">Type</label><select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>{Object.entries(COACHING_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div><label className="label">Priority</label><select className="input" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>{Object.entries(PRIORITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div className="sm:col-span-2"><label className="label">Title</label><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
        <div><label className="label">Due</label><input type="date" className="input" min={today()} value={form.due} onChange={(e) => setForm({ ...form, due: e.target.value })} /></div>
        <div className="sm:col-span-3"><label className="label">What should they do</label><textarea className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
        <div className="sm:col-span-3"><button disabled={!form.adviser || form.title.trim().length < 3} className="btn btn-primary" onClick={() => guard(() => assignCoaching({ adviser: form.adviser, type: form.type, title: form.title, description: form.description, priority: form.priority, due: form.due || null }), () => setForm({ ...form, title: "", description: "", due: "" }))}>Assign</button></div></div>
      <div className="flex gap-1.5">{["open", "completed", "all"].map((k) => <button key={k} onClick={() => setScope(k)} className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${scope === k ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300"}`}>{k}</button>)}</div>
      {msg && <Err m={msg} />}{err && <Err m={err} />}{!data && !err && <Busy />}
      {data && (data.length === 0 ? <p className="panel p-4 text-sm text-slate-500">No coaching here.</p> : <ul className="space-y-2">{data.map((c) => (
        <li key={c.id} className="panel p-3 text-sm"><div className="flex flex-wrap items-center gap-2"><b>{c.title}</b><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] dark:bg-slate-700">{COACHING_TYPES[c.action_type] ?? c.action_type}</span><span className="text-xs text-slate-500">for {c.adviser_name} · {c.status.replace("_", " ")}{c.due_date ? ` · due ${fmtDate(c.due_date)}` : ""}{c.overdue ? " · overdue" : ""}</span></div>
          {c.description && <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{c.description}</p>}{c.completion_notes && <p className="mt-1 text-xs">Done: {c.completion_notes}</p>}{c.feedback_text && <p className="mt-1 text-xs">Manager feedback: {c.feedback_text}{c.manager_rating ? ` (${c.manager_rating}/5)` : ""}</p>}
          <div className="mt-1.5 flex gap-3 text-xs">{c.status === "completed" && c.manager_rating == null && (rate?.id === c.id ? <span className="flex flex-wrap items-center gap-2"><select className="input !w-auto !py-1 text-xs" value={rate.rating} onChange={(e) => setRate({ ...rate, rating: Number(e.target.value) })}>{[1, 2, 3, 4, 5].map((n) => <option key={n}>{n}</option>)}</select><input className="input !py-1 text-xs" value={rate.text} onChange={(e) => setRate({ ...rate, text: e.target.value })} placeholder="Feedback" /><button className="btn btn-primary px-2 py-1 text-xs" onClick={() => guard(() => reviewCoaching(c.id, rate.rating, rate.text), () => setRate(null))}>Save</button></span> : <button className="text-brand-600 underline" onClick={() => setRate({ id: c.id, rating: 4, text: "" })}>Rate and give feedback</button>)}
            {["open", "in_progress"].includes(c.status) && <button className="text-rose-600 underline" onClick={() => { const r = window.prompt("Why is this being cancelled?"); if (r && r.trim().length >= 5) void guard(() => cancelCoaching(c.id, r)); }}>Cancel</button>}</div></li>))}</ul>)}</div>
  );
}

/* ---------------- Audit log ---------------- */
export function AuditSection({ open }: { open: (callId: string) => void }) {
  const [f, setF] = useState({ action: "", from: daysAgo(30), to: today(), user: "" }); const [people, setPeople] = useState<Person[]>([]);
  const [rows, setRows] = useState<AuditRow[] | null>(null); const [err, setErr] = useState<string | null>(null);
  const run = useCallback(() => { setErr(null); fetchAudit({ action: f.action || undefined, from: f.from || undefined, to: f.to || undefined, user: f.user || undefined, limit: 300 }).then(setRows).catch((e) => setErr((e as Error).message)); }, [f]);
  useEffect(() => { run(); fetchPeople().then(setPeople).catch(() => undefined); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="space-y-3"><div className="panel grid gap-3 p-4 sm:grid-cols-5"><div><label className="label">From</label><input type="date" className="input" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></div><div><label className="label">To</label><input type="date" className="input" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></div>
      <div><label className="label">Person</label><select className="input" value={f.user} onChange={(e) => setF({ ...f, user: e.target.value })}><option value="">Anyone</option>{people.map((p) => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}</select></div>
      <div><label className="label">Action</label><select className="input" value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })}><option value="">Any</option>{["view_call", "play_recording", "download_recording", "recording_paused", "recording_resumed", "call_transferred", "read_transcript"].map((a) => <option key={a} value={a}>{a.replace(/_/g, " ")}</option>)}</select></div>
      <div className="flex items-end gap-2"><button className="btn btn-primary" onClick={run}>Apply</button><button className="btn btn-secondary" disabled={!rows} onClick={() => rows && downloadText("access-log.csv", csvOf(["When", "Person", "Action", "Call", "Detail"], rows.map((r) => [r.at, r.user_name, r.action, r.call_id, r.detail ? JSON.stringify(r.detail) : ""])))}><Download className="h-4 w-4" /></button></div></div>
      {err && <Err m={err} />}{!rows && !err && <Busy />}
      {rows && <div className="panel overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-400 dark:border-slate-700"><th className="p-2">When</th><th>Who</th><th>What</th><th>Call</th></tr></thead><tbody>{rows.map((r, i) => <tr key={i} className="border-b border-slate-100 dark:border-slate-700"><td className="p-2 whitespace-nowrap">{fmtWhen(r.at)}</td><td>{r.user_name ?? "System"}</td><td>{r.action.replace(/_/g, " ")}{r.detail && (r.detail as { reason?: string }).reason ? ` · ${(r.detail as { reason?: string }).reason}` : ""}</td><td><button className="text-xs text-brand-600 underline" onClick={() => open(r.call_id)}>Open</button></td></tr>)}</tbody></table>{rows.length === 0 && <p className="p-4 text-sm text-slate-500">Nothing logged.</p>}</div>}
      <p className="text-[11px] text-slate-500">This is the record of who looked at, played, downloaded or changed a call. It cannot be edited or deleted.</p></div>
  );
}

/* ---------------- Reports ---------------- */
const REPORTS: [string, string][] = [["compliance_summary", "Compliance summary"], ["adviser_performance", "Adviser performance"], ["risk_analysis", "Risk analysis"], ["audit_trail", "Audit trail"], ["complaint_trends", "Complaint trends"], ["regulatory_return", "Regulatory return"]];
export function ReportSection() {
  const [type, setType] = useState("compliance_summary"); const [from, setFrom] = useState(daysAgo(30)); const [to, setTo] = useState(today());
  const [r, setR] = useState<Report | null>(null); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const run = async () => { setBusy(true); setErr(null); try { setR(await fetchReport(type, from, to)); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };
  return (
    <div className="space-y-3"><div className="panel grid gap-3 p-4 sm:grid-cols-4"><div><label className="label">Report</label><select className="input" value={type} onChange={(e) => setType(e.target.value)}>{REPORTS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div><div><label className="label">From</label><input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></div><div><label className="label">To</label><input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></div><div className="flex items-end"><button disabled={busy} className="btn btn-primary" onClick={run}>{busy ? "Working…" : "Run report"}</button></div></div>
      {err && <Err m={err} />}
      {r && <div className="panel overflow-x-auto p-3"><div className="mb-2 flex items-center gap-2"><p className="flex-1 text-sm font-bold">{r.title} · {r.from} to {r.to}</p><button className="btn btn-secondary text-xs" onClick={() => downloadText(`${type}-${r.from}-${r.to}.csv`, csvOf(r.columns, r.rows))}><Download className="h-3.5 w-3.5" /> CSV</button><button className="btn btn-secondary text-xs" onClick={() => window.print()}>Print</button></div>
        <table className="w-full text-sm"><thead><tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-400 dark:border-slate-700">{r.columns.map((c) => <th key={c} className="p-2">{c}</th>)}</tr></thead><tbody>{r.rows.map((row, i) => <tr key={i} className="border-b border-slate-100 dark:border-slate-700">{row.map((v, j) => <td key={j} className="p-2">{v ?? ""}</td>)}</tr>)}</tbody></table>{r.rows.length === 0 && <p className="p-3 text-sm text-slate-500">No data for this period.</p>}<p className="mt-2 text-[11px] text-slate-400">Generated {fmtWhen(r.generated_at)}</p></div>}</div>
  );
}

/* ---------------- Settings ---------------- */
export function SettingsSection() {
  const { data, err, reload } = useLoad<TelephonySettings>(fetchTelephony, []);
  const [s, setS] = useState<TelephonySettings | null>(null); const [msg, setMsg] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  useEffect(() => { if (data) setS(data); }, [data]);
  if (err) return <Err m={err} />; if (!s) return <Busy />;
  const save = async () => { setBusy(true); setMsg(null); try { await saveTelephony(s); setMsg("Saved."); reload(); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); } };
  const dis = !s.can_edit;
  return (
    <div className="panel max-w-2xl space-y-4 p-4"><p className="text-sm font-bold">Call recording and review settings</p>{dis && <p className="text-xs text-slate-500">Only an administrator can change these.</p>}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={dis} checked={s.record_calls} onChange={(e) => setS({ ...s, record_calls: e.target.checked })} /> Record calls</label>
      <div><label className="label">Recording notice read to the client</label><textarea className="input" disabled={dis} value={s.recording_notice_text} onChange={(e) => setS({ ...s, recording_notice_text: e.target.value })} /></div>
      <div><label className="label">Keep recordings for (years)</label><input type="number" min={1} max={15} className="input !w-28" disabled={dis} value={s.retention_years} onChange={(e) => setS({ ...s, retention_years: Number(e.target.value) })} /></div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={dis} checked={s.transcription_enabled} onChange={(e) => setS({ ...s, transcription_enabled: e.target.checked })} /> Transcribe recorded calls</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={dis || !s.transcription_enabled} checked={s.ai_analysis_enabled && s.transcription_enabled} onChange={(e) => setS({ ...s, ai_analysis_enabled: e.target.checked })} /> Draft AI summaries and analysis from transcripts (a person always approves them)</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={dis} checked={s.require_second_approver} onChange={(e) => setS({ ...s, require_second_approver: e.target.checked })} /> A different person must approve each review</label>
      <div><p className="label">Your firm’s numbers</p>{s.numbers.length === 0 ? <p className="text-xs text-slate-500">No numbers are set up yet.</p> : <ul className="text-sm">{s.numbers.map((n) => <li key={n.e164}>{n.e164}{n.label ? ` · ${n.label}` : ""}</li>)}</ul>}</div>
      {msg && <p className="text-sm">{msg}</p>}{!dis && <button disabled={busy} className="btn btn-primary" onClick={save}>Save settings</button>}</div>
  );
}

/** The firm's call script: the points an adviser must cover. The AI marks each one from the transcript as a draft and a reviewer confirms or changes it. */
export function ScriptEditor() {
  const { data, err, reload } = useLoad<CallScript>(fetchScript, []);
  const [name, setName] = useState(""); const [pts, setPts] = useState<ScriptPoint[]>([]);
  const [msg, setMsg] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  useEffect(() => { if (data) { setName(data.active.is_default ? "Our call script" : data.active.name); setPts(data.active.points.map((p) => ({ ...p }))); } }, [data]);
  if (err) return <Err m={err} />; if (!data) return <Busy />;
  const dis = !data.can_edit;
  const set = (i: number, patch: Partial<ScriptPoint>) => setPts(pts.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const move = (i: number, d: number) => { const j = i + d; if (j < 0 || j >= pts.length) return; const n = [...pts]; [n[i], n[j]] = [n[j], n[i]]; setPts(n); };
  const save = async () => { setBusy(true); setMsg(null); try { const v = await saveScript(name, pts.filter((p) => p.label.trim()).map((p) => ({ ...p, label: p.label.trim(), guidance: (p.guidance ?? "").trim() }))); setMsg(`Saved as version ${v}. Reviews already started keep the script they began with.`); reload(); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); } };
  return (
    <div className="panel max-w-2xl space-y-3 p-4">
      <p className="text-sm font-bold">Call script</p>
      <p className="text-xs text-slate-500">List what an adviser must cover on a call. When a call has a transcript the AI marks each point as covered or missed and shows its evidence. A reviewer listens and confirms or changes every answer. The score is the share of points the reviewer marks as covered. {data.active.is_default ? "You are using the standard nine-point checklist until you save your own script." : `Current: ${data.active.name}, version ${data.active.version}.`}</p>
      {dis && <p className="text-xs text-slate-500">Only an administrator can change the script.</p>}
      <div><label className="label">Script name</label><input className="input" disabled={dis} value={name} onChange={(e) => setName(e.target.value)} /></div>
      <ol className="space-y-2">
        {pts.map((p, i) => (
          <li key={p.key + i} className="rounded-lg border border-slate-200 p-2 dark:border-slate-700">
            <div className="flex gap-2"><span className="pt-2 text-xs font-bold text-slate-400">{i + 1}</span>
              <div className="min-w-0 flex-1 space-y-1">
                <input className="input" disabled={dis} placeholder="What the adviser must cover" maxLength={200} value={p.label} onChange={(e) => set(i, { label: e.target.value })} />
                <input className="input text-xs" disabled={dis} placeholder="Optional note for the AI and reviewer, for example “must be said word for word”" maxLength={600} value={p.guidance ?? ""} onChange={(e) => set(i, { guidance: e.target.value })} /></div>
              {!dis && <div className="flex flex-col text-xs"><button onClick={() => move(i, -1)} disabled={i === 0}>Up</button><button onClick={() => move(i, 1)} disabled={i === pts.length - 1}>Down</button><button className="text-rose-600" onClick={() => setPts(pts.filter((_, j) => j !== i))}>Remove</button></div>}
            </div>
          </li>))}
      </ol>
      {!dis && pts.length < 40 && <button className="text-xs text-brand-600 underline" onClick={() => setPts([...pts, { key: "", label: "", guidance: "" }])}>Add a point</button>}
      {msg && <p className="text-sm">{msg}</p>}
      {!dis && <button disabled={busy || pts.every((p) => !p.label.trim())} className="btn btn-primary" onClick={save}>Save as a new version</button>}
      {data.versions.length > 0 && <p className="text-[11px] text-slate-500">Earlier versions are kept: {data.versions.map((v) => `v${v.version} (${v.points} points${v.is_active ? ", current" : ""})`).join(", ")}.</p>}
    </div>
  );
}
