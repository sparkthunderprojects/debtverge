import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, Loader2, Phone, PhoneIncoming, PhoneMissed, PhoneOutgoing, ShieldAlert } from "lucide-react";
import { MyCoaching } from "@/components/ComplianceScreen";
import { fetchCalls, fetchCallDetail, logCall, decideDraft, OUTCOME_LABEL, REVIEW_OUTCOME_LABEL, type CallRow, type CallDetail, type AiDraft } from "@/lib/call-hooks";

const when = (s: string) => new Date(s).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const mins = (s: number) => (s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60 ? `${s % 60}s` : ""}`.trim());
const localNow = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
const EVENT_TEXT: Record<string, string> = { logged: "Call logged", ai_draft_decided: "AI draft decided", review_started: "Review started", review_completed: "Review completed" };

function DraftCard({ d, canDecide, onDone }: { d: AiDraft; canDecide: boolean; onDone: () => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(d.body);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async (decision: "approve" | "amend" | "reject") => {
    setBusy(true); setErr(null);
    try { await decideDraft(d.id, decision, decision === "amend" ? text : undefined); onDone(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="rounded-lg border border-violet-200 bg-violet-50/60 p-3 dark:border-violet-500/30 dark:bg-violet-500/10">
      <p className="text-[11px] font-bold uppercase tracking-wide text-violet-700 dark:text-violet-300">
        AI {d.kind} {d.status === "draft" ? "· draft, not yet checked by a person" : `· ${d.status}`} · {d.model}{d.model_version ? ` ${d.model_version}` : ""}
      </p>
      {editing ? <textarea className="input mt-2 min-h-[120px]" value={text} onChange={(e) => setText(e.target.value)} /> : <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">{d.status === "amended" || d.status === "approved" ? d.final_body ?? d.body : d.body}</p>}
      {err && <p className="mt-1 text-xs text-rose-600">{err}</p>}
      {d.status === "draft" && canDecide && (
        <div className="mt-2 flex flex-wrap gap-2">
          {editing ? (
            <><button disabled={busy} onClick={() => run("amend")} className="btn btn-primary px-3 py-1.5 text-xs">Save corrected text</button><button onClick={() => { setEditing(false); setText(d.body); }} className="btn btn-secondary px-3 py-1.5 text-xs">Cancel</button></>
          ) : (
            <><button disabled={busy} onClick={() => run("approve")} className="btn btn-primary px-3 py-1.5 text-xs">It is correct</button><button onClick={() => setEditing(true)} className="btn btn-secondary px-3 py-1.5 text-xs">Correct it</button><button disabled={busy} onClick={() => run("reject")} className="btn btn-secondary px-3 py-1.5 text-xs">Throw it away</button></>
          )}
        </div>
      )}
    </div>
  );
}

function Detail({ id, onChanged }: { id: string; onChanged: () => void }) {
  const [d, setD] = useState<CallDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => { fetchCallDetail(id).then(setD).catch((e) => setErr((e as Error).message)); }, [id]);
  useEffect(load, [load]);
  if (err) return <p className="p-3 text-xs text-rose-600">{err}</p>;
  if (!d) return <div className="p-3"><Loader2 className="h-4 w-4 animate-spin text-slate-400" /></div>;
  return (
    <div className="space-y-3 border-t border-slate-100 bg-slate-50/60 p-3 dark:border-slate-700 dark:bg-slate-900/30">
      {d.call.summary && <p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">{d.call.summary}</p>}
      <p className="text-xs text-slate-500">
        {d.call.recording_status === "none" ? "No recording was made for this call." : `Recording: ${d.call.recording_status}.`}{" "}
        {d.call.recording_notice_given === true ? "The client was told the call may be recorded." : d.call.recording_notice_given === false ? "The client was not told the call may be recorded." : ""}
      </p>
      {d.drafts.map((x) => <DraftCard key={x.id} d={x} canDecide onDone={() => { load(); onChanged(); }} />)}
      {d.review && d.review.status === "completed" && (
        <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm dark:border-slate-700 dark:bg-slate-800">
          <p className="font-semibold">Call review: {REVIEW_OUTCOME_LABEL[d.review.outcome ?? ""] ?? d.review.outcome}</p>
          {d.review.coaching_action && <p className="mt-1 text-slate-600 dark:text-slate-300">Coaching: {d.review.coaching_action}{d.review.coaching_due ? ` (by ${new Date(d.review.coaching_due).toLocaleDateString("en-GB")})` : ""}</p>}
        </div>
      )}
      <ul className="space-y-0.5 text-[11px] text-slate-400">
        {d.events.map((e, i) => <li key={i}>{when(e.at)} · {EVENT_TEXT[e.event] ?? e.event}{e.by ? ` · ${e.by}` : ""}</li>)}
      </ul>
    </div>
  );
}

function LogForm({ caseId, onSaved, onCancel }: { caseId: string; onSaved: () => void; onCancel: () => void }) {
  const [direction, setDirection] = useState<"inbound" | "outbound">("outbound");
  const [phone, setPhone] = useState("");
  const [startedAt, setStartedAt] = useState(localNow());
  const [minutes, setMinutes] = useState("5");
  const [outcome, setOutcome] = useState("spoke_to_client");
  const [summary, setSummary] = useState("");
  const [notice, setNotice] = useState<"yes" | "no" | "">("");
  const [vuln, setVuln] = useState(false);
  const [complaint, setComplaint] = useState(false);
  const [followUp, setFollowUp] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const spoke = outcome === "spoke_to_client";
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      await logCall({ caseId, direction, phone, startedAt: new Date(startedAt).toISOString(), durationSeconds: Math.max(0, Math.round(Number(minutes || 0) * 60)), outcome, summary,
        noticeGiven: spoke ? (notice === "" ? null : notice === "yes") : null, vulnerability: vuln, possibleComplaint: complaint, followUp: followUp || null });
      onSaved();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="panel space-y-3 p-4">
      <p className="text-sm font-bold">Log a call</p>
      <div className="grid gap-3 sm:grid-cols-4">
        <div><label className="label">Direction</label><select className="input" value={direction} onChange={(e) => setDirection(e.target.value as "inbound" | "outbound")}><option value="outbound">We called</option><option value="inbound">They called</option></select></div>
        <div><label className="label">Number</label><div className="flex gap-1"><input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="07…" />{phone.trim() && <a href={`tel:${phone.replace(/[^+\d]/g, "")}`} className="btn btn-secondary px-2.5" title="Open in your phone app"><Phone className="h-4 w-4" /></a>}</div></div>
        <div><label className="label">When</label><input type="datetime-local" className="input" value={startedAt} max={localNow()} onChange={(e) => setStartedAt(e.target.value)} /></div>
        <div><label className="label">Minutes</label><input type="number" min="0" className="input" value={minutes} onChange={(e) => setMinutes(e.target.value)} /></div>
      </div>
      <div><label className="label">What happened</label><select className="input" value={outcome} onChange={(e) => setOutcome(e.target.value)}>{Object.entries(OUTCOME_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
      <div><label className="label">Summary</label><textarea className="input min-h-[80px]" value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="What was discussed and agreed" /></div>
      {spoke && (
        <div><label className="label">Did you tell the client the call may be recorded?</label>
          <div className="flex gap-4 text-sm"><label className="flex items-center gap-1.5"><input type="radio" checked={notice === "yes"} onChange={() => setNotice("yes")} /> Yes</label><label className="flex items-center gap-1.5"><input type="radio" checked={notice === "no"} onChange={() => setNotice("no")} /> No</label></div></div>
      )}
      <div className="flex flex-wrap gap-5 text-sm">
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={vuln} onChange={(e) => setVuln(e.target.checked)} /> Vulnerability came up</label>
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={complaint} onChange={(e) => setComplaint(e.target.checked)} /> Possible complaint</label>
        <label className="flex items-center gap-1.5">Follow up on <input type="date" className="input !w-auto !py-1" value={followUp} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setFollowUp(e.target.value)} /></label>
      </div>
      {err && <p className="text-sm text-rose-600">{err}</p>}
      <div className="flex gap-2"><button disabled={busy} onClick={submit} className="btn btn-primary">{busy ? "Saving…" : "Save call"}</button><button onClick={onCancel} className="btn btn-secondary">Cancel</button></div>
    </div>
  );
}

/** Calls for one client: the log, what was said, flags, and any AI-drafted notes waiting for a person to check them. */
export function CallsPanel({ caseId }: { caseId: string }) {
  const [rows, setRows] = useState<CallRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(() => { fetchCalls(caseId).then(setRows).catch((e) => setErr((e as Error).message)); }, [caseId]);
  useEffect(() => { setRows(null); setOpen(null); load(); }, [load]);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold">Calls</h2>
        {!adding && <button onClick={() => setAdding(true)} className="btn btn-primary text-xs"><Phone className="h-3.5 w-3.5" /> Log a call</button>}
      </div>
      <MyCoaching />
      {adding && <LogForm caseId={caseId} onCancel={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />}
      {err && <p className="text-sm text-rose-600">{err}</p>}
      {!rows && !err && <Loader2 className="h-5 w-5 animate-spin text-slate-400" />}
      {rows && rows.length === 0 && !adding && <p className="panel p-4 text-sm text-slate-500">No calls logged for this client yet.</p>}
      {rows && rows.length > 0 && (
        <div className="panel divide-y divide-slate-100 overflow-hidden dark:divide-slate-700">
          {rows.map((r) => {
            const Icon = r.status === "missed" ? PhoneMissed : r.direction === "inbound" ? PhoneIncoming : PhoneOutgoing;
            return (
              <div key={r.id}>
                <button onClick={() => setOpen(open === r.id ? null : r.id)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-700/40">
                  <Icon className={`h-4 w-4 shrink-0 ${r.status === "missed" ? "text-rose-500" : "text-slate-400"}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{OUTCOME_LABEL[r.outcome] ?? r.outcome} <span className="font-normal text-slate-400">· {when(r.started_at)} · {mins(r.duration_seconds)}{r.adviser_name ? ` · ${r.adviser_name}` : ""}</span></p>
                    {r.summary && <p className="truncate text-xs text-slate-500">{r.summary}</p>}
                  </div>
                  {r.vulnerability_flag && <span title="Vulnerability" className="text-amber-600"><ShieldAlert className="h-4 w-4" /></span>}
                  {r.possible_complaint && <span title="Possible complaint" className="text-rose-600"><AlertTriangle className="h-4 w-4" /></span>}
                  {r.draft_count > 0 && <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-bold text-violet-700">{r.draft_count} to check</span>}
                  {r.reviewed && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700">Reviewed</span>}
                  {open === r.id ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
                </button>
                {open === r.id && <Detail id={r.id} onChanged={load} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
