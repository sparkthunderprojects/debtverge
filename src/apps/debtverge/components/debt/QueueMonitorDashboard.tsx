import { useState, useMemo } from "react";
import {
  Activity, Zap, RefreshCw, CheckCircle2, XCircle, AlertCircle, Clock,
  Layers, ArrowRightLeft, Building2, BookOpen, Repeat, RotateCw, CreditCard,
  Play, Trash2, Eye, TrendingUp, Gauge, Server, ChevronDown, ChevronUp,
  ListChecks, Filter, Cpu,
} from "lucide-react";
import { formatCurrency, formatDateShort } from "@/core/format";
import { useOrganizations } from "@/apps/debtverge/lib/workspace-hooks";
import {
  useBackgroundJobs, useJobEvents, enqueueBackgroundJob,
  triggerQueueWorker, requeueStaleJobs, deleteBackgroundJob, retryBackgroundJob,
  computeQueueMetrics,
} from "@/apps/debtverge/lib/queue-hooks";
import type {
  BackgroundJob, BackgroundJobType, BackgroundJobStatus,
} from "@/core/types";
import {
  JOB_TYPE_META, JOB_STATUS_META, JOB_EVENT_META,
} from "@/core/types";
import { Modal, Field } from "@/apps/debtverge/components/projects/SharedUI";

type StatusFilter = "all" | BackgroundJobStatus;

const JOB_TYPE_ICONS: Record<BackgroundJobType, typeof Layers> = {
  batch_collection: Layers,
  disbursement_run: ArrowRightLeft,
  bank_reconciliation: Building2,
  ledger_posting: BookOpen,
  recurring_collection: Repeat,
  retry_failed: RotateCw,
  expired_card_check: CreditCard,
};

export function QueueMonitorDashboard() {
  const { data: orgs } = useOrganizations();
  const orgId = orgs[0]?.id ?? null;
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const { data: jobs, loading, error } = useBackgroundJobs(orgId, statusFilter === "all" ? undefined : statusFilter);
  const [selectedJob, setSelectedJob] = useState<string | null>(null);
  const [triggering, setTriggering] = useState(false);
  const [requeuing, setRequeuing] = useState(false);
  const [showEnqueueForm, setShowEnqueueForm] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const metrics = useMemo(() => computeQueueMetrics(jobs), [jobs]);

  const handleTriggerWorker = async () => {
    setTriggering(true); setActionError(null);
    try {
      const result = await triggerQueueWorker();
      setActionSuccess(`Worker processed ${result.processed} chunks: ${result.succeeded} succeeded, ${result.failed} failed, ${result.throttled} throttled. ${result.requeuedStale} stale jobs requeued.`);
      setTimeout(() => setActionSuccess(null), 6000);
    } catch (e) { setActionError((e as Error).message); }
    setTriggering(false);
  };

  const handleRequeueStale = async () => {
    setRequeuing(true); setActionError(null);
    try {
      const count = await requeueStaleJobs(5);
      setActionSuccess(`Requeued ${count} stale jobs`);
      setTimeout(() => setActionSuccess(null), 3000);
    } catch (e) { setActionError((e as Error).message); }
    setRequeuing(false);
  };

  const handleRetry = async (jobId: string) => {
    try {
      await retryBackgroundJob(jobId);
      setActionSuccess("Job retried — back in queue");
      setTimeout(() => setActionSuccess(null), 3000);
    } catch (e) { setActionError((e as Error).message); }
  };

  const handleDelete = async (jobId: string) => {
    if (!confirm("Remove this job from the queue?")) return;
    try {
      await deleteBackgroundJob(jobId);
    } catch (e) { setActionError((e as Error).message); }
  };

  if (!orgId) {
    return (
      <div className="panel p-8 text-center">
        <AlertCircle className="mx-auto mb-3 h-8 w-8 text-amber-500" />
        <p className="text-sm text-slate-500">No organization found. Ensure you are a member of an organization to view the job queue.</p>
      </div>
    );
  }

  if (loading) return <div className="skeleton h-40 rounded-xl" />;

  return (
    <div className="space-y-4">
      {actionError && <div className="rounded-xl bg-rose-50 px-4 py-2 text-sm text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">{actionError}</div>}
      {actionSuccess && <div className="rounded-xl bg-emerald-50 px-4 py-2 text-sm text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">{actionSuccess}</div>}

      {/* Header with action buttons */}
      <div className="panel flex flex-wrap items-center justify-between gap-3 p-4 fade-in">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 to-blue-600 text-white shadow-lg">
            <Cpu className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Background Job Queue Monitor</h3>
            <p className="text-xs text-slate-400">Real-time async processing — bulk collections, distributions, and ledger postings run without blocking the UI</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={handleTriggerWorker} disabled={triggering} className="btn btn-primary bg-indigo-600 text-sm hover:bg-indigo-700 disabled:opacity-50">
            {triggering ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Process Queue
          </button>
          <button onClick={handleRequeueStale} disabled={requeuing} className="btn btn-secondary text-sm disabled:opacity-50">
            {requeuing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
            Requeue Stale
          </button>
          <button onClick={() => setShowEnqueueForm(true)} className="btn btn-secondary text-sm">
            <Layers className="h-4 w-4" /> Enqueue Job
          </button>
        </div>
      </div>

      {/* Metrics dashboard */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard icon={<Clock className="h-4 w-4" />} label="Queued" value={metrics.queued} color="slate" />
        <MetricCard icon={<Activity className="h-4 w-4" />} label="Processing" value={metrics.processing} color="blue" />
        <MetricCard icon={<CheckCircle2 className="h-4 w-4" />} label="Completed" value={metrics.completed} color="emerald" />
        <MetricCard icon={<XCircle className="h-4 w-4" />} label="Failed" value={metrics.failed} color="rose" />
      </div>

      {/* Throughput metrics */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="panel p-3 fade-in">
          <div className="flex items-center gap-2"><Gauge className="h-4 w-4 text-blue-500" /><p className="text-[10px] font-bold uppercase text-slate-400">Items Processed</p></div>
          <p className="text-lg font-bold text-slate-700 dark:text-slate-200">{metrics.totalProcessed}</p>
        </div>
        <div className="panel p-3 fade-in">
          <div className="flex items-center gap-2"><TrendingUp className="h-4 w-4 text-emerald-500" /><p className="text-[10px] font-bold uppercase text-slate-400">Success Rate</p></div>
          <p className="text-lg font-bold text-emerald-600">{metrics.successRate}%</p>
        </div>
        <div className="panel p-3 fade-in">
          <div className="flex items-center gap-2"><AlertCircle className="h-4 w-4 text-amber-500" /><p className="text-[10px] font-bold uppercase text-slate-400">Throttled</p></div>
          <p className="text-lg font-bold text-amber-600">{metrics.totalThrottled}</p>
        </div>
        <div className="panel p-3 fade-in">
          <div className="flex items-center gap-2"><Server className="h-4 w-4 text-indigo-500" /><p className="text-[10px] font-bold uppercase text-slate-400">Queue Depth</p></div>
          <p className="text-lg font-bold text-slate-700 dark:text-slate-200">{metrics.totalItems - metrics.totalProcessed}</p>
        </div>
      </div>

      {/* Filter bar */}
      <div className="panel flex items-center gap-2 p-3 fade-in">
        <Filter className="h-4 w-4 text-slate-400" />
        <div className="flex gap-1">
          {(["all", "queued", "processing", "completed", "failed", "throttled"] as StatusFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={`rounded-lg px-2.5 py-1 text-[10px] font-medium transition-all ${
                statusFilter === f ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400"
              }`}
            >
              {f === "all" ? "All" : JOB_STATUS_META[f as BackgroundJobStatus].label}
            </button>
          ))}
        </div>
      </div>

      {/* Job list */}
      {jobs.length === 0 ? (
        <div className="panel p-8 text-center">
          <Cpu className="mx-auto mb-3 h-8 w-8 text-slate-300 dark:text-slate-600" />
          <p className="text-sm text-slate-500">No background jobs in the queue. Jobs are enqueued automatically when batch collections, disbursement runs, or bank reconciliations are triggered.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {jobs.map((job) => (
            <JobRow
              key={job.id}
              job={job}
              onExpand={() => setSelectedJob(selectedJob === job.id ? null : job.id)}
              isExpanded={selectedJob === job.id}
              onRetry={() => handleRetry(job.id)}
              onDelete={() => handleDelete(job.id)}
            />
          ))}
        </div>
      )}

      {showEnqueueForm && (
        <EnqueueJobModal orgId={orgId} onClose={() => setShowEnqueueForm(false)} onEnqueued={() => { setShowEnqueueForm(false); setActionSuccess("Job enqueued successfully"); setTimeout(() => setActionSuccess(null), 3000); }} />
      )}

      {selectedJob && <JobEventsDrawer jobId={selectedJob} onClose={() => setSelectedJob(null)} />}
    </div>
  );
}

function MetricCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color: string }) {
  const colorMap: Record<string, string> = {
    slate: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
    blue: "bg-blue-100 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400",
    emerald: "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400",
    rose: "bg-rose-100 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400",
  };
  return (
    <div className="panel p-3 fade-in">
      <div className="flex items-center gap-2">
        <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${colorMap[color]}`}>{icon}</div>
        <div>
          <p className="text-[10px] font-bold uppercase text-slate-400">{label}</p>
          <p className="text-lg font-bold text-slate-700 dark:text-slate-200">{value}</p>
        </div>
      </div>
    </div>
  );
}

function JobRow({ job, onExpand, isExpanded, onRetry, onDelete }: {
  job: BackgroundJob;
  onExpand: () => void;
  isExpanded: boolean;
  onRetry: () => void;
  onDelete: () => void;
}) {
  const Icon = JOB_TYPE_ICONS[job.job_type] ?? Layers;
  const progressPct = job.total_items > 0 ? Math.round((job.processed_items / job.total_items) * 100) : 0;
  const isStale = job.status === "claimed" || job.status === "processing"
    ? (Date.now() - new Date(job.last_progress_at ?? job.claimed_at ?? Date.now()).getTime()) > 5 * 60 * 1000
    : false;

  return (
    <div className="panel p-3 fade-in">
      <div className="flex items-center gap-3">
        <button onClick={onExpand} className="flex items-center gap-3 text-left">
          {isExpanded ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800">
            <Icon className="h-4 w-4 text-slate-500" />
          </div>
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${JOB_TYPE_META[job.job_type].color}`}>
              {JOB_TYPE_META[job.job_type].label.toUpperCase()}
            </span>
            <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${JOB_STATUS_META[job.status].color}`}>
              {JOB_STATUS_META[job.status].label.toUpperCase()}
            </span>
            {isStale && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-bold text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">STALE</span>}
            {job.retry_count > 0 && <span className="text-[9px] text-slate-400">Retry {job.retry_count}/{job.max_retries}</span>}
          </div>
          <div className="mt-1 flex items-center gap-3 text-[10px] text-slate-400">
            <span>{job.processed_items}/{job.total_items} items ({progressPct}%)</span>
            <span className="text-emerald-500">{job.succeeded_items} ok</span>
            <span className="text-rose-500">{job.failed_items} fail</span>
            {job.throttled_items > 0 && <span className="text-amber-500">{job.throttled_items} throttled</span>}
            <span>· {formatDateShort(job.created_at)}</span>
            {job.claimed_by && <span className="text-indigo-400">· {job.claimed_by}</span>}
          </div>
          {/* Progress bar */}
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
            <div
              className={`h-full rounded-full transition-all ${job.status === "failed" ? "bg-rose-500" : job.status === "completed" ? "bg-emerald-500" : "bg-blue-500"}`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
        <div className="flex items-center gap-1">
          {job.status === "failed" && (
            <button onClick={onRetry} className="btn btn-secondary text-[10px] px-2 py-1" title="Retry">
              <RotateCw className="h-3 w-3" /> Retry
            </button>
          )}
          {(job.status === "completed" || job.status === "failed") && (
            <button onClick={onDelete} className="btn text-[10px] px-1.5 py-1 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10" title="Remove">
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function JobEventsDrawer({ jobId, onClose }: { jobId: string; onClose: () => void }) {
  const { data: events, loading } = useJobEvents(jobId);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-end bg-black/40 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <div className="flex h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl dark:bg-slate-800 sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 p-4 dark:border-slate-700">
          <div className="flex items-center gap-2">
            <ListChecks className="h-5 w-5 text-indigo-500" />
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Job Event Log</h3>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700">✕</button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="skeleton h-20 rounded-lg" />
          ) : events.length === 0 ? (
            <p className="text-sm text-slate-400">No events recorded yet.</p>
          ) : (
            <div className="space-y-2">
              {events.map((event) => (
                <div key={event.id} className="flex items-start gap-2 rounded-lg border border-slate-100 p-2 dark:border-slate-700/50">
                  <div className="mt-0.5">
                    {event.event_type === "item_succeeded" ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> :
                     event.event_type === "item_failed" ? <XCircle className="h-3.5 w-3.5 text-rose-500" /> :
                     event.event_type === "throttled" ? <AlertCircle className="h-3.5 w-3.5 text-amber-500" /> :
                     event.event_type === "claimed" ? <Cpu className="h-3.5 w-3.5 text-indigo-500" /> :
                     event.event_type === "completed" ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> :
                     event.event_type === "failed" ? <XCircle className="h-3.5 w-3.5 text-rose-500" /> :
                     <Activity className="h-3.5 w-3.5 text-slate-400" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={`text-xs font-medium ${JOB_EVENT_META[event.event_type]?.color ?? "text-slate-500"}`}>
                      {JOB_EVENT_META[event.event_type]?.label ?? event.event_type}
                    </p>
                    {event.message && <p className="text-[10px] text-slate-400">{event.message}</p>}
                    <p className="text-[9px] text-slate-300 dark:text-slate-500">{new Date(event.created_at).toLocaleTimeString()}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function EnqueueJobModal({ orgId, onClose, onEnqueued }: {
  orgId: string;
  onClose: () => void;
  onEnqueued: () => void;
}) {
  const [jobType, setJobType] = useState<BackgroundJobType>("batch_collection");
  const [priority, setPriority] = useState("5");
  const [chunkSize, setChunkSize] = useState("25");
  const [rateLimitMs, setRateLimitMs] = useState("500");
  const [batchRunId, setBatchRunId] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleEnqueue = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setErr(null);
    try {
      const payload: Record<string, unknown> = { organization_id: orgId };
      if (batchRunId) payload.batch_run_id = batchRunId;

      await enqueueBackgroundJob(orgId, {
        job_type: jobType,
        payload,
        total_items: 0,
        priority: parseInt(priority) || 5,
        chunk_size: parseInt(chunkSize) || 25,
        rate_limit_ms: parseInt(rateLimitMs) || 500,
      });
      onEnqueued();
    } catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  };

  const jobTypeOptions: { value: BackgroundJobType; label: string }[] = [
    { value: "batch_collection", label: "Batch Collection" },
    { value: "disbursement_run", label: "Disbursement Run" },
    { value: "bank_reconciliation", label: "Bank Reconciliation" },
    { value: "recurring_collection", label: "Recurring Collection" },
    { value: "retry_failed", label: "Retry Failed Transactions" },
    { value: "expired_card_check", label: "Expired Card Check" },
    { value: "ledger_posting", label: "Ledger Posting" },
  ];

  return (
    <Modal title="Enqueue Background Job" onClose={onClose}>
      <form onSubmit={handleEnqueue} className="space-y-3">
        {err && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">{err}</div>}
        <div className="rounded-lg bg-indigo-50 px-3 py-2 text-[11px] text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300">
          <Cpu className="mr-1 inline h-3 w-3" />
          Jobs are processed asynchronously by background workers. The UI remains responsive while jobs run.
        </div>
        <Field label="Job Type">
          <select value={jobType} onChange={(e) => setJobType(e.target.value as BackgroundJobType)} className="input text-sm">
            {jobTypeOptions.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-3 gap-2">
          <Field label="Priority (1-10)"><input type="number" min="1" max="10" value={priority} onChange={(e) => setPriority(e.target.value)} className="input text-sm" /></Field>
          <Field label="Chunk Size"><input type="number" value={chunkSize} onChange={(e) => setChunkSize(e.target.value)} className="input text-sm" /></Field>
          <Field label="Rate Limit (ms)"><input type="number" value={rateLimitMs} onChange={(e) => setRateLimitMs(e.target.value)} className="input text-sm" /></Field>
        </div>
        {(jobType === "batch_collection" || jobType === "disbursement_run") && (
          <Field label="Batch/Run ID (optional)"><input value={batchRunId} onChange={(e) => setBatchRunId(e.target.value)} className="input text-sm font-mono" placeholder="uuid of the batch run" /></Field>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn btn-secondary text-sm">Cancel</button>
          <button type="submit" disabled={saving} className="btn btn-primary bg-indigo-600 text-sm hover:bg-indigo-700">{saving ? "Enqueuing..." : "Enqueue Job"}</button>
        </div>
      </form>
    </Modal>
  );
}
