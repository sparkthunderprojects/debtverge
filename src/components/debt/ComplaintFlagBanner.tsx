import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useFlaggedMessages, logComplaint, dismissComplaintFlag } from "../../lib/complaint-hooks";

/** Shown on a case or thread when the client's own message reads like a complaint. One click logs it with the clock starting from that message. */
export function ComplaintFlagBanner({ caseId, clientName, onLogged }: { caseId: string | null; clientName: string; onLogged?: () => void }) {
  const { items, reload } = useFlaggedMessages(caseId);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!caseId || items.length === 0) return null;
  const m = items[0];
  async function act(fn: () => Promise<void>) {
    setBusy(true); setErr(null);
    try { await fn(); await reload(); onLogged?.(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <div className="mx-3 mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
      <p className="flex items-center gap-1.5 font-bold"><AlertTriangle className="h-3.5 w-3.5" />This message may be a complaint{items.length > 1 ? ` (${items.length} flagged)` : ""}</p>
      <p className="mt-1 line-clamp-2 italic">"{m.body}"</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button disabled={busy} onClick={() => act(() => logComplaint({ caseId, complainant: clientName, summary: m.body.slice(0, 1000), category: "service", channel: m.channel, vulnerable: false, sourceCommId: m.id }))} className="btn btn-primary bg-amber-600 text-xs hover:bg-amber-700">Log as complaint</button>
        <button disabled={busy} onClick={() => act(() => dismissComplaintFlag(m.id))} className="text-xs font-semibold text-amber-800 hover:underline dark:text-amber-200">Not a complaint</button>
        <span className="text-[11px] opacity-80">The deadlines run from when the client sent it.</span>
      </div>
      {err && <p className="mt-1 text-rose-600">{err}</p>}
    </div>
  );
}
