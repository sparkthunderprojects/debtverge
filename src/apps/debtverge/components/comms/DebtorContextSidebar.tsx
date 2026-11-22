import { useState, useMemo } from "react";
import {
  Scale, PoundSterling, Wallet, TrendingDown, User,
  ChevronRight, Calculator, ShieldAlert, Phone, CalendarClock,
  RefreshCw, Mail, Home, Users, Check, RotateCcw,
} from "lucide-react";
import { formatCurrency } from "@/core/format";
import type { QueueItem } from "@/apps/debtverge/components/comms/comms-shared";
import {
  PIPELINE_BADGE, SFS_QUICK_ADJUST_FIELDS,
  getInitials, getAvatarColor,
} from "@/apps/debtverge/components/comms/comms-shared";

// ============================================================
// DebtorContextSidebar — Right Column (340px)
// Debtor Snapshot, SFS Quick-Adjust, One-Click Actions
// ============================================================

interface DebtorContextSidebarProps {
  item: QueueItem;
  onSfsUpdate: (caseId: string, newDI: number, expenses: Record<string, number>) => void;
  onStartVoipCall: (item: QueueItem) => void;
  onIssueBreather: (item: QueueItem) => void;
  onScheduleReview: (item: QueueItem) => void;
}

export function DebtorContextSidebar({
  item, onSfsUpdate, onStartVoipCall, onIssueBreather, onScheduleReview,
}: DebtorContextSidebarProps) {
  // ---- SFS Quick-Adjust local state ----
  const [income, setIncome] = useState(2150);
  const [expenses, setExpenses] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    for (const f of SFS_QUICK_ADJUST_FIELDS) init[f.id] = f.defaultAmount;
    return init;
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const totalEssentialExpenses = useMemo(
    () => Object.values(expenses).reduce((a, b) => a + b, 0),
    [expenses],
  );
  const calculatedDI = income - totalEssentialExpenses;

  function handleExpenseChange(id: string, value: number) {
    setExpenses((prev) => ({ ...prev, [id]: value }));
    setSaved(false);
  }

  async function handleRecalculate() {
    setSaving(true);
    setSaved(false);
    try {
      onSfsUpdate(item.caseId, calculatedDI, expenses);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="panel flex h-full w-full flex-col overflow-y-auto p-4 fade-in">
      {/* ---- Header ---- */}
      <div className="mb-3 flex items-center gap-2">
        <div className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold text-white ${getAvatarColor(item.debtorName)}`}>
          {getInitials(item.debtorName)}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-bold text-slate-800 dark:text-slate-100">{item.debtorName}</h3>
          <p className="text-[10px] text-slate-400">{item.caseNumber}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold ${PIPELINE_BADGE[item.planType]}`}>
          {item.planType}
        </span>
      </div>

      {/* ---- Contact Details ---- */}
      <div className="mb-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
        <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">Contact Details</p>
        <div className="space-y-1.5">
          {item.debtorEmail && (
            <div className="flex items-center gap-2 text-[11px]">
              <Mail className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              <span className="truncate text-slate-600 dark:text-slate-300">{item.debtorEmail}</span>
            </div>
          )}
          {item.debtorPhone && (
            <div className="flex items-center gap-2 text-[11px]">
              <Phone className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              <span className="text-slate-600 dark:text-slate-300">{item.debtorPhone}</span>
            </div>
          )}
          <div className="flex items-center gap-2 text-[11px]">
            <Home className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            <span className="text-slate-600 dark:text-slate-300">Household: {item.householdSize} {item.householdSize === 1 ? "person" : "people"}</span>
          </div>
        </div>
      </div>

      {/* ---- Key Financial Metrics ---- */}
      <div className="mb-3 grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-700 dark:bg-slate-800/50">
          <p className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide text-slate-400">
            <PoundSterling className="h-3 w-3" /> Total Debt
          </p>
          <p className="mt-0.5 text-sm font-bold text-rose-600 dark:text-rose-400">{formatCurrency(item.totalDebt, "GBP")}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-700 dark:bg-slate-800/50">
          <p className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide text-slate-400">
            <Wallet className="h-3 w-3" /> Disp. Income
          </p>
          <p className="mt-0.5 text-sm font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(item.monthlyDisposableIncome, "GBP")}/mo</p>
        </div>
      </div>

      {/* ---- SFS Quick-Adjust Widget ---- */}
      <div className="mb-3">
        <div className="mb-2 flex items-center gap-1.5">
          <Calculator className="h-3.5 w-3.5 text-blue-500" />
          <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">SFS Quick-Adjust</h4>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
          {/* Monthly income input */}
          <div className="mb-2.5">
            <label className="mb-1 block text-[10px] font-medium text-slate-500 dark:text-slate-400">Monthly Income</label>
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">£</span>
              <input
                type="number"
                value={income}
                onChange={(e) => { setIncome(Number(e.target.value) || 0); setSaved(false); }}
                className="input pl-6 text-xs"
              />
            </div>
          </div>

          {/* Core expense inputs */}
          <div className="space-y-2">
            {SFS_QUICK_ADJUST_FIELDS.map((field) => (
              <div key={field.id}>
                <label className="mb-1 block text-[10px] font-medium text-slate-500 dark:text-slate-400">{field.label}</label>
                <div className="relative">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">£</span>
                  <input
                    type="number"
                    value={expenses[field.id] ?? 0}
                    onChange={(e) => handleExpenseChange(field.id, Number(e.target.value) || 0)}
                    className="input pl-6 text-xs"
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Calculated DI preview */}
          <div className="mt-3 rounded-lg border border-slate-200 bg-white p-2.5 dark:border-slate-600 dark:bg-slate-800">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-slate-500 dark:text-slate-400">Essential Expenses</span>
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">{formatCurrency(totalEssentialExpenses, "GBP")}</span>
            </div>
            <div className="mt-1 flex items-center justify-between border-t border-slate-100 pt-1 dark:border-slate-700">
              <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">New Disp. Income</span>
              <span className={`text-sm font-bold ${calculatedDI >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                {formatCurrency(calculatedDI, "GBP")}/mo
              </span>
            </div>
          </div>

          {/* Recalculate button */}
          <button
            onClick={handleRecalculate}
            disabled={saving}
            className={`btn mt-3 w-full text-xs ${
              saved
                ? "bg-emerald-600 text-white"
                : "btn-primary bg-blue-600 hover:bg-blue-700"
            } disabled:opacity-50`}
          >
            {saved ? (
              <><Check className="h-3.5 w-3.5" /> DI Updated to {formatCurrency(calculatedDI, "GBP")}/mo</>
            ) : (
              <><RefreshCw className={`h-3.5 w-3.5 ${saving ? "animate-spin" : ""}`} /> {saving ? "Saving..." : "Recalculate Disposable Income"}</>
            )}
          </button>
        </div>
      </div>

      {/* ---- One-Click Actions ---- */}
      <div className="mb-3">
        <div className="mb-2 flex items-center gap-1.5">
          <TrendingDown className="h-3.5 w-3.5 text-slate-500" />
          <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Quick Actions</h4>
        </div>
        <div className="space-y-1.5">
          <ActionButton
            icon={<Phone className="h-4 w-4" />}
            label="Start VoIP Call"
            color="bg-blue-500"
            onClick={() => onStartVoipCall(item)}
          />
          <ActionButton
            icon={<RotateCcw className="h-4 w-4" />}
            label="Issue 30-Day Breather"
            color="bg-amber-500"
            onClick={() => onIssueBreather(item)}
          />
          <ActionButton
            icon={<CalendarClock className="h-4 w-4" />}
            label="Schedule Review Task"
            color="bg-violet-500"
            onClick={() => onScheduleReview(item)}
          />
        </div>
      </div>

      {/* ---- Vulnerability & Safeguarding ---- */}
      <div className="mb-3">
        <div className="mb-2 flex items-center gap-1.5">
          <ShieldAlert className="h-3.5 w-3.5 text-rose-500" />
          <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Safeguarding</h4>
        </div>
        <div className={`rounded-xl border p-3 ${
          item.hasVulnerability
            ? "border-rose-300 bg-rose-50 dark:border-rose-500/40 dark:bg-rose-500/10"
            : "border-slate-200 dark:border-slate-700"
        }`}>
          {item.hasVulnerability ? (
            <>
              <div className="flex items-center gap-1.5">
                <ShieldAlert className="h-4 w-4 text-rose-600 dark:text-rose-400" />
                <span className="text-xs font-bold text-rose-700 dark:text-rose-300">Vulnerability Flagged</span>
              </div>
              <p className="mt-1 text-[11px] text-rose-600 dark:text-rose-400">
                TEX/BSG markers active — apply enhanced forbearance procedures.
              </p>
            </>
          ) : (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              No active vulnerability flags on file.
            </p>
          )}
        </div>
      </div>

      {/* ---- Open Full Case File ---- */}
      <button className="btn btn-primary mt-auto bg-emerald-600 text-sm hover:bg-emerald-700">
        <ChevronRight className="h-4 w-4" />
        Open Full Case File
      </button>
    </div>
  );
}

// ============================================================
// Action Button helper
// ============================================================

function ActionButton({
  icon, label, color, onClick,
}: { icon: React.ReactNode; label: string; color: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-xl border border-slate-200 p-2.5 text-left transition-all hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:hover:border-slate-600 dark:hover:bg-slate-800/50"
    >
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${color} text-white`}>
        {icon}
      </span>
      <span className="flex-1 text-xs font-semibold text-slate-700 dark:text-slate-200">{label}</span>
      <ChevronRight className="h-4 w-4 text-slate-400" />
    </button>
  );
}
