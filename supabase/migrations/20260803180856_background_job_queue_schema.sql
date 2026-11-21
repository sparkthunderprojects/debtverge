/*
# Background Job Queue — Asynchronous Processing Infrastructure

## Purpose
A database-backed job queue that enables non-blocking background processing for bulk payment
collections, automated distributions, and ledger postings. Uses PostgreSQL row-level locking
with SKIP LOCKED to allow multiple workers to claim jobs concurrently without contention.
All heavy financial processing runs asynchronously via edge function workers, ensuring the
main application UI never freezes during peak transactional windows.

## New Tables

1. `background_jobs` — The main queue table holding jobs to be processed
   - `id` uuid PK
   - `organization_id` uuid FK → organizations
   - `job_type` text — 'batch_collection' | 'disbursement_run' | 'bank_reconciliation' | 'ledger_posting' | 'recurring_collection' | 'retry_failed' | 'expired_card_check'
   - `priority` int — higher = more urgent (default 5)
   - `status` text — 'queued' | 'claimed' | 'processing' | 'completed' | 'failed' | 'throttled'
   - `payload` jsonb — job-specific data (batch_run_id, schedule_ids, disbursement_run_id, etc.)
   - `total_items` int — items to process in this job
   - `processed_items` int — items completed so far
   - `succeeded_items` int
   - `failed_items` int
   - `throttled_items` int — items delayed due to rate-limiting
   - `chunk_size` int — items per processing chunk (default 25)
   - `max_retries` int — max retry attempts (default 3)
   - `retry_count` int — current retry count
   - `rate_limit_ms` int — minimum delay between chunks in milliseconds (default 500)
   - `claimed_by` text — worker instance identifier
   - `claimed_at` timestamptz
   - `started_at` timestamptz
   - `completed_at` timestamptz
   - `error_message` text
   - `last_progress_at` timestamptz — for stale job detection
   - `created_by` uuid — user who enqueued the job
   - `created_at` timestamptz DEFAULT now()

2. `background_job_events` — Append-only event log for each job (progress, errors, milestones)
   - `id` uuid PK
   - `job_id` uuid FK → background_jobs ON DELETE CASCADE
   - `event_type` text — 'enqueued' | 'claimed' | 'chunk_started' | 'chunk_completed' | 'item_succeeded' | 'item_failed' | 'throttled' | 'retried' | 'completed' | 'failed' | 'stale_detected'
   - `message` text
   - `metadata` jsonb
   - `created_at` timestamptz DEFAULT now()

## Security
- RLS enabled on both tables.
- Owner-scoped via organization_id membership check using organization_users.
- 4 policies per table (select/insert/update/delete) for authenticated users.
- background_job_events is insert+select only (no update/delete) to preserve event log integrity.

## Database Functions
- `claim_next_background_job(worker_id text, job_types text[])` — SECURITY DEFINER function that
  atomically claims the next available job using SKIP LOCKED, preventing race conditions.
  Returns the claimed job row or null if none available.
- `requeue_stale_jobs()` — SECURITY DEFINER function that finds jobs stuck in 'claimed' or
  'processing' status past a timeout threshold and requeues them.
*/

-- ============================================================
-- background_jobs
-- ============================================================
CREATE TABLE IF NOT EXISTS background_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  job_type text NOT NULL,
  priority int NOT NULL DEFAULT 5,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','claimed','processing','completed','failed','throttled')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  total_items int NOT NULL DEFAULT 0,
  processed_items int NOT NULL DEFAULT 0,
  succeeded_items int NOT NULL DEFAULT 0,
  failed_items int NOT NULL DEFAULT 0,
  throttled_items int NOT NULL DEFAULT 0,
  chunk_size int NOT NULL DEFAULT 25,
  max_retries int NOT NULL DEFAULT 3,
  retry_count int NOT NULL DEFAULT 0,
  rate_limit_ms int NOT NULL DEFAULT 500,
  claimed_by text,
  claimed_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  error_message text,
  last_progress_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE background_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_bg_jobs" ON background_jobs;
CREATE POLICY "select_bg_jobs" ON background_jobs FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = background_jobs.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "insert_bg_jobs" ON background_jobs;
CREATE POLICY "insert_bg_jobs" ON background_jobs FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = background_jobs.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "update_bg_jobs" ON background_jobs;
CREATE POLICY "update_bg_jobs" ON background_jobs FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = background_jobs.organization_id AND organization_users.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = background_jobs.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "delete_bg_jobs" ON background_jobs;
CREATE POLICY "delete_bg_jobs" ON background_jobs FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = background_jobs.organization_id AND organization_users.user_id = auth.uid())
  );

-- ============================================================
-- background_job_events
-- ============================================================
CREATE TABLE IF NOT EXISTS background_job_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES background_jobs(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  message text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE background_job_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_bg_job_events" ON background_job_events;
CREATE POLICY "select_bg_job_events" ON background_job_events FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM background_jobs bj
     JOIN organization_users ou ON ou.organization_id = bj.organization_id
     WHERE bj.id = background_job_events.job_id AND ou.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "insert_bg_job_events" ON background_job_events;
CREATE POLICY "insert_bg_job_events" ON background_job_events FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM background_jobs bj
     JOIN organization_users ou ON ou.organization_id = bj.organization_id
     WHERE bj.id = background_job_events.job_id AND ou.user_id = auth.uid())
  );

-- No UPDATE or DELETE policy — events are immutable

-- ============================================================
-- Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_bg_jobs_org_status ON background_jobs(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_bg_jobs_status_priority ON background_jobs(status, priority DESC, created_at);
CREATE INDEX IF NOT EXISTS idx_bg_jobs_claimed_at ON background_jobs(claimed_at) WHERE status IN ('claimed','processing');
CREATE INDEX IF NOT EXISTS idx_bg_job_events_job ON background_job_events(job_id, created_at);

-- ============================================================
-- Function: claim_next_background_job
-- Atomically claims the next available job using SKIP LOCKED.
-- Multiple workers can call this concurrently without contention.
-- ============================================================
CREATE OR REPLACE FUNCTION claim_next_background_job(worker_id text, job_types text[] DEFAULT NULL)
RETURNS background_jobs
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  claimed_job background_jobs;
BEGIN
  -- Select and lock the next available job, skipping any already-locked rows
  SELECT * INTO claimed_job
  FROM background_jobs
  WHERE status = 'queued'
    AND (job_types IS NULL OR job_type = ANY(job_types))
  ORDER BY priority DESC, created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  -- If we got a job, mark it as claimed
  IF claimed_job.id IS NOT NULL THEN
    UPDATE background_jobs
    SET status = 'claimed',
        claimed_by = worker_id,
        claimed_at = now(),
        last_progress_at = now()
    WHERE id = claimed_job.id
    RETURNING * INTO claimed_job;

    -- Log the claim event
    INSERT INTO background_job_events (job_id, event_type, message, metadata)
    VALUES (claimed_job.id, 'claimed', 'Job claimed by worker ' || worker_id,
            jsonb_build_object('worker_id', worker_id, 'job_type', claimed_job.job_type));
  END IF;

  RETURN claimed_job;
END;
$$;

-- ============================================================
-- Function: requeue_stale_jobs
-- Finds jobs stuck in 'claimed' or 'processing' past a timeout
-- and requeues them for retry.
-- ============================================================
CREATE OR REPLACE FUNCTION requeue_stale_jobs(timeout_minutes int DEFAULT 5)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  requeued_count int;
  stale_ids uuid[];
BEGIN
  -- Find jobs that have been claimed but haven't reported progress recently
  SELECT array_agg(id) INTO stale_ids
  FROM background_jobs
  WHERE status IN ('claimed', 'processing')
    AND last_progress_at < now() - (timeout_minutes || ' minutes')::interval;

  IF stale_ids IS NOT NULL THEN
    -- Requeue them if they haven't exceeded max retries
    UPDATE background_jobs
    SET status = 'queued',
        claimed_by = NULL,
        claimed_at = NULL,
        retry_count = retry_count + 1,
        error_message = CASE
          WHEN retry_count + 1 >= max_retries THEN 'Max retries exceeded — job marked as failed'
          ELSE 'Requeued after stale detection'
        END
    WHERE id = ANY(stale_ids)
      AND retry_count < max_retries;

    GET DIAGNOSTICS requeued_count = ROW_COUNT;

    -- Mark as failed if max retries exceeded
    UPDATE background_jobs
    SET status = 'failed',
        error_message = 'Max retries exceeded after stale detection',
        completed_at = now()
    WHERE id = ANY(stale_ids)
      AND retry_count >= max_retries;

    -- Log stale detection events
    INSERT INTO background_job_events (job_id, event_type, message, metadata)
    SELECT id, 'stale_detected', 'Job was stuck and has been requeued or failed',
           jsonb_build_object('requeued', retry_count < max_retries)
    FROM background_jobs
    WHERE id = ANY(stale_ids);
  ELSE
    requeued_count := 0;
  END IF;

  RETURN requeued_count;
END;
$$;

-- ============================================================
-- Function: update_job_progress
-- Atomically updates job progress counters and last_progress_at.
-- ============================================================
CREATE OR REPLACE FUNCTION update_job_progress(
  p_job_id uuid,
  p_processed int DEFAULT NULL,
  p_succeeded int DEFAULT NULL,
  p_failed int DEFAULT NULL,
  p_throttled int DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_error text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE background_jobs
  SET
    processed_items = COALESCE(p_processed, processed_items),
    succeeded_items = COALESCE(p_succeeded, succeeded_items),
    failed_items = COALESCE(p_failed, failed_items),
    throttled_items = COALESCE(p_throttled, throttled_items),
    status = COALESCE(p_status, status),
    error_message = COALESCE(p_error, error_message),
    last_progress_at = now(),
    completed_at = CASE WHEN p_status IN ('completed','failed') THEN now() ELSE completed_at END
  WHERE id = p_job_id;
END;
$$;

-- Grant execute on the SECURITY DEFINER functions to authenticated users
GRANT EXECUTE ON FUNCTION claim_next_background_job(text, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION requeue_stale_jobs(int) TO authenticated;
GRANT EXECUTE ON FUNCTION update_job_progress(uuid, int, int, int, int, text, text) TO authenticated;
