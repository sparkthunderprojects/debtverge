import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import {
  AI_CHECK_MAP, CHECKLIST, PRIORITY_LABEL, REVIEW_OUTCOME_LABEL, REVIEW_STATUS_LABEL, assignReview, claimReview, declineReview, decideReview, escalateReview, extendReview, fetchPeople, fmtDate, fmtWhen,
  reassignReview, startReview, submitReview, type AiDraft, type Person, type ReviewFull,
} from "@/lib/call-hooks";

const inDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const SEV: Record<string, string> = { minor: "Minor", major: "Major", critical: "Critical" };

function suggestions(drafts: AiDraft[]): Record<string, { suggested: string; evidence: string }> {
  const a = drafts.find((d) => d.kind === "analysis" && d.payload && d.status !== "rejected"); if (!a?.payload) return {};
  try {
    const out: Record<string, { suggested: string; evidence: string }> = {};
    for (const s of (JSON.parse(a.payload).checklist_suggestions ?? []) as { item: string; suggested: string; evidence: string }[]) { const k = AI_CHECK_MAP[s.item]; if (k) out[k] = { suggested: s.suggested, evidence: s.evidence }; }
    return out;
  } catch { return {}; }
}

function Form({ review, drafts, onDone }: { review: ReviewFull; drafts: AiDraft[]; onDone: () => void }) {
  const [answers, setAnswers] = useState<Record<string, string>>(review.checklist ?? {});
  const [outcome, setOutcome] = useState(review.outcome ?? "compliant");
  const [issues, setIssues] = useState<{ severity: string; text: string }[]>(review.issues ?? []);
  const [actions, setActions] = useState<{ text: string }[]>(review.corrective_actions ?? []);
  const [comments, setComments] = useState(review.comments ?? "");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const hint = suggestions(drafts);
  const submit = async () => { setBusy(true); setErr(null); try { await submitReview(review.id, outcome, answers, issues.filter((i) => i.text.trim()), actions.filter((a) => a.text.trim()), comments); onDone(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">You answer every question yourself. Where an AI draft has a suggestion it is shown as a hint only, and never fills in an answer.</p>
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
        {CHECKLIST.map((c) => (
          <li key={c.key} className="px-3 py-2">
            <div className="flex flex-wrap items-center gap-3"><span className="min-w-0 flex-1 text-sm">{c.label}</span>
              {(["yes", "no", "na"] as const).map((v) => <label key={v} className="flex items-center gap-1 text-xs"><input type="radio" name={c.key} checked={answers[c.key] === v} onChange={() => setAnswers({ ...answers, [c.key]: v })} />{v === "na" ? "N/A" : v === "yes" ? "Yes" : "No"}</label>)}</div>
            {hint[c.key] && <p className="mt-1 text-[11px] text-violet-700 dark:text-violet-300">AI hint (unchecked): {hint[c.key].suggested}. {hint[c.key].evidence}</p>}
          </li>))}
      </ul>
      <div><label className="label">Overall finding</label><select className="input" value={outcome} onChange={(e) => setOutcome(e.target.value)}>{Object.entries(REVIEW_OUTCOME_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
      <div className="space-y-1.5"><label className="label">Issues found</label>
        {issues.map((it, i) => <div key={i} className="flex gap-2"><select className="input !w-28" value={it.severity} onChange={(e) => setIssues(issues.map((x, j) => (j === i ? { ...x, severity: e.target.value } : x)))}>{Object.entries(SEV).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select><input className="input" value={it.text} onChange={(e) => setIssues(issues.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} placeholder="What went wrong" /><button className="text-xs text-rose-600" onClick={() => setIssues(issues.filter((_, j) => j !== i))}>Remove</button></div>)}
        <button className="text-xs text-brand-600 underline" onClick={() => setIssues([...issues, { severity: "minor", text: "" }])}>Add an issue</button></div>
      <div className="space-y-1.5"><label className="label">Corrective actions</label>
        {actions.map((it, i) => <div key={i} className="flex gap-2"><input className="input" value={it.text} onChange={(e) => setActions(actions.map((x, j) => (j === i ? { text: e.target.value } : x)))} placeholder="What should change" /><button className="text-xs text-rose-600" onClick={() => setActions(actions.filter((_, j) => j !== i))}>Remove</button></div>)}
        <button className="text-xs text-brand-600 underline" onClick={() => setActions([...actions, { text: "" }])}>Add an action</button></div>
      <div><label className="label">Comments</label><textarea className="input min-h-[70px]" value={comments} onChange={(e) => setComments(e.target.value)} /></div>
      {err && <p className="text-sm text-rose-600">{err}</p>}
      <button disabled={busy} onClick={submit} className="btn btn-primary">{busy ? "Submitting…" : "Submit for approval"}</button>
    </div>
  );
}

/** The whole review life-cycle for one call. Which buttons appear comes from the review state; the database still checks every step. */
export function ReviewPanel({ callId, review, drafts, myId, onChanged }: { callId: string; review: ReviewFull | null; drafts: AiDraft[]; myId: string | null; onChanged: () => void }) {
  const [people, setPeople] = useState<Person[]>([]);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const [who, setWho] = useState(""); const [prio, setPrio] = useState("normal"); const [due, setDue] = useState(inDays(7)); const [note, setNote] = useState("");
  const [mode, setMode] = useState<"" | "escalate" | "reassign" | "extend" | "decline" | "reject">("");
  useEffect(() => { fetchPeople().then(setPeople).catch(() => undefined); }, []);
  const run = async (f: () => Promise<unknown>) => { setBusy(true); setErr(null); try { await f(); setMode(""); setNote(""); onChanged(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };
  const mgrs = people.filter((p) => p.is_manager);

  if (!review) return (
    <div className="space-y-3"><p className="text-sm text-slate-600 dark:text-slate-300">This call has not been put forward for review.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div><label className="label">Reviewer</label><select className="input" value={who} onChange={(e) => setWho(e.target.value)}><option value="">Leave unassigned (anyone can take it)</option>{mgrs.map((p) => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}</select></div>
        <div><label className="label">Priority</label><select className="input" value={prio} onChange={(e) => setPrio(e.target.value)}>{Object.entries(PRIORITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div><label className="label">Due</label><input type="date" className="input" value={due} min={inDays(0)} onChange={(e) => setDue(e.target.value)} /></div></div>
      {err && <p className="text-sm text-rose-600">{err}</p>}
      <button disabled={busy} className="btn btn-primary" onClick={() => run(() => assignReview(callId, who || null, prio, due))}>Put forward for review</button></div>
  );

  const mine = review.reviewer_id === myId;
  const s = review.status;
  const overdue = review.due_date && new Date(review.due_date) < new Date(new Date().toDateString()) && ["assigned", "in_review", "rejected"].includes(s);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-slate-100 px-2.5 py-1 font-bold dark:bg-slate-700">{REVIEW_STATUS_LABEL[s] ?? s}</span>
        <span>Priority: <b>{PRIORITY_LABEL[review.priority] ?? review.priority}</b></span>
        <span>Reviewer: <b>{review.reviewer ?? "unassigned"}</b></span>
        {review.due_date && <span className={overdue ? "font-bold text-rose-600" : ""}>Due {fmtDate(review.due_date)}{overdue ? " · overdue" : ""}</span>}
        {review.is_escalated && <span className="flex items-center gap-1 font-bold text-rose-600"><AlertTriangle className="h-3.5 w-3.5" /> Escalated</span>}
      </div>
      {review.escalation_reason && <p className="rounded-lg bg-rose-50 p-2.5 text-xs text-rose-800 dark:bg-rose-500/10 dark:text-rose-200">Escalation reason: {review.escalation_reason}</p>}
      {review.decision_note && <p className="rounded-lg bg-slate-50 p-2.5 text-xs dark:bg-slate-800">Approver note: {review.decision_note}</p>}

      {s === "assigned" && !review.reviewer_id && <button disabled={busy} className="btn btn-primary" onClick={() => run(() => claimReview(review.id))}>Take this review</button>}
      {s === "assigned" && mine && <div className="flex gap-2"><button disabled={busy} className="btn btn-primary" onClick={() => run(() => startReview(review.id))}>Start review</button><button className="btn btn-secondary" onClick={() => setMode("decline")}>Decline it</button></div>}
      {["in_review", "rejected"].includes(s) && mine && <Form review={review} drafts={drafts} onDone={onChanged} />}
      {["in_review", "rejected"].includes(s) && !mine && <p className="text-sm text-slate-500">{review.reviewer ?? "Someone else"} is working on this review.</p>}
      {s === "rejected" && <p className="text-xs text-amber-700">Sent back for changes. Update the answers and submit again.</p>}

      {["pending_approval", "approved", "escalated"].includes(s) && (
        <div className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700">
          <p className="font-bold">{REVIEW_OUTCOME_LABEL[review.outcome ?? ""] ?? review.outcome} {review.score != null && <span className="font-normal text-slate-500">· score {review.score}%</span>}</p>
          <ul className="mt-2 space-y-0.5 text-xs">{CHECKLIST.filter((c) => review.checklist?.[c.key]).map((c) => <li key={c.key} className="flex gap-2"><span className={`w-8 font-bold ${review.checklist![c.key] === "no" ? "text-rose-600" : review.checklist![c.key] === "yes" ? "text-emerald-600" : "text-slate-400"}`}>{review.checklist![c.key].toUpperCase()}</span>{c.label}</li>)}</ul>
          {(review.issues?.length ?? 0) > 0 && <div className="mt-2"><p className="text-xs font-bold">Issues</p><ul className="text-xs">{review.issues!.map((i, k) => <li key={k}>{SEV[i.severity] ?? i.severity}: {i.text}</li>)}</ul></div>}
          {(review.corrective_actions?.length ?? 0) > 0 && <div className="mt-2"><p className="text-xs font-bold">Corrective actions</p><ul className="text-xs">{review.corrective_actions!.map((i, k) => <li key={k}>{i.text}</li>)}</ul></div>}
          {review.comments && <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">{review.comments}</p>}
        </div>
      )}
      {["pending_approval", "escalated"].includes(s) && (
        <div className="space-y-2">
          {mode === "reject" ? (<><label className="label">What needs changing?</label><textarea className="input" value={note} onChange={(e) => setNote(e.target.value)} /><div className="flex gap-2"><button disabled={busy || note.trim().length < 5} className="btn btn-primary" onClick={() => run(() => decideReview(review.id, "reject", note))}>Send back</button><button className="btn btn-secondary" onClick={() => setMode("")}>Cancel</button></div></>)
            : (<div className="flex flex-wrap gap-2"><button disabled={busy} className="btn btn-primary" onClick={() => run(() => decideReview(review.id, "approve", note))}><CheckCircle2 className="h-4 w-4" /> Approve</button><button className="btn btn-secondary" onClick={() => setMode("reject")}>Send back</button>{s !== "escalated" && <button className="btn btn-secondary" onClick={() => setMode("escalate")}>Escalate</button>}</div>)}
          <p className="text-[11px] text-slate-500">A review cannot be approved by the person who wrote it when your firm requires a second approver. The adviser only sees the result once it is approved.</p>
        </div>
      )}

      {mode === "escalate" && <div className="space-y-2"><label className="label">Escalate to</label><select className="input" value={who} onChange={(e) => setWho(e.target.value)}><option value="">Any senior manager</option>{mgrs.map((p) => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}</select><label className="label">Reason</label><textarea className="input" value={note} onChange={(e) => setNote(e.target.value)} /><div className="flex gap-2"><button disabled={busy || note.trim().length < 5} className="btn btn-primary" onClick={() => run(() => escalateReview(review.id, who || null, note))}>Escalate</button><button className="btn btn-secondary" onClick={() => setMode("")}>Cancel</button></div></div>}
      {mode === "reassign" && <div className="space-y-2"><label className="label">New reviewer</label><select className="input" value={who} onChange={(e) => setWho(e.target.value)}><option value="">Choose…</option>{mgrs.map((p) => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}</select><label className="label">Reason</label><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /><div className="flex gap-2"><button disabled={busy || !who || note.trim().length < 5} className="btn btn-primary" onClick={() => run(() => reassignReview(review.id, who, note))}>Reassign</button><button className="btn btn-secondary" onClick={() => setMode("")}>Cancel</button></div></div>}
      {mode === "extend" && <div className="space-y-2"><label className="label">New due date</label><input type="date" className="input" min={inDays(0)} value={due} onChange={(e) => setDue(e.target.value)} /><label className="label">Reason</label><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /><div className="flex gap-2"><button disabled={busy || note.trim().length < 5} className="btn btn-primary" onClick={() => run(() => extendReview(review.id, due, note))}>Extend</button><button className="btn btn-secondary" onClick={() => setMode("")}>Cancel</button></div></div>}
      {mode === "decline" && <div className="space-y-2"><label className="label">Why can you not review this?</label><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /><div className="flex gap-2"><button disabled={busy || note.trim().length < 5} className="btn btn-primary" onClick={() => run(() => declineReview(review.id, note))}>Decline</button><button className="btn btn-secondary" onClick={() => setMode("")}>Cancel</button></div></div>}
      {["assigned", "in_review", "rejected"].includes(s) && !mode && <div className="flex flex-wrap gap-3 text-xs"><button className="text-brand-600 underline" onClick={() => setMode("reassign")}>Reassign</button><button className="text-brand-600 underline" onClick={() => setMode("extend")}>Extend due date</button><button className="text-brand-600 underline" onClick={() => setMode("escalate")}>Escalate</button></div>}
      {err && <p className="text-sm text-rose-600">{err}</p>}
      <details className="text-xs"><summary className="cursor-pointer font-semibold text-slate-500">History ({review.steps.length})</summary>
        <ul className="mt-1.5 space-y-0.5 text-slate-500">{review.steps.map((st, i) => <li key={i}>{fmtWhen(st.at)} · {st.step.replace(/_/g, " ")}{st.by ? ` · ${st.by}` : ""}</li>)}{review.assignments.map((a, i) => <li key={`a${i}`}>{fmtWhen(a.assigned_at)} · assigned to {a.to ?? "?"} ({a.status}){a.reason ? ` · ${a.reason}` : ""}</li>)}</ul></details>
    </div>
  );
}
export const Spinner = () => <Loader2 className="h-5 w-5 animate-spin text-slate-400" />;
