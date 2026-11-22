import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, Loader2, Phone, PhoneIncoming, PhoneMissed, PhoneOutgoing, ShieldAlert } from "lucide-react";
import { MyCoaching } from "@/components/ComplianceScreen";
import { CallRecord } from "@/components/compliance/CallRecord";
import { useSoftphoneOptional } from "@/lib/softphone";
import { useDebtCustomerProfile } from "@/lib/debt-hooks";
import { fetchCalls, fetchCallbacks, fetchCallTimeline, logCall, updateCallback, fmtDuration, fmtWhen, OUTCOME_LABEL, type CallRow, type Callback, type TimelineItem } from "@/lib/call-hooks";

const localNow = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

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

/** Calls for one client: call them from the softphone, see every call with its recording, transcript and review, callbacks, and the full contact timeline. */
export function CallsPanel({ caseId }: { caseId: string }) {
  const sp = useSoftphoneOptional();
  const { data: profile } = useDebtCustomerProfile(caseId);
  const [rows, setRows] = useState<CallRow[] | null>(null);
  const [cbs, setCbs] = useState<Callback[]>([]);
  const [tl, setTl] = useState<TimelineItem[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [view, setView] = useState<"calls" | "timeline">("calls");
  const load = useCallback(() => {
    fetchCalls(caseId).then(setRows).catch((e) => setErr((e as Error).message));
    fetchCallbacks(caseId).then(setCbs).catch(() => undefined);
  }, [caseId]);
  useEffect(() => { setRows(null); setOpen(null); setTl(null); load(); }, [load]);
  useEffect(() => { if (view === "timeline" && !tl) fetchCallTimeline(caseId).then(setTl).catch((e) => setErr((e as Error).message)); }, [view, tl, caseId]);
  // refresh when a call on this screen ends or is wrapped up
  const liveStage = sp?.live?.stage; const pendingCount = sp?.pending.length;
  useEffect(() => { if (sp) load(); }, [liveStage, pendingCount]);   // eslint-disable-line react-hooks/exhaustive-deps
  const phones = [["Mobile", profile?.mobile_phone], ["Home", profile?.landline_phone], ["Work", profile?.work_phone]].filter((p): p is [string, string] => !!p[1]);
  const upcoming = cbs.filter((c) => ["scheduled", "pending"].includes(c.status));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold">Calls</h2>
        <div className="flex flex-wrap gap-2">
          {sp?.enabled && phones.map(([label, n]) => (
            <button key={label} disabled={sp.phase !== "ready" || sp.busy || (!!sp.live && sp.live.stage !== "ended")} onClick={() => sp.dial(caseId, n)} title={sp.phase !== "ready" ? "The phone is not connected" : `Call ${n}`} className="btn btn-primary text-xs"><Phone className="h-3.5 w-3.5" /> Call {label.toLowerCase()} · {n}</button>
          ))}
          {sp?.enabled && phones.length === 0 && <span className="text-xs text-slate-500">Add a phone number to the client profile to call from here.</span>}
          {!adding && <button onClick={() => setAdding(true)} className="btn btn-secondary text-xs">Log a call made elsewhere</button>}
        </div>
      </div>
      {sp?.error && <p className="text-sm text-rose-600">{sp.error}</p>}
      <MyCoaching />
      {upcoming.length > 0 && (
        <div className="panel space-y-1.5 p-3"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Callbacks</p>
          {upcoming.map((c) => <div key={c.id} className="flex flex-wrap items-center gap-2 text-sm"><span className={new Date(c.scheduled_at) < new Date() ? "font-semibold text-rose-600" : ""}>{fmtWhen(c.scheduled_at)}</span><span className="flex-1 text-slate-500">{c.notes ?? c.phone}</span><button className="text-xs text-brand-600 underline" onClick={() => updateCallback(c.id, "completed").then(load)}>Done</button><button className="text-xs text-slate-500 underline" onClick={() => updateCallback(c.id, "cancelled").then(load)}>Cancel</button></div>)}</div>
      )}
      {adding && <LogForm caseId={caseId} onCancel={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />}
      <div className="flex gap-1 border-b border-slate-200 text-sm dark:border-slate-700">{(["calls", "timeline"] as const).map((k) => <button key={k} onClick={() => setView(k)} className={`px-3 py-1.5 font-semibold capitalize ${view === k ? "border-b-2 border-brand-600 text-brand-700" : "text-slate-500"}`}>{k === "calls" ? "Calls" : "Contact timeline"}</button>)}</div>
      {err && <p className="text-sm text-rose-600">{err}</p>}
      {view === "timeline" && (!tl ? <Loader2 className="h-5 w-5 animate-spin text-slate-400" /> : tl.length === 0 ? <p className="panel p-4 text-sm text-slate-500">Nothing yet.</p> : (
        <ul className="panel divide-y divide-slate-100 dark:divide-slate-700">{tl.map((t, i) => <li key={i} className="px-3 py-2 text-sm"><p className="font-semibold">{t.title} <span className="font-normal text-slate-400">· {fmtWhen(t.at)}{t.who ? ` · ${t.who}` : ""}</span></p>{t.body && <p className="text-xs text-slate-500">{t.body}</p>}</li>)}</ul>))}
      {view === "calls" && <>
        {!rows && !err && <Loader2 className="h-5 w-5 animate-spin text-slate-400" />}
        {rows && rows.length === 0 && !adding && <p className="panel p-4 text-sm text-slate-500">No calls for this client yet.</p>}
        {rows && rows.length > 0 && (
          <div className="panel divide-y divide-slate-100 overflow-hidden dark:divide-slate-700">
            {rows.map((r) => {
              const Icon = r.status === "missed" ? PhoneMissed : r.direction === "inbound" ? PhoneIncoming : PhoneOutgoing;
              return (
                <div key={r.id}>
                  <button onClick={() => setOpen(open === r.id ? null : r.id)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-700/40">
                    <Icon className={`h-4 w-4 shrink-0 ${r.status === "missed" ? "text-rose-500" : "text-slate-400"}`} />
                    <div className="min-w-0 flex-1"><p className="text-sm font-semibold">{OUTCOME_LABEL[r.outcome] ?? r.outcome} <span className="font-normal text-slate-400">· {fmtWhen(r.started_at)} · {fmtDuration(r.duration_seconds)}{r.adviser_name ? ` · ${r.adviser_name}` : ""}</span></p>{r.summary && <p className="truncate text-xs text-slate-500">{r.summary}</p>}</div>
                    {r.has_recording && <span className="text-[11px] text-slate-400">●&nbsp;rec</span>}
                    {r.vulnerability_flag && <span title="Vulnerability" className="text-amber-600"><ShieldAlert className="h-4 w-4" /></span>}
                    {r.possible_complaint && <span title="Possible complaint" className="text-rose-600"><AlertTriangle className="h-4 w-4" /></span>}
                    {r.draft_count > 0 && <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-bold text-violet-700">{r.draft_count} to check</span>}
                    {r.reviewed && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700">Reviewed</span>}
                    {open === r.id ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
                  </button>
                  {open === r.id && <div className="border-t border-slate-100 bg-slate-50/60 p-4 dark:border-slate-700 dark:bg-slate-900/30"><CallRecord callId={r.id} onChanged={load} /></div>}
                </div>
              );
            })}
          </div>
        )}
      </>}
    </div>
  );
}
