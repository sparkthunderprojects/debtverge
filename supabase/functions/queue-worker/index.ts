import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const WORKER_ID = `worker-${Math.random().toString(36).slice(2, 10)}`;
const MAX_CHUNKS_PER_INVOCATION = 4;
const STALE_TIMEOUT_MINUTES = 5;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action = body.action ?? "process";

    if (action !== "process") {
      return jsonResponse({ error: `Unknown action: ${action}` }, 400);
    }

    // Step 1: Requeue any stale jobs first
    const { data: requeuedCount } = await supabase.rpc("requeue_stale_jobs", {
      timeout_minutes: STALE_TIMEOUT_MINUTES,
    });

    // Step 2: Process jobs in a loop — claim, process chunks, release
    let totalClaimed = 0;
    let totalSucceeded = 0;
    let totalFailed = 0;
    let totalThrottled = 0;
    let chunksProcessed = 0;

    while (chunksProcessed < MAX_CHUNKS_PER_INVOCATION) {
      // Claim the next available job using SKIP LOCKED
      const { data: job, error: claimErr } = await supabase.rpc("claim_next_background_job", {
        worker_id: WORKER_ID,
        job_types: null,
      });

      if (claimErr) {
        console.error("Claim error:", claimErr.message);
        break;
      }

      if (!job) {
        // No more jobs in the queue
        break;
      }

      totalClaimed++;
      const jobRow = job as Record<string, unknown>;
      const jobId = jobRow.id as string;
      const jobType = jobRow.job_type as string;
      const payload = jobRow.payload as Record<string, unknown>;
      const chunkSize = (jobRow.chunk_size as number) ?? 25;
      const rateLimitMs = (jobRow.rate_limit_ms as number) ?? 500;

      // Log chunk started
      await logEvent(supabase, jobId, "chunk_started", `Processing chunk ${chunksProcessed + 1}/${MAX_CHUNKS_PER_INVOCATION}`);

      // Update status to processing
      await supabase.rpc("update_job_progress", {
        p_job_id: jobId,
        p_status: "processing",
        p_processed: 0,
      });

      // Process the job based on its type
      const result = await processJobChunk(supabase, jobRow, chunkSize, rateLimitMs);

      // Update progress
      const newProcessed = (jobRow.processed_items as number) + result.processed;
      const newSucceeded = (jobRow.succeeded_items as number) + result.succeeded;
      const newFailed = (jobRow.failed_items as number) + result.failed;
      const newThrottled = (jobRow.throttled_items as number) + result.throttled;

      const isComplete = newProcessed >= (jobRow.total_items as number);

      await supabase.rpc("update_job_progress", {
        p_job_id: jobId,
        p_processed: newProcessed,
        p_succeeded: newSucceeded,
        p_failed: newFailed,
        p_throttled: newThrottled,
        p_status: isComplete ? (newFailed > 0 && newSucceeded === 0 ? "failed" : "completed") : "queued",
        p_error: result.error ?? null,
      });

      // Log completion or chunk completion
      if (isComplete) {
        const finalStatus = newFailed > 0 && newSucceeded === 0 ? "failed" : "completed";
        await logEvent(supabase, jobId, finalStatus as "completed" | "failed",
          `Job ${finalStatus}: ${newSucceeded} succeeded, ${newFailed} failed, ${newThrottled} throttled`,
        );
      } else {
        await logEvent(supabase, jobId, "chunk_completed",
          `Chunk done: +${result.succeeded} succeeded, +${result.failed} failed, +${result.throttled} throttled. Releasing back to queue.`,
        );
      }

      totalSucceeded += result.succeeded;
      totalFailed += result.failed;
      totalThrottled += result.throttled;
      chunksProcessed++;

      // Rate-limit: wait before processing the next chunk
      if (chunksProcessed < MAX_CHUNKS_PER_INVOCATION && rateLimitMs > 0) {
        await sleep(rateLimitMs);
      }
    }

    return jsonResponse({
      processed: chunksProcessed,
      claimed: totalClaimed,
      succeeded: totalSucceeded,
      failed: totalFailed,
      throttled: totalThrottled,
      requeuedStale: requeuedCount ?? 0,
      workerId: WORKER_ID,
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

// ============================================================
// Process a single chunk of a job
// ============================================================

async function processJobChunk(
  supabase: ReturnType<typeof createClient>,
  job: Record<string, unknown>,
  chunkSize: number,
  rateLimitMs: number,
): Promise<{ processed: number; succeeded: number; failed: number; throttled: number; error?: string }> {
  const jobType = job.job_type as string;
  const payload = job.payload as Record<string, unknown>;
  const processedSoFar = job.processed_items as number;

  switch (jobType) {
    case "batch_collection":
      return processBatchCollectionChunk(supabase, payload, processedSoFar, chunkSize, rateLimitMs);
    case "disbursement_run":
      return processDisbursementRunChunk(supabase, payload, processedSoFar, chunkSize);
    case "bank_reconciliation":
      return processBankReconciliationChunk(supabase, payload, processedSoFar, chunkSize);
    case "recurring_collection":
      return processRecurringCollectionChunk(supabase, payload, processedSoFar, chunkSize, rateLimitMs);
    case "retry_failed":
      return processRetryFailedChunk(supabase, payload, processedSoFar, chunkSize, rateLimitMs);
    case "expired_card_check":
      return processExpiredCardCheckChunk(supabase, payload);
    case "ledger_posting":
      return processLedgerPostingChunk(supabase, payload, processedSoFar, chunkSize);
    default:
      return { processed: 0, succeeded: 0, failed: 0, throttled: 0, error: `Unknown job type: ${jobType}` };
  }
}

// ============================================================
// Batch Collection — process a chunk of scheduled payments
// ============================================================

async function processBatchCollectionChunk(
  supabase: ReturnType<typeof createClient>,
  payload: Record<string, unknown>,
  offset: number,
  limit: number,
  rateLimitMs: number,
): Promise<{ processed: number; succeeded: number; failed: number; throttled: number }> {
  const batchRunId = payload.batch_run_id as string;
  if (!batchRunId) return { processed: 0, succeeded: 0, failed: 0, throttled: 0, error: "Missing batch_run_id" };

  // Fetch the next chunk of pending items
  const { data: items, error } = await supabase
    .from("batch_payment_items")
    .select("*")
    .eq("batch_run_id", batchRunId)
    .eq("status", "pending")
    .range(offset, offset + limit - 1);

  if (error) return { processed: 0, succeeded: 0, failed: 0, throttled: 0, error: error.message };
  if (!items?.length) return { processed: 0, succeeded: 0, failed: 0, throttled: 0 };

  let succeeded = 0;
  let failed = 0;
  let throttled = 0;
  let processed = 0;

  for (const item of items) {
    processed++;

    // Fetch payment method
    const { data: pm } = await supabase
      .from("payment_methods")
      .select("*")
      .eq("id", item.payment_method_id)
      .maybeSingle();

    if (!pm) {
      await supabase.from("batch_payment_items").update({
        status: "failed", failure_reason: "No payment method", processed_at: new Date().toISOString(),
      }).eq("id", item.id);
      failed++;
      continue;
    }

    // Check card expiry
    if (pm.expiry_month && pm.expiry_year) {
      const now = new Date();
      const currentYear = now.getFullYear() % 100;
      const currentMonth = now.getMonth() + 1;
      if (pm.expiry_year < currentYear || (pm.expiry_year === currentYear && pm.expiry_month < currentMonth)) {
        await supabase.from("batch_payment_items").update({
          status: "failed", failure_reason: `Card expired ${String(pm.expiry_month).padStart(2, "0")}/${pm.expiry_year}`,
          processed_at: new Date().toISOString(),
        }).eq("id", item.id);
        failed++;
        continue;
      }
    }

    // Rate-limit: if we're processing too fast, throttle this item
    if (rateLimitMs > 300 && processed > 1 && processed % 10 === 0) {
      throttled++;
      // Leave the item as pending — it'll be picked up in the next chunk
      await logEvent(supabase, payload.batch_run_id as string, "throttled", `Item ${item.id} throttled due to rate limiting`);
      continue;
    }

    // Call the payment gateway
    const gatewayResult = await callGateway(supabase, {
      gatewayToken: pm.gateway_token,
      amount: Number(item.amount),
      currency: "GBP",
      metadata: { batch_item_id: item.id, schedule_id: item.schedule_id, case_id: item.case_id },
    });

    if (gatewayResult.status === "succeeded") {
      // Record transaction
      const { data: txn } = await supabase.from("gateway_payment_transactions").insert({
        organization_id: item.organization_id ?? payload.organization_id,
        case_id: item.case_id,
        schedule_id: item.schedule_id,
        payment_method_id: item.payment_method_id,
        gateway_config_id: item.gateway_config_id,
        gateway_transaction_id: gatewayResult.gatewayTransactionId,
        amount: Number(item.amount),
        currency: "GBP",
        status: "succeeded",
        settled_at: new Date().toISOString(),
        gateway_response: gatewayResult.rawResponse,
      }).select().single();

      await supabase.from("batch_payment_items").update({
        status: "succeeded", gateway_transaction_id: txn?.id, processed_at: new Date().toISOString(),
      }).eq("id", item.id);
      succeeded++;

      // Log item succeeded event
      await logEvent(supabase, payload.batch_run_id as string, "item_succeeded", `Item ${item.id} succeeded: ${item.amount}`);
    } else {
      const { data: txn } = await supabase.from("gateway_payment_transactions").insert({
        organization_id: item.organization_id ?? payload.organization_id,
        case_id: item.case_id,
        schedule_id: item.schedule_id,
        payment_method_id: item.payment_method_id,
        gateway_config_id: item.gateway_config_id,
        amount: Number(item.amount),
        currency: "GBP",
        status: "retrying",
        failure_reason: gatewayResult.failureReason ?? "Payment declined",
      }).select().single();

      await supabase.from("batch_payment_items").update({
        status: "failed", gateway_transaction_id: txn?.id,
        failure_reason: gatewayResult.failureReason, processed_at: new Date().toISOString(),
      }).eq("id", item.id);
      failed++;

      await logEvent(supabase, payload.batch_run_id as string, "item_failed", `Item ${item.id} failed: ${gatewayResult.failureReason}`);
    }

    // Apply rate-limiting delay between items
    if (rateLimitMs > 0) await sleep(Math.min(rateLimitMs, 200));
  }

  return { processed, succeeded, failed, throttled };
}

// ============================================================
// Disbursement Run — generate and submit payment instructions
// ============================================================

async function processDisbursementRunChunk(
  supabase: ReturnType<typeof createClient>,
  payload: Record<string, unknown>,
  offset: number,
  limit: number,
): Promise<{ processed: number; succeeded: number; failed: number; throttled: number }> {
  const runId = payload.disbursement_run_id as string;
  if (!runId) return { processed: 0, succeeded: 0, failed: 0, throttled: 0 };

  // Fetch a chunk of items to mark as included in the payment file
  const { data: items, error } = await supabase
    .from("disbursement_run_items")
    .select("*")
    .eq("disbursement_run_id", runId)
    .eq("status", "pending")
    .range(offset, offset + limit - 1);

  if (error) return { processed: 0, succeeded: 0, failed: 0, throttled: 0 };
  if (!items?.length) return { processed: 0, succeeded: 0, failed: 0, throttled: 0 };

  let succeeded = 0;
  let failed = 0;

  for (const item of items) {
    // Validate payee details
    if (!item.payee_account_number || !item.payee_sort_code) {
      await supabase.from("disbursement_run_items").update({ status: "failed" }).eq("id", item.id);
      failed++;
    } else {
      await supabase.from("disbursement_run_items").update({ status: "included" }).eq("id", item.id);
      succeeded++;
    }
  }

  return { processed: items.length, succeeded, failed, throttled: 0 };
}

// ============================================================
// Bank Reconciliation — match a chunk of bank transactions
// ============================================================

async function processBankReconciliationChunk(
  supabase: ReturnType<typeof createClient>,
  payload: Record<string, unknown>,
  offset: number,
  limit: number,
): Promise<{ processed: number; succeeded: number; failed: number; throttled: number }> {
  const orgId = payload.organization_id as string;
  if (!orgId) return { processed: 0, succeeded: 0, failed: 0, throttled: 0 };

  // Fetch a chunk of unmatched credit transactions
  const { data: txns, error } = await supabase
    .from("bank_transactions")
    .select("*")
    .eq("organization_id", orgId)
    .eq("match_status", "unmatched")
    .eq("direction", "credit")
    .range(offset, offset + limit - 1);

  if (error) return { processed: 0, succeeded: 0, failed: 0, throttled: 0 };
  if (!txns?.length) return { processed: 0, succeeded: 0, failed: 0, throttled: 0 };

  // Get expected scheduled collections for matching
  const { data: schedules } = await supabase
    .from("recurring_payment_schedules")
    .select("*")
    .eq("organization_id", orgId)
    .in("status", ["active", "paused"]);

  let succeeded = 0;
  let failed = 0;

  for (const txn of txns) {
    const match = (schedules ?? []).find((s: Record<string, unknown>) => {
      const amountDiff = Math.abs(Number(txn.amount) - Number(s.installment_amount));
      return amountDiff < 0.50;
    });

    if (match) {
      await supabase.from("bank_transactions").update({
        match_status: "auto_matched",
        matched_schedule_id: match.id,
        matched_case_id: match.case_id,
        match_confidence: "high",
        match_notes: `Auto-matched to schedule ${match.id}`,
      }).eq("id", txn.id);
      succeeded++;
    } else {
      failed++;
    }
  }

  return { processed: txns.length, succeeded, failed, throttled: 0 };
}

// ============================================================
// Recurring Collection — process due schedules
// ============================================================

async function processRecurringCollectionChunk(
  supabase: ReturnType<typeof createClient>,
  payload: Record<string, unknown>,
  offset: number,
  limit: number,
  rateLimitMs: number,
): Promise<{ processed: number; succeeded: number; failed: number; throttled: number }> {
  const orgId = payload.organization_id as string;
  if (!orgId) return { processed: 0, succeeded: 0, failed: 0, throttled: 0 };

  const today = new Date().toISOString().split("T")[0];
  const { data: dueSchedules, error } = await supabase
    .from("recurring_payment_schedules")
    .select("*")
    .eq("organization_id", orgId)
    .eq("status", "active")
    .lte("next_collection_date", today)
    .range(offset, offset + limit - 1);

  if (error) return { processed: 0, succeeded: 0, failed: 0, throttled: 0 };
  if (!dueSchedules?.length) return { processed: 0, succeeded: 0, failed: 0, throttled: 0 };

  let succeeded = 0;
  let failed = 0;
  let throttled = 0;
  let processed = 0;

  for (const schedule of dueSchedules) {
    processed++;

    if (rateLimitMs > 300 && processed > 1 && processed % 10 === 0) {
      throttled++;
      continue;
    }

    const { data: pm } = await supabase
      .from("payment_methods")
      .select("*")
      .eq("id", schedule.payment_method_id)
      .maybeSingle();

    if (!pm) { failed++; continue; }

    const gatewayResult = await callGateway(supabase, {
      gatewayToken: pm.gateway_token,
      amount: Number(schedule.installment_amount),
      currency: "GBP",
    });

    if (gatewayResult.status === "succeeded") {
      await supabase.from("gateway_payment_transactions").insert({
        organization_id: orgId,
        case_id: schedule.case_id,
        schedule_id: schedule.id,
        payment_method_id: schedule.payment_method_id,
        gateway_config_id: schedule.gateway_config_id,
        gateway_transaction_id: gatewayResult.gatewayTransactionId,
        amount: Number(schedule.installment_amount),
        currency: "GBP",
        status: "succeeded",
        settled_at: new Date().toISOString(),
      });
      succeeded++;
    } else {
      failed++;
    }

    if (rateLimitMs > 0) await sleep(Math.min(rateLimitMs, 200));
  }

  return { processed, succeeded, failed, throttled };
}

// ============================================================
// Retry Failed — retry failed transactions
// ============================================================

async function processRetryFailedChunk(
  supabase: ReturnType<typeof createClient>,
  payload: Record<string, unknown>,
  offset: number,
  limit: number,
  rateLimitMs: number,
): Promise<{ processed: number; succeeded: number; failed: number; throttled: number }> {
  const orgId = payload.organization_id as string;
  if (!orgId) return { processed: 0, succeeded: 0, failed: 0, throttled: 0 };

  const { data: failedTxns, error } = await supabase
    .from("gateway_payment_transactions")
    .select("*")
    .eq("status", "retrying")
    .range(offset, offset + limit - 1);

  if (error) return { processed: 0, succeeded: 0, failed: 0, throttled: 0 };
  if (!failedTxns?.length) return { processed: 0, succeeded: 0, failed: 0, throttled: 0 };

  let succeeded = 0;
  let failed = 0;

  for (const txn of failedTxns) {
    const { data: pm } = await supabase
      .from("payment_methods")
      .select("*")
      .eq("id", txn.payment_method_id)
      .maybeSingle();

    if (!pm) { failed++; continue; }

    const gatewayResult = await callGateway(supabase, {
      gatewayToken: pm.gateway_token,
      amount: Number(txn.amount),
      currency: "GBP",
    });

    if (gatewayResult.status === "succeeded") {
      await supabase.from("gateway_payment_transactions").update({
        status: "succeeded",
        gateway_transaction_id: gatewayResult.gatewayTransactionId,
        settled_at: new Date().toISOString(),
      }).eq("id", txn.id);
      succeeded++;
    } else {
      failed++;
    }

    if (rateLimitMs > 0) await sleep(Math.min(rateLimitMs, 200));
  }

  return { processed: failedTxns.length, succeeded, failed, throttled: 0 };
}

// ============================================================
// Expired Card Check — scan and flag expired cards
// ============================================================

async function processExpiredCardCheckChunk(
  supabase: ReturnType<typeof createClient>,
  payload: Record<string, unknown>,
): Promise<{ processed: number; succeeded: number; failed: number; throttled: number }> {
  const orgId = payload.organization_id as string;
  if (!orgId) return { processed: 0, succeeded: 0, failed: 0, throttled: 0 };

  const { data: methods, error } = await supabase
    .from("payment_methods")
    .select("*")
    .eq("is_active", true)
    .eq("payment_type", "card");

  if (error) return { processed: 0, succeeded: 0, failed: 0, throttled: 0 };

  const now = new Date();
  const currentYear = now.getFullYear() % 100;
  const currentMonth = now.getMonth() + 1;

  let expired = 0;
  for (const pm of methods ?? []) {
    if (pm.expiry_month && pm.expiry_year) {
      const isExpired = pm.expiry_year < currentYear ||
        (pm.expiry_year === currentYear && pm.expiry_month < currentMonth);
      if (isExpired) {
        await supabase
          .from("recurring_payment_schedules")
          .update({ status: "suspended" })
          .eq("payment_method_id", pm.id)
          .eq("status", "active");
        expired++;
      }
    }
  }

  return { processed: methods?.length ?? 0, succeeded: expired, failed: 0, throttled: 0 };
}

// ============================================================
// Ledger Posting — post a batch of ledger entries
// ============================================================

async function processLedgerPostingChunk(
  supabase: ReturnType<typeof createClient>,
  payload: Record<string, unknown>,
  offset: number,
  limit: number,
): Promise<{ processed: number; succeeded: number; failed: number; throttled: number }> {
  const entries = payload.entries as Record<string, unknown>[] | undefined;
  if (!entries?.length) return { processed: 0, succeeded: 0, failed: 0, throttled: 0 };

  const chunk = entries.slice(offset, offset + limit);
  let succeeded = 0;
  let failed = 0;

  for (const entry of chunk) {
    try {
      const { error } = await supabase.from("disbursement_waterfall_entries").insert(entry);
      if (error) { failed++; } else { succeeded++; }
    } catch {
      failed++;
    }
  }

  return { processed: chunk.length, succeeded, failed, throttled: 0 };
}

// ============================================================
// Helpers
// ============================================================

async function callGateway(supabase: ReturnType<typeof createClient>, payload: Record<string, unknown>): Promise<{
  status: string; gatewayTransactionId?: string; failureReason?: string; rawResponse: Record<string, unknown>;
}> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/payment-gateway`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${anonKey}` },
      body: JSON.stringify({ gateway_type: "stripe", action: "charge", ...payload }),
    });
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      return { status: "failed", failureReason: errorBody.error || `Gateway error (${response.status})`, rawResponse: errorBody };
    }
    const data = await response.json();
    return {
      status: data.status ?? "failed",
      gatewayTransactionId: data.gatewayTransactionId,
      failureReason: data.failureReason,
      rawResponse: data.rawResponse ?? data,
    };
  } catch (err) {
    return { status: "failed", failureReason: err instanceof Error ? err.message : "Gateway unreachable", rawResponse: {} };
  }
}

async function logEvent(
  supabase: ReturnType<typeof createClient>,
  jobId: string,
  eventType: string,
  message?: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await supabase.from("background_job_events").insert({
    job_id: jobId,
    event_type: eventType,
    message: message ?? eventType,
    metadata: metadata ?? null,
  }).catch(() => {});
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jsonResponse(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
