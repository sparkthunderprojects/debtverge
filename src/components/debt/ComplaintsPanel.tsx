import { useState } from "react";
import { AlertTriangle, Loader2, MessageSquareWarning } from "lucide-react";
import { useAuth } from "../../lib/auth";
import { formatCurrency } from "../../lib/format";
import { useComplaints, logComplaint, updateComplaint, deadlines, CATEGORY_LABEL, STATUS_LABEL, type Complaint } from "../../lib/complaint-hooks";

const fmt = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/** Complaints register. With a caseId it shows that case's complaints; without, the whole firm's (managers). */
export function ComplaintsPanel({ caseId, defaultName, onOpenCase }: { caseId?: string; defaultName?: string; onOpenCase?: (id: string) => void }) {
  const { dvRole } = useAuth();
  const isManager = dvRole !== "advisor";
  const { complaints, loading, reload } = useComplaints(caseId ?? null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState(defaultName ?? "");
  const [summary, setSummary] = useState("");
  const [category, setCategory] = useState("service");
  const [channel, setChannel] = useState("phone");
  const [vulnerable, setVulnerable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Record<string, string>>({});

  async function run(fn: () => Promise<void>) {
    setBusy(true); setErr(null);
    try { await fn(); await reload(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => { await logComplaint({ caseId: caseId ?? null, complainant: name.trim(), summary: summary.trim(), category, channel, vulnerable }); setSummary(""); setAdding(false); });
  };
  const open = complaints.filter((c) => c.status !== "closed");
  const late = open.filter((c) => { const d = deadlines(c); return d.ackLate || d.finalLate; }).length;

  if (loading) return <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-emerald-600" /></div>;

  return (
    <div className="panel space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2"><MessageSquareWarning className="h-4 w-4 text-emerald-600" /><h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Complaints</h3>
          <span className="text-xs text-slate-400">{open.length} open{late > 0 && <b className="ml-1 text-rose-600">{late} past deadline</b>}</span></div>
        <button onClick={() => setAdding(!adding)} className="btn text-xs">{adding ? "Cancel" : "Log a complaint"}</button>
      </div>
      {adding && (
        <form onSubmit={submit} className="space-y-2 rounded-lg bg-slate-50 p-3 dark:bg-slate-800/50">
          <div className="grid gap-2 sm:grid-cols-3">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Who is complaining" className="input text-sm" required />
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="input text-sm">{Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            <select value={channel} onChange={(e) => setChannel(e.target.value)} className="input text-sm">{["phone", "email", "letter", "portal", "other"].map((c) => <option key={c} value={c}>{c}</option>)}</select>
          </div>
          <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={3} placeholder="What is the complaint about?" className="input w-full text-sm" required />
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300"><input type="checkbox" checked={vulnerable} onChange={(e) => setVulnerable(e.target.checked)} /> Client may be vulnerable</label>
            <button disabled={busy} className="btn btn-primary bg-emerald-600 hover:bg-emerald-700">Log complaint</button>
          </div>
        </form>
      )}
      {err && <p className="text-xs text-rose-600">{err}</p>}
      {complaints.length === 0 && <p className="text-sm text-slate-400">No complaints logged.</p>}
      {complaints.map((c: Complaint) => {
        const d = deadlines(c);
        return (
          <div key={c.id} className="rounded-lg border border-slate-100 p-3 text-sm dark:border-slate-700">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-bold text-slate-700 dark:text-slate-200">{c.reference}</span>
              <span className="text-slate-500">{c.complainant}</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-600 dark:bg-slate-700 dark:text-slate-300">{STATUS_LABEL[c.status]}</span>
              {c.vulnerable && <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-bold uppercase text-rose-700">Vulnerable</span>}
              {c.referred_to_fos && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-700">With FOS</span>}
              <span className="ml-auto text-slate-400">{CATEGORY_LABEL[c.category]} · received {fmt(new Date(c.received_on + "T00:00:00"))}</span>
            </div>
            <p className="mt-1 text-slate-700 dark:text-slate-200">{c.summary}</p>
            {c.status !== "closed" && (
              <p className={`mt-1 flex items-center gap-1 text-[11px] ${d.ackLate || d.finalLate ? "font-bold text-rose-600" : d.finalSoon ? "text-amber-600" : "text-slate-400"}`}>
                {(d.ackLate || d.finalLate) && <AlertTriangle className="h-3 w-3" />}
                {!c.acknowledged_on && <>Acknowledge by {fmt(d.ackDue)} · </>}Final response by {fmt(d.finalDue)}
              </p>
            )}
            {c.outcome && <p className="mt-1 text-[11px] text-slate-500">Outcome: {c.outcome.replace(/_/g, " ")}{c.redress_amount ? `, redress ${formatCurrency(c.redress_amount, "GBP")}` : ""}</p>}
            {!caseId && c.case_id && onOpenCase && <button onClick={() => onOpenCase(c.case_id!)} className="mt-1 text-[11px] font-semibold text-emerald-700 hover:underline">Open case</button>}
            {isManager && c.status !== "closed" && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {c.status === "open" && <button disabled={busy} onClick={() => run(() => updateComplaint(c.id, "acknowledged", null, null, "", null))} className="btn text-xs">Mark acknowledged</button>}
                {(c.status === "open" || c.status === "acknowledged") && <button disabled={busy} onClick={() => run(() => updateComplaint(c.id, "investigating", null, null, "", null))} className="btn text-xs">Investigating</button>}
                <select value={outcome[c.id] ?? ""} onChange={(e) => setOutcome({ ...outcome, [c.id]: e.target.value })} className="input w-auto text-xs">
                  <option value="">Outcome…</option><option value="upheld">Upheld</option><option value="partially_upheld">Partially upheld</option><option value="not_upheld">Not upheld</option>
                </select>
                <button disabled={busy || !(outcome[c.id] || c.outcome)} onClick={() => run(() => updateComplaint(c.id, "final_response", outcome[c.id] || null, null, "", null))} className="btn text-xs">Final response sent</button>
                {c.status === "final_response" && <button disabled={busy} onClick={() => run(() => updateComplaint(c.id, "closed", null, null, "", null))} className="btn text-xs">Close</button>}
                {!c.referred_to_fos && <button disabled={busy} onClick={() => run(() => updateComplaint(c.id, c.status, null, null, "Referred to FOS", true))} className="text-[11px] text-slate-500 hover:text-slate-800">Referred to FOS</button>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
