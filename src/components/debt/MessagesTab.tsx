import { useState } from "react";
import { Loader2, Mail, MessageSquare, Send, X } from "lucide-react";
import { useOutbox, queueMessage, cancelMessage, TRIGGER_LABEL, type OutboxMessage } from "../../lib/outbox-hooks";
import type { DebtCase } from "../../lib/types";

const STATUS_STYLE: Record<OutboxMessage["status"], string> = {
  queued: "bg-amber-50 text-amber-700", sent: "bg-emerald-50 text-emerald-700", failed: "bg-rose-50 text-rose-700", cancelled: "bg-slate-100 text-slate-500",
};
const when = (s: string) => new Date(s).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function MessagesTab({ caseId, caseData }: { caseId: string | null; caseData: DebtCase | null }) {
  const { messages, loading, error, reload } = useOutbox(caseId);
  const [channel, setChannel] = useState<"email" | "sms">("sms");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!caseId || !caseData) return <div className="flex h-full items-center justify-center text-sm text-slate-400">Select a case to send messages</div>;

  async function run(fn: () => Promise<void>) {
    setBusy(true); setErr(null);
    try { await fn(); await reload(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  const send = (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim() || !caseId) return;
    run(async () => { await queueMessage(caseId, channel, subject, body.trim()); setBody(""); setSubject(""); });
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-1">
      <form onSubmit={send} className="panel space-y-3 p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Message {caseData.debtor_name}</h3>
          <div className="flex gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
            {(["sms", "email"] as const).map((c) => (
              <button key={c} type="button" onClick={() => setChannel(c)} className={`flex items-center gap-1 rounded-md px-3 py-1 text-xs font-bold ${channel === c ? "bg-emerald-600 text-white" : "text-slate-500"}`}>
                {c === "sms" ? <MessageSquare className="h-3.5 w-3.5" /> : <Mail className="h-3.5 w-3.5" />}{c === "sms" ? "SMS" : "Email"}
              </button>
            ))}
          </div>
        </div>
        {channel === "email" && <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" className="input w-full" />}
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} placeholder={channel === "sms" ? "Write your text message" : "Write your email"} className="input w-full" />
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-slate-400">Goes to the contact details on the client profile. Logged on the case.</span>
          <button disabled={busy || !body.trim()} className="btn btn-primary bg-emerald-600 hover:bg-emerald-700"><Send className="h-4 w-4" /> Send</button>
        </div>
        {(err || error) && <p className="text-xs text-rose-600">{err ?? error}</p>}
      </form>

      <div className="panel overflow-hidden">
        <div className="px-4 py-3"><h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Sent and queued</h3></div>
        {loading ? <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-emerald-600" /></div>
          : messages.length === 0 ? <p className="px-4 pb-4 text-sm text-slate-400">Nothing sent yet.</p>
          : messages.map((m) => (
            <div key={m.id} className="border-t border-slate-100 px-4 py-3 text-sm dark:border-slate-700">
              <div className="flex items-center gap-2 text-xs text-slate-500">
                {m.channel === "sms" ? <MessageSquare className="h-3.5 w-3.5" /> : <Mail className="h-3.5 w-3.5" />}
                <span>{m.to_address}</span><span>·</span><span>{TRIGGER_LABEL[m.trigger]}</span><span>·</span><span>{when(m.sent_at ?? m.created_at)}</span>
                <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${STATUS_STYLE[m.status]}`}>{m.status}</span>
                {m.status === "queued" && <button title="Cancel" disabled={busy} onClick={() => run(() => cancelMessage(m.id))} className="text-slate-400 hover:text-rose-600"><X className="h-3.5 w-3.5" /></button>}
              </div>
              {m.subject && <p className="mt-1 font-semibold text-slate-800 dark:text-slate-100">{m.subject}</p>}
              <p className="mt-1 whitespace-pre-wrap text-slate-600 dark:text-slate-300">{m.body}</p>
              {m.error && <p className="mt-1 text-xs text-rose-600">{m.error}</p>}
            </div>
          ))}
      </div>
    </div>
  );
}
