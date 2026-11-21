import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface RecurringSchedule {
  id: string;
  organization_id: string;
  case_id: string;
  payment_method_id: string | null;
  gateway_config_id: string | null;
  frequency: string;
  installment_amount: number;
  preferred_payment_day: string | null;
  next_collection_date: string;
  retry_count: number;
  max_retries: number;
  status: string;
}

interface PaymentMethod {
  id: string;
  gateway_token: string;
  payment_type: string;
  card_brand: string | null;
  last4: string | null;
  expiry_month: number | null;
  expiry_year: number | null;
}

interface GatewayConfig {
  id: string;
  gateway_type: string;
  test_mode: boolean;
  merchant_id: string | null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const today = new Date().toISOString().split("T")[0];
    const action = new URL(req.url).searchParams.get("action") ?? "process_due";

    // ============================================================
    // Action: process_due — Collect all schedules due for collection
    // ============================================================
    if (action === "process_due") {
      const { data: dueSchedules, error: fetchErr } = await supabase
        .from("recurring_payment_schedules")
        .select("*")
        .eq("status", "active")
        .lte("next_collection_date", today);

      if (fetchErr) throw new Error(`Failed to fetch due schedules: ${fetchErr.message}`);

      const results: { scheduleId: string; status: string; amount: number; failureReason?: string }[] = [];

      for (const schedule of dueSchedules as RecurringSchedule[]) {
        const result = await processSchedule(supabase, schedule);
        results.push(result);
      }

      return jsonResponse({
        processed: results.length,
        succeeded: results.filter((r) => r.status === "succeeded").length,
        failed: results.filter((r) => r.status === "failed").length,
        retrying: results.filter((r) => r.status === "retrying").length,
        details: results,
      });
    }

    // ============================================================
    // Action: retry_failed — Retry transactions in "retrying" status
    // ============================================================
    if (action === "retry_failed") {
      const { data: retryTxns, error: retryErr } = await supabase
        .from("gateway_payment_transactions")
        .select("*, schedule:recurring_payment_schedules(*)")
        .eq("status", "retrying")
        .order("created_at", { ascending: true })
        .limit(50);

      if (retryErr) throw new Error(`Failed to fetch retry transactions: ${retryErr.message}`);

      const results: { transactionId: string; status: string; failureReason?: string }[] = [];

      for (const txn of retryTxns) {
        const schedule = txn.schedule as unknown as RecurringSchedule | null;
        if (!schedule || schedule.retry_count >= schedule.max_retries) {
          // Exceeded max retries — mark as permanently failed
          await supabase
            .from("gateway_payment_transactions")
            .update({ status: "failed", failure_reason: "Max retries exceeded" })
            .eq("id", txn.id);

          // Suspend the schedule
          if (schedule) {
            await supabase
              .from("recurring_payment_schedules")
              .update({ status: "suspended" })
              .eq("id", schedule.id);
          }

          // Create reconciliation entry for the failure
          await supabase.from("payment_reconciliation_log").insert({
            organization_id: txn.organization_id,
            case_id: txn.case_id,
            transaction_id: txn.id,
            status: "failed",
            expected_amount: txn.amount,
            actual_amount: 0,
            variance: -txn.amount,
            failure_code: "MAX_RETRIES_EXCEEDED",
            retry_scheduled: false,
            notes: "Automated retry exhausted. Schedule suspended.",
          });

          results.push({ transactionId: txn.id, status: "failed", failureReason: "Max retries exceeded" });
          continue;
        }

        // Attempt retry via gateway
        const { data: pm } = await supabase
          .from("payment_methods")
          .select("*")
          .eq("id", schedule.payment_method_id)
          .maybeSingle() as { data: PaymentMethod | null };

        if (!pm) {
          await supabase
            .from("gateway_payment_transactions")
            .update({ status: "failed", failure_reason: "Payment method not found" })
            .eq("id", txn.id);
          results.push({ transactionId: txn.id, status: "failed", failureReason: "Payment method not found" });
          continue;
        }

        // Check for expired card
        const expiryError = checkCardExpiry(pm);
        if (expiryError) {
          await supabase
            .from("gateway_payment_transactions")
            .update({ status: "failed", failure_reason: expiryError })
            .eq("id", txn.id);

          await supabase
            .from("recurring_payment_schedules")
            .update({ status: "suspended", retry_count: schedule.retry_count + 1 })
            .eq("id", schedule.id);

          await supabase.from("payment_reconciliation_log").insert({
            organization_id: txn.organization_id,
            case_id: txn.case_id,
            transaction_id: txn.id,
            status: "failed",
            expected_amount: txn.amount,
            actual_amount: 0,
            variance: -txn.amount,
            failure_code: "CARD_EXPIRED",
            retry_scheduled: false,
            notes: `Card token expired: ${expiryError}`,
          });

          results.push({ transactionId: txn.id, status: "failed", failureReason: expiryError });
          continue;
        }

        // Process retry payment via gateway edge function
        const gatewayResult = await callGateway(supabase, schedule.gateway_config_id, "charge", {
          gatewayToken: pm.gateway_token,
          amount: txn.amount,
          currency: "GBP",
        });

        const newRetryCount = schedule.retry_count + 1;

        if (gatewayResult.status === "succeeded") {
          // Mark retry transaction as succeeded
          await supabase
            .from("gateway_payment_transactions")
            .update({
              status: "succeeded",
              gateway_transaction_id: gatewayResult.gatewayTransactionId,
              settled_at: new Date().toISOString(),
              gateway_response: gatewayResult.rawResponse,
            })
            .eq("id", txn.id);

          // Reset schedule retry count and advance next collection date
          await supabase
            .from("recurring_payment_schedules")
            .update({
              retry_count: 0,
              status: "active",
              next_collection_date: advanceDate(schedule.next_collection_date, schedule.frequency),
            })
            .eq("id", schedule.id);

          // Create reconciliation entry
          await supabase.from("payment_reconciliation_log").insert({
            organization_id: txn.organization_id,
            case_id: txn.case_id,
            transaction_id: txn.id,
            status: "matched",
            expected_amount: txn.amount,
            actual_amount: txn.amount,
            variance: 0,
            notes: "Retry succeeded",
          });

          results.push({ transactionId: txn.id, status: "succeeded" });
        } else {
          // Retry also failed — increment retry count
          await supabase
            .from("recurring_payment_schedules")
            .update({ retry_count: newRetryCount })
            .eq("id", schedule.id);

          // Create reconciliation entry
          await supabase.from("payment_reconciliation_log").insert({
            organization_id: txn.organization_id,
            case_id: txn.case_id,
            transaction_id: txn.id,
            status: "shortfall",
            expected_amount: txn.amount,
            actual_amount: 0,
            variance: -txn.amount,
            failure_code: gatewayResult.failureReason ?? "RETRY_FAILED",
            retry_scheduled: newRetryCount < schedule.max_retries,
            notes: `Retry ${newRetryCount}/${schedule.max_retries} failed`,
          });

          results.push({ transactionId: txn.id, status: "retrying", failureReason: gatewayResult.failureReason });
        }
      }

      return jsonResponse({
        retried: results.length,
        succeeded: results.filter((r) => r.status === "succeeded").length,
        still_retrying: results.filter((r) => r.status === "retrying").length,
        permanently_failed: results.filter((r) => r.status === "failed").length,
        details: results,
      });
    }

    // ============================================================
    // Action: detect_expired — Find payment methods with expired cards
    // ============================================================
    if (action === "detect_expired") {
      const { data: methods, error: methodsErr } = await supabase
        .from("payment_methods")
        .select("*")
        .eq("is_active", true)
        .eq("payment_type", "card");

      if (methodsErr) throw new Error(`Failed to fetch payment methods: ${methodsErr.message}`);

      const now = new Date();
      const currentYear = now.getFullYear() % 100;
      const currentMonth = now.getMonth() + 1;
      const expired: { methodId: string; last4: string | null; reason: string }[] = [];

      for (const pm of methods as PaymentMethod[]) {
        if (pm.expiry_month && pm.expiry_year) {
          const isExpired = pm.expiry_year < currentYear ||
            (pm.expiry_year === currentYear && pm.expiry_month < currentMonth);
          if (isExpired) {
            expired.push({
              methodId: pm.id,
              last4: pm.last4,
              reason: `Card expired ${String(pm.expiry_month).padStart(2, "0")}/${pm.expiry_year}`,
            });
          }
        }
      }

      // Suspend schedules linked to expired cards
      for (const exp of expired) {
        await supabase
          .from("recurring_payment_schedules")
          .update({ status: "suspended" })
          .eq("payment_method_id", exp.methodId)
          .eq("status", "active");
      }

      return jsonResponse({
        checked: methods.length,
        expired: expired.length,
        schedules_suspended: expired.length,
        details: expired,
      });
    }

    return jsonResponse({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

// ============================================================
// Helper: Process a single due schedule
// ============================================================
async function processSchedule(
  supabase: ReturnType<typeof createClient>,
  schedule: RecurringSchedule,
): Promise<{ scheduleId: string; status: string; amount: number; failureReason?: string }> {
  // Fetch payment method
  const { data: pm } = await supabase
    .from("payment_methods")
    .select("*")
    .eq("id", schedule.payment_method_id)
    .maybeSingle() as { data: PaymentMethod | null };

  if (!pm) {
    await supabase.from("gateway_payment_transactions").insert({
      organization_id: schedule.organization_id,
      case_id: schedule.case_id,
      schedule_id: schedule.id,
      payment_method_id: schedule.payment_method_id,
      gateway_config_id: schedule.gateway_config_id,
      amount: schedule.installment_amount,
      status: "failed",
      failure_reason: "No payment method linked to schedule",
    });
    return { scheduleId: schedule.id, status: "failed", amount: schedule.installment_amount, failureReason: "No payment method" };
  }

  // Check for expired card
  const expiryError = checkCardExpiry(pm);
  if (expiryError) {
    await supabase.from("gateway_payment_transactions").insert({
      organization_id: schedule.organization_id,
      case_id: schedule.case_id,
      schedule_id: schedule.id,
      payment_method_id: schedule.payment_method_id,
      gateway_config_id: schedule.gateway_config_id,
      amount: schedule.installment_amount,
      status: "failed",
      failure_reason: expiryError,
    });
    await supabase
      .from("recurring_payment_schedules")
      .update({ status: "suspended" })
      .eq("id", schedule.id);
    return { scheduleId: schedule.id, status: "failed", amount: schedule.installment_amount, failureReason: expiryError };
  }

  // Process payment via gateway
  const gatewayResult = await callGateway(supabase, schedule.gateway_config_id, "charge", {
    gatewayToken: pm.gateway_token,
    amount: schedule.installment_amount,
    currency: "GBP",
    metadata: { schedule_id: schedule.id, case_id: schedule.case_id },
  });

  if (gatewayResult.status === "succeeded") {
    // Record successful transaction
    await supabase.from("gateway_payment_transactions").insert({
      organization_id: schedule.organization_id,
      case_id: schedule.case_id,
      schedule_id: schedule.id,
      payment_method_id: schedule.payment_method_id,
      gateway_config_id: schedule.gateway_config_id,
      gateway_transaction_id: gatewayResult.gatewayTransactionId,
      amount: schedule.installment_amount,
      currency: "GBP",
      status: "succeeded",
      settled_at: new Date().toISOString(),
      gateway_response: gatewayResult.rawResponse,
    });

    // Advance next collection date and reset retry count
    await supabase
      .from("recurring_payment_schedules")
      .update({
        retry_count: 0,
        next_collection_date: advanceDate(schedule.next_collection_date, schedule.frequency),
      })
      .eq("id", schedule.id);

    return { scheduleId: schedule.id, status: "succeeded", amount: schedule.installment_amount };
  } else {
    // Record failed transaction
    await supabase.from("gateway_payment_transactions").insert({
      organization_id: schedule.organization_id,
      case_id: schedule.case_id,
      schedule_id: schedule.id,
      payment_method_id: schedule.payment_method_id,
      gateway_config_id: schedule.gateway_config_id,
      amount: schedule.installment_amount,
      currency: "GBP",
      status: "retrying",
      failure_reason: gatewayResult.failureReason ?? "Payment declined",
    });

    // Increment retry count
    await supabase
      .from("recurring_payment_schedules")
      .update({ retry_count: schedule.retry_count + 1 })
      .eq("id", schedule.id);

    // Create reconciliation entry
    await supabase.from("payment_reconciliation_log").insert({
      organization_id: schedule.organization_id,
      case_id: schedule.case_id,
      transaction_id: (await supabase
        .from("gateway_payment_transactions")
        .select("id")
        .eq("schedule_id", schedule.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()).data?.id,
      status: "shortfall",
      expected_amount: schedule.installment_amount,
      actual_amount: 0,
      variance: -schedule.installment_amount,
      failure_code: gatewayResult.failureReason ?? "PAYMENT_DECLINED",
      retry_scheduled: schedule.retry_count + 1 < schedule.max_retries,
      notes: `Collection failed, retry ${schedule.retry_count + 1}/${schedule.max_retries}`,
    });

    return { scheduleId: schedule.id, status: "retrying", amount: schedule.installment_amount, failureReason: gatewayResult.failureReason };
  }
}

// ============================================================
// Helper: Check if a card is expired
// ============================================================
function checkCardExpiry(pm: PaymentMethod): string | null {
  if (!pm.expiry_month || !pm.expiry_year) return null;
  const now = new Date();
  const currentYear = now.getFullYear() % 100;
  const currentMonth = now.getMonth() + 1;
  if (pm.expiry_year < currentYear || (pm.expiry_year === currentYear && pm.expiry_month < currentMonth)) {
    return `Card expired ${String(pm.expiry_month).padStart(2, "0")}/${pm.expiry_year}`;
  }
  // Warn if card expires within 2 months
  const monthsUntilExpiry = (pm.expiry_year - currentYear) * 12 + (pm.expiry_month - currentMonth);
  if (monthsUntilExpiry <= 2 && monthsUntilExpiry >= 0) {
    return null; // Not expired yet — just approaching expiry
  }
  return null;
}

// ============================================================
// Helper: Call the payment-gateway edge function
// ============================================================
async function callGateway(
  supabase: ReturnType<typeof createClient>,
  _gatewayConfigId: string | null,
  action: string,
  payload: Record<string, unknown>,
): Promise<{ status: string; gatewayTransactionId?: string; failureReason?: string; rawResponse: Record<string, unknown> }> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  const response = await fetch(`${supabaseUrl}/functions/v1/payment-gateway`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${anonKey}`,
    },
    body: JSON.stringify({ gateway_type: "stripe", action, ...payload }),
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

// ============================================================
// Helper: Advance date by frequency
// ============================================================
function advanceDate(currentDate: string, frequency: string): string {
  const date = new Date(currentDate);
  switch (frequency) {
    case "weekly":
      date.setDate(date.getDate() + 7);
      break;
    case "fortnightly":
      date.setDate(date.getDate() + 14);
      break;
    case "four_weekly":
      date.setDate(date.getDate() + 28);
      break;
    case "monthly":
      date.setMonth(date.getMonth() + 1);
      break;
    default:
      date.setMonth(date.getMonth() + 1);
  }
  return date.toISOString().split("T")[0];
}

function jsonResponse(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
