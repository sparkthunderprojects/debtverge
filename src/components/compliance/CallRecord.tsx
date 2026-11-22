import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Download, Loader2, PhoneIncoming, PhoneOutgoing, Play, ShieldAlert, Sparkles } from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  CALL_STATUS_LABEL, NOTE_TAGS, OUTCOME_LABEL, RISK_TYPES, analyseCall, decideDraft, fetchCallDetail, fetchTranscript, fmtDuration, fmtWhen, raiseRisk, recordingLink, resolveRisk,
  type AiDraft, type CallDetail, type ReviewFull,
} from "@/lib/call-hooks";
import { ReviewPanel } from "./ReviewPanel";

type Tab = "overview" | "recording" | "transcript" | "ai" | "review";
const EVENT_TEXT: Record<string, string> = {
  logged: "Call logged", created: "Call started", answered: "Answered", completed: "Call ended", transfer_started: "Transfer started", transfer_completed: "Transfer completed", transfer_failed: "Transfer failed",
  hold: "Put on hold", resume: "Taken off hold", recording_paused: "Recording paused", recording_resumed: "Recording resumed", participant_joined: "Someone joined", participant_left: "Someone left",
  ai_draft_created: "AI draft created", ai_draft_decided: "AI draft decided", wrapped_up: "Wrapped up", dismissed: "Dismissed", attached_to_case: "Filed to a case",
};
const SEV_STYLE: Record<string, string> = { low: "bg-slate-100 text-slate-700", medium: "bg-amber-100 text-amber-800", high: "bg-orange-100 text-orange-800", critical: "bg-rose-100 text-rose-800" };

function DraftCard({ d, canDecide, onDone }: { d: AiDraft; canDecide: boolean; onDone: () => void }) {
  const [editing, setEditing] = useState(false); const [text, setText] = useState(d.body);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const run = async (decision: "approve" | "amend" | "reject") => { setBusy(true); setErr(null); try { await decideDraft(d.id, decision, decision === "amend" ? text : undefined); onDone(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };
  let analysis: Record<string, unknown> | null = null;
  if (d.kind === "analysis" && d.payload) { try { analysis = JSON.parse(d.payload); } catch { analysis = null; } }
  return (
    <div className="rounded-lg border border-violet-200 bg-violet-50/60 p-3 dark:border-violet-500/30 dark:bg-violet-500/10">
      <p className="text-[11px] font-bold uppercase tracking-wide text-violet-700 dark:text-violet-300">AI {d.kind} {d.status === "draft" ? "· draft, not yet checked by a person" : `· ${d.status}`} · {d.model}{d.confidence != null ? ` · confidence ${Math.round(d.confidence * 100)}%` : ""}</p>
      {d.kind === "analysis" && analysis ? (
        <div className="mt-2 space-y-2 text-sm text-slate-700 dark:text-slate-200">
          <p><b>Topics:</b> {((analysis.topics as string[]) ?? []).join(", ") || "none stated"} · <b>Client sentiment:</b> {String(analysis.customer_sentiment ?? "not stated")}</p>
          {((analysis.vulnerability_indicators as { quote: string; note: string }[]) ?? []).length > 0 && <div><b>Possible vulnerability</b><ul className="list-disc pl-5 text-xs">{(analysis.vulnerability_indicators as { quote: string; note: string }[]).map((v, i) => <li key={i}>“{v.quote}” — {v.note}</li>)}</ul></div>}
          {Boolean(analysis.possible_complaint) && <p className="text-rose-700"><b>Possible complaint:</b> {String(analysis.possible_complaint_note ?? "")}</p>}
          {((analysis.follow_ups as string[]) ?? []).length > 0 && <div><b>Follow-ups</b><ul className="list-disc pl-5 text-xs">{(analysis.follow_ups as string[]).map((f, i) => <li key={i}>{f}</li>)}</ul></div>}
          <p className="text-[11px] text-slate-500">Suggested checklist answers appear beside each question when a reviewer completes the review. They are hints only.</p>
        </div>
      ) : editing ? <textarea className="input mt-2 min-h-[120px]" value={text} onChange={(e) => setText(e.target.value)} />
        : <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">{d.status === "amended" || d.status === "approved" ? d.final_body ?? d.body : d.body}</p>}
      {err && <p className="mt-1 text-xs text-rose-600">{err}</p>}
      {d.status === "draft" && canDecide && (
        <div className="mt-2 flex flex-wrap gap-2">
          {editing ? <><button disabled={busy} onClick={() => run("amend")} className="btn btn-primary px-3 py-1.5 text-xs">Save corrected text</button><button onClick={() => { setEditing(false); setText(d.body); }} className="btn btn-secondary px-3 py-1.5 text-xs">Cancel</button></>
            : <><button disabled={busy} onClick={() => run("approve")} className="btn btn-primary px-3 py-1.5 text-xs">It is correct</button>{d.kind !== "analysis" && <button onClick={() => setEditing(true)} className="btn btn-secondary px-3 py-1.5 text-xs">Correct it</button>}<button disabled={busy} onClick={() => run("reject")} className="btn btn-secondary px-3 py-1.5 text-xs">Throw it away</button></>}
        </div>
      )}
    </div>
  );
}

function Recording({ d }: { d: CallDetail }) {
  const [url, setUrl] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const load = async (download: boolean) => { setBusy(true); setErr(null); try { const r = await recordingLink(d.call.id, download); if (download) { const a = document.createElement("a"); a.href = r.url; a.rel = "noopener"; a.click(); } else setUrl(r.url); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };
  if (!d.has_recording) return <p className="text-sm text-slate-500">{d.call.recording_status === "pending" ? "The recording is still being prepared." : d.call.recording_status === "failed" ? "The recording failed and is not available." : "No recording was made for this call."}</p>;
  return (
    <div className="space-y-3">
      {d.can_hear ? (url ? <audio controls autoPlay src={url} className="w-full" controlsList="nodownload" /> : <button disabled={busy} onClick={() => load(false)} className="btn btn-primary"><Play className="h-4 w-4" /> {busy ? "Opening…" : "Play recording"}</button>) : <p className="text-sm text-slate-500">You do not have access to listen to this recording.</p>}
      {d.can_download && <button disabled={busy} onClick={() => load(true)} className="btn btn-secondary text-xs"><Download className="h-3.5 w-3.5" /> Download</button>}
      {err && <p className="text-sm text-rose-600">{err}</p>}
      <p className="text-[11px] text-slate-500">Every time a recording is played or downloaded it is written to the access log. Links expire after five minutes.</p>
      {d.recording_events.length > 0 && <div><p className="text-xs font-bold">Pauses during the call</p><ul className="mt-1 space-y-0.5 text-xs text-slate-600 dark:text-slate-300">{d.recording_events.map((e, i) => <li key={i}>{fmtWhen(e.at)} · recording {e.event}{e.reason ? ` · ${e.reason}` : ""}{e.seconds ? ` · paused for ${fmtDuration(e.seconds)}` : ""}</li>)}</ul></div>}
    </div>
  );
}

function Transcript({ d }: { d: CallDetail }) {
  const [t, setT] = useState<{ body: string; language: string | null; confidence: number | null } | null | undefined>(undefined);
  const [q, setQ] = useState(""); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (d.has_transcript && d.can_read_transcript) fetchTranscript(d.call.id).then(setT).catch((e) => setErr((e as Error).message)); else setT(null); }, [d.call.id, d.has_transcript, d.can_read_transcript]);
  const lines = useMemo(() => (t?.body ?? "").split("\n").filter(Boolean), [t]);
  if (err) return <p className="text-sm text-rose-600">{err}</p>;
  if (t === undefined) return <Loader2 className="h-5 w-5 animate-spin text-slate-400" />;
  if (!t) return <p className="text-sm text-slate-500">{d.has_transcript ? "You do not have access to this transcript." : "There is no transcript for this call. Transcripts come from the carrier's speech-to-text after a recorded call, and only when your firm has switched transcription on."}</p>;
  const shown = q.trim() ? lines.filter((l) => l.toLowerCase().includes(q.toLowerCase())) : lines;
  return (
    <div className="space-y-2"><input className="input" placeholder="Search within the transcript" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="max-h-[420px] space-y-1.5 overflow-auto rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700">{shown.map((l, i) => { const [who, ...rest] = l.split(": "); return <p key={i}><b className={who === "Customer" ? "text-brand-700" : "text-slate-700 dark:text-slate-200"}>{who}</b>: {rest.join(": ")}</p>; })}{shown.length === 0 && <p className="text-slate-500">Nothing matches.</p>}</div>
      <p className="text-[11px] text-slate-500">Machine transcript{t.language ? ` (${t.language})` : ""}. It can contain mistakes; the recording is the record of what was said.</p></div>
  );
}

/** One call, everything about it. Advisers see their own call and the approved review; compliance managers see the full review trail. */
export function CallRecord({ callId, onChanged, initialTab = "overview" }: { callId: string; onChanged?: () => void; initialTab?: Tab }) {
  const { user } = useAuth();
  const [d, setD] = useState<CallDetail | null>(null); const [err, setErr] = useState<string | null>(null); const [tab, setTab] = useState<Tab>(initialTab);
  const [aiMsg, setAiMsg] = useState<string | null>(null); const [aiBusy, setAiBusy] = useState(false);
  const [rk, setRk] = useState({ type: "other", severity: "medium", description: "" }); const [resolve, setResolve] = useState<{ id: string; note: string } | null>(null);
  const load = useCallback(() => { fetchCallDetail(callId).then(setD).catch((e) => setErr((e as Error).message)); }, [callId]);
  useEffect(() => { setD(null); setErr(null); load(); }, [load]);
  const changed = () => { load(); onChanged?.(); };
  if (err) return <p className="p-4 text-sm text-rose-600">{err}</p>;
  if (!d) return <div className="p-4"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>;
  const c = d.call; const mgr = d.is_compliance_manager; const Icon = c.direction === "inbound" ? PhoneIncoming : PhoneOutgoing;
  const review = d.review as ReviewFull | null; const adviserReview = !mgr ? (d.review as { status: string; outcome: string | null; score: number | null; issues: { severity: string; text: string }[] | null; corrective_actions: { text: string }[] | null } | null) : null;
  const tabs: [Tab, string][] = [["overview", "Overview"], ["recording", "Recording"], ["transcript", "Transcript"], ["ai", `AI analysis${d.drafts.length ? ` (${d.drafts.length})` : ""}`], ...(mgr ? [["review", "Review"] as [Tab, string]] : [])];
  const runAi = async () => { setAiBusy(true); setAiMsg(null); try { const r = await analyseCall(callId); setAiMsg(r.status === "ok" ? "Drafts created. They are not part of the record until a person checks them." : "Nothing was created."); changed(); } catch (e) { setAiMsg((e as Error).message); } finally { setAiBusy(false); } };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3"><Icon className="h-5 w-5 text-slate-400" />
        <div className="min-w-0 flex-1"><p className="font-bold">{c.direction === "inbound" ? "Incoming" : "Outgoing"} call · {c.phone ?? "withheld"}{c.caller_name ? ` · ${c.caller_name}` : ""}</p><p className="text-xs text-slate-500">{fmtWhen(c.started_at)} · {fmtDuration(c.duration_seconds)} · {CALL_STATUS_LABEL[c.status] ?? c.status} · {OUTCOME_LABEL[c.outcome] ?? c.outcome}</p></div>
        {c.vulnerability_flag && <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800"><ShieldAlert className="h-3.5 w-3.5" /> Vulnerability</span>}
        {c.possible_complaint && <span className="flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-bold text-rose-800"><AlertTriangle className="h-3.5 w-3.5" /> Possible complaint</span>}
        {c.recording_notice_given === false && <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-bold text-rose-800">No recording notice</span>}
      </div>
      <nav className="flex gap-1 border-b border-slate-200 text-sm dark:border-slate-700" role="tablist">{tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`px-3 py-2 font-semibold ${tab === k ? "border-b-2 border-brand-600 text-brand-700" : "text-slate-500"}`}>{l}</button>)}</nav>

      {tab === "overview" && (
        <div className="space-y-4">
          {c.summary ? <p className="whitespace-pre-wrap text-sm">{c.summary}</p> : <p className="text-sm text-slate-500">No summary was written for this call.</p>}
          {adviserReview && adviserReview.status === "approved" && <div className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700"><p className="font-bold">Review result: {adviserReview.outcome ? OUTCOME_REVIEW(adviserReview.outcome) : ""} {adviserReview.score != null && <span className="font-normal text-slate-500">· {adviserReview.score}%</span>}</p>{(adviserReview.corrective_actions?.length ?? 0) > 0 && <ul className="mt-1 list-disc pl-5 text-xs">{adviserReview.corrective_actions!.map((a, i) => <li key={i}>{a.text}</li>)}</ul>}</div>}
          {d.participants.length > 0 && <div><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Who was on the call</p><ul className="mt-1 text-sm">{d.participants.map((p) => <li key={p.id}>{p.name}{p.role ? ` · ${p.role}` : ""} <span className="text-xs text-slate-400">({p.type})</span></li>)}</ul></div>}
          {c.transfer_kind && <p className="text-sm">Transferred ({c.transfer_kind}) to {c.transfer_target}.</p>}
          {d.notes.length > 0 && <div><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Notes taken during the call</p><ul className="mt-1 space-y-1 text-sm">{d.notes.map((n) => <li key={n.id}><span className="mr-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold dark:bg-slate-700">{NOTE_TAGS[n.tag] ?? n.tag}</span>{n.text}{n.follow_up && <span className="text-xs text-slate-400"> · follow-up{n.completed ? " done" : n.due ? ` by ${n.due}` : ""}</span>}</li>)}</ul></div>}
          {d.callbacks.length > 0 && <p className="text-sm">Callbacks: {d.callbacks.map((b) => `${fmtWhen(b.scheduled_at)} (${b.status})`).join(", ")}</p>}
          {mgr && (
            <div className="space-y-2"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Risk indicators</p>
              {d.risks.length === 0 && <p className="text-sm text-slate-500">None raised.</p>}
              {d.risks.map((r) => <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 p-2 text-sm dark:border-slate-700"><span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${SEV_STYLE[r.severity] ?? ""}`}>{r.severity}</span><b>{RISK_TYPES[r.type] ?? r.type}</b><span className="flex-1">{r.description}</span>{r.status === "open" ? (resolve?.id === r.id ? <><input className="input !w-48 !py-1 text-xs" placeholder="How it was resolved" value={resolve.note} onChange={(e) => setResolve({ id: r.id, note: e.target.value })} /><button className="btn btn-primary px-2 py-1 text-xs" disabled={resolve.note.trim().length < 5} onClick={() => resolveRisk(r.id, resolve.note).then(() => { setResolve(null); changed(); })}>Resolve</button></> : <button className="text-xs text-brand-600 underline" onClick={() => setResolve({ id: r.id, note: "" })}>Resolve</button>) : <span className="text-xs text-emerald-700">resolved</span>}</div>)}
              <div className="flex flex-wrap gap-2"><select className="input !w-auto !py-1 text-xs" value={rk.type} onChange={(e) => setRk({ ...rk, type: e.target.value })}>{Object.entries(RISK_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select><select className="input !w-auto !py-1 text-xs" value={rk.severity} onChange={(e) => setRk({ ...rk, severity: e.target.value })}>{["low", "medium", "high", "critical"].map((s) => <option key={s}>{s}</option>)}</select><input className="input !py-1 text-xs" style={{ flex: 1, minWidth: 180 }} placeholder="What is the concern?" value={rk.description} onChange={(e) => setRk({ ...rk, description: e.target.value })} /><button className="btn btn-secondary px-3 py-1 text-xs" disabled={rk.description.trim().length < 5} onClick={() => raiseRisk(callId, rk.type, rk.severity, rk.description).then(() => { setRk({ ...rk, description: "" }); changed(); })}>Raise risk</button></div>
            </div>
          )}
          <details className="text-xs"><summary className="cursor-pointer font-semibold text-slate-500">Call history ({d.events.length})</summary><ul className="mt-1.5 space-y-0.5 text-slate-500">{d.events.map((e, i) => <li key={i}>{fmtWhen(e.at)} · {EVENT_TEXT[e.event] ?? e.event.replace(/_/g, " ")}{e.by ? ` · ${e.by}` : ""}</li>)}</ul></details>
        </div>
      )}
      {tab === "recording" && <Recording d={d} />}
      {tab === "transcript" && <Transcript d={d} />}
      {tab === "ai" && (
        <div className="space-y-3">
          {d.drafts.length === 0 && <p className="text-sm text-slate-500">No AI drafts for this call. Drafts are only made from a real transcript, and only when your firm has switched AI analysis on.</p>}
          {d.drafts.map((x) => <DraftCard key={x.id} d={x} canDecide={mgr || c.adviser_id === user?.id} onDone={changed} />)}
          {mgr && d.has_transcript && <div><button disabled={aiBusy} onClick={runAi} className="btn btn-secondary text-xs"><Sparkles className="h-3.5 w-3.5" /> {aiBusy ? "Analysing…" : "Draft a summary and analysis"}</button>{aiMsg && <p className="mt-1 text-xs text-slate-600">{aiMsg}</p>}</div>}
          <p className="text-[11px] text-slate-500">AI drafts never change the record, a score or a review by themselves. A person reads each one and approves it, corrects it or throws it away.</p>
        </div>
      )}
      {tab === "review" && mgr && <ReviewPanel callId={callId} review={review} drafts={d.drafts} myId={user?.id ?? null} onChanged={changed} />}
    </div>
  );
}
const OUTCOME_REVIEW = (o: string) => ({ compliant: "Compliant", minor_issues: "Minor issues", major_issues: "Major issues", non_compliant: "Non-compliant" } as Record<string, string>)[o] ?? o;
