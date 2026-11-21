import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import type {
  PaymentGatewayConfig,
  TokenisedPaymentMethod,
  RecurringPaymentSchedule,
  GatewayPaymentTransaction,
  DisbursementWaterfallEntry,
  PaymentReconciliationLog,
  GatewayType,
  GatewayPaymentType,
  PaymentFrequency,
} from "./types";
import { getGatewayAdapter } from "./gateway-adapters";

// ============================================================
// Recurring Collection Engine — edge function triggers
// ============================================================

export async function triggerDueCollections(): Promise<{
  processed: number; succeeded: number; failed: number; retrying: number;
}> {
  const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/recurring-collection?action=process_due`;
  const response = await fetch(apiUrl, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
    },
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Collection trigger failed (${response.status})`);
  }
  return response.json();
}

export async function triggerRetryFailed(): Promise<{
  retried: number; succeeded: number; still_retrying: number; permanently_failed: number;
}> {
  const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/recurring-collection?action=retry_failed`;
  const response = await fetch(apiUrl, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
    },
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Retry trigger failed (${response.status})`);
  }
  return response.json();
}

export async function detectExpiredCards(): Promise<{
  checked: number; expired: number; schedules_suspended: number;
}> {
  const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/recurring-collection?action=detect_expired`;
  const response = await fetch(apiUrl, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
    },
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Expiry detection failed (${response.status})`);
  }
  return response.json();
}

// ============================================================
// Gateway Configs
// ============================================================

export function useGatewayConfigs(organizationId: string | null) {
  const [data, setData] = useState<PaymentGatewayConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) { setData([]); setLoading(false); return; }
    setLoading(true);
    setError(null);
    const { data: rows, error: err } = await supabase
      .from("payment_gateway_configs")
      .select("*")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: true });
    if (err) { setError(err.message); setLoading(false); return; }
    setData(rows as PaymentGatewayConfig[]);
    setLoading(false);
  }, [organizationId]);

  useEffect(() => { load(); }, [load]);
  return { data, loading, error, reload: load };
}

export async function createGatewayConfig(input: {
  organization_id: string;
  gateway_type: GatewayType;
  display_name: string;
  merchant_id?: string;
  secret_ref: string;
  webhook_secret_ref?: string;
  test_mode?: boolean;
  supported_features?: string[];
}): Promise<PaymentGatewayConfig> {
  const { data, error } = await supabase
    .from("payment_gateway_configs")
    .insert({
      organization_id: input.organization_id,
      gateway_type: input.gateway_type,
      display_name: input.display_name,
      merchant_id: input.merchant_id || null,
      secret_ref: input.secret_ref,
      webhook_secret_ref: input.webhook_secret_ref || null,
      test_mode: input.test_mode ?? false,
      supported_features: input.supported_features || ["recurring_card", "tokenisation"],
      is_active: true,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as PaymentGatewayConfig;
}

export async function updateGatewayConfig(id: string, patch: Partial<{
  display_name: string;
  merchant_id: string;
  secret_ref: string;
  webhook_secret_ref: string;
  is_active: boolean;
  test_mode: boolean;
  supported_features: string[];
}>): Promise<void> {
  const { error } = await supabase.from("payment_gateway_configs").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteGatewayConfig(id: string): Promise<void> {
  const { error } = await supabase.from("payment_gateway_configs").delete().eq("id", id);
  if (error) throw error;
}

export async function verifyGatewayConnection(config: PaymentGatewayConfig): Promise<{ connected: boolean; message: string }> {
  const adapter = getGatewayAdapter(config.gateway_type);
  if (!adapter) return { connected: false, message: "No adapter registered for this gateway type" };
  try {
    const result = await adapter.verifyConnection({
      apiKey: "", // edge function reads from secrets by secret_ref
      merchantId: config.merchant_id || undefined,
      testMode: config.test_mode,
    });
    return { connected: result.connected, message: result.message || (result.connected ? "Connection verified" : "Connection failed") };
  } catch (e) {
    return { connected: false, message: e instanceof Error ? e.message : "Unknown error" };
  }
}

// ============================================================
// Tokenised Payment Methods
// ============================================================

export function useTokenisedPaymentMethods(caseId: string | null) {
  const [data, setData] = useState<TokenisedPaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!caseId) { setData([]); setLoading(false); return; }
    setLoading(true);
    setError(null);
    const { data: rows, error: err } = await supabase
      .from("payment_methods")
      .select("*")
      .eq("case_id", caseId)
      .eq("is_active", true)
      .order("created_at", { ascending: false });
    if (err) { setError(err.message); setLoading(false); return; }
    setData(rows as TokenisedPaymentMethod[]);
    setLoading(false);
  }, [caseId]);

  useEffect(() => { load(); }, [load]);
  return { data, loading, error, reload: load };
}

export async function savePaymentMethod(input: {
  organization_id: string;
  case_id: string;
  gateway_config_id: string;
  gateway_token: string;
  payment_type: GatewayPaymentType;
  card_brand?: string;
  last4?: string;
  expiry_month?: number;
  expiry_year?: number;
  cardholder_name?: string;
  is_default?: boolean;
}): Promise<TokenisedPaymentMethod> {
  if (input.is_default) {
    await supabase
      .from("payment_methods")
      .update({ is_default: false })
      .eq("case_id", input.case_id)
      .eq("is_default", true);
  }
  const { data, error } = await supabase
    .from("payment_methods")
    .insert({
      organization_id: input.organization_id,
      case_id: input.case_id,
      gateway_config_id: input.gateway_config_id,
      gateway_token: input.gateway_token,
      payment_type: input.payment_type,
      card_brand: input.card_brand || null,
      last4: input.last4 || null,
      expiry_month: input.expiry_month || null,
      expiry_year: input.expiry_year || null,
      cardholder_name: input.cardholder_name || null,
      is_default: input.is_default ?? false,
      is_active: true,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as TokenisedPaymentMethod;
}

export async function updatePaymentMethod(id: string, patch: Partial<{
  is_default: boolean;
  is_active: boolean;
  cardholder_name: string;
  expiry_month: number;
  expiry_year: number;
}>): Promise<void> {
  if (patch.is_default) {
    const { data: pm } = await supabase.from("payment_methods").select("case_id").eq("id", id).maybeSingle();
    if (pm) {
      await supabase
        .from("payment_methods")
        .update({ is_default: false })
        .eq("case_id", pm.case_id)
        .eq("is_default", true);
    }
  }
  const { error } = await supabase.from("payment_methods").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deletePaymentMethod(id: string): Promise<void> {
  const { error } = await supabase.from("payment_methods").update({ is_active: false }).eq("id", id);
  if (error) throw error;
}

// ============================================================
// Recurring Payment Schedules
// ============================================================

export function useRecurringSchedules(caseId: string | null) {
  const [data, setData] = useState<RecurringPaymentSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!caseId) { setData([]); setLoading(false); return; }
    setLoading(true);
    setError(null);
    const { data: rows, error: err } = await supabase
      .from("recurring_payment_schedules")
      .select("*")
      .eq("case_id", caseId)
      .order("created_at", { ascending: false });
    if (err) { setError(err.message); setLoading(false); return; }
    setData(rows as RecurringPaymentSchedule[]);
    setLoading(false);
  }, [caseId]);

  useEffect(() => { load(); }, [load]);
  return { data, loading, error, reload: load };
}

export async function createRecurringSchedule(input: {
  organization_id: string;
  case_id: string;
  payment_method_id?: string;
  gateway_config_id?: string;
  frequency: PaymentFrequency;
  installment_amount: number;
  preferred_payment_day?: string;
  start_date?: string;
  end_date?: string;
  next_collection_date?: string;
  max_retries?: number;
  linked_plan_type?: "dmp" | "iva" | "sfs" | "settlement";
}): Promise<RecurringPaymentSchedule> {
  const { data, error } = await supabase
    .from("recurring_payment_schedules")
    .insert({
      organization_id: input.organization_id,
      case_id: input.case_id,
      payment_method_id: input.payment_method_id || null,
      gateway_config_id: input.gateway_config_id || null,
      frequency: input.frequency,
      installment_amount: input.installment_amount,
      preferred_payment_day: input.preferred_payment_day || null,
      start_date: input.start_date || new Date().toISOString().split("T")[0],
      end_date: input.end_date || null,
      next_collection_date: input.next_collection_date || new Date().toISOString().split("T")[0],
      max_retries: input.max_retries ?? 3,
      status: "active",
      linked_plan_type: input.linked_plan_type || null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as RecurringPaymentSchedule;
}

export async function updateRecurringSchedule(id: string, patch: Partial<{
  status: RecurringPaymentSchedule["status"];
  installment_amount: number;
  frequency: PaymentFrequency;
  preferred_payment_day: string;
  next_collection_date: string;
  end_date: string;
  max_retries: number;
  retry_count: number;
}>): Promise<void> {
  const { error } = await supabase.from("recurring_payment_schedules").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteRecurringSchedule(id: string): Promise<void> {
  const { error } = await supabase.from("recurring_payment_schedules").delete().eq("id", id);
  if (error) throw error;
}

// ============================================================
// Gateway Payment Transactions
// ============================================================

export function useGatewayTransactions(caseId: string | null) {
  const [data, setData] = useState<GatewayPaymentTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!caseId) { setData([]); setLoading(false); return; }
    setLoading(true);
    setError(null);
    const { data: rows, error: err } = await supabase
      .from("gateway_payment_transactions")
      .select("*")
      .eq("case_id", caseId)
      .order("created_at", { ascending: false });
    if (err) { setError(err.message); setLoading(false); return; }
    setData(rows as GatewayPaymentTransaction[]);
    setLoading(false);
  }, [caseId]);

  useEffect(() => { load(); }, [load]);
  return { data, loading, error, reload: load };
}

export async function recordGatewayTransaction(input: {
  organization_id: string;
  case_id: string;
  schedule_id?: string;
  payment_method_id?: string;
  gateway_config_id?: string;
  gateway_transaction_id?: string;
  amount: number;
  currency?: string;
  status: GatewayPaymentTransaction["status"];
  failure_reason?: string;
  gateway_response?: Record<string, unknown>;
  settled_at?: string;
  retry_of?: string;
}): Promise<GatewayPaymentTransaction> {
  const { data, error } = await supabase
    .from("gateway_payment_transactions")
    .insert({
      organization_id: input.organization_id,
      case_id: input.case_id,
      schedule_id: input.schedule_id || null,
      payment_method_id: input.payment_method_id || null,
      gateway_config_id: input.gateway_config_id || null,
      gateway_transaction_id: input.gateway_transaction_id || null,
      amount: input.amount,
      currency: input.currency || "GBP",
      status: input.status,
      failure_reason: input.failure_reason || null,
      gateway_response: input.gateway_response || null,
      settled_at: input.settled_at || null,
      retry_of: input.retry_of || null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as GatewayPaymentTransaction;
}

export async function retryFailedTransaction(transactionId: string): Promise<GatewayPaymentTransaction | null> {
  const { data: original, error: fetchErr } = await supabase
    .from("gateway_payment_transactions")
    .select("*")
    .eq("id", transactionId)
    .maybeSingle();
  if (fetchErr) throw fetchErr;
  if (!original) return null;

  const { data, error } = await supabase
    .from("gateway_payment_transactions")
    .insert({
      organization_id: original.organization_id,
      case_id: original.case_id,
      schedule_id: original.schedule_id,
      payment_method_id: original.payment_method_id,
      gateway_config_id: original.gateway_config_id,
      amount: original.amount,
      currency: original.currency,
      status: "retrying",
      retry_of: transactionId,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as GatewayPaymentTransaction;
}

// ============================================================
// Disbursement Waterfall Entries
// ============================================================

export function useDisbursementWaterfall(caseId: string | null) {
  const [data, setData] = useState<DisbursementWaterfallEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!caseId) { setData([]); setLoading(false); return; }
    setLoading(true);
    setError(null);
    const { data: rows, error: err } = await supabase
      .from("disbursement_waterfall_entries")
      .select("*")
      .eq("case_id", caseId)
      .order("waterfall_order", { ascending: true });
    if (err) { setError(err.message); setLoading(false); return; }
    setData(rows as DisbursementWaterfallEntry[]);
    setLoading(false);
  }, [caseId]);

  useEffect(() => { load(); }, [load]);
  return { data, loading, error, reload: load };
}

export async function createDisbursementEntries(
  caseId: string,
  organizationId: string,
  sourceTransactionId: string,
  entries: {
    category: DisbursementWaterfallEntry["category"];
    payeeName: string;
    payeeReference?: string;
    allocatedAmount: number;
    creditorId?: string;
  }[],
): Promise<DisbursementWaterfallEntry[]> {
  const rows = entries.map((e, idx) => ({
    organization_id: organizationId,
    case_id: caseId,
    source_transaction_id: sourceTransactionId,
    waterfall_order: idx + 1,
    category: e.category,
    payee_name: e.payeeName,
    payee_reference: e.payeeReference || null,
    allocated_amount: e.allocatedAmount,
    status: "scheduled" as const,
    creditor_id: e.creditorId || null,
  }));
  const { data, error } = await supabase
    .from("disbursement_waterfall_entries")
    .insert(rows)
    .select("*");
  if (error) throw error;
  return data as DisbursementWaterfallEntry[];
}

export async function updateDisbursementStatus(id: string, patch: Partial<{
  status: DisbursementWaterfallEntry["status"];
  settled_date: string;
}>): Promise<void> {
  const updatePatch: Record<string, unknown> = { ...patch };
  if (patch.status === "settled") updatePatch.settled_date = new Date().toISOString().split("T")[0];
  const { error } = await supabase.from("disbursement_waterfall_entries").update(updatePatch).eq("id", id);
  if (error) throw error;
}

// ============================================================
// Payment Reconciliation Log
// ============================================================

export function useReconciliationLog(caseId: string | null) {
  const [data, setData] = useState<PaymentReconciliationLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!caseId) { setData([]); setLoading(false); return; }
    setLoading(true);
    setError(null);
    const { data: rows, error: err } = await supabase
      .from("payment_reconciliation_log")
      .select("*")
      .eq("case_id", caseId)
      .order("reconciliation_date", { ascending: false });
    if (err) { setError(err.message); setLoading(false); return; }
    setData(rows as PaymentReconciliationLog[]);
    setLoading(false);
  }, [caseId]);

  useEffect(() => { load(); }, [load]);
  return { data, loading, error, reload: load };
}

export async function createReconciliationEntry(input: {
  organization_id: string;
  case_id: string;
  transaction_id: string;
  reconciliation_date?: string;
  status: PaymentReconciliationLog["status"];
  expected_amount: number;
  actual_amount: number;
  failure_code?: string;
  retry_scheduled?: boolean;
  notes?: string;
}): Promise<PaymentReconciliationLog> {
  const variance = Math.round((input.actual_amount - input.expected_amount) * 100) / 100;
  const { data, error } = await supabase
    .from("payment_reconciliation_log")
    .insert({
      organization_id: input.organization_id,
      case_id: input.case_id,
      transaction_id: input.transaction_id,
      reconciliation_date: input.reconciliation_date || new Date().toISOString().split("T")[0],
      status: input.status,
      expected_amount: input.expected_amount,
      actual_amount: input.actual_amount,
      variance,
      failure_code: input.failure_code || null,
      retry_scheduled: input.retry_scheduled ?? false,
      notes: input.notes || null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as PaymentReconciliationLog;
}
