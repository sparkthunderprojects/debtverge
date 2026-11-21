import { useState, useMemo } from "react";
import {
  Smartphone, FileCheck, FileSignature, Upload, CheckCircle2, Clock,
  AlertCircle, FileText, Phone, Shield, Info, ClipboardList, Compass,
  TrendingUp, ArrowRight, Scale, Building2, Lightbulb, Route, Wallet,
} from "lucide-react";
import { formatCurrency } from "@/lib/format";
import {
  useDocumentChecklist, addDocumentChecklistItem,
  saveSignpostingAssessment,
} from "@/lib/insolvency-hooks";
import { runPathfinderEngine, ROUTE_LABELS } from "@/lib/insolvency-docs";
import type { DebtCase, DocumentType, SignpostingRoute } from "@/lib/types";

// ============================================================
// Debtor Self-Service Onboarding & Document Upload Portal
// (Module 1 — enhanced with signposting + lead intake workflow)
// ============================================================

const DOC_TYPES_DEBTOR: { type: DocumentType; label: string; desc: string; icon: typeof FileText }[] = [
  { type: "bank_statement", label: "Bank Statements", desc: "Last 3 months for all accounts", icon: FileText },
  { type: "payslip", label: "Payslips", desc: "Last 3 months of payslips", icon: FileText },
  { type: "id_kyc", label: "ID / KYC Proof", desc: "Passport or driving licence + proof of address", icon: Shield },
  { type: "tax_record", label: "Tax Documents", desc: "Latest SA302 or P60", icon: FileText },
];

const FACT_FIND_STEPS = [
  { id: "personal", label: "Personal Details", desc: "Name, DOB, contact info" },
  { id: "household", label: "Household Composition", desc: "Dependants & partner details" },
  { id: "income", label: "Income Details", desc: "Employment, benefits, other income" },
  { id: "expenditure", label: "SFS Budget", desc: "Essential & discretionary spending" },
  { id: "creditors", label: "Creditor List", desc: "All debts and account numbers" },
  { id: "assets", label: "Asset Declaration", desc: "Property, vehicles, savings" },
];

const SIGNPOSTING_ORGS = [
  { name: "StepChange Debt Charity", desc: "Free, confidential debt advice", phone: "0800 138 1111" },
  { name: "National Debtline", desc: "Free advice & self-help resources", phone: "0808 808 4000" },
  { name: "Citizens Advice", desc: "General advice including debt", phone: "0800 144 8848" },
  { name: "MoneyHelper", desc: "Government-backed money guidance", phone: "0800 138 7777" },
];

const ROUTE_ICONS: Record<SignpostingRoute, typeof Scale> = {
  iva: Scale, dmp: Wallet, dro: Shield, bankruptcy: Building2, signposting: Compass,
};

const ROUTE_DESCRIPTIONS: Record<SignpostingRoute, string> = {
  iva: "An Individual Voluntary Arrangement — a legally binding agreement with your creditors to repay a portion of your debt over a fixed period (usually 5–6 years).",
  dmp: "A Debt Management Plan — an informal arrangement to repay debts at an affordable monthly rate, with no legal protection but full flexibility.",
  dro: "A Debt Relief Order — a formal solution for people with low debt (under £30k), low income, and minimal assets. Debt is written off after 12 months.",
  bankruptcy: "Bankruptcy — a legal process that writes off most debts. Usually lasts 12 months but may require asset sale including property.",
  signposting: "Based on your assessment, we recommend speaking to a free debt advice service first to explore your options fully.",
};

export function DebtorSelfServiceView({ caseId, caseData }: { caseId: string; caseData: DebtCase }) {
  const { data: docs, reload } = useDocumentChecklist(caseId);
  const [selectedDocType, setSelectedDocType] = useState<DocumentType | null>(null);
  const [fileName, setFileName] = useState("");
  const [activeSection, setActiveSection] = useState<"overview" | "signposting" | "documents" | "advice">("overview");

  // Signposting assessment form
  const [signpostingForm, setSignpostingForm] = useState({
    total_debt: 0, disposable_income: 0, creditor_count: 0, has_property: false, asset_equity: 0,
  });
  const [assessmentResult, setAssessmentResult] = useState<ReturnType<typeof runPathfinderEngine> | null>(null);

  const handleUpload = async () => {
    if (!selectedDocType || !fileName) return;
    await addDocumentChecklistItem(caseId, {
      document_type: selectedDocType,
      file_name: fileName,
      uploaded_by_role: "debtor",
    });
    setFileName("");
    setSelectedDocType(null);
    reload();
  };

  const handleRunAssessment = async () => {
    const result = runPathfinderEngine({
      totalDebt: signpostingForm.total_debt,
      disposableIncome: signpostingForm.disposable_income,
      creditorCount: signpostingForm.creditor_count,
      assetEquity: signpostingForm.asset_equity,
      hasProperty: signpostingForm.has_property,
    });
    setAssessmentResult(result);
    try {
      await saveSignpostingAssessment(caseId, {
        total_debt: signpostingForm.total_debt,
        monthly_disposable_income: signpostingForm.disposable_income,
        creditor_count: signpostingForm.creditor_count,
        recommended_route: result.recommendedRoute,
        route_confidence: result.confidence,
        route_reasons: result.reasons,
        assessment_data: {
          has_property: signpostingForm.has_property,
          asset_equity: signpostingForm.asset_equity,
          all_routes: result.allRoutes,
          estimated_time_months: result.estimatedTimeMonths,
          estimated_total_cost: result.estimatedTotalCost,
        },
      });
    } catch { /* assessment still shown in UI */ }
  };

  const completedSteps = FACT_FIND_STEPS.filter((_, i) => i < 4).length;
  const factFindProgress = Math.round((completedSteps / FACT_FIND_STEPS.length) * 100);
  const pendingDocs = docs.filter((d) => d.status === "pending").length;
  const approvedDocs = docs.filter((d) => d.status === "approved").length;
  const rejectedDocs = docs.filter((d) => d.status === "rejected").length;

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4 sm:p-6">
      {/* Header */}
      <div className="panel p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 dark:bg-blue-500/10">
            <Smartphone className="h-5 w-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="flex-1">
            <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">Your Debt Solution Journey</h2>
            <p className="text-xs text-slate-400">Case {caseData.case_number}</p>
          </div>
        </div>
        {/* Section nav */}
        <div className="mt-4 flex gap-1.5 overflow-x-auto">
          {([
            { id: "overview", label: "Overview", icon: ClipboardList },
            { id: "signposting", label: "Assessment", icon: Compass },
            { id: "documents", label: "Documents", icon: FileCheck },
            { id: "advice", label: "Free Help", icon: Info },
          ] as const).map((s) => {
            const Icon = s.icon;
            return (
              <button
                key={s.id}
                onClick={() => setActiveSection(s.id)}
                className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-all ${
                  activeSection === s.id
                    ? "bg-blue-600 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
                }`}
              >
                <Icon className="h-3.5 w-3.5" /> {s.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Overview Section */}
      {activeSection === "overview" && (
        <>
          <div className="panel p-5">
            <div className="mb-3 flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-violet-500" />
              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Fact-Find Progress</h3>
            </div>
            <div className="mb-3 h-2.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
              <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-blue-500 transition-all duration-500" style={{ width: `${factFindProgress}%` }} />
            </div>
            <div className="space-y-2">
              {FACT_FIND_STEPS.map((step, i) => {
                const done = i < completedSteps;
                const current = i === completedSteps;
                return (
                  <div key={step.id} className={`flex items-center gap-3 rounded-xl border p-3 ${current ? "border-blue-300 bg-blue-50 dark:border-blue-500/30 dark:bg-blue-500/5" : "border-slate-200 dark:border-slate-700"}`}>
                    <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${done ? "bg-emerald-500 text-white" : current ? "bg-blue-500 text-white" : "bg-slate-200 text-slate-400 dark:bg-slate-700"}`}>
                      {done ? <CheckCircle2 className="h-4 w-4" /> : <span className="text-xs font-bold">{i + 1}</span>}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm font-medium ${done ? "text-slate-500 line-through dark:text-slate-400" : "text-slate-700 dark:text-slate-300"}`}>{step.label}</p>
                      <p className="text-[10px] text-slate-400">{step.desc}</p>
                    </div>
                    {current && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[9px] font-bold text-blue-700 dark:bg-blue-500/20 dark:text-blue-300">IN PROGRESS</span>}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Document status summary card */}
          <div className="panel p-5">
            <div className="mb-3 flex items-center gap-2">
              <FileCheck className="h-4 w-4 text-blue-500" />
              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Document Status</h3>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-center dark:border-emerald-500/30 dark:bg-emerald-500/10">
                <CheckCircle2 className="mx-auto mb-1 h-5 w-5 text-emerald-500" />
                <p className="text-lg font-bold text-emerald-700 dark:text-emerald-300">{approvedDocs}</p>
                <p className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400">Approved</p>
              </div>
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-center dark:border-amber-500/30 dark:bg-amber-500/10">
                <Clock className="mx-auto mb-1 h-5 w-5 text-amber-500" />
                <p className="text-lg font-bold text-amber-700 dark:text-amber-300">{pendingDocs}</p>
                <p className="text-[10px] font-medium text-amber-600 dark:text-amber-400">Pending</p>
              </div>
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-center dark:border-rose-500/30 dark:bg-rose-500/10">
                <AlertCircle className="mx-auto mb-1 h-5 w-5 text-rose-500" />
                <p className="text-lg font-bold text-rose-700 dark:text-rose-300">{rejectedDocs}</p>
                <p className="text-[10px] font-medium text-rose-600 dark:text-rose-400">Rejected</p>
              </div>
            </div>
            <button onClick={() => setActiveSection("documents")} className="btn btn-secondary mt-3 w-full text-xs">
              Manage Documents <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </>
      )}

      {/* Signposting Assessment Section */}
      {activeSection === "signposting" && (
        <div className="panel p-5">
          <div className="mb-4 flex items-center gap-2">
            <Compass className="h-4 w-4 text-blue-500" />
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Debt Assessment & Signposting</h3>
          </div>
          <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">
            Complete this quick assessment and we'll guide you to the best support path based on your circumstances.
          </p>

          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Total Unsecured Debt (£)</label>
              <input type="number" className="input" value={signpostingForm.total_debt || ""} onChange={(e) => setSignpostingForm({ ...signpostingForm, total_debt: parseFloat(e.target.value) || 0 })} placeholder="e.g., 25000" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Monthly Disposable Income (£)</label>
              <input type="number" className="input" value={signpostingForm.disposable_income || ""} onChange={(e) => setSignpostingForm({ ...signpostingForm, disposable_income: parseFloat(e.target.value) || 0 })} placeholder="e.g., 200" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Number of Creditors</label>
                <input type="number" className="input" value={signpostingForm.creditor_count || ""} onChange={(e) => setSignpostingForm({ ...signpostingForm, creditor_count: parseInt(e.target.value) || 0 })} placeholder="e.g., 5" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Property Equity (£)</label>
                <input type="number" className="input" value={signpostingForm.asset_equity || ""} onChange={(e) => setSignpostingForm({ ...signpostingForm, asset_equity: parseFloat(e.target.value) || 0 })} placeholder="e.g., 50000" />
              </div>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-400">
              <input type="checkbox" checked={signpostingForm.has_property} onChange={(e) => setSignpostingForm({ ...signpostingForm, has_property: e.target.checked })} className="h-4 w-4 rounded border-slate-300" />
              I own a property
            </label>
            <button onClick={handleRunAssessment} className="btn btn-primary w-full bg-blue-600 py-3 text-sm hover:bg-blue-700">
              <Compass className="h-4 w-4" /> Get My Recommendation
            </button>
          </div>

          {/* Assessment Result */}
          {assessmentResult && (
            <div className="mt-6 space-y-4">
              <div className={`rounded-xl border-2 p-4 ${assessmentResult.recommendedRoute === "signposting" ? "border-blue-300 bg-blue-50 dark:border-blue-500/30 dark:bg-blue-500/5" : "border-violet-300 bg-violet-50 dark:border-violet-500/30 dark:bg-violet-500/5"}`}>
                <div className="flex items-center gap-3">
                  {(() => {
                    const Icon = ROUTE_ICONS[assessmentResult.recommendedRoute];
                    return <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white shadow-sm dark:bg-slate-800"><Icon className="h-6 w-6 text-violet-600 dark:text-violet-400" /></div>;
                  })()}
                  <div className="flex-1">
                    <p className="text-[10px] font-bold uppercase text-slate-400">Recommended Route</p>
                    <p className="text-lg font-bold text-slate-800 dark:text-slate-100">{ROUTE_LABELS[assessmentResult.recommendedRoute]}</p>
                    <p className="text-xs text-slate-500">{assessmentResult.confidence}% confidence match</p>
                  </div>
                </div>
                <p className="mt-3 text-xs text-slate-600 dark:text-slate-400">{ROUTE_DESCRIPTIONS[assessmentResult.recommendedRoute]}</p>
              </div>

              {/* Reasons */}
              {assessmentResult.reasons.length > 0 && (
                <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                  <p className="mb-2 flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300"><Lightbulb className="h-3.5 w-3.5 text-amber-500" /> Why this route?</p>
                  <ul className="space-y-1.5">
                    {assessmentResult.reasons.map((reason, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-400">
                        <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500" /> {reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Time & cost savings */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                  <p className="flex items-center gap-1 text-[10px] font-bold uppercase text-slate-400"><Clock className="h-3 w-3" /> Est. Duration</p>
                  <p className="text-lg font-bold text-slate-700 dark:text-slate-300">{assessmentResult.estimatedTimeMonths > 0 ? `${assessmentResult.estimatedTimeMonths} months` : "N/A"}</p>
                </div>
                <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                  <p className="flex items-center gap-1 text-[10px] font-bold uppercase text-slate-400"><TrendingUp className="h-3 w-3" /> Est. Total Repaid</p>
                  <p className="text-lg font-bold text-slate-700 dark:text-slate-300">{assessmentResult.estimatedTotalCost > 0 ? formatCurrency(assessmentResult.estimatedTotalCost) : "N/A"}</p>
                </div>
              </div>

              {/* All route scores */}
              <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300"><Route className="h-3.5 w-3.5 text-blue-500" /> All Routes Evaluated</p>
                <div className="space-y-2">
                  {assessmentResult.allRoutes.map((r) => {
                    const Icon = ROUTE_ICONS[r.route];
                    return (
                      <div key={r.route} className="flex items-center gap-2">
                        <Icon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                        <span className="w-20 text-xs font-medium text-slate-600 dark:text-slate-400">{ROUTE_LABELS[r.route]}</span>
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                          <div className={`h-full rounded-full ${r.score >= 60 ? "bg-emerald-500" : r.score >= 40 ? "bg-amber-500" : "bg-slate-400"}`} style={{ width: `${r.score}%` }} />
                        </div>
                        <span className="w-8 text-right text-[10px] font-bold text-slate-500">{r.score}%</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {assessmentResult.recommendedRoute === "signposting" && (
                <button onClick={() => setActiveSection("advice")} className="btn btn-primary w-full bg-blue-600 py-2.5 text-sm hover:bg-blue-700">
                  <ArrowRight className="h-4 w-4" /> View Free Advice Services
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Documents Section */}
      {activeSection === "documents" && (
        <div className="panel p-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileCheck className="h-4 w-4 text-blue-500" />
              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Upload Verification Documents</h3>
            </div>
            <div className="flex gap-1.5 text-[10px]">
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-bold text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">{approvedDocs} approved</span>
              {pendingDocs > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 font-bold text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">{pendingDocs} pending</span>}
              {rejectedDocs > 0 && <span className="rounded-full bg-rose-100 px-2 py-0.5 font-bold text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">{rejectedDocs} rejected</span>}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {DOC_TYPES_DEBTOR.map((dt) => {
              const DocIcon = dt.icon;
              return (
                <button key={dt.type} onClick={() => setSelectedDocType(dt.type)} className={`flex flex-col items-start gap-1 rounded-xl border-2 p-4 text-left transition-all ${selectedDocType === dt.type ? "border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-500/5" : "border-slate-200 hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600"}`}>
                  <DocIcon className="h-5 w-5 text-slate-400" />
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{dt.label}</span>
                  <span className="text-[10px] text-slate-400">{dt.desc}</span>
                </button>
              );
            })}
          </div>

          {selectedDocType && (
            <div className="mt-4 flex flex-col gap-3 rounded-xl border border-slate-200 p-4 dark:border-slate-700 sm:flex-row sm:items-end">
              <div className="flex-1">
                <label className="mb-1 block text-xs font-medium text-slate-500">File name</label>
                <input className="input" value={fileName} onChange={(e) => setFileName(e.target.value)} placeholder="e.g., bank_statement_jan_2026.pdf" />
              </div>
              <button onClick={handleUpload} disabled={!fileName} className="btn btn-primary bg-blue-600 text-xs hover:bg-blue-700 disabled:opacity-50">
                <Upload className="h-3.5 w-3.5" /> Upload Document
              </button>
            </div>
          )}

          {docs.length > 0 && (
            <div className="mt-4 space-y-2">
              <p className="text-[10px] font-bold uppercase text-slate-400">Uploaded Documents</p>
              {docs.map((doc) => (
                <div key={doc.id} className="flex items-center gap-2 rounded-lg border border-slate-200 p-2.5 dark:border-slate-700">
                  <FileText className="h-4 w-4 shrink-0 text-slate-400" />
                  <span className="min-w-0 flex-1 truncate text-xs text-slate-600 dark:text-slate-400">{doc.file_name}</span>
                  {doc.status === "approved" && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                  {doc.status === "pending" && <Clock className="h-4 w-4 text-amber-500" />}
                  {doc.status === "rejected" && <AlertCircle className="h-4 w-4 text-rose-500" />}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Free Advice Section */}
      {activeSection === "advice" && (
        <div className="panel p-5">
          <div className="mb-3 flex items-center gap-2">
            <Info className="h-4 w-4 text-emerald-500" />
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Free Help & Advice</h3>
          </div>
          <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">Before committing to any fee-charging solution, you can get free, confidential advice from these organisations:</p>
          <div className="space-y-3">
            {SIGNPOSTING_ORGS.map((org) => (
              <div key={org.name} className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                <Shield className="h-5 w-5 shrink-0 text-emerald-500" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{org.name}</p>
                  <p className="text-[10px] text-slate-400">{org.desc}</p>
                </div>
                <span className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400">
                  <Phone className="h-3 w-3" /> {org.phone}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
