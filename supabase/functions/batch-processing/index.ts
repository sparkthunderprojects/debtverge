import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const url = new URL(req.url);
    const action = url.searchParams.get("action") ?? "";
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

    // ============================================================
    // Action: create — Build a batch from all due schedules
    // ============================================================
    if (action === "create") {
      const { organization_id, batch_type = "card_collection" } = body;
      if (!organization_id) return jsonResponse({ error: "organization_id required" }, 400);

      const today = new Date().toISOString().split("T")[0];

      // Find all active schedules due today or earlier
      const { data: dueSchedules, error: schedErr } = await supabase
        .from("recurring_payment_schedules")
        .select("*")
        .eq("organization_id", organization_id)
        .eq("status", "active")
        .lte("next_collection_date", today);

      if (schedErr) throw new Error(schedErr.message);

      if (!dueSchedules || dueSchedules.length === 0) {
        return jsonResponse({ runId: null, totalItems: 0, totalAmount: 0, message: "No due schedules found" });
      }

      const totalAmount = dueSchedules.reduce((s: number, r: Record<string, unknown>) => s + Number(r.installment_amount), 0);

      // Create the batch run
      const { data: run, error: runErr } = await supabase
        .from("batch_payment_runs")
        .insert({
          organization_id,
          batch_type,
          batch_date: today,
          status: "pending",
          total_items: dueSchedules.length,
          total_amount: totalAmount,
        })
        .select()
        .single();

      if (runErr) throw new Error(runErr.message);

      // Create batch items
      const items = dueSchedules.map((s: Record<string, unknown>) => ({
        batch_run_id: run.id,
        schedule_id: s.id,
        case_id: s.case_id,
        payment_method_id: s.payment_method_id,
        gateway_config_id: s.gateway_config_id,
        amount: s.installment_amount,
        status: "pending",
      }));

      const { error: itemsErr } = await supabase.from("batch_payment_items").insert(items);
      if (itemsErr) throw new Error(itemsErr.message);

      return jsonResponse({ runId: run.id, totalItems: dueSchedules.length, totalAmount });
    }

    // ============================================================
    // Action: execute — Process all pending items in a batch
    // ============================================================
    if (action === "execute") {
      const { run_id } = body;
      if (!run_id) return jsonResponse({ error: "run_id required" }, 400);

      const { data: run, error: runErr } = await supabase
        .from("batch_payment_runs").select("*").eq("id", run_id).maybeSingle();
      if (runErr) throw new Error(runErr.message);
      if (!run) return jsonResponse({ error: "Batch run not found" }, 404);

      // Update run status to processing
      await supabase.from("batch_payment_runs").update({
        status: "processing",
        initiated_at: new Date().toISOString(),
      }).eq("id", run_id);

      const { data: items, error: itemsErr } = await supabase
        .from("batch_payment_items").select("*").eq("batch_run_id", run_id).eq("status", "pending");

      if (itemsErr) throw new Error(itemsErr.message);

      let succeeded = 0;
      let failed = 0;
      let succeededAmount = 0;
      let failedAmount = 0;

      for (const item of items ?? []) {
        // Fetch payment method
        const { data: pm } = await supabase
          .from("payment_methods").select("*").eq("id", item.payment_method_id).maybeSingle();

        if (!pm) {
          await supabase.from("batch_payment_items").update({
            status: "failed", failure_reason: "No payment method", processed_at: new Date().toISOString(),
          }).eq("id", item.id);
          failed++; failedAmount += Number(item.amount);
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
            failed++; failedAmount += Number(item.amount);
            continue;
          }
        }

        // Process payment via gateway edge function
        const gatewayResult = await callGateway(supabase, {
          gatewayToken: pm.gateway_token,
          amount: Number(item.amount),
          currency: "GBP",
          metadata: { batch_item_id: item.id, schedule_id: item.schedule_id, case_id: item.case_id },
        });

        if (gatewayResult.status === "succeeded") {
          // Record transaction
          const { data: txn } = await supabase.from("gateway_payment_transactions").insert({
            organization_id: run.organization_id,
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

          // Update batch item
          await supabase.from("batch_payment_items").update({
            status: "succeeded", gateway_transaction_id: txn?.id, processed_at: new Date().toISOString(),
          }).eq("id", item.id);

          // Advance schedule
          await supabase.from("recurring_payment_schedules").update({
            retry_count: 0,
            next_collection_date: advanceDate(item.schedule_id, "monthly"),
          }).eq("id", item.schedule_id);

          // Create reconciliation entry
          await supabase.from("payment_reconciliation_log").insert({
            organization_id: run.organization_id,
            case_id: item.case_id,
            transaction_id: txn?.id,
            status: "matched",
            expected_amount: Number(item.amount),
            actual_amount: Number(item.amount),
            variance: 0,
            notes: "Batch collection succeeded",
          });

          succeeded++; succeededAmount += Number(item.amount);
        } else {
          // Record failed transaction
          const { data: txn } = await supabase.from("gateway_payment_transactions").insert({
            organization_id: run.organization_id,
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

          // Increment schedule retry count
          await supabase.rpc("increment_retry_count", { schedule_id: item.schedule_id }).catch(() => {});

          // Create reconciliation entry
          await supabase.from("payment_reconciliation_log").insert({
            organization_id: run.organization_id,
            case_id: item.case_id,
            transaction_id: txn?.id,
            status: "shortfall",
            expected_amount: Number(item.amount),
            actual_amount: 0,
            variance: -Number(item.amount),
            failure_code: gatewayResult.failureReason ?? "PAYMENT_DECLINED",
            retry_scheduled: true,
            notes: "Batch collection failed",
          });

          failed++; failedAmount += Number(item.amount);
        }
      }

      // Update run status
      const finalStatus = failed === 0 ? "completed" : succeeded === 0 ? "failed" : "partial";
      await supabase.from("batch_payment_runs").update({
        status: finalStatus,
        succeeded_count: succeeded,
        failed_count: failed,
        succeeded_amount: succeededAmount,
        failed_amount: failedAmount,
        completed_at: new Date().toISOString(),
      }).eq("id", run_id);

      // Log audit action
      await supabase.from("cashier_audit_logs").insert({
        organization_id: run.organization_id,
        action_type: "batch_execute",
        entity_type: "batch_payment_runs",
        entity_id: run_id,
        new_value: { succeeded, failed, succeededAmount, failedAmount },
        amount_impact: succeededAmount,
        reason: `Batch executed: ${succeeded} succeeded, ${failed} failed`,
      });

      return jsonResponse({ processed: succeeded + failed, succeeded, failed, totalAmount: succeededAmount + failedAmount });
    }

    // ============================================================
    // Action: retry — Retry all failed items in a batch
    // ============================================================
    if (action === "retry") {
      const { run_id } = body;
      if (!run_id) return jsonResponse({ error: "run_id required" }, 400);

      const { data: run } = await supabase.from("batch_payment_runs").select("*").eq("id", run_id).maybeSingle();
      if (!run) return jsonResponse({ error: "Batch run not found" }, 404);

      const { data: failedItems } = await supabase
        .from("batch_payment_items").select("*").eq("batch_run_id", run_id).eq("status", "failed");

      let succeeded = 0;
      let stillFailed = 0;

      for (const item of failedItems ?? []) {
        const { data: pm } = await supabase
          .from("payment_methods").select("*").eq("id", item.payment_method_id).maybeSingle();

        if (!pm) { stillFailed++; continue; }

        const gatewayResult = await callGateway(supabase, {
          gatewayToken: pm.gateway_token,
          amount: Number(item.amount),
          currency: "GBP",
          metadata: { batch_item_id: item.id, is_retry: true },
        });

        if (gatewayResult.status === "succeeded") {
          await supabase.from("batch_payment_items").update({
            status: "succeeded", failure_reason: null, processed_at: new Date().toISOString(),
          }).eq("id", item.id);
          succeeded++;
        } else {
          stillFailed++;
        }
      }

      // Update run counts
      await supabase.rpc("update_batch_run_counts", { run_id }).catch(() => {});

      // Log audit
      await supabase.from("cashier_audit_logs").insert({
        organization_id: run.organization_id,
        action_type: "batch_retry",
        entity_type: "batch_payment_runs",
        entity_id: run_id,
        new_value: { succeeded, stillFailed },
        reason: `Batch retry: ${succeeded} succeeded, ${stillFailed} still failed`,
      });

      return jsonResponse({ retried: (failedItems ?? []).length, succeeded, stillFailed });
    }

    // ============================================================
    // Action: auto_match — Match bank transactions to expected collections
    // ============================================================
    if (action === "auto_match") {
      const { organization_id } = body;
      if (!organization_id) return jsonResponse({ error: "organization_id required" }, 400);

      // Get unmatched bank transactions (credits only)
      const { data: unmatchedTxns, error: txnsErr } = await supabase
        .from("bank_transactions")
        .select("*")
        .eq("organization_id", organization_id)
        .eq("match_status", "unmatched")
        .eq("direction", "credit");

      if (txnsErr) throw new Error(txnsErr.message);

      // Get expected scheduled collections
      const today = new Date().toISOString().split("T")[0];
      const { data: schedules } = await supabase
        .from("recurring_payment_schedules")
        .select("*, cases:case_id(id, client_name)")
        .eq("organization_id", organization_id)
        .in("status", ["active", "paused"]);

      let matched = 0;
      let unmatched = 0;

      for (const txn of unmatchedTxns ?? []) {
        // Try to match by amount + date proximity to a schedule
        const match = (schedules ?? []).find((s: Record<string, unknown>) => {
          const schedAmount = Number(s.installment_amount);
          const amountDiff = Math.abs(Number(txn.amount) - schedAmount);
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
          matched++;
        } else {
          unmatched++;
        }
      }

      return jsonResponse({ checked: (unmatchedTxns ?? []).length, matched, unmatched });
    }

    return jsonResponse({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

async function callGateway(supabase: ReturnType<typeof createClient>, payload: Record<string, unknown>): Promise<{
  status: string; gatewayTransactionId?: string; failureReason?: string; rawResponse: Record<string, unknown>;
}> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
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
}

function advanceDate(_scheduleId: string, frequency: string): string {
  const date = new Date();
  switch (frequency) {
    case "weekly": date.setDate(date.getDate() + 7); break;
    case "fortnightly": date.setDate(date.getDate() + 14); break;
    case "four_weekly": date.setDate(date.getDate() + 28); break;
    default: date.setMonth(date.getMonth() + 1);
  }
  return date.toISOString().split("T")[0];
}

function jsonResponse(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
