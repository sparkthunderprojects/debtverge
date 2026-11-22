import { useState } from "react";
import { AlertTriangle, Clock, Loader2, X } from "lucide-react";
import { useOutbox, cancelMessage } from "../../lib/outbox-hooks";

/** Messages waiting to go out or that failed, for the open case, with a cancel button. Everything else lives in the conversation. */
export function QueuedMessagesStrip({ caseId }: { caseId: string | null }) {
  const { messages, reload } = useOutbox(caseId);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const pending = messages.filter((m) => m.status === "queued" || m.status === "failed");
  if (!caseId || pending.length === 0) return null;

  async function cancel(id: string) {
    setBusy(id); setErr(null);
    try { await cancelMessage(id); await reload(); } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  }
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-xs dark:border-amber-800 dark:bg-amber-950/30">
      {pending.map((m) => (
        <div key={m.id} className="flex items-center gap-2 py-0.5">
          {m.status === "failed" ? <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-rose-600" /> : <Clock className="h-3.5 w-3.5 shrink-0 text-amber-600" />}
          <span className="font-semibold uppercase">{m.channel}</span>
          <span className="truncate text-slate-600 dark:text-slate-300">{m.subject || m.body}</span>
          <span className={m.status === "failed" ? "text-rose-600" : "text-amber-700"}>{m.status === "failed" ? `failed${m.error ? `: ${m.error}` : ""}` : "waiting to send"}</span>
          {m.status === "queued" && (
            <button onClick={() => cancel(m.id)} disabled={busy === m.id} className="ml-auto inline-flex items-center gap-1 rounded border border-slate-300 px-1.5 py-0.5 dark:border-slate-600">
              {busy === m.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />} Cancel
            </button>
          )}
        </div>
      ))}
      {err && <p className="mt-1 text-rose-600">{err}</p>}
    </div>
  );
}
