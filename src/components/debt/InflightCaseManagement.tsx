import { useState, useMemo } from "react";
import {
  Wallet, ArrowDownToLine, Calculator, TrendingUp, TrendingDown,
  Plus, Trash2, CheckCircle2, Clock, AlertCircle, Building2, Percent,
  PiggyBank, Receipt, Play, RotateCcw, BadgeCheck, X,
} from "lucide-react";
import { formatCurrency, formatDateShort } from "@/lib/format";
import {
  useIVAContributions, addIVAContribution, updateIVAContribution, deleteIVAContribution,
  useIVADistributionRuns, useIVADistributionItems, createDistributionRun,
  updateDistributionRunStatus, deleteDistributionRun,
  useIPDetails,
} from "@/lib/insolvency-hooks";
import { calculateDistribution } from "@/lib/insolvency-docs";
import { useDebtVergeCase } from "@/lib/debtverge-case-context";
import { useDebtCreditors } from "@/lib/debt-hooks";
import { addAuditMilestone } from "@/lib/debt-hooks";
import type { ContributionStatus, PaymentMethod, IVADistributionRun } from "@/lib/types";

const STATUS_STYLES: Record<ContributionStatus, { color: string; bg: string; icon: typeof Clock }> = {
  received: { color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-500/10", icon: CheckCircle2 },
  expected: { color: "text-blue-600 dark:text-blue-400", bg: "bg-blue-50 dark:bg-blue-500/10", icon: Clock },
  missed: { color: "text-rose-600 dark:text-rose-400", bg: "bg-rose-50 dark:bg-rose-500/10", icon: AlertCircle },
  late: { color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-500/10", icon: Clock },
  partial: { color: "text-violet-600 dark:text-violet-400", bg: "bg-violet-50 dark:bg-violet-500/10", icon: Receipt },
};

const RUN_STATUS_STYLES: Record<string, string> = {
  calculated: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300",
  approved: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
  executed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
  reversed: "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300",
};

export function InflightCaseManagement() {
  const { activeCase, activeCaseId } = useDebtVergeCase();
  const { data: creditors } = useDebtCreditors(activeCaseId);
  const { data: ipDetails } = useIPDetails(activeCaseId);
  const { data: contributions, reload: reloadContributions } = useIVAContributions(activeCaseId);
  const { data: runs, reload: reloadRuns } = useIVADistributionRuns(activeCaseId);
  const [activeTab, setActiveTab] = useState<"contributions" | "distributions">("contributions");
  const [showAddContrib, setShowAddContrib] = useState(false);
  const [showDistCalc, setShowDistCalc] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  // New contribution form
  const [contribForm, setContribForm] = useState({
    amount: 0, contribution_date: new Date().toISOString().split("T")[0],
    payment_method: "bacs" as PaymentMethod, reference: "", notes: "",
  });

  // Distribution calculator state
  const [distAmount, setDistAmount] = useState(0);
  const [distCalcResult, setDistCalcResult] = useState<ReturnType<typeof calculateDistribution> | null>(null);
  const [savingDist, setSavingDist] = useState(false);

  const { data: selectedRunItems } = useIVADistributionItems(selectedRunId);

  const totalReceived = contributions.filter((c) => c.status === "received" || c.status === "partial").reduce((s, c) => s + c.amount, 0);
  const totalAllocated = contributions.reduce((s, c) => s + c.allocated_amount, 0);
  const totalUnallocated = totalReceived - totalAllocated;
  const totalDisbursed = runs.filter((r) => r.status === "executed").reduce((s, r) => s + r.total_disbursed, 0);

  const handleAddContribution = async () => {
    if (!activeCaseId || contribForm.amount <= 0) return;
    await addIVAContribution(activeCaseId, contribForm);
    setContribForm({ amount: 0, contribution_date: new Date().toISOString().split("T")[0], payment_method: "bacs", reference: "", notes: "" });
    setShowAddContrib(false);
    reloadContributions();
  };

  const handleCalculateDistribution = () => {
    if (creditors.length === 0) return;
    const result = calculateDistribution({
      totalCollected: distAmount,
      creditors: creditors.map((c) => ({ id: c.id, name: c.name, balance: c.balance })),
      nomineeFeePercent: ipDetails?.nominee_fee_percent ?? 0,
      supervisorFeePercent: ipDetails?.supervisor_fee_percent ?? 0,
      fixedFeeAmount: ipDetails?.fixed_fee_amount ?? 0,
    });
    setDistCalcResult(result);
  };

  const handleSaveDistribution = async () => {
    if (!activeCaseId || !distCalcResult) return;
    setSavingDist(true);
    try {
      await createDistributionRun(activeCaseId, {
        total_collected: distAmount,
        nominee_fee_deducted: distCalcResult.nomineeFee,
        supervisor_fee_deducted: distCalcResult.supervisorFee,
        total_disbursed: distCalcResult.totalDisbursed,
        items: distCalcResult.items,
      });
      await addAuditMilestone({
        case_id: activeCaseId,
        milestone: "Distribution Run Calculated",
        description: `Distribution of ${formatCurrency(distAmount)} calculated. Nominee fee: ${formatCurrency(distCalcResult.nomineeFee)}, Supervisor fee: ${formatCurrency(distCalcResult.supervisorFee)}, Disbursed: ${formatCurrency(distCalcResult.totalDisbursed)}.`,
      });
      setShowDistCalc(false);
      setDistCalcResult(null);
      setDistAmount(0);
      reloadRuns();
    } finally { setSavingDist(false); }
  };

  const handleApproveRun = async (run: IVADistributionRun) => {
    if (!activeCaseId) return;
    await updateDistributionRunStatus(run.id, "approved", "IP Supervisor");
    await addAuditMilestone({ case_id: activeCaseId, milestone: "Distribution Approved", description: `Distribution run of ${formatCurrency(run.total_collected)} approved.` });
    reloadRuns();
  };

  const handleExecuteRun = async (run: IVADistributionRun) => {
    if (!activeCaseId) return;
    await updateDistributionRunStatus(run.id, "executed");
    await addAuditMilestone({ case_id: activeCaseId, milestone: "Distribution Executed", description: `Distribution of ${formatCurrency(run.total_disbursed)} disbursed to creditors.` });
    reloadRuns();
  };

  if (!activeCase) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Wallet className="mb-3 h-12 w-12 text-slate-300 dark:text-slate-600" />
        <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Select a case to manage in-flight IVA administration</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-1">
      {/* Header */}
      <div className="panel p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 dark:bg-blue-500/10">
            <Wallet className="h-5 w-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">In-Flight IVA Case Management</h2>
            <p className="text-xs text-slate-400">Post-approval contribution tracking & distribution calculator</p>
          </div>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="panel p-4">
          <PiggyBank className="mb-1 h-4 w-4 text-emerald-500" />
          <p className="text-[10px] font-bold uppercase text-slate-400">Total Received</p>
          <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(totalReceived)}</p>
        </div>
        <div className="panel p-4">
          <TrendingUp className="mb-1 h-4 w-4 text-blue-500" />
          <p className="text-[10px] font-bold uppercase text-slate-400">Unallocated</p>
          <p className="text-lg font-bold text-blue-600 dark:text-blue-400">{formatCurrency(totalUnallocated)}</p>
        </div>
        <div className="panel p-4">
          <ArrowDownToLine className="mb-1 h-4 w-4 text-violet-500" />
          <p className="text-[10px] font-bold uppercase text-slate-400">Total Disbursed</p>
          <p className="text-lg font-bold text-violet-600 dark:text-violet-400">{formatCurrency(totalDisbursed)}</p>
        </div>
        <div className="panel p-4">
          <Receipt className="mb-1 h-4 w-4 text-amber-500" />
          <p className="text-[10px] font-bold uppercase text-slate-400">Distribution Runs</p>
          <p className="text-lg font-bold text-slate-700 dark:text-slate-300">{runs.length}</p>
        </div>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1.5">
        <button onClick={() => setActiveTab("contributions")} className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all ${activeTab === "contributions" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"}`}>
          <PiggyBank className="h-4 w-4" /> Contributions
        </button>
        <button onClick={() => setActiveTab("distributions")} className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all ${activeTab === "distributions" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"}`}>
          <Calculator className="h-4 w-4" /> Distributions
        </button>
      </div>

      {/* Contributions Tab */}
      {activeTab === "contributions" && (
        <div className="panel p-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-100"><PiggyBank className="h-4 w-4 text-blue-500" /> Monthly Contributions</h3>
            <button onClick={() => setShowAddContrib(!showAddContrib)} className="btn btn-secondary text-xs">
              <Plus className="h-3.5 w-3.5" /> Log Payment
            </button>
          </div>

          {showAddContrib && (
            <div className="mb-4 space-y-3 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">Amount (£)</label>
                  <input type="number" className="input" value={contribForm.amount || ""} onChange={(e) => setContribForm({ ...contribForm, amount: parseFloat(e.target.value) || 0 })} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">Date Received</label>
                  <input type="date" className="input" value={contribForm.contribution_date} onChange={(e) => setContribForm({ ...contribForm, contribution_date: e.target.value })} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">Payment Method</label>
                  <select className="input" value={contribForm.payment_method} onChange={(e) => setContribForm({ ...contribForm, payment_method: e.target.value as PaymentMethod })}>
                    <option value="bacs">BACS</option>
                    <option value="standing_order">Standing Order</option>
                    <option value="card">Card</option>
                    <option value="cash">Cash</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">Reference</label>
                  <input className="input" value={contribForm.reference} onChange={(e) => setContribForm({ ...contribForm, reference: e.target.value })} placeholder="Bank ref / transaction ID" />
                </div>
              </div>
              <textarea className="input" rows={2} placeholder="Notes" value={contribForm.notes} onChange={(e) => setContribForm({ ...contribForm, notes: e.target.value })} />
              <button onClick={handleAddContribution} className="btn btn-primary bg-blue-600 text-xs hover:bg-blue-700">
                <BadgeCheck className="h-3.5 w-3.5" /> Log Contribution
              </button>
            </div>
          )}

          {contributions.length === 0 ? (
            <div className="py-8 text-center">
              <PiggyBank className="mx-auto mb-2 h-8 w-8 text-slate-300 dark:text-slate-600" />
              <p className="text-xs text-slate-400">No contributions logged yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {contributions.map((c) => {
                const st = STATUS_STYLES[c.status];
                const StatusIcon = st.icon;
                return (
                  <div key={c.id} className={`flex items-center gap-3 rounded-xl border p-3 ${st.bg} border-slate-200 dark:border-slate-700`}>
                    <PiggyBank className="h-5 w-5 shrink-0 text-slate-400" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{formatCurrency(c.amount)}</p>
                      <p className="text-[10px] text-slate-400">{formatDateShort(c.contribution_date)} · {c.payment_method ?? "N/A"} · {c.reference ?? "no ref"}</p>
                    </div>
                    <select
                      value={c.status}
                      onChange={async (e) => { await updateIVAContribution(c.id, { status: e.target.value as ContributionStatus }); reloadContributions(); }}
                      className="input w-32 text-xs"
                    >
                      <option value="received">Received</option>
                      <option value="expected">Expected</option>
                      <option value="partial">Partial</option>
                      <option value="late">Late</option>
                      <option value="missed">Missed</option>
                    </select>
                    <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold ${st.color}`}><StatusIcon className="h-3 w-3" /> {c.status.toUpperCase()}</span>
                    <button onClick={async () => { await deleteIVAContribution(c.id); reloadContributions(); }} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Distributions Tab */}
      {activeTab === "distributions" && (
        <div className="space-y-4">
          {/* Distribution Calculator */}
          <div className="panel p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-100"><Calculator className="h-4 w-4 text-violet-500" /> Distribution Calculator</h3>
              <button onClick={() => setShowDistCalc(!showDistCalc)} className="btn btn-secondary text-xs">
                <Plus className="h-3.5 w-3.5" /> New Distribution
              </button>
            </div>

            {showDistCalc && (
              <div className="space-y-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">Total Collected (£) — Available for Distribution</label>
                  <input type="number" className="input" value={distAmount || ""} onChange={(e) => setDistAmount(parseFloat(e.target.value) || 0)} placeholder={`Max available: ${formatCurrency(totalUnallocated)}`} />
                  {totalUnallocated > 0 && (
                    <button onClick={() => setDistAmount(totalUnallocated)} className="mt-1 text-[10px] text-blue-600 dark:text-blue-400 hover:underline">
                      Use full unallocated amount: {formatCurrency(totalUnallocated)}
                    </button>
                  )}
                </div>
                <button onClick={handleCalculateDistribution} disabled={distAmount <= 0 || creditors.length === 0} className="btn btn-primary bg-violet-600 text-xs hover:bg-violet-700 disabled:opacity-50">
                  <Calculator className="h-3.5 w-3.5" /> Calculate Distribution
                </button>

                {/* Calculation Result */}
                {distCalcResult && (
                  <div className="space-y-4 rounded-xl border-2 border-violet-300 bg-violet-50 p-4 dark:border-violet-500/30 dark:bg-violet-500/5">
                    {/* Fee breakdown */}
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <div className="rounded-lg bg-white p-3 dark:bg-slate-800"><p className="text-[10px] font-bold uppercase text-slate-400">Nominee Fee</p><p className="text-sm font-bold text-violet-600 dark:text-violet-400">{formatCurrency(distCalcResult.nomineeFee)}</p></div>
                      <div className="rounded-lg bg-white p-3 dark:bg-slate-800"><p className="text-[10px] font-bold uppercase text-slate-400">Supervisor Fee</p><p className="text-sm font-bold text-violet-600 dark:text-violet-400">{formatCurrency(distCalcResult.supervisorFee)}</p></div>
                      <div className="rounded-lg bg-white p-3 dark:bg-slate-800"><p className="text-[10px] font-bold uppercase text-slate-400">Total Fees</p><p className="text-sm font-bold text-rose-600 dark:text-rose-400">{formatCurrency(distCalcResult.totalFees)}</p></div>
                      <div className="rounded-lg bg-white p-3 dark:bg-slate-800"><p className="text-[10px] font-bold uppercase text-slate-400">Net Distributable</p><p className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(distCalcResult.netDistributable)}</p></div>
                    </div>

                    {/* Creditor breakdown */}
                    <div className="overflow-auto rounded-lg border border-slate-200 dark:border-slate-700">
                      <table className="w-full text-xs">
                        <thead className="bg-slate-50 dark:bg-slate-800">
                          <tr>
                            <th className="px-3 py-2 text-left font-bold text-slate-600 dark:text-slate-400">Creditor</th>
                            <th className="px-3 py-2 text-right font-bold text-slate-600 dark:text-slate-400">Original Debt</th>
                            <th className="px-3 py-2 text-right font-bold text-slate-600 dark:text-slate-400">Pro-Rata %</th>
                            <th className="px-3 py-2 text-right font-bold text-slate-600 dark:text-slate-400">Distribution</th>
                          </tr>
                        </thead>
                        <tbody>
                          {distCalcResult.items.map((item, i) => (
                            <tr key={i} className="border-t border-slate-100 dark:border-slate-700/50">
                              <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{item.creditor_name}</td>
                              <td className="px-3 py-2 text-right text-slate-500">{formatCurrency(item.original_debt)}</td>
                              <td className="px-3 py-2 text-right text-slate-500">{item.pro_rata_percent}%</td>
                              <td className="px-3 py-2 text-right font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(item.distribution_amount)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-t-2 border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
                            <td colSpan={3} className="px-3 py-2 text-right font-bold text-slate-700 dark:text-slate-300">Total Disbursed:</td>
                            <td className="px-3 py-2 text-right font-bold text-violet-600 dark:text-violet-400">{formatCurrency(distCalcResult.totalDisbursed)}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>

                    <button onClick={handleSaveDistribution} disabled={savingDist} className="btn btn-primary w-full bg-violet-600 py-2.5 text-sm hover:bg-violet-700 disabled:opacity-50">
                      <BadgeCheck className="h-4 w-4" /> {savingDist ? "Saving..." : "Save Distribution Run"}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Distribution Run History */}
          <div className="panel p-5">
            <h3 className="mb-4 flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-100"><Receipt className="h-4 w-4 text-blue-500" /> Distribution Run History</h3>
            {runs.length === 0 ? (
              <div className="py-6 text-center">
                <Receipt className="mx-auto mb-2 h-8 w-8 text-slate-300 dark:text-slate-600" />
                <p className="text-xs text-slate-400">No distribution runs calculated yet</p>
              </div>
            ) : (
              <div className="space-y-3">
                {runs.map((run) => (
                  <div key={run.id} className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-100 dark:bg-violet-500/20">
                          <Receipt className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{formatDateShort(run.run_date)}</p>
                          <p className="text-[10px] text-slate-400">Collected: {formatCurrency(run.total_collected)} · Disbursed: {formatCurrency(run.total_disbursed)}</p>
                        </div>
                      </div>
                      <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${RUN_STATUS_STYLES[run.status]}`}>{run.status.toUpperCase()}</span>
                    </div>

                    {/* Fee breakdown */}
                    <div className="mt-3 flex gap-4 text-[10px] text-slate-500">
                      <span>Nominee fee: <strong className="text-violet-600 dark:text-violet-400">{formatCurrency(run.nominee_fee_deducted)}</strong></span>
                      <span>Supervisor fee: <strong className="text-violet-600 dark:text-violet-400">{formatCurrency(run.supervisor_fee_deducted)}</strong></span>
                    </div>

                    {/* Actions */}
                    <div className="mt-3 flex items-center gap-2">
                      <button onClick={() => setSelectedRunId(selectedRunId === run.id ? null : run.id)} className="btn btn-secondary text-xs">
                        {selectedRunId === run.id ? "Hide" : "View"} Items
                      </button>
                      {run.status === "calculated" && (
                        <button onClick={() => handleApproveRun(run)} className="btn btn-secondary text-xs text-amber-600">
                          <BadgeCheck className="h-3.5 w-3.5" /> Approve
                        </button>
                      )}
                      {run.status === "approved" && (
                        <button onClick={() => handleExecuteRun(run)} className="btn btn-primary bg-emerald-600 text-xs hover:bg-emerald-700">
                          <Play className="h-3.5 w-3.5" /> Execute
                        </button>
                      )}
                      {run.status !== "executed" && (
                        <button onClick={async () => { await deleteDistributionRun(run.id); reloadRuns(); }} className="btn btn-secondary text-xs text-rose-600">
                          <RotateCcw className="h-3.5 w-3.5" /> Delete
                        </button>
                      )}
                    </div>

                    {/* Distribution items */}
                    {selectedRunId === run.id && selectedRunItems.length > 0 && (
                      <div className="mt-3 overflow-auto rounded-lg border border-slate-200 dark:border-slate-700">
                        <table className="w-full text-xs">
                          <thead className="bg-slate-50 dark:bg-slate-800">
                            <tr>
                              <th className="px-3 py-2 text-left font-bold text-slate-600 dark:text-slate-400">Creditor</th>
                              <th className="px-3 py-2 text-right font-bold text-slate-600 dark:text-slate-400">Original Debt</th>
                              <th className="px-3 py-2 text-right font-bold text-slate-600 dark:text-slate-400">Pro-Rata</th>
                              <th className="px-3 py-2 text-right font-bold text-slate-600 dark:text-slate-400">Amount</th>
                            </tr>
                          </thead>
                          <tbody>
                            {selectedRunItems.map((item) => (
                              <tr key={item.id} className="border-t border-slate-100 dark:border-slate-700/50">
                                <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{item.creditor_name}</td>
                                <td className="px-3 py-2 text-right text-slate-500">{formatCurrency(item.original_debt)}</td>
                                <td className="px-3 py-2 text-right text-slate-500">{item.pro_rata_percent}%</td>
                                <td className="px-3 py-2 text-right font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(item.distribution_amount)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
