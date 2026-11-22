import { useState, useMemo } from "react";
import {
  Scale, FileText, Download, Eye, X, FileCheck, BookOpen,
  Calendar, Wallet, Percent, Building2, AlertTriangle, CheckCircle2,
  FileEdit, Package, ChevronRight, Printer,
} from "lucide-react";
import { formatCurrency, formatDateShort } from "@/core/format";
import {
  generateIVAProposalPack, downloadProposalPack, downloadDocumentJSON,
} from "@/apps/debtverge/lib/insolvency-docs";
import { useDebtVergeCase } from "@/apps/debtverge/lib/debtverge-case-context";
import { useIPDetails, useIVAProposal, upsertIVAProposal } from "@/apps/debtverge/lib/insolvency-hooks";
import { addAuditMilestone } from "@/apps/debtverge/lib/debt-hooks";
import type { IVAProposalPack, ProposalStatus } from "@/core/types";

type PreviewSection = "contribution_table" | "nominees_report" | "protocol_terms" | "sfs_summary" | "creditor_schedule" | "fee_schedule";

const SECTION_LABELS: Record<PreviewSection, string> = {
  contribution_table: "Contribution Table",
  nominees_report: "Nominee's Report",
  protocol_terms: "Protocol Terms & Conditions",
  sfs_summary: "SFS Budget Summary",
  creditor_schedule: "Creditor Schedule",
  fee_schedule: "Fee Schedule",
};

export function ProposalGenerator() {
  const { activeCase, activeCaseId } = useDebtVergeCase();
  const { data: ipDetails } = useIPDetails(activeCaseId);
  const { data: proposal } = useIVAProposal(activeCaseId);
  const [showPreview, setShowPreview] = useState(false);
  const [activeSection, setActiveSection] = useState<PreviewSection>("contribution_table");
  const [saving, setSaving] = useState(false);

  const pack = useMemo<IVAProposalPack | null>(() => {
    if (!activeCase) return null;
    return generateIVAProposalPack(activeCase, ipDetails ?? null, proposal ?? null);
  }, [activeCase, ipDetails, proposal]);

  const handleGenerateAndSave = async () => {
    if (!activeCaseId || !pack) return;
    setSaving(true);
    try {
      await upsertIVAProposal(activeCaseId, {
        proposed_duration_months: pack.contributionTable.durationMonths,
        total_estimated_dividend: pack.totalEstimatedDividend,
        estimated_dividend_percent: pack.estimatedDividendPercent,
        equity_treatment_terms: pack.nomineesReport.assetSummary.equityTreatment,
        protocol_compliant: true,
        proposal_status: "draft" as ProposalStatus,
      });
      await addAuditMilestone({
        case_id: activeCaseId,
        milestone: "IVA Proposal Pack Generated",
        description: `Proposal pack generated for ${pack.debtorName}. Duration: ${pack.contributionTable.durationMonths} months. Monthly contribution: ${formatCurrency(pack.contributionTable.monthlyContribution)}.`,
      });
    } finally { setSaving(false); }
  };

  if (!activeCase) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Scale className="mb-3 h-12 w-12 text-slate-300 dark:text-slate-600" />
        <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Select a case to generate an IVA Protocol Proposal Pack</p>
      </div>
    );
  }

  if (!pack) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <AlertTriangle className="mb-3 h-10 w-10 text-amber-400" />
        <p className="text-sm font-medium text-slate-500">Unable to generate proposal pack — case data incomplete</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-1">
      {/* Header */}
      <div className="panel p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 dark:bg-violet-500/10">
              <Scale className="h-5 w-5 text-violet-600 dark:text-violet-400" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">IVA Protocol Proposal Generator</h2>
              <p className="text-xs text-slate-400">Auto-generate compliant proposal packs from fact-find data</p>
            </div>
          </div>
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-[10px] font-bold text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
            PROTOCOL COMPLIANT
          </span>
        </div>
      </div>

      {/* Pack Summary Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="panel p-4">
          <Wallet className="mb-1 h-4 w-4 text-blue-500" />
          <p className="text-[10px] font-bold uppercase text-slate-400">Monthly Contribution</p>
          <p className="text-lg font-bold text-slate-700 dark:text-slate-300">{formatCurrency(pack.contributionTable.monthlyContribution)}</p>
        </div>
        <div className="panel p-4">
          <Calendar className="mb-1 h-4 w-4 text-violet-500" />
          <p className="text-[10px] font-bold uppercase text-slate-400">Duration</p>
          <p className="text-lg font-bold text-slate-700 dark:text-slate-300">{pack.contributionTable.durationMonths} months</p>
        </div>
        <div className="panel p-4">
          <Percent className="mb-1 h-4 w-4 text-emerald-500" />
          <p className="text-[10px] font-bold uppercase text-slate-400">Est. Dividend</p>
          <p className="text-lg font-bold text-slate-700 dark:text-slate-300">{pack.estimatedDividendPercent}p in £</p>
        </div>
        <div className="panel p-4">
          <Building2 className="mb-1 h-4 w-4 text-amber-500" />
          <p className="text-[10px] font-bold uppercase text-slate-400">Total Contributions</p>
          <p className="text-lg font-bold text-slate-700 dark:text-slate-300">{formatCurrency(pack.contributionTable.totalContributions)}</p>
        </div>
      </div>

      {/* Pack Sections */}
      <div className="panel p-5">
        <div className="mb-4 flex items-center gap-2">
          <Package className="h-5 w-5 text-violet-500" />
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Proposal Pack Sections</h3>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {(Object.keys(SECTION_LABELS) as PreviewSection[]).map((section) => (
            <button
              key={section}
              onClick={() => { setActiveSection(section); setShowPreview(true); }}
              className="flex items-center gap-3 rounded-xl border border-slate-200 p-4 text-left transition-all hover:border-violet-300 hover:bg-violet-50 dark:border-slate-700 dark:hover:border-violet-500/30 dark:hover:bg-violet-500/5"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-100 dark:bg-violet-500/20">
                <FileText className="h-4 w-4 text-violet-600 dark:text-violet-400" />
              </div>
              <span className="flex-1 text-sm font-medium text-slate-700 dark:text-slate-300">{SECTION_LABELS[section]}</span>
              <ChevronRight className="h-4 w-4 text-slate-400" />
            </button>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <button onClick={() => setShowPreview(true)} className="btn btn-secondary flex-1 text-sm">
          <Eye className="h-4 w-4" /> Preview Full Pack
        </button>
        <button onClick={() => downloadProposalPack(pack)} className="btn btn-secondary flex-1 text-sm">
          <Download className="h-4 w-4" /> Export JSON
        </button>
        <button onClick={handleGenerateAndSave} disabled={saving} className="btn btn-primary flex-1 bg-violet-600 text-sm hover:bg-violet-700 disabled:opacity-50">
          <FileCheck className="h-4 w-4" /> {saving ? "Saving..." : "Generate & Save Draft"}
        </button>
      </div>

      {/* Preview Drawer */}
      {showPreview && (
        <div className="fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowPreview(false)} />
          <div className="relative ml-auto flex h-full w-full max-w-3xl flex-col bg-white shadow-2xl dark:bg-slate-900">
            {/* Drawer header */}
            <div className="flex shrink-0 items-center justify-between border-b border-slate-200 p-4 dark:border-slate-700">
              <div className="flex items-center gap-2">
                <BookOpen className="h-5 w-5 text-violet-500" />
                <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Proposal Pack Preview</h3>
                <span className="text-xs text-slate-400">· {activeCase.caseNumber}</span>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => downloadProposalPack(pack)} className="btn btn-secondary text-xs">
                  <Download className="h-3.5 w-3.5" /> Export
                </button>
                <button onClick={() => setShowPreview(false)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Section tabs */}
            <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-slate-200 p-2 dark:border-slate-700">
              {(Object.keys(SECTION_LABELS) as PreviewSection[]).map((section) => (
                <button
                  key={section}
                  onClick={() => setActiveSection(section)}
                  className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                    activeSection === section ? "bg-violet-600 text-white" : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                  }`}
                >
                  {SECTION_LABELS[section]}
                </button>
              ))}
            </div>

            {/* Content */}
            <div className="min-h-0 flex-1 overflow-auto p-6">
              <ProposalSectionContent section={activeSection} pack={pack} />
            </div>

            {/* Footer with export options */}
            <div className="flex shrink-0 items-center gap-2 border-t border-slate-200 p-4 dark:border-slate-700">
              <button onClick={() => downloadProposalPack(pack)} className="btn btn-secondary text-xs">
                <Package className="h-3.5 w-3.5" /> Audit Package (JSON)
              </button>
              <button onClick={() => downloadDocumentJSON(pack.nomineesReport, `nominees-report-${pack.caseNumber}.json`)} className="btn btn-secondary text-xs">
                <FileEdit className="h-3.5 w-3.5" /> Editable Draft (JSON)
              </button>
              <button onClick={() => window.print()} className="btn btn-primary ml-auto bg-violet-600 text-xs hover:bg-violet-700">
                <Printer className="h-3.5 w-3.5" /> Print / PDF
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Proposal Section Content Renderer
// ============================================================

function ProposalSectionContent({ section, pack }: { section: PreviewSection; pack: IVAProposalPack }) {
  if (section === "contribution_table") {
    return (
      <div className="space-y-4">
        <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100">Debtor Contribution Table</h4>
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
            <p className="text-[10px] font-bold uppercase text-slate-400">Monthly Contribution</p>
            <p className="text-lg font-bold text-slate-700 dark:text-slate-300">{formatCurrency(pack.contributionTable.monthlyContribution)}</p>
          </div>
          <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
            <p className="text-[10px] font-bold uppercase text-slate-400">Duration</p>
            <p className="text-lg font-bold text-slate-700 dark:text-slate-300">{pack.contributionTable.durationMonths} months</p>
          </div>
          <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
            <p className="text-[10px] font-bold uppercase text-slate-400">Total Contributions</p>
            <p className="text-lg font-bold text-slate-700 dark:text-slate-300">{formatCurrency(pack.contributionTable.totalContributions)}</p>
          </div>
        </div>
        <div className="overflow-auto rounded-xl border border-slate-200 dark:border-slate-700">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800">
              <tr>
                <th className="px-3 py-2 text-left font-bold text-slate-600 dark:text-slate-400">Month</th>
                <th className="px-3 py-2 text-left font-bold text-slate-600 dark:text-slate-400">Date</th>
                <th className="px-3 py-2 text-right font-bold text-slate-600 dark:text-slate-400">Base Contribution</th>
                <th className="px-3 py-2 text-right font-bold text-slate-600 dark:text-slate-400">Total</th>
                <th className="px-3 py-2 text-right font-bold text-slate-600 dark:text-slate-400">Cumulative</th>
              </tr>
            </thead>
            <tbody>
              {pack.contributionTable.entries.map((e) => (
                <tr key={e.month} className="border-t border-slate-100 dark:border-slate-700/50">
                  <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{e.month}</td>
                  <td className="px-3 py-2 text-slate-500 dark:text-slate-400">{formatDateShort(e.date)}</td>
                  <td className="px-3 py-2 text-right text-slate-600 dark:text-slate-400">{formatCurrency(e.baseContribution)}</td>
                  <td className="px-3 py-2 text-right font-medium text-slate-700 dark:text-slate-300">{formatCurrency(e.totalContribution)}</td>
                  <td className="px-3 py-2 text-right font-bold text-violet-600 dark:text-violet-400">{formatCurrency(e.cumulativeTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (section === "nominees_report") {
    const r = pack.nomineesReport;
    return (
      <div className="space-y-4">
        <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100">Nominee's Report to Creditors</h4>
        <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
          <p className="text-xs font-bold text-slate-700 dark:text-slate-300">Case: {r.caseNumber} — {r.debtorName}</p>
          <p className="mt-1 text-xs text-slate-500">IP: {r.ipName}{r.firmName ? `, ${r.firmName}` : ""}{r.registrationNumber ? ` (Reg: ${r.registrationNumber})` : ""}</p>
          <p className="text-xs text-slate-400">Report Date: {formatDateShort(r.reportDate)}</p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700"><p className="text-[10px] font-bold uppercase text-slate-400">Total Income</p><p className="text-sm font-bold text-slate-700 dark:text-slate-300">{formatCurrency(r.sfsSummary.totalIncome)}</p></div>
          <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700"><p className="text-[10px] font-bold uppercase text-slate-400">Essential Exp.</p><p className="text-sm font-bold text-slate-700 dark:text-slate-300">{formatCurrency(r.sfsSummary.totalEssentialExpenses)}</p></div>
          <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700"><p className="text-[10px] font-bold uppercase text-slate-400">Disposable Inc.</p><p className="text-sm font-bold text-slate-700 dark:text-slate-300">{formatCurrency(r.sfsSummary.disposableIncome)}</p></div>
          <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700"><p className="text-[10px] font-bold uppercase text-slate-400">Total Debt</p><p className="text-sm font-bold text-slate-700 dark:text-slate-300">{formatCurrency(r.totalUnsecuredDebt)}</p></div>
        </div>
        <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
          <p className="mb-1 text-xs font-bold text-slate-700 dark:text-slate-300">Suitability Assessment</p>
          <p className="text-xs text-slate-600 dark:text-slate-400">{r.suitabilityAssessment}</p>
        </div>
        <div className="rounded-xl border border-violet-200 bg-violet-50 p-4 dark:border-violet-500/30 dark:bg-violet-500/5">
          <p className="mb-1 text-xs font-bold text-violet-700 dark:text-violet-300">Recommendation</p>
          <p className="text-xs text-slate-600 dark:text-slate-400">{r.proposalRecommendation}</p>
        </div>
        {r.riskFactors.length > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/5">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-bold text-amber-700 dark:text-amber-300"><AlertTriangle className="h-3.5 w-3.5" /> Risk Factors</p>
            <ul className="space-y-1">
              {r.riskFactors.map((rf, i) => <li key={i} className="text-xs text-slate-600 dark:text-slate-400">• {rf}</li>)}
            </ul>
          </div>
        )}
      </div>
    );
  }

  if (section === "protocol_terms") {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100">Standard IVA Protocol Terms & Conditions</h4>
          <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold text-violet-700 dark:bg-violet-500/20 dark:text-violet-300">{pack.protocolTerms.protocolVersion}</span>
        </div>
        <div className="space-y-2">
          {pack.protocolTerms.terms.map((term) => (
            <div key={term.clause} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
              <p className="text-xs font-bold text-violet-600 dark:text-violet-400">Clause {term.clause}</p>
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{term.text}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (section === "sfs_summary") {
    const s = pack.sfsBudgetSummary;
    return (
      <div className="space-y-4">
        <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100">SFS Budget Summary</h4>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700"><p className="text-[10px] font-bold uppercase text-slate-400">Total Income</p><p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(s.totalIncome)}</p></div>
          <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700"><p className="text-[10px] font-bold uppercase text-slate-400">Essential Expenses</p><p className="text-lg font-bold text-rose-600 dark:text-rose-400">{formatCurrency(s.totalEssentialExpenses)}</p></div>
          <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700"><p className="text-[10px] font-bold uppercase text-slate-400">Discretionary</p><p className="text-lg font-bold text-amber-600 dark:text-amber-400">{formatCurrency(s.totalDiscretionaryExpenses)}</p></div>
          <div className="rounded-xl border-2 border-violet-300 bg-violet-50 p-4 dark:border-violet-500/30 dark:bg-violet-500/5"><p className="text-[10px] font-bold uppercase text-violet-600">Disposable Income</p><p className="text-lg font-bold text-violet-700 dark:text-violet-300">{formatCurrency(s.disposableIncome)}</p></div>
          <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700"><p className="text-[10px] font-bold uppercase text-slate-400">Surplus/Shortfall</p><p className={`text-lg font-bold ${s.surplusShortfall >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>{formatCurrency(s.surplusShortfall)}</p></div>
        </div>
      </div>
    );
  }

  if (section === "creditor_schedule") {
    return (
      <div className="space-y-4">
        <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100">Creditor Schedule & Projected Dividends</h4>
        <div className="overflow-auto rounded-xl border border-slate-200 dark:border-slate-700">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800">
              <tr>
                <th className="px-3 py-2 text-left font-bold text-slate-600 dark:text-slate-400">Creditor</th>
                <th className="px-3 py-2 text-right font-bold text-slate-600 dark:text-slate-400">Balance</th>
                <th className="px-3 py-2 text-right font-bold text-slate-600 dark:text-slate-400">APR</th>
                <th className="px-3 py-2 text-right font-bold text-slate-600 dark:text-slate-400">Projected Dividend</th>
              </tr>
            </thead>
            <tbody>
              {pack.creditorSchedule.map((c, i) => (
                <tr key={i} className="border-t border-slate-100 dark:border-slate-700/50">
                  <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{c.creditorName}</td>
                  <td className="px-3 py-2 text-right text-slate-600 dark:text-slate-400">{formatCurrency(c.balance)}</td>
                  <td className="px-3 py-2 text-right text-slate-500">{c.apr}%</td>
                  <td className="px-3 py-2 text-right font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(c.projectedDividend)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (section === "fee_schedule") {
    const f = pack.feeSchedule;
    return (
      <div className="space-y-4">
        <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100">IP Fee Schedule</h4>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700"><p className="text-[10px] font-bold uppercase text-slate-400">Nominee Fee %</p><p className="text-lg font-bold text-slate-700 dark:text-slate-300">{f.nomineeFeePercent}%</p></div>
          <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700"><p className="text-[10px] font-bold uppercase text-slate-400">Supervisor Fee %</p><p className="text-lg font-bold text-slate-700 dark:text-slate-300">{f.supervisorFeePercent}%</p></div>
          <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700"><p className="text-[10px] font-bold uppercase text-slate-400">Fixed Fee</p><p className="text-lg font-bold text-slate-700 dark:text-slate-300">{formatCurrency(f.fixedFeeAmount)}</p></div>
          <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700"><p className="text-[10px] font-bold uppercase text-slate-400">Est. Nominee Fee</p><p className="text-lg font-bold text-violet-600 dark:text-violet-400">{formatCurrency(f.estimatedNomineeFee)}</p></div>
          <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700"><p className="text-[10px] font-bold uppercase text-slate-400">Est. Supervisor Fee</p><p className="text-lg font-bold text-violet-600 dark:text-violet-400">{formatCurrency(f.estimatedSupervisorFee)}</p></div>
        </div>
      </div>
    );
  }

  return null;
}
