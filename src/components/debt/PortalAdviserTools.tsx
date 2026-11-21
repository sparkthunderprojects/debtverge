import { useState } from "react";
import { Link2, Copy, Check, X, Loader2, UserCog, AlertTriangle, ArrowRight } from "lucide-react";
import type { DebtCase } from "@/lib/types";
import { supabase } from "@/lib/supabase";
import {
  createPaymentLink, usePaymentLinks, useChangeRequests, decideChangeRequest, payUrl, type ChangeRequest,
} from "@/lib/portal-hooks";

const FIELD_LABEL: Record<string, string> = {
  mobile_phone: "Mobile", primary_email: "Email", landline_phone: "Landline",
  address_street: "Street", address_city: "Town / city", address_postcode: "Postcode",
};

async function orgIdForCase(caseId: string): Promise<string> {
  const { data, error } = await supabase.from("debt_cases").select("organization_id").eq("id", caseId).single();
  if (error || !data?.organization_id) throw new Error("This case isn't linked to an organisation");
  return data.organization_id as string;
}

/** Case header action: create a no-login payment link and copy it to send to the client. */
export function PaymentLinkButton({ caseData }: { caseData: DebtCase }) {
  const [open, setOpen] = useState(false);
  const defaultAmount = caseData.installment_amount ?? caseData.monthly_disposable_income ?? 0;
  const [amount, setAmount] = useState(String(defaultAmount || ""));
  const [reason, setReason] = useState("Missed payment");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const { data: links, reload } = usePaymentLinks(open ? caseData.id : null);

  const create = async () => {
    const n = Number(amount);
    if (!n || n <= 0) { setError("Enter an amount"); return; }
    setBusy(true); setError(null);
    try {
      const l = await createPaymentLink(caseData.id, await orgIdForCase(caseData.id), n, reason.trim());
      await navigator.clipboard.writeText(payUrl(l.token)).catch(() => {});
      setCopied(l.token);
      await reload();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create link"); }
    finally { setBusy(false); }
  };
  const copy = async (token: string) => {
    await navigator.clipboard.writeText(payUrl(token)).catch(() => {});
    setCopied(token); setTimeout(() => setCopied(null), 2000);
  };

  return (
    <>
      <button onClick={() => setOpen(true)} className="btn btn-secondary px-2.5 py-1.5 text-xs" title="Create a no-login payment link for the client">
        <Link2 className="h-3.5 w-3.5" /> Payment link
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">Payment link · {caseData.debtor_name}</h3>
              <button onClick={() => setOpen(false)} className="btn btn-ghost p-1.5"><X className="h-4 w-4" /></button>
            </div>
            <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">Creates a link the client opens without logging in. It shows the amount due and their plan progress, and expires after 14 days.</p>
            <div className="mb-3 grid grid-cols-3 gap-2">
              <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="input col-span-1 text-sm" placeholder="Amount" />
              <input value={reason} onChange={(e) => setReason(e.target.value)} className="input col-span-2 text-sm" placeholder="Reason" />
            </div>
            {error && <div className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">{error}</div>}
            <button disabled={busy} onClick={create} className="btn btn-primary w-full bg-emerald-600 text-sm hover:bg-emerald-700">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />} Create link and copy
            </button>
            {copied && <p className="mt-2 text-center text-xs text-emerald-600">Link copied. Paste it into a text or email to the client.</p>}
            {links.length > 0 && (
              <div className="mt-4 border-t border-slate-200 pt-3 dark:border-slate-700">
                <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">Recent links</p>
                {links.map((l) => (
                  <div key={l.id} className="flex items-center justify-between gap-2 py-1 text-xs text-slate-600 dark:text-slate-300">
                    <span className="min-w-0 truncate">£{l.amount} · {l.status}{l.last_viewed_at ? " · opened" : ""} · {new Date(l.created_at).toLocaleDateString("en-GB")}</span>
                    <button onClick={() => copy(l.token)} className="btn btn-ghost shrink-0 p-1">{copied === l.token ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/** Sidebar inbox: client change requests from the portal, with approve / reject. */
export function ChangeRequestsButton({ onOpenCase }: { onOpenCase: (caseId: string) => void }) {
  const { data, loading, reload } = useChangeRequests();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = data.filter((r) => r.status === "pending");

  const decide = async (r: ChangeRequest, approve: boolean) => {
    setBusy(r.id); setError(null);
    try { await decideChangeRequest(r.id, approve, ""); await reload(); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not save decision"); }
    finally { setBusy(null); }
  };

  return (
    <>
      <button onClick={() => { setOpen(true); reload(); }} className="relative flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-600 transition-colors hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600" title="Client change requests">
        <UserCog className="h-4 w-4" />
        {pending.length > 0 && <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">{pending.length}</span>}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={() => setOpen(false)}>
          <div className="flex h-full w-full max-w-md flex-col bg-white shadow-2xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-700">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">Client change requests</h3>
                <p className="text-xs text-slate-400">Submitted from the client page. Vulnerability flags first.</p>
              </div>
              <button onClick={() => setOpen(false)} className="btn btn-ghost p-1.5"><X className="h-4 w-4" /></button>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
              {error && <div className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">{error}</div>}
              {loading ? <div className="skeleton h-24 rounded-xl" /> : data.length === 0 ? (
                <p className="py-10 text-center text-sm text-slate-400">No change requests.</p>
              ) : data.map((r) => (
                <div key={r.id} className={`rounded-xl border p-3 ${r.flags_vulnerability && r.status === "pending" ? "border-amber-400 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-500/10" : "border-slate-200 dark:border-slate-700"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <button onClick={() => { onOpenCase(r.case_id); setOpen(false); }} className="min-w-0 text-left">
                      <p className="truncate text-sm font-bold text-slate-800 dark:text-slate-100">{r.debt_cases?.debtor_name ?? "Client"}</p>
                      <p className="text-[11px] text-slate-400">{r.debt_cases?.case_number} · {new Date(r.created_at).toLocaleDateString("en-GB")}</p>
                    </button>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${r.status === "pending" ? "bg-amber-100 text-amber-700" : r.status === "approved" ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>{r.status}</span>
                  </div>
                  {r.flags_vulnerability && <p className="mt-2 flex items-center gap-1 text-[11px] font-bold text-amber-700 dark:text-amber-300"><AlertTriangle className="h-3 w-3" /> May indicate vulnerability. Call the client.</p>}
                  {r.request_type === "contact" ? (
                    <p className="mt-2 flex flex-wrap items-center gap-1 text-xs text-slate-600 dark:text-slate-300">
                      <b>{FIELD_LABEL[r.field ?? ""] ?? r.field}</b> {r.old_value ?? "(none)"} <ArrowRight className="h-3 w-3" /> <b>{r.new_value}</b>
                    </p>
                  ) : <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">{r.note}</p>}
                  {r.status === "pending" && (
                    <div className="mt-3 flex gap-2">
                      <button disabled={busy === r.id} onClick={() => decide(r, true)} className="btn btn-primary flex-1 bg-emerald-600 py-1.5 text-xs hover:bg-emerald-700">
                        {busy === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} {r.request_type === "contact" ? "Approve and apply" : "Mark as reviewed"}
                      </button>
                      <button disabled={busy === r.id} onClick={() => decide(r, false)} className="btn btn-secondary py-1.5 text-xs">Reject</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
