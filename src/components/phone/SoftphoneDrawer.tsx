import { useEffect, useState } from "react";
import { CalendarClock, ExternalLink, Loader2, Mic, MicOff, Pause, Phone, PhoneCall, PhoneForwarded, PhoneIncoming, PhoneOff, Play, ShieldAlert, StickyNote, UserPlus, Users, X } from "lucide-react";
import { useSoftphone } from "@/lib/softphone";
import {
  NOTE_TAGS, OUTCOME_LABEL, attachCallToCase, completeCallNote, dismissCall, fetchCallTimeline, fetchCallbacks, fmtClock, fmtWhen, updateCallback,
  type Callback, type TimelineItem,
} from "@/lib/call-hooks";
import { supabase } from "@/lib/supabase";
import { WrapUp } from "./WrapUp";

const STATUS_STYLE: Record<string, string> = { available: "bg-emerald-500", busy: "bg-rose-500", on_call: "bg-rose-500", break: "bg-amber-500", offline: "bg-slate-400" };
const STATUS_LABEL: Record<string, string> = { available: "Available", busy: "Busy", on_call: "On a call", break: "On a break", offline: "Offline" };
type Tab = "call" | "wrapup" | "callbacks" | "unmatched" | "team";

function useSeconds(from: number | null, to: number | null) {
  const [, tick] = useState(0);
  useEffect(() => { if (!from || to) return; const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, [from, to]);
  return from ? Math.max(0, Math.floor(((to ?? Date.now()) - from) / 1000)) : 0;
}

function Dialler() {
  const sp = useSoftphone();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ case_id: string; case_number: string; debtor_name: string; phone: string | null }[]>([]);
  useEffect(() => {
    const t = q.trim(); if (t.length < 2) { setHits([]); return; }
    const h = setTimeout(async () => { const { data } = await supabase.rpc("dv_search_clients", { p_q: t }); setHits((data ?? []) as typeof hits); }, 250);
    return () => clearTimeout(h);
  }, [q]);
  const ready = sp.phase === "ready";
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600 dark:text-slate-300">{ready ? "Find a client to call. The call is recorded to their case automatically." : "The phone is not connected, so you cannot place calls."}</p>
      <input className="input" placeholder="Search by name, phone or case number" value={q} onChange={(e) => setQ(e.target.value)} disabled={!ready} />
      <ul className="max-h-64 divide-y divide-slate-100 overflow-auto rounded-lg border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
        {hits.map((h) => (
          <li key={h.case_id} className="flex items-center gap-2 px-3 py-2">
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{h.debtor_name}</p><p className="truncate text-xs text-slate-500">{h.case_number}{h.phone ? ` · ${h.phone}` : ""}</p></div>
            <button disabled={!h.phone || sp.busy} onClick={() => sp.dial(h.case_id, h.phone!)} className="btn btn-primary px-2.5 py-1.5 text-xs"><Phone className="h-3.5 w-3.5" /> Call</button>
          </li>
        ))}
        {q.trim().length >= 2 && hits.length === 0 && <li className="px-3 py-3 text-xs text-slate-500">No clients found.</li>}
      </ul>
      <p className="text-[11px] text-slate-400">Calls are always made against a client, so the record, recording and review all belong to the right case. To call a new number, open the client and use their phone number.</p>
    </div>
  );
}

function Timeline({ caseId }: { caseId: string }) {
  const [items, setItems] = useState<TimelineItem[] | null>(null);
  useEffect(() => { fetchCallTimeline(caseId).then(setItems).catch(() => setItems([])); }, [caseId]);
  if (!items) return <Loader2 className="h-4 w-4 animate-spin text-slate-400" />;
  if (!items.length) return <p className="text-xs text-slate-500">No earlier contact on this case.</p>;
  return <ul className="space-y-1.5">{items.slice(0, 6).map((t, i) => <li key={i} className="text-xs"><span className="font-semibold">{t.title}</span> <span className="text-slate-400">· {fmtWhen(t.at)}{t.who ? ` · ${t.who}` : ""}</span>{t.body && <p className="line-clamp-2 text-slate-500">{t.body}</p>}</li>)}</ul>;
}

function Live({ onOpenCase }: { onOpenCase?: (id: string) => void }) {
  const sp = useSoftphone(); const l = sp.live!; const d = sp.detail;
  const secs = useSeconds(l.connectedAt, l.endedAt);
  const [panel, setPanel] = useState<"" | "transfer" | "add" | "notes" | "context" | "pause">("");
  const [reason, setReason] = useState("");
  const [kind, setKind] = useState("warm");
  const [target, setTarget] = useState(""); const [phone, setPhone] = useState("");
  const [pn, setPn] = useState(""); const [pr, setPr] = useState(""); const [pt, setPt] = useState("adviser");
  const [noteText, setNoteText] = useState(""); const [tag, setTag] = useState("general"); const [fu, setFu] = useState(false); const [due, setDue] = useState("");
  const colleagues = sp.team.filter((t) => ["available", "busy"].includes(t.status) && !(sp.live && t.user_id === (d?.call.adviser_id ?? "")));
  const toggle = (p: typeof panel) => setPanel(panel === p ? "" : p);
  const connected = l.stage === "connected";
  const Btn = ({ on, onClick, icon: I, label, danger, disabled }: { on?: boolean; onClick: () => void; icon: typeof Mic; label: string; danger?: boolean; disabled?: boolean }) => (
    <button disabled={disabled || sp.busy} onClick={onClick} className={`flex flex-col items-center gap-1 rounded-lg border px-2 py-2 text-[11px] font-semibold transition ${danger ? "border-rose-600 bg-rose-600 text-white" : on ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/20" : "border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"} disabled:opacity-50`}><I className="h-4 w-4" />{label}</button>
  );
  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-slate-900 p-4 text-white">
        <p className="text-[11px] uppercase tracking-wide text-slate-400">{l.direction === "inbound" ? "Incoming call" : "Outgoing call"} · {l.stage === "ringing" ? "Ringing…" : l.stage === "ended" ? "Ended" : l.onHold ? "On hold" : "Connected"}</p>
        <p className="mt-1 text-lg font-bold">{l.name ?? (d?.call.caller_name as string | null) ?? l.phone}</p>
        <p className="text-sm text-slate-300">{l.phone}</p>
        <div className="mt-2 flex items-center gap-3 text-xs">
          <span className="font-mono text-base">{fmtClock(secs)}</span>
          <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 ${l.recording === "recording" ? "bg-rose-500/20 text-rose-200" : l.recording === "paused" ? "bg-amber-500/20 text-amber-200" : "bg-slate-700 text-slate-300"}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${l.recording === "recording" ? "animate-pulse bg-rose-400" : l.recording === "paused" ? "bg-amber-300" : "bg-slate-400"}`} />
            {l.recording === "recording" ? "Recording" : l.recording === "paused" ? "Recording paused" : "Not recorded"}
          </span>
        </div>
      </div>
      {l.direction === "outbound" && l.notice && l.stage !== "ended" && <p className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">Tell the client: “{l.notice}”</p>}
      {l.caseId && onOpenCase && <button onClick={() => onOpenCase(l.caseId!)} className="btn btn-secondary w-full text-xs"><ExternalLink className="h-3.5 w-3.5" /> Open client case</button>}
      {!l.caseId && l.stage !== "ended" && <p className="rounded-lg border border-slate-200 p-2.5 text-xs text-slate-600 dark:border-slate-600 dark:text-slate-300">This caller was not matched to a client. You can file the call to the right case afterwards.</p>}

      {l.stage !== "ended" && (
        <>
          <div className="grid grid-cols-4 gap-2">
            <Btn icon={l.muted ? MicOff : Mic} label={l.muted ? "Unmute" : "Mute"} on={l.muted} onClick={sp.toggleMute} disabled={!connected} />
            <Btn icon={l.onHold ? Play : Pause} label={l.onHold ? "Resume" : "Hold"} on={l.onHold} onClick={sp.toggleHold} disabled={!connected} />
            <Btn icon={PhoneForwarded} label="Transfer" on={panel === "transfer"} onClick={() => toggle("transfer")} disabled={!connected} />
            <Btn icon={UserPlus} label="Add" on={panel === "add"} onClick={() => toggle("add")} disabled={!connected} />
            <Btn icon={ShieldAlert} label={l.recording === "paused" ? "Resume rec" : "Pause rec"} on={l.recording === "paused" || panel === "pause"} disabled={!connected || l.recording === "none"} onClick={() => (l.recording === "paused" ? sp.resumeRecording() : toggle("pause"))} />
            <Btn icon={StickyNote} label="Notes" on={panel === "notes"} onClick={() => toggle("notes")} />
            <Btn icon={CalendarClock} label="Context" on={panel === "context"} onClick={() => toggle("context")} disabled={!l.caseId} />
            <Btn icon={PhoneOff} label="End" danger onClick={sp.hangup} />
          </div>
          {panel === "pause" && (
            <div className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-600">
              <label className="label">Why are you pausing the recording?</label>
              <input className="input" placeholder="For example, client is giving card details" value={reason} onChange={(e) => setReason(e.target.value)} />
              <button disabled={reason.trim().length < 5 || sp.busy} onClick={async () => { await sp.pauseRecording(reason); setReason(""); setPanel(""); }} className="btn btn-primary w-full text-xs">Pause recording</button>
              <p className="text-[11px] text-slate-500">The reason and the length of the pause are kept in the call record and shown to compliance.</p>
            </div>
          )}
          {panel === "transfer" && (
            <div className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-600">
              <label className="label">How</label>
              <select className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="warm">Warm — stay on the line while they join</option><option value="cold">Cold — hand the client over and leave</option><option value="supervisor">To a supervisor</option>
              </select>
              <label className="label">To a colleague</label>
              <select className="input" value={target} onChange={(e) => { setTarget(e.target.value); setPhone(""); }}>
                <option value="">Choose…</option>{colleagues.filter((c) => kind !== "supervisor" || /manager/i.test(c.role_name)).map((c) => <option key={c.user_id} value={c.user_id}>{c.name} · {STATUS_LABEL[c.status] ?? c.status}</option>)}
              </select>
              <label className="label">…or to a number</label>
              <input className="input" placeholder="+44…" value={phone} onChange={(e) => { setPhone(e.target.value); setTarget(""); }} />
              <button disabled={sp.busy || (!target && !phone.trim())} onClick={async () => { await sp.transfer(kind, target ? { user: target } : { phone }); setPanel(""); }} className="btn btn-primary w-full text-xs">{sp.busy ? "Transferring…" : "Transfer"}</button>
            </div>
          )}
          {panel === "add" && (
            <div className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-600">
              <div className="grid grid-cols-2 gap-2"><input className="input" placeholder="Name" value={pn} onChange={(e) => setPn(e.target.value)} /><input className="input" placeholder="Role (optional)" value={pr} onChange={(e) => setPr(e.target.value)} /></div>
              <select className="input" value={pt} onChange={(e) => setPt(e.target.value)}><option value="adviser">Adviser</option><option value="supervisor">Supervisor</option><option value="specialist">Specialist</option><option value="external">External</option></select>
              <select className="input" value={target} onChange={(e) => { setTarget(e.target.value); setPhone(""); const c = colleagues.find((x) => x.user_id === e.target.value); if (c && !pn) setPn(c.name); }}><option value="">A colleague…</option>{colleagues.map((c) => <option key={c.user_id} value={c.user_id}>{c.name}</option>)}</select>
              <input className="input" placeholder="…or a number +44…" value={phone} onChange={(e) => { setPhone(e.target.value); setTarget(""); }} />
              <button disabled={sp.busy || !pn.trim() || (!target && !phone.trim())} onClick={async () => { await sp.addParticipant({ name: pn, role: pr, type: pt, user: target || undefined, phone: phone || undefined }); setPn(""); setPr(""); setPhone(""); setTarget(""); setPanel(""); }} className="btn btn-primary w-full text-xs">Add to the call</button>
            </div>
          )}
        </>
      )}
      {panel === "context" && l.caseId && <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-600"><p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-500">Recent contact</p><Timeline caseId={l.caseId} /></div>}
      {(panel === "notes" || (d?.notes.length ?? 0) > 0) && (
        <div className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-600">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Call notes</p>
          <ul className="space-y-1.5">{d?.notes.map((n) => <li key={n.id} className="flex items-start gap-2 text-xs"><span className="rounded bg-slate-100 px-1.5 py-0.5 font-semibold dark:bg-slate-700">{NOTE_TAGS[n.tag] ?? n.tag}</span><span className="flex-1">{n.text}{n.follow_up && <span className="text-slate-400"> · follow up{n.due ? ` by ${n.due}` : ""}</span>}</span>{n.follow_up && !n.completed && <button className="text-brand-600 underline" onClick={() => completeCallNote(n.id).then(sp.reloadDetail)}>Done</button>}</li>)}</ul>
          {panel === "notes" && (
            <>
              <textarea className="input min-h-[60px]" placeholder="What the client said, what you promised…" value={noteText} onChange={(e) => setNoteText(e.target.value)} />
              <div className="flex flex-wrap items-center gap-2"><select className="input !w-auto !py-1 text-xs" value={tag} onChange={(e) => setTag(e.target.value)}>{Object.entries(NOTE_TAGS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={fu} onChange={(e) => setFu(e.target.checked)} /> Needs follow-up</label>{fu && <input type="date" className="input !w-auto !py-1 text-xs" value={due} onChange={(e) => setDue(e.target.value)} />}</div>
              <button disabled={sp.busy || !noteText.trim()} onClick={async () => { await sp.note(noteText, tag, fu, due || null); setNoteText(""); setFu(false); setDue(""); }} className="btn btn-secondary w-full text-xs">Add note</button>
            </>
          )}
        </div>
      )}
      {d && d.participants.length > 0 && (
        <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-600"><p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-500">On the call</p>
          <ul className="space-y-1">{d.participants.map((p) => <li key={p.id} className="flex items-center gap-2 text-xs"><Users className="h-3.5 w-3.5 text-slate-400" /><span className="flex-1">{p.name}{p.role ? ` · ${p.role}` : ""} <span className="text-slate-400">({p.type})</span></span>{!p.left_at && l.stage !== "ended" ? <button className="text-rose-600 underline" onClick={() => sp.removeParticipant(p.id)}>Remove</button> : <span className="text-slate-400">left</span>}</li>)}</ul></div>
      )}
      {l.stage === "ended" && (
        <div className="space-y-3 rounded-lg border border-slate-200 p-3 dark:border-slate-600">
          <p className="text-sm font-bold">Wrap up this call</p>
          {l.caseId ? <WrapUp callId={l.callId} caseId={l.caseId} phone={l.phone} onDone={sp.clearLive} /> : <Unfiled callId={l.callId} onDone={sp.clearLive} />}
        </div>
      )}
    </div>
  );
}

function CasePicker({ onPick, label }: { onPick: (caseId: string) => void; label: string }) {
  const [q, setQ] = useState(""); const [hits, setHits] = useState<{ case_id: string; case_number: string; debtor_name: string }[]>([]);
  useEffect(() => { const t = q.trim(); if (t.length < 2) { setHits([]); return; } const h = setTimeout(async () => { const { data } = await supabase.rpc("dv_search_clients", { p_q: t }); setHits((data ?? []) as typeof hits); }, 250); return () => clearTimeout(h); }, [q]);
  return (
    <div className="space-y-1.5"><input className="input" placeholder="Find the client" value={q} onChange={(e) => setQ(e.target.value)} />
      {hits.slice(0, 5).map((h) => <button key={h.case_id} onClick={() => onPick(h.case_id)} className="flex w-full items-center justify-between rounded-lg border border-slate-200 px-3 py-1.5 text-left text-xs hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-700"><span>{h.debtor_name} · {h.case_number}</span><span className="font-semibold text-brand-600">{label}</span></button>)}</div>
  );
}
function Unfiled({ callId, onDone }: { callId: string; onDone: () => void }) {
  const [err, setErr] = useState<string | null>(null); const [reason, setReason] = useState("");
  return (
    <div className="space-y-2 text-xs"><p className="text-slate-600 dark:text-slate-300">This call was not matched to a client. File it to a case, or dismiss it with a reason.</p>
      <CasePicker label="File here" onPick={(c) => attachCallToCase(callId, c).then(onDone).catch((e) => setErr((e as Error).message))} />
      <div className="flex gap-2"><input className="input" placeholder="Reason, e.g. wrong number" value={reason} onChange={(e) => setReason(e.target.value)} /><button disabled={reason.trim().length < 5} className="btn btn-secondary text-xs" onClick={() => dismissCall(callId, reason).then(onDone).catch((e) => setErr((e as Error).message))}>Dismiss</button></div>
      {err && <p className="text-rose-600">{err}</p>}</div>
  );
}

function Callbacks({ onDial }: { onDial: (caseId: string, phone: string) => void }) {
  const [rows, setRows] = useState<Callback[] | null>(null); const [err, setErr] = useState<string | null>(null);
  const load = () => fetchCallbacks().then(setRows).catch((e) => setErr((e as Error).message));
  useEffect(() => { void load(); }, []);
  if (err) return <p className="text-xs text-rose-600">{err}</p>;
  if (!rows) return <Loader2 className="h-4 w-4 animate-spin text-slate-400" />;
  const open = rows.filter((r) => ["scheduled", "pending"].includes(r.status));
  if (!open.length) return <p className="text-sm text-slate-500">No callbacks waiting.</p>;
  return <ul className="space-y-2">{open.map((r) => (
    <li key={r.id} className="rounded-lg border border-slate-200 p-2.5 text-xs dark:border-slate-600">
      <p className="font-semibold">{r.customer_name ?? r.case_number} <span className={`font-normal ${new Date(r.scheduled_at) < new Date() ? "text-rose-600" : "text-slate-400"}`}>· {fmtWhen(r.scheduled_at)}</span></p>
      {r.notes && <p className="text-slate-500">{r.notes}</p>}
      <div className="mt-1.5 flex gap-2"><button className="btn btn-primary px-2 py-1 text-[11px]" onClick={() => { onDial(r.case_id, r.phone); void updateCallback(r.id, "completed").then(load); }}>Call now</button><button className="btn btn-secondary px-2 py-1 text-[11px]" onClick={() => updateCallback(r.id, "missed").then(load)}>Missed</button><button className="btn btn-secondary px-2 py-1 text-[11px]" onClick={() => updateCallback(r.id, "cancelled").then(load)}>Cancel</button></div>
    </li>))}</ul>;
}

/** The softphone: a drawer available on every screen, plus an incoming-call banner and a floating button showing phone state. */
export function SoftphoneDrawer({ onOpenCase }: { onOpenCase?: (caseId: string) => void }) {
  const sp = useSoftphone();
  const [tab, setTab] = useState<Tab>("call");
  const [wrap, setWrap] = useState<string | null>(null);
  if (!sp.enabled) return null;
  const live = sp.live; const nWrap = sp.pending.length; const nUn = sp.unmatched.length;
  const dot = sp.phase === "ready" ? STATUS_STYLE[sp.presence] ?? "bg-emerald-500" : "bg-slate-400";
  const tabs: [Tab, string, number][] = [["call", live ? "Live call" : "Call", 0], ["wrapup", "Wrap-up", nWrap], ["callbacks", "Callbacks", 0], ["unmatched", "Unmatched", nUn], ["team", "Team", 0]];
  return (
    <>
      {sp.incoming && (
        <div className="fixed bottom-4 right-4 z-[70] w-80 rounded-2xl border border-emerald-300 bg-white p-4 shadow-2xl dark:border-emerald-500/40 dark:bg-slate-800" role="alertdialog" aria-label="Incoming call">
          <div className="flex items-center gap-3"><span className="flex h-10 w-10 animate-pulse items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><PhoneIncoming className="h-5 w-5" /></span>
            <div className="min-w-0"><p className="text-xs font-bold uppercase tracking-wide text-emerald-700">Incoming call</p><p className="truncate font-bold">{sp.incoming.name ?? sp.incoming.phone ?? "Unknown caller"}</p>{sp.incoming.name && <p className="text-xs text-slate-500">{sp.incoming.phone}</p>}</div></div>
          <div className="mt-3 flex gap-2"><button onClick={sp.answer} className="btn btn-primary flex-1"><PhoneCall className="h-4 w-4" /> Answer</button><button onClick={sp.decline} className="btn btn-secondary flex-1"><PhoneOff className="h-4 w-4" /> Decline</button></div>
        </div>
      )}
      {!sp.open && (
        <button onClick={() => sp.setOpen(true)} className="fixed bottom-4 left-4 z-[60] flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold shadow-lg hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800" aria-label="Open phone">
          <span className={`h-2.5 w-2.5 rounded-full ${dot}`} />{live && live.stage !== "ended" ? "On a call" : "Phone"}{nWrap + nUn > 0 && <span className="rounded-full bg-rose-600 px-1.5 text-[10px] text-white">{nWrap + nUn}</span>}
        </button>
      )}
      {sp.open && (
        <aside className="fixed inset-y-0 right-0 z-[65] flex w-full max-w-sm flex-col border-l border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900" aria-label="Phone">
          <header className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
            <span className={`h-2.5 w-2.5 rounded-full ${dot}`} /><p className="flex-1 text-sm font-bold">Phone</p>
            <select value={sp.presence === "on_call" ? "busy" : sp.presence} disabled={sp.phase !== "ready" || sp.busy} onChange={(e) => sp.setStatus(e.target.value)} className="input !w-auto !py-1 text-xs" aria-label="Your status">
              {["available", "busy", "break", "offline"].map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select>
            <button onClick={() => sp.setOpen(false)} className="rounded p-1 hover:bg-slate-100 dark:hover:bg-slate-700" aria-label="Close phone"><X className="h-4 w-4" /></button>
          </header>
          {sp.phase !== "ready" && <p className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">{sp.phase === "connecting" ? "Connecting the phone…" : sp.message ?? "The phone is not connected."}</p>}
          {sp.error && <p className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-700">{sp.error}</p>}
          <nav className="flex border-b border-slate-200 text-xs font-semibold dark:border-slate-700" role="tablist">
            {tabs.map(([k, label, n]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => { setTab(k); setWrap(null); }} className={`flex-1 px-1 py-2 ${tab === k ? "border-b-2 border-brand-600 text-brand-700" : "text-slate-500"}`}>{label}{n > 0 && <span className="ml-1 rounded-full bg-rose-600 px-1.5 text-[10px] text-white">{n}</span>}</button>)}
          </nav>
          <div className="flex-1 overflow-y-auto p-4">
            {tab === "call" && (live ? <Live onOpenCase={onOpenCase} /> : <Dialler />)}
            {tab === "wrapup" && (wrap ? (() => { const p = sp.pending.find((x) => x.id === wrap); return p ? (
              <div className="space-y-2"><button className="text-xs text-brand-600 underline" onClick={() => setWrap(null)}>Back</button><p className="text-sm font-bold">{p.debtor_name} · {p.case_number}</p><WrapUp callId={p.id} caseId={p.case_id} phone={p.phone} onDone={() => { setWrap(null); void sp.refresh(); }} /></div>) : null; })()
              : nWrap === 0 ? <p className="text-sm text-slate-500">Nothing waiting. Every call you took has been wrapped up.</p>
              : <ul className="space-y-2">{sp.pending.map((p) => <li key={p.id}><button onClick={() => setWrap(p.id)} className="w-full rounded-lg border border-slate-200 p-3 text-left text-sm hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-800"><p className="font-semibold">{p.debtor_name} <span className="font-normal text-slate-400">· {p.case_number}</span></p><p className="text-xs text-slate-500">{p.direction === "inbound" ? "Incoming" : "Outgoing"} · {fmtWhen(p.started_at)} · {OUTCOME_LABEL.pending}</p></button></li>)}</ul>)}
            {tab === "callbacks" && <Callbacks onDial={(c, p) => { void sp.dial(c, p); setTab("call"); }} />}
            {tab === "unmatched" && (nUn === 0 ? <p className="text-sm text-slate-500">No calls waiting to be matched to a client.</p> : (
              <ul className="space-y-3">{sp.unmatched.map((u) => <li key={u.id} className="space-y-1.5 rounded-lg border border-slate-200 p-3 text-xs dark:border-slate-600"><p className="font-semibold">{u.phone ?? "Withheld number"} <span className="font-normal text-slate-400">· {u.direction} · {fmtWhen(u.started_at)}</span></p>
                <Unfiled callId={u.id} onDone={() => void sp.refresh()} /></li>)}</ul>))}
            {tab === "team" && (
              <ul className="space-y-1.5">{sp.team.map((t) => <li key={t.user_id} className="flex items-center gap-2 text-sm"><span className={`h-2.5 w-2.5 rounded-full ${STATUS_STYLE[t.status] ?? "bg-slate-400"}`} /><span className="flex-1">{t.name}<span className="text-xs text-slate-400"> · {t.role_name}</span></span><span className="text-xs text-slate-500">{STATUS_LABEL[t.status] ?? t.status}</span></li>)}{sp.team.length === 0 && <p className="text-sm text-slate-500">No one has set a status yet.</p>}</ul>
            )}
          </div>
        </aside>
      )}
    </>
  );
}
