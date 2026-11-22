import { useState } from "react";
import { Loader2, Pin, PinOff, Search, StickyNote, History, EyeOff } from "lucide-react";
import { useCaseNotes, searchNotes, addNote, editNote, withdrawNote, pinNote, noteHistory, NOTE_KINDS, QUICK_PHRASES, type CaseNote, type NoteKind, type LinkType, type NoteSearchHit, type NoteVersion } from "../../lib/notes-hooks";
import { useDebtCreditors } from "../../lib/debt-hooks";
import { useComplaints } from "../../lib/complaint-hooks";
import { useCaseDocuments } from "../../lib/document-hooks";

const when = (s: string) => new Date(s).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const kindLabel = (k: string) => NOTE_KINDS.find((x) => x.key === k)?.label ?? k;

/** Customer notes: typed, pinnable, searchable, linkable. Notes are never deleted; a withdrawn note keeps its text and the reason. */
export function NotesTab({ caseId }: { caseId: string }) {
  const [filter, setFilter] = useState<NoteKind | "all">("all");
  const [q, setQ] = useState("");
  const [firmWide, setFirmWide] = useState(false);
  const { notes, loading, error, reload } = useCaseNotes(caseId, filter, firmWide ? "" : q);
  const [err, setErr] = useState<string | null>(null);
  const [hits, setHits] = useState<NoteSearchHit[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<void>) {
    setBusy(true); setErr(null);
    try { await fn(); await reload(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  async function doFirmSearch(e: React.FormEvent) {
    e.preventDefault();
    if (q.trim().length < 2) return;
    setBusy(true); setErr(null);
    try { setHits(await searchNotes(q.trim(), filter)); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  }
  const pinned = notes.filter((n) => n.pinned && !n.withdrawn_at);
  const rest = notes.filter((n) => !(n.pinned && !n.withdrawn_at));

  return (
    <div className="space-y-3">
      <NoteComposer caseId={caseId} busy={busy} onSave={(n) => run(() => addNote(n))} />
      <div className="panel space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <StickyNote className="h-4 w-4 text-emerald-600" /><h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Notes</h3>
          <form onSubmit={firmWide ? doFirmSearch : (e) => e.preventDefault()} className="ml-auto flex items-center gap-2">
            <div className="relative"><Search className="absolute left-2 top-2 h-3.5 w-3.5 text-slate-400" /><input value={q} onChange={(e) => { setQ(e.target.value); if (firmWide) setHits(null); }} placeholder={firmWide ? "Search every case you can access" : "Search this case"} className="input w-56 pl-7 text-xs" /></div>
            <label className="flex items-center gap-1 text-[11px] text-slate-500"><input type="checkbox" checked={firmWide} onChange={(e) => { setFirmWide(e.target.checked); setHits(null); }} />All cases</label>
            {firmWide && <button className="btn text-xs" disabled={busy || q.trim().length < 2}>Search</button>}
          </form>
        </div>
        <div className="flex flex-wrap gap-1">
          <button onClick={() => setFilter("all")} className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${filter === "all" ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300"}`}>All</button>
          {NOTE_KINDS.map((k) => <button key={k.key} onClick={() => setFilter(k.key)} className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${filter === k.key ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300"}`}>{k.label}</button>)}
        </div>
        {(err || error) && <p className="text-xs text-rose-600">{err ?? error}</p>}
        {firmWide ? (
          <div className="space-y-2">
            {hits === null && <p className="text-xs text-slate-400">Type at least 2 characters and press Search. Only cases you are allowed to see are searched.</p>}
            {hits?.length === 0 && <p className="text-sm text-slate-400">No notes found.</p>}
            {hits?.map((h) => (
              <div key={h.id} className="rounded-lg border border-slate-100 p-2 text-xs dark:border-slate-700">
                <p className="text-slate-400"><b className="text-slate-600 dark:text-slate-300">{h.debtor_name}</b> · {h.case_number} · {kindLabel(h.kind)} · {h.author_name} · {when(h.created_at)}{h.withdrawn_at ? " · withdrawn" : ""}</p>
                <p className="mt-0.5 text-slate-700 dark:text-slate-200">{h.body}</p>
              </div>
            ))}
          </div>
        ) : loading ? <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-emerald-600" /></div> : (
          <>
            {notes.length === 0 && <p className="text-sm text-slate-400">No notes yet.</p>}
            {pinned.length > 0 && <div className="space-y-2"><p className="text-[10px] font-bold uppercase tracking-wide text-amber-600">Pinned</p>{pinned.map((n) => <NoteCard key={n.id} n={n} busy={busy} run={run} />)}</div>}
            <div className="space-y-2">{rest.map((n) => <NoteCard key={n.id} n={n} busy={busy} run={run} />)}</div>
          </>
        )}
      </div>
    </div>
  );
}

function NoteComposer({ caseId, busy, onSave }: { caseId: string; busy: boolean; onSave: (n: Parameters<typeof addNote>[0]) => void }) {
  const [kind, setKind] = useState<NoteKind>("general");
  const [body, setBody] = useState("");
  const [pinned, setPinned] = useState(false);
  const [direction, setDirection] = useState<"inbound" | "outbound">("inbound");
  const [contact, setContact] = useState("");
  const [outcome, setOutcome] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [clientVisible, setClientVisible] = useState(false);
  const [linkType, setLinkType] = useState<LinkType | "">("");
  const [linkId, setLinkId] = useState("");
  const { data: creditors } = useDebtCreditors(caseId);
  const { complaints } = useComplaints(caseId);
  const { docs } = useCaseDocuments(caseId);
  const structured = kind === "call" || kind === "meeting" || kind === "creditor";
  const options: { id: string; label: string }[] =
    linkType === "creditor" ? (creditors ?? []).map((c) => ({ id: c.id, label: c.creditor_name })) :
    linkType === "complaint" ? complaints.map((c) => ({ id: c.id, label: `${c.reference} · ${c.summary.slice(0, 40)}` })) :
    linkType === "document" ? docs.map((d) => ({ id: d.id, label: d.name })) : [];

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({ caseId, kind, body: body.trim(), pinned, direction: structured ? direction : null, contact: structured ? contact.trim() || null : null, outcome: structured ? outcome.trim() || null : null, followUp: followUp || null, linkType: linkType && linkId ? linkType : null, linkId: linkType && linkId ? linkId : null, clientVisible });
    setBody(""); setContact(""); setOutcome(""); setFollowUp(""); setPinned(false); setClientVisible(false); setLinkType(""); setLinkId("");
  };
  return (
    <form onSubmit={submit} className="panel space-y-2 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <select value={kind} onChange={(e) => setKind(e.target.value as NoteKind)} className="input w-auto text-xs">{NOTE_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</select>
        <div className="flex flex-wrap gap-1">{QUICK_PHRASES[kind].map((p) => <button type="button" key={p} onClick={() => setBody((b) => (b ? b + " " : "") + p)} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300">{p.length > 34 ? p.slice(0, 34) + "…" : p}</button>)}</div>
      </div>
      {structured && (
        <div className="grid gap-2 sm:grid-cols-3">
          <select value={direction} onChange={(e) => setDirection(e.target.value as "inbound" | "outbound")} className="input text-xs"><option value="inbound">Incoming</option><option value="outbound">Outgoing</option></select>
          <input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Who spoke to" className="input text-xs" />
          <input value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder="Outcome" className="input text-xs" />
        </div>
      )}
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={5000} placeholder="Write a note…" className="input w-full text-sm" required />
      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600 dark:text-slate-300">
        <label className="flex items-center gap-1">Follow up on <input type="date" value={followUp} onChange={(e) => setFollowUp(e.target.value)} className="input w-auto text-xs" /></label>
        <label className="flex items-center gap-1">Link to
          <select value={linkType} onChange={(e) => { setLinkType(e.target.value as LinkType | ""); setLinkId(""); }} className="input w-auto text-xs"><option value="">Nothing</option><option value="creditor">Creditor</option><option value="complaint">Complaint</option><option value="document">Document</option></select>
          {linkType && <select value={linkId} onChange={(e) => setLinkId(e.target.value)} className="input w-auto text-xs"><option value="">Choose…</option>{options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>}
        </label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />Pin</label>
        <label className="flex items-center gap-1" title="Off by default. Only tick this if the client should be able to see the note."><input type="checkbox" checked={clientVisible} onChange={(e) => setClientVisible(e.target.checked)} />Client can see this</label>
        <button disabled={busy || !body.trim()} className="btn btn-primary ml-auto bg-emerald-600 hover:bg-emerald-700">Save note</button>
      </div>
      {followUp && <p className="text-[11px] text-slate-400">A task will be created for {new Date(followUp + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" })}.</p>}
    </form>
  );
}

function NoteCard({ n, busy, run }: { n: CaseNote; busy: boolean; run: (fn: () => Promise<void>) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(n.body);
  const [withdrawing, setWithdrawing] = useState(false);
  const [reason, setReason] = useState("");
  const [history, setHistory] = useState<NoteVersion[] | null>(null);
  const withdrawn = !!n.withdrawn_at;
  return (
    <div className={`rounded-lg border p-3 text-sm ${n.pinned && !withdrawn ? "border-amber-200 bg-amber-50/50 dark:border-amber-500/30 dark:bg-amber-500/5" : "border-slate-100 dark:border-slate-700"} ${withdrawn ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
        <span className="rounded-full bg-slate-100 px-2 py-0.5 font-bold uppercase text-slate-600 dark:bg-slate-700 dark:text-slate-300">{kindLabel(n.kind)}</span>
        {n.direction && <span>{n.direction === "inbound" ? "Incoming" : "Outgoing"}{n.contact_name ? ` · ${n.contact_name}` : ""}</span>}
        <span>{n.author_name} · {when(n.created_at)}</span>
        {n.edited_at && <span>· edited (v{n.version})</span>}
        {n.linked_type && <span className="rounded bg-emerald-50 px-1.5 text-emerald-700">linked: {n.linked_type}</span>}
        {n.client_visible && <span className="rounded bg-sky-50 px-1.5 text-sky-700">client can see</span>}
        {!n.client_visible && <span title="Staff only"><EyeOff className="inline h-3 w-3" /></span>}
        {withdrawn && <span className="font-bold text-rose-600">WITHDRAWN</span>}
      </div>
      {editing ? (
        <div className="mt-1 space-y-1">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} className="input w-full text-sm" />
          <div className="flex gap-2"><button disabled={busy || !text.trim() || text === n.body} onClick={() => run(async () => { await editNote(n.id, text.trim()); setEditing(false); setHistory(null); })} className="btn text-xs">Save change</button><button onClick={() => { setEditing(false); setText(n.body); }} className="text-xs text-slate-500">Cancel</button></div>
        </div>
      ) : <p className={`mt-1 whitespace-pre-wrap text-slate-700 dark:text-slate-200 ${withdrawn ? "line-through" : ""}`}>{n.body}</p>}
      {n.outcome && <p className="mt-1 text-xs text-slate-500">Outcome: {n.outcome}</p>}
      {n.follow_up_on && <p className={`mt-1 text-xs ${n.follow_up_done ? "text-slate-400" : "font-semibold text-amber-700"}`}>Follow up {new Date(n.follow_up_on + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" })}{n.follow_up_done ? " (done)" : ""}</p>}
      {withdrawn && <p className="mt-1 text-xs text-rose-600">Withdrawn: {n.withdraw_reason}</p>}
      {!withdrawn && !editing && (
        <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px]">
          <button disabled={busy} onClick={() => run(() => pinNote(n.id, !n.pinned))} className="inline-flex items-center gap-0.5 text-slate-500 hover:text-slate-800">{n.pinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}{n.pinned ? "Unpin" : "Pin"}</button>
          <button onClick={() => setEditing(true)} className="text-slate-500 hover:text-slate-800">Edit</button>
          <button onClick={() => setWithdrawing(!withdrawing)} className="text-slate-500 hover:text-rose-600">Withdraw</button>
          {n.version > 1 && <button onClick={async () => setHistory(history ? null : await noteHistory(n.id))} className="inline-flex items-center gap-0.5 text-slate-500 hover:text-slate-800"><History className="h-3 w-3" />History</button>}
        </div>
      )}
      {withdrawing && (
        <div className="mt-2 flex gap-2"><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this being withdrawn? (at least 5 characters)" className="input flex-1 text-xs" />
          <button disabled={busy || reason.trim().length < 5} onClick={() => run(async () => { await withdrawNote(n.id, reason.trim()); setWithdrawing(false); })} className="btn text-xs">Withdraw note</button></div>
      )}
      {history && <div className="mt-2 space-y-1 rounded bg-slate-50 p-2 text-[11px] text-slate-600 dark:bg-slate-800/50 dark:text-slate-300">{history.map((v) => <p key={v.version}><b>v{v.version}</b> · {v.edited_by_name} · {when(v.edited_at)}: {v.body}</p>)}</div>}
    </div>
  );
}
