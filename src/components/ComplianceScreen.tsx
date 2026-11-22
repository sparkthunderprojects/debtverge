import { useEffect, useState } from "react";
import { BarChart3, ClipboardCheck, FileText, GraduationCap, History, Loader2, Search, Settings, ShieldAlert, Workflow, X } from "lucide-react";
import { CallRecord } from "@/components/compliance/CallRecord";
import { AuditSection, CoachingSection, DashboardSection, QaSection, ReportSection, RiskSection, ScriptEditor, SearchSection, SettingsSection, WorkflowSection } from "@/components/compliance/Sections";
import { COACHING_TYPES, fetchMyCoaching, fmtDate, updateCoaching, type CoachingRow } from "@/lib/call-hooks";

type Tab = "dashboard" | "search" | "qa" | "workflows" | "risks" | "coaching" | "audit" | "reports" | "settings";
const TABS: [Tab, string, typeof Search][] = [
  ["dashboard", "Dashboard", BarChart3], ["search", "Call search", Search], ["qa", "Adviser QA", ClipboardCheck], ["workflows", "Workflows", Workflow], ["risks", "Risks", ShieldAlert],
  ["coaching", "Coaching", GraduationCap], ["audit", "Audit log", History], ["reports", "Reports", FileText], ["settings", "Settings", Settings],
];

/** The call compliance portal for managers: oversight of every call, the review workflow, adviser quality, risks, coaching, the access log and reports. */
export function ComplianceScreen({ initialCall }: { initialCall?: string | null }) {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [call, setCall] = useState<string | null>(initialCall ?? null);
  const [coachFor, setCoachFor] = useState<string | undefined>();
  const [bump, setBump] = useState(0);
  useEffect(() => { if (initialCall) setCall(initialCall); }, [initialCall]);
  useEffect(() => {
    if (!call) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setCall(null); };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [call]);
  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4">
      <div className="flex items-center gap-2"><ClipboardCheck className="h-5 w-5 text-brand-600" /><h1 className="text-lg font-bold">Call compliance</h1></div>
      <nav className="flex flex-wrap gap-1 border-b border-slate-200 dark:border-slate-700" role="tablist">
        {TABS.map(([k, label, Icon]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`flex items-center gap-1.5 px-3 py-2 text-sm font-semibold ${tab === k ? "border-b-2 border-brand-600 text-brand-700" : "text-slate-500 hover:text-slate-700"}`}><Icon className="h-4 w-4" />{label}</button>)}
      </nav>
      <div key={`${tab}-${bump}`}>
        {tab === "dashboard" && <DashboardSection open={setCall} goto={(t) => setTab(t as Tab)} />}
        {tab === "search" && <SearchSection open={setCall} />}
        {tab === "qa" && <QaSection openCoach={(id) => { setCoachFor(id); setTab("coaching"); }} />}
        {tab === "workflows" && <WorkflowSection open={setCall} />}
        {tab === "risks" && <RiskSection open={setCall} />}
        {tab === "coaching" && <CoachingSection preselect={coachFor} />}
        {tab === "audit" && <AuditSection open={setCall} />}
        {tab === "reports" && <ReportSection />}
        {tab === "settings" && <div className="space-y-4"><SettingsSection /><ScriptEditor /></div>}
      </div>
      {call && (
        <div className="fixed inset-0 z-[80] flex justify-end bg-slate-900/40" onClick={() => setCall(null)} role="presentation">
          <aside className="h-full w-full max-w-3xl overflow-y-auto bg-white p-5 shadow-2xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Call record">
            <div className="mb-3 flex justify-end"><button onClick={() => setCall(null)} className="rounded p-1 hover:bg-slate-100 dark:hover:bg-slate-700" aria-label="Close"><X className="h-5 w-5" /></button></div>
            <CallRecord callId={call} onChanged={() => setBump((n) => n + 1)} />
          </aside>
        </div>
      )}
    </div>
  );
}

/** What an adviser sees of their own coaching: what was asked, when, and a place to say it is done. */
export function MyCoaching() {
  const [rows, setRows] = useState<CoachingRow[] | null>(null);
  const [done, setDone] = useState<{ id: string; text: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = () => fetchMyCoaching().then(setRows).catch(() => setRows([]));
  useEffect(() => { void load(); }, []);
  if (!rows) return <Loader2 className="h-4 w-4 animate-spin text-slate-400" />;
  const open = rows.filter((r) => ["open", "in_progress"].includes(r.status));
  if (open.length === 0) return null;
  return (
    <div className="panel space-y-2 border-amber-200 bg-amber-50/60 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
      <p className="text-xs font-bold uppercase tracking-wide text-amber-800 dark:text-amber-200">Coaching for you</p>
      {err && <p className="text-xs text-rose-600">{err}</p>}
      {open.map((r) => (
        <div key={r.id} className="text-sm"><p className="font-semibold">{r.title} <span className="text-xs font-normal text-slate-500">· {COACHING_TYPES[r.action_type] ?? r.action_type}{r.due_date ? ` · due ${fmtDate(r.due_date)}` : ""}{r.overdue ? " · overdue" : ""}</span></p>
          {r.description && <p className="text-xs text-slate-600 dark:text-slate-300">{r.description}</p>}
          {done?.id === r.id ? (
            <div className="mt-1.5 flex gap-2"><input className="input !py-1 text-xs" placeholder="What did you do?" value={done.text} onChange={(e) => setDone({ id: r.id, text: e.target.value })} /><button disabled={done.text.trim().length < 5} className="btn btn-primary px-2.5 py-1 text-xs" onClick={() => updateCoaching(r.id, "completed", done.text).then(() => { setDone(null); void load(); }).catch((e) => setErr((e as Error).message))}>Done</button></div>
          ) : (
            <div className="mt-1 flex gap-3 text-xs">{r.status === "open" && <button className="text-brand-600 underline" onClick={() => updateCoaching(r.id, "in_progress", "").then(load).catch((e) => setErr((e as Error).message))}>Started</button>}<button className="text-brand-600 underline" onClick={() => setDone({ id: r.id, text: "" })}>Mark as done</button></div>
          )}
        </div>
      ))}
    </div>
  );
}
