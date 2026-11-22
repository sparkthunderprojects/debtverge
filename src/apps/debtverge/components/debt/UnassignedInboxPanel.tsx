import { useState } from "react";
import { Inbox, Loader2, MessageCircle, Phone, Smartphone, Trash2 } from "lucide-react";
import { useUnassigned, assignUnassigned, dismissUnassigned, addFirmNumber, removeFirmNumber, searchCases } from "../../lib/inbound-hooks";

const when = (d: string) => new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Texts and WhatsApps that reached the firm's number but could not be matched to exactly one case. Managers file them to a case or dismiss them. */
export function UnassignedInboxPanel() {
  const { items, numbers, allowed, loading, reload } = useUnassigned();
  const [open, setOpen] = useState<string | null>(null);
  const [mode, setMode] = useState<"assign" | "dismiss">("assign");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ id: string; case_number: string; debtor_name: string }[]>([]);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [num, setNum] = useState("");
  const [label, setLabel] = useState("");

  if (loading || !allowed) return null;   // managers only
  async function run(fn: () => Promise<void>) {
    setBusy(true); setErr(null);
    try { await fn(); setOpen(null); setQ(""); setHits([]); setReason(""); await reload(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <div className="panel p-4">
      <h3 className="mb-1 flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-100">
        <Inbox className="h-4 w-4" /> Unmatched messages {items.length > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">{items.length}</span>}
      </h3>
      <p className="mb-3 text-xs text-slate-500">Messages sent to your firm's number from a phone we could not tie to exactly one case (new number, or the number is on more than one case). File each to the right case so it joins that conversation, or dismiss it.</p>
      {err && <p className="mb-2 text-xs text-rose-600">{err}</p>}
      {items.length === 0 ? <p className="text-sm text-slate-500">Nothing waiting.</p> : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {items.map((m) => (
            <li key={m.id} className="py-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                {m.channel === "whatsapp" ? <MessageCircle className="h-4 w-4 text-emerald-600" /> : <Smartphone className="h-4 w-4 text-sky-600" />}
                <span className="font-medium">{m.sender_name || "Unknown"}</span>
                <span className="text-xs text-slate-500">{m.sender_email_or_phone}</span>
                <span className="text-xs text-slate-400">{when(m.received_at)}</span>
                <span className="ml-auto flex gap-2">
                  <button onClick={() => { setOpen(m.id); setMode("assign"); setErr(null); }} className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold dark:border-slate-600">File to case</button>
                  <button onClick={() => { setOpen(m.id); setMode("dismiss"); setErr(null); }} className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold dark:border-slate-600">Dismiss</button>
                </span>
              </div>
              <p className="mt-1 whitespace-pre-wrap rounded-lg bg-slate-50 p-2 text-slate-700 dark:bg-slate-800/60 dark:text-slate-200">{m.body}</p>
              {open === m.id && mode === "assign" && (
                <div className="mt-2 space-y-1">
                  <input value={q} onChange={async (e) => { setQ(e.target.value); setHits(await searchCases(e.target.value)); }} placeholder="Search case number or name" className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800" />
                  {hits.map((h) => (
                    <button key={h.id} disabled={busy} onClick={() => run(() => assignUnassigned(m.id, h.id))} className="flex w-full items-center gap-2 rounded-lg border border-slate-200 px-2 py-1.5 text-left text-xs hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
                      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}<span className="font-semibold">{h.case_number}</span><span className="text-slate-500">{h.debtor_name}</span>
                    </button>
                  ))}
                </div>
              )}
              {open === m.id && mode === "dismiss" && (
                <div className="mt-2 flex gap-2">
                  <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason, e.g. wrong number, spam" className="flex-1 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800" />
                  <button disabled={busy || reason.trim().length < 3} onClick={() => run(() => dismissUnassigned(m.id, reason))} className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Dismiss</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-800">
        <h4 className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500"><Phone className="h-3 w-3" /> Your firm's numbers</h4>
        {numbers.length === 0 && <p className="mb-2 text-xs text-amber-700">No number registered yet. Add the number your messages are sent from and received on, so replies reach the right firm.</p>}
        <ul className="mb-2 space-y-1">
          {numbers.map((n) => (
            <li key={n.id} className="flex items-center gap-2 text-sm"><span className="font-medium">{n.e164}</span><span className="text-xs text-slate-500">{n.label}</span>
              <button onClick={() => run(() => removeFirmNumber(n.id))} className="ml-auto text-slate-400 hover:text-rose-600" aria-label="Remove number"><Trash2 className="h-3.5 w-3.5" /></button></li>
          ))}
        </ul>
        <div className="flex gap-2">
          <input value={num} onChange={(e) => setNum(e.target.value)} placeholder="+447700900123" className="w-44 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800" />
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (optional)" className="flex-1 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800" />
          <button disabled={busy || !num.trim()} onClick={() => run(async () => { await addFirmNumber(num, label); setNum(""); setLabel(""); })} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold disabled:opacity-50 dark:border-slate-600">Add</button>
        </div>
      </div>
    </div>
  );
}
