import {
  createContext, useContext, useState, useCallback, useEffect, useMemo, useRef, type ReactNode,
} from "react";
import {
  useDebtCases, useDebtCreditors, useDebtSfsEntries, useDebtCustomerProfile,
  useDebtBankTransactions,
  updateDebtCase, upsertDebtCustomerProfile, addAuditMilestone,
} from "./debt-hooks";
import {
  useIPDetails, useDocumentChecklist, useIVAProposal, useCreditorVotes, useProofOfDebt,
} from "./insolvency-hooks";
import { supabase } from "@/core/supabase";
import type {
  DebtCase, DebtCreditor, DebtSfsEntry, DebtSfsCategory,
  DebtCustomerProfile, DebtPreviousAddress, DebtTenureType,
  DebtBankTransaction,
  DebtPlanType, DebtSolutionPipeline, PipelineStageEntry, PipelineStageStatus,
  SolutionState, SolutionSuitabilityScore, SuitabilityVerdict,
  FinancialStatement, CreditorsAndDebts,
  CustomerProfileMaster, HouseholdMember, DebtVergeCaseMaster,
  OpenBankingSummary, AssetInfo,
  IPDetails, DocumentChecklistItem, IVAProposalData, CreditorVote, ProofOfDebt,
  DebtVergePortalRole,
} from "@/core/types";

// ============================================================
// Pipeline Stage Definitions
// ============================================================

export interface PipelineStageDef {
  stageId: string;
  stageLabel: string;
  pipelines: DebtSolutionPipeline[];
}

export const PIPELINE_STAGES: PipelineStageDef[] = [
  { stageId: "intake", stageLabel: "Case Intake & Assessment", pipelines: ["DMP", "IVA", "DRO", "Settlement"] },
  { stageId: "sfs", stageLabel: "SFS Budget Compilation", pipelines: ["DMP", "IVA", "DRO", "Settlement"] },
  { stageId: "creditor_verification", stageLabel: "Creditor Verification", pipelines: ["DMP", "IVA", "DRO", "Settlement"] },
  { stageId: "solution_selection", stageLabel: "Solution Selection & Suitability", pipelines: ["DMP", "IVA", "DRO", "Settlement"] },
  { stageId: "proposal_drafting", stageLabel: "Proposal Drafting", pipelines: ["IVA", "DRO", "Settlement"] },
  { stageId: "nominee_appointment", stageLabel: "Nominee Appointment", pipelines: ["IVA"] },
  { stageId: "creditor_meeting", stageLabel: "Creditor Meeting", pipelines: ["IVA"] },
  { stageId: "interim_order", stageLabel: "Interim Order Application", pipelines: ["DRO"] },
  { stageId: "moratorium", stageLabel: "Debt Relief Moratorium", pipelines: ["DRO"] },
  { stageId: "offer_submission", stageLabel: "Offer Submission to Creditors", pipelines: ["DMP", "Settlement"] },
  { stageId: "negotiation", stageLabel: "Creditor Negotiation", pipelines: ["DMP", "Settlement"] },
  { stageId: "agreement_reached", stageLabel: "Agreement Reached", pipelines: ["DMP", "Settlement"] },
  { stageId: "fund_distribution", stageLabel: "Fund Distribution / Payout", pipelines: ["DMP", "Settlement"] },
  { stageId: "supervision", stageLabel: "Supervision & Review", pipelines: ["IVA"] },
  { stageId: "completion", stageLabel: "Completion & Closure", pipelines: ["DMP", "IVA", "DRO", "Settlement"] },
];

export const PIPELINE_META: Record<DebtSolutionPipeline, { label: string; description: string; color: string; icon: string }> = {
  DMP: { label: "DMP", description: "Debt Management Plan — informal repayment arrangement", color: "bg-blue-500", icon: "Landmark" },
  IVA: { label: "IVA", description: "Individual Voluntary Arrangement — formal insolvency with nominee", color: "bg-violet-500", icon: "Scale" },
  DRO: { label: "DRO", description: "Debt Relief Order — moratorium for low-income, low-asset debtors", color: "bg-amber-500", icon: "Shield" },
  Settlement: { label: "Settlement", description: "Full & Final Settlement — negotiated lump-sum discount", color: "bg-emerald-500", icon: "Handshake" },
};

// ============================================================
// Pipeline-Specific Tab Visibility
// ============================================================

export type PipelineTab =
  | "dashboard" | "profile" | "intake" | "ledger" | "forecast"
  | "compare" | "disbursement" | "payment_schedule" | "vulnerability" | "compliance"
  | "nominee_proposal" | "interim_order" | "moratorium"
  | "ip_nominee" | "document_checklist" | "creditor_voting" | "proof_of_debt"
  | "pathfinder" | "proposal_generator" | "inflight"
  | "breathing_space" | "communications"
  | "payment_gateway"
  | "cashier_ops"
  | "diary"
  | "notes"
  | "documents"
  | "messages"
  | "calls";

export const PIPELINE_TAB_VISIBILITY: Record<DebtSolutionPipeline, PipelineTab[]> = {
  DMP: ["dashboard", "diary", "notes", "documents", "messages", "profile", "intake", "ledger", "forecast", "compare", "disbursement", "payment_schedule", "payment_gateway", "cashier_ops", "calls", "vulnerability", "compliance", "breathing_space", "communications"],
  IVA: ["dashboard", "profile", "intake", "ledger", "forecast", "compare", "disbursement", "payment_schedule", "payment_gateway", "cashier_ops", "calls", "vulnerability", "compliance", "nominee_proposal", "ip_nominee", "document_checklist", "creditor_voting", "proof_of_debt", "pathfinder", "proposal_generator", "inflight", "breathing_space", "communications"],
  DRO: ["dashboard", "profile", "intake", "ledger", "forecast", "compare", "payment_schedule", "payment_gateway", "cashier_ops", "calls", "vulnerability", "compliance", "interim_order", "moratorium", "breathing_space", "communications"],
  Settlement: ["dashboard", "profile", "intake", "ledger", "forecast", "compare", "disbursement", "payment_schedule", "payment_gateway", "cashier_ops", "calls", "vulnerability", "compliance", "breathing_space", "communications"],
};

export const PIPELINE_TAB_LABELS: Record<PipelineTab, string> = {
  dashboard: "Dashboard",
  calls: "Calls",
  profile: "Customer Profile",
  intake: "SFS Budget",
  ledger: "Creditor List",
  forecast: "Payoff Forecast",
  compare: "Plan Comparison",
  disbursement: "Payout Ledger",
  payment_schedule: "Payment Schedule",
  vulnerability: "Vulnerability & Safeguarding",
  compliance: "Compliance & Audit",
  nominee_proposal: "Nominee Proposal",
  interim_order: "Interim Order",
  moratorium: "Moratorium Status",
  ip_nominee: "IP Supervision & Dividend Ledger",
  document_checklist: "Document Checklist",
  creditor_voting: "IVA Proposals & Creditor Voting",
  proof_of_debt: "Proof of Debt",
  pathfinder: "Pathfinder Engine",
  proposal_generator: "Proposal Generator",
  inflight: "In-Flight Management",
  breathing_space: "Breathing Space",
  communications: "Communications",
  payment_gateway: "Payment & Disbursement Gateway",
  cashier_ops: "Cashier Operations",
  diary: "Diary & Tasks",
  notes: "Notes",
  documents: "Documents & Letters",
  messages: "Email & SMS",
};

// ============================================================
// Solution Suitability Engine
// ============================================================

export interface SuitabilityInput {
  totalUnsecuredDebt: number;
  disposableIncome: number;
  assetEquity: number;
  creditorCount: number;
  monthlyMinimums: number;
}

function verdictFromScore(percentage: number): SuitabilityVerdict {
  if (percentage >= 75) return "eligible";
  if (percentage >= 50) return "likely";
  if (percentage >= 25) return "marginal";
  return "unsuitable";
}

export function calculateSuitability(input: SuitabilityInput): SolutionSuitabilityScore[] {
  const { totalUnsecuredDebt, disposableIncome, assetEquity, creditorCount } = input;

  const scores: SolutionSuitabilityScore[] = [];

  // --- DMP ---
  {
    let score = 50;
    const reasons: string[] = [];
    const blockers: string[] = [];
    if (disposableIncome > 0) { score += 25; reasons.push("Positive disposable income for pro-rata distribution"); }
    else { score -= 20; blockers.push("No disposable income — cannot sustain monthly payments"); }
    if (totalUnsecuredDebt > 0 && totalUnsecuredDebt <= 20000) { score += 10; reasons.push("Debt level suitable for informal arrangement"); }
    else if (totalUnsecuredDebt > 20000) { score -= 5; reasons.push("Higher debt may still work but formal solutions worth considering"); }
    if (creditorCount >= 3) { score += 10; reasons.push(`${creditorCount} creditors — multi-creditor DMP viable`); }
    if (assetEquity > 50000) { score -= 15; blockers.push("Significant assets may require formal insolvency"); }
    if (assetEquity === 0) { score += 5; reasons.push("No significant assets to protect via formal route"); }
    score = Math.max(0, Math.min(100, score));
    scores.push({ pipeline: "DMP", percentage: score, verdict: verdictFromScore(score), reasons, blockers });
  }

  // --- IVA ---
  {
    let score = 40;
    const reasons: string[] = [];
    const blockers: string[] = [];
    if (totalUnsecuredDebt >= 10000) { score += 20; reasons.push(`Debt of £${totalUnsecuredDebt.toLocaleString()} meets IVA minimum threshold (£10,000)`); }
    else { score -= 25; blockers.push(`Debt below IVA minimum threshold (£10,000)`); }
    if (disposableIncome >= 100) { score += 20; reasons.push(`Disposable income of £${disposableIncome.toLocaleString()}/mo can fund IVA contributions`); }
    else if (disposableIncome > 0) { score += 5; reasons.push("Marginal disposable income — may need modified IVA terms"); }
    else { score -= 20; blockers.push("No disposable income to fund IVA contributions"); }
    if (assetEquity > 0 && assetEquity <= 50000) { score += 10; reasons.push("Moderate assets can be protected through IVA"); }
    if (assetEquity > 50000) { score -= 10; blockers.push("High asset equity may require remortgage release clause"); }
    if (creditorCount >= 2) { score += 5; reasons.push(`${creditorCount} creditors — sufficient for creditor voting`); }
    score = Math.max(0, Math.min(100, score));
    scores.push({ pipeline: "IVA", percentage: score, verdict: verdictFromScore(score), reasons, blockers });
  }

  // --- DRO / Bankruptcy ---
  {
    let score = 35;
    const reasons: string[] = [];
    const blockers: string[] = [];
    if (totalUnsecuredDebt > 0 && totalUnsecuredDebt <= 30000) { score += 25; reasons.push(`Debt of £${totalUnsecuredDebt.toLocaleString()} within DRO limit (£30,000)`); }
    else if (totalUnsecuredDebt > 30000) { score -= 30; blockers.push(`Debt exceeds DRO limit (£30,000) — Bankruptcy may be more appropriate`); }
    if (disposableIncome <= 75) { score += 20; reasons.push(`Disposable income £${disposableIncome.toLocaleString()}/mo under DRO threshold (£75/mo)`); }
    else { score -= 25; blockers.push(`Disposable income exceeds DRO threshold (£75/mo)`); }
    if (assetEquity <= 2000) { score += 15; reasons.push("Assets under DRO threshold (£2,000)"); }
    else { score -= 20; blockers.push(`Asset equity exceeds DRO threshold (£2,000)`); }
    if (totalUnsecuredDebt > 30000 && disposableIncome <= 75 && assetEquity <= 2000) {
      reasons.push("DRO not viable but Bankruptcy may be suitable given low income/assets");
    }
    score = Math.max(0, Math.min(100, score));
    scores.push({ pipeline: "DRO", percentage: score, verdict: verdictFromScore(score), reasons, blockers });
  }

  // --- Settlement ---
  {
    let score = 30;
    const reasons: string[] = [];
    const blockers: string[] = [];
    if (assetEquity > 10000 || disposableIncome > 200) { score += 25; reasons.push("Lump-sum source available (asset equity or high disposable income)"); }
    else { score -= 15; blockers.push("No clear lump-sum source for full & final settlement"); }
    if (creditorCount <= 5) { score += 15; reasons.push(`${creditorCount} creditors — manageable negotiation scope`); }
    else { score -= 10; blockers.push(`${creditorCount} creditors — complex multi-creditor negotiation`); }
    if (totalUnsecuredDebt > 5000) { score += 10; reasons.push("Debt level justifies settlement negotiation effort"); }
    score = Math.max(0, Math.min(100, score));
    scores.push({ pipeline: "Settlement", percentage: score, verdict: verdictFromScore(score), reasons, blockers });
  }

  return scores;
}

export const VERDICT_COLORS: Record<SuitabilityVerdict, { bg: string; text: string; bar: string; badge: string }> = {
  eligible: { bg: "bg-emerald-50 dark:bg-emerald-500/10", text: "text-emerald-700 dark:text-emerald-300", bar: "bg-emerald-500", badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300" },
  likely: { bg: "bg-blue-50 dark:bg-blue-500/10", text: "text-blue-700 dark:text-blue-300", bar: "bg-blue-500", badge: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300" },
  marginal: { bg: "bg-amber-50 dark:bg-amber-500/10", text: "text-amber-700 dark:text-amber-300", bar: "bg-amber-500", badge: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300" },
  unsuitable: { bg: "bg-rose-50 dark:bg-rose-500/10", text: "text-rose-700 dark:text-rose-300", bar: "bg-rose-500", badge: "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300" },
};

// ============================================================
// Master Case Builder
// ============================================================

function buildFinancialStatement(entries: DebtSfsEntry[]): FinancialStatement {
  const totalIncome = entries.filter((e) => e.category === "income").reduce((s, e) => s + e.amount, 0);
  const totalEssential = entries.filter((e) => e.category === "essential_expense").reduce((s, e) => s + e.amount, 0);
  const totalDiscretionary = entries.filter((e) => e.category === "discretionary_expense").reduce((s, e) => s + e.amount, 0);
  const totalDebtRepayments = entries.filter((e) => e.category === "debt_repayment").reduce((s, e) => s + e.amount, 0);
  const disposableIncome = totalIncome - totalEssential - totalDiscretionary - totalDebtRepayments;
  return {
    entries,
    totalIncome,
    totalEssentialExpenses: totalEssential,
    totalDiscretionaryExpenses: totalDiscretionary,
    totalDebtRepayments,
    disposableIncome,
    lastRecalculatedAt: new Date().toISOString(),
  };
}

function buildCreditorsAndDebts(creditors: DebtCreditor[]): CreditorsAndDebts {
  const totalDebt = creditors.reduce((s, c) => s + c.balance, 0);
  const totalMonthlyMinimums = creditors.reduce((s, c) => s + c.minimum_payment, 0);
  const aprs = creditors.filter((c) => c.apr > 0);
  const averageApr = aprs.length > 0 ? aprs.reduce((s, c) => s + c.apr, 0) / aprs.length : 0;
  return { creditors, totalDebt, totalMonthlyMinimums, averageApr, creditorCount: creditors.length };
}

function buildOpenBankingSummary(transactions: DebtBankTransaction[]): OpenBankingSummary {
  const imported = transactions.filter((t) => t.imported_to_sfs);
  const autoCategorized = transactions.filter((t) => t.auto_category && t.auto_category !== "other");
  const confidences = transactions.map((t) => parseFloat(t.confidence) || 0).filter((c) => c > 0);
  return {
    transactions,
    importedToSfsCount: imported.length,
    totalImportedCount: transactions.length,
    lastImportDate: transactions.length > 0 ? transactions[0].transaction_date : null,
    autoCategorizedCount: autoCategorized.length,
    confidenceAverage: confidences.length > 0 ? confidences.reduce((s, c) => s + c, 0) / confidences.length : 0,
  };
}

function buildAssets(profile: DebtCustomerProfile | null): AssetInfo | null {
  if (!profile) return null;
  const propertyValue = profile.property_value ?? 0;
  const outstandingMortgage = profile.outstanding_mortgage_or_rent ?? 0;
  const vehicleValue = 0;
  const otherAssetsValue = 0;
  const assetEquity = Math.max(0, propertyValue - outstandingMortgage);
  if (propertyValue === 0 && assetEquity === 0) return null;
  return { propertyValue, outstandingMortgage, vehicleValue, otherAssetsValue, assetEquity };
}

function buildCustomerProfile(
  caseData: DebtCase,
  profile: DebtCustomerProfile | null,
  bankTransactions: DebtBankTransaction[],
): CustomerProfileMaster {
  const fullName = caseData.debtor_name;
  return {
    fullName,
    dateOfBirth: profile?.date_of_birth ?? null,
    email: profile?.email ?? null,
    phone: profile?.phone ?? null,
    mobile: profile?.mobile ?? null,
    niNumber: profile?.ni_number ?? null,
    residencyStatus: (profile?.tenure_type as DebtTenureType | null) ?? null,
    currentAddress: profile?.address_line_1
      ? [profile.address_line_1, profile.address_line_2, profile.city, profile.postcode].filter(Boolean).join(", ")
      : null,
    addressHistory: [],
    householdComposition: [],
    employmentStatus: profile?.employment_status ?? null,
    maritalStatus: profile?.marital_status ?? null,
    vulnerabilities: null,
    assets: buildAssets(profile),
    openBankingData: buildOpenBankingSummary(bankTransactions),
  };
}

function buildSolutionState(
  caseData: DebtCase,
  suitabilityScores: SolutionSuitabilityScore[],
): SolutionState {
  const pipelineMap: Record<string, DebtSolutionPipeline> = {
    dmp: "DMP", iva: "IVA", dro: "DRO", settlement: "Settlement", pending: "DMP",
  };
  const currentPipeline = pipelineMap[caseData.plan_type] ?? "DMP";
  return {
    currentPipeline,
    pipelineStatus: "not_started",
    stageHistory: [],
    pipelineSwitchCount: 0,
    lastSwitchedAt: null,
    nomineeAssigned: null,
    interimOrderGranted: false,
    moratoriumEndDate: null,
    suitabilityScores,
    lastSuitabilityEvalAt: new Date().toISOString(),
  };
}

function buildMasterCase(
  caseData: DebtCase,
  profile: DebtCustomerProfile | null,
  creditors: DebtCreditor[],
  sfsEntries: DebtSfsEntry[],
  bankTransactions: DebtBankTransaction[],
  ipDetails: IPDetails | null,
  documentChecklist: DocumentChecklistItem[],
  ivaProposalData: IVAProposalData | null,
  creditorVotes: CreditorVote[],
  proofOfDebt: ProofOfDebt[],
): DebtVergeCaseMaster {
  const fs = buildFinancialStatement(sfsEntries);
  const cad = buildCreditorsAndDebts(creditors);
  const scores = calculateSuitability({
    totalUnsecuredDebt: cad.totalDebt,
    disposableIncome: fs.disposableIncome,
    assetEquity: buildAssets(profile)?.assetEquity ?? 0,
    creditorCount: cad.creditorCount,
    monthlyMinimums: cad.totalMonthlyMinimums,
  });
  return {
    caseId: caseData.id,
    caseNumber: caseData.case_number,
    debtorName: caseData.debtor_name,
    debtorReference: caseData.debtor_reference,
    status: caseData.status,
    notes: caseData.notes,
    createdAt: caseData.created_at,
    updatedAt: caseData.updated_at,
    customerProfile: buildCustomerProfile(caseData, profile, bankTransactions),
    financialStatement: fs,
    creditorsAndDebts: cad,
    solutionState: buildSolutionState(caseData, scores),
    ipDetails,
    documentChecklist,
    ivaProposalData,
    creditorVotes,
    proofOfDebt,
  };
}

// ============================================================
// Context Type
// ============================================================

interface DebtVergeCaseContextValue {
  activeCase: DebtVergeCaseMaster | null;
  activeCaseId: string | null;
  setActiveCaseId: (id: string | null) => void;
  loading: boolean;
  error: string | null;

  updateCaseProfile: (patch: Partial<CustomerProfileMaster>) => Promise<void>;
  recalculateSFS: () => void;
  switchSolutionPipeline: (newPipeline: DebtSolutionPipeline, reason?: string) => Promise<void>;
  transferSolution: (caseId: string, targetSolutionType: DebtSolutionPipeline, reason: string) => Promise<void>;

  visibleTabs: PipelineTab[];
  activeTab: PipelineTab;
  setActiveTab: (tab: PipelineTab) => void;

  pipelineStages: PipelineStageDef[];
  currentStageIndex: number;

  suitabilityScores: SolutionSuitabilityScore[];
  suitabilityLoading: boolean;

  ipDetails: IPDetails | null;
  documentChecklist: DocumentChecklistItem[];
  ivaProposalData: IVAProposalData | null;
  creditorVotes: CreditorVote[];
  proofOfDebt: ProofOfDebt[];
  reloadInsolvency: () => void;
}

const DebtVergeCaseContext = createContext<DebtVergeCaseContextValue | undefined>(undefined);

// ============================================================
// Provider
// ============================================================

export function DebtVergeCaseProvider({ children }: { children: ReactNode }) {
  const { data: cases, loading: casesLoading, error: casesError, reload } = useDebtCases();
  const [activeCaseId, setActiveCaseId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<PipelineTab>("dashboard");
  const [stageHistory, setStageHistory] = useState<PipelineStageEntry[]>([]);
  const [pipelineOverride, setPipelineOverride] = useState<DebtSolutionPipeline | null>(null);

  // Pick the first client once, when the list first loads. It must not run again when the user
  // deliberately clears the selection (Clients, Payment Suite, Home), or those screens can never open.
  const autoSelected = useRef(false);
  useEffect(() => {
    if (autoSelected.current || cases.length === 0) return;
    autoSelected.current = true;
    if (!activeCaseId) setActiveCaseId(cases[0].id);
  }, [cases, activeCaseId]);

  const selectedCase = cases.find((c) => c.id === activeCaseId) ?? null;

  const { data: profile } = useDebtCustomerProfile(activeCaseId);
  const { data: creditors } = useDebtCreditors(activeCaseId);
  const { data: sfsEntries } = useDebtSfsEntries(activeCaseId);
  const { data: bankTransactions } = useDebtBankTransactions(activeCaseId);

  const { data: ipDetails } = useIPDetails(activeCaseId);
  const { data: documentChecklist, reload: reloadDocs } = useDocumentChecklist(activeCaseId);
  const { data: ivaProposalData } = useIVAProposal(activeCaseId);
  const { data: creditorVotes, reload: reloadVotes } = useCreditorVotes(activeCaseId);
  const { data: proofOfDebt, reload: reloadPod } = useProofOfDebt(activeCaseId);

  const reloadInsolvency = useCallback(() => {
    reloadDocs(); reloadVotes(); reloadPod();
  }, [reloadDocs, reloadVotes, reloadPod]);

  const activeCase = useMemo<DebtVergeCaseMaster | null>(() => {
    if (!selectedCase) return null;
    return buildMasterCase(
      selectedCase, profile, creditors, sfsEntries, bankTransactions,
      ipDetails ?? null, documentChecklist, ivaProposalData ?? null,
      creditorVotes, proofOfDebt,
    );
  }, [selectedCase, profile, creditors, sfsEntries, bankTransactions, ipDetails, documentChecklist, ivaProposalData, creditorVotes, proofOfDebt]);

  const effectiveActiveCase = useMemo<DebtVergeCaseMaster | null>(() => {
    if (!activeCase) return null;
    if (pipelineOverride && activeCase.solutionState.currentPipeline !== pipelineOverride) {
      return {
        ...activeCase,
        solutionState: {
          ...activeCase.solutionState,
          currentPipeline: pipelineOverride,
        },
      };
    }
    return activeCase;
  }, [activeCase, pipelineOverride]);

  const currentPipeline = effectiveActiveCase?.solutionState.currentPipeline ?? "DMP";

  const visibleTabs = useMemo(
    () => PIPELINE_TAB_VISIBILITY[currentPipeline] ?? PIPELINE_TAB_VISIBILITY.DMP,
    [currentPipeline],
  );

  useEffect(() => {
    if (!visibleTabs.includes(activeTab)) {
      setActiveTab("dashboard");
    }
  }, [visibleTabs, activeTab]);

  const pipelineStages = useMemo(
    () => PIPELINE_STAGES.filter((s) => s.pipelines.includes(currentPipeline)),
    [currentPipeline],
  );

  const currentStageIndex = useMemo(() => {
    const completedCount = stageHistory.filter(
      (s) => s.status === "completed" && pipelineStages.some((ps) => ps.stageId === s.stageId),
    ).length;
    return Math.min(completedCount, pipelineStages.length - 1);
  }, [stageHistory, pipelineStages]);

  // Real-time suitability scores — re-evaluated whenever SFS, creditors, or assets change
  const suitabilityScores = useMemo<SolutionSuitabilityScore[]>(() => {
    if (!effectiveActiveCase) return [];
    return effectiveActiveCase.solutionState.suitabilityScores;
  }, [effectiveActiveCase]);

  // -- Helper: updateCaseProfile --
  const updateCaseProfile = useCallback(async (patch: Partial<CustomerProfileMaster>) => {
    if (!activeCaseId) return;
    const dbPatch: Record<string, unknown> = {};
    if (patch.dateOfBirth !== undefined) dbPatch.date_of_birth = patch.dateOfBirth;
    if (patch.email !== undefined) dbPatch.email = patch.email;
    if (patch.phone !== undefined) dbPatch.phone = patch.phone;
    if (patch.mobile !== undefined) dbPatch.mobile = patch.mobile;
    if (patch.niNumber !== undefined) dbPatch.ni_number = patch.niNumber;
    if (patch.residencyStatus !== undefined) dbPatch.tenure_type = patch.residencyStatus;
    if (patch.employmentStatus !== undefined) dbPatch.employment_status = patch.employmentStatus;
    if (patch.maritalStatus !== undefined) dbPatch.marital_status = patch.maritalStatus;
    if (patch.currentAddress !== undefined) {
      const parts = patch.currentAddress.split(",").map((p) => p.trim());
      dbPatch.address_line_1 = parts[0] ?? null;
      dbPatch.address_line_2 = parts[1] ?? null;
      dbPatch.city = parts[2] ?? null;
      dbPatch.postcode = parts[3] ?? null;
    }
    if (patch.fullName !== undefined) {
      await updateDebtCase(activeCaseId, { debtor_name: patch.fullName });
    }
    if (Object.keys(dbPatch).length > 0) {
      await upsertDebtCustomerProfile(activeCaseId, dbPatch);
    }
    reload();
  }, [activeCaseId, reload]);

  // -- Helper: recalculateSFS --
  const recalculateSFS = useCallback(() => {
    if (!activeCaseId || !effectiveActiveCase) return;
    const disposable = effectiveActiveCase.financialStatement.disposableIncome;
    updateDebtCase(activeCaseId, { monthly_disposable_income: disposable }).then(() => reload());
  }, [activeCaseId, effectiveActiveCase, reload]);

  // -- Helper: switchSolutionPipeline (with detailed audit logging) --
  const switchSolutionPipeline = useCallback(async (newPipeline: DebtSolutionPipeline, reason?: string) => {
    if (!activeCaseId || !effectiveActiveCase) return;
    if (effectiveActiveCase.solutionState.currentPipeline === newPipeline) return;

    const fromPipeline = effectiveActiveCase.solutionState.currentPipeline;
    const planTypeMap: Record<DebtSolutionPipeline, string> = {
      DMP: "dmp", IVA: "iva", DRO: "dro", Settlement: "settlement",
    };

    await updateDebtCase(activeCaseId, { plan_type: planTypeMap[newPipeline] as DebtCase["plan_type"] });

    const now = new Date().toISOString();
    const switchEntry: PipelineStageEntry = {
      stageId: "solution_selection",
      stageLabel: `Pipeline switched from ${fromPipeline} to ${newPipeline}`,
      status: "completed",
      enteredAt: now,
      completedAt: now,
      notes: reason ?? `Advisor converted case from ${fromPipeline} to ${newPipeline}`,
    };
    setStageHistory((prev) => [...prev, switchEntry]);
    setPipelineOverride(newPipeline);

    // Build detailed, immutable audit event
    const auditReason = reason ?? `Advisor converted case from ${fromPipeline} to ${newPipeline} due to SFS Disposable Income recalculation`;
    const dataPreservedSummary = [
      `${effectiveActiveCase.creditorsAndDebts.creditorCount} creditors retained (£${effectiveActiveCase.creditorsAndDebts.totalDebt.toLocaleString()})`,
      `${effectiveActiveCase.financialStatement.entries.length} SFS entries retained (DI: £${effectiveActiveCase.financialStatement.disposableIncome.toLocaleString()}/mo)`,
      `${effectiveActiveCase.customerProfile.householdComposition.length} household members retained`,
      effectiveActiveCase.customerProfile.openBankingData
        ? `${effectiveActiveCase.customerProfile.openBankingData.totalImportedCount} Open Banking transactions retained`
        : "Open Banking data retained",
    ].join("; ");

    await addAuditMilestone({
      case_id: activeCaseId,
      milestone: "Solution Pipeline Switched",
      description: `${auditReason}. Data carried over: ${dataPreservedSummary}. Suitability snapshot at switch: ${effectiveActiveCase.solutionState.suitabilityScores.map((s) => `${s.pipeline}=${s.percentage}%`).join(", ")}.`,
    });

    setActiveTab("dashboard");
    reload();
  }, [activeCaseId, effectiveActiveCase, reload]);

  // -- transferSolution: standardized solution transfer with full data-preservation audit --
  // Wraps switchSolutionPipeline with the requested signature and enriched audit logging.
  const transferSolution = useCallback(async (
    caseId: string,
    targetSolutionType: DebtSolutionPipeline,
    reason: string,
  ) => {
    if (!caseId || !effectiveActiveCase) return;
    const fromPipeline = effectiveActiveCase.solutionState.currentPipeline;
    if (fromPipeline === targetSolutionType) return;

    const planTypeMap: Record<DebtSolutionPipeline, DebtPlanType> = {
      DMP: "dmp", IVA: "iva", DRO: "dro", Settlement: "settlement",
    };

    await updateDebtCase(caseId, { plan_type: planTypeMap[targetSolutionType] });

    const now = new Date().toISOString();
    const switchEntry: PipelineStageEntry = {
      stageId: "solution_selection",
      stageLabel: `Solution Transferred from ${fromPipeline} to ${targetSolutionType}`,
      status: "completed",
      enteredAt: now,
      completedAt: now,
      notes: reason,
    };
    setStageHistory((prev) => [...prev, switchEntry]);
    setPipelineOverride(targetSolutionType);

    // Enhanced audit: documents, comms, and all preserved data categories
    const docCount = documentChecklist.length;
    const preserved = [
      `Debtor profile & contact info: retained`,
      `${effectiveActiveCase.creditorsAndDebts.creditorCount} creditors retained (£${effectiveActiveCase.creditorsAndDebts.totalDebt.toLocaleString()})`,
      `${effectiveActiveCase.financialStatement.entries.length} SFS entries retained (DI: £${effectiveActiveCase.financialStatement.disposableIncome.toLocaleString()}/mo)`,
      `${docCount} document${docCount === 1 ? "" : "s"} retained`,
      `Omnichannel conversation history: retained`,
      `Vulnerability & safeguarding records: retained`,
    ];

    await addAuditMilestone({
      case_id: caseId,
      milestone: "Solution Transfer",
      description: `Solution Transferred from ${fromPipeline} to ${targetSolutionType} - Reason: ${reason}. Preserved: ${preserved.join("; ")}. Suitability: ${effectiveActiveCase.solutionState.suitabilityScores.map((s) => `${s.pipeline}=${s.percentage}%`).join(", ")}.`,
      actor: null,
    });

    setActiveTab("dashboard");
    reload();
  }, [activeCaseId, effectiveActiveCase, documentChecklist, reload]);

  const value = useMemo<DebtVergeCaseContextValue>(() => ({
    activeCase: effectiveActiveCase,
    activeCaseId,
    setActiveCaseId,
    loading: casesLoading,
    error: casesError,
    updateCaseProfile,
    recalculateSFS,
    switchSolutionPipeline,
    transferSolution,
    visibleTabs,
    activeTab,
    setActiveTab,
    pipelineStages,
    currentStageIndex,
    suitabilityScores,
    suitabilityLoading: false,
    ipDetails: ipDetails ?? null,
    documentChecklist,
    ivaProposalData: ivaProposalData ?? null,
    creditorVotes,
    proofOfDebt,
    reloadInsolvency,
  }), [
    effectiveActiveCase, activeCaseId, casesLoading, casesError,
    updateCaseProfile, recalculateSFS, switchSolutionPipeline, transferSolution,
    visibleTabs, activeTab, pipelineStages, currentStageIndex,
    suitabilityScores, ipDetails, documentChecklist, ivaProposalData,
    creditorVotes, proofOfDebt, reloadInsolvency,
  ]);

  return <DebtVergeCaseContext.Provider value={value}>{children}</DebtVergeCaseContext.Provider>;
}

// ============================================================
// Hook
// ============================================================

export function useDebtVergeCase(): DebtVergeCaseContextValue {
  const ctx = useContext(DebtVergeCaseContext);
  if (!ctx) throw new Error("useDebtVergeCase must be used within DebtVergeCaseProvider");
  return ctx;
}
