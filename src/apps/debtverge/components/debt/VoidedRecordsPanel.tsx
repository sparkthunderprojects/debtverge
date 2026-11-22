import { useState } from "react";
import { Archive, Loader2, RotateCcw, ShieldX } from "lucide-react";
import { useAuth } from "@/core/auth";
import { useVoidedCases, restoreCase, eraseCase, type VoidedCase } from "../../lib/voided-hooks";

const when = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** Deleted (voided) cases: managers can restore; admins and operations managers can permanently erase personal data (GDPR). */
export function VoidedRecordsPanel() {
  const { isAdminOrHigher, realDvRole } = useAuth();
  const canErase = isAdminOrHigher || realDvRole === "operations_manager" || realDvRole === "admin";
  const { items, loading, error, reload } = useVoidedCases();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [erasing, setErasing] = useState<VoidedCase | null>(null);
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState("");

  async function run(id: string, fn: () => Promise<void>) {
    setBusy(id); setErr(null); setNote(null);
    try { await fn(); await reload(); } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  }
  if (loading || error) return null;           // managers only: the database refuses everyone else
  return (
    <div className="panel p-4">
      <h3 className="mb-1 flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-100"><Archive className="h-4 w-4" /> Deleted cases</h3>
      <p className="mb-3 text-xs text-slate-500">Deleted cases are hidden, not destroyed. Restore one, or erase the personal data when the retention period has passed or a person asks for erasure. Financial records and the audit trail are kept.</p>
      {err && <p className="mb-2 text-xs text-rose-600">{err}</p>}
      {note && <p className="mb-2 text-xs text-emerald-600">{note}</p>}
      {items.length === 0 ? <p className="text-sm text-slate-500">No deleted cases.</p> : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {items.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
              <span className="font-medium">{c.case_number}</span>
              <span className="text-slate-500">{c.erased_at ? "Personal data erased" : c.debtor_name}</span>
              <span className="text-xs text-slate-400">deleted {when(c.voided_at)}</span>
              <span className="ml-auto flex gap-2">
                {!c.erased_at && (
                  <button disabled={busy === c.id} onClick={() => run(c.id, () => restoreCase(c.id).then(() => setNote(`Case ${c.case_number} restored.`)))} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold dark:border-slate-600">
                    {busy === c.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />} Restore
                  </button>
                )}
                {!c.erased_at && canErase && (
                  <button onClick={() => { setErasing(c); setReason(""); setConfirm(""); setErr(null); }} className="inline-flex items-center gap-1 rounded-lg border border-rose-300 px-2.5 py-1 text-xs font-semibold text-rose-600 dark:border-rose-700">
                    <ShieldX className="h-3 w-3" /> Erase personal data
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {erasing && (
        <div className="mt-3 space-y-2 rounded-lg border border-rose-300 bg-rose-50 p-3 text-xs dark:border-rose-800 dark:bg-rose-950/30">
          <p className="font-semibold text-rose-700 dark:text-rose-300">Erase personal data for {erasing.case_number}? This cannot be undone.</p>
          <p className="text-slate-600 dark:text-slate-300">Names, contact details, notes, messages, letters and complaint text are removed. Payment, fee and creditor records and the audit trail stay. It will be refused if the case still holds client money or has an open complaint or payout.</p>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason, e.g. erasure request ref (min 10 characters)" className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 dark:border-slate-600 dark:bg-slate-800" />
          <input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={`Type ${erasing.case_number} to confirm`} className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 dark:border-slate-600 dark:bg-slate-800" />
          <div className="flex gap-2">
            <button disabled={busy === erasing.id || reason.trim().length < 10 || confirm.trim() !== erasing.case_number}
              onClick={() => run(erasing.id, async () => { const n = await eraseCase(erasing.id, reason.trim()); setNote(`Case ${erasing.case_number} erased (${n} fields).`); setErasing(null); })}
              className="rounded-lg bg-rose-600 px-3 py-1.5 font-semibold text-white disabled:opacity-40">Erase permanently</button>
            <button onClick={() => setErasing(null)} className="rounded-lg border border-slate-300 px-3 py-1.5 dark:border-slate-600">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
