import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { enqueueBackgroundJob } from "@/lib/queue-hooks";
import type {
  BankFeed, BankTransaction, BatchPaymentRun, BatchPaymentItem,
  CashierAuditLog, LedgerLock, DisbursementRun, DisbursementRunItem,
  PaymentLinkInvitation,
  BankFeedType, BankFeedFrequency, BankTxnMatchStatus,
  BatchRunType, DisbursementOutputFormat, DisbursementRunStatus,
  AuditActionType, PaymentLinkChannel,
} from "@/lib/types";

// ============================================================
// Bank Feeds
// ============================================================

export function useBankFeeds(orgId: string | null) {
  const [data, setData] = useState<BankFeed[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orgId) { setData([]); setLoading(false); return; }
    setLoading(true);
    supabase.from("bank_feeds").select("*").eq("organization_id", orgId).order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) setError(error.message); else setData(data as BankFeed[]);
        setLoading(false);
      });
  }, [orgId]);

  const reload = useCallback(() => {
    if (!orgId) return;
    supabase.from("bank_feeds").select("*").eq("organization_id", orgId).order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) setError(error.message); else setData(data as BankFeed[]);
      });
  }, [orgId]);

  return { data, loading, error, reload };
}

export async function createBankFeed(orgId: string, feed: {
  feed_name: string; feed_type: BankFeedType; account_number_masked?: string;
  sort_code?: string; bank_reference?: string; import_frequency?: BankFeedFrequency;
}): Promise<BankFeed> {
  const { data, error } = await supabase.from("bank_feeds").insert({
    organization_id: orgId, ...feed,
  }).select().single();
  if (error) throw new Error(error.message);
  return data as BankFeed;
}

export async function deleteBankFeed(id: string): Promise<void> {
  const { error } = await supabase.from("bank_feeds").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function importBankTransactions(
  orgId: string, feedId: string, transactions: Array<{
    transaction_date: string; amount: number; direction: "credit" | "debit";
    reference?: string; description?: string; counterparty_name?: string; counterparty_account?: string;
  }>,
): Promise<{ imported: number }> {
  const rows = transactions.map((t) => ({
    organization_id: orgId, bank_feed_id: feedId, ...t,
  }));
  const { data, error } = await supabase.from("bank_transactions").insert(rows).select("id");
  if (error) throw new Error(error.message);

  await supabase.from("bank_feeds").update({
    last_import_at: new Date().toISOString(), last_import_count: rows.length,
  }).eq("id", feedId);

  return { imported: rows.length };
}

// ============================================================
// Bank Transactions (with auto-matching)
// ============================================================

export function useBankTransactions(orgId: string | null, filterStatus?: BankTxnMatchStatus) {
  const [data, setData] = useState<BankTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orgId) { setData([]); setLoading(false); return; }
    setLoading(true);
    let query = supabase.from("bank_transactions").select("*").eq("organization_id", orgId).order("transaction_date", { ascending: false });
    if (filterStatus) query = query.eq("match_status", filterStatus);
    query.then(({ data, error }) => {
      if (error) setError(error.message); else setData(data as BankTransaction[]);
      setLoading(false);
    });
  }, [orgId, filterStatus]);

  const reload = useCallback(() => {
    if (!orgId) return;
    let query = supabase.from("bank_transactions").select("*").eq("organization_id", orgId).order("transaction_date", { ascending: false });
    if (filterStatus) query = query.eq("match_status", filterStatus);
    query.then(({ data, error }) => {
      if (error) setError(error.message); else setData(data as BankTransaction[]);
    });
  }, [orgId, filterStatus]);

  return { data, loading, error, reload };
}

export async function matchBankTransaction(
  txnId: string, matchData: {
    matched_transaction_id?: string; matched_schedule_id?: string; matched_case_id?: string;
    match_confidence?: "high" | "medium" | "low" | "manual"; match_notes?: string;
  }, isAuto = false,
): Promise<void> {
  const { error } = await supabase.from("bank_transactions").update({
    match_status: isAuto ? "auto_matched" : "matched", ...matchData,
  }).eq("id", txnId);
  if (error) throw new Error(error.message);
}

export async function ignoreBankTransaction(txnId: string, reason: string): Promise<void> {
  const { error } = await supabase.from("bank_transactions").update({
    match_status: "ignored", match_notes: reason,
  }).eq("id", txnId);
  if (error) throw new Error(error.message);
}

export async function autoMatchBankTransactions(orgId: string): Promise<{
  checked: number; matched: number; unmatched: number;
}> {
  const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/batch-processing?action=auto_match`;
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ organization_id: orgId }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Auto-match failed (${response.status})`);
  }
  return response.json();
}

// ============================================================
// Batch Payment Runs
// ============================================================

export function useBatchRuns(orgId: string | null) {
  const [data, setData] = useState<BatchPaymentRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orgId) { setData([]); setLoading(false); return; }
    setLoading(true);
    supabase.from("batch_payment_runs").select("*").eq("organization_id", orgId).order("batch_date", { ascending: false })
      .then(({ data, error }) => {
        if (error) setError(error.message); else setData(data as BatchPaymentRun[]);
        setLoading(false);
      });
  }, [orgId]);

  const reload = useCallback(() => {
    if (!orgId) return;
    supabase.from("batch_payment_runs").select("*").eq("organization_id", orgId).order("batch_date", { ascending: false })
      .then(({ data, error }) => {
        if (error) setError(error.message); else setData(data as BatchPaymentRun[]);
      });
  }, [orgId]);

  return { data, loading, error, reload };
}

export function useBatchItems(runId: string | null) {
  const [data, setData] = useState<BatchPaymentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!runId) { setData([]); setLoading(false); return; }
    setLoading(true);
    supabase.from("batch_payment_items").select("*").eq("batch_run_id", runId).order("created_at", { ascending: true })
      .then(({ data, error }) => {
        if (error) setError(error.message); else setData(data as BatchPaymentItem[]);
        setLoading(false);
      });
  }, [runId]);

  return { data, loading, error };
}

export async function createBatchRun(orgId: string, batchType: BatchRunType): Promise<{ runId: string; totalItems: number; totalAmount: number }> {
  const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/batch-processing?action=create`;
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ organization_id: orgId, batch_type: batchType }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Batch creation failed (${response.status})`);
  }
  return response.json();
}

export async function executeBatchRun(runId: string): Promise<{
  processed: number; succeeded: number; failed: number; totalAmount: number;
}> {
  const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/batch-processing?action=execute`;
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ run_id: runId }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Batch execution failed (${response.status})`);
  }
  return response.json();
}

export async function retryBatchRun(runId: string): Promise<{
  retried: number; succeeded: number; stillFailed: number;
}> {
  const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/batch-processing?action=retry`;
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ run_id: runId }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Batch retry failed (${response.status})`);
  }
  return response.json();
}

// ============================================================
// Async (non-blocking) versions — enqueue background jobs
// ============================================================

export async function executeBatchRunAsync(orgId: string, runId: string, totalItems: number): Promise<string> {
  const job = await enqueueBackgroundJob(orgId, {
    job_type: "batch_collection",
    payload: { batch_run_id: runId, organization_id: orgId },
    total_items: totalItems,
    chunk_size: 25,
    rate_limit_ms: 500,
    priority: 8,
  });
  return job.id;
}

export async function generateDisbursementFileAsync(orgId: string, runId: string, totalItems: number): Promise<string> {
  const job = await enqueueBackgroundJob(orgId, {
    job_type: "disbursement_run",
    payload: { disbursement_run_id: runId, organization_id: orgId },
    total_items: totalItems,
    chunk_size: 50,
    rate_limit_ms: 200,
    priority: 6,
  });
  return job.id;
}

export async function autoMatchBankTransactionsAsync(orgId: string, totalItems: number): Promise<string> {
  const job = await enqueueBackgroundJob(orgId, {
    job_type: "bank_reconciliation",
    payload: { organization_id: orgId },
    total_items: totalItems,
    chunk_size: 50,
    rate_limit_ms: 100,
    priority: 5,
  });
  return job.id;
}

// ============================================================
// Cashier Audit Logs
// ============================================================

export function useAuditLogs(orgId: string | null, caseId?: string | null, limit = 50) {
  const [data, setData] = useState<CashierAuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orgId) { setData([]); setLoading(false); return; }
    setLoading(true);
    let query = supabase.from("cashier_audit_logs").select("*").eq("organization_id", orgId).order("created_at", { ascending: false }).limit(limit);
    if (caseId) query = query.eq("case_id", caseId);
    query.then(({ data, error }) => {
      if (error) setError(error.message); else setData(data as CashierAuditLog[]);
      setLoading(false);
    });
  }, [orgId, caseId, limit]);

  const reload = useCallback(() => {
    if (!orgId) return;
    let query = supabase.from("cashier_audit_logs").select("*").eq("organization_id", orgId).order("created_at", { ascending: false }).limit(limit);
    if (caseId) query = query.eq("case_id", caseId);
    query.then(({ data, error }) => {
      if (error) setError(error.message); else setData(data as CashierAuditLog[]);
    });
  }, [orgId, caseId, limit]);

  return { data, loading, error, reload };
}

export async function logAuditAction(orgId: string, entry: {
  case_id?: string; action_type: AuditActionType; entity_type?: string;
  entity_id?: string; old_value?: Record<string, unknown>; new_value?: Record<string, unknown>;
  reason?: string; amount_impact?: number;
}): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from("cashier_audit_logs").insert({
    organization_id: orgId,
    user_id: user?.id ?? null,
    user_email: user?.email ?? null,
    ...entry,
  });
  if (error) throw new Error(error.message);
}

// ============================================================
// Ledger Locks (End-of-day balancing)
// ============================================================

export function useLedgerLocks(orgId: string | null) {
  const [data, setData] = useState<LedgerLock[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orgId) { setData([]); setLoading(false); return; }
    setLoading(true);
    supabase.from("ledger_locks").select("*").eq("organization_id", orgId).order("lock_date", { ascending: false })
      .then(({ data, error }) => {
        if (error) setError(error.message); else setData(data as LedgerLock[]);
        setLoading(false);
      });
  }, [orgId]);

  const reload = useCallback(() => {
    if (!orgId) return;
    supabase.from("ledger_locks").select("*").eq("organization_id", orgId).order("lock_date", { ascending: false })
      .then(({ data, error }) => {
        if (error) setError(error.message); else setData(data as LedgerLock[]);
      });
  }, [orgId]);

  return { data, loading, error, reload };
}

export async function createLedgerLock(orgId: string, lockData: {
  lock_date: string; lock_type?: "end_of_day" | "period" | "month_end";
  total_collected: number; total_disbursed: number; variance: number;
}): Promise<LedgerLock> {
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase.from("ledger_locks").insert({
    organization_id: orgId,
    locked_by: user?.id ?? null,
    locked_by_email: user?.email ?? null,
    locked_at: new Date().toISOString(),
    ...lockData,
  }).select().single();
  if (error) throw new Error(error.message);
  return data as LedgerLock;
}

export async function unlockLedger(lockId: string, reason: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from("ledger_locks").update({
    status: "unlocked",
    unlocked_by: user?.id ?? null,
    unlocked_at: new Date().toISOString(),
    unlock_reason: reason,
  }).eq("id", lockId);
  if (error) throw new Error(error.message);
}

// ============================================================
// Disbursement Runs
// ============================================================

export function useDisbursementRuns(orgId: string | null, caseId?: string | null) {
  const [data, setData] = useState<DisbursementRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orgId) { setData([]); setLoading(false); return; }
    setLoading(true);
    let query = supabase.from("disbursement_runs").select("*").eq("organization_id", orgId).order("run_date", { ascending: false });
    if (caseId) query = query.eq("case_id", caseId);
    query.then(({ data, error }) => {
      if (error) setError(error.message); else setData(data as DisbursementRun[]);
      setLoading(false);
    });
  }, [orgId, caseId]);

  const reload = useCallback(() => {
    if (!orgId) return;
    let query = supabase.from("disbursement_runs").select("*").eq("organization_id", orgId).order("run_date", { ascending: false });
    if (caseId) query = query.eq("case_id", caseId);
    query.then(({ data, error }) => {
      if (error) setError(error.message); else setData(data as DisbursementRun[]);
    });
  }, [orgId, caseId]);

  return { data, loading, error, reload };
}

export function useDisbursementRunItems(runId: string | null) {
  const [data, setData] = useState<DisbursementRunItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!runId) { setData([]); setLoading(false); return; }
    setLoading(true);
    supabase.from("disbursement_run_items").select("*").eq("disbursement_run_id", runId).order("created_at", { ascending: true })
      .then(({ data, error }) => {
        if (error) setError(error.message); else setData(data as DisbursementRunItem[]);
        setLoading(false);
      });
  }, [runId]);

  return { data, loading, error };
}

export async function createDisbursementRun(orgId: string, runData: {
  case_id?: string; output_format: DisbursementOutputFormat;
  waterfall_entry_ids: string[];
}): Promise<DisbursementRun> {
  const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/disbursement-run?action=create`;
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ organization_id: orgId, ...runData }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Disbursement run creation failed (${response.status})`);
  }
  return response.json();
}

export async function approveDisbursementRun(runId: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from("disbursement_runs").update({
    status: "approved" as DisbursementRunStatus,
    approved_by: user?.id ?? null,
    approved_at: new Date().toISOString(),
  }).eq("id", runId);
  if (error) throw new Error(error.message);
}

export async function generateDisbursementFile(runId: string): Promise<{ fileReference: string; totalAmount: number; totalItems: number }> {
  const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/disbursement-run?action=generate`;
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ run_id: runId }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `File generation failed (${response.status})`);
  }
  return response.json();
}

export async function submitDisbursementRun(runId: string): Promise<void> {
  const { error } = await supabase.from("disbursement_runs").update({
    status: "submitted" as DisbursementRunStatus,
    submitted_at: new Date().toISOString(),
  }).eq("id", runId);
  if (error) throw new Error(error.message);
}

// ============================================================
// Payment Link Invitations (exception remediation)
// ============================================================

export function usePaymentLinks(orgId: string | null, filterStatus?: string) {
  const [data, setData] = useState<PaymentLinkInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orgId) { setData([]); setLoading(false); return; }
    setLoading(true);
    let query = supabase.from("payment_link_invitations").select("*").eq("organization_id", orgId).order("created_at", { ascending: false });
    if (filterStatus) query = query.eq("status", filterStatus);
    query.then(({ data, error }) => {
      if (error) setError(error.message); else setData(data as PaymentLinkInvitation[]);
      setLoading(false);
    });
  }, [orgId, filterStatus]);

  const reload = useCallback(() => {
    if (!orgId) return;
    let query = supabase.from("payment_link_invitations").select("*").eq("organization_id", orgId).order("created_at", { ascending: false });
    if (filterStatus) query = query.eq("status", filterStatus);
    query.then(({ data, error }) => {
      if (error) setError(error.message); else setData(data as PaymentLinkInvitation[]);
    });
  }, [orgId, filterStatus]);

  return { data, loading, error, reload };
}

export async function sendPaymentLink(orgId: string, linkData: {
  case_id?: string; schedule_id?: string; failed_transaction_id?: string;
  debtor_name: string; debtor_contact: string; contact_channel: PaymentLinkChannel;
  amount_requested: number;
}): Promise<PaymentLinkInvitation> {
  const { data, error } = await supabase.from("payment_link_invitations").insert({
    organization_id: orgId, ...linkData,
  }).select().single();
  if (error) throw new Error(error.message);
  return data as PaymentLinkInvitation;
}
