import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, Loader2, MessageSquareWarning, ShieldAlert } from "lucide-react";
import { useAuth } from "../../lib/auth";
import { formatCurrency } from "../../lib/format";
import {
  useComplaints, logComplaint, updateComplaint, deadlines, fetchComplaintDetail, requestRedress, decideRedress, markRedressPaid, useComplaintsMi,
  CATEGORY_LABEL, STATUS_LABEL, ROOT_CAUSE_LABEL, FAULT_LABEL, OUTCOME_LABEL, type Complaint, type ComplaintDetail, type ComplaintsMi,
} from "../../lib/complaint-hooks";
import { useTeam, memberLabel } from "../../lib/team-hooks";

const fmt = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const fmtTime = (s: string) => new Date(s).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const ACTION_TEXT: Record<string, string> = {
  logged: "Complaint logged", assigned: "Handler assigned", acknowledgement_queued: "Acknowledgement queued", acknowledgement_needed: "Acknowledgement needed", acknowledged: "Acknowledged",
  investigating: "Investigating", final_response: "Final response sent", closed: "Closed", reassigned: "Handler changed", fos: "Referred to FOS",
  redress_requested: "Redress requested", redress_approved: "Redress approved", redress_rejected: "Redress rejected", redress_paid: "Redress paid",
};

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
  const [showMi, setShowMi] = useState(false);

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
  // vulnerable clients first, then oldest received
  const sorted = [...complaints].sort((a, b) => (a.status === "closed" ? 1 : 0) - (b.status === "closed" ? 1 : 0) || (b.priority === "high" ? 1 : 0) - (a.priority === "high" ? 1 : 0) || a.received_on.localeCompare(b.received_on));

  if (loading) return <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-emerald-600" /></div>;

  return (
    <div className="panel space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2"><MessageSquareWarning className="h-4 w-4 text-emerald-600" /><h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Complaints</h3>
          <span className="text-xs text-slate-400">{open.length} open{late > 0 && <b className="ml-1 text-rose-600">{late} past deadline</b>}</span></div>
        <div className="flex items-center gap-2">
          {isManager && !caseId && <button onClick={() => setShowMi(!showMi)} className="btn text-xs">{showMi ? "Hide report" : "Report"}</button>}
          <button onClick={() => setAdding(!adding)} className="btn text-xs">{adding ? "Cancel" : "Log a complaint"}</button>
        </div>
      </div>
      {showMi && isManager && <MiSection />}
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
          <p className="text-[11px] text-slate-400">The 5 working day and 8 week clocks start from today. An acknowledgement goes to the client automatically and a manager other than the adviser is assigned.</p>
        </form>
      )}
      {err && <p className="text-xs text-rose-600">{err}</p>}
      {complaints.length === 0 && <p className="text-sm text-slate-400">No complaints logged.</p>}
      {sorted.map((c) => <ComplaintCard key={c.id} c={c} isManager={isManager} showOpenCase={!caseId} onOpenCase={onOpenCase} busy={busy} run={run} />)}
    </div>
  );
}

function ComplaintCard({ c, isManager, showOpenCase, onOpenCase, busy, run }: { c: Complaint; isManager: boolean; showOpenCase: boolean; onOpenCase?: (id: string) => void; busy: boolean; run: (fn: () => Promise<void>) => Promise<void> }) {
  const d = deadlines(c);
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<ComplaintDetail | null>(null);
  const [responding, setResponding] = useState(false);
  const loadDetail = async () => { try { setDetail(await fetchComplaintDetail(c.id)); } catch { setDetail(null); } };
  const toggle = async () => { const next = !expanded; setExpanded(next); if (next) await loadDetail(); };
  const withDetail = (fn: () => Promise<void>) => run(async () => { await fn(); if (expanded) await loadDetail(); });

  return (
    <div className={`rounded-lg border p-3 text-sm ${c.priority === "high" && c.status !== "closed" ? "border-rose-200 dark:border-rose-500/40" : "border-slate-100 dark:border-slate-700"}`}>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-bold text-slate-700 dark:text-slate-200">{c.reference}</span>
        <span className="text-slate-500">{c.complainant}</span>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-600 dark:bg-slate-700 dark:text-slate-300">{STATUS_LABEL[c.status]}</span>
        {c.vulnerable && <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-bold uppercase text-rose-700"><ShieldAlert className="h-3 w-3" />Vulnerable · priority</span>}
        {c.referred_to_fos && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-700">With FOS</span>}
        <span className="ml-auto text-slate-400">{CATEGORY_LABEL[c.category]} · received {fmt(new Date(c.received_on + "T00:00:00"))}</span>
      </div>
      <p className="mt-1 text-slate-700 dark:text-slate-200">{c.summary}</p>
      {c.status !== "closed" && (
        <div className="mt-1 space-y-0.5">
          <p className={`flex items-center gap-1 text-[11px] ${d.ackLate || d.finalLate ? "font-bold text-rose-600" : d.finalSoon || d.ackWarn ? "text-amber-600" : "text-slate-400"}`}>
            {(d.ackLate || d.finalLate) && <AlertTriangle className="h-3 w-3" />}
            {!c.acknowledged_on && <>Acknowledge by {fmt(d.ackDue)} · </>}Final response by {fmt(d.finalDue)}
          </p>
          {d.ackWarn && <p className="text-[11px] font-semibold text-amber-600">Acknowledgement is due within 2 working days.</p>}
          {d.stage && <p className="text-[11px] font-semibold text-amber-600">{d.stage}</p>}
        </div>
      )}
      {c.outcome && <p className="mt-1 text-[11px] text-slate-500">Outcome: {OUTCOME_LABEL[c.outcome] ?? c.outcome}{c.root_cause ? ` · ${ROOT_CAUSE_LABEL[c.root_cause]}` : ""}{c.fault ? ` · fault: ${FAULT_LABEL[c.fault]}` : ""}{c.redress_amount ? ` · redress ${formatCurrency(c.redress_amount, "GBP")}` : ""}</p>}
      <div className="mt-1 flex items-center gap-3">
        {showOpenCase && c.case_id && onOpenCase && <button onClick={() => onOpenCase(c.case_id!)} className="text-[11px] font-semibold text-emerald-700 hover:underline">Open case</button>}
        <button onClick={toggle} className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-slate-500 hover:text-slate-800">{expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}Timeline</button>
      </div>

      {expanded && (
        <div className="mt-2 space-y-2 rounded-lg bg-slate-50 p-3 dark:bg-slate-800/50">
          {detail?.handler_name && <p className="text-[11px] text-slate-500">Handler: <b>{detail.handler_name}</b></p>}
          <ol className="space-y-1.5 border-l border-slate-200 pl-3 dark:border-slate-600">
            {(detail?.timeline ?? []).map((t, i) => (
              <li key={i} className="text-[11px] text-slate-600 dark:text-slate-300">
                <span className="text-slate-400">{fmtTime(t.at)} · </span>
                {t.kind === "event" && <><b>{ACTION_TEXT[t.action ?? ""] ?? t.action}</b>{t.by ? ` by ${t.by}` : ""}{t.note && t.action !== "logged" ? `: ${t.note}` : ""}</>}
                {t.kind === "message" && <><b>{t.direction === "inbound" ? "Client" : "Us"} ({t.channel})</b>: {t.body}</>}
                {t.kind === "note" && <><b>Note ({t.note_kind})</b>{t.withdrawn ? " (withdrawn)" : ""}: {t.body}</>}
              </li>
            ))}
            {detail && detail.timeline.length === 0 && <li className="text-[11px] text-slate-400">Nothing yet.</li>}
          </ol>
          {isManager && detail && detail.redress.length > 0 && (
            <div className="space-y-1">
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Redress</p>
              {detail.redress.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300">
                  <b>{formatCurrency(r.amount, "GBP")}</b><span>{r.reason}</span><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase dark:bg-slate-700">{r.status}</span>
                  {r.status === "requested" && <><button disabled={busy} onClick={() => withDetail(() => decideRedress(r.id, true))} className="btn text-[11px]">Approve</button><button disabled={busy} onClick={() => withDetail(() => decideRedress(r.id, false))} className="btn text-[11px]">Reject</button><span className="text-slate-400">A different manager must approve.</span></>}
                  {r.status === "approved" && <button disabled={busy} onClick={() => withDetail(() => markRedressPaid(r.id))} className="btn text-[11px]">Mark paid</button>}
                </div>
              ))}
            </div>
          )}
          {isManager && c.outcome && c.outcome !== "not_upheld" && <RedressForm complaintId={c.id} busy={busy} onSubmit={(a, r) => withDetail(() => requestRedress(c.id, a, r))} />}
        </div>
      )}

      {isManager && c.status !== "closed" && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {c.status === "open" && <button disabled={busy} onClick={() => run(() => updateComplaint(c.id, { status: "acknowledged" }))} className="btn text-xs">Mark acknowledged</button>}
          {(c.status === "open" || c.status === "acknowledged") && <button disabled={busy} onClick={() => run(() => updateComplaint(c.id, { status: "investigating" }))} className="btn text-xs">Investigating</button>}
          {c.status !== "final_response" && <button onClick={() => setResponding(!responding)} className="btn text-xs">{responding ? "Cancel final response" : "Record final response"}</button>}
          {c.status === "final_response" && <button disabled={busy} onClick={() => run(() => updateComplaint(c.id, { status: "closed" }))} className="btn text-xs">Close</button>}
          {!c.referred_to_fos && <button disabled={busy} onClick={() => run(() => updateComplaint(c.id, { status: c.status, note: "Referred to FOS", fos: true }))} className="text-[11px] text-slate-500 hover:text-slate-800">Referred to FOS</button>}
          <Reassign complaint={c} run={run} busy={busy} />
        </div>
      )}
      {isManager && responding && c.status !== "closed" && c.status !== "final_response" && <FinalResponseForm c={c} busy={busy} onSubmit={(u) => run(async () => { await updateComplaint(c.id, u); setResponding(false); })} />}
    </div>
  );
}

function Reassign({ complaint, run, busy }: { complaint: Complaint; run: (fn: () => Promise<void>) => Promise<void>; busy: boolean }) {
  const [show, setShow] = useState(false);
  if (!show) return <button onClick={() => setShow(true)} className="text-[11px] text-slate-500 hover:text-slate-800">Reassign handler</button>;
  return <ReassignSelect complaint={complaint} run={run} busy={busy} />;
}
function ReassignSelect({ complaint, run, busy }: { complaint: Complaint; run: (fn: () => Promise<void>) => Promise<void>; busy: boolean }) {
  const { members } = useTeam();
  const managers = members.filter((m) => m.role_name && m.role_name !== "Advisor");
  return (
    <select disabled={busy} value="" onChange={(e) => e.target.value && run(() => updateComplaint(complaint.id, { status: complaint.status, assignee: e.target.value, note: "Handler changed" }))} className="input w-auto text-xs">
      <option value="">Reassign handler…</option>
      {managers.map((m) => <option key={m.user_id} value={m.user_id}>{memberLabel(m)}{m.user_id === complaint.assigned_to ? " (current)" : ""}</option>)}
    </select>
  );
}

function FinalResponseForm({ c, busy, onSubmit }: { c: Complaint; busy: boolean; onSubmit: (u: Parameters<typeof updateComplaint>[1]) => void }) {
  const [outcome, setOutcome] = useState(c.outcome ?? "");
  const [reasoning, setReasoning] = useState(c.outcome_reasoning ?? "");
  const [rootCause, setRootCause] = useState(c.root_cause ?? "");
  const [fault, setFault] = useState(c.fault ?? "");
  const [ref, setRef] = useState(c.final_response_ref ?? "");
  const [adj, setAdj] = useState(c.adjustments_confirmed);
  const ready = outcome && reasoning.trim().length >= 20 && rootCause && fault && (!c.vulnerable || adj);
  return (
    <div className="mt-2 space-y-2 rounded-lg bg-slate-50 p-3 dark:bg-slate-800/50">
      <div className="grid gap-2 sm:grid-cols-3">
        <select value={outcome} onChange={(e) => setOutcome(e.target.value)} className="input text-xs"><option value="">Outcome…</option>{Object.entries(OUTCOME_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select value={rootCause} onChange={(e) => setRootCause(e.target.value)} className="input text-xs"><option value="">Root cause…</option>{Object.entries(ROOT_CAUSE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select value={fault} onChange={(e) => setFault(e.target.value)} className="input text-xs"><option value="">Who was at fault…</option>{Object.entries(FAULT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      </div>
      <textarea value={reasoning} onChange={(e) => setReasoning(e.target.value)} rows={3} placeholder="Reasoning behind the outcome (at least 20 characters)" className="input w-full text-xs" />
      <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Final response reference or letter (optional)" className="input w-full text-xs" />
      {c.vulnerable && <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300"><input type="checkbox" checked={adj} onChange={(e) => setAdj(e.target.checked)} /> I have considered adjustments for this vulnerable client</label>}
      <div className="flex justify-end"><button disabled={busy || !ready} onClick={() => onSubmit({ status: "final_response", outcome, reasoning: reasoning.trim(), rootCause, fault, finalRef: ref.trim() || null, adjustments: adj })} className="btn btn-primary bg-emerald-600 text-xs hover:bg-emerald-700">Final response sent</button></div>
    </div>
  );
}

function RedressForm({ busy, onSubmit }: { complaintId: string; busy: boolean; onSubmit: (amount: number, reason: string) => void }) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Redress £" className="input w-28 text-xs" />
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" className="input min-w-[10rem] flex-1 text-xs" />
      <button disabled={busy || !(Number(amount) > 0) || reason.trim().length < 5} onClick={() => { onSubmit(Number(amount), reason.trim()); setAmount(""); setReason(""); }} className="btn text-xs">Request redress</button>
    </div>
  );
}

function Bars({ title, rows, label }: { title: string; rows: { key: string; count: number }[]; label?: Record<string, string> }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div>
      <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">{title}</p>
      {rows.length === 0 && <p className="text-[11px] text-slate-400">No data.</p>}
      {rows.map((r) => (
        <div key={r.key} className="flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300">
          <span className="w-32 truncate">{label?.[r.key] ?? r.key}</span>
          <div className="h-2 flex-1 rounded bg-slate-100 dark:bg-slate-700"><div className="h-2 rounded bg-emerald-500" style={{ width: `${(r.count / max) * 100}%` }} /></div>
          <b className="w-6 text-right">{r.count}</b>
        </div>
      ))}
    </div>
  );
}
const pct = (a: number, b: number) => (b === 0 ? "n/a" : `${Math.round((a / b) * 100)}%`);

function MiSection() {
  const [days, setDays] = useState(90);
  const mi: ComplaintsMi | null = useComplaintsMi(true, days);
  if (!mi) return <div className="flex justify-center py-3"><Loader2 className="h-4 w-4 animate-spin text-emerald-600" /></div>;
  return (
    <div className="space-y-3 rounded-lg bg-slate-50 p-3 dark:bg-slate-800/50">
      <div className="flex items-center justify-between"><p className="text-xs font-bold text-slate-700 dark:text-slate-200">Complaints report</p>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="input w-auto text-xs"><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option><option value={365}>Last 12 months</option></select></div>
      <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        {[["Received", mi.total], ["Open", mi.open], ["Upheld", mi.upheld + mi.partially_upheld], ["Not upheld", mi.not_upheld], ["Acknowledged in time", pct(mi.ack_in_time, mi.ack_total)], ["Final response in time", pct(mi.final_in_time, mi.final_total)],
          ["Avg days to final", mi.avg_days_to_final ?? "n/a"], ["Redress", formatCurrency(Number(mi.redress_total), "GBP")], ["Referred to FOS", mi.fos], ["Vulnerable clients", mi.vulnerable]].map(([k, v]) => (
          <div key={String(k)} className="rounded-lg bg-white p-2 dark:bg-slate-800"><p className="text-[10px] uppercase text-slate-400">{k}</p><p className="text-sm font-bold text-slate-800 dark:text-slate-100">{v}</p></div>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Bars title="By category" rows={mi.by_category} label={CATEGORY_LABEL} />
        <Bars title="By root cause" rows={mi.by_root_cause} label={ROOT_CAUSE_LABEL} />
        <Bars title="By fault" rows={mi.by_fault} label={FAULT_LABEL} />
        <Bars title="By handler" rows={mi.by_handler.map((h) => ({ key: h.key, count: h.count }))} />
      </div>
    </div>
  );
}
