import { useState, useMemo, useCallback } from "react";
import {
  X, Calculator, ArrowRight, PoundSterling, TrendingDown, TrendingUp,
  CheckCircle2, Info, AlertCircle, RefreshCw, Clock, GraduationCap,
  Building2, Briefcase, Store, ChevronDown, ChevronRight,
} from "lucide-react";
import { useIncomeCalc, type IncomeCalcPortal } from "@/lib/income-calc-context";
import {
  calculateUkTax, calculateOvertimeGross, calculateStudentLoan,
  STUDENT_LOAN_PLAN_LABELS, type UkTaxBreakdown, type TaxBand, type StudentLoanPlan,
} from "@/lib/uk-tax";
import { formatCurrency as _fmt } from "@/lib/format";
const formatCurrency = (n: number) => _fmt(n, "GBP");
import { useDebtVergeCase } from "@/lib/debtverge-case-context";
import { createDebtSfsEntry, updateDebtCase } from "@/lib/debt-hooks";
import { supabase } from "@/lib/supabase";

interface Props {
  portal: IncomeCalcPortal;
}

interface SfsUpdateResult {
  success: boolean;
  message: string;
  details?: string;
}

export function SalaryIncomeCalculator({ portal }: Props) {
  const { state, isOpen, closeCalc, updateState, triggeredFrom } = useIncomeCalc();
  const [updateResult, setUpdateResult] = useState<SfsUpdateResult | null>(null);
  const [updating, setUpdating] = useState(false);
  const [showOvertimeBreakdown, setShowOvertimeBreakdown] = useState(false);
  const [showTaxBands, setShowTaxBands] = useState(false);

  const debtCase = portal !== "LeadVerge" && portal !== "Qualify" ? useDebtVergeCaseSafe() : null;

  // ── Overtime calculation (if hourly mode) ─────────────────
  const overtimeResult = useMemo(() => {
    if (state.salaryInputMode !== "hourly") return null;
    const hourlyRate = parseFloat(state.hourlyRate);
    const stdHours = parseFloat(state.standardHoursPerWeek);
    if (isNaN(hourlyRate) || hourlyRate <= 0 || isNaN(stdHours) || stdHours <= 0) return null;
    return calculateOvertimeGross({
      hourlyRate,
      standardHoursPerWeek: stdHours,
      timeAndThirdHours: parseFloat(state.timeAndThirdHours) || 0,
      timeAndHalfHours: parseFloat(state.timeAndHalfHours) || 0,
      doubleTimeHours: parseFloat(state.doubleTimeHours) || 0,
    });
  }, [state.salaryInputMode, state.hourlyRate, state.standardHoursPerWeek, state.timeAndThirdHours, state.timeAndHalfHours, state.doubleTimeHours]);

  // ── Determine the gross annual amount to feed into tax calc ─
  const effectiveAmount = useMemo(() => {
    if (state.selfEmployedNetProfitMode && state.isSelfEmployed) {
      const profit = parseFloat(state.amount);
      return { value: isNaN(profit) ? 0 : profit, mode: "gross" as const, frequency: "annual" as const };
    }
    if (overtimeResult) {
      return { value: overtimeResult.grossAnnual, mode: "gross" as const, frequency: "annual" as const };
    }
    return { value: parseFloat(state.amount) || 0, mode: state.mode, frequency: state.frequency };
  }, [state.amount, state.mode, state.frequency, state.selfEmployedNetProfitMode, state.isSelfEmployed, overtimeResult]);

  // ── Tax breakdown ─────────────────────────────────────────
  const breakdown: UkTaxBreakdown | null = useMemo(() => {
    if (!isOpen || effectiveAmount.value <= 0) return null;
    return calculateUkTax(effectiveAmount.value, effectiveAmount.mode, effectiveAmount.frequency, {
      pensionPct: parseFloat(state.pensionPct) || 0,
      studentLoanPlan: state.studentLoanPlan,
      isSelfEmployed: state.isSelfEmployed,
    });
  }, [effectiveAmount, state.pensionPct, state.studentLoanPlan, state.isSelfEmployed, isOpen]);

  // ── Update SFS ────────────────────────────────────────────
  const handleUpdateSFS = useCallback(async () => {
    if (!breakdown) return;
    setUpdating(true);
    setUpdateResult(null);

    try {
      const netMonthly = Math.round(breakdown.netMonthly * 100) / 100;
      const isOt = overtimeResult != null;
      const isSe = state.isSelfEmployed && state.selfEmployedNetProfitMode;
      const label = isSe
        ? `Self-Employed Net Profit Income`
        : isOt
          ? `Salary + Overtime Net Income`
          : state.isSelfEmployed
            ? `Self-Employed Net Income`
            : `Salary Net Income`;

      if (portal === "LeadVerge") {
        window.dispatchEvent(new CustomEvent("income-calc:update-lead", {
          detail: { monthlyIncome: netMonthly, label },
        }));
        setUpdateResult({ success: true, message: "Lead monthly income updated", details: `Net monthly income set to ${formatCurrency(netMonthly)}.` });
      } else if (portal === "Qualify") {
        window.dispatchEvent(new CustomEvent("income-calc:update-qualify", {
          detail: { monthlyIncome: netMonthly, label },
        }));
        setUpdateResult({ success: true, message: "Qualify income updated", details: `Net monthly income set to ${formatCurrency(netMonthly)} for the active client's SFS.` });
      } else {
        if (!debtCase?.activeCaseId) {
          setUpdateResult({ success: false, message: "No active case selected", details: "Select a case in the sidebar before updating SFS." });
          setUpdating(false);
          return;
        }
        const existingEntries = debtCase.activeCase?.financialStatement.entries ?? [];
        const existingIncome = existingEntries.find((e) => e.category === "income" && (e.label.toLowerCase().includes("salary") || e.label.toLowerCase().includes("self-employed") || e.label.toLowerCase().includes("overtime")));

        if (existingIncome) {
          const { error } = await supabase.from("debt_sfs_entries").update({ amount: netMonthly, label }).eq("id", existingIncome.id);
          if (error) throw new Error(error.message);
        } else {
          await createDebtSfsEntry({ case_id: debtCase.activeCaseId, category: "income", label, amount: netMonthly, is_recurring: true });
        }

        const totalIncome = existingEntries.filter((e) => e.category === "income" && e.id !== existingIncome?.id).reduce((s, e) => s + e.amount, 0) + netMonthly;
        const totalExpenses = existingEntries.filter((e) => e.category !== "income").reduce((s, e) => s + e.amount, 0);
        await updateDebtCase(debtCase.activeCaseId, { monthly_disposable_income: Math.round((totalIncome - totalExpenses) * 100) / 100 });

        setUpdateResult({ success: true, message: "SFS Budget updated", details: `Monthly income set to ${formatCurrency(netMonthly)}. Disposable income recalculated.` });
      }
    } catch (e) {
      setUpdateResult({ success: false, message: "Failed to update SFS", details: (e as Error).message });
    } finally {
      setUpdating(false);
    }
  }, [breakdown, overtimeResult, state.isSelfEmployed, state.selfEmployedNetProfitMode, portal, debtCase]);

  if (!isOpen) return null;

  const inputCls = "w-full rounded-lg border border-slate-300 bg-white py-2.5 px-3 text-sm font-medium text-slate-800 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100";
  const labelCls = "mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400";
  const toggleBtnCls = (active: boolean) => `flex-1 rounded-md py-1.5 text-xs font-bold transition-all ${active ? "bg-emerald-600 text-white shadow-sm" : "text-slate-500 dark:text-slate-400"}`;

  const showHourlyInputs = state.salaryInputMode === "hourly" && !state.isSelfEmployed;
  const showNetProfitMode = state.isSelfEmployed && state.selfEmployedNetProfitMode;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 fade-in">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={closeCalc} />

      <div className="relative flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-800">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-gradient-to-r from-emerald-50 to-teal-50 px-5 py-4 dark:border-slate-700 dark:from-emerald-500/10 dark:to-teal-500/10">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-600 to-teal-600 text-white shadow-md">
              <Calculator className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Salary &amp; Self-Employed Income Calculator</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                UK Tax, NI, Pension &amp; Student Loan · {portal}
                {triggeredFrom && triggeredFrom !== portal && ` · opened from ${triggeredFrom}`}
              </p>
            </div>
          </div>
          <button onClick={closeCalc} className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-600 dark:hover:bg-slate-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto p-5 space-y-5">
          {/* Sync indicator */}
          {state.lastUpdatedBy && (
            <div className="flex items-center gap-2 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">
              <Info className="h-3.5 w-3.5 shrink-0" />
              <span>Calculator state last updated in {state.lastUpdatedBy} — values synced across all portals.</span>
            </div>
          )}

          {/* Employment Type Toggle */}
          <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
            <label className={labelCls}>Employment Type</label>
            <div className="flex rounded-lg border border-slate-300 bg-slate-50 p-1 dark:border-slate-600 dark:bg-slate-700">
              <button onClick={() => updateState({ isSelfEmployed: false, selfEmployedNetProfitMode: false }, portal)} className={toggleBtnCls(!state.isSelfEmployed)}>
                <span className="flex items-center justify-center gap-1.5"><Briefcase className="h-3.5 w-3.5" /> PAYE Employee</span>
              </button>
              <button onClick={() => updateState({ isSelfEmployed: true, salaryInputMode: "annual" }, portal)} className={toggleBtnCls(state.isSelfEmployed)}>
                <span className="flex items-center justify-center gap-1.5"><Store className="h-3.5 w-3.5" /> Self-Employed</span>
              </button>
            </div>
          </div>

          {/* ── Self-Employed Net Profit Mode ─────────────────── */}
          {state.isSelfEmployed && (
            <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
              <div className="flex items-center justify-between">
                <div>
                  <label className={labelCls}>Self-Employed Calculation Mode</label>
                  <p className="text-xs text-slate-400">Toggle between entering annual net profit or gross turnover</p>
                </div>
                <div className="flex rounded-lg border border-slate-300 bg-slate-50 p-1 dark:border-slate-600 dark:bg-slate-700">
                  <button onClick={() => updateState({ selfEmployedNetProfitMode: false }, portal)} className={toggleBtnCls(!state.selfEmployedNetProfitMode)}>
                    From Gross
                  </button>
                  <button onClick={() => updateState({ selfEmployedNetProfitMode: true, mode: "gross", frequency: "annual" }, portal)} className={toggleBtnCls(state.selfEmployedNetProfitMode)}>
                    Net Profit
                  </button>
                </div>
              </div>
              {state.selfEmployedNetProfitMode && (
                <div className="mt-3 rounded-lg bg-violet-50 px-3 py-2 text-xs text-violet-700 dark:bg-violet-500/10 dark:text-violet-300">
                  <Info className="mr-1.5 inline h-3.5 w-3.5" />
                  Enter the client's annual net profit (after business expenses). Tax, Class 4 NI, pension, and student loans are calculated on this figure to determine monthly take-home.
                </div>
              )}
            </div>
          )}

          {/* ── Input Section ─────────────────────────────────── */}
          <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
            {/* Salary input mode toggle (PAYE only, not net profit mode) */}
            {!state.isSelfEmployed && !showNetProfitMode && (
              <div className="mb-4">
                <label className={labelCls}>Salary Input Mode</label>
                <div className="flex rounded-lg border border-slate-300 bg-slate-50 p-1 dark:border-slate-600 dark:bg-slate-700">
                  <button onClick={() => updateState({ salaryInputMode: "annual" }, portal)} className={toggleBtnCls(state.salaryInputMode === "annual")}>
                    <span className="flex items-center justify-center gap-1.5"><PoundSterling className="h-3.5 w-3.5" /> Annual / Monthly Salary</span>
                  </button>
                  <button onClick={() => updateState({ salaryInputMode: "hourly", mode: "gross", frequency: "annual" }, portal)} className={toggleBtnCls(state.salaryInputMode === "hourly")}>
                    <span className="flex items-center justify-center gap-1.5"><Clock className="h-3.5 w-3.5" /> Hourly Rate + Overtime</span>
                  </button>
                </div>
              </div>
            )}

            {/* Annual/Monthly salary input */}
            {!showHourlyInputs && !showNetProfitMode && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className={labelCls}>
                    {state.mode === "gross" ? "Gross" : "Net"} {state.frequency === "annual" ? "Annual" : "Monthly"} {state.isSelfEmployed ? "Profit" : "Salary"}
                  </label>
                  <div className="relative">
                    <PoundSterling className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input type="number" value={state.amount} onChange={(e) => updateState({ amount: e.target.value }, portal)} placeholder="0.00" className={`${inputCls} pl-9`} />
                  </div>
                </div>
                <div>
                  <label className={labelCls}>Input Type</label>
                  <div className="flex rounded-lg border border-slate-300 bg-slate-50 p-1 dark:border-slate-600 dark:bg-slate-700">
                    <button onClick={() => updateState({ mode: "gross" }, portal)} className={toggleBtnCls(state.mode === "gross")}>Gross</button>
                    <button onClick={() => updateState({ mode: "net" }, portal)} className={toggleBtnCls(state.mode === "net")}>Net</button>
                  </div>
                </div>
                <div>
                  <label className={labelCls}>Pay Frequency</label>
                  <div className="flex rounded-lg border border-slate-300 bg-slate-50 p-1 dark:border-slate-600 dark:bg-slate-700">
                    <button onClick={() => updateState({ frequency: "annual" }, portal)} className={toggleBtnCls(state.frequency === "annual")}>Annual</button>
                    <button onClick={() => updateState({ frequency: "monthly" }, portal)} className={toggleBtnCls(state.frequency === "monthly")}>Monthly</button>
                  </div>
                </div>
              </div>
            )}

            {/* Net profit input (self-employed net profit mode) */}
            {showNetProfitMode && (
              <div>
                <label className={labelCls}>Annual Net Profit (after business expenses, before tax)</label>
                <div className="relative">
                  <PoundSterling className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input type="number" value={state.amount} onChange={(e) => updateState({ amount: e.target.value }, portal)} placeholder="0.00" className={`${inputCls} pl-9`} />
                </div>
                <p className="mt-1.5 text-xs text-slate-400">Enter the net profit figure from the client's SA302 or latest accounts.</p>
              </div>
            )}

            {/* ── Hourly + Overtime Engine ─────────────────────── */}
            {showHourlyInputs && (
              <div className="space-y-4">
                {/* Hourly rate & standard hours */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className={labelCls}>Hourly Rate</label>
                    <div className="relative">
                      <PoundSterling className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input type="number" step="0.01" value={state.hourlyRate} onChange={(e) => updateState({ hourlyRate: e.target.value }, portal)} placeholder="12.50" className={`${inputCls} pl-9`} />
                    </div>
                  </div>
                  <div>
                    <label className={labelCls}>Standard Hours / Week</label>
                    <input type="number" value={state.standardHoursPerWeek} onChange={(e) => updateState({ standardHoursPerWeek: e.target.value }, portal)} placeholder="37.5" className={inputCls} />
                  </div>
                </div>

                {/* Overtime rates */}
                <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/50">
                  <div className="mb-2 flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5 text-emerald-500" />
                    <span className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Overtime Hours / Week</span>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div>
                      <label className="mb-1 block text-[11px] font-medium text-slate-500">Time &amp; a Third (1.33x)</label>
                      <input type="number" step="0.5" value={state.timeAndThirdHours} onChange={(e) => updateState({ timeAndThirdHours: e.target.value }, portal)} placeholder="0" className={inputCls} />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] font-medium text-slate-500">Time &amp; a Half (1.5x)</label>
                      <input type="number" step="0.5" value={state.timeAndHalfHours} onChange={(e) => updateState({ timeAndHalfHours: e.target.value }, portal)} placeholder="0" className={inputCls} />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] font-medium text-slate-500">Double Time (2.0x)</label>
                      <input type="number" step="0.5" value={state.doubleTimeHours} onChange={(e) => updateState({ doubleTimeHours: e.target.value }, portal)} placeholder="0" className={inputCls} />
                    </div>
                  </div>
                </div>

                {/* Overtime summary */}
                {overtimeResult && (
                  <div className="rounded-lg bg-emerald-50 p-3 dark:bg-emerald-500/10">
                    <button onClick={() => setShowOvertimeBreakdown(!showOvertimeBreakdown)} className="flex w-full items-center justify-between">
                      <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                        Gross Annual: {formatCurrency(overtimeResult.grossAnnual)} · Gross Monthly: {formatCurrency(overtimeResult.grossMonthly)}
                      </span>
                      {showOvertimeBreakdown ? <ChevronDown className="h-4 w-4 text-emerald-600" /> : <ChevronRight className="h-4 w-4 text-emerald-600" />}
                    </button>
                    {showOvertimeBreakdown && (
                      <div className="mt-2 space-y-1 border-t border-emerald-200 pt-2 dark:border-emerald-500/20">
                        {overtimeResult.breakdown.map((b, i) => (
                          <div key={i} className="flex items-center justify-between text-xs text-emerald-700 dark:text-emerald-300">
                            <span>{b.label} ({b.hours}h/wk @ {formatCurrency(b.rate)}/hr)</span>
                            <span className="font-semibold">{formatCurrency(b.annualPay)}/yr</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Pension & Student Loan Section ────────────────── */}
          <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {/* Pension */}
              <div>
                <label className={labelCls}>
                  <span className="flex items-center gap-1.5"><Building2 className="h-3.5 w-3.5" /> Workplace Pension (% of gross)</span>
                </label>
                <div className="relative">
                  <input type="number" step="0.5" min="0" max="100" value={state.pensionPct} onChange={(e) => updateState({ pensionPct: e.target.value }, portal)} placeholder="0" className={`${inputCls} pr-8`} />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-medium text-slate-400">%</span>
                </div>
                <p className="mt-1 text-[11px] text-slate-400">Auto-enrolment minimum is 5% employee + 3% employer.</p>
              </div>

              {/* Student Loan */}
              <div>
                <label className={labelCls}>
                  <span className="flex items-center gap-1.5"><GraduationCap className="h-3.5 w-3.5" /> Student Loan Plan</span>
                </label>
                <select value={state.studentLoanPlan} onChange={(e) => updateState({ studentLoanPlan: e.target.value as StudentLoanPlan }, portal)} className={inputCls}>
                  {(Object.keys(STUDENT_LOAN_PLAN_LABELS) as StudentLoanPlan[]).map(p => (
                    <option key={p} value={p}>{STUDENT_LOAN_PLAN_LABELS[p]}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* ── Results ───────────────────────────────────────── */}
          {breakdown ? (
            <div className="space-y-4">
              {/* Net Monthly Income Hero */}
              <div className="relative overflow-hidden rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-teal-50 p-5 dark:border-emerald-500/30 dark:from-emerald-500/10 dark:to-teal-500/10">
                <div className="absolute right-0 top-0 h-32 w-32 rounded-full bg-emerald-500/10 blur-3xl" />
                <div className="relative flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Net Monthly Take-Home</p>
                    <p className="mt-1 text-4xl font-bold text-emerald-700 dark:text-emerald-300">{formatCurrency(breakdown.netMonthly)}</p>
                    <p className="mt-1 text-xs text-emerald-600/70 dark:text-emerald-400/70">
                      {formatCurrency(breakdown.netAnnual)} per year · {breakdown.takeHomePct.toFixed(1)}% of gross
                    </p>
                  </div>
                  <div className="hidden shrink-0 sm:block">
                    <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-600/10 text-emerald-600 dark:text-emerald-400">
                      <TrendingUp className="h-8 w-8" />
                    </div>
                  </div>
                </div>
              </div>

              {/* Itemized Deductions Breakdown */}
              <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                <h4 className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-100">
                  <Calculator className="h-4 w-4 text-slate-400" /> Itemized Monthly Breakdown (2024/25)
                </h4>
                <div className="space-y-2">
                  {/* Gross */}
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2 text-sm dark:border-slate-700">
                    <span className="font-medium text-slate-600 dark:text-slate-300">Gross Monthly</span>
                    <span className="font-bold text-slate-800 dark:text-slate-100">{formatCurrency(breakdown.grossAnnual / 12)}</span>
                  </div>
                  {/* Income Tax */}
                  <DeductionRow label="Income Tax" amount={breakdown.incomeTax / 12} icon={<TrendingDown className="h-3.5 w-3.5 text-rose-500" />} color="text-rose-600 dark:text-rose-400" />
                  {/* National Insurance */}
                  <DeductionRow label={state.isSelfEmployed ? "Class 4 National Insurance" : "National Insurance (Class 1)"} amount={breakdown.nationalInsurance / 12} icon={<TrendingDown className="h-3.5 w-3.5 text-amber-500" />} color="text-amber-600 dark:text-amber-400" />
                  {/* Pension */}
                  {breakdown.pensionAnnual > 0 && (
                    <DeductionRow label={`Workplace Pension (${state.pensionPct}%)`} amount={breakdown.pensionMonthly} icon={<Building2 className="h-3.5 w-3.5 text-violet-500" />} color="text-violet-600 dark:text-violet-400" />
                  )}
                  {/* Student Loan */}
                  {breakdown.studentLoan && breakdown.studentLoan.monthlyRepayment > 0 && (
                    <DeductionRow
                      label={`Student Loan (${STUDENT_LOAN_PLAN_LABELS[breakdown.studentLoan.plan]})`}
                      amount={breakdown.studentLoan.monthlyRepayment}
                      icon={<GraduationCap className="h-3.5 w-3.5 text-blue-500" />}
                      color="text-blue-600 dark:text-blue-400"
                    />
                  )}
                  {/* Total deductions */}
                  <div className="flex items-center justify-between border-t border-slate-200 pt-2 text-sm dark:border-slate-600">
                    <span className="font-semibold text-slate-500 dark:text-slate-400">Total Deductions</span>
                    <span className="font-bold text-rose-600 dark:text-rose-400">-{formatCurrency(breakdown.totalDeductions / 12)}</span>
                  </div>
                  {/* Net */}
                  <div className="flex items-center justify-between rounded-lg bg-emerald-50 px-3 py-2 text-sm dark:bg-emerald-500/10">
                    <span className="font-bold text-emerald-700 dark:text-emerald-300">Net Disposable Income</span>
                    <span className="text-lg font-bold text-emerald-700 dark:text-emerald-300">{formatCurrency(breakdown.netMonthly)}</span>
                  </div>
                </div>

                {/* Collapsible tax band detail */}
                <button onClick={() => setShowTaxBands(!showTaxBands)} className="mt-3 flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
                  {showTaxBands ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  Detailed tax band breakdown
                </button>
                {showTaxBands && (
                  <div className="mt-2 space-y-1.5">
                    {breakdown.bands.map((band, i) => <BandRow key={i} band={band} />)}
                  </div>
                )}
              </div>

              {/* Summary cards */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <SummaryCard label="Gross Annual" value={formatCurrency(breakdown.grossAnnual)} icon={<PoundSterling className="h-4 w-4 text-slate-400" />} />
                <SummaryCard label="Income Tax / yr" value={formatCurrency(breakdown.incomeTax)} icon={<TrendingDown className="h-4 w-4 text-rose-500" />} accent="text-rose-600 dark:text-rose-400" />
                <SummaryCard label="NI / yr" value={formatCurrency(breakdown.nationalInsurance)} icon={<TrendingDown className="h-4 w-4 text-amber-500" />} accent="text-amber-600 dark:text-amber-400" />
                <SummaryCard label="Net Annual" value={formatCurrency(breakdown.netAnnual)} icon={<TrendingUp className="h-4 w-4 text-emerald-500" />} accent="text-emerald-600 dark:text-emerald-400" />
              </div>

              {/* Student loan detail */}
              {breakdown.studentLoan && breakdown.studentLoan.annualRepayment > 0 && (
                <div className="rounded-lg bg-blue-50 px-4 py-3 dark:bg-blue-500/10">
                  <div className="flex items-center gap-2">
                    <GraduationCap className="h-4 w-4 text-blue-500" />
                    <span className="text-xs font-bold text-blue-700 dark:text-blue-300">Student Loan Repayment Detail</span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-blue-700 dark:text-blue-300 sm:grid-cols-4">
                    <div><span className="opacity-60">Plan:</span> <span className="font-semibold">{STUDENT_LOAN_PLAN_LABELS[breakdown.studentLoan.plan]}</span></div>
                    <div><span className="opacity-60">Threshold:</span> <span className="font-semibold">{formatCurrency(breakdown.studentLoan.annualThreshold)}/yr</span></div>
                    <div><span className="opacity-60">Rate:</span> <span className="font-semibold">{(breakdown.studentLoan.rate * 100).toFixed(0)}%</span></div>
                    <div><span className="opacity-60">Monthly:</span> <span className="font-semibold">{formatCurrency(breakdown.studentLoan.monthlyRepayment)}</span></div>
                  </div>
                </div>
              )}

              {/* ── Update SFS Action ─────────────────────────── */}
              <div className="rounded-xl border-2 border-emerald-300 bg-emerald-50/50 p-4 dark:border-emerald-500/30 dark:bg-emerald-500/5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-white shadow-sm">
                      <ArrowRight className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-800 dark:text-slate-100">Update SFS Budget</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Pushes {formatCurrency(breakdown.netMonthly)}/mo net income into the active client's SFS monthly income field.
                        {portal === "LeadVerge" && " Updates the active lead's monthly income."}
                        {portal === "Qualify" && " Updates the active client's income in Qualify."}
                      </p>
                    </div>
                  </div>
                  <button onClick={handleUpdateSFS} disabled={updating || (portal !== "LeadVerge" && portal !== "Qualify" && !debtCase?.activeCaseId)} className="btn btn-primary shrink-0 bg-emerald-600 text-sm hover:bg-emerald-700 disabled:opacity-40">
                    {updating ? <RefreshCw className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                    <span>Update SFS</span>
                  </button>
                </div>

                {updateResult && (
                  <div className={`mt-3 flex items-start gap-2 rounded-lg px-3 py-2 text-xs ${updateResult.success ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" : "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"}`}>
                    {updateResult.success ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
                    <div><p className="font-semibold">{updateResult.message}</p>{updateResult.details && <p className="mt-0.5 opacity-80">{updateResult.details}</p>}</div>
                  </div>
                )}

                {portal !== "LeadVerge" && portal !== "Qualify" && !debtCase?.activeCaseId && (
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                    <AlertCircle className="h-3.5 w-3.5" /> No active case selected — select a case first.
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 dark:bg-slate-700/50">
                <Calculator className="h-8 w-8 text-slate-400" />
              </div>
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Enter an amount to calculate</p>
              <p className="mt-1 text-xs text-slate-400">
                {showHourlyInputs ? "Input hourly rate and standard hours to begin." : "Input a gross or net figure to see the UK tax breakdown."}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────

function DeductionRow({ label, amount, icon, color }: { label: string; amount: number; icon: React.ReactNode; color: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
        {icon} {label}
      </span>
      <span className={`font-semibold ${color}`}>-{formatCurrency(amount)}</span>
    </div>
  );
}

function SummaryCard({ label, value, icon, accent }: { label: string; value: string; icon: React.ReactNode; accent?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800/50">
      <div className="flex items-center gap-1.5">
        {icon}
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      </div>
      <p className={`mt-1 text-sm font-bold ${accent ?? "text-slate-800 dark:text-slate-100"}`}>{value}</p>
    </div>
  );
}

function BandRow({ band }: { band: TaxBand }) {
  if (band.taxableInThisBand === 0) return null;
  return (
    <div className="flex items-center justify-between rounded-md px-2 py-1.5 text-xs">
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${band.rate === 0 ? "bg-slate-300 dark:bg-slate-600" : band.rate <= 0.08 ? "bg-amber-400" : band.rate <= 0.2 ? "bg-blue-400" : band.rate <= 0.45 ? "bg-rose-400" : "bg-rose-600"}`} />
        <span className="font-medium text-slate-600 dark:text-slate-300">{band.label}</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-slate-400">{formatCurrency(band.taxableInThisBand)}</span>
        <span className="w-16 text-right font-semibold text-slate-700 dark:text-slate-200">{band.rate === 0 ? "—" : `-${formatCurrency(band.taxInThisBand)}`}</span>
      </div>
    </div>
  );
}

function useDebtVergeCaseSafe() {
  try {
    return useDebtVergeCase();
  } catch {
    return null;
  }
}
