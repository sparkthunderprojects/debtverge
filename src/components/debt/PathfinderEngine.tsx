import { useState, useMemo } from "react";
import {
  Compass, Scale, Wallet, Shield, Building2, TrendingUp, Clock,
  CheckCircle2, AlertCircle, Sparkles, Gauge, ArrowRight, Zap,
} from "lucide-react";
import { formatCurrency } from "@/lib/format";
import { runPathfinderEngine, ROUTE_LABELS } from "@/lib/insolvency-docs";
import { useDebtVergeCase } from "@/lib/debtverge-case-context";
import { saveSignpostingAssessment } from "@/lib/insolvency-hooks";
import { addAuditMilestone } from "@/lib/debt-hooks";
import type { SignpostingRoute } from "@/lib/types";

const ROUTE_ICONS: Record<SignpostingRoute, typeof Scale> = {
  iva: Scale, dmp: Wallet, dro: Shield, bankruptcy: Building2, signposting: Compass,
};

const ROUTE_COLORS: Record<SignpostingRoute, string> = {
  iva: "violet", dmp: "blue", dro: "emerald", bankruptcy: "rose", signposting: "amber",
};

export function PathfinderEngine() {
  const { activeCase, activeCaseId } = useDebtVergeCase();
  const [autoMode, setAutoMode] = useState(true);
  const [manualInput, setManualInput] = useState({ totalDebt: 0, disposableIncome: 0, creditorCount: 0, assetEquity: 0, hasProperty: false });
  const [hasRun, setHasRun] = useState(false);
  const [saving, setSaving] = useState(false);

  const input = useMemo(() => {
    if (autoMode && activeCase) {
      return {
        totalDebt: activeCase.creditorsAndDebts.totalDebt,
        disposableIncome: activeCase.financialStatement.disposableIncome,
        creditorCount: activeCase.creditorsAndDebts.creditorCount,
        assetEquity: (activeCase.customerProfile as unknown as { assets?: { assetEquity?: number } })?.assets?.assetEquity ?? 0,
        hasProperty: (activeCase.customerProfile as unknown as { assets?: { hasProperty?: boolean } })?.assets?.hasProperty ?? false,
      };
    }
    return manualInput;
  }, [autoMode, activeCase, manualInput]);

  const result = useMemo(() => runPathfinderEngine(input), [input]);

  const handleSave = async () => {
    if (!activeCaseId) return;
    setSaving(true);
    try {
      await saveSignpostingAssessment(activeCaseId, {
        total_debt: input.totalDebt,
        monthly_disposable_income: input.disposableIncome,
        creditor_count: input.creditorCount,
        recommended_route: result.recommendedRoute,
        route_confidence: result.confidence,
        route_reasons: result.reasons,
        assessment_data: {
          has_property: input.hasProperty,
          asset_equity: input.assetEquity,
          all_routes: result.allRoutes,
          estimated_time_months: result.estimatedTimeMonths,
          estimated_total_cost: result.estimatedTotalCost,
        },
      });
      await addAuditMilestone({
        case_id: activeCaseId,
        milestone: "Pathfinder Assessment Run",
        description: `Recommended route: ${ROUTE_LABELS[result.recommendedRoute]} (${result.confidence}% confidence). Estimated duration: ${result.estimatedTimeMonths} months.`,
      });
    } finally { setSaving(false); setHasRun(true); }
  };

  if (!activeCase && autoMode) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Compass className="mb-3 h-12 w-12 text-slate-300 dark:text-slate-600" />
        <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Select a case to run the Pathfinder Decisioning Engine</p>
        <p className="mt-1 text-xs text-slate-400">The engine evaluates debtor profiles and recommends the optimal debt solution route.</p>
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
              <Compass className="h-5 w-5 text-violet-600 dark:text-violet-400" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">Pathfinder Decisioning Engine</h2>
              <p className="text-xs text-slate-400">Automated debt solution route recommendation</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setAutoMode(!autoMode)} className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${autoMode ? "bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"}`}>
              {autoMode ? "Auto (Case Data)" : "Manual Input"}
            </button>
          </div>
        </div>
      </div>

      {/* Manual Input */}
      {!autoMode && (
        <div className="panel p-5">
          <h3 className="mb-4 text-sm font-bold text-slate-800 dark:text-slate-100">Manual Assessment Input</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Total Unsecured Debt (£)</label>
              <input type="number" className="input" value={manualInput.totalDebt || ""} onChange={(e) => setManualInput({ ...manualInput, totalDebt: parseFloat(e.target.value) || 0 })} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Monthly Disposable Income (£)</label>
              <input type="number" className="input" value={manualInput.disposableIncome || ""} onChange={(e) => setManualInput({ ...manualInput, disposableIncome: parseFloat(e.target.value) || 0 })} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Number of Creditors</label>
              <input type="number" className="input" value={manualInput.creditorCount || ""} onChange={(e) => setManualInput({ ...manualInput, creditorCount: parseInt(e.target.value) || 0 })} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Property Equity (£)</label>
              <input type="number" className="input" value={manualInput.assetEquity || ""} onChange={(e) => setManualInput({ ...manualInput, assetEquity: parseFloat(e.target.value) || 0 })} />
            </div>
            <div className="flex items-end">
              <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-400">
                <input type="checkbox" checked={manualInput.hasProperty} onChange={(e) => setManualInput({ ...manualInput, hasProperty: e.target.checked })} className="h-4 w-4 rounded border-slate-300" />
                Owns Property
              </label>
            </div>
          </div>
        </div>
      )}

      {/* Input Summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Total Debt", value: formatCurrency(input.totalDebt), icon: Wallet },
          { label: "Disposable Income", value: formatCurrency(input.disposableIncome) + "/mo", icon: TrendingUp },
          { label: "Creditors", value: String(input.creditorCount), icon: Building2 },
          { label: "Property Equity", value: formatCurrency(input.assetEquity), icon: Shield },
        ].map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.label} className="panel p-4">
              <Icon className="mb-1 h-4 w-4 text-slate-400" />
              <p className="text-[10px] font-bold uppercase text-slate-400">{s.label}</p>
              <p className="text-sm font-bold text-slate-700 dark:text-slate-300">{s.value}</p>
            </div>
          );
        })}
      </div>

      {/* Recommended Route */}
      <div className="panel p-6">
        <div className="mb-4 flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-violet-500" />
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Recommended Solution Route</h3>
        </div>

        <div className={`rounded-2xl border-2 p-6 ${
          ROUTE_COLORS[result.recommendedRoute] === "violet" ? "border-violet-300 bg-violet-50 dark:border-violet-500/30 dark:bg-violet-500/5" :
          ROUTE_COLORS[result.recommendedRoute] === "blue" ? "border-blue-300 bg-blue-50 dark:border-blue-500/30 dark:bg-blue-500/5" :
          ROUTE_COLORS[result.recommendedRoute] === "emerald" ? "border-emerald-300 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/5" :
          ROUTE_COLORS[result.recommendedRoute] === "rose" ? "border-rose-300 bg-rose-50 dark:border-rose-500/30 dark:bg-rose-500/5" :
          "border-amber-300 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/5"
        }`}>
          <div className="flex items-center gap-4">
            {(() => {
              const Icon = ROUTE_ICONS[result.recommendedRoute];
              return (
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white shadow-md dark:bg-slate-800">
                  <Icon className="h-8 w-8 text-slate-700 dark:text-slate-300" />
                </div>
              );
            })()}
            <div className="flex-1">
              <p className="text-[10px] font-bold uppercase text-slate-400">Recommended Route</p>
              <p className="text-2xl font-bold text-slate-800 dark:text-slate-100">{ROUTE_LABELS[result.recommendedRoute]}</p>
              <div className="mt-1 flex items-center gap-2">
                <div className="h-2 w-32 overflow-hidden rounded-full bg-white/50 dark:bg-slate-700/50">
                  <div className="h-full rounded-full bg-violet-500" style={{ width: `${result.confidence}%` }} />
                </div>
                <span className="text-xs font-bold text-slate-600 dark:text-slate-400">{result.confidence}% confidence</span>
              </div>
            </div>
          </div>

          {/* Reasons */}
          {result.reasons.length > 0 && (
            <div className="mt-4 space-y-2">
              {result.reasons.map((reason, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-400">
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" /> {reason}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Time & Cost Savings */}
        <div className="mt-4 grid grid-cols-2 gap-4">
          <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
            <div className="flex items-center gap-1.5">
              <Clock className="h-4 w-4 text-blue-500" />
              <p className="text-[10px] font-bold uppercase text-slate-400">Estimated Duration</p>
            </div>
            <p className="mt-1 text-xl font-bold text-slate-700 dark:text-slate-300">{result.estimatedTimeMonths > 0 ? `${result.estimatedTimeMonths} months` : "N/A"}</p>
          </div>
          <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
            <div className="flex items-center gap-1.5">
              <TrendingUp className="h-4 w-4 text-emerald-500" />
              <p className="text-[10px] font-bold uppercase text-slate-400">Estimated Total Repaid</p>
            </div>
            <p className="mt-1 text-xl font-bold text-slate-700 dark:text-slate-300">{result.estimatedTotalCost > 0 ? formatCurrency(result.estimatedTotalCost) : "N/A"}</p>
          </div>
        </div>
      </div>

      {/* All Route Comparison */}
      <div className="panel p-6">
        <div className="mb-4 flex items-center gap-2">
          <Gauge className="h-5 w-5 text-blue-500" />
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">All Routes Scored</h3>
        </div>
        <div className="space-y-3">
          {result.allRoutes.map((r) => {
            const Icon = ROUTE_ICONS[r.route];
            const color = ROUTE_COLORS[r.route];
            return (
              <div key={r.route} className={`rounded-xl border p-4 ${r.verdict === "recommended" ? `border-${color}-300 bg-${color}-50 dark:border-${color}-500/30 dark:bg-${color}-500/5` : "border-slate-200 dark:border-slate-700"}`}>
                <div className="flex items-center gap-3">
                  <Icon className="h-5 w-5 text-slate-400" />
                  <span className="flex-1 text-sm font-medium text-slate-700 dark:text-slate-300">{ROUTE_LABELS[r.route]}</span>
                  {r.verdict === "recommended" && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-bold text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">RECOMMENDED</span>}
                  {r.verdict === "viable" && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-bold text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">VIABLE</span>}
                  {r.verdict === "not_suitable" && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-bold text-slate-500 dark:bg-slate-700 dark:text-slate-400">NOT SUITABLE</span>}
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                    <div className={`h-full rounded-full ${r.score >= 60 ? "bg-emerald-500" : r.score >= 40 ? "bg-amber-500" : "bg-slate-400"}`} style={{ width: `${r.score}%` }} />
                  </div>
                  <span className="w-10 text-right text-xs font-bold text-slate-500">{r.score}%</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Save & Apply */}
      <button onClick={handleSave} disabled={saving || hasRun} className="btn btn-primary w-full bg-violet-600 py-3 text-sm hover:bg-violet-700 disabled:opacity-50">
        <Zap className="h-4 w-4" /> {hasRun ? "Assessment Saved" : saving ? "Saving..." : "Save Assessment to Case"}
      </button>
    </div>
  );
}
