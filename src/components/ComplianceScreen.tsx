import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ClipboardCheck, Loader2, ShieldAlert } from "lucide-react";
import {
  fetchDashboard, fetchQueue, fetchAudit, fetchCallDetail, takeReview, completeReview, fetchCoaching, markCoachingDone,
  CHECKLIST, OUTCOME_LABEL, REVIEW_OUTCOME_LABEL, type ComplianceDashboard, type QueueRow, type AuditRow, type CallDetail, type CoachingRow,
} from "@/lib/call-hooks";

const when = (s: string) => new Date(s).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const day = (s: string) => new Date(s.length > 10 ? s : s + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
type Tab = "overview" | "queue" | "audit";
const FILTERS: [string, string][] = [["needs_review", "Needs a review"], ["flagged", "Flagged"], ["open", "In progress"], ["completed", "Done"]];

function Kpi({ label, value, tone }: { label: string; value: number; tone?: "bad" | "good" }) {
  return (
    <div className="panel p-3">
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 text-xl font-bold tabular-nums ${tone === "bad" && value > 0 ? "text-rose-600" : tone === "good" ? "text-emerald-600" : "text-slate-800 dark:text-slate-100"}`}>{value}</p>
    </div>
  );
}

function ReviewForm({ row, onDone, onClose }: { row: QueueRow; onDone: () => void; onClose: () => void }) {
  const [d, setD] = useState<CallDetail | null>(null);
  const [reviewId, setReviewId] = useState<string | null>(row.review_status === "open" && row.mine ? row.review_id : null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [outcome, setOutcome] = useState("pass");
  const [comments, setComments] = useState("");
  const [coaching, setCoaching] = useState("");
  const [coachingDue, setCoachingDue] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { fetchCallDetail(row.id).then(setD).catch((e) => setErr((e as Error).message)); }, [row.id]);
  const readOnly = row.review_status === "completed" || (row.review_status === "open" && !row.mine);
  const start = async () => { setBusy(true); setErr(null); try { setReviewId(await takeReview(row.id)); onDone(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };
  const finish = async () => {
    if (!reviewId) return;
    setBusy(true); setErr(null);
    try { await completeReview(reviewId, outcome, answers, comments, coaching, coachingDue); onDone(); onClose(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const done = d?.review?.status === "completed";
  return (
    <div className="panel space-y-3 p-4">
      <div className="flex items-start justify-between">
        <div><p className="text-sm font-bold">{row.debtor_name} <span className="font-normal text-slate-400">{row.case_number}</span></p><p className="text-xs text-slate-500">{when(row.started_at)} · {row.direction} · {OUTCOME_LABEL[row.outcome] ?? row.outcome} · taken by {row.adviser_name ?? "unknown"}</p></div>
        <button onClick={onClose} className="text-xs text-slate-500 hover:underline">Close</button>
      </div>
      {!d && !err && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
      {d?.call.summary && <p className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-900/40">{d.call.summary}</p>}
      {d && d.drafts.length > 0 && <p className="text-xs text-violet-700">This call has {d.drafts.length} AI-drafted note(s) attached. Check what a person approved, not the draft itself.</p>}
      {done && d?.review && (
        <div className="space-y-1 text-sm">
          <p className="font-semibold">{REVIEW_OUTCOME_LABEL[d.review.outcome ?? ""]}</p>
          {d.review.comments && <p className="text-slate-600 dark:text-slate-300">{d.review.comments}</p>}
          <ul className="text-xs text-slate-500">{CHECKLIST.map((c) => <li key={c.key}>{c.label}: <b>{d.review?.checklist?.[c.key] ?? "-"}</b></li>)}</ul>
          {d.review.coaching_action && <p className="text-slate-600 dark:text-slate-300">Coaching: {d.review.coaching_action}</p>}
        </div>
      )}
      {!done && !reviewId && !readOnly && <button disabled={busy} onClick={start} className="btn btn-primary text-xs"><ClipboardCheck className="h-3.5 w-3.5" /> Start the review</button>}
      {!done && readOnly && <p className="text-xs text-slate-500">This review is with {row.reviewer_name ?? "another reviewer"}.</p>}
      {!done && reviewId && (
        <div className="space-y-3">
          <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
            {CHECKLIST.map((c) => (
              <div key={c.key} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span>{c.label}</span>
                <span className="flex shrink-0 gap-3 text-xs">{["yes", "no", "na"].map((v) => <label key={v} className="flex items-center gap-1"><input type="radio" name={c.key} checked={answers[c.key] === v} onChange={() => setAnswers({ ...answers, [c.key]: v })} />{v === "na" ? "n/a" : v}</label>)}</span>
              </div>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className="label">Outcome</label><select className="input" value={outcome} onChange={(e) => setOutcome(e.target.value)}>{Object.entries(REVIEW_OUTCOME_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            <div><label className="label">Coaching due</label><input type="date" className="input" value={coachingDue} onChange={(e) => setCoachingDue(e.target.value)} /></div>
          </div>
          <div><label className="label">Comments {outcome !== "pass" && <span className="normal-case text-rose-500">(required)</span>}</label><textarea className="input min-h-[70px]" value={comments} onChange={(e) => setComments(e.target.value)} /></div>
          <div><label className="label">Coaching for the adviser (optional)</label><textarea className="input min-h-[50px]" value={coaching} onChange={(e) => setCoaching(e.target.value)} /></div>
          <button disabled={busy || Object.keys(answers).length < CHECKLIST.length} onClick={finish} className="btn btn-primary">{busy ? "Saving…" : "Complete review"}</button>
          {Object.keys(answers).length < CHECKLIST.length && <p className="text-xs text-slate-400">Answer every line to complete the review.</p>}
        </div>
      )}
      {err && <p className="text-sm text-rose-600">{err}</p>}
    </div>
  );
}

/** Call compliance for managers: how the firm is doing, which calls to review next, and who has looked at what. */
export function ComplianceScreen() {
  const [tab, setTab] = useState<Tab>("overview");
  const [dash, setDash] = useState<ComplianceDashboard | null>(null);
  const [filter, setFilter] = useState("needs_review");
  const [rows, setRows] = useState<QueueRow[] | null>(null);
  const [audit, setAudit] = useState<AuditRow[] | null>(null);
  const [sel, setSel] = useState<QueueRow | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const loadDash = useCallback(() => { fetchDashboard().then(setDash).catch((e) => setErr((e as Error).message)); }, []);
  const loadQueue = useCallback(() => { setRows(null); fetchQueue(filter).then(setRows).catch((e) => setErr((e as Error).message)); }, [filter]);
  useEffect(loadDash, [loadDash]);
  useEffect(() => { if (tab === "queue") loadQueue(); }, [tab, loadQueue]);
  useEffect(() => { if (tab === "audit") fetchAudit().then(setAudit).catch((e) => setErr((e as Error).message)); }, [tab]);
  const refresh = () => { loadDash(); loadQueue(); };
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-bold">Call compliance</h1>
        <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-0.5 text-xs font-semibold dark:border-slate-700 dark:bg-slate-800">
          {([["overview", "Overview"], ["queue", "Review queue"], ["audit", "Who looked at what"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={`rounded-md px-3 py-1.5 ${tab === k ? "bg-emerald-600 text-white" : "text-slate-600 dark:text-slate-300"}`}>{l}</button>
          ))}
        </div>
      </div>
      {err && <p className="text-sm text-rose-600">{err}</p>}
      {tab === "overview" && (!dash ? <Loader2 className="h-5 w-5 animate-spin text-slate-400" /> : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label="Calls, last 30 days" value={dash.calls_30d} />
            <Kpi label="Reviewed" value={dash.reviewed_30d} tone="good" />
            <Kpi label="Reviews in progress" value={dash.open_reviews} />
            <Kpi label="Overdue reviews" value={dash.overdue_reviews} tone="bad" />
            <Kpi label="Passed" value={dash.passed} tone="good" />
            <Kpi label="Failed or escalated" value={dash.failed} tone="bad" />
            <Kpi label="Flagged, not yet reviewed" value={dash.flagged_unreviewed} tone="bad" />
            <Kpi label="No recording notice" value={dash.no_notice} tone="bad" />
          </div>
          <div className="panel overflow-hidden">
            <table className="w-full text-sm"><thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-400 dark:bg-slate-900/40"><tr><th className="px-3 py-2">Adviser</th><th className="px-3 py-2 text-right">Calls</th><th className="px-3 py-2 text-right">Reviewed</th><th className="px-3 py-2 text-right">Passed</th><th className="px-3 py-2 text-right">Failed</th></tr></thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                {dash.by_adviser.length === 0 && <tr><td colSpan={5} className="px-3 py-4 text-slate-500">No calls in the last 30 days.</td></tr>}
                {dash.by_adviser.map((a, i) => <tr key={a.adviser_id ?? i}><td className="px-3 py-2">{a.name ?? "Unknown"}</td><td className="px-3 py-2 text-right tabular-nums">{a.calls}</td><td className="px-3 py-2 text-right tabular-nums">{a.reviewed}</td><td className="px-3 py-2 text-right tabular-nums">{a.passed}</td><td className="px-3 py-2 text-right tabular-nums">{a.failed}</td></tr>)}
              </tbody></table>
          </div>
        </>
      ))}
      {tab === "queue" && (
        <div className="space-y-3">
          <div className="flex gap-1.5 text-xs font-semibold">{FILTERS.map(([k, l]) => <button key={k} onClick={() => { setFilter(k); setSel(null); }} className={`rounded-full px-3 py-1 ${filter === k ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-200"}`}>{l}</button>)}</div>
          {sel && <ReviewForm key={sel.id} row={sel} onDone={refresh} onClose={() => setSel(null)} />}
          {!rows ? <Loader2 className="h-5 w-5 animate-spin text-slate-400" /> : rows.length === 0 ? <p className="panel p-4 text-sm text-slate-500">Nothing here.</p> : (
            <div className="panel divide-y divide-slate-100 overflow-hidden dark:divide-slate-700">
              {rows.map((r) => (
                <button key={r.id} onClick={() => setSel(r)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-700/40">
                  <div className="min-w-0 flex-1"><p className="text-sm font-semibold">{r.debtor_name} <span className="font-normal text-slate-400">{r.case_number} · {when(r.started_at)} · {r.adviser_name ?? "unknown"}</span></p>
                    <p className="text-xs text-slate-500">{OUTCOME_LABEL[r.outcome] ?? r.outcome}{r.review_status === "open" && r.due_date ? ` · review due ${day(r.due_date)}${r.reviewer_name ? ` · ${r.reviewer_name}` : ""}` : ""}{r.review_outcome ? ` · ${REVIEW_OUTCOME_LABEL[r.review_outcome]}` : ""}</p></div>
                  {r.flags.map((f) => <span key={f} className="flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-bold text-rose-700"><ShieldAlert className="h-3 w-3" />{f}</span>)}
                  {r.review_status === "completed" && <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {tab === "audit" && (!audit ? <Loader2 className="h-5 w-5 animate-spin text-slate-400" /> : (
        <div className="panel overflow-hidden"><table className="w-full text-sm"><thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-400 dark:bg-slate-900/40"><tr><th className="px-3 py-2">When</th><th className="px-3 py-2">Who</th><th className="px-3 py-2">What</th><th className="px-3 py-2">Client</th></tr></thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
            {audit.length === 0 && <tr><td colSpan={4} className="px-3 py-4 text-slate-500">Nobody has opened a call yet.</td></tr>}
            {audit.map((a, i) => <tr key={i}><td className="px-3 py-2">{when(a.at)}</td><td className="px-3 py-2">{a.user_name ?? "Unknown"}</td><td className="px-3 py-2">{a.action.replace(/_/g, " ")}</td><td className="px-3 py-2">{a.debtor_name} <span className="text-slate-400">{a.case_number}</span></td></tr>)}
          </tbody></table></div>
      ))}
    </div>
  );
}

/** The adviser's own coaching from call reviews. Shown on the Calls tab. */
export function MyCoaching() {
  const [rows, setRows] = useState<CoachingRow[]>([]);
  const load = useCallback(() => { fetchCoaching().then(setRows).catch(() => setRows([])); }, []);
  useEffect(load, [load]);
  const open = rows.filter((r) => !r.done);
  if (open.length === 0) return null;
  return (
    <div className="panel space-y-2 border-amber-200 bg-amber-50/60 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
      <p className="text-xs font-bold uppercase tracking-wide text-amber-800 dark:text-amber-300">Coaching from your call reviews</p>
      {open.map((r) => (
        <div key={r.review_id} className="flex items-start justify-between gap-3 text-sm">
          <p>{r.coaching_action} <span className="text-slate-500">({r.debtor_name}{r.coaching_due ? `, by ${day(r.coaching_due)}` : ""})</span></p>
          <button onClick={() => markCoachingDone(r.review_id).then(load)} className="btn btn-secondary shrink-0 px-2.5 py-1 text-xs">Done</button>
        </div>
      ))}
    </div>
  );
}
