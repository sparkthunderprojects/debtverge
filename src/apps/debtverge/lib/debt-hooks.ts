import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/core/supabase";
import type {
  DebtCase, DebtCreditor, DebtSfsEntry, DebtDistribution, DebtAuditEntry,
  DebtCaseStatus, DebtPlanType, DebtType, DebtSfsCategory, DebtDistributionStatus,
  DebtPayment, DebtNegotiationEvent, DebtNegotiationEventType,
  DebtCustomerProfile, DebtPreviousAddress, DebtTenureType,
  DebtVulnerabilityAssessment, DebtVulnerabilityLevel, DebtBenefitsCheck,
  DebtBankTransaction, DebtAnnualReview, DebtAnnualReviewStatus,
  PaymentFrequency, PaymentScheduleDay, PaymentSchedule, PaymentTransaction, PaymentTransactionStatus,
  BreathingSpace, BreathingSpaceType, BreathingSpaceStatus,
  BreathingSpaceReviewTask, BreathingSpaceEligibilityChecks,
} from "@/core/types";

// ============================================================
// Cases
// ============================================================

export function useDebtCases() {
  const [data, setData] = useState<DebtCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data: rows, error: err } = await supabase
      .from("debt_cases")
      .select("*")
      .order("created_at", { ascending: false });
    if (err) { setError(err.message); setLoading(false); return; }
    setData(rows as DebtCase[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  return { data, loading, error, reload: load };
}

export async function generateCaseNumber(): Promise<string> {
  const { data, error } = await supabase
    .from("debt_cases")
    .select("case_number")
    .order("case_number", { ascending: false })
    .limit(1);
  if (error || !data || data.length === 0) return `DV-2026-0001`;
  const match = data[0].case_number.match(/(\d+)$/);
  const next = match ? parseInt(match[1]) + 1 : 1;
  return `DV-2026-${String(next).padStart(4, "0")}`;
}

export async function createDebtCase(input: {
  case_number: string;
  debtor_name: string;
  debtor_reference?: string;
  status?: DebtCaseStatus;
  plan_type?: DebtPlanType;
  notes?: string;
  organization_id?: string | null;
}): Promise<DebtCase> {
  const { data, error } = await supabase
    .from("debt_cases")
    .insert({
      case_number: input.case_number,
      debtor_name: input.debtor_name,
      debtor_reference: input.debtor_reference || null,
      status: input.status || "intake",
      plan_type: input.plan_type || "pending",
      notes: input.notes || null,
      organization_id: input.organization_id || null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as DebtCase;
}

export async function updateDebtCase(id: string, patch: Partial<{
  debtor_name: string;
  debtor_reference: string;
  status: DebtCaseStatus;
  plan_type: DebtPlanType;
  monthly_disposable_income: number;
  total_debt: number;
  recovery_rate_target: number;
  next_distribution_date: string;
  notes: string;
}>): Promise<void> {
  const { error } = await supabase.from("debt_cases").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteDebtCase(id: string): Promise<void> {
  const { error } = await supabase.from("debt_cases").delete().eq("id", id);
  if (error) throw error;
}

// ============================================================
// Creditors
// ============================================================

export function useDebtCreditors(caseId: string | null) {
  const [data, setData] = useState<DebtCreditor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!caseId) { setData([]); setLoading(false); return; }
    setLoading(true);
    setError(null);
    const { data: rows, error: err } = await supabase
      .from("debt_creditors")
      .select("*")
      .eq("case_id", caseId)
      .order("created_at", { ascending: true });
    if (err) { setError(err.message); setLoading(false); return; }
    setData(rows as DebtCreditor[]);
    setLoading(false);
  }, [caseId]);

  useEffect(() => { load(); }, [load]);
  return { data, loading, error, reload: load };
}

export async function createDebtCreditor(input: {
  case_id: string;
  creditor_name: string;
  debt_type: DebtType;
  account_reference?: string;
  current_balance: number;
  interest_rate?: number;
  minimum_payment?: number;
  is_priority?: boolean;
  settlement_offer?: number;
}): Promise<DebtCreditor> {
  const { data, error } = await supabase
    .from("debt_creditors")
    .insert({
      case_id: input.case_id,
      creditor_name: input.creditor_name,
      debt_type: input.debt_type,
      account_reference: input.account_reference || null,
      current_balance: input.current_balance,
      interest_rate: input.interest_rate ?? 0,
      minimum_payment: input.minimum_payment ?? null,
      is_priority: input.is_priority ?? false,
      settlement_offer: input.settlement_offer ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as DebtCreditor;
}

export async function updateDebtCreditor(id: string, patch: Partial<{
  creditor_name: string;
  debt_type: DebtType;
  account_reference: string;
  current_balance: number;
  interest_rate: number;
  minimum_payment: number;
  pro_rata_amount: number;
  is_priority: boolean;
  settlement_offer: number;
}>): Promise<void> {
  const { error } = await supabase.from("debt_creditors").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteDebtCreditor(id: string): Promise<void> {
  const { error } = await supabase.from("debt_creditors").delete().eq("id", id);
  if (error) throw error;
}

// ============================================================
// SFS Entries (Income & Expenditure)
// ============================================================

export function useDebtSfsEntries(caseId: string | null) {
  const [data, setData] = useState<DebtSfsEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!caseId) { setData([]); setLoading(false); return; }
    setLoading(true);
    setError(null);
    const { data: rows, error: err } = await supabase
      .from("debt_sfs_entries")
      .select("*")
      .eq("case_id", caseId)
      .order("created_at", { ascending: true });
    if (err) { setError(err.message); setLoading(false); return; }
    setData(rows as DebtSfsEntry[]);
    setLoading(false);
  }, [caseId]);

  useEffect(() => { load(); }, [load]);
  return { data, loading, error, reload: load };
}

export async function createDebtSfsEntry(input: {
  case_id: string;
  category: DebtSfsCategory;
  label: string;
  amount: number;
  is_recurring?: boolean;
}): Promise<DebtSfsEntry> {
  const { data, error } = await supabase
    .from("debt_sfs_entries")
    .insert({
      case_id: input.case_id,
      category: input.category,
      label: input.label,
      amount: input.amount,
      is_recurring: input.is_recurring ?? true,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as DebtSfsEntry;
}

export async function updateDebtSfsEntry(id: string, patch: Partial<{
  category: DebtSfsCategory;
  label: string;
  amount: number;
  is_recurring: boolean;
}>): Promise<void> {
  const { error } = await supabase.from("debt_sfs_entries").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteDebtSfsEntry(id: string): Promise<void> {
  const { error } = await supabase.from("debt_sfs_entries").delete().eq("id", id);
  if (error) throw error;
}

// ============================================================
// Distributions
// ============================================================

export function useDebtDistributions(caseId: string | null) {
  const [data, setData] = useState<DebtDistribution[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!caseId) { setData([]); setLoading(false); return; }
    setLoading(true);
    setError(null);
    const { data: rows, error: err } = await supabase
      .from("debt_distributions")
      .select("*")
      .eq("case_id", caseId)
      .order("distribution_date", { ascending: true });
    if (err) { setError(err.message); setLoading(false); return; }
    setData(rows as DebtDistribution[]);
    setLoading(false);
  }, [caseId]);

  useEffect(() => { load(); }, [load]);
  return { data, loading, error, reload: load };
}

export async function createDebtDistribution(input: {
  case_id: string;
  creditor_id: string;
  distribution_date: string;
  amount: number;
  status?: DebtDistributionStatus;
  reference?: string;
}): Promise<DebtDistribution> {
  const { data, error } = await supabase
    .from("debt_distributions")
    .insert({
      case_id: input.case_id,
      creditor_id: input.creditor_id,
      distribution_date: input.distribution_date,
      amount: input.amount,
      status: input.status || "scheduled",
      reference: input.reference || null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as DebtDistribution;
}

export async function updateDebtDistributionStatus(id: string, status: DebtDistributionStatus): Promise<void> {
  const { error } = await supabase.from("debt_distributions").update({ status }).eq("id", id);
  if (error) throw error;
}

export async function deleteDebtDistribution(id: string): Promise<void> {
  const { error } = await supabase.from("debt_distributions").delete().eq("id", id);
  if (error) throw error;
}

// ============================================================
// Audit Log
// ============================================================

export function useDebtAuditLog(caseId: string | null) {
  const [data, setData] = useState<DebtAuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!caseId) { setData([]); setLoading(false); return; }
    setLoading(true);
    setError(null);
    const { data: rows, error: err } = await supabase
      .from("debt_audit_log")
      .select("*")
      .eq("case_id", caseId)
      .order("created_at", { ascending: false });
    if (err) { setError(err.message); setLoading(false); return; }
    setData(rows as DebtAuditEntry[]);
    setLoading(false);
  }, [caseId]);

  useEffect(() => { load(); }, [load]);
  return { data, loading, error, reload: load };
}

export async function addAuditMilestone(input: {
  case_id: string;
  milestone: string;
  description?: string;
  actor?: string;
}): Promise<DebtAuditEntry> {
  const { data, error } = await supabase
    .from("debt_audit_log")
    .insert({
      case_id: input.case_id,
      milestone: input.milestone,
      description: input.description || null,
      actor: input.actor || null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as DebtAuditEntry;
}

// ============================================================
// Pro-Rata Distribution Calculation
// ============================================================

export function calculateProRata(
  disposableIncome: number,
  creditors: DebtCreditor[],
): DebtCreditor[] {
  const nonPriorityTotal = creditors
    .filter((c) => !c.is_priority)
    .reduce((sum, c) => sum + c.current_balance, 0);

  if (nonPriorityTotal === 0 || disposableIncome <= 0) {
    return creditors.map((c) => ({ ...c, pro_rata_amount: 0 }));
  }

  return creditors.map((c) => {
    if (c.is_priority) {
      return { ...c, pro_rata_amount: c.minimum_payment ?? c.current_balance };
    }
    const share = c.current_balance / nonPriorityTotal;
    return { ...c, pro_rata_amount: Math.round(disposableIncome * share * 100) / 100 };
  });
}

// ============================================================
// Plan Comparison Calculations
// ============================================================

export interface DmpProjection {
  months: number;
  totalPaid: number;
  remaining: number;
  monthlyPoints: { month: number; balance: number; cumulativePaid: number }[];
}

export function projectDmp(
  totalDebt: number,
  monthlyPayment: number,
  avgInterestRate: number,
): DmpProjection {
  const monthlyRate = avgInterestRate / 100 / 12;
  const points: { month: number; balance: number; cumulativePaid: number }[] = [];
  let balance = totalDebt;
  let cumulativePaid = 0;
  let month = 0;

  points.push({ month: 0, balance, cumulativePaid });

  while (balance > 0 && month < 600) {
    month++;
    const interest = balance * monthlyRate;
    const principal = Math.min(monthlyPayment - interest, balance);
    balance = Math.max(0, balance - principal);
    cumulativePaid += monthlyPayment;
    points.push({ month, balance: Math.round(balance * 100) / 100, cumulativePaid: Math.round(cumulativePaid * 100) / 100 });
    if (monthlyPayment <= interest && month > 1) break;
  }

  return { months: month, totalPaid: cumulativePaid, remaining: balance, monthlyPoints: points };
}

export interface SettlementProjection {
  months: number;
  totalPaid: number;
  remaining: number;
  monthlyPoints: { month: number; balance: number; cumulativePaid: number }[];
}

export function projectSettlement(
  creditors: DebtCreditor[],
  monthlySaving: number,
): SettlementProjection {
  const totalSettlement = creditors.reduce((s, c) => s + (c.settlement_offer ?? c.current_balance), 0);
  const monthsToSave = monthlySaving > 0 ? Math.ceil(totalSettlement / monthlySaving) : 0;

  const points: { month: number; balance: number; cumulativePaid: number }[] = [];
  let balance = creditors.reduce((s, c) => s + c.current_balance, 0);
  let cumulativePaid = 0;

  points.push({ month: 0, balance, cumulativePaid });

  for (let m = 1; m <= monthsToSave; m++) {
    cumulativePaid += monthlySaving;
    const progress = cumulativePaid / totalSettlement;
    balance = Math.max(0, Math.round((creditors.reduce((s, c) => s + c.current_balance, 0) * (1 - progress)) * 100) / 100);
    points.push({ month: m, balance, cumulativePaid: Math.round(cumulativePaid * 100) / 100 });
  }

  return { months: monthsToSave, totalPaid: Math.round(totalSettlement * 100) / 100, remaining: 0, monthlyPoints: points };
}

// ============================================================
// Simple Pro-Rata: (Creditor Balance / Total Debt) * Disposable
// ============================================================

export interface ProRataResult {
  id: string;
  creditor_name: string;
  current_balance: number;
  pro_rata_amount: number;
  pro_rata_pct: number;
}

export function calculateProRataSimple(
  disposableIncome: number,
  creditors: DebtCreditor[],
): ProRataResult[] {
  const totalDebt = creditors.reduce((s, c) => s + c.current_balance, 0);
  if (totalDebt === 0 || disposableIncome <= 0) {
    return creditors.map((c) => ({
      id: c.id,
      creditor_name: c.creditor_name,
      current_balance: c.current_balance,
      pro_rata_amount: 0,
      pro_rata_pct: 0,
    }));
  }
  return creditors.map((c) => {
    const share = c.current_balance / totalDebt;
    return {
      id: c.id,
      creditor_name: c.creditor_name,
      current_balance: c.current_balance,
      pro_rata_amount: Math.round(disposableIncome * share * 100) / 100,
      pro_rata_pct: share * 100,
    };
  });
}

// ============================================================
// Per-Creditor DMP Projection (individual interest rates)
// ============================================================

export function projectDmpWithRates(
  creditors: DebtCreditor[],
  monthlyPayment: number,
  useZeroInterest: boolean,
): DmpProjection {
  const points: { month: number; balance: number; cumulativePaid: number }[] = [];
  let balances = creditors.map((c) => ({
    id: c.id,
    balance: c.current_balance,
    monthlyRate: useZeroInterest ? 0 : c.interest_rate / 100 / 12,
  }));

  let totalBalance = balances.reduce((s, b) => s + b.balance, 0);
  let cumulativePaid = 0;
  let month = 0;

  points.push({ month: 0, balance: Math.round(totalBalance * 100) / 100, cumulativePaid });

  if (monthlyPayment <= 0) {
    return { months: 0, totalPaid: 0, remaining: totalBalance, monthlyPoints: points };
  }

  while (totalBalance > 0.01 && month < 600) {
    month++;

    balances = balances.map((b) => ({
      ...b,
      balance: b.balance * (1 + b.monthlyRate),
    }));

    const currentTotal = balances.reduce((s, b) => s + b.balance, 0);
    if (currentTotal <= 0) break;

    const payments = balances.map((b) => {
      const share = b.balance / currentTotal;
      return Math.min(monthlyPayment * share, b.balance);
    });

    balances = balances.map((b, i) => ({
      ...b,
      balance: Math.max(0, b.balance - payments[i]),
    }));

    totalBalance = balances.reduce((s, b) => s + b.balance, 0);
    cumulativePaid += monthlyPayment;
    points.push({
      month,
      balance: Math.round(totalBalance * 100) / 100,
      cumulativePaid: Math.round(cumulativePaid * 100) / 100,
    });
  }

  return {
    months: month,
    totalPaid: Math.round(cumulativePaid * 100) / 100,
    remaining: Math.round(totalBalance * 100) / 100,
    monthlyPoints: points,
  };
}

// ============================================================
// DMP Offer Letter Generation
// ============================================================

export function generateOfferLetterText(
  caseData: DebtCase,
  creditor: DebtCreditor,
  sfsEntries: DebtSfsEntry[],
  proRataAmount: number,
  advisorName?: string,
): string {
  const incomeItems = sfsEntries.filter((e) => e.category === "income");
  const essentialItems = sfsEntries.filter((e) => e.category === "essential_expense");
  const discretionaryItems = sfsEntries.filter((e) => e.category === "discretionary_expense");
  const debtItems = sfsEntries.filter((e) => e.category === "debt_repayment");

  const income = incomeItems.reduce((s, e) => s + e.amount, 0);
  const essential = essentialItems.reduce((s, e) => s + e.amount, 0);
  const discretionary = discretionaryItems.reduce((s, e) => s + e.amount, 0);
  const debtRepay = debtItems.reduce((s, e) => s + e.amount, 0);
  const totalExpenses = essential + discretionary + debtRepay;
  const disposable = income - totalExpenses;

  const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const fmt = (label: string, amount: number) => `  ${label.padEnd(42, ".")} £${amount.toFixed(2)}`;

  return `DEBT VERGE — DEBT MANAGEMENT PLAN PROPOSAL
==============================================
Case Reference: ${caseData.case_number}
Date: ${today}

TO: ${creditor.creditor_name}
${creditor.account_reference ? `Account Reference: ${creditor.account_reference}` : ""}

RE: PROPOSAL FOR A DEBT MANAGEMENT PLAN — ${caseData.debtor_name}

Dear Sir/Madam,

I write on behalf of ${caseData.debtor_name}${caseData.debtor_reference ? ` (Reference: ${caseData.debtor_reference})` : ""} to formally propose a Debt Management Plan (DMP) in respect of the above account.

CURRENT ACCOUNT DETAILS
  Creditor: ${creditor.creditor_name}
  Account Reference: ${creditor.account_reference ?? "N/A"}
  Current Balance: £${creditor.current_balance.toFixed(2)}
  Current Interest Rate: ${creditor.interest_rate.toFixed(1)}% APR

STANDARD FINANCIAL STATEMENT (SFS) SUMMARY
${fmt("Total Monthly Income", income)}
${fmt("Essential Monthly Expenses", essential)}
${fmt("Discretionary Expenses", discretionary)}
${fmt("Other Debt Repayments", debtRepay)}
${fmt("Monthly Disposable Income", disposable)}

PROPOSED OFFER
Based on the completed Standard Financial Statement, the debtor's monthly
disposable income is £${disposable.toFixed(2)}. This is distributed pro-rata
across all creditors in proportion to the balance owed.

We therefore propose:
  1. A monthly payment of £${proRataAmount.toFixed(2)} toward this account
  2. Freezing of all further interest and charges
  3. Suspension of recovery and enforcement action

This offer represents a fair and equitable pro-rata distribution of the
debtor's available income across all creditors.

SFS BREAKDOWN — INCOME
${incomeItems.length > 0 ? incomeItems.map((e) => fmt(e.label, e.amount)).join("\n") : "  No income entries recorded"}
  ${"Total Income".padEnd(42, ".")} £${income.toFixed(2)}

SFS BREAKDOWN — ESSENTIAL EXPENSES
${essentialItems.length > 0 ? essentialItems.map((e) => fmt(e.label, e.amount)).join("\n") : "  No essential expense entries recorded"}
  ${"Total Essential Expenses".padEnd(42, ".")} £${essential.toFixed(2)}

SFS BREAKDOWN — DISCRETIONARY EXPENSES
${discretionaryItems.length > 0 ? discretionaryItems.map((e) => fmt(e.label, e.amount)).join("\n") : "  No discretionary entries recorded"}
  ${"Total Discretionary".padEnd(42, ".")} £${discretionary.toFixed(2)}

We kindly request your response within 14 days of the date of this letter.
If you require any further information, please do not hesitate to contact us.

Yours faithfully,

${advisorName ?? "Debt Verge Advisory Team"}
Debt Verge — Enterprise Debt Management Platform
Case: ${caseData.case_number}`;
}

// ============================================================
// Payments & Auto-Split Disbursement
// ============================================================

export function useDebtPayments(caseId: string | null) {
  const [data, setData] = useState<DebtPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!caseId) { setData([]); setLoading(false); return; }
    setLoading(true);
    setError(null);
    const { data: rows, error: err } = await supabase
      .from("debt_payments")
      .select("*")
      .eq("case_id", caseId)
      .order("payment_date", { ascending: false });
    if (err) { setError(err.message); setLoading(false); return; }
    setData(rows as DebtPayment[]);
    setLoading(false);
  }, [caseId]);

  useEffect(() => { load(); }, [load]);
  return { data, loading, error, reload: load };
}

export interface PaymentSplitResult {
  creditor: DebtCreditor;
  amount: number;
  proportion: number;
}

export function calculatePaymentSplit(
  receivedAmount: number,
  creditors: DebtCreditor[],
): PaymentSplitResult[] {
  const nonPriorityTotal = creditors
    .filter((c) => !c.is_priority)
    .reduce((sum, c) => sum + c.current_balance, 0);

  if (nonPriorityTotal === 0 || receivedAmount <= 0) {
    return creditors.map((c) => ({ creditor: c, amount: 0, proportion: 0 }));
  }

  return creditors.map((c) => {
    if (c.is_priority) {
      const priorityAmount = Math.min(c.minimum_payment ?? 0, receivedAmount);
      return { creditor: c, amount: Math.round(priorityAmount * 100) / 100, proportion: 100 };
    }
    const proportion = c.current_balance / nonPriorityTotal;
    const amount = Math.round(receivedAmount * proportion * 100) / 100;
    return { creditor: c, amount, proportion: proportion * 100 };
  });
}

export async function logMonthlyPayment(input: {
  caseId: string;
  amount: number;
  expectedAmount: number;
  paymentDate: string;
  reference?: string;
  creditors: DebtCreditor[];
}): Promise<{ payment: DebtPayment; splits: PaymentSplitResult[] }> {
  const isShortfall = input.amount < input.expectedAmount;
  const shortfallAmount = isShortfall ? input.expectedAmount - input.amount : 0;

  const { data: payment, error: payErr } = await supabase
    .from("debt_payments")
    .insert({
      case_id: input.caseId,
      amount: input.amount,
      payment_date: input.paymentDate,
      expected_amount: input.expectedAmount,
      is_shortfall: isShortfall,
      shortfall_amount: shortfallAmount,
      reference: input.reference || null,
    })
    .select("*")
    .single();
  if (payErr) throw payErr;

  const splits = calculatePaymentSplit(input.amount, input.creditors);

  for (const split of splits) {
    if (split.amount <= 0) continue;
    await createDebtDistribution({
      case_id: input.caseId,
      creditor_id: split.creditor.id,
      distribution_date: input.paymentDate,
      amount: split.amount,
      status: "scheduled",
      reference: `Auto-split from payment ${formatCurrencyRaw(input.amount)}`,
    });
  }

  await addAuditMilestone({
    case_id: input.caseId,
    milestone: "Payment Logged",
    description: `${formatCurrencyRaw(input.amount)} received${isShortfall ? ` (shortfall of ${formatCurrencyRaw(shortfallAmount)})` : ""} — auto-split across ${splits.filter((s) => s.amount > 0).length} creditors`,
  });

  return { payment: payment as DebtPayment, splits };
}

function formatCurrencyRaw(amount: number): string {
  return `£${amount.toFixed(2)}`;
}

export async function deleteDebtPayment(id: string): Promise<void> {
  const { error } = await supabase.from("debt_payments").delete().eq("id", id);
  if (error) throw error;
}

// ============================================================
// Negotiation Timeline
// ============================================================

export function useDebtNegotiations(caseId: string | null) {
  const [data, setData] = useState<DebtNegotiationEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!caseId) { setData([]); setLoading(false); return; }
    setLoading(true);
    setError(null);
    const { data: rows, error: err } = await supabase
      .from("debt_negotiations")
      .select("*")
      .eq("case_id", caseId)
      .order("created_at", { ascending: false });
    if (err) { setError(err.message); setLoading(false); return; }
    setData(rows as DebtNegotiationEvent[]);
    setLoading(false);
  }, [caseId]);

  useEffect(() => { load(); }, [load]);
  return { data, loading, error, reload: load };
}

export async function addNegotiationEvent(input: {
  case_id: string;
  creditor_id: string;
  event_type: DebtNegotiationEventType;
  event_label: string;
  notes?: string;
  actor?: string;
}): Promise<DebtNegotiationEvent> {
  const { data, error } = await supabase
    .from("debt_negotiations")
    .insert({
      case_id: input.case_id,
      creditor_id: input.creditor_id,
      event_type: input.event_type,
      event_label: input.event_label,
      notes: input.notes || null,
      actor: input.actor || null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as DebtNegotiationEvent;
}

export async function deleteNegotiationEvent(id: string): Promise<void> {
  const { error } = await supabase.from("debt_negotiations").delete().eq("id", id);
  if (error) throw error;
}

export function getLatestNegotiationPerCreditor(
  events: DebtNegotiationEvent[],
): Map<string, DebtNegotiationEvent> {
  const latest = new Map<string, DebtNegotiationEvent>();
  const sorted = [...events].sort((a, b) =>
    new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
  for (const e of sorted) {
    latest.set(e.creditor_id, e);
  }
  return latest;
}

// ============================================================
// Reduced Pro-Rata Recalculation (Shortfall Handling)
// ============================================================

export async function recalcReducedProRata(
  caseId: string,
  reducedAmount: number,
  creditors: DebtCreditor[],
): Promise<PaymentSplitResult[]> {
  const splits = calculatePaymentSplit(reducedAmount, creditors);
  for (const split of splits) {
    if (split.amount <= 0) continue;
    await updateDebtCreditor(split.creditor.id, { pro_rata_amount: split.amount });
  }
  await updateDebtCase(caseId, { monthly_disposable_income: reducedAmount });
  await addAuditMilestone({
    case_id: caseId,
    milestone: "Reduced Pro-Rata Recalculated",
    description: `Pro-rata split recalculated at ${formatCurrencyRaw(reducedAmount)}/month due to payment shortfall`,
  });
  return splits;
}

// ============================================================
// Customer Profile & Household
// ============================================================

export function useDebtCustomerProfile(caseId: string | null) {
  const [data, setData] = useState<DebtCustomerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!caseId) { setData(null); setLoading(false); return; }
    setLoading(true);
    setError(null);
    const { data: row, error: err } = await supabase
      .from("debt_customer_profiles")
      .select("*")
      .eq("case_id", caseId)
      .maybeSingle();
    if (err) { setError(err.message); setLoading(false); return; }
    setData(row as DebtCustomerProfile | null);
    setLoading(false);
  }, [caseId]);

  useEffect(() => { load(); }, [load]);
  return { data, loading, error, reload: load };
}

export async function upsertDebtCustomerProfile(
  caseId: string,
  patch: Partial<DebtCustomerProfile>,
): Promise<DebtCustomerProfile> {
  const { data: existing } = await supabase
    .from("debt_customer_profiles")
    .select("id")
    .eq("case_id", caseId)
    .maybeSingle();

  if (existing) {
    const { data, error } = await supabase
      .from("debt_customer_profiles")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("case_id", caseId)
      .select("*")
      .single();
    if (error) throw error;
    return data as DebtCustomerProfile;
  }

  const { data, error } = await supabase
    .from("debt_customer_profiles")
    .insert({ case_id: caseId, ...patch })
    .select("*")
    .single();
  if (error) throw error;
  return data as DebtCustomerProfile;
}

export function useDebtPreviousAddresses(caseId: string | null) {
  const [data, setData] = useState<DebtPreviousAddress[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!caseId) { setData([]); setLoading(false); return; }
    setLoading(true);
    setError(null);
    const { data: rows, error: err } = await supabase
      .from("debt_previous_addresses")
      .select("*")
      .eq("case_id", caseId)
      .order("created_at", { ascending: false });
    if (err) { setError(err.message); setLoading(false); return; }
    setData(rows as DebtPreviousAddress[]);
    setLoading(false);
  }, [caseId]);

  useEffect(() => { load(); }, [load]);
  return { data, loading, error, reload: load };
}

export async function createDebtPreviousAddress(input: {
  case_id: string;
  address_line: string;
  time_at_address?: string;
}): Promise<DebtPreviousAddress> {
  const { data, error } = await supabase
    .from("debt_previous_addresses")
    .insert({
      case_id: input.case_id,
      address_line: input.address_line,
      time_at_address: input.time_at_address || null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as DebtPreviousAddress;
}

export async function deleteDebtPreviousAddress(id: string): Promise<void> {
  const { error } = await supabase.from("debt_previous_addresses").delete().eq("id", id);
  if (error) throw error;
}

export interface SfsAllowanceThresholds {
  totalAdults: number;
  totalChildren: number;
  totalHousehold: number;
  groceryAllowance: number;
  transportAllowance: number;
  utilitiesAllowance: number;
  clothingAllowance: number;
  totalMonthlyAllowance: number;
}

export function getSfsAllowanceThresholds(profile: DebtCustomerProfile | null): SfsAllowanceThresholds {
  const adults = profile?.household_adults ?? 1;
  const childrenU16 = profile?.household_children_under_16 ?? 0;
  const children16_18 = profile?.household_children_16_to_18 ?? 0;
  const totalChildren = childrenU16 + children16_18;
  const totalHousehold = adults + totalChildren;

  const groceryAllowance = (adults * 250) + (childrenU16 * 150) + (children16_18 * 180);
  const transportAllowance = adults * 80;
  const utilitiesAllowance = 180 + (totalHousehold > 2 ? (totalHousehold - 2) * 40 : 0);
  const clothingAllowance = (adults * 30) + (totalChildren * 20);
  const totalMonthlyAllowance = groceryAllowance + transportAllowance + utilitiesAllowance + clothingAllowance;

  return {
    totalAdults: adults,
    totalChildren,
    totalHousehold,
    groceryAllowance,
    transportAllowance,
    utilitiesAllowance,
    clothingAllowance,
    totalMonthlyAllowance,
  };
}

export const TENURE_TYPE_LABELS: Record<DebtTenureType, string> = {
  owned: "Owned",
  private_rented: "Private Rented",
  social_rented: "Social Rented",
  council: "Council",
  leased: "Leased",
  living_with_family: "Living with Family/Parents",
};

// ============================================================
// Vulnerability Screening & Priority Assessment
// ============================================================

export const VULNERABILITY_CHECKLIST = [
  { key: "fc_low_literacy", category: "Financial Capability", label: "Low financial literacy / numeracy", weight: 8 },
  { key: "fc_no_bank_account", category: "Financial Capability", label: "No bank account or basic account only", weight: 6 },
  { key: "fc_recent_benefit_change", category: "Financial Capability", label: "Recent benefit change or sanction", weight: 7 },
  { key: "fc_income_drop", category: "Financial Capability", label: "Significant income drop (last 6 months)", weight: 8 },
  { key: "hc_mental_health", category: "Health Conditions", label: "Mental health condition (anxiety, depression)", weight: 10 },
  { key: "hc_physical_disability", category: "Health Conditions", label: "Physical disability or mobility issue", weight: 9 },
  { key: "hc_long_term_illness", category: "Health Conditions", label: "Long-term illness or chronic condition", weight: 8 },
  { key: "hc_cognitive_impairment", category: "Health Conditions", label: "Cognitive impairment or dementia", weight: 12 },
  { key: "le_recent_bereavement", category: "Life Events", label: "Recent bereavement (last 12 months)", weight: 10 },
  { key: "le_relationship_breakdown", category: "Life Events", label: "Relationship breakdown / separation", weight: 9 },
  { key: "le_job_loss", category: "Life Events", label: "Recent job loss or redundancy", weight: 8 },
  { key: "le_pregnancy_new_child", category: "Life Events", label: "Pregnancy or new child (under 1 year)", weight: 7 },
  { key: "rs_no_support_network", category: "Resilience", label: "No support network / isolated", weight: 9 },
  { key: "rs_language_barrier", category: "Resilience", label: "Language barrier / ESL", weight: 7 },
  { key: "rs_digital_exclusion", category: "Resilience", label: "Digital exclusion (no internet access)", weight: 6 },
  { key: "rs_housing_insecurity", category: "Resilience", label: "Housing insecurity / threat of eviction", weight: 10 },
] as const;

export function calculateVulnerabilityScore(flags: Record<string, boolean>): { score: number; level: DebtVulnerabilityLevel } {
  let score = 0;
  for (const item of VULNERABILITY_CHECKLIST) {
    if (flags[item.key]) score += item.weight;
  }
  score = Math.min(100, score);
  let level: DebtVulnerabilityLevel = "none";
  if (score >= 40) level = "critical";
  else if (score >= 25) level = "high";
  else if (score >= 15) level = "medium";
  else if (score >= 5) level = "low";
  return { score, level };
}

export function getRecommendedCommChannel(level: DebtVulnerabilityLevel, flags: Record<string, boolean>): string {
  if (flags.rs_digital_exclusion) return "phone";
  if (flags.hc_cognitive_impairment || flags.hc_mental_health) return "in_person";
  if (level === "critical" || level === "high") return "phone";
  if (flags.rs_language_barrier) return "in_person";
  return "phone";
}

export function useDebtVulnerabilityAssessment(caseId: string | null) {
  const [data, setData] = useState<DebtVulnerabilityAssessment | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!caseId) { setData(null); setLoading(false); return; }
    setLoading(true); setError(null);
    const { data: row, error: err } = await supabase
      .from("debt_vulnerability_assessments")
      .select("*")
      .eq("case_id", caseId)
      .maybeSingle();
    if (err) { setError(err.message); setLoading(false); return; }
    setData(row as DebtVulnerabilityAssessment | null);
    setLoading(false);
  }, [caseId]);

  useEffect(() => { load(); }, [load]);
  return { data, loading, error, reload: load };
}

export async function upsertDebtVulnerabilityAssessment(
  caseId: string,
  patch: Partial<DebtVulnerabilityAssessment>,
): Promise<DebtVulnerabilityAssessment> {
  const { data: existing } = await supabase
    .from("debt_vulnerability_assessments")
    .select("id")
    .eq("case_id", caseId)
    .maybeSingle();

  if (existing) {
    const { data, error } = await supabase
      .from("debt_vulnerability_assessments")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("case_id", caseId)
      .select("*")
      .single();
    if (error) throw error;
    return data as DebtVulnerabilityAssessment;
  }

  const { data, error } = await supabase
    .from("debt_vulnerability_assessments")
    .insert({ case_id: caseId, ...patch })
    .select("*")
    .single();
  if (error) throw error;
  return data as DebtVulnerabilityAssessment;
}

// ============================================================
// Benefits Entitlement & Income Maximization
// ============================================================

export const BENEFITS_CATALOG = [
  { type: "universal_credit", label: "Universal Credit", defaultEstimate: 400 },
  { type: "pip", label: "Personal Independence Payment (PIP)", defaultEstimate: 115 },
  { type: "dla", label: "Disability Living Allowance (DLA)", defaultEstimate: 95 },
  { type: "attendance_allowance", label: "Attendance Allowance", defaultEstimate: 90 },
  { type: "pension_credit", label: "Pension Credit", defaultEstimate: 180 },
  { type: "housing_benefit", label: "Housing Benefit", defaultEstimate: 300 },
  { type: "council_tax_reduction", label: "Council Tax Reduction", defaultEstimate: 150 },
  { type: "carers_allowance", label: "Carer's Allowance", defaultEstimate: 76 },
  { type: "esa", label: "Employment & Support Allowance (ESA)", defaultEstimate: 130 },
  { type: "jsa", label: "Jobseeker's Allowance (JSA)", defaultEstimate: 90 },
  { type: "winter_fuel", label: "Winter Fuel Payment", defaultEstimate: 50 },
  { type: "disability_premium", label: "Disability Premium", defaultEstimate: 70 },
] as const;

export function useDebtBenefitsChecks(caseId: string | null) {
  const [data, setData] = useState<DebtBenefitsCheck[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!caseId) { setData([]); setLoading(false); return; }
    setLoading(true); setError(null);
    const { data: rows, error: err } = await supabase
      .from("debt_benefits_checks")
      .select("*")
      .eq("case_id", caseId)
      .order("created_at", { ascending: false });
    if (err) { setError(err.message); setLoading(false); return; }
    setData(rows as DebtBenefitsCheck[]);
    setLoading(false);
  }, [caseId]);

  useEffect(() => { load(); }, [load]);
  return { data, loading, error, reload: load };
}

export async function createDebtBenefitsCheck(input: {
  case_id: string;
  benefit_type: string;
  label: string;
  eligible: boolean;
  estimated_monthly: number;
  confirmed?: boolean;
  notes?: string;
}): Promise<DebtBenefitsCheck> {
  const { data, error } = await supabase
    .from("debt_benefits_checks")
    .insert({
      case_id: input.case_id,
      benefit_type: input.benefit_type,
      label: input.label,
      eligible: input.eligible,
      estimated_monthly: input.estimated_monthly,
      confirmed: input.confirmed ?? false,
      notes: input.notes || null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as DebtBenefitsCheck;
}

export async function updateDebtBenefitsCheck(id: string, patch: Partial<DebtBenefitsCheck>): Promise<void> {
  const { error } = await supabase.from("debt_benefits_checks").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteDebtBenefitsCheck(id: string): Promise<void> {
  const { error } = await supabase.from("debt_benefits_checks").delete().eq("id", id);
  if (error) throw error;
}

export function getTotalBenefitsUplift(checks: DebtBenefitsCheck[]): number {
  return checks.filter((c) => c.eligible && c.confirmed).reduce((s, c) => s + c.estimated_monthly, 0);
}

export function getPotentialBenefitsUplift(checks: DebtBenefitsCheck[]): number {
  return checks.filter((c) => c.eligible).reduce((s, c) => s + c.estimated_monthly, 0);
}

// ============================================================
// Multi-Option Debt Solution Comparison
// ============================================================

export interface SolutionOption {
  name: string;
  suitability: "recommended" | "suitable" | "conditional" | "not_suitable";
  suitabilityLabel: string;
  description: string;
  pros: string[];
  cons: string[];
  eligibility: { met: boolean; detail: string }[];
  estimatedDurationMonths: number;
  estimatedMonthlyPayment: number;
  totalRepayable: number;
  debtWriteoff: number;
  fcaAligned: boolean;
}

export function evaluateSolutionSuitability(input: {
  totalDebt: number;
  disposableIncome: number;
  hasAssets: boolean;
  propertyValue: number | null;
  outstandingMortgage: number | null;
}): SolutionOption[] {
  const { totalDebt, disposableIncome, hasAssets, propertyValue, outstandingMortgage } = input;
  const equity = (propertyValue ?? 0) - (outstandingMortgage ?? 0);
  const annualDisposable = disposableIncome * 12;

  const dmpMonths = totalDebt > 0 && disposableIncome > 0 ? Math.ceil(totalDebt / disposableIncome) : 0;
  const dmpTotal = disposableIncome > 0 ? dmpMonths * disposableIncome : 0;

  return [
    {
      name: "DMP (Debt Management Plan)",
      suitability: disposableIncome > 0 && dmpMonths <= 120 ? "recommended" : "conditional",
      suitabilityLabel: disposableIncome > 0 && dmpMonths <= 120 ? "Recommended" : "Conditional",
      description: "Informal arrangement to repay debts in full at an affordable rate.",
      pros: ["No insolvency registration", "Flexible — can adjust payments", "No minimum debt threshold", "Creditors can freeze interest"],
      cons: ["Not legally binding on creditors", "Can take many years", "Credit file impacted", "Interest may continue if not frozen"],
      eligibility: [
        { met: disposableIncome > 0, detail: `Disposable income: ${formatCurrencyRaw(disposableIncome)}/month` },
        { met: totalDebt > 0, detail: `Total unsecured debt: ${formatCurrencyRaw(totalDebt)}` },
        { met: dmpMonths <= 120, detail: `Estimated duration: ${dmpMonths} months` },
      ],
      estimatedDurationMonths: dmpMonths,
      estimatedMonthlyPayment: disposableIncome,
      totalRepayable: dmpTotal,
      debtWriteoff: 0,
      fcaAligned: true,
    },
    {
      name: "DRO (Debt Relief Order)",
      suitability: totalDebt <= 30000 && disposableIncome <= 75 && (!hasAssets || equity <= 2000) ? "recommended" : "not_suitable",
      suitabilityLabel: totalDebt <= 30000 && disposableIncome <= 75 && (!hasAssets || equity <= 2000) ? "Recommended" : "Not Suitable",
      description: "Formal insolvency for low-income, low-asset debtors. Debts written off after 12 months.",
      pros: ["Debts written off in 12 months", "Low cost (£90 fee)", "No monthly payments", "Interest frozen"],
      cons: ["Strict eligibility criteria", "Assets must be under £2,000", "Vehicle worth under £2,000", "On insolvency register for 15 months"],
      eligibility: [
        { met: totalDebt <= 30000, detail: `Total debt: ${formatCurrencyRaw(totalDebt)} (max £30,000)` },
        { met: disposableIncome <= 75, detail: `Disposable income: ${formatCurrencyRaw(disposableIncome)} (max £75)` },
        { met: equity <= 2000, detail: `Asset equity: ${formatCurrencyRaw(equity)} (max £2,000)` },
      ],
      estimatedDurationMonths: 12,
      estimatedMonthlyPayment: 0,
      totalRepayable: 90,
      debtWriteoff: totalDebt,
      fcaAligned: true,
    },
    {
      name: "IVA (Individual Voluntary Arrangement)",
      suitability: totalDebt >= 10000 && disposableIncome >= 100 && totalDebt <= 100000 ? "suitable" : "conditional",
      suitabilityLabel: totalDebt >= 10000 && disposableIncome >= 100 && totalDebt <= 100000 ? "Suitable" : "Conditional",
      description: "Legally binding agreement to repay a portion of debt over 5-6 years, rest written off.",
      pros: ["Legally binding on creditors", "Significant debt write-off possible", "Interest frozen", "Supervisor manages payments"],
      cons: ["Fees can be high (£5k+)", "Must be insolvent", "Home may be included", "Credit impacted for 6 years"],
      eligibility: [
        { met: totalDebt >= 10000, detail: `Total debt: ${formatCurrencyRaw(totalDebt)} (min £10,000)` },
        { met: disposableIncome >= 100, detail: `Disposable income: ${formatCurrencyRaw(disposableIncome)} (min £100)` },
        { met: annualDisposable < totalDebt, detail: `Insolvency test: annual disposable ${formatCurrencyRaw(annualDisposable)} < total debt ${formatCurrencyRaw(totalDebt)}` },
      ],
      estimatedDurationMonths: 60,
      estimatedMonthlyPayment: disposableIncome,
      totalRepayable: disposableIncome * 60,
      debtWriteoff: Math.max(0, totalDebt - disposableIncome * 60),
      fcaAligned: true,
    },
    {
      name: "Full & Final Settlement",
      suitability: disposableIncome <= 0 || (disposableIncome > 0 && disposableIncome * 12 < totalDebt * 0.15) ? "suitable" : "conditional",
      suitabilityLabel: disposableIncome <= 0 || (disposableIncome > 0 && disposableIncome * 12 < totalDebt * 0.15) ? "Suitable" : "Conditional",
      description: "Lump-sum offer to creditors to settle debts for less than the full balance.",
      pros: ["Fast resolution", "Large debt write-off", "No ongoing payments", "Can negotiate significant reductions"],
      cons: ["Requires lump sum", "Not legally binding until accepted", "Creditors may refuse", "Settled status on credit file"],
      eligibility: [
        { met: disposableIncome <= 50, detail: `Low disposable income: ${formatCurrencyRaw(disposableIncome)} (ideally under £50)` },
        { met: true, detail: "Requires access to a lump sum (e.g. family help, redundancy, pension lump sum)" },
        { met: totalDebt > 1000, detail: `Total debt: ${formatCurrencyRaw(totalDebt)} (min £1,000 for meaningful settlement)` },
      ],
      estimatedDurationMonths: 6,
      estimatedMonthlyPayment: 0,
      totalRepayable: totalDebt * 0.4,
      debtWriteoff: totalDebt * 0.6,
      fcaAligned: true,
    },
    {
      name: "Bankruptcy",
      suitability: totalDebt >= 5000 && disposableIncome <= 50 ? "suitable" : "conditional",
      suitabilityLabel: totalDebt >= 5000 && disposableIncome <= 50 ? "Suitable" : "Conditional / Last Resort",
      description: "Formal insolvency — assets vest in Official Receiver, debts discharged after 12 months.",
      pros: ["Debts written off in 12 months", "Stops creditor action", "Court protection", "Fresh start"],
      cons: ["Lose assets including home", "Public insolvency register", "Credit ruined for 6 years", "Restrictions on employment"],
      eligibility: [
        { met: totalDebt >= 5000, detail: `Total debt: ${formatCurrencyRaw(totalDebt)} (min £5,000)` },
        { met: disposableIncome <= 50, detail: `Disposable income: ${formatCurrencyRaw(disposableIncome)} (under £50 for clean discharge)` },
        { met: !hasAssets, detail: hasAssets ? "Assets at risk — home may be sold" : "No significant assets" },
      ],
      estimatedDurationMonths: 12,
      estimatedMonthlyPayment: 0,
      totalRepayable: 680,
      debtWriteoff: totalDebt,
      fcaAligned: true,
    },
  ];
}

// ============================================================
// Bank Transaction Auto-Categorization (Open Banking / Statement Import)
// ============================================================

interface MerchantMappingRule {
  patterns: string[];
  category: DebtSfsCategory;
  label: string;
  confidence: string;
}

const MERCHANT_MAPPING_RULES: MerchantMappingRule[] = [
  // Food & Housekeeping
  { patterns: ["tesco", "sainsbury", "asda", "aldi", "lidl", "morrisons", "iceland", "co-op", "coop", "waitrose", "m&s food", "marks and spencer"], category: "essential_expense", label: "Food & Housekeeping", confidence: "high" },
  { patterns: ["iceland", "farmfoods", "heron", "b&m"], category: "essential_expense", label: "Food & Housekeeping", confidence: "medium" },
  // Utilities
  { patterns: ["british gas", "edf", "e.on", "eon", "npower", "scottish power", "ovo energy", "octopus energy", "utility warehouse"], category: "essential_expense", label: "Utilities (Gas/Electric)", confidence: "high" },
  { patterns: ["thames water", "severn trent", "anglian water", "united utilities", "yorkshire water", "welsh water", "northumbrian water"], category: "essential_expense", label: "Water Rates", confidence: "high" },
  // Council Tax
  { patterns: ["council tax", "council tax ct", "local authority", "borough council"], category: "essential_expense", label: "Council Tax", confidence: "high" },
  // Rent / Mortgage
  { patterns: ["rent", "housing association", "shelter", "mortgage", "halifax mortgage", "nationwide mortgage", "barclays mortgage"], category: "essential_expense", label: "Rent/Mortgage", confidence: "high" },
  // Insurance
  { patterns: ["aviva", "direct line", "admiral", "hastings", "churchill", "tesco insurance", "lv= insurance", "axa", "zurich"], category: "essential_expense", label: "Insurance", confidence: "medium" },
  // Transport
  { patterns: ["tfl", "transport for london", "national rail", "trainline", "metro", "bus pass", "stagecoach", "arriva", "first bus"], category: "essential_expense", label: "Transport", confidence: "high" },
  { patterns: ["shell", "bp petrol", "esso", "texaco", "sainsbury fuel", "tesco fuel", "asda fuel", "morrisons fuel"], category: "essential_expense", label: "Fuel (Vehicle)", confidence: "high" },
  // Communications
  { patterns: ["bt", "sky", "virgin media", "talktalk", "ee", "o2", "vodafone", "three mobile", "plusnet", "now tv", "netflix", "spotify"], category: "essential_expense", label: "Phone/Broadband/TV", confidence: "medium" },
  // Healthcare
  { patterns: ["boots", "superdrug", "pharmacy", " Specsavers", "optician", "dental", "nhs prescription"], category: "essential_expense", label: "Healthcare", confidence: "medium" },
  // Childcare
  { patterns: ["nursery", "childminder", "after school club", "breakfast club", "kids club"], category: "essential_expense", label: "Childcare", confidence: "high" },
  // Income
  { patterns: ["salary", "wages", "payroll", "paye", "universal credit", "uc payment", "benefits", "pip payment", "esa", "jsa", "tax credit", "child benefit", "pension", "dwp"], category: "income", label: "Income", confidence: "high" },
  // Debt Repayments
  { patterns: ["loan repayment", "credit card", "barclaycard", "capital one", "aquacard", "vanquis", "mbna", "santander loan", "hsbc loan", "natwest loan", "lloyds loan", "amigo", "provident", "bright house"], category: "debt_repayment", label: "Debt Repayment", confidence: "high" },
  // Discretionary
  { patterns: ["amazon", "ebay", "argos", "john lewis", "next", "m&s", "primark", "tk maxx", "sports direct", "deliveroo", "just eat", "uber eats", "mcdonalds", "kfc", "nandos", "wetherspoon", "pub", "cinema", "vue", "odeon", "bet365", "paddy power", "william hill", "ladbrokes"], category: "discretionary_expense", label: "Discretionary Spending", confidence: "medium" },
];

export interface ParsedTransactionResult {
  description: string;
  amount: number;
  transactionDate: string;
  merchantHint: string;
  autoCategory: DebtSfsCategory;
  autoLabel: string;
  confidence: string;
}

export function parseBankLine(description: string, amount: number, transactionDate: string): ParsedTransactionResult {
  const lower = description.toLowerCase().trim();
  for (const rule of MERCHANT_MAPPING_RULES) {
    for (const pattern of rule.patterns) {
      if (lower.includes(pattern)) {
        const merchantHint = extractMerchantHint(description, pattern);
        return {
          description,
          amount,
          transactionDate,
          merchantHint,
          autoCategory: rule.category,
          autoLabel: rule.label,
          confidence: rule.confidence,
        };
      }
    }
  }
  return {
    description,
    amount,
    transactionDate,
    merchantHint: extractMerchantHint(description, ""),
    autoCategory: amount > 0 ? "income" : "discretionary_expense",
    autoLabel: amount > 0 ? "Uncategorized Income" : "Uncategorized Expense",
    confidence: "unmatched",
  };
}

function extractMerchantHint(description: string, matchedPattern: string): string {
  if (matchedPattern) {
    return matchedPattern.charAt(0).toUpperCase() + matchedPattern.slice(1);
  }
  const parts = description.split(/\s+/).filter((p) => p.length > 1);
  return parts.slice(0, 3).join(" ").replace(/[0-9]/g, "").trim() || "Unknown";
}

export function useDebtBankTransactions(caseId: string | null) {
  const [data, setData] = useState<DebtBankTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!caseId) { setData([]); setLoading(false); return; }
    setLoading(true); setError(null);
    const { data: rows, error: err } = await supabase
      .from("debt_bank_transactions")
      .select("*")
      .eq("case_id", caseId)
      .order("transaction_date", { ascending: false });
    if (err) { setError(err.message); setLoading(false); return; }
    setData(rows as DebtBankTransaction[]);
    setLoading(false);
  }, [caseId]);

  useEffect(() => { load(); }, [load]);
  return { data, loading, error, reload: load };
}

export async function bulkCreateDebtBankTransactions(
  caseId: string,
  parsed: ParsedTransactionResult[],
): Promise<DebtBankTransaction[]> {
  const rows = parsed.map((p) => ({
    case_id: caseId,
    transaction_date: p.transactionDate,
    description: p.description,
    amount: p.amount,
    merchant_hint: p.merchantHint,
    auto_category: p.autoCategory,
    auto_label: p.autoLabel,
    confidence: p.confidence,
  }));
  const { data, error } = await supabase
    .from("debt_bank_transactions")
    .insert(rows)
    .select("*");
  if (error) throw error;
  return data as DebtBankTransaction[];
}

export async function updateDebtBankTransaction(
  id: string,
  patch: Partial<DebtBankTransaction>,
): Promise<void> {
  const { error } = await supabase.from("debt_bank_transactions").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteDebtBankTransaction(id: string): Promise<void> {
  const { error } = await supabase.from("debt_bank_transactions").delete().eq("id", id);
  if (error) throw error;
}

export async function importTransactionToSfs(
  txn: DebtBankTransaction,
  caseId: string,
): Promise<DebtSfsEntry> {
  const category = txn.manual_category ?? txn.auto_category;
  const label = txn.manual_label ?? txn.auto_label;
  const { data: entry, error } = await supabase
    .from("debt_sfs_entries")
    .insert({ case_id: caseId, category, label, amount: Math.abs(txn.amount) })
    .select("*")
    .single();
  if (error) throw error;
  await updateDebtBankTransaction(txn.id, {
    imported_to_sfs: true,
    sfs_entry_id: (entry as DebtSfsEntry).id,
  });
  return entry as DebtSfsEntry;
}

export async function bulkImportTransactionsToSfs(
  txns: DebtBankTransaction[],
  caseId: string,
): Promise<number> {
  let count = 0;
  for (const txn of txns) {
    if (!txn.imported_to_sfs) {
      await importTransactionToSfs(txn, caseId);
      count++;
    }
  }
  return count;
}

// ============================================================
// Annual SFS Review Workflow (12-Month Compliance)
// ============================================================

export function useDebtAnnualReviews(caseId: string | null) {
  const [data, setData] = useState<DebtAnnualReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!caseId) { setData([]); setLoading(false); return; }
    setLoading(true); setError(null);
    const { data: rows, error: err } = await supabase
      .from("debt_annual_reviews")
      .select("*")
      .eq("case_id", caseId)
      .order("review_number", { ascending: false });
    if (err) { setError(err.message); setLoading(false); return; }
    setData(rows as DebtAnnualReview[]);
    setLoading(false);
  }, [caseId]);

  useEffect(() => { load(); }, [load]);
  return { data, loading, error, reload: load };
}

export function calculateNextReviewDueDate(
  caseCreatedAt: string,
  reviews: DebtAnnualReview[],
): Date {
  if (reviews.length === 0) {
    const created = new Date(caseCreatedAt);
    const due = new Date(created);
    due.setFullYear(due.getFullYear() + 1);
    return due;
  }
  const lastReview = reviews[0];
  const lastDate = new Date(lastReview.review_date);
  const due = new Date(lastDate);
  due.setFullYear(due.getFullYear() + 1);
  return due;
}

export function getReviewCountdown(dueDate: Date): { days: number; label: string; urgency: "overdue" | "critical" | "warning" | "ok" } {
  const now = new Date();
  const diffMs = dueDate.getTime() - now.getTime();
  const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  let urgency: "overdue" | "critical" | "warning" | "ok" = "ok";
  if (days < 0) urgency = "overdue";
  else if (days <= 30) urgency = "critical";
  else if (days <= 60) urgency = "warning";
  let label: string;
  if (days < 0) label = `Overdue by ${Math.abs(days)} days`;
  else if (days === 0) label = "Due today";
  else label = `Due in ${days} days`;
  return { days, label, urgency };
}

export async function initiateAnnualReview(
  caseId: string,
  caseData: DebtCase,
  sfsEntries: DebtSfsEntry[],
  profile: DebtCustomerProfile | null,
  previousReviews: DebtAnnualReview[],
): Promise<DebtAnnualReview> {
  const income = sfsEntries.filter((e) => e.category === "income").reduce((s, e) => s + e.amount, 0);
  const essential = sfsEntries.filter((e) => e.category === "essential_expense").reduce((s, e) => s + e.amount, 0);
  const discretionary = sfsEntries.filter((e) => e.category === "discretionary_expense").reduce((s, e) => s + e.amount, 0);
  const disposable = income - essential - discretionary;

  const reviewNumber = previousReviews.length > 0 ? previousReviews[0].review_number + 1 : 1;
  const previousReview = previousReviews.length > 0 ? previousReviews[0] : null;

  let incomeChange = 0;
  let housingChange = false;
  const auditLog: Record<string, unknown> = {
    previous_review_number: previousReview?.review_number ?? null,
    comparison_fields: [] as Array<{ field: string; previous: string; current: string; changed: boolean }>,
  };

  if (previousReview) {
    incomeChange = disposable - previousReview.snapshot_disposable_income;
    housingChange =
      (profile?.tenure_type ?? null) !== (previousReview.snapshot_tenure_type ?? null) ||
      (profile?.property_value ?? null) !== (previousReview.snapshot_property_value ?? null);
    auditLog.comparison_fields = [
      { field: "Monthly Income", previous: formatCurrencyRaw(previousReview.snapshot_income), current: formatCurrencyRaw(income), changed: previousReview.snapshot_income !== income },
      { field: "Essential Expenses", previous: formatCurrencyRaw(previousReview.snapshot_essential_expenses), current: formatCurrencyRaw(essential), changed: previousReview.snapshot_essential_expenses !== essential },
      { field: "Discretionary Expenses", previous: formatCurrencyRaw(previousReview.snapshot_discretionary_expenses), current: formatCurrencyRaw(discretionary), changed: previousReview.snapshot_discretionary_expenses !== discretionary },
      { field: "Disposable Income", previous: formatCurrencyRaw(previousReview.snapshot_disposable_income), current: formatCurrencyRaw(disposable), changed: previousReview.snapshot_disposable_income !== disposable },
      { field: "Total Debt", previous: formatCurrencyRaw(previousReview.snapshot_total_debt), current: formatCurrencyRaw(caseData.total_debt), changed: previousReview.snapshot_total_debt !== caseData.total_debt },
      { field: "Tenure Type", previous: previousReview.snapshot_tenure_type ?? "N/A", current: profile?.tenure_type ?? "N/A", changed: (previousReview.snapshot_tenure_type ?? null) !== (profile?.tenure_type ?? null) },
      { field: "Property Value", previous: previousReview.snapshot_property_value ? formatCurrencyRaw(previousReview.snapshot_property_value) : "N/A", current: profile?.property_value ? formatCurrencyRaw(profile.property_value) : "N/A", changed: (previousReview.snapshot_property_value ?? null) !== (profile?.property_value ?? null) },
    ];
  }

  const dueDate = calculateNextReviewDueDate(caseData.created_at, previousReviews);
  const reviewDate = new Date();

  const { data, error } = await supabase
    .from("debt_annual_reviews")
    .insert({
      case_id: caseId,
      review_number: reviewNumber,
      review_date: reviewDate.toISOString().split("T")[0],
      review_due_date: dueDate.toISOString().split("T")[0],
      status: "in_progress",
      snapshot_income: income,
      snapshot_essential_expenses: essential,
      snapshot_discretionary_expenses: discretionary,
      snapshot_disposable_income: disposable,
      snapshot_total_debt: caseData.total_debt,
      snapshot_property_value: profile?.property_value ?? null,
      snapshot_tenure_type: profile?.tenure_type ?? null,
      previous_review_id: previousReview?.id ?? null,
      income_change: incomeChange,
      housing_change: housingChange,
      audit_log: auditLog,
    })
    .select("*")
    .single();
  if (error) throw error;

  await addAuditMilestone({
    case_id: caseId,
    milestone: "Annual SFS Review Initiated",
    description: `Review #${reviewNumber} initiated. ${previousReview ? `Income change: ${incomeChange >= 0 ? "+" : ""}${formatCurrencyRaw(incomeChange)}/month. Housing change: ${housingChange ? "Yes" : "No"}.` : "First annual review — baseline snapshot created."}`,
  });

  return data as DebtAnnualReview;
}

export async function completeAnnualReview(reviewId: string): Promise<void> {
  const { error } = await supabase
    .from("debt_annual_reviews")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", reviewId);
  if (error) throw error;
}

// ============================================================
// Client Payment Schedule & Transaction Ledger
// ============================================================

/**
 * Convert a monthly disposable income figure into the equivalent
 * installment amount for the chosen payment frequency.
 *   Weekly       = (Monthly × 12) / 52
 *   Fortnightly  = (Monthly × 12) / 26
 *   4-Weekly     = (Monthly × 12) / 13
 *   Monthly      = Monthly
 *   Specific Date = Monthly (a one-off / ad-hoc date, same as monthly)
 */
export function frequencyToInstallment(monthlyAmount: number, frequency: PaymentFrequency): number {
  if (monthlyAmount <= 0) return 0;
  switch (frequency) {
    case "weekly":         return (monthlyAmount * 12) / 52;
    case "fortnightly":    return (monthlyAmount * 12) / 26;
    case "four_weekly":    return (monthlyAmount * 12) / 13;
    case "monthly":
    case "specific_date":  return monthlyAmount;
    default:               return monthlyAmount;
  }
}

/**
 * Number of days between payments for a given frequency.
 */
export function frequencyIntervalDays(frequency: PaymentFrequency): number {
  switch (frequency) {
    case "weekly":         return 7;
    case "fortnightly":    return 14;
    case "four_weekly":    return 28;
    case "monthly":
    case "specific_date":  return 30;
    default:               return 30;
  }
}

/**
 * Advance a date by the given frequency interval, respecting the
 * preferred payment day when the frequency is monthly.
 */
export function advanceDueDate(
  currentIso: string,
  frequency: PaymentFrequency,
  preferredDay: PaymentScheduleDay,
): string {
  const d = new Date(currentIso + "T00:00:00");

  if (frequency === "monthly" || frequency === "specific_date") {
    d.setMonth(d.getMonth() + 1);
    if (typeof preferredDay === "number") {
      d.setDate(preferredDay);
    } else if (preferredDay === "last_working_day") {
      d.setDate(0); // last day of the month
      while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
    }
    return d.toISOString().slice(0, 10);
  }

  const days = frequencyIntervalDays(frequency);
  d.setDate(d.getDate() + days);
  if (preferredDay === "monday") {
    while (d.getDay() !== 1) d.setDate(d.getDate() + 1);
  }
  return d.toISOString().slice(0, 10);
}

/**
 * Generate a series of upcoming transaction dates from a schedule.
 */
export function generateUpcomingDueDates(
  schedule: PaymentSchedule,
  count: number,
): string[] {
  const dates: string[] = [];
  let current = schedule.nextDueDate;
  for (let i = 0; i < count; i++) {
    dates.push(current);
    current = advanceDueDate(current, schedule.frequency, schedule.preferredPaymentDay);
  }
  return dates;
}

// ---- Schedule persistence (stored as columns on debt_cases) ----

export async function getPaymentSchedule(caseId: string): Promise<PaymentSchedule | null> {
  const { data, error } = await supabase
    .from("debt_cases")
    .select("payment_frequency, preferred_payment_day, installment_amount, next_due_date")
    .eq("id", caseId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  if (!data.payment_frequency) return null;
  return {
    frequency: data.payment_frequency as PaymentFrequency,
    preferredPaymentDay: data.preferred_payment_day as PaymentScheduleDay,
    installmentAmount: Number(data.installment_amount ?? 0),
    nextDueDate: data.next_due_date ?? new Date().toISOString().slice(0, 10),
  };
}

export async function savePaymentSchedule(caseId: string, schedule: PaymentSchedule): Promise<void> {
  const { error } = await supabase
    .from("debt_cases")
    .update({
      payment_frequency: schedule.frequency,
      preferred_payment_day: String(schedule.preferredPaymentDay),
      installment_amount: schedule.installmentAmount,
      next_due_date: schedule.nextDueDate,
    })
    .eq("id", caseId);
  if (error) throw error;
}

// ---- Transaction ledger ----

export function usePaymentTransactions(caseId: string | null) {
  const [data, setData] = useState<PaymentTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!caseId) { setData([]); setLoading(false); return; }
    setLoading(true);
    setError(null);
    const { data: rows, error: err } = await supabase
      .from("debt_payment_transactions")
      .select("*")
      .eq("case_id", caseId)
      .order("due_date", { ascending: true });
    if (err) { setError(err.message); setLoading(false); return; }
    setData((rows ?? []).map(mapTransactionRow));
    setLoading(false);
  }, [caseId]);

  useEffect(() => { load(); }, [load]);
  return { data, loading, error, reload: load };
}

function mapTransactionRow(row: Record<string, unknown>): PaymentTransaction {
  return {
    id: row.id as string,
    dueDate: row.due_date as string,
    amountDue: Number(row.amount_due ?? 0),
    amountPaid: Number(row.amount_paid ?? 0),
    status: row.status as PaymentTransactionStatus,
    failureReason: (row.failure_reason as string) ?? undefined,
    clearedDate: (row.cleared_date as string) ?? undefined,
  };
}

export async function createPaymentTransaction(input: {
  case_id: string;
  due_date: string;
  amount_due: number;
  status?: PaymentTransactionStatus;
}): Promise<PaymentTransaction> {
  const { data, error } = await supabase
    .from("debt_payment_transactions")
    .insert({
      case_id: input.case_id,
      due_date: input.due_date,
      amount_due: input.amount_due,
      status: input.status ?? "scheduled",
    })
    .select("*")
    .single();
  if (error) throw error;
  return mapTransactionRow(data as Record<string, unknown>);
}

export async function updatePaymentTransaction(
  id: string,
  patch: Partial<{
    amount_paid: number;
    status: PaymentTransactionStatus;
    failure_reason: string;
    cleared_date: string;
  }>,
): Promise<void> {
  const { error } = await supabase
    .from("debt_payment_transactions")
    .update(patch)
    .eq("id", id);
  if (error) throw error;
}

export async function deletePaymentTransaction(id: string): Promise<void> {
  const { error } = await supabase
    .from("debt_payment_transactions")
    .delete()
    .eq("id", id);
  if (error) throw error;
}

/**
 * Generate and persist a batch of upcoming scheduled transactions
 * from a payment schedule, avoiding duplicates by checking existing
 * due dates for the case.
 */
export async function generateScheduledTransactions(
  caseId: string,
  schedule: PaymentSchedule,
  count: number,
): Promise<PaymentTransaction[]> {
  const dates = generateUpcomingDueDates(schedule, count);

  // Fetch existing due dates to avoid duplicates
  const { data: existing, error: fetchErr } = await supabase
    .from("debt_payment_transactions")
    .select("due_date")
    .eq("case_id", caseId);
  if (fetchErr) throw fetchErr;
  const existingDates = new Set((existing ?? []).map((r) => r.due_date));

  const toInsert = dates
    .filter((d) => !existingDates.has(d))
    .map((d) => ({
      case_id: caseId,
      due_date: d,
      amount_due: schedule.installmentAmount,
      status: "scheduled" as PaymentTransactionStatus,
    }));

  if (toInsert.length === 0) return [];

  const { data: rows, error: insertErr } = await supabase
    .from("debt_payment_transactions")
    .insert(toInsert)
    .select("*")
    .order("due_date", { ascending: true });
  if (insertErr) throw insertErr;
  return (rows ?? []).map(mapTransactionRow);
}

// ============================================================
// Breathing Space & Mental Health Crisis Moratorium
// ============================================================

function mapBreathingSpaceRow(r: any): BreathingSpace {
  return {
    id: r.id,
    case_id: r.case_id,
    user_id: r.user_id,
    moratorium_type: r.moratorium_type,
    status: r.status,
    start_date: r.start_date,
    standard_end_date: r.standard_end_date,
    treatment_end_date: r.treatment_end_date,
    post_treatment_exit_date: r.post_treatment_exit_date,
    amhp_evidence_file_name: r.amhp_evidence_file_name,
    amhp_evidence_url: r.amhp_evidence_url,
    nominated_contact_name: r.nominated_contact_name,
    nominated_contact_phone: r.nominated_contact_phone,
    nominated_contact_email: r.nominated_contact_email,
    nominated_contact_relationship: r.nominated_contact_relationship,
    included_creditor_ids: Array.isArray(r.included_creditor_ids) ? r.included_creditor_ids : [],
    eligibility_checks: r.eligibility_checks ?? { noActiveInLast12Months: false, residentEnglandWales: false, noActiveIvaDro: false, checkedAt: new Date().toISOString() },
    review_tasks: Array.isArray(r.review_tasks) ? r.review_tasks : [],
    account_lock_active: r.account_lock_active,
    cancelled_reason: r.cancelled_reason,
    cancelled_at: r.cancelled_at,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export function useBreathingSpaces(caseId: string | null) {
  const [data, setData] = useState<BreathingSpace[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cb = useCallback(() => {
    if (!caseId) { setData([]); return; }
    setLoading(true); setError(null);
    supabase.from("debt_breathing_spaces")
      .select("*").eq("case_id", caseId)
      .order("created_at", { ascending: false })
      .then(({ data: rows, error: err }) => {
        if (err) setError(err.message);
        else setData((rows ?? []).map(mapBreathingSpaceRow));
      })
      .finally(() => setLoading(false));
  }, [caseId]);
  useEffect(() => { cb(); }, [cb]);
  return { data, loading, error, reload: cb };
}

export function useActiveBreathingSpace(caseId: string | null): {
  data: BreathingSpace | null; loading: boolean; error: string | null; reload: () => void;
} {
  const { data: all, loading, error, reload } = useBreathingSpaces(caseId);
  const active = all.find((b) => b.status === "active") ?? null;
  return { data: active, loading, error, reload };
}

export async function createBreathingSpace(input: {
  case_id: string;
  moratorium_type: BreathingSpaceType;
  included_creditor_ids: string[];
  eligibility_checks: BreathingSpaceEligibilityChecks;
  review_tasks: BreathingSpaceReviewTask[];
  amhp_evidence_file_name?: string | null;
  amhp_evidence_url?: string | null;
  nominated_contact_name?: string | null;
  nominated_contact_phone?: string | null;
  nominated_contact_email?: string | null;
  nominated_contact_relationship?: string | null;
}): Promise<BreathingSpace> {
  const startDate = new Date().toISOString().slice(0, 10);
  const standardEndDate = input.moratorium_type === "standard"
    ? new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    : null;

  const { data: row, error } = await supabase
    .from("debt_breathing_spaces")
    .insert({
      case_id: input.case_id,
      moratorium_type: input.moratorium_type,
      status: "active",
      start_date: startDate,
      standard_end_date: standardEndDate,
      treatment_end_date: null,
      post_treatment_exit_date: null,
      amhp_evidence_file_name: input.amhp_evidence_file_name ?? null,
      amhp_evidence_url: input.amhp_evidence_url ?? null,
      nominated_contact_name: input.nominated_contact_name ?? null,
      nominated_contact_phone: input.nominated_contact_phone ?? null,
      nominated_contact_email: input.nominated_contact_email ?? null,
      nominated_contact_relationship: input.nominated_contact_relationship ?? null,
      included_creditor_ids: input.included_creditor_ids,
      eligibility_checks: input.eligibility_checks,
      review_tasks: input.review_tasks,
      account_lock_active: true,
    })
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (!row) throw new Error("Failed to create breathing space record");
  return mapBreathingSpaceRow(row);
}

export async function updateBreathingSpace(
  id: string,
  patch: Partial<{
    status: BreathingSpaceStatus;
    treatment_end_date: string | null;
    post_treatment_exit_date: string | null;
    account_lock_active: boolean;
    cancelled_reason: string | null;
    cancelled_at: string | null;
    review_tasks: BreathingSpaceReviewTask[];
  }>,
): Promise<void> {
  const { error } = await supabase
    .from("debt_breathing_spaces")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function cancelBreathingSpace(id: string, reason: string): Promise<void> {
  await updateBreathingSpace(id, {
    status: "cancelled",
    account_lock_active: false,
    cancelled_reason: reason,
    cancelled_at: new Date().toISOString(),
  });
}

export async function completeReviewTask(
  breathingSpaceId: string,
  reviewTasks: BreathingSpaceReviewTask[],
  taskId: string,
): Promise<void> {
  const updated = reviewTasks.map((t) =>
    t.id === taskId
      ? { ...t, completed: true, completedAt: new Date().toISOString() }
      : t,
  );
  await updateBreathingSpace(breathingSpaceId, { review_tasks: updated });
}

export async function recordTreatmentEndDate(
  breathingSpaceId: string,
  treatmentEndDate: string,
): Promise<void> {
  const exitDate = new Date(treatmentEndDate);
  exitDate.setDate(exitDate.getDate() + 30);
  await updateBreathingSpace(breathingSpaceId, {
    treatment_end_date: treatmentEndDate,
    post_treatment_exit_date: exitDate.toISOString().slice(0, 10),
  });
}

/**
 * Check eligibility for a standard breathing space:
 * - No active breathing space in the last 12 months
 * - Case is not in an active IVA or DRO
 */
export async function checkBreathingSpaceEligibility(
  caseId: string,
  currentPlanType: string,
): Promise<BreathingSpaceEligibilityChecks> {
  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1);

  const { data: recent, error } = await supabase
    .from("debt_breathing_spaces")
    .select("id, status, start_date")
    .eq("case_id", caseId)
    .gte("start_date", twelveMonthsAgo.toISOString().slice(0, 10));
  if (error) throw error;

  const hasRecentActive = (recent ?? []).some(
    (r) => r.status === "active" || (r.status === "expired" && r.start_date >= twelveMonthsAgo.toISOString().slice(0, 10)),
  );

  return {
    noActiveInLast12Months: !hasRecentActive,
    residentEnglandWales: true,
    noActiveIvaDro: !["iva", "dro"].includes(currentPlanType.toLowerCase()),
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Debt types that qualify for breathing space inclusion.
 */
export const BS_QUALIFYING_DEBT_TYPES: DebtType[] = [
  "credit_card", "personal_loan", "mortgage_arrears", "utility_arrears",
  "overdraft", "store_card", "hire_purchase",
];

/**
 * Debt types automatically excluded from breathing space
 * (student loans, CMS, court fines — not covered by the scheme).
 */
export const BS_EXCLUDED_DEBT_TYPES: DebtType[] = [
  "council_tax",
  "other",
];

// ============================================================
// IVA Demo Case Seeding
// ============================================================

export interface IVADemoCaseSpec {
  case_number: string;
  debtor_name: string;
  debtor_reference: string;
  status: DebtCaseStatus;
  notes: string;
  total_debt: number;
  monthly_disposable_income: number;
  recovery_rate_target: number;
  profile: Partial<DebtCustomerProfile>;
  creditors: Array<{
    creditor_name: string;
    debt_type: DebtType;
    account_reference: string;
    current_balance: number;
    interest_rate: number;
    minimum_payment: number;
    is_priority: boolean;
  }>;
  sfs_entries: Array<{
    category: DebtSfsCategory;
    label: string;
    amount: number;
  }>;
  audit_milestones: Array<{ milestone: string; description: string }>;
}

export const IVA_DEMO_CASES: IVADemoCaseSpec[] = [
  {
    case_number: "IVA-2026-0001",
    debtor_name: "Marcus Thornton",
    debtor_reference: "EXT-MT-8821",
    status: "sfs_approved",
    notes: "IVA proposal drafted — awaiting creditor vote scheduling. 4 creditors, unsecured debt £42,300. Suitable for IVA with DI £285/mo.",
    total_debt: 42300,
    monthly_disposable_income: 285,
    recovery_rate_target: 62,
    profile: {
      full_name: "Marcus Thornton",
      primary_email: "marcus.thornton@example.co.uk",
      mobile_phone: "07700 900123",
      address_street: "14 Willowbrook Close",
      address_city: "Manchester",
      address_postcode: "M21 8RP",
      time_at_address_years: 6,
      time_at_address_months: 3,
      household_adults: 1,
      household_children_under_16: 0,
      household_children_16_to_18: 0,
      tenure_type: "private_rented",
      monthly_rent_or_mortgage: 950,
    },
    creditors: [
      { creditor_name: "Barclaycard", debt_type: "credit_card", account_reference: "BC-4471-8821", current_balance: 12450, interest_rate: 22.9, minimum_payment: 280, is_priority: false },
      { creditor_name: "NatWest Personal Loan", debt_type: "personal_loan", account_reference: "NW-PL-77231", current_balance: 15000, interest_rate: 14.2, minimum_payment: 420, is_priority: false },
      { creditor_name: "Santander Overdraft", debt_type: "overdraft", account_reference: "SA-OD-3391", current_balance: 4850, interest_rate: 19.9, minimum_payment: 145, is_priority: false },
      { creditor_name: "Very.co.uk", debt_type: "store_card", account_reference: "VRY-8821001", current_balance: 10000, interest_rate: 34.9, minimum_payment: 300, is_priority: false },
    ],
    sfs_entries: [
      { category: "income", label: "Net Salary (Logistics Manager)", amount: 2450 },
      { category: "income", label: "Universal Credit (housing element)", amount: 280 },
      { category: "essential_expense", label: "Rent", amount: 950 },
      { category: "essential_expense", label: "Council Tax", amount: 165 },
      { category: "essential_expense", label: "Utilities (gas/electric)", amount: 180 },
      { category: "essential_expense", label: "Food & Groceries", amount: 320 },
      { category: "essential_expense", label: "Transport (bus/rail)", amount: 180 },
      { category: "essential_expense", label: "Mobile Phone", amount: 35 },
      { category: "discretionary_expense", label: "Clothing", amount: 60 },
      { category: "discretionary_expense", label: "Gym Membership", amount: 25 },
    ],
    audit_milestones: [
      { milestone: "Case Opened", description: "IVA case opened for Marcus Thornton. Initial intake completed." },
      { milestone: "SFS Approved", description: "Standard Financial Statement reviewed and approved. DI assessed at £285/mo." },
      { milestone: "Proposal Draft Submitted", description: "Nominee proposal drafted with 62% projected dividend. Awaiting creditor vote scheduling." },
    ],
  },
  {
    case_number: "IVA-2026-0002",
    debtor_name: "Eleanor Whitfield",
    debtor_reference: "EXT-EW-5542",
    status: "creditor_pack_sent",
    notes: "Meeting of Creditors called — 60% of votes logged, needs 75%+ to approve. £68,500 total debt across 5 creditors.",
    total_debt: 68500,
    monthly_disposable_income: 420,
    recovery_rate_target: 58,
    profile: {
      full_name: "Eleanor Whitfield",
      primary_email: "e.whitfield@example.co.uk",
      mobile_phone: "07700 900456",
      landline_phone: "0161 555 0192",
      address_street: "37 Kestrel Road, Didsbury",
      address_city: "Manchester",
      address_postcode: "M20 2LR",
      time_at_address_years: 11,
      time_at_address_months: 0,
      household_adults: 2,
      household_children_under_16: 2,
      household_children_16_to_18: 0,
      tenure_type: "owned",
      property_value: 285000,
      outstanding_mortgage_or_rent: 198000,
      monthly_rent_or_mortgage: 1120,
    },
    creditors: [
      { creditor_name: "HSBC Credit Card", debt_type: "credit_card", account_reference: "HSBC-CC-5542", current_balance: 18500, interest_rate: 21.4, minimum_payment: 410, is_priority: false },
      { creditor_name: "Lloyds Personal Loan", debt_type: "personal_loan", account_reference: "LOY-PL-22918", current_balance: 22000, interest_rate: 12.8, minimum_payment: 660, is_priority: false },
      { creditor_name: "Tesco Bank Credit Card", debt_type: "credit_card", account_reference: "TB-CC-7712", current_balance: 8000, interest_rate: 25.9, minimum_payment: 200, is_priority: false },
      { creditor_name: "Argos Store Card", debt_type: "store_card", account_reference: "ARG-SC-3382", current_balance: 3500, interest_rate: 29.9, minimum_payment: 105, is_priority: false },
      { creditor_name: "British Gas ( arrears )", debt_type: "utility_arrears", account_reference: "BG-ARR-9001", current_balance: 4500, interest_rate: 0, minimum_payment: 150, is_priority: true },
    ],
    sfs_entries: [
      { category: "income", label: "Net Salary (Primary School Teacher)", amount: 2980 },
      { category: "income", label: "Partner Net Salary", amount: 2100 },
      { category: "income", label: "Child Benefit", amount: 175 },
      { category: "essential_expense", label: "Mortgage", amount: 1120 },
      { category: "essential_expense", label: "Council Tax", amount: 245 },
      { category: "essential_expense", label: "Utilities (gas/electric/water)", amount: 310 },
      { category: "essential_expense", label: "Food & Groceries", amount: 680 },
      { category: "essential_expense", label: "Transport (car fuel + insurance)", amount: 280 },
      { category: "essential_expense", label: "School meals & uniforms", amount: 120 },
      { category: "essential_expense", label: "Mobile Phones (x2)", amount: 55 },
      { category: "essential_expense", label: "Broadband & TV License", amount: 65 },
      { category: "discretionary_expense", label: "Children's activities", amount: 80 },
    ],
    audit_milestones: [
      { milestone: "Case Opened", description: "IVA case opened for Eleanor Whitfield. Joint household assessment." },
      { milestone: "SFS Approved", description: "SFS approved with joint income. DI assessed at £420/mo." },
      { milestone: "Proposal Draft Submitted", description: "Nominee proposal submitted with 58% projected dividend. Homeowner with equity." },
      { milestone: "Creditor Pack Sent", description: "Creditor voting pack circulated to 5 creditors. MOC scheduled for 14 days." },
      { milestone: "Voting Update", description: "60% of creditor votes logged (3 of 5 creditors). Awaiting remaining 2 creditors to reach 75% threshold." },
    ],
  },
  {
    case_number: "IVA-2026-0003",
    debtor_name: "David Okafor",
    debtor_reference: "EXT-DO-9917",
    status: "payment_schedule_active",
    notes: "IVA approved — active supervision. Client paying £320/mo into trust account. 24 of 60 months completed.",
    total_debt: 51800,
    monthly_disposable_income: 320,
    recovery_rate_target: 65,
    profile: {
      full_name: "David Okafor",
      primary_email: "david.okafor@example.co.uk",
      mobile_phone: "07700 900789",
      address_street: "22 Ferngate Apartments, Salford Quays",
      address_city: "Salford",
      address_postcode: "M50 3XY",
      time_at_address_years: 4,
      time_at_address_months: 6,
      household_adults: 1,
      household_children_under_16: 1,
      household_children_16_to_18: 0,
      tenure_type: "private_rented",
      monthly_rent_or_mortgage: 1100,
    },
    creditors: [
      { creditor_name: "MBNA Credit Card", debt_type: "credit_card", account_reference: "MBNA-CC-9917", current_balance: 16700, interest_rate: 20.3, minimum_payment: 380, is_priority: false },
      { creditor_name: "Sainsbury's Loan", debt_type: "personal_loan", account_reference: "SBY-PL-55421", current_balance: 19500, interest_rate: 13.5, minimum_payment: 580, is_priority: false },
      { creditor_name: "Capital One Credit Card", debt_type: "credit_card", account_reference: "CAP1-CC-8812", current_balance: 7800, interest_rate: 29.9, minimum_payment: 195, is_priority: false },
      { creditor_name: "Vanquis Card", debt_type: "credit_card", account_reference: "VQ-CC-3391", current_balance: 7800, interest_rate: 39.9, minimum_payment: 235, is_priority: false },
    ],
    sfs_entries: [
      { category: "income", label: "Net Salary (NHS Nurse Band 6)", amount: 2880 },
      { category: "income", label: "Child Benefit", amount: 89 },
      { category: "essential_expense", label: "Rent", amount: 1100 },
      { category: "essential_expense", label: "Council Tax", amount: 180 },
      { category: "essential_expense", label: "Utilities", amount: 220 },
      { category: "essential_expense", label: "Food & Groceries", amount: 420 },
      { category: "essential_expense", label: "Childcare", amount: 350 },
      { category: "essential_expense", label: "Transport", amount: 195 },
      { category: "essential_expense", label: "Mobile Phone", amount: 30 },
      { category: "discretionary_expense", label: "Streaming subscriptions", amount: 28 },
    ],
    audit_milestones: [
      { milestone: "Case Opened", description: "IVA case opened for David Okafor." },
      { milestone: "SFS Approved", description: "SFS approved. DI assessed at £320/mo." },
      { milestone: "Proposal Draft Submitted", description: "Nominee proposal submitted. 65% projected dividend." },
      { milestone: "Creditor Pack Sent", description: "Voting pack sent. MOC held — 82% creditor approval." },
      { milestone: "IVA Approved", description: "IVA approved at Meeting of Creditors. 60-month term, £320/mo contribution." },
      { milestone: "Annual Review Completed", description: "First annual review completed. Payments on track. 24 of 60 months completed." },
    ],
  },
  {
    case_number: "IVA-2026-0004",
    debtor_name: "Sarah Pennington",
    debtor_reference: "EXT-SP-3340",
    status: "intake",
    notes: "BREACH — 2 missed IVA payments. Client income dropped after redundancy. Ideal candidate for DMP transfer. £34,200 total debt.",
    total_debt: 34200,
    monthly_disposable_income: 95,
    recovery_rate_target: 48,
    profile: {
      full_name: "Sarah Pennington",
      primary_email: "sarah.p@example.co.uk",
      mobile_phone: "07700 900321",
      address_street: "8 Meadowview Court, Bolton",
      address_city: "Bolton",
      address_postcode: "BL3 6QH",
      time_at_address_years: 3,
      time_at_address_months: 2,
      household_adults: 1,
      household_children_under_16: 2,
      household_children_16_to_18: 0,
      tenure_type: "social_rented",
      monthly_rent_or_mortgage: 720,
    },
    creditors: [
      { creditor_name: "Halifax Credit Card", debt_type: "credit_card", account_reference: "HFX-CC-3340", current_balance: 9200, interest_rate: 23.4, minimum_payment: 210, is_priority: false },
      { creditor_name: "Marbles Loan", debt_type: "personal_loan", account_reference: "MRB-PL-88120", current_balance: 12500, interest_rate: 15.9, minimum_payment: 375, is_priority: false },
      { creditor_name: " Aqua Card", debt_type: "credit_card", account_reference: "AQ-CC-2201", current_balance: 6500, interest_rate: 34.9, minimum_payment: 195, is_priority: false },
      { creditor_name: "Bolton Council (arrears)", debt_type: "council_tax", account_reference: "BC-CT-5542", current_balance: 6000, interest_rate: 0, minimum_payment: 150, is_priority: true },
    ],
    sfs_entries: [
      { category: "income", label: "Universal Credit (standard allowance + child element)", amount: 1280 },
      { category: "income", label: "Part-time salary (retail, 16 hrs/wk)", amount: 620 },
      { category: "essential_expense", label: "Rent (social housing)", amount: 720 },
      { category: "essential_expense", label: "Council Tax (reduced after CT support)", amount: 85 },
      { category: "essential_expense", label: "Utilities", amount: 195 },
      { category: "essential_expense", label: "Food & Groceries", amount: 380 },
      { category: "essential_expense", label: "Children's essentials", amount: 210 },
      { category: "essential_expense", label: "Transport", amount: 120 },
      { category: "essential_expense", label: "Mobile Phone", amount: 20 },
    ],
    audit_milestones: [
      { milestone: "Case Opened", description: "IVA case opened for Sarah Pennington. Vulnerability flag: single parent, recent redundancy." },
      { milestone: "SFS Approved", description: "SFS approved. DI assessed at £285/mo (pre-redundancy)." },
      { milestone: "Proposal Draft Submitted", description: "Nominee proposal submitted. 48% projected dividend." },
      { milestone: "Creditor Pack Sent", description: "Voting pack sent. MOC held — 78% approval (borderline)." },
      { milestone: "IVA Approved", description: "IVA approved. 60-month term, £285/mo contribution." },
      { milestone: "Breach Notice — Missed Payment 1", description: "Client missed Month 14 contribution. Income dropped after redundancy. Vulnerability assessment updated." },
      { milestone: "Breach Notice — Missed Payment 2", description: "Client missed Month 15 contribution. DI reassessed at £95/mo. Recommend solution transfer to DMP." },
    ],
  },
];

/**
 * Seeds all 4 IVA demo cases into the database (if they don't already exist).
 * Creates the case, then creditors, SFS entries, customer profile, and audit milestones.
 * Returns the IDs of created (or already-existing) cases.
 */
export async function seedIVADemoCases(): Promise<string[]> {
  const createdIds: string[] = [];

  for (const spec of IVA_DEMO_CASES) {
    const { data: existing } = await supabase
      .from("debt_cases")
      .select("id")
      .eq("case_number", spec.case_number)
      .maybeSingle();

    if (existing) {
      createdIds.push(existing.id);
      continue;
    }

    const newCase = await createDebtCase({
      case_number: spec.case_number,
      debtor_name: spec.debtor_name,
      debtor_reference: spec.debtor_reference,
      status: spec.status,
      plan_type: "iva",
      notes: spec.notes,
    });

    await updateDebtCase(newCase.id, {
      total_debt: spec.total_debt,
      monthly_disposable_income: spec.monthly_disposable_income,
      recovery_rate_target: spec.recovery_rate_target,
    });

    for (const c of spec.creditors) {
      await createDebtCreditor({
        case_id: newCase.id,
        creditor_name: c.creditor_name,
        debt_type: c.debt_type,
        account_reference: c.account_reference,
        current_balance: c.current_balance,
        interest_rate: c.interest_rate,
        minimum_payment: c.minimum_payment,
        is_priority: c.is_priority,
      });
    }

    for (const s of spec.sfs_entries) {
      await createDebtSfsEntry({
        case_id: newCase.id,
        category: s.category,
        label: s.label,
        amount: s.amount,
      });
    }

    await upsertDebtCustomerProfile(newCase.id, spec.profile);

    for (const a of spec.audit_milestones) {
      await addAuditMilestone({
        case_id: newCase.id,
        milestone: a.milestone,
        description: a.description,
      });
    }

    createdIds.push(newCase.id);
  }

  return createdIds;
}