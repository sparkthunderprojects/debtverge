import { useState, useMemo } from "react";
import {
  TrendingDown, Wallet, Clock, Scale, FileText, Download,
  CheckCircle2, AlertCircle, ArrowUpRight, ArrowDownRight,
  PoundSterling, Gavel, Receipt,
} from "lucide-react";
import {
  useDebtCreditors,
} from "@/apps/debtverge/lib/debt-hooks";
import { useIVAProposal, useIPDetails } from "@/apps/debtverge/lib/insolvency-hooks";
import { formatCurrency } from "@/core/format";
import type { DebtCase } from "@/core/types";

interface IVASettlementForecastProps {
  caseId: string | null;
  caseData: DebtCase | null;
}

export function IVASettlementForecast({ caseId, caseData }: IVASettlementForecastProps) {
  const { data: creditors, loading } = useDebtCreditors(caseId);
  const { data: ivaProposal } = useIVAProposal(caseId);
  const { data: ipDetails } = useIPDetails(caseId);

  const [lumpSumInput, setLumpSumInput] = useState<number>(0);
  const [supervisorFeeOverride, setSupervisorFeeOverride] = useState<number | null>(null);
  const [nomineeFeeOverride, setNomineeFeeOverride] = useState<number | null>(null);
  const [showProposalNotice, setShowProposalNotice] = useState(false);

  const totalDebt = useMemo(() => creditors.reduce((s, c) => s + c.current_balance, 0), [creditors]);
  const monthlyContribution = caseData?.monthly_disposable_income ?? 0;

  const ivaDuration = ivaProposal?.proposed_duration_months ?? 60;
  const estimatedDividendPct = ivaProposal?.estimated_dividend_percent ?? 0;
  const totalEstimatedDividend = ivaProposal?.total_estimated_dividend ?? 0;

  const nomineeFeePct = nomineeFeeOverride ?? ipDetails?.nominee_fee_percent ?? 0;
  const supervisorFeePct = supervisorFeeOverride ?? ipDetails?.supervisor_fee_percent ?? 0;
  const fixedFeeAmount = ipDetails?.fixed_fee_amount ?? 0;

  const elapsedMonths = useMemo(() => {
    if (!caseData?.created_at) return 0;
    const created = new Date(caseData.created_at);
    const now = new Date();
    return Math.max(0, Math.round((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24 * 30.44)));
  }, [caseData?.created_at]);

  const remainingMonths = Math.max(0, ivaDuration - elapsedMonths);
  const remainingTermValue = monthlyContribution * remainingMonths;
  const expectedDividendReturn = (remainingTermValue * estimatedDividendPct) / 100;

  const nomineeFee = (remainingTermValue * nomineeFeePct) / 100;
  const supervisorFee = (remainingTermValue * supervisorFeePct) / 100;
  const totalStatutoryFees = nomineeFee + supervisorFee + fixedFeeAmount;

  const netToCreditors = Math.max(0, lumpSumInput - totalStatutoryFees);
  const lumpSumDividendPct = totalDebt > 0 ? (netToCreditors / totalDebt) * 100 : 0;

  const termDividendPct = totalDebt > 0 ? (expectedDividendReturn / totalDebt) * 100 : 0;

  const variance = netToCreditors - expectedDividendReturn;
  const variancePct = expectedDividendReturn > 0 ? (variance / expectedDividendReturn) * 100 : 0;

  type Verdict = "exceeds" | "meets" | "below" | "awaiting";
  let verdict: Verdict = "awaiting";
  if (lumpSumInput > 0) {
    if (variance > expectedDividendReturn * 0.05) verdict = "exceeds";
    else if (variance >= -expectedDividendReturn * 0.05) verdict = "meets";
    else verdict = "below";
  }

  const verdictMeta: Record<Verdict, { label: string; color: string; bg: string; icon: React.ReactNode; detail: string }> = {
    exceeds: {
      label: "Exceeds Creditor Expectations",
      color: "text-emerald-700 dark:text-emerald-300",
      bg: "bg-emerald-100 dark:bg-emerald-500/20",
      icon: <ArrowUpRight className="h-4 w-4" />,
      detail: `Lump sum offers ${variancePct.toFixed(1)}% more than the projected term dividend — creditors are likely to accept.`,
    },
    meets: {
      label: "Meets Creditor Expectations",
      color: "text-blue-700 dark:text-blue-300",
      bg: "bg-blue-100 dark:bg-blue-500/20",
      icon: <CheckCircle2 className="h-4 w-4" />,
      detail: `Lump sum is within 5% of the projected term dividend — viable for creditor circulation.`,
    },
    below: {
      label: "Below Creditor Expectations",
      color: "text-rose-700 dark:text-rose-300",
      bg: "bg-rose-100 dark:bg-rose-500/20",
      icon: <ArrowDownRight className="h-4 w-4" />,
      detail: `Lump sum is ${Math.abs(variancePct).toFixed(1)}% below the projected term dividend — creditors may reject or counter-offer.`,
    },
    awaiting: {
      label: "Awaiting Lump Sum Input",
      color: "text-slate-600 dark:text-slate-300",
      bg: "bg-slate-100 dark:bg-slate-700",
      icon: <AlertCircle className="h-4 w-4" />,
      detail: "Enter a proposed lump sum offer above to assess variation feasibility.",
    },
  };

  const chartData = useMemo(() => {
    if (lumpSumInput <= 0) return [];
    const points: { label: string; value: number; color: string }[] = [
      { label: "Lump Sum (Net to Creditors)", value: netToCreditors, color: "#8b5cf6" },
      { label: "Expected Term Dividend", value: expectedDividendReturn, color: "#3b82f6" },
      { label: "Statutory Fees", value: totalStatutoryFees, color: "#ef4444" },
    ];
    return points.sort((a, b) => b.value - a.value);
  }, [lumpSumInput, netToCreditors, expectedDividendReturn, totalStatutoryFees]);

  if (!caseData) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-400">
        Select a case to view IVA F&F settlement forecast
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
        <p className="text-sm">Add creditors to the ledger to calculate settlement viability</p>
      </div>
    );
  }

  const handleGenerateNotice = () => setShowProposalNotice(true);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="panel flex flex-wrap items-center justify-between gap-3 p-4 fade-in">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-violet-800 text-white shadow-md">
            <Scale className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">IVA F&F Settlement Forecast</h3>
            <p className="text-xs text-slate-400">
              Full & Final settlement variation feasibility — {creditors.length} creditors, {formatCurrency(monthlyContribution)}/mo contribution, Month {elapsedMonths} of {ivaDuration}
            </p>
          </div>
        </div>
        <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold ${verdictMeta[verdict].bg} ${verdictMeta[verdict].color}`}>
          {verdictMeta[verdict].icon}
          {verdictMeta[verdict].label}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SettlementKpi
          icon={<Clock className="h-4 w-4" />}
          label="Remaining Term Value"
          value={formatCurrency(remainingTermValue, "USD", { compact: true })}
          sub={`${remainingMonths} months × ${formatCurrency(monthlyContribution, "USD", { compact: true })}/mo`}
          accent="text-violet-600 bg-violet-50 dark:bg-violet-500/10"
        />
        <SettlementKpi
          icon={<PoundSterling className="h-4 w-4" />}
          label="Expected Dividend Return"
          value={formatCurrency(expectedDividendReturn, "USD", { compact: true })}
          sub={`${estimatedDividendPct.toFixed(1)}p in £1 over full term`}
          accent="text-blue-600 bg-blue-50 dark:bg-blue-500/10"
        />
        <SettlementKpi
          icon={<Wallet className="h-4 w-4" />}
          label="Net to Creditors"
          value={lumpSumInput > 0 ? formatCurrency(netToCreditors, "USD", { compact: true }) : "—"}
          sub={lumpSumInput > 0 ? `${lumpSumDividendPct.toFixed(1)}p in £1 dividend` : "Enter lump sum below"}
          accent="text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10"
        />
        <SettlementKpi
          icon={<Receipt className="h-4 w-4" />}
          label="Statutory Fees Deducted"
          value={lumpSumInput > 0 ? formatCurrency(totalStatutoryFees, "USD", { compact: true }) : "—"}
          sub={`Nominee ${nomineeFeePct}% + Supervisor ${supervisorFeePct}%`}
          accent="text-rose-600 bg-rose-50 dark:bg-rose-500/10"
        />
      </div>

      {/* Lump Sum Input + Fee Controls */}
      <div className="panel p-5 fade-in">
        <h4 className="mb-4 flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-200">
          <PoundSterling className="h-4 w-4 text-violet-600 dark:text-violet-400" />
          Variation Feasibility Calculator
        </h4>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">Proposed F&F Lump Sum Offer</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-slate-400">£</span>
              <input
                type="number"
                value={lumpSumInput || ""}
                onChange={(e) => setLumpSumInput(Math.max(0, parseFloat(e.target.value) || 0))}
                placeholder="0.00"
                className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-7 pr-3 text-sm font-medium dark:border-slate-700 dark:bg-slate-800"
              />
            </div>
            <p className="mt-1 text-[10px] text-slate-400">Total settlement funds available from third party or debtor</p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">Nominee Fee % (override)</label>
            <input
              type="number"
              step="0.5"
              value={nomineeFeeOverride ?? ""}
              placeholder={`${nomineeFeePct}% (default)`}
              onChange={(e) => setNomineeFeeOverride(e.target.value ? parseFloat(e.target.value) : null)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">Supervisor Fee % (override)</label>
            <input
              type="number"
              step="0.5"
              value={supervisorFeeOverride ?? ""}
              placeholder={`${supervisorFeePct}% (default)`}
              onChange={(e) => setSupervisorFeeOverride(e.target.value ? parseFloat(e.target.value) : null)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-800"
            />
          </div>
        </div>
      </div>

      {/* Dividend Impact Comparison */}
      <div className="panel p-5 fade-in">
        <h4 className="mb-4 flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-200">
          <TrendingDown className="h-4 w-4 text-violet-600 dark:text-violet-400" />
          Dividend Impact Comparison
        </h4>

        {/* Visual bar comparison */}
        <div className="space-y-4">
          <ComparisonBar
            label="Full Term Dividend (if IVA runs to completion)"
            amount={expectedDividendReturn}
            max={Math.max(expectedDividendReturn, netToCreditors, 1)}
            color="bg-blue-500"
            sub={`${termDividendPct.toFixed(1)}p in £1 · over ${remainingMonths} months`}
          />
          <ComparisonBar
            label="F&F Settlement Dividend (lump sum net of fees)"
            amount={netToCreditors}
            max={Math.max(expectedDividendReturn, netToCreditors, 1)}
            color="bg-violet-500"
            sub={lumpSumInput > 0 ? `${lumpSumDividendPct.toFixed(1)}p in £1 · one-time payment` : "Enter lump sum to calculate"}
          />
        </div>

        {/* Verdict detail */}
        <div className={`mt-4 flex items-start gap-3 rounded-xl p-4 ${verdictMeta[verdict].bg}`}>
          <span className={`shrink-0 ${verdictMeta[verdict].color}`}>{verdictMeta[verdict].icon}</span>
          <div>
            <p className={`text-sm font-bold ${verdictMeta[verdict].color}`}>{verdictMeta[verdict].label}</p>
            <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">{verdictMeta[verdict].detail}</p>
            {lumpSumInput > 0 && (
              <p className="mt-1 text-xs font-medium text-slate-500 dark:text-slate-400">
                Variance: {variance >= 0 ? "+" : ""}{formatCurrency(variance)} ({variancePct >= 0 ? "+" : ""}{variancePct.toFixed(1)}%)
              </p>
            )}
          </div>
        </div>

        {/* Breakdown table */}
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-400 dark:border-slate-700">
                <th className="pb-2 font-medium">Metric</th>
                <th className="pb-2 text-right font-medium">Full Term</th>
                <th className="pb-2 text-right font-medium">F&F Settlement</th>
                <th className="pb-2 text-right font-medium">Difference</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-slate-100 dark:border-slate-700/50">
                <td className="py-2.5 text-slate-600 dark:text-slate-300">Gross Funds</td>
                <td className="py-2.5 text-right font-medium text-slate-700 dark:text-slate-200">{formatCurrency(remainingTermValue)}</td>
                <td className="py-2.5 text-right font-medium text-slate-700 dark:text-slate-200">{formatCurrency(lumpSumInput)}</td>
                <td className="py-2.5 text-right font-medium text-slate-500">{formatCurrency(lumpSumInput - remainingTermValue)}</td>
              </tr>
              <tr className="border-b border-slate-100 dark:border-slate-700/50">
                <td className="py-2.5 text-slate-600 dark:text-slate-300">Statutory Fees</td>
                <td className="py-2.5 text-right text-slate-500">—</td>
                <td className="py-2.5 text-right font-medium text-rose-600 dark:text-rose-400">-{formatCurrency(totalStatutoryFees)}</td>
                <td className="py-2.5 text-right text-slate-400">—</td>
              </tr>
              <tr className="border-b border-slate-100 dark:border-slate-700/50">
                <td className="py-2.5 text-slate-600 dark:text-slate-300">Net to Creditors</td>
                <td className="py-2.5 text-right font-medium text-blue-600 dark:text-blue-400">{formatCurrency(expectedDividendReturn)}</td>
                <td className="py-2.5 text-right font-medium text-violet-600 dark:text-violet-400">{formatCurrency(netToCreditors)}</td>
                <td className={`py-2.5 text-right font-bold ${variance >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                  {variance >= 0 ? "+" : ""}{formatCurrency(variance)}
                </td>
              </tr>
              <tr className="border-b border-slate-100 dark:border-slate-700/50">
                <td className="py-2.5 text-slate-600 dark:text-slate-300">Dividend (p in £1)</td>
                <td className="py-2.5 text-right font-medium text-slate-700 dark:text-slate-200">{termDividendPct.toFixed(1)}p</td>
                <td className="py-2.5 text-right font-medium text-slate-700 dark:text-slate-200">{lumpSumDividendPct.toFixed(1)}p</td>
                <td className={`py-2.5 text-right font-bold ${(lumpSumDividendPct - termDividendPct) >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                  {(lumpSumDividendPct - termDividendPct) >= 0 ? "+" : ""}{(lumpSumDividendPct - termDividendPct).toFixed(1)}p
                </td>
              </tr>
              <tr>
                <td className="py-2.5 font-medium text-slate-700 dark:text-slate-200">Time to Completion</td>
                <td className="py-2.5 text-right text-slate-500">{remainingMonths} months</td>
                <td className="py-2.5 text-right font-medium text-violet-600 dark:text-violet-400">Immediate</td>
                <td className="py-2.5 text-right font-bold text-emerald-600 dark:text-emerald-400">-{remainingMonths} months</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Chart */}
        {chartData.length > 0 && (
          <div className="mt-4 space-y-2">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Fund Distribution Preview</p>
            {chartData.map((item) => (
              <div key={item.label}>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="text-slate-600 dark:text-slate-300">{item.label}</span>
                  <span className="font-bold text-slate-700 dark:text-slate-200">{formatCurrency(item.value)}</span>
                </div>
                <div className="h-6 overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-700">
                  <div
                    className="h-full rounded-lg transition-all duration-500"
                    style={{ width: `${(item.value / chartData[0].value) * 100}%`, backgroundColor: item.color }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Per-Creditor F&F Pro-Rata Distribution */}
      {lumpSumInput > 0 && netToCreditors > 0 && (
        <div className="panel p-4 fade-in">
          <h4 className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-200">
            <Wallet className="h-4 w-4 text-violet-600 dark:text-violet-400" />
            Per-Creditor F&F Pro-Rata Distribution
          </h4>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-400 dark:border-slate-700">
                  <th className="pb-2 font-medium">Creditor</th>
                  <th className="pb-2 text-right font-medium">Original Debt</th>
                  <th className="pb-2 text-right font-medium">Pro-Rata %</th>
                  <th className="pb-2 text-right font-medium">F&F Settlement</th>
                </tr>
              </thead>
              <tbody>
                {creditors.map((c) => {
                  const proRataPct = totalDebt > 0 ? (c.current_balance / totalDebt) * 100 : 0;
                  const settlementShare = (netToCreditors * proRataPct) / 100;
                  return (
                    <tr key={c.id} className="border-b border-slate-100 dark:border-slate-700/50">
                      <td className="py-2.5 text-slate-700 dark:text-slate-200">{c.creditor_name}</td>
                      <td className="py-2.5 text-right font-medium text-slate-700 dark:text-slate-200">{formatCurrency(c.current_balance)}</td>
                      <td className="py-2.5 text-right text-slate-500">{proRataPct.toFixed(1)}%</td>
                      <td className="py-2.5 text-right font-bold text-violet-600 dark:text-violet-400">{formatCurrency(settlementShare)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-200 dark:border-slate-700">
                  <td className="pt-2.5 font-bold text-slate-700 dark:text-slate-200">Total</td>
                  <td className="pt-2.5 text-right font-bold text-rose-600 dark:text-rose-400">{formatCurrency(totalDebt)}</td>
                  <td className="pt-2.5 text-right font-bold text-slate-500">100%</td>
                  <td className="pt-2.5 text-right font-bold text-violet-600 dark:text-violet-400">{formatCurrency(netToCreditors)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Action Button */}
      <div className="panel flex flex-wrap items-center justify-between gap-3 p-4 fade-in">
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <FileText className="h-4 w-4" />
          Package the forecast data into a formal variation proposal notice for creditor circulation and voting.
        </div>
        <button
          onClick={handleGenerateNotice}
          disabled={lumpSumInput <= 0}
          className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-bold text-white shadow-md transition-all hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <FileText className="h-4 w-4" />
          Generate F&F Variation Proposal Notice
        </button>
      </div>

      {/* Proposal Notice Modal */}
      {showProposalNotice && (
        <FfVariationNoticeModal
          caseData={caseData}
          totalDebt={totalDebt}
          monthlyContribution={monthlyContribution}
          remainingMonths={remainingMonths}
          remainingTermValue={remainingTermValue}
          lumpSumInput={lumpSumInput}
          netToCreditors={netToCreditors}
          totalStatutoryFees={totalStatutoryFees}
          nomineeFee={nomineeFee}
          supervisorFee={supervisorFee}
          fixedFeeAmount={fixedFeeAmount}
          lumpSumDividendPct={lumpSumDividendPct}
          termDividendPct={termDividendPct}
          verdict={verdictMeta[verdict].label}
          ipDetails={ipDetails}
          creditors={creditors}
          onClose={() => setShowProposalNotice(false)}
        />
      )}
    </div>
  );
}

// ============================================================
// Sub-components
// ============================================================

function SettlementKpi({ icon, label, value, sub, accent }: { icon: React.ReactNode; label: string; value: string; sub: string; accent: string }) {
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

function ComparisonBar({ label, amount, max, color, sub }: { label: string; amount: number; max: number; color: string; sub: string }) {
  const pct = max > 0 ? Math.min(100, (amount / max) * 100) : 0;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="font-medium text-slate-600 dark:text-slate-300">{label}</span>
        <span className="font-bold text-slate-700 dark:text-slate-200">{formatCurrency(amount)}</span>
      </div>
      <div className="h-4 overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-700">
        <div className={`h-full rounded-lg ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-0.5 text-[10px] text-slate-400">{sub}</p>
    </div>
  );
}

function FfVariationNoticeModal({
  caseData, totalDebt, monthlyContribution, remainingMonths, remainingTermValue,
  lumpSumInput, netToCreditors, totalStatutoryFees, nomineeFee, supervisorFee,
  fixedFeeAmount, lumpSumDividendPct, termDividendPct, verdict, ipDetails,
  creditors, onClose,
}: {
  caseData: DebtCase;
  totalDebt: number;
  monthlyContribution: number;
  remainingMonths: number;
  remainingTermValue: number;
  lumpSumInput: number;
  netToCreditors: number;
  totalStatutoryFees: number;
  nomineeFee: number;
  supervisorFee: number;
  fixedFeeAmount: number;
  lumpSumDividendPct: number;
  termDividendPct: number;
  verdict: string;
  ipDetails: { practitioner_name: string; registration_number: string | null; firm_name: string | null } | null;
  creditors: { id: string; creditor_name: string; current_balance: number }[];
  onClose: () => void;
}) {
  const fmt = (n: number) => `£${n.toFixed(2)}`;
  const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  const noticeText = `NOTICE OF PROPOSED VARIATION — FULL & FINAL IVA SETTLEMENT
==========================================================

Case Reference: ${caseData.case_number}
Debtor: ${caseData.debtor_name}
Date of Notice: ${today}

To All Creditors of the above Individual Voluntary Arrangement,

1. BACKGROUND
---------------
The IVA has ${remainingMonths} months remaining of the original term,
with a monthly contribution of ${fmt(monthlyContribution)}.

The debtor has proposed a Full & Final (F&F) Settlement Variation to
conclude the IVA early via a single lump sum payment.

2. SETTLEMENT OFFER
--------------------
Proposed Lump Sum:            ${fmt(lumpSumInput)}

Statutory Fee Deductions:
  Nominee Fee:                ${fmt(nomineeFee)}
  Supervisor Fee:             ${fmt(supervisorFee)}
  Fixed Fee:                  ${fmt(fixedFeeAmount)}
  Total Fees:                 ${fmt(totalStatutoryFees)}

Net Amount Available to Creditors:  ${fmt(netToCreditors)}

3. DIVIDEND COMPARISON
------------------------
Full Term Dividend (if IVA runs to completion):
  Total Contributions:        ${fmt(remainingTermValue)}
  Expected Dividend:          ${termDividendPct.toFixed(1)}p in the £1

F&F Settlement Dividend:
  Net to Creditors:           ${fmt(netToCreditors)}
  Settlement Dividend:        ${lumpSumDividendPct.toFixed(1)}p in the £1

Assessment: ${verdict}

4. PER-CREDITOR PRO-RATA DISTRIBUTION
--------------------------------------
${creditors.map((c, i) => {
  const pct = totalDebt > 0 ? (c.current_balance / totalDebt) * 100 : 0;
  const share = (netToCreditors * pct) / 100;
  return `  ${i + 1}. ${c.creditor_name}
     Original Debt: ${fmt(c.current_balance)} (${pct.toFixed(1)}%)
     F&F Settlement: ${fmt(share)}`;
}).join("\n")}

5. VOTING PROCEDURE
--------------------
Creditors are requested to vote on the proposed variation within 28 days
of the date of this notice. Voting may be conducted by post, proxy, or
electronic submission.

The variation will be deemed approved if 75% in value of creditors voting
vote in favour.

6. SUPERVISOR'S RECOMMENDATION
--------------------------------
${ipDetails?.practitioner_name ?? "The Supervisor"} of ${ipDetails?.firm_name ?? "[Firm]"}
recommends that creditors consider the F&F settlement offer in the context
of the debtor's circumstances and the administrative cost savings of an
early conclusion to the arrangement.

Signed: ${ipDetails?.practitioner_name ?? "[Supervisor]"}
Date: ${today}`;

  const handleDownload = () => {
    const blob = new Blob([noticeText], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ff-variation-notice-${caseData.case_number}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-800" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 p-4 dark:border-slate-700">
          <div className="flex items-center gap-2">
            <Gavel className="h-5 w-5 text-violet-600 dark:text-violet-400" />
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">F&F Variation Proposal Notice</h3>
          </div>
          <div className="flex gap-2">
            <button onClick={handleDownload} className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-bold text-white transition-all hover:bg-violet-700">
              <Download className="h-3.5 w-3.5" /> Download
            </button>
            <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700">Close</button>
          </div>
        </div>
        <div className="overflow-y-auto p-4">
          <pre className="whitespace-pre-wrap rounded-lg bg-slate-900 p-4 text-xs leading-relaxed text-slate-100 dark:bg-slate-950">{noticeText}</pre>
        </div>
      </div>
    </div>
  );
}
