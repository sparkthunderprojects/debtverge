import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabase";
import type {
  BackgroundJob, BackgroundJobEvent, BackgroundJobType,
} from "@/lib/types";

// ============================================================
// Enqueue a background job
// ============================================================

export async function enqueueBackgroundJob(orgId: string, job: {
  job_type: BackgroundJobType;
  payload?: Record<string, unknown>;
  total_items?: number;
  chunk_size?: number;
  priority?: number;
  rate_limit_ms?: number;
  max_retries?: number;
}): Promise<BackgroundJob> {
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase.from("background_jobs").insert({
    organization_id: orgId,
    created_by: user?.id ?? null,
    ...job,
  }).select().single();
  if (error) throw new Error(error.message);

  // Log enqueue event
  await supabase.from("background_job_events").insert({
    job_id: data.id,
    event_type: "enqueued",
    message: `Job enqueued: ${job.job_type}`,
    metadata: { job_type: job.job_type, total_items: job.total_items ?? 0 },
  });

  return data as BackgroundJob;
}

// ============================================================
// Use background jobs (with optional status filter)
// ============================================================

export function useBackgroundJobs(orgId: string | null, statusFilter?: string) {
  const [data, setData] = useState<BackgroundJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    if (!orgId) { setData([]); setLoading(false); return; }
    setLoading(true);
    let query = supabase.from("background_jobs").select("*").eq("organization_id", orgId).order("created_at", { ascending: false }).limit(100);
    if (statusFilter) query = query.eq("status", statusFilter);
    query.then(({ data, error }) => {
      if (error) setError(error.message); else setData(data as BackgroundJob[]);
      setLoading(false);
    });

    // Real-time subscription for job status changes
    const channel = supabase
      .channel("bg_jobs_changes")
      .on("postgres_changes",
        { event: "*", schema: "public", table: "background_jobs", filter: `organization_id=eq.${orgId}` },
        () => {
          let q = supabase.from("background_jobs").select("*").eq("organization_id", orgId).order("created_at", { ascending: false }).limit(100);
          if (statusFilter) q = q.eq("status", statusFilter);
          q.then(({ data }) => { if (data) setData(data as BackgroundJob[]); });
        },
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [orgId, statusFilter]);

  return { data, loading, error };
}

// ============================================================
// Use job events for a specific job
// ============================================================

export function useJobEvents(jobId: string | null) {
  const [data, setData] = useState<BackgroundJobEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!jobId) { setData([]); setLoading(false); return; }
    setLoading(true);
    supabase.from("background_job_events").select("*").eq("job_id", jobId).order("created_at", { ascending: true })
      .then(({ data, error }) => {
        if (!error && data) setData(data as BackgroundJobEvent[]);
        setLoading(false);
      });

    const channel = supabase
      .channel(`job_events_${jobId}`)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "background_job_events", filter: `job_id=eq.${jobId}` },
        (payload) => {
          setData((prev) => [...prev, payload.new as BackgroundJobEvent]);
        },
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [jobId]);

  return { data, loading };
}

// ============================================================
// Trigger the queue worker edge function
// ============================================================

export async function triggerQueueWorker(): Promise<{
  processed: number; claimed: number; succeeded: number; failed: number; throttled: number;
}> {
  const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/queue-worker`;
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ action: "process" }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Queue worker trigger failed (${response.status})`);
  }
  return response.json();
}

// ============================================================
// Requeue stale jobs
// ============================================================

export async function requeueStaleJobs(timeoutMinutes = 5): Promise<number> {
  const { data, error } = await supabase.rpc("requeue_stale_jobs", { timeout_minutes: timeoutMinutes });
  if (error) throw new Error(error.message);
  return data as number;
}

// ============================================================
// Queue metrics (computed from current jobs)
// ============================================================

export function computeQueueMetrics(jobs: BackgroundJob[]) {
  const queued = jobs.filter((j) => j.status === "queued").length;
  const processing = jobs.filter((j) => j.status === "claimed" || j.status === "processing").length;
  const completed = jobs.filter((j) => j.status === "completed").length;
  const failed = jobs.filter((j) => j.status === "failed").length;
  const throttled = jobs.filter((j) => j.status === "throttled").length;

  const totalProcessed = jobs.reduce((s, j) => s + j.processed_items, 0);
  const totalSucceeded = jobs.reduce((s, j) => s + j.succeeded_items, 0);
  const totalFailed = jobs.reduce((s, j) => s + j.failed_items, 0);
  const totalThrottled = jobs.reduce((s, j) => s + j.throttled_items, 0);
  const totalItems = jobs.reduce((s, j) => s + j.total_items, 0);

  const successRate = totalProcessed > 0 ? Math.round((totalSucceeded / totalProcessed) * 100) : 0;
  const throughputPerMin = totalProcessed > 0
    ? Math.round(totalProcessed / Math.max(1, (Date.now() - new Date(jobs[0]?.created_at ?? Date.now()).getTime()) / 60000))
    : 0;

  return {
    queued, processing, completed, failed, throttled,
    totalProcessed, totalSucceeded, totalFailed, totalThrottled, totalItems,
    successRate, throughputPerMin,
  };
}

// ============================================================
// Delete a completed/failed job (for cleanup)
// ============================================================

export async function deleteBackgroundJob(jobId: string): Promise<void> {
  const { error } = await supabase.from("background_jobs").delete().eq("id", jobId);
  if (error) throw new Error(error.message);
}

// ============================================================
// Retry a failed job
// ============================================================

export async function retryBackgroundJob(jobId: string): Promise<void> {
  const { error } = await supabase.from("background_jobs").update({
    status: "queued",
    retry_count: 0,
    error_message: null,
    claimed_by: null,
    claimed_at: null,
    completed_at: null,
    processed_items: 0,
    succeeded_items: 0,
    failed_items: 0,
    throttled_items: 0,
  }).eq("id", jobId);
  if (error) throw new Error(error.message);

  await supabase.from("background_job_events").insert({
    job_id: jobId,
    event_type: "retried",
    message: "Job manually retried by user",
  });
}
