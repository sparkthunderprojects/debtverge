import { useState, useMemo, useEffect } from "react";
import {
  LayoutDashboard, Calculator as FileCalc, Landmark, GitCompareArrows, ScrollText,
  Plus, Search, Trash2, Eye, TrendingDown, Wallet, Users, Calendar,
  ArrowUpRight, ArrowDownRight, CheckCircle2, Clock, AlertCircle, XCircle,
  CreditCard, Banknote, Home, Zap, Receipt, ShoppingCart, Car, Building2,
  ChevronRight, Calculator, Send, FileText, ShieldCheck, Bell, PiggyBank,
  Percent, Scale, ArrowRight, Download, Filter, Star, Snowflake, Mail,
  Handshake, MessageSquare, Split, History, Zap as ZapIcon, X, Check,
  User, Phone, Mail as MailIcon, MapPin, Clock3, Baby, GraduationCap,
  ChevronDown, ChevronUp, Save, Phone as PhoneIcon, Briefcase,
  Heart, ShieldAlert, Brain, HeartPulse, LifeBuoy, Stethoscope,
  PoundSterling, Gift, Lightbulb, Award, Gavel, Layers, Columns3,
  ThumbsUp, ThumbsDown, CircleDot, Sparkles,
  Upload, Banknote as BanknoteIcon, FileSpreadsheet, ArrowLeftRight,
  CalendarClock, ClipboardCheck, TrendingUp, RefreshCw, GitBranch,
  AlertTriangle, Activity, Pencil, Pause, MoreHorizontal, ListChecks, Link2, ChevronDown,
  Wind, Hourglass, BellOff,
  FileUp, CalendarCheck, ShieldX, FlaskConical,
  UserCog, FileCheck, Vote, FileSignature, Network, Smartphone, Building,
  Compass, Package, PenSquare,
} from "lucide-react";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Legend, Area, AreaChart,
} from "recharts";
import {
  useDebtCases, useDebtCreditors, useDebtSfsEntries, useDebtDistributions,
  useDebtAuditLog, generateCaseNumber, createDebtCase, updateDebtCase,
  deleteDebtCase, createDebtCreditor, updateDebtCreditor, deleteDebtCreditor,
  createDebtSfsEntry, updateDebtSfsEntry, deleteDebtSfsEntry,
  createDebtDistribution, updateDebtDistributionStatus, deleteDebtDistribution,
  addAuditMilestone, calculateProRata, projectDmp, projectSettlement,
  calculateProRataSimple, projectDmpWithRates,
  useDebtPayments, logMonthlyPayment, deleteDebtPayment, calculatePaymentSplit,
  useDebtNegotiations, addNegotiationEvent, deleteNegotiationEvent,
  getLatestNegotiationPerCreditor, recalcReducedProRata,
  useDebtCustomerProfile, upsertDebtCustomerProfile,
  useDebtPreviousAddresses, createDebtPreviousAddress, deleteDebtPreviousAddress,
  getSfsAllowanceThresholds, TENURE_TYPE_LABELS,
  useDebtVulnerabilityAssessment, upsertDebtVulnerabilityAssessment,
  VULNERABILITY_CHECKLIST, calculateVulnerabilityScore, getRecommendedCommChannel,
  useDebtBenefitsChecks, createDebtBenefitsCheck, updateDebtBenefitsCheck,
  deleteDebtBenefitsCheck, getTotalBenefitsUplift, getPotentialBenefitsUplift,
  BENEFITS_CATALOG, evaluateSolutionSuitability,
  parseBankLine, useDebtBankTransactions, bulkCreateDebtBankTransactions,
  updateDebtBankTransaction, deleteDebtBankTransaction, importTransactionToSfs,
  bulkImportTransactionsToSfs, useDebtAnnualReviews, calculateNextReviewDueDate,
  getReviewCountdown, initiateAnnualReview, completeAnnualReview,
  frequencyToInstallment, frequencyIntervalDays, advanceDueDate,
  generateUpcomingDueDates, getPaymentSchedule, savePaymentSchedule,
  usePaymentTransactions, createPaymentTransaction, updatePaymentTransaction,
  deletePaymentTransaction, generateScheduledTransactions,
  useBreathingSpaces, useActiveBreathingSpace, createBreathingSpace,
  updateBreathingSpace, cancelBreathingSpace, completeReviewTask,
  recordTreatmentEndDate, checkBreathingSpaceEligibility,
  BS_QUALIFYING_DEBT_TYPES, BS_EXCLUDED_DEBT_TYPES,
  seedIVADemoCases,
} from "@/lib/debt-hooks";
import { OfferPackDrawer } from "@/components/debt/OfferPackDrawer";
import { ReferralsButton, HandOverButton } from "@/components/debt/EcosystemHandovers";
import { HomeScreen } from "@/components/HomeScreen";
import { TeamScreen, AssigneeControl } from "@/components/TeamScreen";
import { useAuth } from "@/lib/auth";
import { DiaryTab } from "./debt/DiaryTab";
import { DocumentsTab } from "./debt/DocumentsTab";
import { CaseNextAction } from "@/components/debt/CaseNextAction";
import { PaymentLinkButton, ChangeRequestsButton } from "@/components/debt/PortalAdviserTools";
import { formatCurrency, formatDateShort, relativeTime } from "@/lib/format";
import { Modal, Field } from "@/components/projects/SharedUI";
import {
  IPNomineeTab, DocumentChecklistTab, CreditorVotingTab, ProofOfDebtTab,
} from "@/components/debt/InsolvencyTabs";
import { PathfinderEngine } from "@/components/debt/PathfinderEngine";
import { ProposalGenerator } from "@/components/debt/ProposalGenerator";
import { InflightCaseManagement } from "@/components/debt/InflightCaseManagement";
import { PaymentGatewayModule } from "@/components/debt/PaymentGatewayModule";
import { CashierOperationsModule } from "@/components/debt/CashierOperationsModule";
import { IVASettlementForecast } from "@/components/iva/IVASettlementForecast";
import { TeamCommsWorkspace } from "@/components/comms/TeamInbox";
import {
  DebtorSelfServiceView, CreditorPortalView,
  PORTAL_ROLE_META,
} from "@/components/debt/PortalViews";
import type { DebtVergePortalRole, DebtVergeAgentRole, WorkspaceViewMode, IVACaseStatus } from "@/lib/types";
import { IVA_STATUS_META, AGENT_ROLE_META, WORKSPACE_VIEW_META } from "@/lib/types";
import type {
  DebtCase, DebtCreditor, DebtSfsEntry, DebtAuditEntry,
  DebtCaseStatus, DebtPlanType, DebtType, DebtSfsCategory,
  DebtPayment, DebtNegotiationEvent, DebtNegotiationEventType,
  DebtDistributionStatus, DebtCustomerProfile, DebtPreviousAddress, DebtTenureType,
  DebtVulnerabilityAssessment, DebtVulnerabilityLevel, DebtBenefitsCheck,
  DebtBankTransaction, DebtAnnualReview, DebtAnnualReviewStatus,
  DebtSolutionPipeline, DebtVergeCaseMaster,
  PaymentFrequency, PaymentScheduleDay, PaymentSchedule, PaymentTransaction, PaymentTransactionStatus,
  BreathingSpace, BreathingSpaceType, BreathingSpaceStatus,
  BreathingSpaceReviewTask, BreathingSpaceEligibilityChecks,
} from "@/lib/types";
import {
  DebtVergeCaseProvider, useDebtVergeCase,
  PIPELINE_META, PIPELINE_TAB_VISIBILITY, PIPELINE_TAB_LABELS,
  PIPELINE_STAGES, VERDICT_COLORS,
  type PipelineTab,
} from "@/lib/debtverge-case-context";
import type {
  SolutionSuitabilityScore, SuitabilityVerdict,
} from "@/lib/types";
import { VoipCallButton } from "@/components/stormcall/VoipCallButton";
import { IncomeCalcButton } from "@/components/income-calc/IncomeCalcButton";
import { KnowledgeAssistantDrawer } from "@/components/knowledge/KnowledgeAssistantDrawer";
import { DebtVergeNav } from "@/components/DebtVergeNav";
import { useAuth } from "@/lib/auth";

type Tab = PipelineTab;

const TAB_ICONS: Record<Tab, React.ReactNode> = {
  dashboard: <LayoutDashboard className="h-4 w-4" />,
  diary: <ListChecks className="h-4 w-4" />,
  documents: <FileText className="h-4 w-4" />,
  profile: <User className="h-4 w-4" />,
  intake: <FileCalc className="h-4 w-4" />,
  ledger: <Landmark className="h-4 w-4" />,
  forecast: <TrendingDown className="h-4 w-4" />,
  compare: <GitCompareArrows className="h-4 w-4" />,
  disbursement: <Handshake className="h-4 w-4" />,
  payment_schedule: <CalendarClock className="h-4 w-4" />,
  vulnerability: <ShieldAlert className="h-4 w-4" />,
  compliance: <ScrollText className="h-4 w-4" />,
  nominee_proposal: <Scale className="h-4 w-4" />,
  interim_order: <Gavel className="h-4 w-4" />,
  moratorium: <ShieldCheck className="h-4 w-4" />,
  ip_nominee: <UserCog className="h-4 w-4" />,
  document_checklist: <FileCheck className="h-4 w-4" />,
  creditor_voting: <Vote className="h-4 w-4" />,
  proof_of_debt: <FileSignature className="h-4 w-4" />,
  pathfinder: <Compass className="h-4 w-4" />,
  proposal_generator: <Package className="h-4 w-4" />,
  inflight: <Wallet className="h-4 w-4" />,
  breathing_space: <Wind className="h-4 w-4" />,
  communications: <Mail className="h-4 w-4" />,
  payment_gateway: <Banknote className="h-4 w-4" />,
  cashier_ops: <ShieldCheck className="h-4 w-4" />,
};

const ALL_TABS: Tab[] = ["dashboard", "diary", "documents", "profile", "intake", "ledger", "forecast", "compare", "disbursement", "payment_schedule", "payment_gateway", "cashier_ops", "vulnerability", "compliance", "nominee_proposal", "interim_order", "moratorium", "ip_nominee", "document_checklist", "creditor_voting", "proof_of_debt", "pathfinder", "proposal_generator", "inflight", "breathing_space", "communications"];

const STATUS_META: Record<DebtCaseStatus, { label: string; color: string; icon: React.ReactNode }> = {
  intake: { label: "Intake", color: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300", icon: <Clock className="h-3 w-3" /> },
  sfs_pending: { label: "SFS Pending", color: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300", icon: <FileText className="h-3 w-3" /> },
  sfs_approved: { label: "SFS Approved", color: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300", icon: <CheckCircle2 className="h-3 w-3" /> },
  creditor_pack_sent: { label: "Creditor Pack Sent", color: "bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300", icon: <Send className="h-3 w-3" /> },
  payment_schedule_active: { label: "Payment Schedule Active", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300", icon: <CheckCircle2 className="h-3 w-3" /> },
  completed: { label: "Completed", color: "bg-teal-100 text-teal-700 dark:bg-teal-500/20 dark:text-teal-300", icon: <CheckCircle2 className="h-3 w-3" /> },
  closed: { label: "Closed", color: "bg-slate-100 text-slate-500 dark:bg-slate-600 dark:text-slate-400", icon: <XCircle className="h-3 w-3" /> },
};

const DEBT_TYPE_META: Record<DebtType, { label: string; icon: React.ReactNode; color: string }> = {
  credit_card: { label: "Credit Card", icon: <CreditCard className="h-4 w-4" />, color: "text-violet-600" },
  personal_loan: { label: "Personal Loan", icon: <Banknote className="h-4 w-4" />, color: "text-blue-600" },
  mortgage_arrears: { label: "Mortgage Arrears", icon: <Home className="h-4 w-4" />, color: "text-rose-600" },
  utility_arrears: { label: "Utility Arrears", icon: <Zap className="h-4 w-4" />, color: "text-amber-600" },
  council_tax: { label: "Council Tax", icon: <Building2 className="h-4 w-4" />, color: "text-teal-600" },
  overdraft: { label: "Overdraft", icon: <Wallet className="h-4 w-4" />, color: "text-orange-600" },
  store_card: { label: "Store Card", icon: <ShoppingCart className="h-4 w-4" />, color: "text-pink-600" },
  hire_purchase: { label: "Hire Purchase", icon: <Car className="h-4 w-4" />, color: "text-indigo-600" },
  other: { label: "Other", icon: <Receipt className="h-4 w-4" />, color: "text-slate-500" },
};

const SFS_CATEGORY_META: Record<DebtSfsCategory, { label: string; color: string }> = {
  income: { label: "Income", color: "emerald" },
  essential_expense: { label: "Essential Expenses", color: "blue" },
  discretionary_expense: { label: "Discretionary Expenses", color: "amber" },
  debt_repayment: { label: "Debt Repayments", color: "rose" },
};

const SFS_PRESETS: { category: DebtSfsCategory; label: string; defaultAmount: number }[] = [
  { category: "income", label: "Net Salary (Monthly)", defaultAmount: 2200 },
  { category: "income", label: "Benefits / Universal Credit", defaultAmount: 0 },
  { category: "income", label: "Pension Income", defaultAmount: 0 },
  { category: "income", label: "Other Income", defaultAmount: 0 },
  { category: "essential_expense", label: "Rent / Mortgage", defaultAmount: 750 },
  { category: "essential_expense", label: "Council Tax", defaultAmount: 150 },
  { category: "essential_expense", label: "Utility Bills (Gas/Elec/Water)", defaultAmount: 180 },
  { category: "essential_expense", label: "Groceries / Food", defaultAmount: 250 },
  { category: "essential_expense", label: "Transport", defaultAmount: 80 },
  { category: "essential_expense", label: "Insurances", defaultAmount: 50 },
  { category: "discretionary_expense", label: "Mobile / Internet", defaultAmount: 45 },
  { category: "discretionary_expense", label: "Subscriptions & Entertainment", defaultAmount: 50 },
  { category: "discretionary_expense", label: "Clothing", defaultAmount: 30 },
  { category: "discretionary_expense", label: "Personal / Social", defaultAmount: 60 },
];

const MILESTONE_ICONS: Record<string, React.ReactNode> = {
  "Case Opened": <FileText className="h-4 w-4" />,
  "SFS Approved": <CheckCircle2 className="h-4 w-4" />,
  "Creditor Pack Sent": <Send className="h-4 w-4" />,
  "Payment Schedule Active": <Calendar className="h-4 w-4" />,
  "Distribution Processed": <Wallet className="h-4 w-4" />,
  "Compliance Review": <ShieldCheck className="h-4 w-4" />,
};

const CHART_COLORS = ["#10b981", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16"];

export function DebtVerge({ onTransferToIVAVerge, onTransferToDraftVerge, initialCaseId, onGoHome, onSwitchApp }: { onTransferToIVAVerge?: (caseId: string) => void; onTransferToDraftVerge?: (caseId: string) => void; initialCaseId?: string | null; onGoHome?: () => void; onSwitchApp?: (id: string) => void }) {
  return (
    <DebtVergeCaseProvider>
      <DebtVergeWorkspace onTransferToIVAVerge={onTransferToIVAVerge} onTransferToDraftVerge={onTransferToDraftVerge} initialCaseId={initialCaseId} onGoHome={onGoHome} onSwitchApp={onSwitchApp} />
    </DebtVergeCaseProvider>
  );
}

interface DebtVergeWorkspaceProps {
  onTransferToIVAVerge?: (caseId: string) => void;
  onTransferToDebtVerge?: (caseId: string) => void;
  onTransferToDraftVerge?: (caseId: string) => void;
  forceViewMode?: WorkspaceViewMode;
  standaloneAppName?: "DebtVerge" | "DraftVerge" | "IVAVerge";
  initialCaseId?: string | null;
  onGoHome?: () => void;
  onSwitchApp?: (id: string) => void;
}

export function DebtVergeWorkspace({
  onTransferToIVAVerge,
  onTransferToDebtVerge,
  onTransferToDraftVerge,
  forceViewMode,
  standaloneAppName = "DebtVerge",
  initialCaseId,
  onGoHome,
  onSwitchApp,
}: DebtVergeWorkspaceProps) {
  const {
    activeCase, activeCaseId, setActiveCaseId, loading, error,
    visibleTabs, activeTab, setActiveTab, switchSolutionPipeline, transferSolution,
    suitabilityScores,
  } = useDebtVergeCase();
  const { data: cases, reload } = useDebtCases();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [showNewCase, setShowNewCase] = useState(false);
  const [showOfferPack, setShowOfferPack] = useState(false);
  const [showSolutionMatrix, setShowSolutionMatrix] = useState(false);
  const [showPipelineSwitcher, setShowPipelineSwitcher] = useState(false);
  const [portalRole, setPortalRole] = useState<DebtVergePortalRole>("advisor_ip");
  const [showPortalMenu, setShowPortalMenu] = useState(false);
  const [showAIAssistant, setShowAIAssistant] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showTabMenu, setShowTabMenu] = useState(false);
  const [showPaymentLink, setShowPaymentLink] = useState(false);
  const [showHandOver, setShowHandOver] = useState(false);
  const [showSuitability, setShowSuitability] = useState(false);
  const [showTeam, setShowTeam] = useState(false);
  const { dvRole } = useAuth();

  // ── Workspace Agent Role & View Mode (DMP vs IVA dual workspace) ──
  const [agentRole, setAgentRole] = useState<DebtVergeAgentRole>(
    forceViewMode === "iva" ? "iva_agent" : forceViewMode === "dmp" ? "dmp_agent" : forceViewMode === "draft" ? "draft_agent" : "admin_supervisor",
  );
  const [viewMode, setViewMode] = useState<WorkspaceViewMode>(forceViewMode ?? "all");
  const [ivaStageFilter, setIvaStageFilter] = useState<string>("all_iva");
  const [draftStageFilter, setDraftStageFilter] = useState<string>("all_draft");

  const canToggleView = !forceViewMode;

  // Determine IVA status from case data for display in sidebar
  const deriveIVAStatus = (c: DebtCase): IVACaseStatus | null => {
    if (c.plan_type !== "iva") return null;
    if (c.status === "completed" || c.status === "closed") return "completed";
    if (c.status === "payment_schedule_active") return "active_supervision";
    if (c.status === "creditor_pack_sent") return "meeting_called";
    if (c.status === "sfs_approved" || c.status === "sfs_pending") return "proposal_draft";
    if (c.status === "intake") return "proposal_draft";
    return "proposal_draft";
  };

  // ── Conditional render flags for tab-aware widget visibility ──
  // These let top-level widgets (Suitability Matrix bar, Compliance Overlay)
  // be shown/hidden per-tab without removing them from the codebase.
  const isOverviewTab = activeTab === "dashboard";
  const isCommsTab = activeTab === "communications";
  const isSFSTab = activeTab === "intake";
  const showAssessmentWidgets = isOverviewTab || activeTab === "profile";

  const selectedCase = cases.find((c) => c.id === activeCaseId) ?? null;
  const currentPipeline = activeCase?.solutionState.currentPipeline ?? "DMP";
  const pipelineMeta = PIPELINE_META[currentPipeline];

  // Map context tabs to the local Tab type — context provides the filtered set
  const DRAFT_VISIBLE_TABS: Tab[] = ["dashboard", "profile", "intake", "ledger", "nominee_proposal", "creditor_voting", "document_checklist", "proof_of_debt", "proposal_generator", "pathfinder", "compliance", "communications"];
  const tabsToShow: Tab[] = standaloneAppName === "DraftVerge" ? DRAFT_VISIBLE_TABS : visibleTabs;

  useEffect(() => {
    if (standaloneAppName === "DraftVerge" && !DRAFT_VISIBLE_TABS.includes(activeTab)) {
      setActiveTab(DRAFT_VISIBLE_TABS[0]);
    }
  }, [standaloneAppName, activeTab, setActiveTab]);

  const mocApprovalPct = useMemo(() => {
    const votes = activeCase?.creditorVotes ?? [];
    const totalClaimed = votes.reduce((s, v) => s + v.claimed_debt_amount, 0);
    const acceptValue = votes.filter((v) => v.vote === "accept" || v.vote === "modify").reduce((s, v) => s + v.claimed_debt_amount, 0);
    return totalClaimed > 0 ? (acceptValue / totalClaimed) * 100 : 0;
  }, [activeCase?.creditorVotes]);
  const mocThresholdMet = mocApprovalPct >= 75;
  const mocHasVotes = (activeCase?.creditorVotes ?? []).length > 0;

  // Derive DraftVerge pipeline stage from case data for sidebar filtering
  // Stage 1: Proposal Drafting (intake / sfs_pending / sfs_approved)
  // Stage 2: Notice of Meeting Issued (creditor_pack_sent)
  // Stage 3: MOC Voting Open (creditor_pack_sent + votes exist)
  // Stage 4: Approved / Pending IP Handover (payment_schedule_active for IVA)
  const deriveDraftStage = (c: DebtCase): string | null => {
    if (c.plan_type !== "iva") return null;
    if (c.status === "completed" || c.status === "closed") return null; // not in draft stage anymore
    if (c.status === "payment_schedule_active") return "approved_handover";
    if (c.status === "creditor_pack_sent") return "moc_voting";
    if (c.status === "sfs_approved") return "notice_issued";
    if (c.status === "sfs_pending" || c.status === "intake") return "proposal_drafting";
    return "proposal_drafting";
  };

  const filteredCases = useMemo(() => {
    let result = cases;
    // ── Workspace view mode filtering (DMP / Draft / IVA / All) ──
    if (viewMode === "dmp") {
      result = result.filter((c) => c.plan_type === "dmp" || c.plan_type === "settlement");
    } else if (viewMode === "iva") {
      result = result.filter((c) => c.plan_type === "iva");
    } else if (viewMode === "draft") {
      // DraftVerge shows IVA cases that are NOT yet in active supervision
      result = result.filter((c) => c.plan_type === "iva" && c.status !== "payment_schedule_active" && c.status !== "completed" && c.status !== "closed");
    }
    if (viewMode === "iva" && ivaStageFilter !== "all_iva") {
      result = result.filter((c) => deriveIVAStatus(c) === ivaStageFilter);
    }
    if (viewMode === "draft" && draftStageFilter !== "all_draft") {
      result = result.filter((c) => deriveDraftStage(c) === draftStageFilter);
    }
    if (statusFilter !== "all" && viewMode !== "iva" && viewMode !== "draft") result = result.filter((c) => c.status === statusFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((c) =>
        c.case_number.toLowerCase().includes(q) ||
        c.debtor_name.toLowerCase().includes(q) ||
        (c.debtor_reference ?? "").toLowerCase().includes(q)
      );
    }
    return result;
  }, [cases, statusFilter, search, viewMode, ivaStageFilter, draftStageFilter]);

  // Auto-select first case (or the case passed from a cross-app transfer)
  useEffect(() => {
    if (initialCaseId && cases.some((c) => c.id === initialCaseId)) {
      setActiveCaseId(initialCaseId);
    }
  }, [filteredCases, activeCaseId, setActiveCaseId, initialCaseId, cases]);

  // Auto-seed IVA demo cases for iva_agent / draft_agent / admin_supervisor roles when no IVA cases exist
  const [seeding, setSeeding] = useState(false);
  const hasIVACases = useMemo(() => cases.some((c) => c.plan_type === "iva"), [cases]);
  useEffect(() => {
    if (seeding || hasIVACases) return;
    if (agentRole !== "iva_agent" && agentRole !== "admin_supervisor" && agentRole !== "draft_agent") return;
    setSeeding(true);
    seedIVADemoCases().then(() => reload()).catch(() => {}).finally(() => setSeeding(false));
  }, [agentRole, hasIVACases, seeding, reload]);

  // Reset stage filter when switching workspace modes
  useEffect(() => {
    if (viewMode !== "iva") setIvaStageFilter("all_iva");
    if (viewMode !== "draft") setDraftStageFilter("all_draft");
    if (viewMode === "iva" || viewMode === "draft") setStatusFilter("all");
  }, [viewMode]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <DebtVergeNav
        appName={standaloneAppName}
        voipContext={{
          applicationSource: standaloneAppName,
          customerName: selectedCase?.debtor_name ?? null,
          customerReference: selectedCase?.case_number ?? null,
          caseNumber: selectedCase?.case_number ?? null,
          caseId: selectedCase?.id ?? null,
        }}
      />
      <div className="flex min-h-0 flex-1 gap-4 p-4">
      {/* Case List Sidebar */}
      <div className="flex w-64 shrink-0 flex-col sm:w-72">
        <div className="panel flex min-h-0 flex-1 flex-col p-3">
          <div className="mb-3 flex items-center justify-between">
            <button onClick={() => { setActiveCaseId(null); setShowTeam(false); }} className={`flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-bold transition-colors ${!selectedCase && !showTeam ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300" : "text-slate-800 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-700"}`} title="Home">
              <LayoutDashboard className="h-4 w-4" /> Home
            </button>
            <div className="flex items-center gap-1.5">
              {dvRole !== "advisor" && (
                <button onClick={() => { setActiveCaseId(null); setShowTeam(true); }} className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${showTeam && !selectedCase ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"}`} title="Team">
                  <Users className="h-4 w-4" />
                </button>
              )}
              <ChangeRequestsButton onOpenCase={(id) => setActiveCaseId(id)} />
              <ReferralsButton onAccepted={async (id) => { await reload(); setActiveCaseId(id); }} />
              <button onClick={() => setShowNewCase(true)} className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-600 text-white transition-colors hover:bg-emerald-700" title="New Case">
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Workspace View Toggle — DMP / IVA / All */}
          <div className="mb-2 flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
            {(canToggleView
              ? (["dmp", "iva", "all"] as WorkspaceViewMode[])
              : ([AGENT_ROLE_META[agentRole].defaultView] as WorkspaceViewMode[])
            ).map((vm) => (
              <button
                key={vm}
                onClick={() => setViewMode(vm)}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-bold transition-all ${
                  viewMode === vm
                    ? `${WORKSPACE_VIEW_META[vm].color} text-white shadow-sm`
                    : "text-slate-500 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-700"
                }`}
              >
                {vm === "dmp" && <LayoutDashboard className="h-3 w-3" />}
                {vm === "iva" && <Scale className="h-3 w-3" />}
                {vm === "all" && <Layers className="h-3 w-3" />}
                {WORKSPACE_VIEW_META[vm].label}
              </button>
            ))}
          </div>

          <div className="relative mb-2">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search cases..." className="input pl-8 text-xs" />
          </div>

          {viewMode === "iva" ? (
            <div className="mb-2 flex flex-wrap gap-1">
              {([
                { key: "all_iva", label: "All IVA" },
                { key: "proposal_draft", label: "Proposals in Draft" },
                { key: "meeting_called", label: "Meeting of Creditors" },
                { key: "active_supervision", label: "Active Supervision" },
                { key: "breach_notice", label: "In Breach / Transfer" },
              ] as const).map((stage) => (
                <button
                  key={stage.key}
                  onClick={() => setIvaStageFilter(stage.key)}
                  className={`rounded-full px-2 py-1 text-[10px] font-bold transition-all ${
                    ivaStageFilter === stage.key
                      ? "bg-violet-600 text-white shadow-sm"
                      : "bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-400"
                  }`}
                >
                  {stage.label}
                </button>
              ))}
            </div>
          ) : viewMode === "draft" ? (
            <div className="mb-2 flex flex-wrap gap-1">
              {([
                { key: "all_draft", label: "All Drafts" },
                { key: "proposal_drafting", label: "1. Proposal Drafting" },
                { key: "notice_issued", label: "2. Notice Issued" },
                { key: "moc_voting", label: "3. MOC Voting Open" },
                { key: "approved_handover", label: "4. Approved / Handover" },
              ] as const).map((stage) => (
                <button
                  key={stage.key}
                  onClick={() => setDraftStageFilter(stage.key)}
                  className={`rounded-full px-2 py-1 text-[10px] font-bold transition-all ${
                    draftStageFilter === stage.key
                      ? "bg-blue-600 text-white shadow-sm"
                      : "bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-400"
                  }`}
                >
                  {stage.label}
                </button>
              ))}
            </div>
          ) : (
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="input mb-2 text-xs">
              <option value="all">All Statuses</option>
              {Object.entries(STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto space-y-1.5">
            {loading ? (
              <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-16 rounded-lg" />)}</div>
            ) : filteredCases.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-slate-400">
                <Users className="mb-2 h-8 w-8 opacity-40" />
                <p className="text-xs">No cases found</p>
              </div>
            ) : (
              filteredCases.map((c) => {
                const meta = STATUS_META[c.status];
                const isActive = activeCaseId === c.id;
                const ivaStatus = deriveIVAStatus(c);
                const ivaMeta = ivaStatus ? IVA_STATUS_META[ivaStatus] : null;
                const isIVACase = c.plan_type === "iva";
                return (
                  <button
                    key={c.id}
                    onClick={() => { setShowTeam(false); setActiveCaseId(c.id); }}
                    className={`group w-full rounded-xl border p-2.5 text-left transition-all ${
                      isActive
                        ? isIVACase
                          ? "border-violet-500/50 bg-violet-50 dark:border-violet-500/30 dark:bg-violet-500/10"
                          : "border-emerald-500/50 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10"
                        : "border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-slate-600"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      <span className={`truncate text-xs font-bold ${isActive ? (isIVACase ? "text-violet-700 dark:text-violet-300" : "text-emerald-700 dark:text-emerald-300") : "text-slate-700 dark:text-slate-200"}`}>{c.case_number}</span>
                      {ivaMeta ? (
                        <span className={`flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${ivaMeta.color}`}>{ivaMeta.label}</span>
                      ) : (
                        <span className={`flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${meta.color}`}>{meta.icon}{meta.label.split(" ")[0]}</span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-sm font-medium text-slate-800 dark:text-slate-100">{c.debtor_name}</p>
                    <div className="mt-1 flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">{formatCurrency(c.total_debt, "GBP", { compact: true })}</span>
                      <span className={`text-[10px] font-medium ${isIVACase ? "text-violet-500 dark:text-violet-400" : "text-emerald-500 dark:text-emerald-400"}`}>{isIVACase ? "IVA" : c.plan_type.toUpperCase()}</span>
                    </div>
                    {c.next_due_date && (() => {
                      const days = Math.round((new Date(c.next_due_date).getTime() - new Date(new Date().toDateString()).getTime()) / 86400000);
                      const overdue = days < 0;
                      return (
                        <div className={`mt-1 flex items-center gap-1 text-[10px] font-medium ${overdue ? "text-rose-600 dark:text-rose-400" : days <= 7 ? "text-amber-600 dark:text-amber-400" : "text-slate-400"}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${overdue ? "bg-rose-500" : days <= 7 ? "bg-amber-500" : "bg-slate-300 dark:bg-slate-600"}`} />
                          {overdue ? `Payment ${Math.abs(days)}d overdue` : days === 0 ? "Payment due today" : `Next payment in ${days}d`}
                        </div>
                      );
                    })()}
                  </button>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        {/* Case header: identity on the left, three everyday actions and one menu on the right */}
        <div className="sticky top-0 z-20 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-slate-200 bg-white/95 px-4 py-2.5 backdrop-blur dark:border-slate-700 dark:bg-slate-800/95">
          {selectedCase ? (
            <>
              <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${standaloneAppName === "IVAVerge" ? "from-violet-600 to-violet-800" : standaloneAppName === "DraftVerge" ? "from-blue-600 to-blue-800" : "from-slate-700 to-slate-900"} text-white shadow-md`}>
                {standaloneAppName === "IVAVerge" ? <Gavel className="h-5 w-5" /> : standaloneAppName === "DraftVerge" ? <PenSquare className="h-5 w-5" /> : <Scale className="h-5 w-5" />}
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-sm font-bold text-slate-900 dark:text-slate-100">{selectedCase.debtor_name}</h2>
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="text-[11px] text-slate-400">{selectedCase.case_number}</p>
                  <button onClick={() => setShowPipelineSwitcher(true)} className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold text-white ${pipelineMeta.color} hover:opacity-90`} title="Switch solution pipeline">
                    {pipelineMeta.label} <ChevronDown className="h-2.5 w-2.5 opacity-70" />
                  </button>
                  {selectedCase.plan_type === "iva" && deriveIVAStatus(selectedCase) && (
                    <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${IVA_STATUS_META[deriveIVAStatus(selectedCase)!].color}`}>{IVA_STATUS_META[deriveIVAStatus(selectedCase)!].label}</span>
                  )}
                  <AssigneeControl caseData={selectedCase} onChanged={reload} />
                </div>
              </div>
              <div className="hidden items-center gap-4 md:flex">
                <div><p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">Debt</p><p className="text-sm font-bold text-rose-600 dark:text-rose-400">{formatCurrency(selectedCase.total_debt, "GBP", { compact: true })}</p></div>
                <div><p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">DI / month</p><p className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(selectedCase.monthly_disposable_income, "GBP", { compact: true })}</p></div>
              </div>
              {portalRole !== "advisor_ip" && (
                <button onClick={() => setPortalRole("advisor_ip")} className="flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-bold text-amber-800">
                  Previewing {PORTAL_ROLE_META[portalRole].label} <X className="h-3 w-3" />
                </button>
              )}
              <div className="flex items-center gap-1.5">
                <button onClick={() => setShowPaymentLink(true)} className="btn btn-primary bg-emerald-600 px-3 py-1.5 text-xs hover:bg-emerald-700" title="Create a no-login payment link for the client">
                  <Link2 className="h-3.5 w-3.5" /> Payment link
                </button>
                <VoipCallButton applicationSource={standaloneAppName || "DebtVerge"} caseData={selectedCase} variant="icon" className="px-2.5 py-1.5" />
                <IncomeCalcButton portal={standaloneAppName === "IVAVerge" ? "IVAVerge" : standaloneAppName === "DraftVerge" ? "DraftVerge" : "DebtVerge"} variant="icon" className="px-2.5 py-1.5" />
                <button onClick={() => setShowAIAssistant(true)} className="btn btn-secondary px-2.5 py-1.5 text-xs" title="Ask AI"><Sparkles className="h-3.5 w-3.5" /></button>
                <div className="relative">
                  <button onClick={() => setShowMoreMenu((v) => !v)} className="btn btn-secondary px-2.5 py-1.5 text-xs" title="More actions"><MoreHorizontal className="h-4 w-4" /></button>
                  {showMoreMenu && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setShowMoreMenu(false)} />
                      <div className="absolute right-0 top-full z-20 mt-1 w-64 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-800">
                        {([
                          { icon: <Send className="h-4 w-4" />, label: "Hand over to another platform", onClick: () => setShowHandOver(true), show: standaloneAppName === "DebtVerge" },
                          { icon: <ArrowLeftRight className="h-4 w-4" />, label: "Transfer / pivot solution", onClick: () => setShowPipelineSwitcher(true), show: true },
                          { icon: <Mail className="h-4 w-4" />, label: "Creditor offer packs", onClick: () => setShowOfferPack(true), show: true },
                          { icon: <Columns3 className="h-4 w-4" />, label: "Compare solutions (matrix)", onClick: () => setShowSolutionMatrix(true), show: true },
                          { icon: <Gavel className="h-4 w-4" />, label: "Escalate to IVAVerge", show: !!onTransferToIVAVerge, onClick: async () => { if (selectedCase.plan_type !== "iva") await transferSolution(selectedCase.id, "IVA", "Cross-app escalation to IVAVerge - formal insolvency required"); onTransferToIVAVerge?.(selectedCase.id); } },
                          { icon: <PenSquare className="h-4 w-4" />, label: "Escalate to DraftVerge", show: !!onTransferToDraftVerge, onClick: async () => { if (selectedCase.plan_type !== "iva") await transferSolution(selectedCase.id, "IVA", "Cross-app escalation to DraftVerge - IVA proposal drafting required"); onTransferToDraftVerge?.(selectedCase.id); } },
                          { icon: <Scale className="h-4 w-4" />, label: "Pivot to DebtVerge (DMP)", show: !!onTransferToDebtVerge, onClick: async () => { if (selectedCase.plan_type !== "dmp") await transferSolution(selectedCase.id, "DMP", "Cross-app pivot to DebtVerge - informal debt management appropriate"); onTransferToDebtVerge?.(selectedCase.id); } },
                        ] as { icon: React.ReactNode; label: string; onClick: () => void | Promise<void>; show: boolean }[]).filter((m) => m.show).map((m) => (
                          <button key={m.label} onClick={() => { setShowMoreMenu(false); void m.onClick(); }} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700">
                            {m.icon}{m.label}
                          </button>
                        ))}
                        <div className="my-1 border-t border-slate-100 dark:border-slate-700" />
                        <p className="px-3 pb-1 pt-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">Preview as</p>
                        {(Object.keys(PORTAL_ROLE_META) as DebtVergePortalRole[]).filter((r) => r !== "advisor_ip").map((r) => (
                          <button key={r} onClick={() => { setPortalRole(r); setShowMoreMenu(false); }} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700">
                            {PORTAL_ROLE_META[r].icon}{PORTAL_ROLE_META[r].label}
                          </button>
                        ))}
                        <div className="my-1 border-t border-slate-100 dark:border-slate-700" />
                        <button onClick={async () => { setShowMoreMenu(false); if (confirm(`Delete case ${selectedCase.case_number}? This cannot be undone.`)) { await deleteDebtCase(selectedCase.id); setActiveCaseId(null); reload(); } }} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10">
                          <Trash2 className="h-4 w-4" /> Delete case
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1">
              <h2 className="text-sm font-bold tracking-tight text-slate-900 dark:text-slate-100">{standaloneAppName === "IVAVerge" ? "IVA Verge" : standaloneAppName === "DraftVerge" ? "Draft Verge" : "Debt Verge"}</h2>
              <p className="text-[11px] text-slate-400">Select a case, or use Home for what needs doing today</p>
            </div>
          )}
          {!selectedCase && (
            <button onClick={() => setShowAIAssistant(true)} className="btn btn-secondary px-2.5 py-1.5 text-xs" title="Ask AI"><Sparkles className="h-3.5 w-3.5" /> Ask AI</button>
          )}
        </div>

        {selectedCase && (
          <CaseNextAction caseData={selectedCase} onSendLink={() => setShowPaymentLink(true)} onGoTab={(t) => setActiveTab(t as Tab)} />
        )}

        {/* Solution Suitability Matrix — overview/profile tabs only */}
        {selectedCase && suitabilityScores.length > 0 && showAssessmentWidgets && (
          <div>
            <button onClick={() => setShowSuitability((v) => !v)} className="flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-700 dark:text-slate-400">
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showSuitability ? "" : "-rotate-90"}`} /> Solution suitability
            </button>
            {showSuitability && <div className="mt-2"><SuitabilityMatrixBar scores={suitabilityScores} currentPipeline={currentPipeline} /></div>}
          </div>
        )}

        {/* Tabs: everyday tabs in the bar, the rest under "More" */}
        {(() => {
          const PRIMARY: Tab[] = ["dashboard", "diary", "documents", "profile", "intake", "ledger", "payment_schedule", "communications", "vulnerability"];
          const primary = tabsToShow.filter((t) => PRIMARY.includes(t));
          const more = tabsToShow.filter((t) => !PRIMARY.includes(t));
          const accent = standaloneAppName === "IVAVerge" ? "bg-violet-600 shadow-violet-600/20" : standaloneAppName === "DraftVerge" ? "bg-blue-600 shadow-blue-600/20" : "bg-emerald-600 shadow-emerald-600/20";
          const moreActive = more.includes(activeTab);
          const cls = (on: boolean) => `flex shrink-0 items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-all ${on ? `${accent} text-white shadow-sm` : "text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700"}`;
          return (
            <div className="relative flex shrink-0 items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-800">
              <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
                {primary.map((tabId) => (
                  <button key={tabId} onClick={() => setActiveTab(tabId)} className={cls(activeTab === tabId)}>{TAB_ICONS[tabId]}{PIPELINE_TAB_LABELS[tabId]}</button>
                ))}
              </div>
              {more.length > 0 && (
                <div className="relative shrink-0">
                  <button onClick={() => setShowTabMenu((v) => !v)} className={cls(moreActive)}>
                    {moreActive ? <>{TAB_ICONS[activeTab]}{PIPELINE_TAB_LABELS[activeTab]}</> : "More"} <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                  {showTabMenu && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setShowTabMenu(false)} />
                      <div className="absolute right-0 top-full z-20 mt-1 max-h-96 w-60 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-800">
                        {more.map((tabId) => (
                          <button key={tabId} onClick={() => { setActiveTab(tabId); setShowTabMenu(false); }} className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm ${activeTab === tabId ? "bg-emerald-50 font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300" : "text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700"}`}>
                            {TAB_ICONS[tabId]}{PIPELINE_TAB_LABELS[tabId]}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })()}

        {/* Tab Content — full-height workspace, independent scroll, zero double scrollbars */}
        <div
          className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden h-[calc(100vh-140px)] rounded-xl"
          data-tab={activeTab}
        >
          {portalRole === "debtor" && selectedCase ? (
            <DebtorSelfServiceView caseId={activeCaseId} caseData={selectedCase} />
          ) : portalRole === "creditor" && selectedCase ? (
            <CreditorPortalView caseId={activeCaseId} caseData={selectedCase} />
          ) : (
          <>
          {error && <div className="mb-3 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">{error}</div>}
          {!selectedCase && !showNewCase ? (
            showTeam ? <TeamScreen onOpenCase={(id) => { setShowTeam(false); setActiveCaseId(id); }} /> : <HomeScreen onOpenCase={(id) => setActiveCaseId(id)} onNewCase={() => setShowNewCase(true)} />
          ) : activeTab === "dashboard" ? (
            <DashboardTab caseId={activeCaseId} caseData={selectedCase} onTabChange={setActiveTab} appName={standaloneAppName} />
          ) : activeTab === "profile" ? (
            <CustomerProfileTab caseId={activeCaseId} caseData={selectedCase} onTabChange={setActiveTab} />
          ) : activeTab === "intake" ? (
            <SfsIntakeTab caseId={activeCaseId} caseData={selectedCase} />
          ) : activeTab === "diary" ? (
            <DiaryTab caseId={activeCaseId} caseData={selectedCase} />
          ) : activeTab === "documents" ? (
            <DocumentsTab caseId={activeCaseId} caseData={selectedCase} />
          ) : activeTab === "ledger" ? (
            <CreditorLedgerTab caseId={activeCaseId} caseData={selectedCase} />
          ) : activeTab === "forecast" ? (
            standaloneAppName === "IVAVerge"
              ? <IVASettlementForecast caseId={activeCaseId} caseData={selectedCase} />
              : <PayoffForecastTab caseId={activeCaseId} caseData={selectedCase} />
          ) : activeTab === "compare" ? (
            <PlanComparisonTab caseId={activeCaseId} caseData={selectedCase} />
          ) : activeTab === "disbursement" ? (
            <DisbursementTab caseId={activeCaseId} caseData={selectedCase} />
          ) : activeTab === "payment_gateway" ? (
            <PaymentGatewayModule caseId={activeCaseId} />
          ) : activeTab === "cashier_ops" ? (
            <CashierOperationsModule caseId={activeCaseId} />
          ) : activeTab === "payment_schedule" ? (
            <PaymentScheduleTab caseId={activeCaseId} caseData={selectedCase} />
          ) : activeTab === "vulnerability" ? (
            <VulnerabilityTab caseId={activeCaseId} caseData={selectedCase} />
          ) : activeTab === "compliance" ? (
            <ComplianceTab caseId={activeCaseId} caseData={selectedCase} />
          ) : activeTab === "nominee_proposal" ? (
            <NomineeProposalTab caseId={activeCaseId} caseData={selectedCase} />
          ) : activeTab === "interim_order" ? (
            <InterimOrderTab caseId={activeCaseId} caseData={selectedCase} />
          ) : activeTab === "moratorium" ? (
            <MoratoriumTab caseId={activeCaseId} caseData={selectedCase} />
          ) : activeTab === "ip_nominee" ? (
            <IPNomineeTab caseId={activeCaseId} />
          ) : activeTab === "document_checklist" ? (
            <DocumentChecklistTab caseId={activeCaseId} />
          ) : activeTab === "creditor_voting" ? (
            <div className="space-y-4">
              {standaloneAppName === "DraftVerge" && activeCase && (
                <div className={`panel border-2 p-4 ${mocThresholdMet ? "border-emerald-300 dark:border-emerald-500/40" : mocHasVotes ? "border-rose-300 dark:border-rose-500/40" : "border-slate-200 dark:border-slate-700"}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      {mocThresholdMet ? <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" /> : <AlertCircle className="h-5 w-5 text-rose-600 dark:text-rose-400" />}
                      <div>
                        <p className="text-sm font-bold text-slate-800 dark:text-slate-100">
                          {mocThresholdMet ? "MOC Approval Threshold Met" : mocHasVotes ? "MOC Voting in Progress" : "No Votes Recorded Yet"}
                        </p>
                        <p className="text-[11px] text-slate-400">
                          {mocHasVotes ? `${mocApprovalPct.toFixed(1)}% of claimed debt approved (75% required)` : "Add creditor votes in the matrix below to track approval"}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {mocThresholdMet && onTransferToIVAVerge && (
                        <button
                          onClick={async () => {
                            if (selectedCase) {
                              await addAuditMilestone(selectedCase.id, "MOC Approved", "75% creditor approval reached — handover to IVAVerge supervision");
                              await updateDebtCase(selectedCase.id, { status: "payment_schedule_active" });
                              reload();
                            }
                            onTransferToIVAVerge(activeCaseId ?? "");
                          }}
                          className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white shadow-sm transition-all hover:bg-emerald-700"
                        >
                          <CheckCircle2 className="h-4 w-4" />
                          <span className="hidden sm:inline">Complete MOC & Handover to IVAVerge</span>
                          <span className="sm:hidden">Handover</span>
                        </button>
                      )}
                      {mocHasVotes && !mocThresholdMet && onTransferToDebtVerge && (
                        <button
                          onClick={async () => {
                            if (selectedCase) {
                              await addAuditMilestone(selectedCase.id, "MOC Failed", "Creditor voting did not reach 75% threshold — pivot back to DebtVerge DMP");
                              await transferSolution(selectedCase.id, "DMP", "MOC rejected — returning to informal DMP management");
                            }
                            onTransferToDebtVerge(activeCaseId ?? "");
                          }}
                          className="flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-2 text-xs font-bold text-white shadow-sm transition-all hover:bg-rose-700"
                        >
                          <XCircle className="h-4 w-4" />
                          <span className="hidden sm:inline">Proposal Rejected — Pivot to DebtVerge</span>
                          <span className="sm:hidden">Reject</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}
              <CreditorVotingTab caseId={activeCaseId} />
            </div>
          ) : activeTab === "proof_of_debt" ? (
            <ProofOfDebtTab caseId={activeCaseId} />
          ) : activeTab === "pathfinder" ? (
            <PathfinderEngine />
          ) : activeTab === "proposal_generator" ? (
            <ProposalGenerator />
          ) : activeTab === "inflight" ? (
            <InflightCaseManagement />
          ) : activeTab === "breathing_space" ? (
            <BreathingSpaceTab caseId={activeCaseId} caseData={selectedCase} />
          ) : activeTab === "communications" ? (
            <TeamCommsWorkspace
              agentId="advisor"
              agentName="Sarah Jenkins"
              selectedCaseId={activeCaseId ?? null}
              onViewCaseRecord={() => setActiveTab("dashboard")}
            />
          ) : (
            <UnhandledTabState tabId={activeTab} onReset={() => setActiveTab("dashboard")} />
          )}
          </>
          )}
        </div>
      </div>

      <KnowledgeAssistantDrawer
        open={showAIAssistant}
        onClose={() => setShowAIAssistant(false)}
        library={standaloneAppName === "IVAVerge" ? "ivaverge" : standaloneAppName === "DraftVerge" ? "draftverge" : "debtverge"}
      />
      {showNewCase && <NewCaseModal onClose={() => setShowNewCase(false)} onCreated={async (id) => { await reload(); setActiveCaseId(id); setShowNewCase(false); }} />}
      {selectedCase && <PaymentLinkButton caseData={selectedCase} controlled={{ open: showPaymentLink, onClose: () => setShowPaymentLink(false) }} />}
      {selectedCase && <HandOverButton caseData={selectedCase} controlled={{ open: showHandOver, onClose: () => setShowHandOver(false) }} />}
      {showOfferPack && selectedCase && <OfferPackDrawer caseData={selectedCase} onClose={() => setShowOfferPack(false)} />}
      {showSolutionMatrix && selectedCase && (
        <SolutionSuitabilityMatrixModal caseData={selectedCase} caseId={activeCaseId} onClose={() => setShowSolutionMatrix(false)} />
      )}
      {showPipelineSwitcher && selectedCase && activeCase && (
        <PipelineSwitcherModal
          currentPipeline={currentPipeline}
          activeCase={activeCase}
          onSwitch={async (p, reason) => { await transferSolution(activeCaseId!, p, reason); setShowPipelineSwitcher(false); }}
          onClose={() => setShowPipelineSwitcher(false)}
        />
      )}
    </div>
    </div>
  );
}

// ============================================================
// Empty State
// ============================================================

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-slate-700 to-slate-900 text-white shadow-xl">
          <Scale className="h-8 w-8" />
        </div>
        <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">No Case Selected</h3>
        <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">Create a new debtor case to begin the intake process.</p>
        <button onClick={onNew} className="btn btn-primary bg-emerald-600 hover:bg-emerald-700">
          <Plus className="h-4 w-4" /> Create New Case
        </button>
      </div>
    </div>
  );
}

// ============================================================
// New Case Modal
// ============================================================

function NewCaseModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { organizationId } = useAuth();
  const [debtorName, setDebtorName] = useState("");
  const [debtorRef, setDebtorRef] = useState("");
  const [notes, setNotes] = useState("");
  const [caseNumber, setCaseNumber] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useMemo(() => { generateCaseNumber().then(setCaseNumber); }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!debtorName.trim()) return;
    setSaving(true); setErr(null);
    try {
      const newCase = await createDebtCase({ case_number: caseNumber, debtor_name: debtorName, debtor_reference: debtorRef, notes, organization_id: organizationId });
      await addAuditMilestone({ case_id: newCase.id, milestone: "Case Opened", description: `Case ${caseNumber} opened for ${debtorName}` });
      onCreated(newCase.id);
    } catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  }

  return (
    <Modal title="Create New Debt Case" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        {err && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">{err}</div>}
        <Field label="Case Number"><input value={caseNumber} readOnly className="input text-sm opacity-60" /></Field>
        <Field label="Debtor Name"><input value={debtorName} onChange={(e) => setDebtorName(e.target.value)} className="input text-sm" placeholder="John Smith" required autoFocus /></Field>
        <Field label="Debtor Reference (optional)"><input value={debtorRef} onChange={(e) => setDebtorRef(e.target.value)} className="input text-sm" placeholder="EXT-12345" /></Field>
        <Field label="Notes (optional)"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="input text-sm" rows={2} placeholder="Initial case notes..." /></Field>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn btn-secondary text-sm">Cancel</button>
          <button type="submit" disabled={saving} className="btn btn-primary bg-emerald-600 text-sm hover:bg-emerald-700">{saving ? "Creating..." : "Create Case"}</button>
        </div>
      </form>
    </Modal>
  );
}

// ============================================================
// Pipeline Switcher Modal
// ============================================================

// ============================================================
// Solution Suitability Matrix Header Widget
// ============================================================

function SuitabilityMatrixBar({ scores, currentPipeline }: { scores: SolutionSuitabilityScore[]; currentPipeline: DebtSolutionPipeline }) {
  if (scores.length === 0) return null;
  return (
    <div className="panel p-4 fade-in">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Columns3 className="h-4 w-4 text-blue-500" />
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Solution Suitability Matrix</h3>
          <span className="text-[10px] text-slate-400">Real-time eligibility scoring</span>
        </div>
        <span className="flex items-center gap-1 text-[10px] text-slate-400">
          <RefreshCw className="h-3 w-3" /> Auto-evaluated from SFS, debt & assets
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {scores.map((s) => {
          const vc = VERDICT_COLORS[s.verdict];
          const isActive = currentPipeline === s.pipeline;
          const meta = PIPELINE_META[s.pipeline];
          return (
            <div
              key={s.pipeline}
              className={`rounded-xl border-2 p-3 transition-all ${isActive ? "border-blue-500 ring-1 ring-blue-200 dark:ring-blue-500/20" : "border-slate-200 dark:border-slate-700"} ${vc.bg}`}
            >
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <div className={`flex h-6 w-6 items-center justify-center rounded-lg ${meta.color} text-white`}>
                    <Scale className="h-3 w-3" />
                  </div>
                  <span className={`text-xs font-bold ${vc.text}`}>{s.pipeline}</span>
                  {isActive && <span className="rounded-full bg-blue-600 px-1.5 py-0.5 text-[8px] font-bold text-white">ACTIVE</span>}
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${vc.badge}`}>{s.verdict.toUpperCase()}</span>
              </div>
              {/* Percentage bar */}
              <div className="mb-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${vc.bar}`}
                  style={{ width: `${s.percentage}%` }}
                />
              </div>
              <div className="flex items-baseline justify-between">
                <span className={`text-lg font-bold ${vc.text}`}>{s.percentage}%</span>
                <span className="text-[9px] text-slate-400">eligible</span>
              </div>
              {s.blockers.length > 0 && (
                <p className="mt-1.5 flex items-start gap-1 text-[10px] text-rose-500 dark:text-rose-400">
                  <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" /> {s.blockers[0]}
                </p>
              )}
              {s.blockers.length === 0 && s.reasons.length > 0 && (
                <p className="mt-1.5 flex items-start gap-1 text-[10px] text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" /> {s.reasons[0]}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// Enhanced Pipeline Switcher Modal with Data Carryover
// ============================================================

const TRANSITION_REASONS = [
  "Income Drop / Cannot Sustain IVA Contributions",
  "Failed Creditor Vote",
  "Increased Debt Load",
  "Client Preference",
  "SFS Disposable Income Recalculation",
  "Change in Personal Circumstances",
] as const;

const TARGET_SOLUTION_LABELS: Record<DebtSolutionPipeline, string> = {
  DMP: "Transition to DMP",
  IVA: "Escalate to IVA",
  DRO: "Request DRO Assessment",
  Settlement: "Move to Settlement",
};

function PipelineSwitcherModal({
  currentPipeline, activeCase, onSwitch, onClose,
}: {
  currentPipeline: DebtSolutionPipeline;
  activeCase: DebtVergeCaseMaster;
  onSwitch: (p: DebtSolutionPipeline, reason: string) => void;
  onClose: () => void;
}) {
  const [selectedPipeline, setSelectedPipeline] = useState<DebtSolutionPipeline | null>(null);
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [reasonChoice, setReasonChoice] = useState<string>("");
  const pipelines: DebtSolutionPipeline[] = ["DMP", "IVA", "DRO", "Settlement"];

  const fs = activeCase.financialStatement;
  const cad = activeCase.creditorsAndDebts;
  const cp = activeCase.customerProfile;

  const currentMeta = PIPELINE_META[currentPipeline];
  const currentStatusBadge = activeCase.solutionState.pipelineStatus
    ? activeCase.solutionState.pipelineStatus.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
    : "Active";

  const carryoverItems = [
    { icon: <Landmark className="h-4 w-4" />, label: "Creditor balances & account numbers", detail: `${cad.creditorCount} creditors · ${formatCurrency(cad.totalDebt)} total` },
    { icon: <FileCalc className="h-4 w-4" />, label: "SFS budget & disposable income", detail: `${fs.entries.length} entries · ${formatCurrency(fs.disposableIncome)}/mo DI` },
    { icon: <Users className="h-4 w-4" />, label: "Household composition", detail: `${cp.householdComposition.length} members` },
    { icon: <Network className="h-4 w-4" />, label: "Open Banking transaction data", detail: cp.openBankingData ? `${cp.openBankingData.totalImportedCount} transactions` : "No data imported" },
    { icon: <User className="h-4 w-4" />, label: "Customer profile & address history", detail: cp.currentAddress ?? "Address on file" },
    { icon: <ShieldAlert className="h-4 w-4" />, label: "Vulnerability & safeguarding records", detail: cp.vulnerabilities ? "Assessment on file" : "No assessment" },
  ];

  const pipelineTabs: Record<DebtSolutionPipeline, string[]> = {
    DMP: ["Pro-Rata Disbursement", "Fee Deductions", "Creditor Ledger", "Payoff Forecast"],
    IVA: ["Nominee Proposal Draft", "Creditor Voting Ledger", "Supervision & Review", "Compliance & Audit"],
    DRO: ["Interim Order Application", "Moratorium Status", "Eligibility Check", "Compliance & Audit"],
    Settlement: ["Offer Submission", "Negotiation Tracker", "Fund Distribution", "Payout Ledger"],
  };

  function handleReasonChange(value: string) {
    setReasonChoice(value);
    const combined = notes.trim()
      ? `${value} — ${notes.trim()}`
      : value;
    setReason(combined);
  }

  function handleNotesChange(value: string) {
    setNotes(value);
    const combined = value.trim()
      ? `${reasonChoice} — ${value.trim()}`
      : reasonChoice;
    setReason(combined);
  }

  function handleSelectPipeline(p: DebtSolutionPipeline) {
    setSelectedPipeline(p);
    const score = activeCase.solutionState.suitabilityScores.find((s) => s.pipeline === p);
    if (!reasonChoice) {
      const defaultReason = `Advisor converted case from ${currentPipeline} to ${p}${score ? ` (suitability: ${score.percentage}%)` : ""}`;
      setReason(defaultReason);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 fade-in" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 dark:bg-blue-500/10">
              <ArrowLeftRight className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Solution Transfer &amp; Transition</h3>
              <p className="text-xs text-slate-400">Pivot this case to a different insolvency solution</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"><X className="h-5 w-5" /></button>
        </div>

        {/* Current Solution Badge */}
        <div className="px-6 pt-5">
          <div className="flex items-center gap-3 rounded-xl border-2 p-4" style={{ borderColor: "rgb(148 163 184 / 0.3)" }}>
            <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${currentMeta.color} text-white shadow-md`}>
              <Scale className="h-6 w-6" />
            </div>
            <div className="flex-1">
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Current Solution</p>
              <div className="flex items-center gap-2">
                <span className="text-base font-bold text-slate-800 dark:text-slate-100">{currentPipeline}</span>
                <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${currentMeta.color} text-white`}>
                  {currentStatusBadge}
                </span>
              </div>
            </div>
            <ArrowRight className="h-5 w-5 text-slate-300 dark:text-slate-600" />
            <div className="min-w-[120px]">
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Target</p>
              <p className={`text-base font-bold ${selectedPipeline ? "text-blue-600 dark:text-blue-400" : "text-slate-300 dark:text-slate-600"}`}>
                {selectedPipeline ?? "Select below"}
              </p>
            </div>
          </div>
        </div>

        {/* Target Solution Selector */}
        <div className="p-6 pb-3">
          <h4 className="mb-3 text-xs font-bold uppercase text-slate-400">Select Target Solution</h4>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {pipelines.map((p) => {
              const meta = PIPELINE_META[p];
              const isActive = currentPipeline === p;
              const isSelected = selectedPipeline === p;
              const score = activeCase.solutionState.suitabilityScores.find((s) => s.pipeline === p);
              return (
                <button
                  key={p}
                  onClick={() => handleSelectPipeline(p)}
                  disabled={isActive}
                  className={`flex flex-col items-center gap-2 rounded-xl border-2 p-3 text-center transition-all disabled:opacity-50 ${
                    isSelected
                      ? "border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-500/5"
                      : isActive
                        ? "border-emerald-300 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/5"
                        : "border-slate-200 hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600"
                  }`}
                >
                  <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${meta.color} text-white`}>
                    <Scale className="h-5 w-5" />
                  </div>
                  <span className="text-sm font-bold text-slate-800 dark:text-slate-100">{meta.label}</span>
                  {isActive && <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[8px] font-bold text-white">CURRENT</span>}
                  {score && !isActive && (
                    <span className={`text-[10px] font-medium ${VERDICT_COLORS[score.verdict].text}`}>{score.percentage}% match</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Transition Details */}
        {selectedPipeline && selectedPipeline !== currentPipeline && (
          <div className="px-6 pb-6 fade-in space-y-4">
            {/* High-Contrast Transition Banner */}
            <div className="flex items-center justify-center gap-3 rounded-xl bg-gradient-to-r from-slate-700 to-slate-900 py-3 dark:from-slate-700 dark:to-slate-800">
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${currentMeta.color} text-white`}>{currentPipeline}</span>
              <ArrowRight className="h-4 w-4 text-white" />
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${PIPELINE_META[selectedPipeline].color} text-white`}>{selectedPipeline}</span>
              <span className="text-[10px] font-medium uppercase tracking-wide text-slate-300">{TARGET_SOLUTION_LABELS[selectedPipeline]}</span>
            </div>

            {/* Data Preserved Checklist */}
            <div>
              <h4 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase text-slate-400">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" /> Data Preserved on Transfer
              </h4>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {carryoverItems.map((item) => (
                  <div key={item.label} className="flex items-center gap-2 rounded-lg border border-slate-200 p-2.5 dark:border-slate-700">
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-slate-700 dark:text-slate-300">{item.label}</p>
                      <p className="text-[10px] text-slate-400">{item.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Tabs Activated */}
            <div>
              <h4 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase text-slate-400">
                <Layers className="h-3.5 w-3.5 text-blue-500" /> {selectedPipeline}-Specific Tabs Activated
              </h4>
              <div className="flex flex-wrap gap-2">
                {pipelineTabs[selectedPipeline].map((tab) => (
                  <span key={tab} className="rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-medium text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300">
                    {tab}
                  </span>
                ))}
              </div>
            </div>

            {/* Transition Reason Dropdown */}
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase text-slate-400">Transition Reason</label>
              <select
                value={reasonChoice}
                onChange={(e) => handleReasonChange(e.target.value)}
                className="input text-xs"
              >
                <option value="">— Select a reason —</option>
                {TRANSITION_REASONS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>

            {/* Transition Notes */}
            <div>
              <label className="mb-1.5 block text-xs font-bold uppercase text-slate-400">Transition Notes</label>
              <textarea
                value={notes}
                onChange={(e) => handleNotesChange(e.target.value)}
                rows={2}
                placeholder="Additional context for this transfer (e.g., client income dropped after redundancy, 2 missed payments)..."
                className="input text-xs"
              />
              <p className="mt-1 flex items-center gap-1 text-[10px] text-slate-400">
                <ScrollText className="h-3 w-3" /> This reason and notes will be recorded as an immutable audit event
              </p>
            </div>

            {/* Confirm Button */}
            <button
              onClick={() => onSwitch(selectedPipeline, reason || `Advisor converted case from ${currentPipeline} to ${selectedPipeline}`)}
              disabled={!reason && !reasonChoice}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 text-sm font-bold text-white shadow-lg transition-all hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ArrowLeftRight className="h-4 w-4" /> Confirm Solution Transfer: {currentPipeline} → {selectedPipeline}
            </button>
          </div>
        )}

        {/* Footer when no selection */}
        {(!selectedPipeline || selectedPipeline === currentPipeline) && (
          <div className="border-t border-slate-200 px-6 py-3 dark:border-slate-700">
            <p className="flex items-center justify-center gap-1.5 text-center text-[11px] text-slate-400">
              <ShieldCheck className="h-3 w-3 text-emerald-500" /> Switching solutions never erases case data — tabs &amp; tools adapt to the selected solution
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Pipeline-Specific Tab: Nominee Proposal (IVA)
// ============================================================

function NomineeProposalTab({ caseId, caseData }: { caseId: string | null; caseData: DebtCase | null }) {
  const { activeCase } = useDebtVergeCase();
  if (!caseId || !caseData) return <EmptyTabState icon={<Scale className="h-8 w-8" />} label="Select a case to view the Nominee Proposal" />;
  const fs = activeCase?.financialStatement;
  return (
    <div className="space-y-4 fade-in">
      <div className="panel p-5">
        <h3 className="mb-1 flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-100">
          <Scale className="h-4 w-4 text-violet-500" /> IVA Nominee Proposal
        </h3>
        <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">Draft and track the formal proposal to creditors supervised by a licensed Insolvency Practitioner (Nominee).</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <InfoBox label="Total Debt" value={caseData.total_debt ? formatCurrency(caseData.total_debt) : "—"} />
          <InfoBox label="Disposable Income" value={fs ? formatCurrency(fs.disposableIncome) : "—"} />
          <InfoBox label="Proposed Dividend" value={fs && caseData.total_debt > 0 ? `${Math.round((fs.disposableIncome * 60 / caseData.total_debt) * 100)}%` : "—"} />
          <InfoBox label="Term" value="60 months" />
        </div>
      </div>
      <div className="panel p-5">
        <h4 className="mb-3 text-sm font-bold text-slate-800 dark:text-slate-100">Proposal Stages</h4>
        <div className="space-y-2">
          {PIPELINE_STAGES.filter((s) => s.pipelines.includes("IVA")).map((stage, i) => (
            <div key={stage.stageId} className="flex items-center gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
              <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${i === 0 ? "bg-violet-500 text-white" : "bg-slate-200 text-slate-500 dark:bg-slate-700"}`}>{i + 1}</div>
              <span className="text-sm text-slate-700 dark:text-slate-300">{stage.stageLabel}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Pipeline-Specific Tab: Interim Order (DRO)
// ============================================================

function InterimOrderTab({ caseId, caseData }: { caseId: string | null; caseData: DebtCase | null }) {
  const { activeCase } = useDebtVergeCase();
  if (!caseId || !caseData) return <EmptyTabState icon={<Gavel className="h-8 w-8" />} label="Select a case to view the Interim Order" />;
  const fs = activeCase?.financialStatement;
  const eligible = (caseData.total_debt > 0 && caseData.total_debt <= 30000 && (fs?.disposableIncome ?? 0) <= 75);
  return (
    <div className="space-y-4 fade-in">
      <div className="panel p-5">
        <h3 className="mb-1 flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-100">
          <Gavel className="h-4 w-4 text-amber-500" /> DRO Interim Order Application
        </h3>
        <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">Apply for a Debt Relief Order via the Insolvency Service. An interim order grants a moratorium on creditor action.</p>
        <div className={`rounded-xl border-2 p-4 ${eligible ? "border-emerald-300 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10" : "border-amber-300 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10"}`}>
          <div className="flex items-center gap-2">
            {eligible ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <AlertCircle className="h-5 w-5 text-amber-600" />}
            <span className={`text-sm font-bold ${eligible ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}`}>
              {eligible ? "Eligibility Check Passed" : "Eligibility Check — Review Required"}
            </span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
            <InfoBox label="Total Debt" value={formatCurrency(caseData.total_debt)} sub={caseData.total_debt <= 30000 ? "Under £30k limit" : "EXCEEDS £30k limit"} />
            <InfoBox label="Disposable Income" value={fs ? formatCurrency(fs.disposableIncome) : "—"} sub={(fs?.disposableIncome ?? 0) <= 75 ? "Under £75/mo limit" : "EXCEEDS £75/mo limit"} />
            <InfoBox label="Asset Test" value="—" sub="Verify assets < £2,000" />
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Pipeline-Specific Tab: Moratorium Status (DRO)
// ============================================================

function MoratoriumTab({ caseId, caseData }: { caseId: string | null; caseData: DebtCase | null }) {
  if (!caseId || !caseData) return <EmptyTabState icon={<ShieldCheck className="h-8 w-8" />} label="Select a case to view Moratorium Status" />;
  return (
    <div className="space-y-4 fade-in">
      <div className="panel p-5">
        <h3 className="mb-1 flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-100">
          <ShieldCheck className="h-4 w-4 text-amber-500" /> Debt Relief Moratorium
        </h3>
        <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">Track the 12-month moratorium period during which creditors cannot pursue enforcement action.</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <InfoBox label="Moratorium Start" value="Pending" />
          <InfoBox label="Moratorium End" value="Pending" />
          <InfoBox label="Status" value="Not Started" />
        </div>
      </div>
      <div className="panel p-5">
        <h4 className="mb-3 text-sm font-bold text-slate-800 dark:text-slate-100">Morimeline Timeline</h4>
        <div className="flex items-center gap-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">
          <Clock className="h-4 w-4 text-amber-500" />
          Once the interim order is granted, the moratorium begins and lasts for 12 months. Creditors are legally barred from recovery action during this period.
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Shared Small Components
// ============================================================

function InfoBox({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <p className="text-[10px] uppercase text-slate-400">{label}</p>
      <p className="text-sm font-bold text-slate-700 dark:text-slate-200">{value}</p>
      {sub && <p className="mt-0.5 text-[10px] text-slate-400">{sub}</p>}
    </div>
  );
}

function EmptyTabState({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-slate-400">
      <div className="mb-2 opacity-30">{icon}</div>
      <p className="text-sm">{label}</p>
    </div>
  );
}

// ============================================================
// Case Overview: one scannable page for a single case, from real data only
// ============================================================

function CaseOverview({ caseData, creditors, distributions, auditLog, onTabChange }: {
  caseData: DebtCase;
  creditors: DebtCreditor[];
  distributions: DebtDistribution[];
  auditLog: DebtAuditEntry[];
  onTabChange: (t: Tab) => void;
}) {
  const { data: payments } = useDebtPayments(caseData.id);
  const { data: sfs } = useDebtSfsEntries(caseData.id);

  const paid = payments.reduce((s, p) => s + Number(p.amount ?? 0), 0);
  const left = Math.max(caseData.total_debt - paid, 0);
  const pct = caseData.total_debt > 0 ? Math.min(100, Math.round((paid / caseData.total_debt) * 100)) : 0;
  const monthly = Number(caseData.installment_amount ?? 0);
  const monthsLeft = monthly > 0 ? Math.ceil(left / monthly) : null;
  const dueIn = caseData.next_due_date ? Math.round((new Date(caseData.next_due_date).getTime() - new Date(new Date().toDateString()).getTime()) / 86400000) : null;

  const sum = (cat: DebtSfsCategory) => sfs.filter((e) => e.category === cat).reduce((s, e) => s + Number(e.amount ?? 0), 0);
  const income = sum("income");
  const essential = sum("essential_expense");
  const discretionary = sum("discretionary_expense");
  const repayments = sum("debt_repayment");
  const disposable = income - essential - discretionary - repayments;

  const totalBalance = creditors.reduce((s, c) => s + Number(c.current_balance ?? 0), 0);
  const upcoming = distributions.filter((d) => d.status === "scheduled" && new Date(d.distribution_date) >= new Date()).slice(0, 3);
  const recentPayments = [...payments].sort((a, b) => b.payment_date.localeCompare(a.payment_date)).slice(0, 5);

  const Stat = ({ label, value, sub, tone = "" }: { label: string; value: string; sub?: string; tone?: string }) => (
    <div className="panel p-4">
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1.5 text-2xl font-bold text-slate-900 dark:text-slate-100 ${tone}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p>}
    </div>
  );
  const Head = ({ title, tab, link }: { title: string; tab?: Tab; link?: string }) => (
    <div className="mb-3 flex items-center justify-between">
      <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">{title}</h3>
      {tab && <button onClick={() => onTabChange(tab)} className="text-xs font-semibold text-emerald-600 hover:underline">{link ?? "Open"}</button>}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat label="Total debt" value={formatCurrency(caseData.total_debt, "GBP")} sub={`${creditors.length} creditor${creditors.length === 1 ? "" : "s"}`} />
        <Stat label="Paid so far" value={formatCurrency(paid, "GBP")} sub={`${pct}% of the debt`} tone="text-emerald-600" />
        <Stat label="Left to pay" value={formatCurrency(left, "GBP")} sub={monthsLeft ? `About ${monthsLeft} month${monthsLeft === 1 ? "" : "s"} at the current payment` : undefined} />
        <Stat label="Monthly payment" value={monthly ? formatCurrency(monthly, "GBP") : "Not set"} sub={caseData.next_due_date ? (dueIn !== null && dueIn < 0 ? `Overdue since ${formatDateShort(caseData.next_due_date)}` : `Next due ${formatDateShort(caseData.next_due_date)}`) : undefined} tone={dueIn !== null && dueIn < 0 ? "text-rose-600" : ""} />
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700" title={`${pct}% paid`}>
        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="panel p-4">
          <Head title="Creditors" tab="ledger" link="Open ledger" />
          {creditors.length === 0 ? <p className="py-6 text-center text-xs text-slate-400">No creditors added yet</p> : (
            <div className="space-y-2.5">
              {[...creditors].sort((a, b) => b.current_balance - a.current_balance).map((c) => (
                <div key={c.id}>
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{c.creditor_name} {c.is_priority && <span className="ml-1 rounded bg-amber-100 px-1 text-[9px] font-bold text-amber-700">PRIORITY</span>}</p>
                    <p className="shrink-0 text-sm font-bold text-slate-800 dark:text-slate-100">{formatCurrency(c.current_balance, "GBP")}</p>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700"><div className="h-full rounded-full bg-blue-500" style={{ width: `${totalBalance ? (c.current_balance / totalBalance) * 100 : 0}%` }} /></div>
                    <span className="w-20 shrink-0 text-right text-[10px] text-slate-400">{DEBT_TYPE_META[c.debt_type].label}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="panel p-4">
          <Head title="Monthly budget" tab="intake" link="Open budget" />
          {sfs.length === 0 ? <p className="py-6 text-center text-xs text-slate-400">No budget entered yet</p> : (
            <div className="space-y-2 text-sm">
              {[
                ["Income", income, "text-emerald-600"],
                ["Essential spending", -essential, ""],
                ["Other spending", -discretionary, ""],
                ["Debt repayments", -repayments, ""],
              ].map(([l, v, t]) => (
                <div key={l as string} className="flex items-center justify-between">
                  <span className="text-slate-600 dark:text-slate-300">{l as string}</span>
                  <span className={`font-semibold ${t as string}`}>{formatCurrency(v as number, "GBP")}</span>
                </div>
              ))}
              <div className="flex items-center justify-between border-t border-slate-100 pt-2 dark:border-slate-700">
                <span className="font-bold text-slate-800 dark:text-slate-100">Disposable income</span>
                <span className={`text-lg font-bold ${disposable >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{formatCurrency(disposable, "GBP")}</span>
              </div>
            </div>
          )}
        </div>

        <div className="panel p-4">
          <Head title="Payments" tab="payment_schedule" link="Open payments" />
          {recentPayments.length === 0 ? <p className="py-6 text-center text-xs text-slate-400">No payments received yet</p> : (
            <div className="space-y-1.5">
              {recentPayments.map((p) => (
                <div key={p.id} className="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm odd:bg-slate-50 dark:odd:bg-slate-800/60">
                  <span className="text-slate-500">{formatDateShort(p.payment_date)}</span>
                  {p.is_shortfall
                    ? <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-bold text-rose-700">Missed {formatCurrency(Number(p.shortfall_amount ?? 0), "GBP")}</span>
                    : <span className="font-semibold text-slate-800 dark:text-slate-100">{formatCurrency(Number(p.amount), "GBP")}</span>}
                </div>
              ))}
            </div>
          )}
          {upcoming.length > 0 && (
            <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-700">
              <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">Next payouts to creditors</p>
              {upcoming.map((d) => (
                <div key={d.id} className="flex items-center justify-between py-0.5 text-xs text-slate-600 dark:text-slate-300">
                  <span className="truncate">{creditors.find((c) => c.id === d.creditor_id)?.creditor_name ?? "Creditor"} · {formatDateShort(d.distribution_date)}</span>
                  <span className="font-semibold">{formatCurrency(d.amount, "GBP")}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="panel p-4">
          <Head title="Timeline" tab="compliance" link="Full history" />
          {auditLog.length === 0 ? <p className="py-6 text-center text-xs text-slate-400">No activity yet</p> : (
            <ol className="relative space-y-3 border-l border-slate-200 pl-4 dark:border-slate-700">
              {auditLog.slice(0, 6).map((e) => (
                <li key={e.id} className="relative">
                  <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full border-2 border-white bg-emerald-500 dark:border-slate-900" />
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{e.milestone}</p>
                  {e.description && <p className="line-clamp-2 text-xs text-slate-500 dark:text-slate-400">{e.description}</p>}
                  <p className="text-[10px] text-slate-400">{formatDateShort(e.created_at)}</p>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}


const TENURE_TYPE_OPTIONS: { value: DebtTenureType; label: string }[] = [
  { value: "owned", label: "Owned" },
  { value: "private_rented", label: "Private Rented" },
  { value: "social_rented", label: "Social Rented" },
  { value: "council", label: "Council" },
  { value: "leased", label: "Leased" },
  { value: "living_with_family", label: "Living with Family/Parents" },
];

function ProfileField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">{label}</label>
      {children}
    </div>
  );
}

function FoldCard({ title, icon, saved, summary, defaultOpen, children }: { title: React.ReactNode; icon: React.ReactNode; saved?: React.ReactNode; summary: string; defaultOpen: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="panel p-5 fade-in">
      <button onClick={() => setOpen((v) => !v)} className={`flex w-full items-center justify-between gap-3 text-left ${open ? "mb-4" : ""}`}>
        <span className="flex min-w-0 items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-100">
          {icon}
          <span className="flex items-center gap-2">{title}</span>
          {!open && <span className="ml-2 truncate text-xs font-normal text-slate-400">{summary}</span>}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {saved}
          <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${open ? "" : "-rotate-90"}`} />
        </span>
      </button>
      {open && children}
    </div>
  );
}

// ============================================================
// Dashboard Tab
// ============================================================

function DashboardTab({ caseId, caseData, onTabChange, appName = "DebtVerge" }: { caseId: string | null; caseData: DebtCase | null; onTabChange: (t: Tab) => void; appName?: string }) {
  const { data: allCases } = useDebtCases();
  const { data: creditors } = useDebtCreditors(caseId);
  const { data: distributions } = useDebtDistributions(caseId);
  const { data: auditLog } = useDebtAuditLog(caseId);

  // Portfolio KPIs across all cases
  const activeCases = allCases.filter((c) => !["closed", "completed"].includes(c.status));
  const totalDebtManaged = allCases.reduce((s, c) => s + c.total_debt, 0);
  const totalDisposable = allCases.reduce((s, c) => s + c.monthly_disposable_income, 0);
  const recoveryRate = totalDebtManaged > 0 ? Math.min(100, (totalDisposable / totalDebtManaged) * 100 * 12) : 0;
  const upcomingDistributions = distributions.filter((d) => d.status === "scheduled" && new Date(d.distribution_date) >= new Date());

  if (!caseData) return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={<Users className="h-4 w-4" />} label="Active Cases" value={String(activeCases.length)} sub={`${allCases.length} total cases`} accent="text-blue-600 bg-blue-50 dark:bg-blue-500/10" />
        <KpiCard icon={<Wallet className="h-4 w-4" />} label="Total Debt Under Management" value={formatCurrency(totalDebtManaged, "GBP", { compact: true })} sub={`Avg ${allCases.length > 0 ? formatCurrency(totalDebtManaged / allCases.length, "GBP", { compact: true }) : "$0"} / case`} accent="text-rose-600 bg-rose-50 dark:bg-rose-500/10" />
        <KpiCard icon={<TrendingDown className="h-4 w-4" />} label="Monthly Collection Recovery" value={`${recoveryRate.toFixed(1)}%`} sub={`${formatCurrency(totalDisposable, "GBP", { compact: true })} monthly disposable`} accent="text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10" />
        <KpiCard icon={<Calendar className="h-4 w-4" />} label="Upcoming Distributions" value={String(upcomingDistributions.length)} sub="None scheduled" accent="text-amber-600 bg-amber-50 dark:bg-amber-500/10" />
      </div>
      <div className="panel flex flex-col items-center justify-center py-12 text-slate-400">
        <Scale className="mb-3 h-10 w-10 opacity-30" />
        <p className="text-sm">Select a case from the sidebar or create a new one to get started</p>
      </div>
    </div>
  );

  return <CaseOverview caseData={caseData} creditors={creditors} distributions={distributions} auditLog={auditLog} onTabChange={onTabChange} />;
}

function CustomerProfileTab({ caseId, caseData, onTabChange }: { caseId: string | null; caseData: DebtCase | null; onTabChange: (tab: string) => void }) {
  const { data: profile, loading, reload } = useDebtCustomerProfile(caseId);
  const { data: prevAddresses, reload: reloadPrev } = useDebtPreviousAddresses(caseId);

  const [actionError, setActionError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [showPrevAddresses, setShowPrevAddresses] = useState(false);
  const [newPrevAddress, setNewPrevAddress] = useState("");
  const [newPrevTime, setNewPrevTime] = useState("");
  const [autoSavedFields, setAutoSavedFields] = useState<Set<string>>(new Set());

  // Form state — initialized from profile data when it loads
  const [fullName, setFullName] = useState("");
  const [primaryEmail, setPrimaryEmail] = useState("");
  const [landlinePhone, setLandlinePhone] = useState("");
  const [mobilePhone, setMobilePhone] = useState("");
  const [workPhone, setWorkPhone] = useState("");
  const [addressStreet, setAddressStreet] = useState("");
  const [addressCity, setAddressCity] = useState("");
  const [addressPostcode, setAddressPostcode] = useState("");
  const [timeYears, setTimeYears] = useState("0");
  const [timeMonths, setTimeMonths] = useState("0");
  const [householdAdults, setHouseholdAdults] = useState("1");
  const [householdChildrenU16, setHouseholdChildrenU16] = useState("0");
  const [householdChildren16_18, setHouseholdChildren16_18] = useState("0");
  const [tenureType, setTenureType] = useState<DebtTenureType | "">("");
  const [propertyValue, setPropertyValue] = useState("");
  const [outstandingMortgage, setOutstandingMortgage] = useState("");
  const [monthlyRentMortgage, setMonthlyRentMortgage] = useState("");
  const [landlordLenderName, setLandlordLenderName] = useState("");

  // Sync form state when profile loads
  useEffect(() => {
    if (profile) {
      setFullName(profile.full_name ?? "");
      setPrimaryEmail(profile.primary_email ?? "");
      setLandlinePhone(profile.landline_phone ?? "");
      setMobilePhone(profile.mobile_phone ?? "");
      setWorkPhone(profile.work_phone ?? "");
      setAddressStreet(profile.address_street ?? "");
      setAddressCity(profile.address_city ?? "");
      setAddressPostcode(profile.address_postcode ?? "");
      setTimeYears(String(profile.time_at_address_years));
      setTimeMonths(String(profile.time_at_address_months));
      setHouseholdAdults(String(profile.household_adults));
      setHouseholdChildrenU16(String(profile.household_children_under_16));
      setHouseholdChildren16_18(String(profile.household_children_16_to_18));
      setTenureType(profile.tenure_type ?? "");
      setPropertyValue(profile.property_value ? String(profile.property_value) : "");
      setOutstandingMortgage(profile.outstanding_mortgage_or_rent ? String(profile.outstanding_mortgage_or_rent) : "");
      setMonthlyRentMortgage(profile.monthly_rent_or_mortgage ? String(profile.monthly_rent_or_mortgage) : "");
      setLandlordLenderName(profile.landlord_lender_name ?? "");
    }
  }, [profile]);

  // SFS allowance thresholds derived from household composition
  const sfsThresholds = useMemo(() => getSfsAllowanceThresholds(profile), [profile]);
  const totalMonthsAtAddress = (parseInt(timeYears) || 0) * 12 + (parseInt(timeMonths) || 0);
  const needsPreviousAddresses = totalMonthsAtAddress < 36;

  async function handleSaveSection(fields: string, patch: Partial<DebtCustomerProfile>) {
    if (!caseId) return;
    setActionError(null);
    try {
      await upsertDebtCustomerProfile(caseId, patch);
      setAutoSavedFields((prev) => new Set(prev).add(fields));
      setTimeout(() => setAutoSavedFields((prev) => { const next = new Set(prev); next.delete(fields); return next; }), 2500);
      reload();
    } catch (e) { setActionError((e as Error).message); }
  }

  async function handleSaveAll() {
    if (!caseId) return;
    setActionError(null);
    try {
      await upsertDebtCustomerProfile(caseId, {
        full_name: fullName || null,
        primary_email: primaryEmail || null,
        landline_phone: landlinePhone || null,
        mobile_phone: mobilePhone || null,
        work_phone: workPhone || null,
        address_street: addressStreet || null,
        address_city: addressCity || null,
        address_postcode: addressPostcode || null,
        time_at_address_years: parseInt(timeYears) || 0,
        time_at_address_months: parseInt(timeMonths) || 0,
        household_adults: parseInt(householdAdults) || 1,
        household_children_under_16: parseInt(householdChildrenU16) || 0,
        household_children_16_to_18: parseInt(householdChildren16_18) || 0,
        tenure_type: (tenureType || null) as DebtTenureType | null,
        property_value: propertyValue ? parseFloat(propertyValue) : null,
        outstanding_mortgage_or_rent: outstandingMortgage ? parseFloat(outstandingMortgage) : null,
        monthly_rent_or_mortgage: monthlyRentMortgage ? parseFloat(monthlyRentMortgage) : null,
        landlord_lender_name: landlordLenderName || null,
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      reload();
    } catch (e) { setActionError((e as Error).message); }
  }

  async function handleAddPrevAddress(e: React.FormEvent) {
    e.preventDefault();
    if (!caseId || !newPrevAddress.trim()) return;
    setActionError(null);
    try {
      await createDebtPreviousAddress({
        case_id: caseId,
        address_line: newPrevAddress,
        time_at_address: newPrevTime || undefined,
      });
      setNewPrevAddress(""); setNewPrevTime("");
      reloadPrev();
    } catch (e) { setActionError((e as Error).message); }
  }

  async function handleDeletePrevAddress(id: string) {
    setActionError(null);
    try {
      await deleteDebtPreviousAddress(id);
      reloadPrev();
    } catch (e) { setActionError((e as Error).message); }
  }

  if (!caseData) {
    return <div className="flex h-full items-center justify-center text-sm text-slate-400">Select a case to view customer profile</div>;
  }

  if (loading) {
    return <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-40 rounded-xl" />)}</div>;
  }

  return (
    <div className="space-y-4">
      {actionError && <div className="rounded-xl bg-rose-50 px-4 py-2 text-sm text-rose-700 dark:bg-rose-500/20 dark:text-rose-300 fade-in">{actionError}</div>}
      {saveSuccess && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300 fade-in">
          <CheckCircle2 className="h-4 w-4" /> Profile saved successfully
        </div>
      )}

      {/* Header */}
      <div className="panel flex flex-wrap items-center justify-between gap-3 p-4 fade-in">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 dark:bg-blue-500/10">
            <User className="h-5 w-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Customer Profile & Household</h3>
            <p className="text-xs text-slate-400">Personal details, address history, household composition, and property information</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onTabChange("communications")}
            className="btn btn-secondary text-sm"
            title="Open communications workspace for this client"
          >
            <MessageSquare className="h-4 w-4" /> Message Client
          </button>
          <button onClick={handleSaveAll} className="btn btn-primary bg-emerald-600 text-sm hover:bg-emerald-700">
            <Save className="h-4 w-4" /> Save All Changes
          </button>
        </div>
      </div>

      {/* SFS Allowance Preview Banner */}
      <div className="panel flex flex-wrap items-center gap-4 p-4 fade-in">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-teal-50 dark:bg-teal-500/10">
          <Calculator className="h-5 w-5 text-teal-600 dark:text-teal-400" />
        </div>
        <div className="flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">SFS Allowance Thresholds (Auto-Calculated from Household)</p>
          <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">
            {sfsThresholds.totalHousehold} household members ({sfsThresholds.totalAdults} adults, {sfsThresholds.totalChildren} children) —
            Guideline monthly allowance: <span className="font-bold text-teal-600 dark:text-teal-400">{formatCurrency(sfsThresholds.totalMonthlyAllowance)}</span>
          </p>
        </div>
        <details className="w-full text-xs"><summary className="cursor-pointer font-semibold text-emerald-600">Show allowance breakdown</summary>
        <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <div className="rounded-lg bg-slate-50 px-3 py-1.5 text-center dark:bg-slate-800">
            <p className="text-slate-400">Groceries</p>
            <p className="font-bold text-slate-700 dark:text-slate-200">{formatCurrency(sfsThresholds.groceryAllowance)}</p>
          </div>
          <div className="rounded-lg bg-slate-50 px-3 py-1.5 text-center dark:bg-slate-800">
            <p className="text-slate-400">Transport</p>
            <p className="font-bold text-slate-700 dark:text-slate-200">{formatCurrency(sfsThresholds.transportAllowance)}</p>
          </div>
          <div className="rounded-lg bg-slate-50 px-3 py-1.5 text-center dark:bg-slate-800">
            <p className="text-slate-400">Utilities</p>
            <p className="font-bold text-slate-700 dark:text-slate-200">{formatCurrency(sfsThresholds.utilitiesAllowance)}</p>
          </div>
          <div className="rounded-lg bg-slate-50 px-3 py-1.5 text-center dark:bg-slate-800">
            <p className="text-slate-400">Clothing</p>
            <p className="font-bold text-slate-700 dark:text-slate-200">{formatCurrency(sfsThresholds.clothingAllowance)}</p>
          </div>
        </div>
        </details>
      </div>

      {/* Card 1: Personal & Contact Information */}
      <FoldCard title={<>Personal & Contact Information</>} icon={<span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 dark:bg-blue-500/10"><User className="h-4 w-4 text-blue-600 dark:text-blue-400" /></span>} saved={autoSavedFields.has("personal") && <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 fade-in"><Check className="h-3 w-3" /> Saved</span>} summary={`${[mobilePhone, primaryEmail].filter(Boolean).join(" · ") || "No contact details yet"}`} defaultOpen={true}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <ProfileField label="Full Name">
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} onBlur={() => handleSaveSection("personal", { full_name: fullName || null })} className="input text-sm" placeholder="John Smith" />
          </ProfileField>
          <ProfileField label="Primary Email Address">
            <input type="email" value={primaryEmail} onChange={(e) => setPrimaryEmail(e.target.value)} onBlur={() => handleSaveSection("personal", { primary_email: primaryEmail || null })} className="input text-sm" placeholder="john.smith@email.com" />
          </ProfileField>
          <ProfileField label="Landline Number">
            <input value={landlinePhone} onChange={(e) => setLandlinePhone(e.target.value)} onBlur={() => handleSaveSection("personal", { landline_phone: landlinePhone || null })} className="input text-sm" placeholder="020 7946 0958" />
          </ProfileField>
          <ProfileField label="Mobile Number">
            <input value={mobilePhone} onChange={(e) => setMobilePhone(e.target.value)} onBlur={() => handleSaveSection("personal", { mobile_phone: mobilePhone || null })} className="input text-sm" placeholder="07700 900123" />
          </ProfileField>
          <ProfileField label="Work Contact Number">
            <input value={workPhone} onChange={(e) => setWorkPhone(e.target.value)} onBlur={() => handleSaveSection("personal", { work_phone: workPhone || null })} className="input text-sm" placeholder="020 7946 0959" />
          </ProfileField>
        </div>
      
      </FoldCard>

      {/* Card 2: Address History & Residency */}
      <FoldCard title={<>Address History & Residency</>} icon={<span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-500/10"><MapPin className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /></span>} saved={autoSavedFields.has("address") && <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 fade-in"><Check className="h-3 w-3" /> Saved</span>} summary={`${[addressStreet, addressCity].filter(Boolean).join(", ") || "No address yet"}`} defaultOpen={true}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <ProfileField label="Street Address">
            <input value={addressStreet} onChange={(e) => setAddressStreet(e.target.value)} onBlur={() => handleSaveSection("address", { address_street: addressStreet || null })} className="input text-sm" placeholder="123 High Street" />
          </ProfileField>
          <ProfileField label="City">
            <input value={addressCity} onChange={(e) => setAddressCity(e.target.value)} onBlur={() => handleSaveSection("address", { address_city: addressCity || null })} className="input text-sm" placeholder="Manchester" />
          </ProfileField>
          <ProfileField label="Postcode">
            <input value={addressPostcode} onChange={(e) => setAddressPostcode(e.target.value)} onBlur={() => handleSaveSection("address", { address_postcode: addressPostcode || null })} className="input text-sm" placeholder="M1 1AA" />
          </ProfileField>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <ProfileField label="Time at Address (Years)">
            <input type="number" min="0" value={timeYears} onChange={(e) => setTimeYears(e.target.value)} onBlur={() => handleSaveSection("address", { time_at_address_years: parseInt(timeYears) || 0 })} className="input text-sm" />
          </ProfileField>
          <ProfileField label="Time at Address (Months)">
            <input type="number" min="0" max="11" value={timeMonths} onChange={(e) => setTimeMonths(e.target.value)} onBlur={() => handleSaveSection("address", { time_at_address_months: parseInt(timeMonths) || 0 })} className="input text-sm" />
          </ProfileField>
          <div className="col-span-2 flex items-end">
            {needsPreviousAddresses ? (
              <div className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                <AlertCircle className="h-4 w-4 shrink-0" />
                Under 3 years at current address — previous address history required
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                3+ years at current address — no previous addresses needed
              </div>
            )}
          </div>
        </div>

        {/* Previous Addresses Accordion */}
        <div className="mt-4 border-t border-slate-100 pt-4 dark:border-slate-700/50">
          <button
            onClick={() => setShowPrevAddresses(!showPrevAddresses)}
            className="flex w-full items-center justify-between text-sm font-medium text-slate-600 dark:text-slate-300"
          >
            <span className="flex items-center gap-2">
              <History className="h-4 w-4 text-slate-400" />
              Previous Addresses ({prevAddresses.length})
              {needsPreviousAddresses && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:bg-amber-500/20 dark:text-amber-400">Required</span>}
            </span>
            {showPrevAddresses ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {showPrevAddresses && (
            <div className="mt-3 space-y-2 fade-in">
              {prevAddresses.map((addr) => (
                <div key={addr.id} className="group flex items-center gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                  <MapPin className="h-4 w-4 shrink-0 text-slate-400" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{addr.address_line}</p>
                    {addr.time_at_address && <p className="text-xs text-slate-400">{addr.time_at_address}</p>}
                  </div>
                  <button onClick={() => handleDeletePrevAddress(addr.id)} className="rounded-lg p-1.5 text-slate-300 opacity-0 transition-opacity hover:bg-rose-50 hover:text-rose-500 group-hover:opacity-100 dark:hover:bg-rose-500/10">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              <form onSubmit={handleAddPrevAddress} className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <input value={newPrevAddress} onChange={(e) => setNewPrevAddress(e.target.value)} placeholder="Previous address line" className="input text-sm sm:col-span-2" required />
                <div className="flex gap-2">
                  <input value={newPrevTime} onChange={(e) => setNewPrevTime(e.target.value)} placeholder="Duration (e.g. 2y 6m)" className="input text-sm" />
                  <button type="submit" className="btn btn-primary bg-emerald-600 text-sm hover:bg-emerald-700"><Plus className="h-4 w-4" /></button>
                </div>
              </form>
              {prevAddresses.length === 0 && <p className="text-xs text-slate-400">No previous addresses added yet</p>}
            </div>
          )}
        </div>
      
      </FoldCard>

      {/* Card 3: Household Composition */}
      <FoldCard title={<>Household Composition
            <span className="rounded-full bg-teal-50 px-2 py-0.5 text-[10px] font-medium text-teal-600 dark:bg-teal-500/10 dark:text-teal-400">Feeds SFS Logic</span></>} icon={<span className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-50 dark:bg-purple-500/10"><Users className="h-4 w-4 text-purple-600 dark:text-purple-400" /></span>} saved={autoSavedFields.has("household") && <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 fade-in"><Check className="h-3 w-3" /> Saved</span>} summary={`${sfsThresholds.totalHousehold} in household`} defaultOpen={false}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <ProfileField label="Number of Adults in Household">
            <input type="number" min="1" value={householdAdults} onChange={(e) => setHouseholdAdults(e.target.value)} onBlur={() => handleSaveSection("household", { household_adults: parseInt(householdAdults) || 1 })} className="input text-sm" />
          </ProfileField>
          <ProfileField label="Children Under 16">
            <input type="number" min="0" value={householdChildrenU16} onChange={(e) => setHouseholdChildrenU16(e.target.value)} onBlur={() => handleSaveSection("household", { household_children_under_16: parseInt(householdChildrenU16) || 0 })} className="input text-sm" />
          </ProfileField>
          <ProfileField label="Children Aged 16-18">
            <input type="number" min="0" value={householdChildren16_18} onChange={(e) => setHouseholdChildren16_18(e.target.value)} onBlur={() => handleSaveSection("household", { household_children_16_to_18: parseInt(householdChildren16_18) || 0 })} className="input text-sm" />
          </ProfileField>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 p-3 dark:bg-slate-800/50">
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <User className="h-3.5 w-3.5" /> {sfsThresholds.totalAdults} adults
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <Baby className="h-3.5 w-3.5" /> {parseInt(householdChildrenU16) || 0} under 16
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <GraduationCap className="h-3.5 w-3.5" /> {parseInt(householdChildren16_18) || 0} aged 16-18
          </div>
          <div className="ml-auto text-xs font-medium text-slate-600 dark:text-slate-300">
            Total Household: <span className="font-bold text-slate-800 dark:text-slate-100">{sfsThresholds.totalHousehold}</span>
          </div>
        </div>
      
      </FoldCard>

      {/* Card 4: Property & Housing Details */}
      <FoldCard title={<>Property & Housing Details</>} icon={<span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 dark:bg-amber-500/10"><Home className="h-4 w-4 text-amber-600 dark:text-amber-400" /></span>} saved={autoSavedFields.has("property") && <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 fade-in"><Check className="h-3 w-3" /> Saved</span>} summary={`${[landlordLenderName, monthlyRentMortgage ? "£" + monthlyRentMortgage + "/mo" : ""].filter(Boolean).join(" · ") || "Not entered"}`} defaultOpen={false}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <ProfileField label="Tenure Type">
            <select
              value={tenureType}
              onChange={(e) => { setTenureType(e.target.value as DebtTenureType); handleSaveSection("property", { tenure_type: (e.target.value || null) as DebtTenureType | null }); }}
              className="input text-sm"
            >
              <option value="">Select tenure...</option>
              {TENURE_TYPE_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </select>
          </ProfileField>
          <ProfileField label="Estimated Property Value">
            <input type="number" step="0.01" value={propertyValue} onChange={(e) => setPropertyValue(e.target.value)} onBlur={() => handleSaveSection("property", { property_value: propertyValue ? parseFloat(propertyValue) : null })} className="input text-sm" placeholder="250000" />
          </ProfileField>
          <ProfileField label="Outstanding Mortgage/Rent Amount">
            <input type="number" step="0.01" value={outstandingMortgage} onChange={(e) => setOutstandingMortgage(e.target.value)} onBlur={() => handleSaveSection("property", { outstanding_mortgage_or_rent: outstandingMortgage ? parseFloat(outstandingMortgage) : null })} className="input text-sm" placeholder="120000" />
          </ProfileField>
          <ProfileField label="Monthly Rent/Mortgage Payment">
            <input type="number" step="0.01" value={monthlyRentMortgage} onChange={(e) => setMonthlyRentMortgage(e.target.value)} onBlur={() => handleSaveSection("property", { monthly_rent_or_mortgage: monthlyRentMortgage ? parseFloat(monthlyRentMortgage) : null })} className="input text-sm" placeholder="850" />
          </ProfileField>
          <ProfileField label="Landlord/Lender Name">
            <input value={landlordLenderName} onChange={(e) => setLandlordLenderName(e.target.value)} onBlur={() => handleSaveSection("property", { landlord_lender_name: landlordLenderName || null })} className="input text-sm" placeholder="Nationwide Building Society" />
          </ProfileField>
        </div>
      
      </FoldCard>
    </div>
  );
}

// ============================================================
// SFS Intake Tab
// ============================================================

function SfsIntakeTab({ caseId, caseData }: { caseId: string | null; caseData: DebtCase | null }) {
  const { data: entries, loading, error, reload } = useDebtSfsEntries(caseId);
  const [showAdd, setShowAdd] = useState(false);
  const [newCategory, setNewCategory] = useState<DebtSfsCategory>("income");
  const [newLabel, setNewLabel] = useState("");
  const [newAmount, setNewAmount] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const totals = useMemo(() => {
    const income = entries.filter((e) => e.category === "income").reduce((s, e) => s + e.amount, 0);
    const essential = entries.filter((e) => e.category === "essential_expense").reduce((s, e) => s + e.amount, 0);
    const discretionary = entries.filter((e) => e.category === "discretionary_expense").reduce((s, e) => s + e.amount, 0);
    const debtRepay = entries.filter((e) => e.category === "debt_repayment").reduce((s, e) => s + e.amount, 0);
    const totalExpenses = essential + discretionary + debtRepay;
    const disposable = income - totalExpenses;
    return { income, essential, discretionary, debtRepay, totalExpenses, disposable };
  }, [entries]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!caseId || !newLabel.trim() || !newAmount) return;
    setActionError(null);
    try {
      await createDebtSfsEntry({ case_id: caseId, category: newCategory, label: newLabel, amount: parseFloat(newAmount) });
      await updateDebtCase(caseId, { monthly_disposable_income: totals.disposable + parseFloat(newAmount) * (newCategory === "income" ? 1 : -1) });
      setNewLabel(""); setNewAmount(""); setShowAdd(false); reload();
    } catch (e) { setActionError((e as Error).message); }
  }

  async function handleUpdateAmount(id: string, amount: number) {
    try { await updateDebtSfsEntry(id, { amount }); reload(); } catch (e) { setActionError((e as Error).message); }
  }

  async function handleDelete(id: string) {
    try { await deleteDebtSfsEntry(id); reload(); } catch (e) { setActionError((e as Error).message); }
  }

  async function handleLoadPresets() {
    if (!caseId) return;
    setActionError(null);
    try {
      for (const preset of SFS_PRESETS) {
        await createDebtSfsEntry({ case_id: caseId, category: preset.category, label: preset.label, amount: preset.defaultAmount });
      }
      await reload();
      await recalcDisposable(caseId, entries);
    } catch (e) { setActionError((e as Error).message); }
  }

  async function recalcDisposable(caseId: string, currentEntries: DebtSfsEntry[]) {
    const income = currentEntries.filter((e) => e.category === "income").reduce((s, e) => s + e.amount, 0);
    const expenses = currentEntries.filter((e) => e.category !== "income").reduce((s, e) => s + e.amount, 0);
    await updateDebtCase(caseId, { monthly_disposable_income: income - expenses });
  }

  async function handleApproveSfs() {
    if (!caseId) return;
    try {
      const income = entries.filter((e) => e.category === "income").reduce((s, e) => s + e.amount, 0);
      const expenses = entries.filter((e) => e.category !== "income").reduce((s, e) => s + e.amount, 0);
      await updateDebtCase(caseId, { status: "sfs_approved", monthly_disposable_income: income - expenses });
      await addAuditMilestone({ case_id: caseId, milestone: "SFS Approved", description: `Disposable income assessed at ${formatCurrency(income - expenses)}/month` });
      reload();
    } catch (e) { setActionError((e as Error).message); }
  }

  if (!caseData) return <div className="flex h-full items-center justify-center text-sm text-slate-400">Select a case to begin SFS intake</div>;

  const categoryEntries = (cat: DebtSfsCategory) => entries.filter((e) => e.category === cat);

  return (
    <div className="space-y-4">
      {actionError && <div className="rounded-xl bg-rose-50 px-4 py-2 text-sm text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">{actionError}</div>}

      {/* Disposable Income Hero Card */}
      <div className="panel relative overflow-hidden p-5 fade-in">
        <div className="absolute right-0 top-0 h-32 w-32 rounded-full bg-emerald-500/5 blur-3xl" />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Calculated Monthly Disposable Income</p>
            <p className={`mt-1 text-4xl font-bold ${totals.disposable >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
              {formatCurrency(totals.disposable)}
            </p>
            <p className="mt-1 text-xs text-slate-400">Income minus all living expenses and debt repayments (SFS compliant)</p>
          </div>
          <div className="flex flex-col gap-2">
            <button onClick={handleLoadPresets} className="btn btn-secondary text-xs">
              <FileCalc className="h-3.5 w-3.5" /> Load SFS Template
            </button>
            {caseData.status === "intake" || caseData.status === "sfs_pending" ? (
              <button onClick={handleApproveSfs} disabled={entries.length === 0} className="btn btn-primary bg-emerald-600 text-xs hover:bg-emerald-700 disabled:opacity-40">
                <CheckCircle2 className="h-3.5 w-3.5" /> Approve SFS
              </button>
            ) : (
              <span className="flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                <CheckCircle2 className="h-3.5 w-3.5" /> SFS Approved
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Summary breakdown bar */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryItem label="Total Income" value={formatCurrency(totals.income)} icon={<ArrowDownRight className="h-4 w-4 text-emerald-500" />} accent="text-emerald-600" />
        <SummaryItem label="Essential Expenses" value={formatCurrency(totals.essential)} icon={<Home className="h-4 w-4 text-blue-500" />} accent="text-blue-600" />
        <SummaryItem label="Discretionary" value={formatCurrency(totals.discretionary)} icon={<ShoppingCart className="h-4 w-4 text-amber-500" />} accent="text-amber-600" />
        <SummaryItem label="Debt Repayments" value={formatCurrency(totals.debtRepay)} icon={<CreditCard className="h-4 w-4 text-rose-500" />} accent="text-rose-600" />
      </div>

      {/* SFS Category Sections */}
      {loading ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="skeleton h-32 rounded-xl" />)}</div>
      ) : (
        <div className="space-y-3">
          {(["income", "essential_expense", "discretionary_expense", "debt_repayment"] as DebtSfsCategory[]).map((cat) => {
            const meta = SFS_CATEGORY_META[cat];
            const items = categoryEntries(cat);
            const sectionTotal = items.reduce((s, e) => s + e.amount, 0);
            return (
              <details key={cat} open={cat === "income" || cat === "essential_expense"} className="panel group/cat p-4">
                <summary className="flex cursor-pointer list-none items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ChevronDown className="h-4 w-4 text-slate-400 transition-transform group-open/cat:rotate-180" />
                    <span className={`h-2.5 w-2.5 rounded-full bg-${meta.color}-500`} />
                    <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100">{meta.label}</h4>
                    <span className="text-xs text-slate-400">({items.length})</span>
                  </div>
                  <span className="text-sm font-bold text-slate-700 dark:text-slate-200">{formatCurrency(sectionTotal)}</span>
                </summary>
                <div className="mt-3" />
                {items.length > 0 ? (
                  <div className="space-y-1.5">
                    {items.map((entry) => (
                      <div key={entry.id} className="group flex items-center gap-2 rounded-lg border border-slate-100 p-2 dark:border-slate-700/50">
                        <span className="flex-1 truncate text-sm text-slate-700 dark:text-slate-200">{entry.label}</span>
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-slate-400">£</span>
                          <input
                            type="number"
                            defaultValue={entry.amount}
                            onBlur={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v) && v !== entry.amount) handleUpdateAmount(entry.id, v); }}
                            className="w-20 rounded border border-slate-200 bg-white px-1.5 py-1 text-right text-xs text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
                          />
                        </div>
                        <button onClick={() => handleDelete(entry.id)} className="rounded p-1 text-slate-300 opacity-0 transition-opacity hover:text-rose-500 group-hover:opacity-100">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="py-2 text-xs text-slate-400">No entries — add one or load the SFS template</p>
                )}
              </details>
            );
          })}
        </div>
      )}

      {/* Add Entry Inline Form */}
      <div className="panel p-4">
        {showAdd ? (
          <form onSubmit={handleAdd} className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <select value={newCategory} onChange={(e) => setNewCategory(e.target.value as DebtSfsCategory)} className="input text-sm">
              {Object.entries(SFS_CATEGORY_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Description (e.g. Rent)" className="input text-sm sm:col-span-2" required />
            <div className="flex gap-2">
              <input type="number" step="0.01" value={newAmount} onChange={(e) => setNewAmount(e.target.value)} placeholder="Amount" className="input text-sm" required />
              <button type="submit" className="btn btn-primary bg-emerald-600 text-sm hover:bg-emerald-700"><Plus className="h-4 w-4" /></button>
              <button type="button" onClick={() => setShowAdd(false)} className="btn btn-secondary text-sm"><XCircle className="h-4 w-4" /></button>
            </div>
          </form>
        ) : (
          <button onClick={() => setShowAdd(true)} className="btn btn-secondary text-sm w-full">
            <Plus className="h-4 w-4" /> Add SFS Line Item
          </button>
        )}
      </div>

      {/* Benefits Entitlement & Income Maximization */}
      <details className="panel group/tools p-4">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-100">
          <ChevronDown className="h-4 w-4 text-slate-400 transition-transform group-open/tools:rotate-180" />
          Benefits check &amp; bank statement import
          <span className="text-xs font-normal text-slate-400">Optional tools to find extra income and pre-fill the budget</span>
        </summary>
        <div className="mt-4 space-y-4">
          <BenefitsCheckerSection caseId={caseId} caseData={caseData} />
          <BankTransactionImportSection caseId={caseId} caseData={caseData} />
        </div>
      </details>
    </div>
  );
}

// ============================================================
// Benefits Entitlement & Income Maximization Section
// ============================================================

function BenefitsCheckerSection({ caseId, caseData }: { caseId: string | null; caseData: DebtCase | null }) {
  const { data: checks, loading, reload } = useDebtBenefitsChecks(caseId);
  const [showAdd, setShowAdd] = useState(false);
  const [selectedBenefit, setSelectedBenefit] = useState("");
  const [estimatedAmount, setEstimatedAmount] = useState("");
  const [benefitNotes, setBenefitNotes] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const potentialUplift = useMemo(() => getPotentialBenefitsUplift(checks), [checks]);
  const confirmedUplift = useMemo(() => getTotalBenefitsUplift(checks), [checks]);
  const currentDisposable = caseData?.monthly_disposable_income ?? 0;
  const adjustedDisposable = currentDisposable + confirmedUplift;

  async function handleAddBenefit(e: React.FormEvent) {
    e.preventDefault();
    if (!caseId || !selectedBenefit) return;
    setActionError(null);
    try {
      const benefit = BENEFITS_CATALOG.find((b) => b.type === selectedBenefit);
      if (!benefit) return;
      await createDebtBenefitsCheck({
        case_id: caseId,
        benefit_type: benefit.type,
        label: benefit.label,
        eligible: true,
        estimated_monthly: parseFloat(estimatedAmount) || benefit.defaultEstimate,
        confirmed: false,
        notes: benefitNotes || undefined,
      });
      setSelectedBenefit(""); setEstimatedAmount(""); setBenefitNotes("");
      setShowAdd(false); reload();
    } catch (e) { setActionError((e as Error).message); }
  }

  async function handleToggleConfirm(id: string, confirmed: boolean) {
    setActionError(null);
    try {
      await updateDebtBenefitsCheck(id, { confirmed: !confirmed });
      reload();
    } catch (e) { setActionError((e as Error).message); }
  }

  async function handleToggleEligible(id: string, eligible: boolean) {
    setActionError(null);
    try {
      await updateDebtBenefitsCheck(id, { eligible: !eligible });
      reload();
    } catch (e) { setActionError((e as Error).message); }
  }

  async function handleDelete(id: string) {
    setActionError(null);
    try {
      await deleteDebtBenefitsCheck(id);
      reload();
    } catch (e) { setActionError((e as Error).message); }
  }

  async function handleApplyUplift() {
    if (!caseId || !caseData) return;
    setActionError(null);
    try {
      await updateDebtCase(caseId, { monthly_disposable_income: adjustedDisposable });
      await addAuditMilestone({
        case_id: caseId,
        milestone: "Benefits Uplift Applied",
        description: `Disposable income adjusted from ${formatCurrency(currentDisposable)} to ${formatCurrency(adjustedDisposable)} (confirmed benefits uplift: ${formatCurrency(confirmedUplift)}/month)`,
      });
      reload();
    } catch (e) { setActionError((e as Error).message); }
  }

  if (!caseId || !caseData) return null;

  return (
    <div className="panel p-4 fade-in">
      {actionError && <div className="mb-3 rounded-lg bg-rose-50 px-3 py-1.5 text-xs text-rose-600 dark:bg-rose-500/20 dark:text-rose-300">{actionError}</div>}
      <div className="mb-3 flex items-center justify-between">
        <h4 className="flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-100">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-50 dark:bg-teal-500/10"><PoundSterling className="h-4 w-4 text-teal-600 dark:text-teal-400" /></span>
          Maximization & Benefits Checker
          <span className="rounded-full bg-teal-50 px-2 py-0.5 text-[10px] font-medium text-teal-600 dark:bg-teal-500/10 dark:text-teal-400">Pre-DMP Lock</span>
        </h4>
        <button onClick={() => setShowAdd(!showAdd)} className="btn btn-secondary text-xs">
          <Plus className="h-3.5 w-3.5" /> Add Benefit Check
        </button>
      </div>

      {/* Uplift Summary */}
      <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
          <p className="text-[10px] uppercase text-slate-400">Current Disposable</p>
          <p className="text-lg font-bold text-slate-700 dark:text-slate-200">{formatCurrency(currentDisposable)}</p>
          <p className="text-[10px] text-slate-400">per month</p>
        </div>
        <div className="rounded-lg border border-teal-200 bg-teal-50 p-3 dark:border-teal-500/30 dark:bg-teal-500/10">
          <p className="text-[10px] uppercase text-teal-600 dark:text-teal-400">Potential Uplift</p>
          <p className="text-lg font-bold text-teal-700 dark:text-teal-300">+{formatCurrency(potentialUplift)}</p>
          <p className="text-[10px] text-teal-600 dark:text-teal-400">{checks.filter((c) => c.eligible).length} eligible benefits</p>
        </div>
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-500/30 dark:bg-emerald-500/10">
          <p className="text-[10px] uppercase text-emerald-600 dark:text-emerald-400">Adjusted Disposable</p>
          <p className="text-lg font-bold text-emerald-700 dark:text-emerald-300">{formatCurrency(adjustedDisposable)}</p>
          <p className="text-[10px] text-emerald-600 dark:text-emerald-400">after confirmed uplift: +{formatCurrency(confirmedUplift)}</p>
        </div>
      </div>

      {confirmedUplift > 0 && (
        <button onClick={handleApplyUplift} className="btn btn-primary bg-teal-600 mb-3 text-xs hover:bg-teal-700">
          <CheckCircle2 className="h-3.5 w-3.5" /> Apply Confirmed Uplift to Disposable Income ({formatCurrency(confirmedUplift)}/month)
        </button>
      )}

      {/* Add Benefit Form */}
      {showAdd && (
        <form onSubmit={handleAddBenefit} className="mb-3 grid grid-cols-1 gap-2 rounded-lg border border-slate-200 p-3 fade-in sm:grid-cols-4 dark:border-slate-700">
          <select value={selectedBenefit} onChange={(e) => setSelectedBenefit(e.target.value)} className="input text-sm sm:col-span-2" required>
            <option value="">Select benefit type...</option>
            {BENEFITS_CATALOG.map((b) => <option key={b.type} value={b.type}>{b.label} (est. {formatCurrency(b.defaultEstimate)})</option>)}
          </select>
          <input type="number" step="0.01" value={estimatedAmount} onChange={(e) => setEstimatedAmount(e.target.value)} placeholder="Monthly amount" className="input text-sm" />
          <div className="flex gap-2">
            <input value={benefitNotes} onChange={(e) => setBenefitNotes(e.target.value)} placeholder="Notes" className="input text-sm" />
            <button type="submit" className="btn btn-primary bg-teal-600 text-sm hover:bg-teal-700"><Plus className="h-4 w-4" /></button>
          </div>
        </form>
      )}

      {/* Benefits List */}
      {loading ? (
        <div className="skeleton h-20 rounded-lg" />
      ) : checks.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-6 text-slate-400">
          <PoundSterling className="mb-2 h-8 w-8 opacity-30" />
          <p className="text-xs">No benefits checks yet — add one to calculate potential income uplift</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {checks.map((c) => (
            <div key={c.id} className="group flex items-center gap-3 rounded-lg border border-slate-200 p-2.5 dark:border-slate-700">
              <button
                onClick={() => handleToggleEligible(c.id, c.eligible)}
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded ${c.eligible ? "bg-teal-500 text-white" : "border border-slate-300 dark:border-slate-600"}`}
              >
                {c.eligible && <Check className="h-3 w-3" />}
              </button>
              <div className="flex-1">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{c.label}</p>
                <p className="text-[10px] text-slate-400">{c.eligible ? "Eligible" : "Not eligible"}{c.confirmed ? " · Confirmed" : ""}{c.notes ? ` · ${c.notes}` : ""}</p>
              </div>
              <span className="text-sm font-bold text-teal-600 dark:text-teal-400">+{formatCurrency(c.estimated_monthly)}</span>
              <button
                onClick={() => handleToggleConfirm(c.id, c.confirmed)}
                disabled={!c.eligible}
                className={`rounded-md px-2 py-0.5 text-[10px] font-medium transition-colors disabled:opacity-30 ${
                  c.confirmed
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300"
                    : "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400"
                }`}
              >
                {c.confirmed ? "Confirmed" : "Confirm"}
              </button>
              <button onClick={() => handleDelete(c.id)} className="rounded p-1 text-slate-300 opacity-0 transition-opacity hover:text-rose-500 group-hover:opacity-100">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Creditor Ledger Tab
// ============================================================

function CreditorLedgerTab({ caseId, caseData }: { caseId: string | null; caseData: DebtCase | null }) {
  const { data: creditors, loading, error, reload } = useDebtCreditors(caseId);
  const [showAdd, setShowAdd] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [distributionApplied, setDistributionApplied] = useState(false);
  const [frozenRates, setFrozenRates] = useState<Record<string, number>>({});
  const [editingRate, setEditingRate] = useState<string | null>(null);
  const [customRate, setCustomRate] = useState("");

  // Form state
  const [creditorName, setCreditorName] = useState("");
  const [debtType, setDebtType] = useState<DebtType>("credit_card");
  const [accountRef, setAccountRef] = useState("");
  const [balance, setBalance] = useState("");
  const [interestRate, setInterestRate] = useState("");
  const [minPayment, setMinPayment] = useState("");
  const [isPriority, setIsPriority] = useState(false);
  const [settlementOffer, setSettlementOffer] = useState("");

  const totalDebt = creditors.reduce((s, c) => s + c.current_balance, 0);
  const totalInterest = creditors.reduce((s, c) => s + c.current_balance * (c.interest_rate / 100 / 12), 0);

  // Live pro-rata recalculation — updates in real time as disposable income or balances change
  const liveProRata = useMemo(
    () => calculateProRataSimple(caseData?.monthly_disposable_income ?? 0, creditors),
    [caseData?.monthly_disposable_income, creditors],
  );
  const totalLiveProRata = liveProRata.reduce((s, p) => s + p.pro_rata_amount, 0);
  const totalStoredProRata = creditors.reduce((s, c) => s + c.pro_rata_amount, 0);

  async function handleToggleFreeze(creditorId: string, currentRate: number) {
    if (!caseId) return;
    setActionError(null);
    try {
      if (currentRate > 0) {
        // Freeze: cache original rate and set to 0
        setFrozenRates((prev) => ({ ...prev, [creditorId]: currentRate }));
        await updateDebtCreditor(creditorId, { interest_rate: 0 });
      } else {
        // Unfreeze: restore cached rate or default to 0
        const restored = frozenRates[creditorId] ?? 0;
        await updateDebtCreditor(creditorId, { interest_rate: restored });
        setFrozenRates((prev) => { const next = { ...prev }; delete next[creditorId]; return next; });
      }
      reload();
    } catch (e) { setActionError((e as Error).message); }
  }

  async function handleSaveCustomRate(creditorId: string) {
    if (!caseId) return;
    const rate = parseFloat(customRate);
    if (isNaN(rate) || rate < 0) return;
    setActionError(null);
    try {
      await updateDebtCreditor(creditorId, { interest_rate: rate });
      if (rate > 0) {
        setFrozenRates((prev) => { const next = { ...prev }; delete next[creditorId]; return next; });
      }
      setEditingRate(null);
      setCustomRate("");
      reload();
    } catch (e) { setActionError((e as Error).message); }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!caseId || !creditorName.trim() || !balance) return;
    setActionError(null);
    try {
      await createDebtCreditor({
        case_id: caseId,
        creditor_name: creditorName,
        debt_type: debtType,
        account_reference: accountRef || undefined,
        current_balance: parseFloat(balance),
        interest_rate: interestRate ? parseFloat(interestRate) : 0,
        minimum_payment: minPayment ? parseFloat(minPayment) : undefined,
        is_priority: isPriority,
        settlement_offer: settlementOffer ? parseFloat(settlementOffer) : undefined,
      });
      // Update case total debt
      await updateDebtCase(caseId, { total_debt: totalDebt + parseFloat(balance) });
      setCreditorName(""); setBalance(""); setInterestRate(""); setMinPayment(""); setAccountRef(""); setSettlementOffer(""); setIsPriority(false);
      setShowAdd(false); reload();
    } catch (e) { setActionError((e as Error).message); }
  }

  async function handleDelete(id: string, creditorBalance: number) {
    if (!caseId) return;
    try {
      await deleteDebtCreditor(id);
      await updateDebtCase(caseId, { total_debt: Math.max(0, totalDebt - creditorBalance) });
      reload();
    } catch (e) { setActionError((e as Error).message); }
  }

  async function handleCalculateProRata() {
    if (!caseId || !caseData) return;
    setActionError(null);
    try {
      const disposable = caseData.monthly_disposable_income;
      const distributed = calculateProRata(disposable, creditors);
      for (const c of distributed) {
        await updateDebtCreditor(c.id, { pro_rata_amount: c.pro_rata_amount });
      }
      setDistributionApplied(true);
      setTimeout(() => setDistributionApplied(false), 3000);
      reload();
    } catch (e) { setActionError((e as Error).message); }
  }

  async function handleSendCreditorPack() {
    if (!caseId) return;
    try {
      await updateDebtCase(caseId, { status: "creditor_pack_sent" });
      await addAuditMilestone({ case_id: caseId, milestone: "Creditor Pack Sent", description: `Creditor pack dispatched to ${creditors.length} creditors` });
      reload();
    } catch (e) { setActionError((e as Error).message); }
  }

  if (!caseData) return <div className="flex h-full items-center justify-center text-sm text-slate-400">Select a case to manage creditors</div>;

  return (
    <div className="space-y-4">
      {actionError && <div className="rounded-xl bg-rose-50 px-4 py-2 text-sm text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">{actionError}</div>}

      {/* Ledger KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard icon={<Landmark className="h-4 w-4" />} label="Total Debt" value={formatCurrency(totalDebt, "GBP", { compact: true })} sub={`${creditors.length} creditors`} accent="text-rose-600 bg-rose-50 dark:bg-rose-500/10" />
        <KpiCard icon={<Calculator className="h-4 w-4" />} label="Live Pro-Rata" value={formatCurrency(totalLiveProRata, "GBP", { compact: true })} sub={`From ${formatCurrency(caseData.monthly_disposable_income)} disposable`} accent="text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10" />
        <KpiCard icon={<Percent className="h-4 w-4" />} label="Monthly Interest" value={formatCurrency(totalInterest)} sub={totalInterest === 0 ? "All frozen" : "Across all debts"} accent="text-amber-600 bg-amber-50 dark:bg-amber-500/10" />
        <KpiCard icon={<Star className="h-4 w-4" />} label="Priority Debts" value={String(creditors.filter((c) => c.is_priority).length)} sub="Mortgage, council tax, utilities" accent="text-blue-600 bg-blue-50 dark:bg-blue-500/10" />
      </div>

      {/* Action Bar */}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={handleCalculateProRata} disabled={creditors.length === 0 || caseData.monthly_disposable_income <= 0} className="btn btn-primary bg-emerald-600 text-sm hover:bg-emerald-700 disabled:opacity-40">
          <Calculator className="h-4 w-4" /> Calculate Pro-Rata Distribution
        </button>
        <button onClick={handleSendCreditorPack} disabled={creditors.length === 0 || caseData.status === "creditor_pack_sent" || caseData.status === "payment_schedule_active"} className="btn btn-secondary text-sm disabled:opacity-40">
          <Send className="h-4 w-4" /> Send Creditor Pack
        </button>
        <button onClick={() => setShowAdd(!showAdd)} className="btn btn-secondary text-sm ml-auto">
          <Plus className="h-4 w-4" /> Add Creditor
        </button>
      </div>

      {distributionApplied && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300 fade-in">
          <CheckCircle2 className="h-4 w-4" /> Pro-rata distribution saved — {formatCurrency(totalLiveProRata)}/month split across {creditors.length} creditors
        </div>
      )}

      {/* Live recalculation indicator */}
      {Math.abs(totalLiveProRata - totalStoredProRata) > 0.01 && creditors.length > 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300 fade-in">
          <Calculator className="h-4 w-4 shrink-0" /> Live pro-rata has changed — click "Calculate Pro-Rata Distribution" to save the updated split to the database.
        </div>
      )}

      {/* Add Creditor Form */}
      {showAdd && (
        <form onSubmit={handleAdd} className="panel grid grid-cols-1 gap-3 p-4 fade-in sm:grid-cols-3 lg:grid-cols-4">
          <Field label="Creditor Name"><input value={creditorName} onChange={(e) => setCreditorName(e.target.value)} className="input text-sm" placeholder="Barclaycard" required autoFocus /></Field>
          <Field label="Debt Type">
            <select value={debtType} onChange={(e) => setDebtType(e.target.value as DebtType)} className="input text-sm">
              {Object.entries(DEBT_TYPE_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </Field>
          <Field label="Account Reference"><input value={accountRef} onChange={(e) => setAccountRef(e.target.value)} className="input text-sm" placeholder="XXXX-1234" /></Field>
          <Field label="Current Balance (£)"><input type="number" step="0.01" value={balance} onChange={(e) => setBalance(e.target.value)} className="input text-sm" placeholder="4500.00" required /></Field>
          <Field label="Interest Rate (%)"><input type="number" step="0.1" value={interestRate} onChange={(e) => setInterestRate(e.target.value)} className="input text-sm" placeholder="18.9" /></Field>
          <Field label="Minimum Payment (£)"><input type="number" step="0.01" value={minPayment} onChange={(e) => setMinPayment(e.target.value)} className="input text-sm" placeholder="120.00" /></Field>
          <Field label="Settlement Offer (£)"><input type="number" step="0.01" value={settlementOffer} onChange={(e) => setSettlementOffer(e.target.value)} className="input text-sm" placeholder="3000.00" /></Field>
          <div className="flex items-end gap-2">
            <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
              <input type="checkbox" checked={isPriority} onChange={(e) => setIsPriority(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-emerald-600" /> Priority Debt
            </label>
          </div>
          <div className="flex items-end gap-2 sm:col-span-3 lg:col-span-4">
            <button type="submit" className="btn btn-primary bg-emerald-600 text-sm hover:bg-emerald-700"><Plus className="h-4 w-4" /> Add to Ledger</button>
            <button type="button" onClick={() => setShowAdd(false)} className="btn btn-secondary text-sm">Cancel</button>
          </div>
        </form>
      )}

      {/* Creditor Table */}
      {loading ? (
        <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="skeleton h-16 rounded-xl" />)}</div>
      ) : creditors.length === 0 ? (
        <div className="panel flex flex-col items-center justify-center py-12 text-slate-400">
          <Landmark className="mb-3 h-10 w-10 opacity-30" />
          <p className="text-sm">No creditors on this case yet</p>
          <button onClick={() => setShowAdd(true)} className="btn btn-secondary mt-3 text-xs"><Plus className="h-3.5 w-3.5" /> Add First Creditor</button>
        </div>
      ) : (
        <div className="panel overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50">
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-400">Creditor</th>
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-400">Type</th>
                  <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-slate-400">Balance</th>
                  <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-slate-400">Interest</th>
                  <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-slate-400">Pro-Rata Share</th>
                  <th className="px-4 py-3 text-center text-xs font-bold uppercase tracking-wide text-slate-400">Priority</th>
                  <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-slate-400">Settlement</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {creditors.map((c) => {
                  const meta = DEBT_TYPE_META[c.debt_type];
                  const proRataPct = totalDebt > 0 ? (c.current_balance / totalDebt) * 100 : 0;
                  const liveAmount = liveProRata.find((p) => p.id === c.id)?.pro_rata_amount ?? 0;
                  const isFrozen = c.interest_rate === 0;
                  const isEditing = editingRate === c.id;
                  return (
                    <tr key={c.id} className="group border-b border-slate-100 transition-colors hover:bg-slate-50 dark:border-slate-700/50 dark:hover:bg-slate-800/30">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className={`flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-700 ${meta.color}`}>{meta.icon}</span>
                          <div>
                            <p className="font-medium text-slate-800 dark:text-slate-100">{c.creditor_name}</p>
                            {c.account_reference && <p className="text-[10px] text-slate-400">Ref: {c.account_reference}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">{meta.label}</td>
                      <td className="px-4 py-3 text-right font-bold text-slate-800 dark:text-slate-100">{formatCurrency(c.current_balance)}</td>
                      <td className="px-4 py-3 text-right">
                        {isEditing ? (
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              step="0.1"
                              value={customRate}
                              onChange={(e) => setCustomRate(e.target.value)}
                              className="input w-16 px-1.5 py-1 text-xs"
                              placeholder="18.9"
                              autoFocus
                              onKeyDown={(e) => { if (e.key === "Enter") handleSaveCustomRate(c.id); if (e.key === "Escape") { setEditingRate(null); setCustomRate(""); } }}
                            />
                            <button onClick={() => handleSaveCustomRate(c.id)} className="rounded p-1 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-500/10"><Check className="h-3.5 w-3.5" /></button>
                            <button onClick={() => { setEditingRate(null); setCustomRate(""); }} className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-3.5 w-3.5" /></button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-end gap-1.5">
                            <span className={isFrozen ? "text-emerald-600 dark:text-emerald-400" : "text-slate-500 dark:text-slate-400"}>{isFrozen ? "0.0%" : `${c.interest_rate.toFixed(1)}%`}</span>
                            <button
                              onClick={() => handleToggleFreeze(c.id, c.interest_rate)}
                              className={`rounded-md p-1 transition-colors ${
                                isFrozen
                                  ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400"
                                  : "text-slate-300 hover:bg-slate-100 hover:text-slate-500 dark:hover:bg-slate-700"
                              }`}
                              title={isFrozen ? "Interest frozen (0%) — click to unfreeze" : "Click to freeze interest (0%)"}
                            >
                              <Snowflake className="h-3.5 w-3.5" />
                            </button>
                            {!isFrozen && (
                              <button
                                onClick={() => { setEditingRate(c.id); setCustomRate(String(c.interest_rate)); }}
                                className="rounded-md p-1 text-slate-300 opacity-0 transition-opacity hover:bg-amber-50 hover:text-amber-600 group-hover:opacity-100 dark:hover:bg-amber-500/10"
                                title="Edit custom APR"
                              >
                                <Percent className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={`font-semibold ${Math.abs(liveAmount - c.pro_rata_amount) > 0.01 ? "text-blue-600 dark:text-blue-400" : "text-emerald-600 dark:text-emerald-400"}`}>{formatCurrency(liveAmount)}</span>
                        <span className="ml-1 text-[10px] text-slate-400">({proRataPct.toFixed(1)}%)</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {c.is_priority ? <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-600 dark:bg-blue-500/10 dark:text-blue-400"><Star className="h-2.5 w-2.5" /> Priority</span> : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-500 dark:text-slate-400">{c.settlement_offer ? formatCurrency(c.settlement_offer) : "—"}</td>
                      <td className="px-4 py-3 text-right">
                        <button onClick={() => handleDelete(c.id, c.current_balance)} className="rounded-lg p-1.5 text-slate-300 opacity-0 transition-opacity hover:bg-rose-50 hover:text-rose-500 group-hover:opacity-100 dark:hover:bg-rose-500/10">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50">
                  <td className="px-4 py-3 text-xs font-bold uppercase text-slate-500" colSpan={2}>Total</td>
                  <td className="px-4 py-3 text-right font-bold text-slate-800 dark:text-slate-100">{formatCurrency(totalDebt)}</td>
                  <td className="px-4 py-3 text-right text-xs text-slate-400">{totalInterest === 0 ? <span className="text-emerald-600">Frozen</span> : `${formatCurrency(totalInterest)}/mo`}</td>
                  <td className="px-4 py-3 text-right font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(totalLiveProRata)}</td>
                  <td colSpan={3}></td>
                </tr>
              </tfoot>
            </table>
          </div>
      )}
    </div>
  );
}

// ============================================================
// Plan Comparison Tab
// ============================================================

function PlanComparisonTab({ caseId, caseData }: { caseId: string | null; caseData: DebtCase | null }) {
  const { data: creditors } = useDebtCreditors(caseId);

  const totalDebt = creditors.reduce((s, c) => s + c.current_balance, 0);
  const avgInterestRate = creditors.length > 0 ? creditors.reduce((s, c) => s + c.interest_rate, 0) / creditors.length : 0;
  const monthlyDisposable = caseData?.monthly_disposable_income ?? 0;
  const totalSettlement = creditors.reduce((s, c) => s + (c.settlement_offer ?? c.current_balance), 0);

  const dmpProjection = useMemo(() => projectDmp(totalDebt, monthlyDisposable, avgInterestRate), [totalDebt, monthlyDisposable, avgInterestRate]);
  const settlementProjection = useMemo(() => projectSettlement(creditors, monthlyDisposable), [creditors, monthlyDisposable]);

  const chartData = useMemo(() => {
    const maxMonths = Math.max(dmpProjection.monthlyPoints.length, settlementProjection.monthlyPoints.length);
    const data: { month: number; dmp: number | null; settlement: number | null }[] = [];
    for (let i = 0; i <= maxMonths; i += Math.max(1, Math.floor(maxMonths / 24))) {
      const dmpPoint = dmpProjection.monthlyPoints.find((p) => p.month === i);
      const settlePoint = settlementProjection.monthlyPoints.find((p) => p.month === i);
      data.push({
        month: i,
        dmp: dmpPoint ? dmpPoint.balance : null,
        settlement: settlePoint ? settlePoint.balance : null,
      });
    }
    return data;
  }, [dmpProjection, settlementProjection]);

  if (!caseData) return <div className="flex h-full items-center justify-center text-sm text-slate-400">Select a case to compare plans</div>;
  if (creditors.length === 0) return (
    <div className="panel flex flex-col items-center justify-center py-12 text-slate-400">
      <GitCompareArrows className="mb-3 h-10 w-10 opacity-30" />
      <p className="text-sm">Add creditors to the ledger first to compare plans</p>
    </div>
  );

  const dmpYears = (dmpProjection.months / 12).toFixed(1);
  const settleYears = (settlementProjection.months / 12).toFixed(1);
  const dmpTotalCost = dmpProjection.totalPaid;
  const settleTotalCost = settlementProjection.totalPaid;
  const savings = dmpTotalCost - settleTotalCost;

  return (
    <div className="space-y-4">
      {/* Comparison Header */}
      <div className="panel p-4 fade-in">
        <div className="flex items-center gap-2">
          <GitCompareArrows className="h-5 w-5 text-emerald-600" />
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Recovery Strategy Comparison</h3>
        </div>
        <p className="mt-1 text-xs text-slate-400">Side-by-side analysis of Debt Management Plan (DMP) vs. Settlement approach for {caseData.debtor_name}</p>
      </div>

      {/* Side-by-side metric cards */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* DMP Card */}
        <div className="panel border-2 border-blue-200 p-5 dark:border-blue-500/30">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 dark:bg-blue-500/10"><Calculator className="h-5 w-5 text-blue-600" /></div>
              <div>
                <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100">Debt Management Plan (DMP)</h4>
                <p className="text-[10px] text-slate-400">Full repayment via monthly pro-rata distributions</p>
              </div>
            </div>
          </div>
          <div className="space-y-3">
            <CompareMetric label="Recovery Timeline" value={`${dmpProjection.months} months (${dmpYears} yrs)`} icon={<Clock className="h-4 w-4" />} />
            <CompareMetric label="Monthly Payment" value={formatCurrency(monthlyDisposable)} icon={<Wallet className="h-4 w-4" />} />
            <CompareMetric label="Total Repayment Cost" value={formatCurrency(dmpTotalCost)} icon={<Receipt className="h-4 w-4" />} />
            <CompareMetric label="Total Interest Paid" value={formatCurrency(Math.max(0, dmpTotalCost - totalDebt))} icon={<Percent className="h-4 w-4" />} />
            <CompareMetric label="Debt Remaining at End" value={formatCurrency(dmpProjection.remaining)} icon={<TrendingDown className="h-4 w-4" />} />
          </div>
          <div className="mt-4 rounded-lg bg-blue-50 p-3 text-xs text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">
            <ShieldCheck className="mb-1 inline h-3.5 w-3.5" /> DMP preserves credit rating better. Creditors may freeze interest upon plan acceptance.
          </div>
        </div>

        {/* Settlement Card */}
        <div className="panel border-2 border-amber-200 p-5 dark:border-amber-500/30">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 dark:bg-amber-500/10"><PiggyBank className="h-5 w-5 text-amber-600" /></div>
              <div>
                <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100">Settlement Plan</h4>
                <p className="text-[10px] text-slate-400">Lump-sum offers to clear debts at reduced balances</p>
              </div>
            </div>
          </div>
          <div className="space-y-3">
            <CompareMetric label="Recovery Timeline" value={`${settlementProjection.months} months (${settleYears} yrs)`} icon={<Clock className="h-4 w-4" />} />
            <CompareMetric label="Monthly Saving" value={formatCurrency(monthlyDisposable)} icon={<Wallet className="h-4 w-4" />} />
            <CompareMetric label="Total Settlement Cost" value={formatCurrency(settleTotalCost)} icon={<Receipt className="h-4 w-4" />} />
            <CompareMetric label="Total Debt Forgiven" value={formatCurrency(Math.max(0, totalDebt - settleTotalCost))} icon={<Percent className="h-4 w-4" />} />
            <CompareMetric label="Settlement vs Full Debt" value={`${((settleTotalCost / totalDebt) * 100).toFixed(0)}% of original`} icon={<TrendingDown className="h-4 w-4" />} />
          </div>
          <div className="mt-4 rounded-lg bg-amber-50 p-3 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
            <AlertCircle className="mb-1 inline h-3.5 w-3.5" /> Settlement impacts credit score. Forgiven debt may be taxable as income.
          </div>
        </div>
      </div>

      {/* Comparison Chart */}
      <div className="panel p-4">
        <h3 className="mb-3 text-sm font-bold text-slate-800 dark:text-slate-100">Balance Over Time — DMP vs Settlement</h3>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" className="dark:opacity-20" />
            <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#94a3b8" }} label={{ value: "Months", position: "insideBottom", offset: -5, fontSize: 11, fill: "#94a3b8" }} />
            <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
            <Tooltip formatter={(v: number) => v != null ? formatCurrency(v) : "—"} labelFormatter={(l) => `Month ${l}`} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="dmp" name="DMP Balance" stroke="#3b82f6" strokeWidth={2.5} dot={false} connectNulls />
            <Line type="monotone" dataKey="settlement" name="Settlement Balance" stroke="#f59e0b" strokeWidth={2.5} dot={false} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Savings Summary */}
      <div className="panel p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Potential Savings with Settlement</p>
            <p className={`mt-1 text-3xl font-bold ${savings > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
              {savings > 0 ? formatCurrency(savings) : `-${formatCurrency(Math.abs(savings))}`}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {savings > 0
                ? `Settlement saves ${formatCurrency(savings)} but takes ${Math.abs(settlementProjection.months - dmpProjection.months)} months ${settlementProjection.months > dmpProjection.months ? "longer" : "less time"}`
                : "DMP may be more cost-effective in this scenario"}
            </p>
          </div>
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-50 dark:bg-emerald-500/10">
            <Scale className="h-8 w-8 text-emerald-600" />
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Payoff Forecast Tab — Interactive DMP Chart with Recharts
// ============================================================

function PayoffForecastTab({ caseId, caseData }: { caseId: string | null; caseData: DebtCase | null }) {
  const { data: creditors, loading } = useDebtCreditors(caseId);
  const [viewMode, setViewMode] = useState<"comparison" | "dmp" | "original">("comparison");

  const totalDebt = creditors.reduce((s, c) => s + c.current_balance, 0);
  const monthlyPayment = caseData?.monthly_disposable_income ?? 0;

  // Original terms projection — uses each creditor's actual interest rate (unfrozen)
  const originalProjection = useMemo(
    () => projectDmpWithRates(creditors, monthlyPayment, false),
    [creditors, monthlyPayment],
  );

  // DMP schedule projection — all interest frozen at 0%
  const dmpProjection = useMemo(
    () => projectDmpWithRates(creditors, monthlyPayment, true),
    [creditors, monthlyPayment],
  );

  // Merge both projections into a single dataset for the comparison chart
  const chartData = useMemo(() => {
    const maxMonths = Math.max(originalProjection.monthlyPoints.length, dmpProjection.monthlyPoints.length);
    const data: { month: number; original: number | null; dmp: number | null }[] = [];
    for (let i = 0; i <= maxMonths; i++) {
      data.push({
        month: i,
        original: originalProjection.monthlyPoints[i]?.balance ?? null,
        dmp: dmpProjection.monthlyPoints[i]?.balance ?? null,
      });
    }
    return data;
  }, [originalProjection, dmpProjection]);

  if (!caseData) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-400">
        Select a case to view payoff forecast
      </div>
    );
  }

  if (loading) {
    return <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-20 rounded-xl" />)}</div>;
  }

  if (creditors.length === 0) {
    return (
      <div className="panel flex flex-col items-center justify-center py-12 text-slate-400">
        <TrendingDown className="mb-3 h-10 w-10 opacity-30" />
        <p className="text-sm">Add creditors to the ledger to see payoff projections</p>
      </div>
    );
  }

  const savingsVsOriginal = Math.max(0, originalProjection.totalPaid - dmpProjection.totalPaid);
  const monthsSaved = Math.max(0, originalProjection.months - dmpProjection.months);

  return (
    <div className="space-y-4">
      {/* View Mode Toggle */}
      <div className="panel flex flex-wrap items-center justify-between gap-3 p-4 fade-in">
        <div>
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Payoff Forecast</h3>
          <p className="text-xs text-slate-400">Projected remaining balance over time — {creditors.length} creditors, {formatCurrency(monthlyPayment)}/month</p>
        </div>
        <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-700 dark:bg-slate-800">
          {([
            { id: "comparison", label: "Comparison" },
            { id: "dmp", label: "DMP (0% Interest)" },
            { id: "original", label: "Original Terms" },
          ] as const).map((opt) => (
            <button
              key={opt.id}
              onClick={() => setViewMode(opt.id)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                viewMode === opt.id
                  ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white"
                  : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          icon={<TrendingDown className="h-4 w-4" />}
          label="DMP Payoff Time"
          value={dmpProjection.months > 0 ? `${dmpProjection.months} months` : "—"}
          sub={`${Math.floor(dmpProjection.months / 12)}y ${dmpProjection.months % 12}m`}
          accent="text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10"
        />
        <KpiCard
          icon={<Wallet className="h-4 w-4" />}
          label="Total Paid (DMP)"
          value={formatCurrency(dmpProjection.totalPaid, "GBP", { compact: true })}
          sub={`From ${formatCurrency(totalDebt, "GBP", { compact: true })} debt`}
          accent="text-blue-600 bg-blue-50 dark:bg-blue-500/10"
        />
        <KpiCard
          icon={<Clock className="h-4 w-4" />}
          label="Original Payoff Time"
          value={originalProjection.months > 0 ? `${originalProjection.months} months` : "Never (insufficient)"}
          sub={originalProjection.months >= 600 ? "Interest exceeds payment" : `${Math.floor(originalProjection.months / 12)}y ${originalProjection.months % 12}m`}
          accent="text-rose-600 bg-rose-50 dark:bg-rose-500/10"
        />
        <KpiCard
          icon={<PiggyBank className="h-4 w-4" />}
          label="DMP Savings"
          value={formatCurrency(savingsVsOriginal, "GBP", { compact: true })}
          sub={monthsSaved > 0 ? `${monthsSaved} months sooner` : "Same timeline"}
          accent="text-amber-600 bg-amber-50 dark:bg-amber-500/10"
        />
      </div>

      {/* Chart */}
      <div className="panel p-5 fade-in">
        <div className="mb-4 flex items-center justify-between">
          <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100">Remaining Balance Over Time</h4>
          <div className="flex items-center gap-4 text-[10px]">
            {viewMode !== "dmp" && (
              <div className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-rose-500" />
                <span className="text-slate-500 dark:text-slate-400">Original Terms (Unfrozen Interest)</span>
              </div>
            )}
            {viewMode !== "original" && (
              <div className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                <span className="text-slate-500 dark:text-slate-400">DebtVerge DMP (0% Interest Pro-Rata)</span>
              </div>
            )}
          </div>
        </div>
        <ResponsiveContainer width="100%" height={340}>
          <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 25, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-slate-200 dark:text-slate-700" />
            <XAxis
              dataKey="month"
              type="number"
              domain={[0, "dataMax"]}
              tick={{ fontSize: 11, fill: "currentColor" }}
              tickFormatter={(v: number) => v % 12 === 0 ? `${v / 12}y` : ""}
              label={{ value: "Months", position: "insideBottom", offset: -15, style: { fontSize: 11, fill: "currentColor" } }}
              className="text-slate-400"
              allowDecimals={false}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "currentColor" }}
              tickFormatter={(v: number) => {
                const abs = Math.abs(v);
                if (abs >= 1000) return `${(v / 1000).toFixed(0)}k`;
                return String(v);
              }}
              className="text-slate-400"
              width={70}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "rgb(30 41 59)",
                border: "1px solid rgb(51 65 85)",
                borderRadius: "8px",
                fontSize: "12px",
                color: "white",
              }}
              labelFormatter={(v: number) => `Month ${v}`}
              formatter={(value: unknown, name: unknown) => [
                value === null || value === undefined ? "N/A" : formatCurrency(Number(value)),
                name === "original" ? "Original Terms" : "DMP Schedule",
              ]}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {viewMode !== "dmp" && (
              <Line
                type="monotone"
                dataKey="original"
                stroke="#ef4444"
                strokeWidth={2}
                strokeDasharray="5 4"
                dot={false}
                name="Original Terms"
                connectNulls={false}
              />
            )}
            {viewMode !== "original" && (
              <Line
                type="monotone"
                dataKey="dmp"
                stroke="#10b981"
                strokeWidth={2.5}
                dot={false}
                name="DMP Schedule"
                connectNulls={false}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Per-Creditor Breakdown */}
      <div className="panel p-4 fade-in">
        <h4 className="mb-3 text-sm font-bold text-slate-800 dark:text-slate-100">Per-Creditor Projection</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 text-left text-xs uppercase text-slate-400 dark:border-slate-700 dark:bg-slate-800/50">
                <th className="px-4 py-3 font-bold uppercase tracking-wide text-slate-400">Creditor</th>
                <th className="px-4 py-3 text-right font-bold uppercase tracking-wide text-slate-400">Balance</th>
                <th className="px-4 py-3 text-right font-bold uppercase tracking-wide text-slate-400">Interest Rate</th>
                <th className="px-4 py-3 text-right font-bold uppercase tracking-wide text-slate-400">Monthly (Pro-Rata)</th>
                <th className="px-4 py-3 text-right font-bold uppercase tracking-wide text-slate-400">DMP Payoff</th>
              </tr>
            </thead>
            <tbody>
              {creditors.map((c) => {
                const proRata = monthlyPayment > 0 && totalDebt > 0
                  ? monthlyPayment * (c.current_balance / totalDebt)
                  : 0;
                const dmpMonths = proRata > 0 ? Math.ceil(c.current_balance / proRata) : 0;
                return (
                  <tr key={c.id} className="border-b border-slate-100 dark:border-slate-700/50">
                    <td className="px-4 py-3 font-medium text-slate-700 dark:text-slate-200">{c.creditor_name}</td>
                    <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-300">{formatCurrency(c.current_balance)}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={c.interest_rate === 0 ? "text-emerald-600 dark:text-emerald-400" : "text-slate-500 dark:text-slate-400"}>
                        {c.interest_rate === 0 ? "Frozen (0%)" : `${c.interest_rate.toFixed(1)}%`}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-emerald-600 dark:text-emerald-400">{formatCurrency(proRata)}</td>
                    <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-300">
                      {dmpMonths > 0 ? `${dmpMonths} months` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Bank Transaction Auto-Categorization Section (SFS Intake)
// ============================================================

const CONFIDENCE_META: Record<string, { color: string; bg: string; label: string }> = {
  high: { color: "text-emerald-600", bg: "bg-emerald-50 dark:bg-emerald-500/10", label: "High" },
  medium: { color: "text-amber-600", bg: "bg-amber-50 dark:bg-amber-500/10", label: "Medium" },
  low: { color: "text-orange-600", bg: "bg-orange-50 dark:bg-orange-500/10", label: "Low" },
  unmatched: { color: "text-slate-400", bg: "bg-slate-100 dark:bg-slate-700", label: "Unmapped" },
};

const MOCK_BANK_STATEMENTS = [
  { description: "TESCO STORES 4823 CARD", amount: -87.43, date: "2026-07-28" },
  { description: "BRITISH GAS DD", amount: -124.50, date: "2026-07-25" },
  { description: "SALARY ACME LTD", amount: 2850.00, date: "2026-07-25" },
  { description: "THAMES WATER DD", amount: -42.80, date: "2026-07-23" },
  { description: "COUNCIL TAX CT 2026", amount: -178.00, date: "2026-07-22" },
  { description: "NETFLIX.COM", amount: -15.99, date: "2026-07-21" },
  { description: "SHELL PETROL BRAINTREE", amount: -65.20, date: "2026-07-20" },
  { description: "AMAZON.UK RETAIL", amount: -34.50, date: "2026-07-19" },
  { description: "BARCLAYCARD PAYMENT", amount: -145.00, date: "2026-07-18" },
  { description: "UNIVERSAL CREDIT DWP", amount: 368.74, date: "2026-07-17" },
  { description: "BOOTS PHARMACY", amount: -12.40, date: "2026-07-16" },
  { description: "SKY DIGITAL SUBSCRIPTION", amount: -42.00, date: "2026-07-15" },
];

function BankTransactionImportSection({ caseId, caseData }: { caseId: string | null; caseData: DebtCase | null }) {
  const { data: txns, loading, reload } = useDebtBankTransactions(caseId);
  const [showImport, setShowImport] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [bulkImporting, setBulkImporting] = useState(false);

  async function handleMockImport() {
    if (!caseId) return;
    setImporting(true); setImportError(null); setImportSuccess(null);
    try {
      const parsed = MOCK_BANK_STATEMENTS.map((t) => parseBankLine(t.description, t.amount, t.date));
      const created = await bulkCreateDebtBankTransactions(caseId, parsed);
      setShowImport(false);
      setImportSuccess(`${created.length} transactions imported and auto-categorized`);
      setTimeout(() => setImportSuccess(null), 4000);
      reload();
    } catch (e) { setImportError((e as Error).message); }
    setImporting(false);
  }

  async function handleManualOverride(txn: DebtBankTransaction, field: "manual_category" | "manual_label", value: string) {
    setImportError(null);
    try {
      if (field === "manual_category") {
        await updateDebtBankTransaction(txn.id, { manual_category: value as DebtSfsCategory });
      } else {
        await updateDebtBankTransaction(txn.id, { manual_label: value || null });
      }
      reload();
    } catch (e) { setImportError((e as Error).message); }
  }

  async function handleImportToSfs(txn: DebtBankTransaction) {
    if (!caseId) return;
    setImportError(null);
    try {
      await importTransactionToSfs(txn, caseId);
      reload();
    } catch (e) { setImportError((e as Error).message); }
  }

  async function handleBulkImportToSfs() {
    if (!caseId) return;
    setBulkImporting(true); setImportError(null);
    try {
      const unimported = txns.filter((t) => !t.imported_to_sfs);
      const count = await bulkImportTransactionsToSfs(unimported, caseId);
      setImportSuccess(`${count} transactions imported into SFS`);
      setTimeout(() => setImportSuccess(null), 4000);
      reload();
    } catch (e) { setImportError((e as Error).message); }
    setBulkImporting(false);
  }

  async function handleDelete(id: string) {
    setImportError(null);
    try { await deleteDebtBankTransaction(id); reload(); }
    catch (e) { setImportError((e as Error).message); }
  }

  if (!caseId || !caseData) return null;

  const unmatchedCount = txns.filter((t) => t.confidence === "unmatched").length;
  const importedCount = txns.filter((t) => t.imported_to_sfs).length;
  const totalExpenses = txns.filter((t) => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);

  return (
    <div className="panel p-4 fade-in">
      {importError && <div className="mb-3 rounded-lg bg-rose-50 px-3 py-1.5 text-xs text-rose-600 dark:bg-rose-500/20 dark:text-rose-300">{importError}</div>}
      {importSuccess && <div className="mb-3 flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-1.5 text-xs text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-300"><CheckCircle2 className="h-3.5 w-3.5" /> {importSuccess}</div>}
      <div className="mb-3 flex items-center justify-between">
        <h4 className="flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-100">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 dark:bg-indigo-500/10"><FileSpreadsheet className="h-4 w-4 text-indigo-600 dark:text-indigo-400" /></span>
          Bank Statement Auto-Categorization
          <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400">Open Banking</span>
        </h4>
        <div className="flex gap-2">
          {txns.length > 0 && txns.some((t) => !t.imported_to_sfs) && (
            <button onClick={handleBulkImportToSfs} disabled={bulkImporting} className="btn btn-primary bg-emerald-600 text-xs hover:bg-emerald-700">
              <Upload className="h-3.5 w-3.5" /> {bulkImporting ? "Importing..." : "Import All to SFS"}
            </button>
          )}
          <button onClick={() => setShowImport(!showImport)} className="btn btn-secondary text-xs">
            <Plus className="h-3.5 w-3.5" /> Import Bank Transactions
          </button>
        </div>
      </div>

      {showImport && (
        <div className="mb-4 rounded-xl border border-indigo-200 bg-indigo-50/50 p-4 fade-in dark:border-indigo-500/30 dark:bg-indigo-500/5">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-100 dark:bg-indigo-500/20">
              <BanknoteIcon className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Import Bank Statement Data</p>
              <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">This simulates an Open Banking feed import. In production, this would connect via a licensed open banking provider and fetch real transaction data with the customer's consent.</p>
              <button onClick={handleMockImport} disabled={importing} className="btn btn-primary bg-indigo-600 text-xs hover:bg-indigo-700">
                <Upload className="h-3.5 w-3.5" /> {importing ? "Parsing..." : "Import Mock Statement (12 transactions)"}
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="skeleton h-32 rounded-lg" />
      ) : txns.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-6 text-slate-400">
          <FileSpreadsheet className="mb-2 h-8 w-8 opacity-30" />
          <p className="text-xs">No bank transactions imported yet — click "Import Bank Transactions" to auto-categorize</p>
        </div>
      ) : (
        <>
          {/* Summary Stats */}
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-lg border border-slate-200 p-2.5 dark:border-slate-700">
              <p className="text-[10px] uppercase text-slate-400">Transactions</p>
              <p className="text-base font-bold text-slate-700 dark:text-slate-200">{txns.length}</p>
            </div>
            <div className="rounded-lg border border-slate-200 p-2.5 dark:border-slate-700">
              <p className="text-[10px] uppercase text-slate-400">Auto-Mapped</p>
              <p className="text-base font-bold text-emerald-600 dark:text-emerald-400">{txns.filter((t) => t.confidence !== "unmatched").length}</p>
            </div>
            <div className="rounded-lg border border-slate-200 p-2.5 dark:border-slate-700">
              <p className="text-[10px] uppercase text-slate-400">Needs Review</p>
              <p className="text-base font-bold text-amber-600 dark:text-amber-400">{unmatchedCount}</p>
            </div>
            <div className="rounded-lg border border-slate-200 p-2.5 dark:border-slate-700">
              <p className="text-[10px] uppercase text-slate-400">In SFS</p>
              <p className="text-base font-bold text-indigo-600 dark:text-indigo-400">{importedCount}/{txns.length}</p>
            </div>
          </div>

          {/* Transaction Table */}
          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-800/50">
                <tr>
                  <th className="px-4 py-3 font-semibold text-slate-500">Date</th>
                  <th className="px-4 py-3 font-semibold text-slate-500">Description</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-500">Amount</th>
                  <th className="px-4 py-3 font-semibold text-slate-500">Auto-Category</th>
                  <th className="px-4 py-3 font-semibold text-slate-500">Confidence</th>
                  <th className="px-4 py-3 font-semibold text-slate-500">Override</th>
                  <th className="px-4 py-3 text-center font-semibold text-slate-500">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                {txns.map((txn) => {
                  const conf = CONFIDENCE_META[txn.confidence] ?? CONFIDENCE_META.unmatched;
                  const effectiveCategory = txn.manual_category ?? txn.auto_category;
                  const effectiveLabel = txn.manual_label ?? txn.auto_label;
                  const catMeta = SFS_CATEGORY_META[effectiveCategory as DebtSfsCategory];
                  return (
                    <tr key={txn.id} className="transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/30">
                      <td className="whitespace-nowrap px-4 py-3 text-slate-500 dark:text-slate-400">{new Date(txn.transaction_date).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}</td>
                      <td className="px-4 py-3 font-medium text-slate-700 dark:text-slate-200">{txn.description}</td>
                      <td className={`whitespace-nowrap px-4 py-3 text-right font-mono font-medium ${txn.amount > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-slate-600 dark:text-slate-300"}`}>{txn.amount > 0 ? "+" : ""}{formatCurrency(Math.abs(txn.amount))}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-md px-2 py-0.5 text-[10px] font-medium ${catMeta.color} ${catMeta.bg ?? ""}`}>{effectiveLabel}</span>
                        {txn.manual_category && <span className="ml-1 text-[9px] text-slate-400">(override)</span>}
                      </td>
                      <td className="px-4 py-3"><span className={`rounded-md px-2 py-0.5 text-[10px] font-medium ${conf.color} ${conf.bg}`}>{conf.label}</span></td>
                      <td className="px-4 py-3">
                        <select
                          value={txn.manual_category ?? ""}
                          onChange={(e) => handleManualOverride(txn, "manual_category", e.target.value)}
                          className="input h-7 w-full text-[11px] py-0"
                        >
                          <option value="">Auto ({txn.auto_label})</option>
                          {Object.entries(SFS_CATEGORY_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                        </select>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {txn.imported_to_sfs ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="h-3 w-3" /> In SFS</span>
                        ) : (
                          <div className="flex items-center justify-center gap-1">
                            <button onClick={() => handleImportToSfs(txn)} className="rounded-md bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-600 hover:bg-indigo-100 dark:bg-indigo-500/10 dark:text-indigo-400 dark:hover:bg-indigo-500/20">Import</button>
                            <button onClick={() => handleDelete(txn.id)} className="rounded-md p-1 text-slate-300 hover:text-rose-500"><Trash2 className="h-3 w-3" /></button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ============================================================
// Annual SFS Review Tracker Widget (Dashboard)
// ============================================================

const REVIEW_URGENCY_META: Record<string, { color: string; bg: string; border: string; icon: React.ReactNode; label: string }> = {
  overdue: { color: "text-rose-600", bg: "bg-rose-50 dark:bg-rose-500/10", border: "border-rose-300 dark:border-rose-500/30", icon: <AlertCircle className="h-5 w-5" />, label: "Overdue" },
  critical: { color: "text-orange-600", bg: "bg-orange-50 dark:bg-orange-500/10", border: "border-orange-300 dark:border-orange-500/30", icon: <Clock className="h-5 w-5" />, label: "Critical" },
  warning: { color: "text-amber-600", bg: "bg-amber-50 dark:bg-amber-500/10", border: "border-amber-200 dark:border-amber-500/20", icon: <Clock className="h-5 w-5" />, label: "Warning" },
  ok: { color: "text-emerald-600", bg: "bg-emerald-50 dark:bg-emerald-500/10", border: "border-emerald-200 dark:border-emerald-500/20", icon: <CalendarClock className="h-5 w-5" />, label: "On Track" },
};

function AnnualReviewTrackerWidget({ caseId, caseData }: { caseId: string | null; caseData: DebtCase | null }) {
  const { data: reviews, loading, reload } = useDebtAnnualReviews(caseId);
  const { data: sfsEntries } = useDebtSfsEntries(caseId);
  const { data: profile } = useDebtCustomerProfile(caseId);
  const [initiating, setInitiating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [selectedReview, setSelectedReview] = useState<DebtAnnualReview | null>(null);

  if (!caseId || !caseData) return null;

  const nextDueDate = calculateNextReviewDueDate(caseData.created_at, reviews);
  const countdown = getReviewCountdown(nextDueDate);
  const urgencyMeta = REVIEW_URGENCY_META[countdown.urgency];
  const completedReviews = reviews.filter((r) => r.status === "completed").length;
  const latestReview = reviews[0];

  async function handleInitiateReview() {
    if (!caseId || !caseData) return;
    setInitiating(true); setError(null);
    try {
      await initiateAnnualReview(caseId, caseData, sfsEntries, profile, reviews);
      reload();
    } catch (e) { setError((e as Error).message); }
    setInitiating(false);
  }

  async function handleCompleteReview(reviewId: string) {
    setError(null);
    try { await completeAnnualReview(reviewId); reload(); }
    catch (e) { setError((e as Error).message); }
  }

  function handleViewReview(review: DebtAnnualReview) {
    setSelectedReview(review);
    setShowReviewModal(true);
  }

  if (loading) return <div className="skeleton h-28 rounded-xl" />;

  return (
    <>
      {error && <div className="mb-3 rounded-xl bg-rose-50 px-4 py-2 text-sm text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">{error}</div>}
      <div className={`panel border-2 p-4 fade-in ${urgencyMeta.border} ${urgencyMeta.bg}`}>
        <div className="flex flex-wrap items-center gap-4">
          {/* Icon + Countdown */}
          <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${urgencyMeta.color} ${urgencyMeta.bg}`}>
            {urgencyMeta.icon}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h4 className={`text-sm font-bold ${urgencyMeta.color}`}>Annual SFS Review {countdown.label}</h4>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${urgencyMeta.color} ${urgencyMeta.bg}`}>{urgencyMeta.label}</span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {reviews.length === 0 ? "No annual review has been initiated yet. " : `Review #${latestReview?.review_number} — ${latestReview?.status}. `}
              Due: <span className="font-medium text-slate-700 dark:text-slate-200">{nextDueDate.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</span>
              {completedReviews > 0 && ` · ${completedReviews} completed review${completedReviews > 1 ? "s" : ""}`}
            </p>
          </div>
          {/* Action Buttons */}
          <div className="flex items-center gap-2">
            {latestReview?.status === "in_progress" && (
              <button onClick={() => handleCompleteReview(latestReview.id)} className="btn btn-primary bg-emerald-600 text-xs hover:bg-emerald-700">
                <CheckCircle2 className="h-3.5 w-3.5" /> Complete Review
              </button>
            )}
            <button onClick={handleInitiateReview} disabled={initiating} className="btn btn-primary text-xs">
              <RefreshCw className={`h-3.5 w-3.5 ${initiating ? "animate-spin" : ""}`} /> {initiating ? "Initiating..." : "Initiate Annual Review"}
            </button>
          </div>
        </div>

        {/* Milestone Timeline */}
        {reviews.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {reviews.slice(0, 5).map((r) => {
              const rStatus = r.status === "completed" ? "ok" : r.status === "in_progress" ? "warning" : "critical";
              const rMeta = REVIEW_URGENCY_META[rStatus];
              return (
                <button
                  key={r.id}
                  onClick={() => handleViewReview(r)}
                  className={`group flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs transition-all hover:shadow-sm ${rMeta.border} ${rMeta.bg}`}
                >
                  <span className={`font-bold ${rMeta.color}`}>#{r.review_number}</span>
                  <span className="text-slate-500 dark:text-slate-400">{new Date(r.review_date).toLocaleDateString("en-GB", { month: "short", year: "numeric" })}</span>
                  {r.status === "completed" && <CheckCircle2 className="h-3 w-3 text-emerald-500" />}
                  {r.status === "in_progress" && <Clock className="h-3 w-3 text-amber-500" />}
                  <Eye className="h-3 w-3 text-slate-300 opacity-0 transition-opacity group-hover:opacity-100" />
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Annual Review Detail Modal */}
      {showReviewModal && selectedReview && (
        <AnnualReviewDetailModal review={selectedReview} previousReview={reviews.find((r) => r.id === selectedReview.previous_review_id) ?? null} onClose={() => setShowReviewModal(false)} />
      )}
    </>
  );
}

// ============================================================
// Annual Review Detail Modal (Year-on-Year SFS Audit)
// ============================================================

function AnnualReviewDetailModal({ review, previousReview, onClose }: { review: DebtAnnualReview; previousReview: DebtAnnualReview | null; onClose: () => void }) {
  const comparisonFields = (review.audit_log?.comparison_fields as Array<{ field: string; previous: string; current: string; changed: boolean }>) ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 fade-in" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 dark:bg-blue-500/10">
              <ClipboardCheck className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Annual SFS Review #{review.review_number}</h3>
              <p className="text-xs text-slate-400">Initiated {new Date(review.review_date).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"><X className="h-5 w-5" /></button>
        </div>

        <div className="space-y-4 p-6">
          {/* Status Banner */}
          <div className={`flex items-center gap-3 rounded-xl border p-3 ${review.status === "completed" ? "border-emerald-200 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10" : "border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10"}`}>
            <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${review.status === "completed" ? "bg-emerald-100 dark:bg-emerald-500/20" : "bg-amber-100 dark:bg-amber-500/20"}`}>
              {review.status === "completed" ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Clock className="h-4 w-4 text-amber-600" />}
            </div>
            <div>
              <p className={`text-sm font-bold ${review.status === "completed" ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}`}>Status: {review.status.replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase())}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">Due: {new Date(review.review_due_date).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</p>
            </div>
          </div>

          {/* Snapshot Summary */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
              <p className="text-[10px] uppercase text-slate-400">Income</p>
              <p className="text-lg font-bold text-slate-700 dark:text-slate-200">{formatCurrency(review.snapshot_income)}</p>
            </div>
            <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
              <p className="text-[10px] uppercase text-slate-400">Essential Exp.</p>
              <p className="text-lg font-bold text-slate-700 dark:text-slate-200">{formatCurrency(review.snapshot_essential_expenses)}</p>
            </div>
            <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
              <p className="text-[10px] uppercase text-slate-400">Disposable</p>
              <p className="text-lg font-bold text-slate-700 dark:text-slate-200">{formatCurrency(review.snapshot_disposable_income)}</p>
            </div>
            <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
              <p className="text-[10px] uppercase text-slate-400">Total Debt</p>
              <p className="text-lg font-bold text-slate-700 dark:text-slate-200">{formatCurrency(review.snapshot_total_debt)}</p>
            </div>
          </div>

          {/* Change Flags */}
          {previousReview && (
            <div className="flex flex-wrap gap-2">
              <div className={`flex items-center gap-2 rounded-lg px-3 py-2 ${review.income_change !== 0 ? "bg-blue-50 dark:bg-blue-500/10" : "bg-slate-50 dark:bg-slate-800/50"}`}>
                <TrendingUp className={`h-4 w-4 ${review.income_change > 0 ? "text-emerald-600" : review.income_change < 0 ? "text-rose-500" : "text-slate-400"}`} />
                <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Income Change: <span className={review.income_change > 0 ? "text-emerald-600" : review.income_change < 0 ? "text-rose-500" : "text-slate-400"}>{review.income_change >= 0 ? "+" : ""}{formatCurrency(review.income_change)}/mo</span></span>
              </div>
              <div className={`flex items-center gap-2 rounded-lg px-3 py-2 ${review.housing_change ? "bg-orange-50 dark:bg-orange-500/10" : "bg-slate-50 dark:bg-slate-800/50"}`}>
                <Home className={`h-4 w-4 ${review.housing_change ? "text-orange-600" : "text-slate-400"}`} />
                <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Housing Change: <span className={review.housing_change ? "text-orange-600" : "text-slate-400"}>{review.housing_change ? "Yes" : "No"}</span></span>
              </div>
            </div>
          )}

          {/* Year-on-Year Audit Log */}
          {comparisonFields.length > 0 ? (
            <div>
              <h4 className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-100">
                <GitBranch className="h-4 w-4 text-blue-500" /> Year-on-Year SFS Audit Log
              </h4>
              <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800/50">
                    <tr>
                      <th className="px-3 py-2 font-semibold text-slate-500">Field</th>
                      <th className="px-3 py-2 font-semibold text-slate-500">Previous (#{previousReview?.review_number ?? "—"})</th>
                      <th className="px-3 py-2 font-semibold text-slate-500">Current</th>
                      <th className="px-3 py-2 text-center font-semibold text-slate-500">Changed?</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                    {comparisonFields.map((f, i) => (
                      <tr key={i} className={f.changed ? "bg-amber-50/50 dark:bg-amber-500/5" : ""}>
                        <td className="px-3 py-2 font-medium text-slate-600 dark:text-slate-300">{f.field}</td>
                        <td className="px-3 py-2 text-slate-500 dark:text-slate-400">{f.previous}</td>
                        <td className="px-3 py-2 font-medium text-slate-700 dark:text-slate-200">{f.current}</td>
                        <td className="px-3 py-2 text-center">{f.changed ? <ArrowLeftRight className="mx-auto h-3.5 w-3.5 text-amber-500" /> : <Check className="mx-auto h-3.5 w-3.5 text-emerald-500" />}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="rounded-lg bg-slate-50 p-4 text-center dark:bg-slate-800/50">
              <p className="text-xs text-slate-400">This is the first annual review — a baseline snapshot has been created for future year-on-year comparisons.</p>
            </div>
          )}

          {/* Property & Housing Snapshot */}
          {review.snapshot_property_value !== null && (
            <div className="flex gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
              <Home className="h-4 w-4 text-slate-400" />
              <div className="text-xs">
                <span className="font-medium text-slate-600 dark:text-slate-300">Housing Snapshot: </span>
                <span className="text-slate-500 dark:text-slate-400">{review.snapshot_tenure_type ?? "N/A"} · Property value: {formatCurrency(review.snapshot_property_value ?? 0)}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Vulnerability & Safeguarding Tab
// ============================================================

const VULNERABILITY_LEVEL_META: Record<DebtVulnerabilityLevel, { label: string; color: string; bg: string; border: string; icon: React.ReactNode; badge: string }> = {
  none: { label: "No Vulnerability", color: "text-slate-600", bg: "bg-slate-50", border: "border-slate-200", icon: <ShieldCheck className="h-4 w-4" />, badge: "text-slate-600 bg-slate-100 dark:bg-slate-700 dark:text-slate-300" },
  low: { label: "Low Vulnerability", color: "text-blue-600", bg: "bg-blue-50", border: "border-blue-200", icon: <ShieldCheck className="h-4 w-4" />, badge: "text-blue-600 bg-blue-50 dark:bg-blue-500/10 dark:text-blue-400" },
  medium: { label: "Medium Vulnerability", color: "text-amber-600", bg: "bg-amber-50", border: "border-amber-200", icon: <ShieldAlert className="h-4 w-4" />, badge: "text-amber-600 bg-amber-50 dark:bg-amber-500/10 dark:text-amber-400" },
  high: { label: "High Vulnerability — Priority Care Required", color: "text-orange-600", bg: "bg-orange-50", border: "border-orange-300", icon: <ShieldAlert className="h-4 w-4" />, badge: "text-orange-600 bg-orange-50 dark:bg-orange-500/10 dark:text-orange-400" },
  critical: { label: "Critical Vulnerability — Immediate Safeguarding", color: "text-rose-600", bg: "bg-rose-50", border: "border-rose-300", icon: <ShieldAlert className="h-4 w-4" />, badge: "text-rose-600 bg-rose-50 dark:bg-rose-500/10 dark:text-rose-400" },
};

const VULNERABILITY_CATEGORY_META: Record<string, { icon: React.ReactNode; color: string }> = {
  "Financial Capability": { icon: <Wallet className="h-4 w-4" />, color: "text-blue-600" },
  "Health Conditions": { icon: <HeartPulse className="h-4 w-4" />, color: "text-rose-600" },
  "Life Events": { icon: <LifeBuoy className="h-4 w-4" />, color: "text-amber-600" },
  "Resilience": { icon: <ShieldAlert className="h-4 w-4" />, color: "text-purple-600" },
};

const COMM_CHANNEL_META: Record<string, { label: string; icon: React.ReactNode; description: string }> = {
  phone: { label: "Phone", icon: <Phone className="h-4 w-4" />, description: "Dedicated phone line — advisor-led calls" },
  email: { label: "Email", icon: <Mail className="h-4 w-4" />, description: "Written communication with clear formatting" },
  letter: { label: "Letter", icon: <FileText className="h-4 w-4" />, description: "Physical correspondence in plain language" },
  in_person: { label: "In-Person", icon: <Users className="h-4 w-4" />, description: "Face-to-face appointment with support worker" },
};

function VulnerabilityTab({ caseId, caseData }: { caseId: string | null; caseData: DebtCase | null }) {
  const { data: assessment, loading, reload } = useDebtVulnerabilityAssessment(caseId);
  const [actionError, setActionError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (assessment) setNotes(assessment.notes ?? "");
  }, [assessment]);

  const flags: Record<string, boolean> = useMemo(() => {
    if (!assessment) return {};
    const result: Record<string, boolean> = {};
    for (const item of VULNERABILITY_CHECKLIST) {
      result[item.key] = (assessment as unknown as Record<string, unknown>)[item.key] as boolean;
    }
    return result;
  }, [assessment]);

  const { score, level } = useMemo(() => calculateVulnerabilityScore(flags), [flags]);
  const recommendedChannel = useMemo(() => getRecommendedCommChannel(level, flags), [level, flags]);
  const levelMeta = VULNERABILITY_LEVEL_META[level];
  const isPriority = level === "high" || level === "critical";

  async function handleToggleFlag(key: string, value: boolean) {
    if (!caseId) return;
    setActionError(null);
    try {
      const currentFlags = { ...flags, [key]: value };
      const { score: newScore, level: newLevel } = calculateVulnerabilityScore(currentFlags);
      const newChannel = getRecommendedCommChannel(newLevel, currentFlags);
      const newPriority = newLevel === "high" || newLevel === "critical";
      await upsertDebtVulnerabilityAssessment(caseId, {
        [key]: value,
        vulnerability_score: newScore,
        vulnerability_level: newLevel,
        preferred_comm_channel: newChannel,
        priority_flag: newPriority,
      });
      reload();
    } catch (e) { setActionError((e as Error).message); }
  }

  async function handleSaveNotes() {
    if (!caseId) return;
    setActionError(null);
    try {
      await upsertDebtVulnerabilityAssessment(caseId, { notes, assessed_by: "Advisor" });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
      reload();
    } catch (e) { setActionError((e as Error).message); }
  }

  if (!caseData) return <div className="flex h-full items-center justify-center text-sm text-slate-400">Select a case to assess vulnerability</div>;
  if (loading) return <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="skeleton h-32 rounded-xl" />)}</div>;

  const categories = [...new Set(VULNERABILITY_CHECKLIST.map((c) => c.category))];

  return (
    <div className="space-y-4">
      {actionError && <div className="rounded-xl bg-rose-50 px-4 py-2 text-sm text-rose-700 dark:bg-rose-500/20 dark:text-rose-300 fade-in">{actionError}</div>}
      {saveSuccess && <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300 fade-in"><CheckCircle2 className="h-4 w-4" /> Assessment notes saved</div>}

      {/* Vulnerability Badge Banner */}
      <div className={`panel flex flex-wrap items-center gap-4 border-2 p-4 fade-in ${levelMeta.border} ${levelMeta.bg}`}>
        <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${levelMeta.badge}`}>
          {levelMeta.icon}
        </div>
        <div className="flex-1">
          <p className="text-sm font-bold ${levelMeta.color}">{levelMeta.label}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">Vulnerability Score: <span className="font-bold">{score}/100</span> · {Object.values(flags).filter(Boolean).length} indicators flagged</p>
        </div>
        {isPriority && (
          <div className="flex items-center gap-2 rounded-lg bg-rose-100 px-3 py-1.5 text-xs font-bold text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">
            <Award className="h-3.5 w-3.5" /> Priority Account
          </div>
        )}
      </div>

      {/* Preferred Communication Channel */}
      <div className="panel flex flex-wrap items-center gap-3 p-4 fade-in">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 dark:bg-blue-500/10">
          {COMM_CHANNEL_META[recommendedChannel]?.icon ?? <Phone className="h-4 w-4 text-blue-600" />}
        </div>
        <div className="flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Advisor Preferred Communication Channel</p>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            <span className="font-bold text-blue-600 dark:text-blue-400">{COMM_CHANNEL_META[recommendedChannel]?.label ?? "Phone"}</span> — {COMM_CHANNEL_META[recommendedChannel]?.description ?? "Dedicated phone line"}
          </p>
        </div>
        {isPriority && (
          <span className="rounded-full bg-rose-50 px-3 py-1 text-xs font-medium text-rose-600 dark:bg-rose-500/10 dark:text-rose-400">
            Auto-flagged: Priority Care
          </span>
        )}
      </div>

      {/* Checklist Grid */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {categories.map((category) => {
          const catMeta = VULNERABILITY_CATEGORY_META[category];
          const items = VULNERABILITY_CHECKLIST.filter((c) => c.category === category);
          const flaggedCount = items.filter((c) => flags[c.key]).length;
          return (
            <div key={category} className="panel p-4 fade-in">
              <div className="mb-3 flex items-center justify-between">
                <h4 className={`flex items-center gap-2 text-sm font-bold ${catMeta.color}`}>
                  {catMeta.icon} {category}
                </h4>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${flaggedCount > 0 ? "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400" : "bg-slate-100 text-slate-400 dark:bg-slate-700"}`}>
                  {flaggedCount}/{items.length} flagged
                </span>
              </div>
              <div className="space-y-2">
                {items.map((item) => (
                  <label key={item.key} className="flex cursor-pointer items-start gap-3 rounded-lg p-2 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/30">
                    <button
                      type="button"
                      onClick={() => handleToggleFlag(item.key, !flags[item.key])}
                      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded transition-colors ${
                        flags[item.key]
                          ? "bg-rose-500 text-white"
                          : "border border-slate-300 dark:border-slate-600"
                      }`}
                    >
                      {flags[item.key] && <Check className="h-3 w-3" />}
                    </button>
                    <div className="flex-1">
                      <p className={`text-sm ${flags[item.key] ? "font-medium text-slate-700 dark:text-slate-200" : "text-slate-500 dark:text-slate-400"}`}>{item.label}</p>
                      <p className="text-[10px] text-slate-400">Weight: {item.weight} pts</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Advisor Notes */}
      <div className="panel p-4 fade-in">
        <h4 className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-100">
          <FileText className="h-4 w-4 text-slate-400" /> Assessment Notes & Safeguarding Actions
        </h4>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          className="input text-sm"
          placeholder="Document any safeguarding actions taken, referrals made, or special arrangements..."
        />
        <button onClick={handleSaveNotes} className="btn btn-primary bg-emerald-600 mt-2 text-sm hover:bg-emerald-700">
          <Save className="h-4 w-4" /> Save Assessment
        </button>
      </div>
    </div>
  );
}

// ============================================================
// Solution Suitability Matrix Modal
// ============================================================

function SolutionSuitabilityMatrixModal({ caseData, caseId, onClose }: { caseData: DebtCase; caseId: string | null; onClose: () => void }) {
  const { data: creditors } = useDebtCreditors(caseId);
  const { data: profile } = useDebtCustomerProfile(caseId);

  const totalDebt = caseData.total_debt || creditors.reduce((s, c) => s + c.current_balance, 0);
  const disposableIncome = caseData.monthly_disposable_income;
  const hasAssets = (profile?.property_value ?? 0) > 0;
  const propertyValue = profile?.property_value ?? null;
  const outstandingMortgage = profile?.outstanding_mortgage_or_rent ?? null;

  const solutions = useMemo(
    () => evaluateSolutionSuitability({ totalDebt, disposableIncome, hasAssets, propertyValue, outstandingMortgage }),
    [totalDebt, disposableIncome, hasAssets, propertyValue, outstandingMortgage],
  );

  const recommended = solutions.find((s) => s.suitability === "recommended");

  const SUITABILITY_META: Record<string, { color: string; bg: string; border: string; icon: React.ReactNode }> = {
    recommended: { color: "text-emerald-600", bg: "bg-emerald-50", border: "border-emerald-300", icon: <ThumbsUp className="h-4 w-4" /> },
    suitable: { color: "text-blue-600", bg: "bg-blue-50", border: "border-blue-200", icon: <CheckCircle2 className="h-4 w-4" /> },
    conditional: { color: "text-amber-600", bg: "bg-amber-50", border: "border-amber-200", icon: <CircleDot className="h-4 w-4" /> },
    not_suitable: { color: "text-slate-400", bg: "bg-slate-50", border: "border-slate-200", icon: <ThumbsDown className="h-4 w-4" /> },
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 fade-in" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-6xl overflow-y-auto rounded-2xl bg-white shadow-2xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 dark:bg-blue-500/10">
              <Columns3 className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Solution Suitability Matrix</h3>
              <p className="text-xs text-slate-400">FCA-aligned comparison of debt solutions for {caseData.case_number}</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"><X className="h-5 w-5" /></button>
        </div>

        <div className="p-6">
          {/* Case Summary */}
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
              <p className="text-[10px] uppercase text-slate-400">Total Debt</p>
              <p className="text-lg font-bold text-slate-700 dark:text-slate-200">{formatCurrency(totalDebt)}</p>
            </div>
            <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
              <p className="text-[10px] uppercase text-slate-400">Disposable Income</p>
              <p className="text-lg font-bold text-slate-700 dark:text-slate-200">{formatCurrency(disposableIncome)}</p>
            </div>
            <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
              <p className="text-[10px] uppercase text-slate-400">Property Value</p>
              <p className="text-lg font-bold text-slate-700 dark:text-slate-200">{propertyValue ? formatCurrency(propertyValue) : "—"}</p>
            </div>
            <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
              <p className="text-[10px] uppercase text-slate-400">Creditors</p>
              <p className="text-lg font-bold text-slate-700 dark:text-slate-200">{creditors.length}</p>
            </div>
          </div>

          {/* FCA Recommendation Banner */}
          {recommended && (
            <div className="mb-4 flex items-center gap-3 rounded-xl border-2 border-emerald-300 bg-emerald-50 p-4 dark:border-emerald-500/30 dark:bg-emerald-500/10">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-500/20">
                <Sparkles className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <p className="text-sm font-bold text-emerald-700 dark:text-emerald-300">FCA-Aligned Recommended Path: {recommended.name}</p>
                <p className="text-xs text-emerald-600 dark:text-emerald-400">{recommended.description}</p>
              </div>
            </div>
          )}

          {/* Solution Cards Grid */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {solutions.map((sol) => {
              const meta = SUITABILITY_META[sol.suitability];
              return (
                <div key={sol.name} className={`rounded-xl border-2 p-4 transition-all ${meta.border} ${meta.bg} ${sol.suitability === "recommended" ? "ring-2 ring-emerald-400" : ""}`}>
                  {/* Header */}
                  <div className="mb-3 flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      {sol.name.includes("DMP") && <Calculator className="h-4 w-4 text-blue-600" />}
                      {sol.name.includes("DRO") && <ShieldCheck className="h-4 w-4 text-teal-600" />}
                      {sol.name.includes("IVA") && <FileText className="h-4 w-4 text-purple-600" />}
                      {sol.name.includes("Settlement") && <Handshake className="h-4 w-4 text-amber-600" />}
                      {sol.name.includes("Bankruptcy") && <Gavel className="h-4 w-4 text-rose-600" />}
                      <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100">{sol.name}</h4>
                    </div>
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${meta.color} ${meta.bg}`}>
                      {meta.icon} {sol.suitabilityLabel}
                    </span>
                  </div>

                  <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">{sol.description}</p>

                  {/* Key Metrics */}
                  <div className="mb-3 grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-lg bg-white/50 p-2 dark:bg-slate-800/50">
                      <p className="text-slate-400">Duration</p>
                      <p className="font-bold text-slate-700 dark:text-slate-200">{sol.estimatedDurationMonths} months</p>
                    </div>
                    <div className="rounded-lg bg-white/50 p-2 dark:bg-slate-800/50">
                      <p className="text-slate-400">Monthly Payment</p>
                      <p className="font-bold text-slate-700 dark:text-slate-200">{sol.estimatedMonthlyPayment > 0 ? formatCurrency(sol.estimatedMonthlyPayment) : "None"}</p>
                    </div>
                    <div className="rounded-lg bg-white/50 p-2 dark:bg-slate-800/50">
                      <p className="text-slate-400">Total Repayable</p>
                      <p className="font-bold text-slate-700 dark:text-slate-200">{formatCurrency(sol.totalRepayable)}</p>
                    </div>
                    <div className="rounded-lg bg-white/50 p-2 dark:bg-slate-800/50">
                      <p className="text-slate-400">Debt Written Off</p>
                      <p className="font-bold text-emerald-600 dark:text-emerald-400">{sol.debtWriteoff > 0 ? formatCurrency(sol.debtWriteoff) : "None"}</p>
                    </div>
                  </div>

                  {/* Eligibility */}
                  <div className="mb-3 space-y-1">
                    <p className="text-[10px] font-semibold uppercase text-slate-400">Eligibility</p>
                    {sol.eligibility.map((e, i) => (
                      <div key={i} className="flex items-center gap-2 text-[10px]">
                        {e.met ? <Check className="h-3 w-3 text-emerald-500" /> : <X className="h-3 w-3 text-rose-400" />}
                        <span className={e.met ? "text-slate-600 dark:text-slate-300" : "text-slate-400"}>{e.detail}</span>
                      </div>
                    ))}
                  </div>

                  {/* Pros & Cons */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <p className="mb-1 text-[10px] font-semibold uppercase text-emerald-500">Pros</p>
                      {sol.pros.map((p, i) => <p key={i} className="text-[10px] text-slate-500 dark:text-slate-400">+ {p}</p>)}
                    </div>
                    <div>
                      <p className="mb-1 text-[10px] font-semibold uppercase text-rose-500">Cons</p>
                      {sol.cons.map((c, i) => <p key={i} className="text-[10px] text-slate-500 dark:text-slate-400">- {c}</p>)}
                    </div>
                  </div>

                  {sol.fcaAligned && (
                    <div className="mt-3 flex items-center gap-1.5 rounded-lg bg-white/50 px-2 py-1 text-[10px] text-emerald-600 dark:bg-slate-800/50 dark:text-emerald-400">
                      <ShieldCheck className="h-3 w-3" /> FCA-aligned solution
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Disbursement & Negotiation Tab
// ============================================================

const PAYMENT_STATUS_META: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  scheduled: { label: "Pending", color: "text-amber-600 bg-amber-50 dark:bg-amber-500/10 dark:text-amber-400", icon: <Clock className="h-3 w-3" /> },
  processing: { label: "Clearing", color: "text-blue-600 bg-blue-50 dark:bg-blue-500/10 dark:text-blue-400", icon: <ArrowRight className="h-3 w-3" /> },
  sent: { label: "Distributed", color: "text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10 dark:text-emerald-400", icon: <CheckCircle2 className="h-3 w-3" /> },
  failed: { label: "Bounced", color: "text-rose-600 bg-rose-50 dark:bg-rose-500/10 dark:text-rose-400", icon: <XCircle className="h-3 w-3" /> },
};

const NEGOTIATION_EVENT_META: Record<DebtNegotiationEventType, { label: string; color: string; icon: React.ReactNode }> = {
  offer_pack_sent: { label: "Offer Pack Sent", color: "text-blue-600 bg-blue-50 dark:bg-blue-500/10 dark:text-blue-400", icon: <Mail className="h-3.5 w-3.5" /> },
  hold_placed: { label: "Hold Placed", color: "text-amber-600 bg-amber-50 dark:bg-amber-500/10 dark:text-amber-400", icon: <Clock className="h-3.5 w-3.5" /> },
  interest_freeze_accepted: { label: "Interest Freeze Accepted", color: "text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10 dark:text-emerald-400", icon: <Snowflake className="h-3.5 w-3.5" /> },
  interest_freeze_rejected: { label: "Interest Freeze Rejected", color: "text-rose-600 bg-rose-50 dark:bg-rose-500/10 dark:text-rose-400", icon: <XCircle className="h-3.5 w-3.5" /> },
  full_offer_accepted: { label: "Full Offer Accepted", color: "text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10 dark:text-emerald-400", icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
  full_offer_rejected: { label: "Full Offer Rejected", color: "text-rose-600 bg-rose-50 dark:bg-rose-500/10 dark:text-rose-400", icon: <XCircle className="h-3.5 w-3.5" /> },
  counter_offer_received: { label: "Counter-Offer Received", color: "text-amber-600 bg-amber-50 dark:bg-amber-500/10 dark:text-amber-400", icon: <MessageSquare className="h-3.5 w-3.5" /> },
  follow_up_call: { label: "Follow-Up Call", color: "text-slate-600 bg-slate-100 dark:bg-slate-700 dark:text-slate-300", icon: <MessageSquare className="h-3.5 w-3.5" /> },
  winding_up_threat: { label: "Winding-Up Threat", color: "text-rose-600 bg-rose-50 dark:bg-rose-500/10 dark:text-rose-400", icon: <AlertCircle className="h-3.5 w-3.5" /> },
  agreement_reached: { label: "Agreement Reached", color: "text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10 dark:text-emerald-400", icon: <Handshake className="h-3.5 w-3.5" /> },
};

const NEGOTIATION_EVENT_OPTIONS: { type: DebtNegotiationEventType; label: string }[] = [
  { type: "offer_pack_sent", label: "Offer Pack Sent" },
  { type: "hold_placed", label: "Hold Placed" },
  { type: "interest_freeze_accepted", label: "Interest Freeze Accepted" },
  { type: "interest_freeze_rejected", label: "Interest Freeze Rejected" },
  { type: "full_offer_accepted", label: "Full Offer Accepted" },
  { type: "full_offer_rejected", label: "Full Offer Rejected" },
  { type: "counter_offer_received", label: "Counter-Offer Received" },
  { type: "follow_up_call", label: "Follow-Up Call" },
  { type: "winding_up_threat", label: "Winding-Up Threat" },
  { type: "agreement_reached", label: "Agreement Reached" },
];

function DisbursementTab({ caseId, caseData }: { caseId: string | null; caseData: DebtCase | null }) {
  const { data: creditors, loading: creditorsLoading, reload: reloadCreditors } = useDebtCreditors(caseId);
  const { data: payments, loading: paymentsLoading, reload: reloadPayments } = useDebtPayments(caseId);
  const { data: distributions, loading: distLoading, reload: reloadDist } = useDebtDistributions(caseId);
  const { data: negotiations, loading: negLoading, reload: reloadNeg } = useDebtNegotiations(caseId);

  const [showLogPayment, setShowLogPayment] = useState(false);
  const [showNegForm, setShowNegForm] = useState(false);
  const [negCreditorId, setNegCreditorId] = useState("");
  const [negEventType, setNegEventType] = useState<DebtNegotiationEventType>("offer_pack_sent");
  const [negNotes, setNegNotes] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Payment form state
  const [payAmount, setPayAmount] = useState("");
  const [payDate, setPayDate] = useState(new Date().toISOString().split("T")[0]);
  const [payReference, setPayReference] = useState("");

  // Shortfall recalulation state
  const [showShortfallBanner, setShowShortfallBanner] = useState(false);
  const [shortfallPayment, setShortfallPayment] = useState<DebtPayment | null>(null);
  const [recalculating, setRecalculating] = useState(false);

  // Payment distribution filter
  const [distFilter, setDistFilter] = useState<string>("all");

  const expectedMonthly = caseData?.monthly_disposable_income ?? 0;
  const totalDebt = creditors.reduce((s, c) => s + c.current_balance, 0);
  const totalDistributed = distributions.reduce((s, d) => s + d.amount, 0);

  // Detect shortfall in most recent payment
  const latestPayment = payments[0] ?? null;
  const hasActiveShortfall = latestPayment?.is_shortfall ?? false;

  // Live pro-rata for forecast sync indicator
  const liveProRata = useMemo(
    () => calculateProRataSimple(caseData?.monthly_disposable_income ?? 0, creditors),
    [caseData?.monthly_disposable_income, creditors],
  );
  const totalLiveProRata = liveProRata.reduce((s, p) => s + p.pro_rata_amount, 0);

  // Latest negotiation status per creditor
  const latestNegotiations = useMemo(
    () => getLatestNegotiationPerCreditor(negotiations),
    [negotiations],
  );

  // Group distributions by payment date for the execution view
  const distributionsByDate = useMemo(() => {
    const grouped = new Map<string, typeof distributions>();
    for (const d of distributions) {
      const key = d.distribution_date;
      const arr = grouped.get(key) ?? [];
      arr.push(d);
      grouped.set(key, arr);
    }
    return Array.from(grouped.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [distributions]);

  // Filtered distributions
  const filteredDistributions = useMemo(() => {
    if (distFilter === "all") return distributions;
    return distributions.filter((d) => d.status === distFilter);
  }, [distributions, distFilter]);

  async function handleLogPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!caseId || !payAmount) return;
    setActionError(null);
    setActionSuccess(null);
    try {
      const amount = parseFloat(payAmount);
      if (isNaN(amount) || amount <= 0) throw new Error("Invalid amount");

      const { splits } = await logMonthlyPayment({
        caseId,
        amount,
        expectedAmount: expectedMonthly,
        paymentDate: payDate,
        reference: payReference || undefined,
        creditors,
      });

      setShowLogPayment(false);
      setPayAmount(""); setPayReference("");
      setActionSuccess(`Payment of ${formatCurrency(amount)} logged and auto-split across ${splits.filter((s) => s.amount > 0).length} creditors`);

      if (amount < expectedMonthly) {
        setShortfallPayment(payments[0] ?? null);
        setShowShortfallBanner(true);
      }

      reloadPayments(); reloadDist(); reloadCreditors();
      setTimeout(() => setActionSuccess(null), 4000);
    } catch (e) { setActionError((e as Error).message); }
  }

  async function handleAddNegotiation(e: React.FormEvent) {
    e.preventDefault();
    if (!caseId || !negCreditorId) return;
    setActionError(null);
    const eventType = negEventType;
    const meta = NEGOTIATION_EVENT_META[eventType];
    const creditor = creditors.find((c) => c.id === negCreditorId);
    if (!creditor) return;

    try {
      await addNegotiationEvent({
        case_id: caseId,
        creditor_id: negCreditorId,
        event_type: eventType,
        event_label: meta.label,
        notes: negNotes || undefined,
        actor: "Advisor",
      });

      // Sync negotiation status to creditor ledger and forecast
      if (eventType === "interest_freeze_accepted") {
        await updateDebtCreditor(creditor.id, { interest_rate: 0 });
      } else if (eventType === "interest_freeze_rejected") {
        // If interest was frozen, unfreeze it back
        if (creditor.interest_rate === 0) {
          await updateDebtCreditor(creditor.id, { interest_rate: 18.9 });
        }
      } else if (eventType === "agreement_reached" || eventType === "full_offer_accepted") {
        await updateDebtCase(caseId, { status: "payment_schedule_active" });
      }

      setShowNegForm(false);
      setNegCreditorId(""); setNegNotes("");
      setActionSuccess(`Negotiation event "${meta.label}" recorded for ${creditor.creditor_name}`);

      reloadNeg(); reloadCreditors();
      setTimeout(() => setActionSuccess(null), 4000);
    } catch (e) { setActionError((e as Error).message); }
  }

  async function handleDistStatusChange(distId: string, status: DebtDistributionStatus) {
    setActionError(null);
    try {
      await updateDebtDistributionStatus(distId, status);
      reloadDist();
    } catch (e) { setActionError((e as Error).message); }
  }

  async function handleRecalcReducedProRata() {
    if (!caseId || !latestPayment) return;
    setRecalculating(true);
    setActionError(null);
    try {
      const reducedAmount = latestPayment.amount;
      await recalcReducedProRata(caseId, reducedAmount, creditors);
      setActionSuccess(`Pro-rata recalculated at ${formatCurrency(reducedAmount)}/month — all creditor splits updated and forecast synced`);
      setShowShortfallBanner(false);
      reloadCreditors(); reloadPayments();
      setTimeout(() => setActionSuccess(null), 5000);
    } catch (e) { setActionError((e as Error).message); }
    setRecalculating(false);
  }

  async function handleDeletePayment(id: string) {
    if (!confirm("Delete this payment record?")) return;
    setActionError(null);
    try {
      await deleteDebtPayment(id);
      reloadPayments();
    } catch (e) { setActionError((e as Error).message); }
  }

  async function handleDeleteNegEvent(id: string) {
    setActionError(null);
    try {
      await deleteNegotiationEvent(id);
      reloadNeg();
    } catch (e) { setActionError((e as Error).message); }
  }

  if (!caseData) {
    return <div className="flex h-full items-center justify-center text-sm text-slate-400">Select a case to manage disbursements</div>;
  }

  const isLoading = creditorsLoading || paymentsLoading || distLoading || negLoading;

  return (
    <div className="space-y-4">
      {actionError && <div className="rounded-xl bg-rose-50 px-4 py-2 text-sm text-rose-700 dark:bg-rose-500/20 dark:text-rose-300 fade-in">{actionError}</div>}
      {actionSuccess && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300 fade-in">
          <CheckCircle2 className="h-4 w-4" /> {actionSuccess}
        </div>
      )}

      {/* Shortfall Exception Banner */}
      {hasActiveShortfall && (
        <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-4 dark:border-amber-500/40 dark:bg-amber-500/10 fade-in">
          <div className="flex flex-wrap items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-500/20">
              <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-bold text-amber-800 dark:text-amber-200">Payment Shortfall Detected</p>
              <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-300">
                Debtor paid {formatCurrency(latestPayment?.amount ?? 0)} against an expected {formatCurrency(expectedMonthly)} —
                a shortfall of {formatCurrency(latestPayment?.shortfall_amount ?? 0)}.
                The auto-split was executed at the reduced amount. Recalculating the pro-rata schedule will adjust all future distributions and update the payoff forecast.
              </p>
            </div>
            <button
              onClick={handleRecalcReducedProRata}
              disabled={recalculating}
              className="btn bg-amber-600 text-sm text-white hover:bg-amber-700 disabled:opacity-50"
            >
              {recalculating ? <Clock className="h-4 w-4 animate-pulse" /> : <Calculator className="h-4 w-4" />}
              {recalculating ? "Recalculating..." : "Recalculate Reduced Pro-Rata Split"}
            </button>
          </div>
        </div>
      )}

      {/* Header: KPIs + Log Payment Button */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard icon={<Wallet className="h-4 w-4" />} label="Expected Monthly" value={formatCurrency(expectedMonthly, "GBP", { compact: true })} sub="Disposable income" accent="text-blue-600 bg-blue-50 dark:bg-blue-500/10" />
        <KpiCard icon={<Banknote className="h-4 w-4" />} label="Received (Latest)" value={latestPayment ? formatCurrency(latestPayment.amount, "GBP", { compact: true }) : "—"} sub={latestPayment ? formatDateShort(latestPayment.payment_date) : "No payments yet"} accent={latestPayment?.is_shortfall ? "text-amber-600 bg-amber-50 dark:bg-amber-500/10" : "text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10"} />
        <KpiCard icon={<Split className="h-4 w-4" />} label="Total Distributed" value={formatCurrency(totalDistributed, "GBP", { compact: true })} sub={`${distributions.length} split records`} accent="text-purple-600 bg-purple-50 dark:bg-purple-500/10" />
        <KpiCard icon={<Handshake className="h-4 w-4" />} label="Negotiations" value={String(negotiations.length)} sub={`${creditors.filter((c) => latestNegotiations.has(c.id)).length} creditors tracked`} accent="text-teal-600 bg-teal-50 dark:bg-teal-500/10" />
      </div>

      {/* Action Bar */}
      <div className="panel flex flex-wrap items-center justify-between gap-3 p-4 fade-in">
        <div>
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Disbursement & Negotiation</h3>
          <p className="text-xs text-slate-400">Log payments, auto-split across creditors, and track negotiation progress</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => { setShowNegForm(!showNegForm); setNegCreditorId(creditors[0]?.id ?? ""); }} className="btn btn-secondary text-sm">
            <Handshake className="h-4 w-4" /> Log Negotiation Event
          </button>
          <button onClick={() => setShowLogPayment(!showLogPayment)} className="btn btn-primary bg-emerald-600 text-sm hover:bg-emerald-700">
            <Plus className="h-4 w-4" /> Log Monthly Payment
          </button>
        </div>
      </div>

      {/* Log Payment Modal */}
      {showLogPayment && (
        <form onSubmit={handleLogPayment} className="panel grid grid-cols-1 gap-3 p-4 fade-in sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Amount Received">
            <input type="number" step="0.01" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} className="input text-sm" placeholder="350.00" required autoFocus />
          </Field>
          <Field label="Payment Date">
            <input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} className="input text-sm" required />
          </Field>
          <Field label="Reference (optional)">
            <input value={payReference} onChange={(e) => setPayReference(e.target.value)} className="input text-sm" placeholder="Bank transfer ref" />
          </Field>
          <Field label="Expected Amount">
            <input type="text" value={formatCurrency(expectedMonthly)} disabled className="input bg-slate-50 text-sm dark:bg-slate-800" />
          </Field>
          {payAmount && parseFloat(payAmount) > 0 && creditors.length > 0 && (
            <div className="sm:col-span-2 lg:col-span-4">
              <p className="mb-2 text-xs font-semibold text-slate-500 dark:text-slate-400">Auto-Split Preview ({creditors.length} creditors):</p>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                {calculatePaymentSplit(parseFloat(payAmount), creditors).map((split) => (
                  <div key={split.creditor.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-1.5 text-xs dark:border-slate-700">
                    <span className="font-medium text-slate-600 dark:text-slate-300">{split.creditor.creditor_name}</span>
                    <span className="font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(split.amount)}</span>
                  </div>
                ))}
              </div>
              {parseFloat(payAmount) < expectedMonthly && (
                <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                  <AlertCircle className="h-3.5 w-3.5" /> Shortfall detected — split will be executed at reduced amount. You can recalculate pro-rata after logging.
                </p>
              )}
            </div>
          )}
          <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
            <button type="submit" className="btn btn-primary bg-emerald-600 text-sm hover:bg-emerald-700"><Banknote className="h-4 w-4" /> Log & Auto-Split</button>
            <button type="button" onClick={() => setShowLogPayment(false)} className="btn btn-secondary text-sm">Cancel</button>
          </div>
        </form>
      )}

      {/* Negotiation Event Form */}
      {showNegForm && (
        <form onSubmit={handleAddNegotiation} className="panel grid grid-cols-1 gap-3 p-4 fade-in sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Creditor">
            <select value={negCreditorId} onChange={(e) => setNegCreditorId(e.target.value)} className="input text-sm" required>
              <option value="">Select creditor...</option>
              {creditors.map((c) => <option key={c.id} value={c.id}>{c.creditor_name}</option>)}
            </select>
          </Field>
          <Field label="Event Type">
            <select value={negEventType} onChange={(e) => setNegEventType(e.target.value as DebtNegotiationEventType)} className="input text-sm" required>
              {NEGOTIATION_EVENT_OPTIONS.map((opt) => <option key={opt.type} value={opt.type}>{opt.label}</option>)}
            </select>
          </Field>
          <Field label="Notes (optional)">
            <input value={negNotes} onChange={(e) => setNegNotes(e.target.value)} className="input text-sm" placeholder="Call reference, terms discussed..." />
          </Field>
          <div className="flex items-end">
            <div className="flex w-full gap-2">
              <button type="submit" className="btn btn-primary bg-emerald-600 text-sm hover:bg-emerald-700 flex-1"><Handshake className="h-4 w-4" /> Record Event</button>
              <button type="button" onClick={() => setShowNegForm(false)} className="btn btn-secondary text-sm">Cancel</button>
            </div>
          </div>
          {negCreditorId && (
            <div className="sm:col-span-2 lg:col-span-4">
              <p className="text-xs text-slate-400">
                {negEventType === "interest_freeze_accepted" && "This will set the creditor's interest rate to 0% and update the payoff forecast."}
                {negEventType === "interest_freeze_rejected" && "This will restore the creditor's interest rate if it was previously frozen."}
                {negEventType === "agreement_reached" && "This will mark the case status as 'Payment Schedule Active'."}
                {negEventType === "full_offer_accepted" && "This will mark the case status as 'Payment Schedule Active'."}
              </p>
            </div>
          )}
        </form>
      )}

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-20 rounded-xl" />)}</div>
      ) : (
        <>
          {/* Section 1: Payment Log */}
          <div className="panel p-4 fade-in">
            <div className="mb-3 flex items-center justify-between">
              <h4 className="flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-100">
                <Banknote className="h-4 w-4 text-emerald-600" /> Payment Log
              </h4>
              <span className="text-xs text-slate-400">{payments.length} payments recorded</span>
            </div>
            {payments.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-slate-400">
                <Banknote className="mb-2 h-8 w-8 opacity-30" />
                <p className="text-xs">No payments logged yet — click "Log Monthly Payment" to begin</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50">
                      <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-400">Date</th>
                      <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-slate-400">Received</th>
                      <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-slate-400">Expected</th>
                      <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-slate-400">Shortfall</th>
                      <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-400">Reference</th>
                      <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-slate-400">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((p) => (
                      <tr key={p.id} className="group border-b border-slate-100 transition-colors hover:bg-slate-50 dark:border-slate-700/50 dark:hover:bg-slate-800/30">
                        <td className="px-4 py-3 font-medium text-slate-700 dark:text-slate-200">{formatDateShort(p.payment_date)}</td>
                        <td className="px-4 py-3 text-right font-bold text-slate-800 dark:text-slate-100">{formatCurrency(p.amount)}</td>
                        <td className="px-4 py-3 text-right text-slate-500 dark:text-slate-400">{formatCurrency(p.expected_amount)}</td>
                        <td className="px-4 py-3 text-right">
                          {p.is_shortfall ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:bg-amber-500/10 dark:text-amber-400">
                              <AlertCircle className="h-2.5 w-2.5" /> {formatCurrency(p.shortfall_amount)}
                            </span>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">{p.reference || "—"}</td>
                        <td className="px-4 py-3 text-right">
                          <button onClick={() => handleDeletePayment(p.id)} className="rounded-lg p-1.5 text-slate-300 opacity-0 transition-opacity hover:bg-rose-50 hover:text-rose-500 group-hover:opacity-100 dark:hover:bg-rose-500/10">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Section 2: Auto-Split Execution */}
          <div className="panel p-4 fade-in">
            <div className="mb-3 flex items-center justify-between">
              <h4 className="flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-100">
                <Split className="h-4 w-4 text-blue-600" /> Auto-Split Execution
              </h4>
              <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-700 dark:bg-slate-800">
                {(["all", "scheduled", "processing", "sent", "failed"] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setDistFilter(f)}
                    className={`rounded-md px-2.5 py-1 text-[10px] font-medium transition-all ${
                      distFilter === f ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white" : "text-slate-500 hover:text-slate-700 dark:text-slate-400"
                    }`}
                  >
                    {f === "all" ? "All" : PAYMENT_STATUS_META[f]?.label ?? f}
                  </button>
                ))}
              </div>
            </div>
            {filteredDistributions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-slate-400">
                <Split className="mb-2 h-8 w-8 opacity-30" />
                <p className="text-xs">No distribution records — logging a payment will auto-generate splits</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50">
                      <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-400">Date</th>
                      <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-400">Creditor</th>
                      <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-slate-400">Amount</th>
                      <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-400">Status</th>
                      <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-400">Reference</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDistributions.slice(0, 20).map((d) => {
                      const creditor = creditors.find((c) => c.id === d.creditor_id);
                      const meta = PAYMENT_STATUS_META[d.status];
                      return (
                        <tr key={d.id} className="group border-b border-slate-100 transition-colors hover:bg-slate-50 dark:border-slate-700/50 dark:hover:bg-slate-800/30">
                          <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">{formatDateShort(d.distribution_date)}</td>
                          <td className="px-4 py-3 font-medium text-slate-700 dark:text-slate-200">{creditor?.creditor_name ?? "Unknown"}</td>
                          <td className="px-4 py-3 text-right font-bold text-slate-800 dark:text-slate-100">{formatCurrency(d.amount)}</td>
                          <td className="px-4 py-3">
                            <select
                              value={d.status}
                              onChange={(e) => handleDistStatusChange(d.id, e.target.value as DebtDistributionStatus)}
                              className={`cursor-pointer rounded-md border-0 px-2 py-0.5 text-[10px] font-medium outline-none ${meta?.color}`}
                            >
                              <option value="scheduled">Pending</option>
                              <option value="processing">Clearing</option>
                              <option value="sent">Distributed</option>
                              <option value="failed">Bounced</option>
                            </select>
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">{d.reference || "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {filteredDistributions.length > 20 && <p className="mt-2 text-center text-xs text-slate-400">Showing 20 of {filteredDistributions.length} records</p>}
              </div>
            )}
          </div>

          {/* Section 3: Creditor Negotiation Timeline */}
          <div className="panel p-4 fade-in">
            <div className="mb-3 flex items-center justify-between">
              <h4 className="flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-100">
                <History className="h-4 w-4 text-teal-600" /> Creditor Negotiation Timeline
              </h4>
              <span className="text-xs text-slate-400">{negotiations.length} events · {creditors.filter((c) => latestNegotiations.has(c.id)).length}/{creditors.length} creditors tracked</span>
            </div>

            {/* Per-creditor current status summary */}
            {creditors.length > 0 && (
              <div className="mb-4 grid grid-cols-1 gap-2 lg:grid-cols-2">
                {creditors.map((c) => {
                  const latest = latestNegotiations.get(c.id);
                  const meta = latest ? NEGOTIATION_EVENT_META[latest.event_type] : null;
                  const cEvents = negotiations.filter((n) => n.creditor_id === c.id).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
                  return (
                    <div key={c.id} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className={`flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-700 ${DEBT_TYPE_META[c.debt_type].color}`}>{DEBT_TYPE_META[c.debt_type].icon}</span>
                          <div>
                            <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{c.creditor_name}</p>
                            <p className="text-[10px] text-slate-400">{formatCurrency(c.current_balance)} · {c.interest_rate === 0 ? "Frozen" : `${c.interest_rate.toFixed(1)}% APR`}</p>
                          </div>
                        </div>
                        {meta ? (
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${meta.color}`}>
                            {meta.icon} {meta.label}
                          </span>
                        ) : (
                          <span className="text-[10px] text-slate-300">No events</span>
                        )}
                      </div>
                      {cEvents.length > 0 && (
                        <div className="mt-2 space-y-1">
                          {cEvents.slice(0, 3).map((e) => {
                            const eMeta = NEGOTIATION_EVENT_META[e.event_type];
                            return (
                              <div key={e.id} className="flex items-center gap-2 text-[10px] text-slate-500 dark:text-slate-400">
                                <span className={eMeta?.color ?? "text-slate-400"}>{eMeta?.icon}</span>
                                <span className="font-medium">{e.event_label}</span>
                                <span className="text-slate-300">· {formatDateShort(e.created_at)}</span>
                                {e.notes && <span className="truncate text-slate-400">— {e.notes}</span>}
                              </div>
                            );
                          })}
                          {cEvents.length > 3 && <p className="text-[10px] text-slate-400">+{cEvents.length - 3} more events</p>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Full timeline */}
            {negotiations.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-slate-400">
                <History className="mb-2 h-8 w-8 opacity-30" />
                <p className="text-xs">No negotiation events recorded — click "Log Negotiation Event" to start tracking</p>
              </div>
            ) : (
              <div className="relative">
                <div className="absolute left-[15px] top-2 bottom-2 w-0.5 bg-slate-200 dark:bg-slate-700" />
                <div className="space-y-3">
                  {negotiations.slice(0, 30).map((e) => {
                    const meta = NEGOTIATION_EVENT_META[e.event_type];
                    const creditor = creditors.find((c) => c.id === e.creditor_id);
                    return (
                      <div key={e.id} className="group relative flex items-start gap-4">
                        <div className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-800 ${meta?.color ?? ""}`}>
                          {meta?.icon}
                        </div>
                        <div className="flex-1 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800/50">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{e.event_label}</p>
                              <span className={`rounded-full px-2 py-0.5 text-[9px] font-medium ${meta?.color ?? ""}`}>{creditor?.creditor_name ?? "Unknown"}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] text-slate-400">{formatDateShort(e.created_at)}</span>
                              <button onClick={() => handleDeleteNegEvent(e.id)} className="rounded p-0.5 text-slate-300 opacity-0 transition-opacity hover:text-rose-500 group-hover:opacity-100">
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          </div>
                          {e.notes && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{e.notes}</p>}
                          {e.actor && <p className="mt-0.5 text-[10px] text-slate-400">by {e.actor}</p>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Forecast Sync Indicator */}
          <div className="panel flex items-center gap-3 p-3 fade-in">
            <TrendingDown className="h-4 w-4 shrink-0 text-blue-600" />
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Negotiation status changes (interest freeze accepted/rejected) automatically sync the creditor ledger and update the live DMP payoff forecast.
              Current live pro-rata total: <span className="font-bold text-blue-600 dark:text-blue-400">{formatCurrency(totalLiveProRata)}</span>/month
            </p>
          </div>
        </>
      )}
    </div>
  );
}

// ============================================================
// Payment Schedule & Transaction Ledger Tab
// ============================================================

const FREQUENCY_OPTIONS: { value: PaymentFrequency; label: string; interval: string }[] = [
  { value: "weekly", label: "Weekly", interval: "Every 7 days" },
  { value: "fortnightly", label: "Fortnightly", interval: "Every 14 days" },
  { value: "four_weekly", label: "4-Weekly", interval: "Every 28 days" },
  { value: "monthly", label: "Monthly", interval: "Calendar month" },
  { value: "specific_date", label: "Specific Date of Month", interval: "Fixed day each month" },
];

const STATUS_BADGE_STYLES: Record<PaymentTransactionStatus, { label: string; className: string; dot: string }> = {
  cleared:              { label: "Cleared", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300", dot: "bg-emerald-500" },
  awaiting_clearance:   { label: "Awaiting Clearance", className: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300", dot: "bg-amber-500" },
  scheduled:            { label: "Scheduled", className: "bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300", dot: "bg-sky-500" },
  missed:               { label: "Missed", className: "bg-orange-100 text-orange-700 dark:bg-orange-600/20 dark:text-orange-300", dot: "bg-orange-500" },
  bounced:              { label: "Bounced", className: "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300", dot: "bg-rose-500" },
  overdue:              { label: "Overdue", className: "bg-red-600 text-white dark:bg-red-500/30 dark:text-red-200", dot: "bg-red-700" },
};

function PaymentScheduleTab({ caseId, caseData }: { caseId: string | null; caseData: DebtCase | null }) {
  const { data: transactions, loading, error, reload } = usePaymentTransactions(caseId);
  const [frequency, setFrequency] = useState<PaymentFrequency>("monthly");
  const [paymentDay, setPaymentDay] = useState<PaymentScheduleDay>(1);
  const [installment, setInstallment] = useState(0);
  const [nextDueDate, setNextDueDate] = useState(new Date().toISOString().slice(0, 10));
  const [scheduleLoaded, setScheduleLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [showLogPayment, setShowLogPayment] = useState(false);
  const [showGracePeriod, setShowGracePeriod] = useState(false);
  const [editingTxn, setEditingTxn] = useState<PaymentTransaction | null>(null);
  const [generating, setGenerating] = useState(false);

  const monthlyDisposable = caseData?.monthly_disposable_income ?? 0;
  const computedInstallment = frequencyToInstallment(monthlyDisposable, frequency);

  // Load existing schedule from case record
  useEffect(() => {
    if (!caseId || scheduleLoaded) return;
    getPaymentSchedule(caseId).then((sched) => {
      if (sched) {
        setFrequency(sched.frequency);
        setPaymentDay(sched.preferredPaymentDay);
        setInstallment(sched.installmentAmount);
        setNextDueDate(sched.nextDueDate);
      } else {
        setInstallment(computedInstallment);
      }
      setScheduleLoaded(true);
    }).catch(() => setScheduleLoaded(true));
  }, [caseId, scheduleLoaded, computedInstallment]);

  // Auto-update installment when frequency changes and no manual override
  useEffect(() => {
    if (scheduleLoaded) setInstallment(computedInstallment);
  }, [frequency, computedInstallment, scheduleLoaded]);

  const handleSaveSchedule = async () => {
    if (!caseId) return;
    setSaving(true);
    setActionError(null);
    setSuccessMsg(null);
    try {
      const schedule: PaymentSchedule = { frequency, preferredPaymentDay: paymentDay, installmentAmount: installment, nextDueDate };
      await savePaymentSchedule(caseId, schedule);
      setSuccessMsg("Payment schedule saved successfully");
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleGenerateSchedule = async () => {
    if (!caseId) return;
    setGenerating(true);
    setActionError(null);
    try {
      const schedule: PaymentSchedule = { frequency, preferredPaymentDay: paymentDay, installmentAmount: installment, nextDueDate };
      await generateScheduledTransactions(caseId, schedule, 12);
      await savePaymentSchedule(caseId, schedule);
      reload();
      setSuccessMsg("12 upcoming payments generated and saved");
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  const handleMarkPaid = async (txn: PaymentTransaction) => {
    if (!caseId) return;
    setActionError(null);
    try {
      const today = new Date().toISOString().slice(0, 10);
      await updatePaymentTransaction(txn.id, { amount_paid: txn.amountDue, status: "cleared", cleared_date: today });
      reload();
    } catch (e) {
      setActionError((e as Error).message);
    }
  };

  const handleFlagBounced = async (txn: PaymentTransaction) => {
    if (!caseId) return;
    setActionError(null);
    try {
      await updatePaymentTransaction(txn.id, { status: "bounced", failure_reason: "Refer to Drawer / Insufficient Funds" });
      reload();
    } catch (e) {
      setActionError((e as Error).message);
    }
  };

  const handleSendNudge = async (txn: PaymentTransaction) => {
    setSuccessMsg(`Payment nudge sent for ${formatDateShort(txn.dueDate)} installment`);
    setTimeout(() => setSuccessMsg(null), 3000);
  };

  const handleDeleteTxn = async (id: string) => {
    setActionError(null);
    try {
      await deletePaymentTransaction(id);
      setEditingTxn(null);
      reload();
    } catch (e) {
      setActionError((e as Error).message);
    }
  };

  // Summary metrics
  const totalCollected = transactions.filter((t) => t.status === "cleared").reduce((sum, t) => sum + t.amountPaid, 0);
  const outstandingArrears = transactions.filter((t) => t.status === "overdue" || t.status === "missed").reduce((sum, t) => sum + (t.amountDue - t.amountPaid), 0);
  const nextScheduled = transactions.find((t) => t.status === "scheduled");
  const hasOverdue = transactions.some((t) => t.status === "overdue" || t.status === "missed");
  const scheduleHealth = hasOverdue ? { label: "In Arrears", className: "bg-red-600 text-white dark:bg-red-500/30 dark:text-red-200" } : { label: "Up to Date", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300" };

  const dayOptions: { value: PaymentScheduleDay; label: string }[] = (() => {
    if (frequency === "weekly" || frequency === "fortnightly") {
      return [
        { value: "monday", label: "Monday" },
        { value: 1, label: "1st" }, { value: 2, label: "2nd" }, { value: 3, label: "3rd" }, { value: 4, label: "4th" },
      ];
    }
    return Array.from({ length: 28 }, (_, i) => ({ value: i + 1, label: `${i + 1}${i === 0 ? "st" : i === 1 ? "nd" : i === 2 ? "rd" : "th"}` }))
      .concat([{ value: "last_working_day" as PaymentScheduleDay, label: "Last Working Day" }]);
  })();

  if (!caseData) return <div className="flex h-full items-center justify-center text-sm text-slate-400">Select a case to manage the payment schedule</div>;

  return (
    <div className="space-y-4">
      {actionError && <div className="rounded-xl bg-rose-50 px-4 py-2 text-sm text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">{actionError}</div>}
      {successMsg && <div className="rounded-xl bg-emerald-50 px-4 py-2 text-sm text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">{successMsg}</div>}

      {/* Summary Metrics Header Strip */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <PaymentMetricCard
          icon={<Wallet className="h-4 w-4" />}
          label="Total Collected"
          value={formatCurrency(totalCollected, "GBP", { compact: true })}
          sub={`${transactions.filter((t) => t.status === "cleared").length} payments cleared`}
          accent="bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400"
        />
        <PaymentMetricCard
          icon={<AlertTriangle className="h-4 w-4" />}
          label="Outstanding Arrears"
          value={formatCurrency(outstandingArrears, "GBP", { compact: true })}
          sub={`${transactions.filter((t) => t.status === "overdue" || t.status === "missed").length} missed/overdue`}
          accent="bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400"
        />
        <PaymentMetricCard
          icon={<CalendarClock className="h-4 w-4" />}
          label="Next Due"
          value={nextScheduled ? formatDateShort(nextScheduled.dueDate) : "—"}
          sub={nextScheduled ? formatCurrency(nextScheduled.amountDue, "GBP", { compact: true }) : "No scheduled payments"}
          accent="bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-400"
        />
        <PaymentMetricCard
          icon={<Activity className="h-4 w-4" />}
          label="Schedule Health"
          value={scheduleHealth.label}
          sub={`${transactions.length} total entries`}
          accent={hasOverdue ? "bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400" : "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400"}
          badge={scheduleHealth}
        />
      </div>

      {/* Schedule Configuration Card */}
      <div className="panel p-4 fade-in">
        <div className="mb-3 flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-50 dark:bg-sky-500/10">
            <CalendarClock className="h-4 w-4 text-sky-600 dark:text-sky-400" />
          </div>
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Schedule Configuration</h3>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Frequency">
            <select value={frequency} onChange={(e) => setFrequency(e.target.value as PaymentFrequency)} className="input text-sm">
              {FREQUENCY_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </select>
            <p className="mt-1 text-[10px] text-slate-400">{FREQUENCY_OPTIONS.find((o) => o.value === frequency)?.interval}</p>
          </Field>

          <Field label="Payment Day">
            <select value={String(paymentDay)} onChange={(e) => {
              const v = e.target.value;
              setPaymentDay(v === "last_working_day" || v === "monday" ? v : Number(v));
            }} className="input text-sm">
              {dayOptions.map((opt) => <option key={String(opt.value)} value={String(opt.value)}>{opt.label}</option>)}
            </select>
            <p className="mt-1 text-[10px] text-slate-400">{frequency === "weekly" || frequency === "fortnightly" ? "Day of week / month" : "Day of month (1st–28th)"}</p>
          </Field>

          <Field label="Installment Amount">
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-slate-400">£</span>
              <input type="number" step="0.01" value={installment.toFixed(2)} onChange={(e) => setInstallment(parseFloat(e.target.value) || 0)} className="input pl-7 text-sm" />
            </div>
            <p className="mt-1 text-[10px] text-slate-400">
              Auto-calc: £{computedInstallment.toFixed(2)} from £{monthlyDisposable.toFixed(2)}/mo disposable
            </p>
          </Field>

          <Field label="Next Due Date">
            <input type="date" value={nextDueDate} onChange={(e) => setNextDueDate(e.target.value)} className="input text-sm" />
            <p className="mt-1 text-[10px] text-slate-400">First upcoming payment date</p>
          </Field>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button onClick={handleSaveSchedule} disabled={saving || !caseId} className="btn btn-primary bg-sky-600 text-sm hover:bg-sky-700 disabled:opacity-40">
            <Save className="h-4 w-4" /> {saving ? "Saving..." : "Save & Amend Schedule"}
          </button>
          <button onClick={handleGenerateSchedule} disabled={generating || !caseId} className="btn btn-secondary text-sm disabled:opacity-40">
            <RefreshCw className={`h-4 w-4 ${generating ? "animate-spin" : ""}`} /> {generating ? "Generating..." : "Generate 12 Upcoming"}
          </button>
          <div className="mx-1 h-5 w-px bg-slate-200 dark:bg-slate-700" />
          <button onClick={() => setShowLogPayment(true)} disabled={!caseId} className="btn btn-secondary text-sm disabled:opacity-40">
            <Plus className="h-4 w-4" /> Log Manual Payment
          </button>
          <button onClick={() => setShowGracePeriod(true)} disabled={!caseId} className="btn btn-secondary text-sm disabled:opacity-40">
            <Pause className="h-4 w-4" /> Grant Grace Period
          </button>
        </div>
      </div>

      {/* Payment Ledger Table */}
      {loading ? (
        <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton h-12 rounded-lg" />)}</div>
      ) : transactions.length === 0 ? (
        <div className="panel flex flex-col items-center justify-center py-12 text-slate-400">
          <CalendarClock className="mb-3 h-10 w-10 opacity-30" />
          <p className="text-sm">No payment transactions yet</p>
          <p className="mt-1 text-xs">Save a schedule and generate upcoming payments to populate the ledger</p>
        </div>
      ) : (
        <div className="panel overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Payment Ledger</h3>
            <span className="text-xs text-slate-400">{transactions.length} entries</span>
          </div>
          <div className="max-h-[calc(100vh-420px)] overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50">
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-400">Due Date</th>
                  <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-slate-400">Scheduled Amount</th>
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-400">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-400">Method</th>
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-400">Date Received</th>
                  <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-slate-400">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                {transactions.map((txn) => {
                  const badge = STATUS_BADGE_STYLES[txn.status];
                  return (
                    <tr key={txn.id} className="group transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/30">
                      <td className="px-4 py-3 font-medium text-slate-700 dark:text-slate-200">{formatDateShort(txn.dueDate)}</td>
                      <td className="px-4 py-3 text-right font-bold text-slate-800 dark:text-slate-100">
                        {formatCurrency(txn.amountDue, "GBP", { compact: true })}
                        {txn.amountPaid > 0 && txn.amountPaid < txn.amountDue && (
                          <span className="block text-[10px] font-normal text-amber-600 dark:text-amber-400">Paid: {formatCurrency(txn.amountPaid, "GBP", { compact: true })}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="group/badge relative inline-flex">
                          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${badge.className}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${badge.dot}`} />
                            {badge.label}
                          </span>
                          {txn.status === "bounced" && txn.failureReason && (
                            <div className="pointer-events-none absolute bottom-full left-0 z-20 mb-1 whitespace-nowrap rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs text-white opacity-0 shadow-lg transition-opacity group-hover/badge:opacity-100 dark:bg-slate-700">
                              {txn.failureReason}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-500 dark:text-slate-400">
                        {txn.status === "cleared" ? "Direct Debit" : txn.status === "scheduled" ? "Direct Debit" : "—"}
                      </td>
                      <td className="px-4 py-3 text-slate-500 dark:text-slate-400">
                        {txn.clearedDate ? formatDateShort(txn.clearedDate) : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {txn.status === "scheduled" && (
                            <button onClick={() => handleMarkPaid(txn)} title="Mark as Paid" className="rounded-lg p-1.5 text-emerald-600 transition-colors hover:bg-emerald-50 dark:hover:bg-emerald-500/10">
                              <CheckCircle2 className="h-4 w-4" />
                            </button>
                          )}
                          {txn.status !== "bounced" && txn.status !== "cleared" && (
                            <button onClick={() => handleFlagBounced(txn)} title="Flag Bounced" className="rounded-lg p-1.5 text-rose-600 transition-colors hover:bg-rose-50 dark:hover:bg-rose-500/10">
                              <XCircle className="h-4 w-4" />
                            </button>
                          )}
                          {(txn.status === "overdue" || txn.status === "missed" || txn.status === "scheduled") && (
                            <button onClick={() => handleSendNudge(txn)} title="Send Payment Nudge" className="rounded-lg p-1.5 text-sky-600 transition-colors hover:bg-sky-50 dark:hover:bg-sky-500/10">
                              <MessageSquare className="h-4 w-4" />
                            </button>
                          )}
                          <button onClick={() => setEditingTxn(txn)} title="Edit Entry" className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-100 dark:hover:bg-slate-700">
                            <Pencil className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Log Manual Payment Modal */}
      {showLogPayment && caseId && (
        <Modal onClose={() => setShowLogPayment(false)} title="Log Manual Payment" children={
          <>
            <ManualPaymentForm
              caseId={caseId}
              defaultAmount={installment}
              onSaved={() => { setShowLogPayment(false); reload(); }}
              onCancel={() => setShowLogPayment(false)}
            />
          </>
        } />
      )}

      {/* Grace Period Modal */}
      {showGracePeriod && caseId && (
        <Modal onClose={() => setShowGracePeriod(false)} title="Grant Grace Period / Pause Schedule" children={
          <>
            <GracePeriodForm
              caseId={caseId}
              onSaved={() => { setShowGracePeriod(false); reload(); }}
              onCancel={() => setShowGracePeriod(false)}
            />
          </>
        } />
      )}

      {/* Edit Transaction Modal */}
      {editingTxn && (
        <Modal onClose={() => setEditingTxn(null)} title="Edit Payment Entry" children={
          <>
            <EditTransactionForm
              txn={editingTxn}
              onSave={async (patch) => {
                await updatePaymentTransaction(editingTxn.id, patch);
                setEditingTxn(null);
                reload();
              }}
              onDelete={() => handleDeleteTxn(editingTxn.id)}
              onCancel={() => setEditingTxn(null)}
            />
          </>
        } />
      )}
    </div>
  );
}

function PaymentMetricCard({ icon, label, value, sub, accent, badge }: {
  icon: React.ReactNode; label: string; value: string; sub: string; accent: string;
  badge?: { label: string; className: string };
}) {
  return (
    <div className="panel p-3 transition-all hover:shadow-md">
      <div className="flex items-center justify-between">
        <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${accent}`}>{icon}</span>
        {badge && <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${badge.className}`}>{badge.label}</span>}
      </div>
      <p className="mt-2 text-lg font-bold tracking-tight text-slate-800 dark:text-slate-100">{value}</p>
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-0.5 text-[10px] text-slate-400">{sub}</p>
    </div>
  );
}

function ManualPaymentForm({ caseId, defaultAmount, onSaved, onCancel }: {
  caseId: string; defaultAmount: number; onSaved: () => void; onCancel: () => void;
}) {
  const [dueDate, setDueDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState(defaultAmount);
  const [status, setStatus] = useState<PaymentTransactionStatus>("cleared");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await createPaymentTransaction({ case_id: caseId, due_date: dueDate, amount_due: amount, status });
      if (status === "cleared") {
        // If cleared, update with paid amount + cleared date
      }
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {error && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">{error}</div>}
      <Field label="Due Date"><input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="input text-sm" required /></Field>
      <Field label="Amount">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-slate-400">£</span>
          <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(parseFloat(e.target.value) || 0)} className="input pl-7 text-sm" required />
        </div>
      </Field>
      <Field label="Status">
        <select value={status} onChange={(e) => setStatus(e.target.value as PaymentTransactionStatus)} className="input text-sm">
          <option value="cleared">Cleared</option>
          <option value="awaiting_clearance">Awaiting Clearance</option>
          <option value="scheduled">Scheduled</option>
          <option value="missed">Missed</option>
          <option value="bounced">Bounced</option>
        </select>
      </Field>
      <div className="flex gap-2 pt-1">
        <button type="submit" className="btn btn-primary bg-emerald-600 text-sm hover:bg-emerald-700"><CheckCircle2 className="h-4 w-4" /> Log Payment</button>
        <button type="button" onClick={onCancel} className="btn btn-secondary text-sm">Cancel</button>
      </div>
    </form>
  );
}

function GracePeriodForm({ caseId, onSaved, onCancel }: {
  caseId: string; onSaved: () => void; onCancel: () => void;
}) {
  const [pauseWeeks, setPauseWeeks] = useState(2);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      // Fetch scheduled transactions and push their due dates back
      const schedule = await getPaymentSchedule(caseId);
      if (!schedule) throw new Error("No payment schedule found. Save a schedule first.");
      const newDue = new Date(schedule.nextDueDate);
      newDue.setDate(newDue.getDate() + pauseWeeks * 7);
      await savePaymentSchedule(caseId, { ...schedule, nextDueDate: newDue.toISOString().slice(0, 10) });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {error && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">{error}</div>}
      <Field label="Pause Duration (weeks)"><input type="number" min={1} max={12} value={pauseWeeks} onChange={(e) => setPauseWeeks(parseInt(e.target.value) || 1)} className="input text-sm" required /></Field>
      <Field label="Reason (optional)"><input value={reason} onChange={(e) => setReason(e.target.value)} className="input text-sm" placeholder="Financial difficulty, illness, etc." /></Field>
      <p className="text-xs text-slate-400">The next due date will be pushed back by {pauseWeeks} weeks. Existing scheduled transactions remain unchanged.</p>
      <div className="flex gap-2 pt-1">
        <button type="submit" className="btn btn-primary bg-amber-600 text-sm hover:bg-amber-700"><Pause className="h-4 w-4" /> Grant Grace Period</button>
        <button type="button" onClick={onCancel} className="btn btn-secondary text-sm">Cancel</button>
      </div>
    </form>
  );
}

function EditTransactionForm({ txn, onSave, onDelete, onCancel }: {
  txn: PaymentTransaction;
  onSave: (patch: Partial<{ amount_paid: number; status: PaymentTransactionStatus; failure_reason: string; cleared_date: string }>) => Promise<void>;
  onDelete: () => void;
  onCancel: () => void;
}) {
  const [amountPaid, setAmountPaid] = useState(txn.amountPaid);
  const [status, setStatus] = useState<PaymentTransactionStatus>(txn.status);
  const [failureReason, setFailureReason] = useState(txn.failureReason ?? "");
  const [clearedDate, setClearedDate] = useState(txn.clearedDate ?? "");
  const [saving, setSaving] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    await onSave({ amount_paid: amountPaid, status, failure_reason: failureReason || undefined, cleared_date: clearedDate || undefined });
    setSaving(false);
  };

  return (
    <form onSubmit={handleSave} className="space-y-3">
      <div className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/50">
        <p className="text-xs text-slate-400">Due Date</p>
        <p className="text-sm font-bold text-slate-700 dark:text-slate-200">{formatDateShort(txn.dueDate)} · {formatCurrency(txn.amountDue, "GBP")}</p>
      </div>
      <Field label="Amount Paid">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-slate-400">£</span>
          <input type="number" step="0.01" value={amountPaid} onChange={(e) => setAmountPaid(parseFloat(e.target.value) || 0)} className="input pl-7 text-sm" />
        </div>
      </Field>
      <Field label="Status">
        <select value={status} onChange={(e) => setStatus(e.target.value as PaymentTransactionStatus)} className="input text-sm">
          <option value="scheduled">Scheduled</option>
          <option value="awaiting_clearance">Awaiting Clearance</option>
          <option value="cleared">Cleared</option>
          <option value="missed">Missed</option>
          <option value="bounced">Bounced</option>
          <option value="overdue">Overdue</option>
        </select>
      </Field>
      {status === "bounced" && (
        <Field label="Failure Reason"><input value={failureReason} onChange={(e) => setFailureReason(e.target.value)} className="input text-sm" placeholder="Refer to Drawer / Insufficient Funds" /></Field>
      )}
      {status === "cleared" && (
        <Field label="Cleared Date"><input type="date" value={clearedDate} onChange={(e) => setClearedDate(e.target.value)} className="input text-sm" /></Field>
      )}
      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={saving} className="btn btn-primary bg-sky-600 text-sm hover:bg-sky-700 disabled:opacity-40"><Save className="h-4 w-4" /> {saving ? "Saving..." : "Save Changes"}</button>
        <button type="button" onClick={onDelete} className="btn text-sm text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10"><Trash2 className="h-4 w-4" /> Delete</button>
        <button type="button" onClick={onCancel} className="btn btn-secondary text-sm">Cancel</button>
      </div>
    </form>
  );
}

// ============================================================
// Compliance & Audit Tab
// ============================================================

// ============================================================
// Breathing Space & Mental Health Crisis Moratorium Tracker
// ============================================================

const BS_DEBT_TYPE_NOTES: Partial<Record<DebtType, string>> = {
  council_tax: "Excluded — Council Tax arrears after liability order are not covered by Breathing Space",
  other: "Excluded — Must be verified individually (Student Loans, CMS, Court Fines are excluded by statute)",
};

function BreathingSpaceTab({ caseId, caseData }: { caseId: string | null; caseData: DebtCase | null }) {
  const { data: activeBS, loading, reload } = useActiveBreathingSpace(caseId);
  const { data: history } = useBreathingSpaces(caseId);
  const { data: creditors } = useDebtCreditors(caseId);
  const [showInitiation, setShowInitiation] = useState(false);
  const [showCancel, setShowCancel] = useState(false);
  const [showTreatmentUpdate, setShowTreatmentUpdate] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (!caseData) {
    return <div className="flex h-full items-center justify-center text-sm text-slate-400">Select a case to manage Breathing Space</div>;
  }

  if (loading) {
    return <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-20 rounded-xl" />)}</div>;
  }

  if (actionError) {
    return (
      <div className="space-y-3">
        <div className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">{actionError}</div>
        <button onClick={() => setActionError(null)} className="btn btn-secondary text-sm">Dismiss</button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Statutory Warning Banner */}
      <div className="flex items-start gap-3 rounded-xl border border-amber-300/50 bg-amber-50 px-4 py-3 dark:border-amber-500/30 dark:bg-amber-500/10">
        <ShieldX className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
        <div>
          <p className="text-sm font-bold text-amber-800 dark:text-amber-300">Statutory Breathing Space — Legal Compliance Notice</p>
          <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-400/80">
            Under the Debt Respite Scheme (Breathing Space Moratorium and Mental Health Crisis Moratorium) Regulations 2020,
            creditors must cease all interest, fees, and enforcement action on included debts for the duration of the moratorium.
            Failure to comply is a regulatory breach.
          </p>
        </div>
      </div>

      {activeBS ? (
        <ActiveMoratoriumView
          breathingSpace={activeBS}
          creditors={creditors}
          onReload={reload}
          onCancel={() => setShowCancel(true)}
          onTreatmentUpdate={() => setShowTreatmentUpdate(true)}
        />
      ) : (
        <NoActiveBreathingSpaceView
          caseId={caseId}
          caseData={caseData}
          creditors={creditors}
          hasHistory={history.length > 0}
          onInitiate={() => setShowInitiation(true)}
        />
      )}

      {/* History */}
      {history.length > 0 && (
        <div className="panel overflow-hidden">
          <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-700">
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Breathing Space History</h3>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-700/50">
            {history.map((bs) => {
              const isMHC = bs.moratorium_type === "mental_health_crisis";
              return (
                <div key={bs.id} className="flex items-center gap-3 px-4 py-3">
                  <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${isMHC ? "bg-rose-50 dark:bg-rose-500/10" : "bg-sky-50 dark:bg-sky-500/10"}`}>
                    {isMHC ? <HeartPulse className="h-4 w-4 text-rose-600 dark:text-rose-400" /> : <Wind className="h-4 w-4 text-sky-600 dark:text-sky-400" />}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                      {isMHC ? "Mental Health Crisis Moratorium" : "Standard 60-Day Breathing Space"}
                    </p>
                    <p className="text-xs text-slate-400">
                      Started {formatDateShort(bs.start_date)}
                      {bs.standard_end_date && ` · Ended ${formatDateShort(bs.standard_end_date)}`}
                      {bs.post_treatment_exit_date && ` · Exited ${formatDateShort(bs.post_treatment_exit_date)}`}
                    </p>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                    bs.status === "active" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300"
                      : bs.status === "cancelled" ? "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400"
                      : "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300"
                  }`}>{bs.status.charAt(0).toUpperCase() + bs.status.slice(1)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Initiation Modal */}
      {showInitiation && caseId && (
        <BreathingSpaceInitiationModal
          caseId={caseId}
          caseData={caseData}
          creditors={creditors}
          onClose={() => setShowInitiation(false)}
          onCreated={() => { setShowInitiation(false); reload(); }}
          onError={(msg) => setActionError(msg)}
        />
      )}

      {/* Cancel Modal */}
      {showCancel && activeBS && (
        <CancelBreathingSpaceModal
          breathingSpace={activeBS}
          onClose={() => setShowCancel(false)}
          onCancelled={() => { setShowCancel(false); reload(); }}
          onError={(msg) => setActionError(msg)}
        />
      )}

      {/* Treatment Update Modal */}
      {showTreatmentUpdate && activeBS && (
        <TreatmentUpdateModal
          breathingSpace={activeBS}
          onClose={() => setShowTreatmentUpdate(false)}
          onUpdated={() => { setShowTreatmentUpdate(false); reload(); }}
          onError={(msg) => setActionError(msg)}
        />
      )}
    </div>
  );
}

function NoActiveBreathingSpaceView({ caseId, caseData, creditors, hasHistory, onInitiate }: {
  caseId: string | null; caseData: DebtCase; creditors: DebtCreditor[]; hasHistory: boolean; onInitiate: () => void;
}) {
  const qualifyingCreditors = creditors.filter((c) => BS_QUALIFYING_DEBT_TYPES.includes(c.debt_type));
  const excludedCreditors = creditors.filter((c) => BS_EXCLUDED_DEBT_TYPES.includes(c.debt_type));
  const totalQualifyingDebt = qualifyingCreditors.reduce((s, c) => s + c.current_balance, 0);

  return (
    <div className="panel p-6">
      <div className="flex flex-col items-center text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-sky-50 dark:bg-sky-500/10">
          <Wind className="h-8 w-8 text-sky-600 dark:text-sky-400" />
        </div>
        <h3 className="mt-4 text-lg font-bold text-slate-800 dark:text-slate-100">No Active Breathing Space</h3>
        <p className="mt-1 max-w-md text-sm text-slate-500 dark:text-slate-400">
          Initiate a Statutory Breathing Space to legally pause creditor enforcement, freeze interest and charges,
          and protect the debtor while a sustainable debt solution is finalized.
        </p>

        {/* Quick Stats */}
        <div className="mt-5 grid w-full max-w-lg grid-cols-2 gap-3">
          <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
            <p className="text-xs font-medium text-slate-400">Qualifying Debts</p>
            <p className="mt-1 text-xl font-bold text-slate-800 dark:text-slate-100">{qualifyingCreditors.length}</p>
            <p className="text-xs text-slate-400">{formatCurrency(totalQualifyingDebt, "GBP", { compact: true })}</p>
          </div>
          <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
            <p className="text-xs font-medium text-slate-400">Excluded Debts</p>
            <p className="mt-1 text-xl font-bold text-slate-800 dark:text-slate-100">{excludedCreditors.length}</p>
            <p className="text-xs text-slate-400">Not covered by scheme</p>
          </div>
        </div>

        {hasHistory && (
          <p className="mt-4 text-xs text-amber-600 dark:text-amber-400">
            Note: A previous Breathing Space exists for this case. Standard Breathing Space can only be initiated once every 12 months.
          </p>
        )}

        <button onClick={onInitiate} disabled={!caseId} className="btn btn-primary mt-6 bg-sky-600 text-sm hover:bg-sky-700 disabled:opacity-40">
          <Wind className="h-4 w-4" /> Initiate Breathing Space
        </button>
      </div>
    </div>
  );
}

function ActiveMoratoriumView({ breathingSpace, creditors, onReload, onCancel, onTreatmentUpdate }: {
  breathingSpace: BreathingSpace;
  creditors: DebtCreditor[];
  onReload: () => void;
  onCancel: () => void;
  onTreatmentUpdate: () => void;
}) {
  const isMHC = breathingSpace.moratorium_type === "mental_health_crisis";
  const startDate = new Date(breathingSpace.start_date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysElapsed = Math.floor((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));

  // For standard: calculate countdown
  const standardEnd = breathingSpace.standard_end_date ? new Date(breathingSpace.standard_end_date) : null;
  const daysRemaining = standardEnd ? Math.max(0, Math.ceil((standardEnd.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))) : null;
  const progressPct = isMHC ? 0 : Math.min(100, (daysElapsed / 60) * 100);

  // For MHC: calculate post-treatment exit countdown
  const postTreatmentExit = breathingSpace.post_treatment_exit_date ? new Date(breathingSpace.post_treatment_exit_date) : null;
  const postTreatmentDaysRemaining = postTreatmentExit ? Math.max(0, Math.ceil((postTreatmentExit.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))) : null;

  const includedCreditors = creditors.filter((c) => breathingSpace.included_creditor_ids.includes(c.id));
  const totalFrozenDebt = includedCreditors.reduce((s, c) => s + c.current_balance, 0);

  const handleCompleteReview = async (taskId: string) => {
    await completeReviewTask(breathingSpace.id, breathingSpace.review_tasks, taskId);
    onReload();
  };

  return (
    <div className="space-y-4">
      {/* Active Moratorium Banner */}
      <div className={`relative overflow-hidden rounded-xl border p-5 ${
        isMHC
          ? "border-rose-300/60 bg-gradient-to-br from-rose-500/10 via-rose-500/5 to-transparent dark:border-rose-500/30"
          : "border-sky-300/60 bg-gradient-to-br from-sky-500/10 via-sky-500/5 to-transparent dark:border-sky-500/30"
      }`}>
        {/* Decorative wave */}
        <div className={`absolute right-0 top-0 h-full w-32 opacity-10 ${isMHC ? "bg-rose-500" : "bg-sky-500"}`} style={{ clipPath: "polygon(60% 0, 100% 0, 100% 100%, 20% 100%)" }} />

        <div className="relative flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className={`flex h-14 w-14 items-center justify-center rounded-2xl ${isMHC ? "bg-rose-100 dark:bg-rose-500/20" : "bg-sky-100 dark:bg-sky-500/20"}`}>
              {isMHC ? <HeartPulse className="h-7 w-7 text-rose-600 dark:text-rose-400" /> : <Wind className="h-7 w-7 text-sky-600 dark:text-sky-400" />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className={`text-lg font-bold ${isMHC ? "text-rose-700 dark:text-rose-300" : "text-sky-700 dark:text-sky-300"}`}>
                  {isMHC ? "Mental Health Crisis Moratorium Active" : "Breathing Space Active"}
                </h3>
                <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                  isMHC ? "bg-rose-600 text-white" : "bg-sky-600 text-white"
                }`}>Statutory</span>
              </div>
              <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">
                {isMHC ? (
                  breathingSpace.treatment_end_date
                    ? `Treatment ended on ${formatDateShort(breathingSpace.treatment_end_date)} — Moratorium ends in ${postTreatmentDaysRemaining} days`
                    : "Active during mental health crisis treatment — no fixed end date"
                ) : (
                  `Day ${Math.min(daysElapsed + 1, 60)} of 60 — ${daysRemaining} days remaining`
                )}
              </p>
            </div>
          </div>

          {/* Countdown Ring for Standard */}
          {!isMHC && daysRemaining !== null && (
            <div className="relative hidden h-20 w-20 shrink-0 sm:block">
              <svg className="h-20 w-20 -rotate-90" viewBox="0 0 80 80">
                <circle cx="40" cy="40" r="34" fill="none" stroke="currentColor" strokeWidth="6" className="text-slate-200 dark:text-slate-700" />
                <circle cx="40" cy="40" r="34" fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round"
                  strokeDasharray={`${2 * Math.PI * 34}`}
                  strokeDashoffset={`${2 * Math.PI * 34 * (1 - progressPct / 100)}`}
                  className="text-sky-500 transition-all duration-500"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-xl font-bold text-slate-800 dark:text-slate-100">{daysRemaining}</span>
                <span className="text-[9px] font-medium uppercase text-slate-400">days left</span>
              </div>
            </div>
          )}

          {/* MHC Status Indicator */}
          {isMHC && (
            <div className="hidden shrink-0 items-center gap-2 rounded-xl bg-rose-100 px-4 py-2 dark:bg-rose-500/20 sm:flex">
              <Hourglass className="h-5 w-5 text-rose-600 dark:text-rose-400" />
              <div>
                <p className="text-xs font-bold text-rose-700 dark:text-rose-300">
                  {breathingSpace.treatment_end_date ? "Post-Treatment Period" : "Treatment Ongoing"}
                </p>
                <p className="text-[10px] text-rose-600 dark:text-rose-400">
                  {breathingSpace.treatment_end_date ? `Exits in ${postTreatmentDaysRemaining}d` : "No exit timer yet"}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Progress Bar for Standard */}
        {!isMHC && (
          <div className="relative mt-4">
            <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
              <div className="h-full rounded-full bg-gradient-to-r from-sky-500 to-sky-600 transition-all duration-500" style={{ width: `${progressPct}%` }} />
            </div>
            <div className="mt-1.5 flex justify-between text-[10px] text-slate-400">
              <span>Day 1</span>
              <span>Day 30 (Midway Review)</span>
              <span>Day 50 (Finalization)</span>
              <span>Day 60 (Expiry)</span>
            </div>
          </div>
        )}
      </div>

      {/* Account Lock Status Panel */}
      <div className="panel p-4">
        <div className="mb-3 flex items-center gap-2">
          <Snowflake className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">System Account Lock</h3>
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">ACTIVE</span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <AccountLockIndicator
            icon={<Pause className="h-4 w-4" />}
            label="Payment Schedule Paused"
            description="All automated payment collection and distribution halted"
            active={breathingSpace.account_lock_active}
          />
          <AccountLockIndicator
            icon={<BellOff className="h-4 w-4" />}
            label="Reminders Suppressed"
            description="Automated SMS and email payment reminders disabled"
            active={breathingSpace.account_lock_active}
          />
          <AccountLockIndicator
            icon={<Snowflake className="h-4 w-4" />}
            label="Interest & Fees Frozen"
            description="No interest, charges, or fees added to included accounts"
            active={breathingSpace.account_lock_active}
          />
        </div>
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/50">
          <FileText className="h-3.5 w-3.5 text-slate-400" />
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {includedCreditors.length} creditor accounts frozen · {formatCurrency(totalFrozenDebt, "GBP", { compact: true })} total debt under moratorium protection
          </p>
        </div>
      </div>

      {/* Two Column: Included Debts + Review Triggers */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Included Debts */}
        <div className="panel overflow-hidden">
          <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-700">
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Included Debts ({includedCreditors.length})</h3>
          </div>
          {includedCreditors.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-slate-400">No debts were included in this moratorium</div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-700/50">
              {includedCreditors.map((c) => {
                const meta = DEBT_TYPE_META[c.debt_type];
                return (
                  <div key={c.id} className="flex items-center gap-3 px-4 py-2.5">
                    <span className={meta.color}>{meta.icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-sm font-medium text-slate-700 dark:text-slate-200">{c.creditor_name}</p>
                      <p className="text-xs text-slate-400">{meta.label}</p>
                    </div>
                    <span className="text-sm font-bold text-slate-700 dark:text-slate-200">{formatCurrency(c.current_balance, "GBP", { compact: true })}</span>
                    <Snowflake className="h-3.5 w-3.5 text-blue-500" />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Review Triggers / Automated Tasks */}
        <div className="panel overflow-hidden">
          <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-700">
            <div className="flex items-center gap-2">
              <CalendarCheck className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Automated Review Triggers</h3>
            </div>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-700/50">
            {breathingSpace.review_tasks.map((task) => {
              const isDue = !task.completed && daysElapsed >= task.triggerDay;
              return (
                <div key={task.id} className={`flex items-center gap-3 px-4 py-3 ${isDue ? "bg-amber-50/50 dark:bg-amber-500/5" : ""}`}>
                  <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                    task.completed ? "bg-emerald-100 dark:bg-emerald-500/20" : isDue ? "bg-amber-100 dark:bg-amber-500/20" : "bg-slate-100 dark:bg-slate-700"
                  }`}>
                    {task.completed ? <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /> :
                      isDue ? <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" /> :
                      <Clock className="h-4 w-4 text-slate-400" />}
                  </div>
                  <div className="flex-1">
                    <p className={`text-sm font-medium ${task.completed ? "text-slate-400 line-through" : "text-slate-700 dark:text-slate-200"}`}>{task.label}</p>
                    <p className="text-xs text-slate-400">
                      {task.triggerDay === 0 ? "Ongoing" : `Trigger: Day ${task.triggerDay}`}
                      {task.completedAt && ` · Completed ${formatDateShort(task.completedAt)}`}
                      {isDue && " · DUE NOW"}
                    </p>
                  </div>
                  {!task.completed && (
                    <button
                      onClick={() => handleCompleteReview(task.id)}
                      className="rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-300 dark:hover:bg-emerald-500/20"
                    >
                      Mark Done
                    </button>
                  )}
                </div>
              );
            })}

            {/* MHC: Check Crisis Status button */}
            {isMHC && !breathingSpace.treatment_end_date && (
              <div className="flex items-center gap-3 bg-rose-50/50 px-4 py-3 dark:bg-rose-500/5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-100 dark:bg-rose-500/20">
                  <Stethoscope className="h-4 w-4 text-rose-600 dark:text-rose-400" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Check Crisis Status / Treatment Update</p>
                  <p className="text-xs text-slate-400">When treatment ends, the 30-day post-treatment exit timer begins</p>
                </div>
                <button
                  onClick={onTreatmentUpdate}
                  className="rounded-lg bg-rose-600 px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-rose-700"
                >
                  Record Treatment End
                </button>
              </div>
            )}

            {/* MHC: Post-treatment countdown */}
            {isMHC && breathingSpace.treatment_end_date && postTreatmentDaysRemaining !== null && (
              <div className="flex items-center gap-3 bg-amber-50/50 px-4 py-3 dark:bg-amber-500/5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-500/20">
                  <Hourglass className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Post-Treatment Exit Timer</p>
                  <p className="text-xs text-slate-400">
                    Treatment ended {formatDateShort(breathingSpace.treatment_end_date)} · Moratorium expires {formatDateShort(breathingSpace.post_treatment_exit_date!)}
                  </p>
                </div>
                <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
                  {postTreatmentDaysRemaining}d left
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Nominated Contact (MHC only) */}
      {isMHC && breathingSpace.nominated_contact_name && (
        <div className="panel p-4">
          <div className="mb-3 flex items-center gap-2">
            <UserCog className="h-4 w-4 text-rose-600 dark:text-rose-400" />
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Nominated Point of Contact</h3>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <DetailField label="Name" value={breathingSpace.nominated_contact_name} />
            <DetailField label="Relationship" value={breathingSpace.nominated_contact_relationship ?? "—"} />
            <DetailField label="Phone" value={breathingSpace.nominated_contact_phone ?? "—"} />
            <DetailField label="Email" value={breathingSpace.nominated_contact_email ?? "—"} />
          </div>
          {breathingSpace.amhp_evidence_file_name && (
            <div className="mt-3 flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 dark:bg-emerald-500/10">
              <FileCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <span className="text-xs text-emerald-700 dark:text-emerald-300">AMHP Evidence on file: {breathingSpace.amhp_evidence_file_name}</span>
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="btn btn-secondary text-sm text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10">
          <XCircle className="h-4 w-4" /> Cancel Moratorium
        </button>
      </div>
    </div>
  );
}

function AccountLockIndicator({ icon, label, description, active }: {
  icon: React.ReactNode; label: string; description: string; active: boolean;
}) {
  return (
    <div className={`flex items-start gap-3 rounded-xl border p-3 transition-all ${
      active ? "border-blue-200 bg-blue-50/50 dark:border-blue-500/30 dark:bg-blue-500/5" : "border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50"
    }`}>
      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
        active ? "bg-blue-100 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400" : "bg-slate-200 text-slate-400 dark:bg-slate-700"
      }`}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className={`text-sm font-semibold ${active ? "text-slate-800 dark:text-slate-100" : "text-slate-400"}`}>{label}</p>
        <p className="text-xs text-slate-400">{description}</p>
      </div>
      {active && <div className="ml-auto h-2 w-2 shrink-0 animate-pulse rounded-full bg-blue-500" />}
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-slate-400">{label}</p>
      <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{value}</p>
    </div>
  );
}

// ── Initiation Modal ──

function BreathingSpaceInitiationModal({ caseId, caseData, creditors, onClose, onCreated, onError }: {
  caseId: string;
  caseData: DebtCase;
  creditors: DebtCreditor[];
  onClose: () => void;
  onCreated: () => void;
  onError: (msg: string) => void;
}) {
  const [type, setType] = useState<BreathingSpaceType>("standard");
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [eligibility, setEligibility] = useState<BreathingSpaceEligibilityChecks | null>(null);
  const [checkingEligibility, setCheckingEligibility] = useState(false);
  const [selectedCreditorIds, setSelectedCreditorIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // AMHP / MHC fields
  const [amhpFileName, setAmhpFileName] = useState<string | null>(null);
  const [nomName, setNomName] = useState("");
  const [nomPhone, setNomPhone] = useState("");
  const [nomEmail, setNomEmail] = useState("");
  const [nomRelationship, setNomRelationship] = useState("");

  const qualifyingCreditors = creditors.filter((c) => BS_QUALIFYING_DEBT_TYPES.includes(c.debt_type));
  const excludedCreditors = creditors.filter((c) => BS_EXCLUDED_DEBT_TYPES.includes(c.debt_type));
  const totalSelectedDebt = creditors.filter((c) => selectedCreditorIds.includes(c.id)).reduce((s, c) => s + c.current_balance, 0);

  const runEligibilityCheck = async () => {
    setCheckingEligibility(true);
    try {
      const result = await checkBreathingSpaceEligibility(caseId, caseData.plan_type);
      setEligibility(result);
      setStep(2);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setCheckingEligibility(false);
    }
  };

  const toggleCreditor = (id: string) => {
    setSelectedCreditorIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };

  const handleInitiate = async () => {
    setSaving(true);
    try {
      const reviewTasks: BreathingSpaceReviewTask[] = type === "standard"
        ? [
            { id: crypto.randomUUID(), label: "Day 30 Midway Review", triggerDay: 30, completed: false, completedAt: null },
            { id: crypto.randomUUID(), label: "Day 50 Solution Finalization Prompt", triggerDay: 50, completed: false, completedAt: null },
          ]
        : [
            { id: crypto.randomUUID(), label: "Check Crisis Status / Treatment Update", triggerDay: 0, completed: false, completedAt: null },
          ];

      await createBreathingSpace({
        case_id: caseId,
        moratorium_type: type,
        included_creditor_ids: selectedCreditorIds,
        eligibility_checks: eligibility ?? { noActiveInLast12Months: true, residentEnglandWales: true, noActiveIvaDro: true, checkedAt: new Date().toISOString() },
        review_tasks: reviewTasks,
        amhp_evidence_file_name: type === "mental_health_crisis" ? amhpFileName : null,
        nominated_contact_name: type === "mental_health_crisis" ? nomName || null : null,
        nominated_contact_phone: type === "mental_health_crisis" ? nomPhone || null : null,
        nominated_contact_email: type === "mental_health_crisis" ? nomEmail || null : null,
        nominated_contact_relationship: type === "mental_health_crisis" ? nomRelationship || null : null,
      });
      onCreated();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const eligibilityPassed = eligibility ? (eligibility.noActiveInLast12Months && eligibility.residentEnglandWales && eligibility.noActiveIvaDro) : false;
  const canProceedToStep3 = type === "mental_health_crisis" || eligibilityPassed;
  const canInitiate = selectedCreditorIds.length > 0 && (type === "mental_health_crisis" || eligibilityPassed);

  return (
    <Modal onClose={onClose} title="Initiate Breathing Space" children={
      <div className="space-y-4">
        {/* Step indicator */}
        <div className="flex items-center gap-2">
          {[1, 2, 3].map((s) => (
            <div key={s} className="flex items-center gap-2">
              <div className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                step >= s ? "bg-sky-600 text-white" : "bg-slate-200 text-slate-500 dark:bg-slate-700"
              }`}>{s}</div>
              {s < 3 && <div className={`h-0.5 w-8 ${step > s ? "bg-sky-600" : "bg-slate-200 dark:bg-slate-700"}`} />}
            </div>
          ))}
          <span className="ml-2 text-xs text-slate-400">
            {step === 1 ? "Type & Eligibility" : step === 2 ? "Debt Selection" : "Review & Confirm"}
          </span>
        </div>

        {/* Step 1: Type Selection + Eligibility */}
        {step === 1 && (
          <div className="space-y-4">
            {/* Radio selection */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                onClick={() => setType("standard")}
                className={`flex flex-col items-start gap-2 rounded-xl border-2 p-4 text-left transition-all ${
                  type === "standard" ? "border-sky-500 bg-sky-50 dark:border-sky-500/50 dark:bg-sky-500/10" : "border-slate-200 dark:border-slate-700"
                }`}
              >
                <div className="flex items-center gap-2">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${type === "standard" ? "bg-sky-100 dark:bg-sky-500/20" : "bg-slate-100 dark:bg-slate-700"}`}>
                    <Wind className="h-5 w-5 text-sky-600 dark:text-sky-400" />
                  </div>
                  <div className={`h-4 w-4 rounded-full border-2 ${type === "standard" ? "border-sky-600 bg-sky-600" : "border-slate-300"}`}>
                    {type === "standard" && <div className="m-auto mt-0.5 h-1.5 w-1.5 rounded-full bg-white" />}
                  </div>
                </div>
                <p className="text-sm font-bold text-slate-800 dark:text-slate-100">Standard 60-Day Breathing Space</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">Legal protection from creditor action for 60 days while a debt solution is arranged.</p>
              </button>

              <button
                onClick={() => setType("mental_health_crisis")}
                className={`flex flex-col items-start gap-2 rounded-xl border-2 p-4 text-left transition-all ${
                  type === "mental_health_crisis" ? "border-rose-500 bg-rose-50 dark:border-rose-500/50 dark:bg-rose-500/10" : "border-slate-200 dark:border-slate-700"
                }`}
              >
                <div className="flex items-center gap-2">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${type === "mental_health_crisis" ? "bg-rose-100 dark:bg-rose-500/20" : "bg-slate-100 dark:bg-slate-700"}`}>
                    <HeartPulse className="h-5 w-5 text-rose-600 dark:text-rose-400" />
                  </div>
                  <div className={`h-4 w-4 rounded-full border-2 ${type === "mental_health_crisis" ? "border-rose-600 bg-rose-600" : "border-slate-300"}`}>
                    {type === "mental_health_crisis" && <div className="m-auto mt-0.5 h-1.5 w-1.5 rounded-full bg-white" />}
                  </div>
                </div>
                <p className="text-sm font-bold text-slate-800 dark:text-slate-100">Mental Health Crisis Moratorium</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">No time limit — lasts during treatment plus 30 days after treatment ends. Requires AMHP approval.</p>
              </button>
            </div>

            {/* Standard: Eligibility Check */}
            {type === "standard" && !eligibility && (
              <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                <p className="mb-3 text-sm font-medium text-slate-600 dark:text-slate-300">Run automatic eligibility verification:</p>
                <ul className="mb-3 space-y-1.5 text-xs text-slate-500 dark:text-slate-400">
                  <li className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-slate-400" /> No active Breathing Space in the last 12 months</li>
                  <li className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-slate-400" /> Debtor is resident in England or Wales</li>
                  <li className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-slate-400" /> No active IVA or DRO in place</li>
                </ul>
                <button onClick={runEligibilityCheck} disabled={checkingEligibility} className="btn btn-primary bg-sky-600 text-sm hover:bg-sky-700 disabled:opacity-40">
                  {checkingEligibility ? <><RefreshCw className="h-4 w-4 animate-spin" /> Checking...</> : <><ShieldCheck className="h-4 w-4" /> Check Eligibility</>}
                </button>
              </div>
            )}

            {/* Standard: Eligibility Results */}
            {type === "standard" && eligibility && (
              <div className={`rounded-xl border p-4 ${eligibilityPassed ? "border-emerald-300 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10" : "border-rose-300 bg-rose-50 dark:border-rose-500/30 dark:bg-rose-500/10"}`}>
                <p className={`mb-3 text-sm font-bold ${eligibilityPassed ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300"}`}>
                  {eligibilityPassed ? "Eligibility Verified" : "Eligibility Issues Detected"}
                </p>
                <div className="space-y-2">
                  <EligibilityRow label="No active Breathing Space in last 12 months" passed={eligibility.noActiveInLast12Months} />
                  <EligibilityRow label="Resident in England or Wales" passed={eligibility.residentEnglandWales} />
                  <EligibilityRow label="No active IVA or DRO" passed={eligibility.noActiveIvaDro} />
                </div>
                {!eligibilityPassed && (
                  <p className="mt-3 text-xs text-rose-600 dark:text-rose-400">
                    Some eligibility criteria were not met. You may still proceed with a Mental Health Crisis Moratorium if applicable, or override after supervisor approval.
                  </p>
                )}
                <div className="mt-3 flex gap-2">
                  <button onClick={() => setEligibility(null)} className="btn btn-secondary text-xs">Re-check</button>
                  {canProceedToStep3 && (
                    <button onClick={() => setStep(2)} className="btn btn-primary bg-sky-600 text-xs hover:bg-sky-700">Continue to Debt Selection</button>
                  )}
                </div>
              </div>
            )}

            {/* MHC: AMHP Evidence Form + Nominated Contact */}
            {type === "mental_health_crisis" && (
              <div className="space-y-3">
                <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-4 dark:border-rose-500/30 dark:bg-rose-500/5">
                  <div className="mb-2 flex items-center gap-2">
                    <FlaskConical className="h-4 w-4 text-rose-600 dark:text-rose-400" />
                    <p className="text-sm font-bold text-rose-700 dark:text-rose-300">AMHP Evidence Required</p>
                  </div>
                  <p className="mb-3 text-xs text-rose-600 dark:text-rose-400/80">
                    A Approved Mental Health Professional (AMHP) must confirm the debtor is receiving mental health crisis treatment.
                    Upload the evidence form below.
                  </p>

                  {/* Upload Dropzone */}
                  <label
                    className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-rose-300 bg-white px-4 py-6 text-center transition-all hover:border-rose-500 hover:bg-rose-50/50 dark:border-rose-500/40 dark:bg-slate-800 dark:hover:bg-rose-500/10"
                  >
                    <input
                      type="file"
                      accept=".pdf,.jpg,.png,.docx"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) setAmhpFileName(f.name);
                      }}
                    />
                    {amhpFileName ? (
                      <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
                        <FileCheck className="h-5 w-5" />
                        <span className="font-medium">{amhpFileName}</span>
                      </div>
                    ) : (
                      <>
                        <FileUp className="mb-2 h-8 w-8 text-rose-400" />
                        <p className="text-sm font-medium text-slate-600 dark:text-slate-300">Drop AMHP evidence form here or click to upload</p>
                        <p className="mt-1 text-xs text-slate-400">PDF, JPG, PNG, or DOCX up to 10MB</p>
                      </>
                    )}
                  </label>
                </div>

                {/* Nominated Point of Contact */}
                <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                  <div className="mb-3 flex items-center gap-2">
                    <UserCog className="h-4 w-4 text-slate-600 dark:text-slate-400" />
                    <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Nominated Point of Contact</p>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field label="Contact Name"><input value={nomName} onChange={(e) => setNomName(e.target.value)} className="input text-sm" placeholder="e.g. Dr. Jane Smith" /></Field>
                    <Field label="Relationship to Debtor"><input value={nomRelationship} onChange={(e) => setNomRelationship(e.target.value)} className="input text-sm" placeholder="e.g. AMHP / Care Coordinator" /></Field>
                    <Field label="Phone"><input value={nomPhone} onChange={(e) => setNomPhone(e.target.value)} className="input text-sm" placeholder="07000 000000" /></Field>
                    <Field label="Email"><input value={nomEmail} onChange={(e) => setNomEmail(e.target.value)} className="input text-sm" placeholder="contact@nhs.net" /></Field>
                  </div>
                </div>

                <button onClick={() => setStep(2)} disabled={!amhpFileName} className="btn btn-primary bg-rose-600 text-sm hover:bg-rose-700 disabled:opacity-40">
                  Continue to Debt Selection
                </button>
              </div>
            )}
          </div>
        )}

        {/* Step 2: Debt Selection Checklist */}
        {step === 2 && (
          <div className="space-y-4">
            <div>
              <h4 className="mb-1 text-sm font-bold text-slate-800 dark:text-slate-100">Select Debts to Include</h4>
              <p className="text-xs text-slate-500 dark:text-slate-400">Only qualifying debts can be included. Some debt types are excluded by statute.</p>
            </div>

            {/* Qualifying Debts */}
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">Qualifying Debts ({qualifyingCreditors.length})</p>
              {qualifyingCreditors.length === 0 ? (
                <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-400 dark:bg-slate-800/50">No qualifying creditors on this case</p>
              ) : (
                qualifyingCreditors.map((c) => {
                  const meta = DEBT_TYPE_META[c.debt_type];
                  const selected = selectedCreditorIds.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      onClick={() => toggleCreditor(c.id)}
                      className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-all ${
                        selected ? "border-emerald-500 bg-emerald-50 dark:border-emerald-500/40 dark:bg-emerald-500/10" : "border-slate-200 hover:border-slate-300 dark:border-slate-700"
                      }`}
                    >
                      <div className={`flex h-5 w-5 items-center justify-center rounded border-2 ${selected ? "border-emerald-600 bg-emerald-600" : "border-slate-300 dark:border-slate-600"}`}>
                        {selected && <CheckCircle2 className="h-3 w-3 text-white" />}
                      </div>
                      <span className={meta.color}>{meta.icon}</span>
                      <div className="flex-1 min-w-0">
                        <p className="truncate text-sm font-medium text-slate-700 dark:text-slate-200">{c.creditor_name}</p>
                        <p className="text-xs text-slate-400">{meta.label} · {formatCurrency(c.current_balance, "GBP")}</p>
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            {/* Excluded Debts */}
            {excludedCreditors.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-rose-600 dark:text-rose-400">Excluded by Statute ({excludedCreditors.length})</p>
                {excludedCreditors.map((c) => {
                  const meta = DEBT_TYPE_META[c.debt_type];
                  return (
                    <div key={c.id} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
                      <div className="flex h-5 w-5 items-center justify-center rounded border-2 border-slate-300 dark:border-slate-600">
                        <ShieldX className="h-3 w-3 text-slate-400" />
                      </div>
                      <span className="opacity-40">{meta.icon}</span>
                      <div className="flex-1 min-w-0">
                        <p className="truncate text-sm font-medium text-slate-500 dark:text-slate-400">{c.creditor_name}</p>
                        <p className="text-xs text-slate-400">{meta.label} · {formatCurrency(c.current_balance, "GBP")}</p>
                      </div>
                      <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-700 dark:text-slate-400">Excluded</span>
                    </div>
                  );
                })}
                <div className="rounded-lg bg-amber-50 px-3 py-2 dark:bg-amber-500/10">
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    Student Loans, CMS payments, and Court Fines are excluded from Breathing Space by the 2020 Regulations.
                    Council Tax arrears after a liability order are also excluded.
                  </p>
                </div>
              </div>
            )}

            {/* Selection Summary */}
            <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-800/50">
              <span className="text-sm text-slate-600 dark:text-slate-300">{selectedCreditorIds.length} debts selected</span>
              <span className="text-sm font-bold text-slate-800 dark:text-slate-100">{formatCurrency(totalSelectedDebt, "GBP")}</span>
            </div>

            <div className="flex gap-2">
              <button onClick={() => setStep(1)} className="btn btn-secondary text-sm">Back</button>
              <button onClick={() => setStep(3)} disabled={selectedCreditorIds.length === 0} className="btn btn-primary bg-sky-600 text-sm hover:bg-sky-700 disabled:opacity-40">
                Review & Confirm
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Review & Confirm */}
        {step === 3 && (
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
              <h4 className="mb-3 text-sm font-bold text-slate-800 dark:text-slate-100">Confirm Breathing Space Details</h4>
              <div className="space-y-2 text-sm">
                <ConfirmRow label="Type" value={type === "standard" ? "Standard 60-Day Breathing Space" : "Mental Health Crisis Moratorium"} />
                <ConfirmRow label="Start Date" value={formatDateShort(new Date().toISOString())} />
                {type === "standard" && (
                  <ConfirmRow label="End Date" value={formatDateShort(new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString())} />
                )}
                <ConfirmRow label="Included Debts" value={`${selectedCreditorIds.length} creditors · ${formatCurrency(totalSelectedDebt, "GBP")}`} />
                {type === "mental_health_crisis" && (
                  <>
                    <ConfirmRow label="AMHP Evidence" value={amhpFileName ?? "Not uploaded"} />
                    {nomName && <ConfirmRow label="Nominated Contact" value={nomName} />}
                  </>
                )}
              </div>
            </div>

            {/* Auto-scheduled tasks preview */}
            <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4 dark:border-amber-500/30 dark:bg-amber-500/5">
              <div className="mb-2 flex items-center gap-2">
                <CalendarCheck className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                <p className="text-sm font-bold text-amber-700 dark:text-amber-300">Automated Review Tasks</p>
              </div>
              <ul className="space-y-1 text-xs text-amber-700 dark:text-amber-400/80">
                {type === "standard" ? (
                  <>
                    <li>Day 30 — Midway Review task scheduled for advisor</li>
                    <li>Day 50 — Solution Finalization prompt</li>
                  </>
                ) : (
                  <li>Ongoing — Check Crisis Status / Treatment Update (triggers 30-day exit timer when treatment ends)</li>
                )}
              </ul>
            </div>

            {/* System lock notice */}
            <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-3 dark:border-blue-500/30 dark:bg-blue-500/5">
              <div className="flex items-center gap-2">
                <Snowflake className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                <p className="text-xs text-blue-700 dark:text-blue-300">
                  On initiation: payment schedule will be paused, automated reminders suppressed, and interest/fees frozen on all included accounts.
                </p>
              </div>
            </div>

            <div className="flex gap-2">
              <button onClick={() => setStep(2)} className="btn btn-secondary text-sm">Back</button>
              <button onClick={handleInitiate} disabled={saving || !canInitiate} className="btn btn-primary bg-sky-600 text-sm hover:bg-sky-700 disabled:opacity-40">
                {saving ? <><RefreshCw className="h-4 w-4 animate-spin" /> Initiating...</> : <><Wind className="h-4 w-4" /> Initiate Breathing Space</>}
              </button>
            </div>
          </div>
        )}
      </div>
    } />
  );
}

function EligibilityRow({ label, passed }: { label: string; passed: boolean }) {
  return (
    <div className="flex items-center gap-2">
      {passed ? <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /> : <XCircle className="h-4 w-4 text-rose-600 dark:text-rose-400" />}
      <span className={`text-sm ${passed ? "text-slate-700 dark:text-slate-200" : "text-rose-700 dark:text-rose-300"}`}>{label}</span>
    </div>
  );
}

function ConfirmRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-slate-400">{label}</span>
      <span className="font-medium text-slate-700 dark:text-slate-200">{value}</span>
    </div>
  );
}

// ── Cancel Modal ──

function CancelBreathingSpaceModal({ breathingSpace, onClose, onCancelled, onError }: {
  breathingSpace: BreathingSpace;
  onClose: () => void;
  onCancelled: () => void;
  onError: (msg: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const isMHC = breathingSpace.moratorium_type === "mental_health_crisis";

  const handleCancel = async () => {
    setSaving(true);
    try {
      await cancelBreathingSpace(breathingSpace.id, reason || "Advisor cancelled");
      onCancelled();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onClose} title="Cancel Breathing Space" children={
      <div className="space-y-4">
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div>
              <p className="text-sm font-bold text-amber-800 dark:text-amber-300">Warning: This will lift the creditor freeze</p>
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-400/80">
                Cancelling the moratorium will immediately resume interest/fee accrual, re-enable automated reminders,
                and allow creditors to resume enforcement action on included debts.
              </p>
            </div>
          </div>
        </div>

        <Field label="Reason for Cancellation">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="input text-sm"
            rows={3}
            placeholder={isMHC ? "e.g. Debtor no longer in mental health crisis, treatment completed, debtor request..." : "e.g. Debtor request, solution finalized, Breathing Space no longer needed..."}
          />
        </Field>

        <div className="flex gap-2">
          <button onClick={onClose} className="btn btn-secondary text-sm">Keep Active</button>
          <button onClick={handleCancel} disabled={saving} className="btn text-sm text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-40">
            {saving ? <><RefreshCw className="h-4 w-4 animate-spin" /> Cancelling...</> : <><XCircle className="h-4 w-4" /> Cancel Moratorium</>}
          </button>
        </div>
      </div>
    } />
  );
}

// ── Treatment Update Modal (MHC only) ──

function TreatmentUpdateModal({ breathingSpace, onClose, onUpdated, onError }: {
  breathingSpace: BreathingSpace;
  onClose: () => void;
  onUpdated: () => void;
  onError: (msg: string) => void;
}) {
  const [treatmentEndDate, setTreatmentEndDate] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);

  const exitDate = new Date(treatmentEndDate);
  exitDate.setDate(exitDate.getDate() + 30);

  const handleSave = async () => {
    setSaving(true);
    try {
      await recordTreatmentEndDate(breathingSpace.id, treatmentEndDate);
      onUpdated();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onClose} title="Record Treatment End Date" children={
      <div className="space-y-4">
        <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-4 dark:border-rose-500/30 dark:bg-rose-500/5">
          <div className="flex items-start gap-2">
            <Stethoscope className="mt-0.5 h-5 w-5 shrink-0 text-rose-600 dark:text-rose-400" />
            <div>
              <p className="text-sm font-bold text-rose-700 dark:text-rose-300">Mental Health Crisis Treatment Update</p>
              <p className="mt-1 text-xs text-rose-600 dark:text-rose-400/80">
                Recording the treatment end date will start the 30-day post-treatment exit timer.
                The moratorium will expire on {formatDateShort(exitDate.toISOString())}.
              </p>
            </div>
          </div>
        </div>

        <Field label="Treatment End Date">
          <input type="date" value={treatmentEndDate} onChange={(e) => setTreatmentEndDate(e.target.value)} className="input text-sm" />
        </Field>

        <div className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 dark:bg-amber-500/10">
          <Hourglass className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          <p className="text-xs text-amber-700 dark:text-amber-400">
            Moratorium will expire on: <span className="font-bold">{formatDateShort(exitDate.toISOString())}</span> (30 days after treatment end)
          </p>
        </div>

        <div className="flex gap-2">
          <button onClick={onClose} className="btn btn-secondary text-sm">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="btn btn-primary bg-rose-600 text-sm hover:bg-rose-700 disabled:opacity-40">
            {saving ? <><RefreshCw className="h-4 w-4 animate-spin" /> Saving...</> : <><CheckCircle2 className="h-4 w-4" /> Record & Start Exit Timer</>}
          </button>
        </div>
      </div>
    } />
  );
}

// ============================================================
// Compliance & Audit Tab
// ============================================================

function ComplianceTab({ caseId, caseData }: { caseId: string | null; caseData: DebtCase | null }) {
  const { data: auditLog, loading, error, reload } = useDebtAuditLog(caseId);
  const [showAdd, setShowAdd] = useState(false);
  const [milestone, setMilestone] = useState("");
  const [description, setDescription] = useState("");
  const [actor, setActor] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const MILESTONE_PRESETS = ["Case Opened", "SFS Approved", "Creditor Pack Sent", "Payment Schedule Active", "Distribution Processed", "Compliance Review"];

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!caseId || !milestone.trim()) return;
    setActionError(null);
    try {
      await addAuditMilestone({ case_id: caseId, milestone, description: description || undefined, actor: actor || undefined });
      setMilestone(""); setDescription(""); setActor(""); setShowAdd(false); reload();
    } catch (e) { setActionError((e as Error).message); }
  }

  async function handleActivateSchedule() {
    if (!caseId) return;
    try {
      await updateDebtCase(caseId, { status: "payment_schedule_active" });
      await addAuditMilestone({ case_id: caseId, milestone: "Payment Schedule Active", description: "Monthly distribution schedule activated" });
      reload();
    } catch (e) { setActionError((e as Error).message); }
  }

  if (!caseData) return <div className="flex h-full items-center justify-center text-sm text-slate-400">Select a case to view compliance timeline</div>;

  return (
    <div className="space-y-4">
      {actionError && <div className="rounded-xl bg-rose-50 px-4 py-2 text-sm text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">{actionError}</div>}

      {/* Compliance Status Banner */}
      <div className="panel flex flex-wrap items-center gap-3 p-4 fade-in">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-500/10">
          <ShieldCheck className="h-5 w-5 text-emerald-600" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-bold text-slate-800 dark:text-slate-100">Compliance Status: {STATUS_META[caseData.status].label}</p>
          <p className="text-xs text-slate-400">{auditLog.length} milestones recorded · Last activity {auditLog.length > 0 ? relativeTime(auditLog[0].created_at) : "never"}</p>
        </div>
        {caseData.status === "creditor_pack_sent" && (
          <button onClick={handleActivateSchedule} className="btn btn-primary bg-emerald-600 text-sm hover:bg-emerald-700">
            <Calendar className="h-4 w-4" /> Activate Payment Schedule
          </button>
        )}
        <button onClick={() => setShowAdd(!showAdd)} className="btn btn-secondary text-sm">
          <Plus className="h-4 w-4" /> Add Milestone
        </button>
      </div>

      {/* Add Milestone Form */}
      {showAdd && (
        <form onSubmit={handleAdd} className="panel grid grid-cols-1 gap-3 p-4 fade-in sm:grid-cols-3">
          <Field label="Milestone">
            <input value={milestone} onChange={(e) => setMilestone(e.target.value)} list="milestone-presets" className="input text-sm" placeholder="Custom or select preset" required autoFocus />
            <datalist id="milestone-presets">{MILESTONE_PRESETS.map((m) => <option key={m} value={m} />)}</datalist>
          </Field>
          <Field label="Description (optional)"><input value={description} onChange={(e) => setDescription(e.target.value)} className="input text-sm" placeholder="Details..." /></Field>
          <Field label="Actor (optional)"><input value={actor} onChange={(e) => setActor(e.target.value)} className="input text-sm" placeholder="Advisor name" /></Field>
          <div className="flex gap-2 sm:col-span-3">
            <button type="submit" className="btn btn-primary bg-emerald-600 text-sm hover:bg-emerald-700"><Plus className="h-4 w-4" /> Record Milestone</button>
            <button type="button" onClick={() => setShowAdd(false)} className="btn btn-secondary text-sm">Cancel</button>
          </div>
        </form>
      )}

      {/* Audit Timeline */}
      {loading ? (
        <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-16 rounded-xl" />)}</div>
      ) : auditLog.length === 0 ? (
        <div className="panel flex flex-col items-center justify-center py-12 text-slate-400">
          <ScrollText className="mb-3 h-10 w-10 opacity-30" />
          <p className="text-sm">No compliance milestones recorded yet</p>
        </div>
      ) : (
        <div className="panel p-4">
          <div className="relative">
            {/* Timeline line */}
            <div className="absolute left-[15px] top-2 bottom-2 w-0.5 bg-slate-200 dark:bg-slate-700" />

            <div className="space-y-4">
              {auditLog.map((entry) => (
                <div key={entry.id} className="relative flex items-start gap-4">
                  {/* Timeline dot */}
                  <div className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-emerald-500 bg-white dark:bg-slate-800">
                    {MILESTONE_ICONS[entry.milestone] ?? <FileText className="h-3.5 w-3.5 text-emerald-600" />}
                  </div>
                  {/* Content */}
                  <div className="flex-1 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800/50">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{entry.milestone}</p>
                      <span className="text-[10px] text-slate-400">{formatDateShort(entry.created_at)}</span>
                    </div>
                    {entry.description && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{entry.description}</p>}
                    {entry.actor && <p className="mt-1 text-[10px] text-slate-400">by {entry.actor}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Compliance Checklist */}
      <div className="panel p-4">
        <h3 className="mb-3 text-sm font-bold text-slate-800 dark:text-slate-100">Compliance Checklist</h3>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {MILESTONE_PRESETS.map((m) => {
            const completed = auditLog.some((e) => e.milestone === m);
            return (
              <div key={m} className={`flex items-center gap-2 rounded-lg border p-2.5 ${completed ? "border-emerald-200 bg-emerald-50 dark:border-emerald-500/20 dark:bg-emerald-500/5" : "border-slate-200 dark:border-slate-700"}`}>
                {completed ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Clock className="h-4 w-4 text-slate-300" />}
                <span className={`text-xs ${completed ? "font-medium text-emerald-700 dark:text-emerald-300" : "text-slate-500 dark:text-slate-400"}`}>{m}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Shared UI Components
// ============================================================

function KpiCard({ icon, label, value, sub, accent }: { icon: React.ReactNode; label: string; value: string; sub: string; accent: string }) {
  return (
    <div className="panel p-4 transition-all hover:shadow-md">
      <div className="flex items-center justify-between">
        <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${accent}`}>{icon}</span>
      </div>
      <p className="mt-2 text-2xl font-bold tracking-tight text-slate-800 dark:text-slate-100">{value}</p>
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-0.5 text-[10px] text-slate-400">{sub}</p>
    </div>
  );
}

function SummaryItem({ label, value, icon, accent }: { label: string; value: string; icon: React.ReactNode; accent?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800/50">
      <div className="flex items-center gap-2">
        <span className={accent ?? "text-slate-500"}>{icon}</span>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</span>
      </div>
      <p className="mt-1 text-lg font-bold text-slate-800 dark:text-slate-100">{value}</p>
    </div>
  );
}

function CompareMetric({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 pb-2 last:border-0 dark:border-slate-700/50">
      <div className="flex items-center gap-2">
        <span className="text-slate-400">{icon}</span>
        <span className="text-xs text-slate-500 dark:text-slate-400">{label}</span>
      </div>
      <span className="text-sm font-bold text-slate-800 dark:text-slate-100">{value}</span>
    </div>
  );
}

function UnhandledTabState({ tabId, onReset }: { tabId: string; onReset: () => void }) {
  return (
    <div className="panel flex flex-col items-center justify-center py-16 text-center fade-in">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 dark:bg-slate-700/50">
        <AlertCircle className="h-7 w-7 text-slate-400" />
      </div>
      <h3 className="text-base font-bold text-slate-700 dark:text-slate-200">Module not available</h3>
      <p className="mt-1 max-w-sm text-sm text-slate-400">
        The "{tabId}" view is not configured for this workspace. Return to the dashboard overview to continue.
      </p>
      <button onClick={onReset} className="btn btn-secondary mt-4 text-sm">
        <LayoutDashboard className="h-4 w-4" /> Back to Dashboard
      </button>
    </div>
  );
}
