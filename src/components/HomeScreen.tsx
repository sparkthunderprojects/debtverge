import {
  AlertTriangle, ArrowRight, Banknote, CalendarClock, Inbox, Loader2, Plus, ShieldAlert, Users, Wallet, TrendingUp, UserCog,
} from "lucide-react";
import { useAuth, type DvRole } from "@/lib/auth";
import { formatCurrency } from "@/lib/format";
import { daysUntil, useHomeData, type HomeData } from "@/lib/home-hooks";
import type { DebtCase } from "@/lib/types";
import { ClientMoneyPanel } from "@/components/debt/ClientMoneyPanel";
import { ComplaintsPanel } from "@/components/debt/ComplaintsPanel";
import { ReportsPanel } from "@/components/debt/ReportsPanel";
import { FeeRulesPanel } from "@/components/debt/FeeRulesPanel";

type View = "advisor" | "team_manager" | "operations_manager";

const VIEW_LABEL: Record<View, string> = { advisor: "My day", team_manager: "My team", operations_manager: "The business" };

const gbp = (n: number) => formatCurrency(n, "GBP", { compact: n >= 100000 });

function isActive(c: DebtCase) { return c.status === "payment_schedule_active"; }
function overdueDays(c: DebtCase) { const d = daysUntil(c.next_due_date); return isActive(c) && d !== null && d < 0 ? -d : 0; }
function dueSoon(c: DebtCase) { const d = daysUntil(c.next_due_date); return isActive(c) && d !== null && d >= 0 && d <= 3; }

function defaultView(role: DvRole): View {
  return role === "team_manager" ? "team_manager" : role === "operations_manager" ? "operations_manager" : "advisor";
}

export function HomeScreen({ onOpenCase, onNewCase }: { onOpenCase: (id: string) => void; onNewCase: () => void }) {
  const { user, dvRole } = useAuth();
  const { data, loading } = useHomeData();
  const view: View = defaultView(dvRole);

  if (loading) return <div className="flex justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-emerald-600" /></div>;

  if (data.cases.length === 0) {
    return (
      <div className="panel mx-auto mt-10 max-w-lg p-8 text-center">
        <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">No cases yet</h2>
        <p className="mt-1 text-sm text-slate-500">Create the first case, or accept a referral from another platform.</p>
        <button onClick={onNewCase} className="btn btn-primary mt-4 bg-emerald-600 hover:bg-emerald-700"><Plus className="h-4 w-4" /> New case</button>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-1">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">{VIEW_LABEL[view]}</h2>
          <p className="text-xs text-slate-400">{new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</p>
        </div>
      </div>
      {view === "advisor" && <AdvisorHome data={data} userId={user?.id ?? null} onOpenCase={onOpenCase} />}
      {view === "team_manager" && <TeamHome data={data} onOpenCase={onOpenCase} />}
      {view === "operations_manager" && <OpsHome data={data} onOpenCase={onOpenCase} />}
    </div>
  );
}

function Tile({ icon, label, value, tone = "slate", sub }: { icon: React.ReactNode; label: string; value: string | number; tone?: "slate" | "rose" | "amber" | "emerald"; sub?: string }) {
  const tones = { slate: "text-slate-900 dark:text-slate-100", rose: "text-rose-600 dark:text-rose-400", amber: "text-amber-600 dark:text-amber-400", emerald: "text-emerald-600 dark:text-emerald-400" };
  return (
    <div className="panel p-4">
      <div className="flex items-center gap-2 text-slate-400">{icon}<span className="text-[11px] font-bold uppercase tracking-wide">{label}</span></div>
      <p className={`mt-2 text-2xl font-bold ${tones[tone]}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p>}
    </div>
  );
}

function CaseRow({ c, note, tone, onOpen }: { c: DebtCase; note: string; tone: "rose" | "amber" | "slate"; onOpen: () => void }) {
  const dot = tone === "rose" ? "bg-rose-500" : tone === "amber" ? "bg-amber-500" : "bg-slate-300 dark:bg-slate-600";
  return (
    <button onClick={onOpen} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-700/50">
      <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{c.debtor_name}</p>
        <p className="truncate text-[11px] text-slate-400">{c.case_number} · {note}</p>
      </div>
      <ArrowRight className="h-4 w-4 shrink-0 text-slate-300" />
    </button>
  );
}

function Section({ title, count, empty, children }: { title: string; count: number; empty: string; children: React.ReactNode }) {
  return (
    <div className="panel p-2">
      <div className="flex items-center justify-between px-3 py-2">
        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">{title}</h3>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-500 dark:bg-slate-700 dark:text-slate-300">{count}</span>
      </div>
      {count === 0 ? <p className="px-3 pb-3 text-xs text-slate-400">{empty}</p> : <div className="max-h-72 overflow-y-auto">{children}</div>}
    </div>
  );
}

/* ---------------- Advisor ---------------- */
function AdvisorHome({ data, userId, onOpenCase }: { data: HomeData; userId: string | null; onOpenCase: (id: string) => void }) {
  const mine = data.cases.filter((c) => !userId || c.assigned_to === userId || (!c.assigned_to && c.user_id === userId));
  const open = mine.filter((c) => c.status !== "completed" && c.status !== "closed");
  const overdue = open.filter((c) => overdueDays(c) > 0).sort((a, b) => overdueDays(b) - overdueDays(a));
  const soon = open.filter(dueSoon);
  const intake = open.filter((c) => c.status === "intake" || c.status === "sfs_pending");
  const openIds = new Set(open.map((c) => c.id));
  const myTasks = data.tasks.filter((t) => openIds.has(t.case_id));
  const tasksDue = myTasks.filter((t) => t.due_date && (daysUntil(t.due_date) ?? 1) <= 0).sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""));
  const caseById = new Map(open.map((c) => [c.id, c]));
  const withTasks = new Set(myTasks.map((t) => t.case_id));
  const unscheduled = open.filter((c) => !withTasks.has(c.id));

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile icon={<Users className="h-4 w-4" />} label="My open cases" value={open.length} />
        <Tile icon={<AlertTriangle className="h-4 w-4" />} label="Overdue payments" value={overdue.length} tone={overdue.length ? "rose" : "slate"} />
        <Tile icon={<CalendarClock className="h-4 w-4" />} label="Tasks due" value={tasksDue.length} tone={tasksDue.length ? "amber" : "slate"} sub="Overdue or due today" />
        <Tile icon={<Inbox className="h-4 w-4" />} label="New referrals" value={data.pendingReferrals} tone={data.pendingReferrals ? "emerald" : "slate"} sub="Open the inbox icon in the case list" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Needs action today" count={overdue.length + soon.length + tasksDue.length} empty="Nothing urgent. Payments and tasks are on track.">
          {tasksDue.map((t) => { const c = caseById.get(t.case_id); const d = daysUntil(t.due_date) ?? 0; return c ? <CaseRow key={t.id} c={c} tone={d < 0 ? "rose" : "amber"} note={`${t.title} · ${d < 0 ? `${-d}d overdue` : "due today"}`} onOpen={() => onOpenCase(c.id)} /> : null; })}
          {overdue.map((c) => <CaseRow key={c.id} c={c} tone="rose" note={`Payment ${overdueDays(c)}d overdue. Send a link or call.`} onOpen={() => onOpenCase(c.id)} />)}
          {soon.map((c) => <CaseRow key={c.id} c={c} tone="amber" note={`Payment due in ${daysUntil(c.next_due_date)}d`} onOpen={() => onOpenCase(c.id)} />)}
        </Section>
        <Section title="Nothing scheduled" count={unscheduled.length} empty="Every open case has a next step.">
          {unscheduled.map((c) => <CaseRow key={c.id} c={c} tone="slate" note="No open task. Add a next step in the Diary." onOpen={() => onOpenCase(c.id)} />)}
        </Section>
        <Section title="Getting started" count={intake.length} empty="No cases waiting on intake or budget.">
          {intake.map((c) => <CaseRow key={c.id} c={c} tone="slate" note={c.status === "intake" ? "Intake: complete the profile" : "Waiting on budget (SFS) sign-off"} onOpen={() => onOpenCase(c.id)} />)}
        </Section>
      </div>
      <Section title="All my cases" count={open.length} empty="No cases assigned to you yet.">
        {open.map((c) => <CaseRow key={c.id} c={c} tone="slate" note={`${gbp(c.total_debt)} debt`} onOpen={() => onOpenCase(c.id)} />)}
      </Section>
    </>
  );
}

/* ---------------- Team manager ---------------- */
function TeamHome({ data, onOpenCase }: { data: HomeData; onOpenCase: (id: string) => void }) {
  const open = data.cases.filter((c) => c.status !== "completed" && c.status !== "closed");
  const groups = new Map<string, DebtCase[]>();
  for (const c of open) {
    const k = c.assigned_to ?? "unassigned";
    groups.set(k, [...(groups.get(k) ?? []), c]);
  }
  const overdue = open.filter((c) => overdueDays(c) > 0);
  const lateTasks = (list: DebtCase[]) => { const ids = new Set(list.map((c) => c.id)); return data.tasks.filter((t) => ids.has(t.case_id) && t.due_date && (daysUntil(t.due_date) ?? 0) < 0).length; };

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile icon={<Users className="h-4 w-4" />} label="Team open cases" value={open.length} />
        <Tile icon={<AlertTriangle className="h-4 w-4" />} label="Overdue payments" value={overdue.length} tone={overdue.length ? "rose" : "slate"} />
        <Tile icon={<UserCog className="h-4 w-4" />} label="Awaiting your approval" value={data.pendingChangeRequests} tone={data.pendingChangeRequests ? "amber" : "slate"} sub={data.flaggedChangeRequests ? `${data.flaggedChangeRequests} flagged vulnerability` : "Care and contact changes"} />
        <Tile icon={<ShieldAlert className="h-4 w-4" />} label="High vulnerability" value={data.highVulnerability} tone={data.highVulnerability ? "rose" : "slate"} />
      </div>
      <div className="panel overflow-hidden">
        <div className="px-4 py-3"><h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Caseload by advisor</h3></div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-y border-slate-100 text-left text-[11px] uppercase tracking-wide text-slate-400 dark:border-slate-700">
              <th className="px-4 py-2">Advisor</th><th className="px-2 py-2 text-right">Cases</th><th className="px-2 py-2 text-right">Overdue</th><th className="px-2 py-2 text-right">Tasks late</th><th className="px-2 py-2 text-right">Debt</th>
            </tr>
          </thead>
          <tbody>
            {Array.from(groups.entries()).map(([k, list]) => (
              <tr key={k} className="border-b border-slate-50 dark:border-slate-700/50">
                <td className="px-4 py-2.5 font-semibold text-slate-800 dark:text-slate-100">{k === "unassigned" ? "Unassigned" : data.names[k] ?? "Advisor"}</td>
                <td className="px-2 py-2.5 text-right">{list.length}</td>
                <td className={`px-2 py-2.5 text-right font-semibold ${list.some((c) => overdueDays(c) > 0) ? "text-rose-600" : "text-slate-400"}`}>{list.filter((c) => overdueDays(c) > 0).length}</td>
                <td className={`px-2 py-2.5 text-right font-semibold ${lateTasks(list) > 0 ? "text-amber-600" : "text-slate-400"}`}>{lateTasks(list)}</td>
                <td className="px-2 py-2.5 text-right">{gbp(list.reduce((s, c) => s + Number(c.total_debt ?? 0), 0))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ClientMoneyPanel onOpenCase={onOpenCase} />
      <ComplaintsPanel onOpenCase={onOpenCase} />
      <ReportsPanel />
      <FeeRulesPanel />
      <Section title="Overdue across the team" count={overdue.length} empty="No overdue payments.">
        {overdue.map((c) => <CaseRow key={c.id} c={c} tone="rose" note={`${data.names[c.assigned_to ?? ""] ?? "Unassigned"} · ${overdueDays(c)}d overdue`} onOpen={() => onOpenCase(c.id)} />)}
      </Section>
    </>
  );
}

/* ---------------- Operations manager ---------------- */
function OpsHome({ data, onOpenCase }: { data: HomeData; onOpenCase: (id: string) => void }) {
  const active = data.cases.filter(isActive);
  const open = data.cases.filter((c) => c.status !== "completed" && c.status !== "closed");
  const expected = active.reduce((s, c) => s + Number(c.installment_amount ?? 0), 0);
  const rate = expected > 0 ? Math.round((data.collected30d / expected) * 100) : 0;
  const overdue = open.filter((c) => overdueDays(c) > 0);
  const lateTasks = data.tasks.filter((t) => t.due_date && (daysUntil(t.due_date) ?? 0) < 0).length;
  const byStatus = new Map<string, number>();
  for (const c of open) byStatus.set(c.status, (byStatus.get(c.status) ?? 0) + 1);

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile icon={<Users className="h-4 w-4" />} label="Active plans" value={active.length} sub={`${open.length} open cases in total`} />
        <Tile icon={<Wallet className="h-4 w-4" />} label="Debt under management" value={gbp(open.reduce((s, c) => s + Number(c.total_debt ?? 0), 0))} />
        <Tile icon={<Banknote className="h-4 w-4" />} label="Expected monthly" value={gbp(expected)} />
        <Tile icon={<TrendingUp className="h-4 w-4" />} label="Collected, 30 days" value={gbp(data.collected30d)} tone={rate >= 90 ? "emerald" : "amber"} sub={`${rate}% of expected`} />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile icon={<AlertTriangle className="h-4 w-4" />} label="Overdue payments" value={overdue.length} tone={overdue.length ? "rose" : "slate"} />
        <Tile icon={<AlertTriangle className="h-4 w-4" />} label="Shortfalls, 30 days" value={data.shortfalls30d} tone={data.shortfalls30d ? "amber" : "slate"} />
        <Tile icon={<ShieldAlert className="h-4 w-4" />} label="High vulnerability" value={data.highVulnerability} tone={data.highVulnerability ? "rose" : "slate"} />
        <Tile icon={<CalendarClock className="h-4 w-4" />} label="Tasks overdue" value={lateTasks} tone={lateTasks ? "amber" : "slate"} sub="Across the firm" />
        <Tile icon={<Banknote className="h-4 w-4" />} label="Creditor payouts" value={data.distributionsScheduled} sub={data.distributionsFailed ? `${data.distributionsFailed} failed` : "scheduled, none failed"} tone={data.distributionsFailed ? "rose" : "slate"} />
      </div>
      <ClientMoneyPanel onOpenCase={onOpenCase} />
      <ComplaintsPanel onOpenCase={onOpenCase} />
      <ReportsPanel />
      <FeeRulesPanel />
      <div className="panel p-4">
        <h3 className="mb-3 text-sm font-bold text-slate-800 dark:text-slate-100">Cases by stage</h3>
        <div className="space-y-2">
          {Array.from(byStatus.entries()).map(([s, n]) => (
            <div key={s} className="flex items-center gap-3 text-xs">
              <span className="w-44 shrink-0 capitalize text-slate-600 dark:text-slate-300">{s.replace(/_/g, " ")}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${(n / Math.max(open.length, 1)) * 100}%` }} /></div>
              <span className="w-6 text-right font-bold text-slate-700 dark:text-slate-200">{n}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
