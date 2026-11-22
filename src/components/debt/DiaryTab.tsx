import { useMemo, useState } from "react";
import { CalendarClock, Check, CheckCircle2, Clock, Phone, Plus, RotateCcw, ShieldCheck, StickyNote, ClipboardList, RefreshCw } from "lucide-react";
import { useAuth } from "../../lib/auth";
import { useCaseTasks, createTask, setTaskStatus, snoozeTask, logDiaryNote, TASK_KIND_LABEL, type CaseTask, type TaskKind } from "../../lib/task-hooks";
import type { DebtCase } from "../../lib/types";
import { ComplaintsPanel } from "./ComplaintsPanel";

const KIND_ICON: Record<TaskKind, React.ReactNode> = {
  task: <ClipboardList className="h-4 w-4" />, call: <Phone className="h-4 w-4" />, statutory: <ShieldCheck className="h-4 w-4" />,
  review: <RefreshCw className="h-4 w-4" />, note: <StickyNote className="h-4 w-4" />,
};
const today = () => new Date().toISOString().slice(0, 10);
const fmt = (d: string | null) => (d ? new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "No date");
const daysFrom = (d: string) => Math.round((new Date(d + "T00:00:00").getTime() - new Date(today() + "T00:00:00").getTime()) / 86400000);

export function DiaryTab({ caseId, caseData }: { caseId: string | null; caseData: DebtCase | null }) {
  const { user } = useAuth();
  const { tasks, loading, error, reload } = useCaseTasks(caseId);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<TaskKind>("task");
  const [due, setDue] = useState(today());
  const [note, setNote] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const open = useMemo(() => tasks.filter((t) => t.status === "open"), [tasks]);
  const done = useMemo(() => tasks.filter((t) => t.status !== "open").sort((a, b) => (b.completed_at ?? b.created_at).localeCompare(a.completed_at ?? a.created_at)), [tasks]);
  const overdue = open.filter((t) => t.due_date && daysFrom(t.due_date) < 0);
  const dueToday = open.filter((t) => t.due_date && daysFrom(t.due_date) === 0);
  const later = open.filter((t) => !t.due_date || daysFrom(t.due_date) > 0);

  if (!caseId || !caseData) return <div className="flex h-full items-center justify-center text-sm text-slate-400">Select a case to see its diary</div>;

  async function run(fn: () => Promise<void>) {
    setErr(null);
    try { await fn(); await reload(); } catch (e) { setErr((e as Error).message); }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !caseId) return;
    await run(async () => {
      await createTask({ case_id: caseId, title: title.trim(), kind, due_date: due || null, assigned_to: caseData?.assigned_to ?? user?.id ?? null, organization_id: caseData?.organization_id ?? null });
      setTitle("");
    });
  }

  async function addNote(e: React.FormEvent) {
    e.preventDefault();
    if (!note.trim() || !caseId) return;
    await run(async () => { await logDiaryNote(caseId, note.trim(), "note", user?.id ?? null, caseData?.organization_id ?? null); setNote(""); });
  }

  const Row = ({ t }: { t: CaseTask }) => {
    const d = t.due_date ? daysFrom(t.due_date) : null;
    const tone = t.status !== "open" ? "text-slate-400" : d !== null && d < 0 ? "text-rose-600" : d === 0 ? "text-amber-600" : "text-slate-500";
    return (
      <div className="flex items-center gap-3 rounded-lg border border-slate-100 p-2.5 dark:border-slate-700/50">
        <button
          onClick={() => run(() => setTaskStatus(t.id, t.status === "open" ? "done" : "open", user?.id ?? null))}
          className={`flex h-6 w-6 flex-none items-center justify-center rounded-full border ${t.status === "open" ? "border-slate-300 text-transparent hover:border-emerald-500 hover:text-emerald-500" : "border-emerald-500 bg-emerald-500 text-white"}`}
          title={t.status === "open" ? "Mark done" : "Reopen"}
        >
          <Check className="h-3.5 w-3.5" />
        </button>
        <span className="flex-none text-slate-400">{KIND_ICON[t.kind]}</span>
        <div className="min-w-0 flex-1">
          <p className={`truncate text-sm font-medium ${t.status === "open" ? "text-slate-800 dark:text-slate-100" : "text-slate-400 line-through"}`}>{t.title}</p>
          <p className={`text-xs ${tone}`}>
            {t.status === "open"
              ? <>{t.due_date ? (d! < 0 ? `${-d!}d overdue` : d === 0 ? "Due today" : `Due ${fmt(t.due_date)}`) : "No date"}{t.kind === "statutory" ? " · required" : ""}{t.source === "auto" ? " · auto" : ""}</>
              : <>{t.kind === "note" ? "Note" : "Done"} {fmt((t.completed_at ?? t.created_at).slice(0, 10))}</>}
          </p>
        </div>
        {t.status === "open" && (
          <div className="hidden gap-1 sm:flex">
            <button onClick={() => run(() => snoozeTask(t.id, 1))} className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700">+1d</button>
            <button onClick={() => run(() => snoozeTask(t.id, 7))} className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700">+1w</button>
          </div>
        )}
      </div>
    );
  };

  const Group = ({ label, list, tone }: { label: string; list: CaseTask[]; tone: string }) =>
    list.length === 0 ? null : (
      <div>
        <p className={`mb-1.5 text-xs font-semibold uppercase tracking-wide ${tone}`}>{label} ({list.length})</p>
        <div className="space-y-1.5">{list.map((t) => <Row key={t.id} t={t} />)}</div>
      </div>
    );

  return (
    <div className="space-y-4">
      {(err || error) && <div className="rounded-xl bg-rose-50 px-4 py-2 text-sm text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">{err ?? error}</div>}

      <form onSubmit={add} className="panel flex flex-wrap items-center gap-2 p-3">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a task or reminder (e.g. Call client about missed payment)" className="input min-w-[220px] flex-1 text-sm" />
        <select value={kind} onChange={(e) => setKind(e.target.value as TaskKind)} className="input w-28 text-sm">
          {(["task", "call", "review"] as TaskKind[]).map((k) => <option key={k} value={k}>{TASK_KIND_LABEL[k]}</option>)}
        </select>
        <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="input w-40 text-sm" />
        <button type="submit" disabled={!title.trim()} className="btn btn-primary text-sm disabled:opacity-40"><Plus className="h-4 w-4" /> Add</button>
      </form>

      {loading ? (
        <div className="skeleton h-40 rounded-xl" />
      ) : open.length === 0 ? (
        <div className="panel flex items-center gap-3 p-5 text-sm text-slate-500"><CheckCircle2 className="h-5 w-5 text-emerald-500" /> Nothing outstanding on this case.</div>
      ) : (
        <div className="panel space-y-4 p-4">
          <Group label="Overdue" list={overdue} tone="text-rose-600" />
          <Group label="Due today" list={dueToday} tone="text-amber-600" />
          <Group label="Coming up" list={later} tone="text-slate-400" />
        </div>
      )}

      <form onSubmit={addNote} className="panel flex items-center gap-2 p-3">
        <StickyNote className="h-4 w-4 flex-none text-slate-400" />
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Log a case note (e.g. Spoke to client, agreed new payment date)" className="input flex-1 text-sm" />
        <button type="submit" disabled={!note.trim()} className="btn btn-secondary text-sm disabled:opacity-40">Log note</button>
      </form>

      <div className="panel p-4">
        <button onClick={() => setShowDone((v) => !v)} className="flex w-full items-center justify-between text-sm font-bold text-slate-800 dark:text-slate-100">
          <span className="flex items-center gap-2"><Clock className="h-4 w-4 text-slate-400" /> History <span className="text-xs font-normal text-slate-400">({done.length})</span></span>
          <RotateCcw className={`h-4 w-4 text-slate-400 transition-transform ${showDone ? "rotate-180" : ""}`} />
        </button>
        {showDone && (
          <div className="mt-3 space-y-1.5">
            {done.length === 0 ? <p className="text-xs text-slate-400">Completed tasks and notes will appear here.</p> : done.map((t) => <Row key={t.id} t={t} />)}
          </div>
        )}
      </div>
      <ComplaintsPanel caseId={caseId} defaultName={caseData.debtor_name} />
      <p className="flex items-center gap-1.5 text-xs text-slate-400"><CalendarClock className="h-3.5 w-3.5" /> Tasks are created automatically as the case moves through its stages.</p>
    </div>
  );
}
