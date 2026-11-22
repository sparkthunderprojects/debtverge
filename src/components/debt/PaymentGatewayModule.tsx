import { useState, useMemo } from "react";
import {
  CreditCard, Plus, Trash2, CheckCircle2, AlertCircle, XCircle,
  Settings, Shield, RefreshCw, Banknote, Repeat, Wallet,
  ChevronDown, ChevronUp, Plug, Link2, Link2Off, Clock,
  Calendar, Zap, TrendingUp, FileWarning, ArrowRight, Layers,
  Percent, Building2, Receipt, Scale, BadgeCheck,
} from "lucide-react";
import { formatCurrency, formatDateShort } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import { useOrganizations } from "@/lib/workspace-hooks";
import { useDebtCreditors, useDebtCases } from "@/lib/debt-hooks";
import {
  useGatewayConfigs, createGatewayConfig, updateGatewayConfig, deleteGatewayConfig, verifyGatewayConnection,
  useTokenisedPaymentMethods, savePaymentMethod, updatePaymentMethod, deletePaymentMethod,
  useRecurringSchedules, createRecurringSchedule, updateRecurringSchedule, deleteRecurringSchedule,
  useGatewayTransactions, recordGatewayTransaction, retryFailedTransaction,
  useDisbursementWaterfall, createDisbursementEntries, updateDisbursementStatus,
  useReconciliationLog, createReconciliationEntry,
  triggerDueCollections, triggerRetryFailed, detectExpiredCards,
} from "@/lib/payment-hooks";
import { getGatewayAdapter, calculateWaterfallAllocation } from "@/lib/gateway-adapters";
import type {
  PaymentGatewayConfig, TokenisedPaymentMethod, RecurringPaymentSchedule,
  GatewayPaymentTransaction, DisbursementWaterfallEntry, PaymentReconciliationLog,
  GatewayType, GatewayPaymentType, PaymentFrequency,
  GATEWAY_TYPE_META, GATEWAY_TX_STATUS_META, SCHEDULE_STATUS_META,
  DISBURSEMENT_CATEGORY_META, DISBURSEMENT_STATUS_META, RECONCILIATION_STATUS_META,
} from "@/lib/types";
import {
  GATEWAY_TYPE_META as GTM,
  GATEWAY_TX_STATUS_META as GTSM,
  SCHEDULE_STATUS_META as SSM,
  DISBURSEMENT_CATEGORY_META as DCM,
  DISBURSEMENT_STATUS_META as DSM,
  RECONCILIATION_STATUS_META as RSM,
} from "@/lib/types";
import { Modal, Field } from "@/components/projects/SharedUI";

type GatewaySubTab = "overview" | "configs" | "methods" | "schedules" | "collections" | "transactions" | "waterfall" | "reconciliation";

const SUB_TABS: { id: GatewaySubTab; label: string; icon: typeof Settings }[] = [
  { id: "overview", label: "Overview", icon: Layers },
  { id: "configs", label: "Gateway Setup", icon: Settings },
  { id: "methods", label: "Payment Methods", icon: CreditCard },
  { id: "schedules", label: "Recurring Schedules", icon: Repeat },
  { id: "collections", label: "Collections & Alerts", icon: AlertCircle },
  { id: "transactions", label: "Transactions", icon: Banknote },
  { id: "waterfall", label: "Disbursement Waterfall", icon: ArrowRight },
  { id: "reconciliation", label: "Reconciliation", icon: Shield },
];

export function PaymentGatewayModule({ caseId }: { caseId: string | null }) {
  const [subTab, setSubTab] = useState<GatewaySubTab>("overview");
  const { data: organizations } = useOrganizations();
  const orgId = organizations[0]?.id ?? null;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="panel p-4 fade-in">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg">
            <Wallet className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Payment & Disbursement Gateway</h3>
            <p className="text-xs text-slate-400">White-label payment processing, tokenised card storage, recurring schedules, and waterfall disbursement accounting</p>
          </div>
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-[10px] font-bold text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">PCI-DSS ADAPTER MODE</span>
        </div>
        {/* Sub-tab bar */}
        <div className="mt-3 flex gap-1.5 overflow-x-auto">
          {SUB_TABS.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => setSubTab(t.id)}
                className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-all ${
                  subTab === t.id
                    ? "bg-emerald-600 text-white shadow-sm"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
                }`}
              >
                <Icon className="h-3.5 w-3.5" /> {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {!orgId ? (
        <div className="panel p-8 text-center">
          <AlertCircle className="mx-auto mb-3 h-8 w-8 text-amber-500" />
          <p className="text-sm text-slate-500">No organization found. Please ensure you are a member of an organization.</p>
        </div>
      ) : subTab === "overview" ? (
        <OverviewTab orgId={orgId} caseId={caseId} />
      ) : subTab === "configs" ? (
        <GatewayConfigsTab orgId={orgId} />
      ) : subTab === "methods" ? (
        <PaymentMethodsTab orgId={orgId} caseId={caseId} />
      ) : subTab === "schedules" ? (
        <RecurringSchedulesTab orgId={orgId} caseId={caseId} />
      ) : subTab === "collections" ? (
        <CollectionsAlertsTab orgId={orgId} caseId={caseId} />
      ) : subTab === "transactions" ? (
        <TransactionsTab orgId={orgId} caseId={caseId} />
      ) : subTab === "waterfall" ? (
        <DisbursementWaterfallTab orgId={orgId} caseId={caseId} />
      ) : subTab === "reconciliation" ? (
        <ReconciliationTab orgId={orgId} caseId={caseId} />
      ) : null}
    </div>
  );
}

// ============================================================
// Overview Tab
// ============================================================

function OverviewTab({ orgId, caseId }: { orgId: string; caseId: string | null }) {
  const { data: configs } = useGatewayConfigs(orgId);
  const { data: methods } = useTokenisedPaymentMethods(caseId);
  const { data: schedules } = useRecurringSchedules(caseId);
  const { data: transactions } = useGatewayTransactions(caseId);
  const { data: waterfall } = useDisbursementWaterfall(caseId);
  const { data: reconciliation } = useReconciliationLog(caseId);

  const activeConfigs = configs.filter((c) => c.is_active);
  const activeSchedules = schedules.filter((s) => s.status === "active");
  const succeededTxns = transactions.filter((t) => t.status === "succeeded");
  const failedTxns = transactions.filter((t) => t.status === "failed" || t.status === "retrying");
  const totalCollected = succeededTxns.reduce((s, t) => s + t.amount, 0);
  const settledDisbursements = waterfall.filter((d) => d.status === "settled");
  const totalDisbursed = settledDisbursements.reduce((s, d) => s + d.allocated_amount, 0);
  const failedReconciliations = reconciliation.filter((r) => r.status === "failed" || r.status === "shortfall");

  const kpis = [
    { label: "Active Gateways", value: String(activeConfigs.length), icon: Plug, color: "text-blue-600 bg-blue-50 dark:bg-blue-500/10" },
    { label: "Saved Cards", value: String(methods.length), icon: CreditCard, color: "text-violet-600 bg-violet-50 dark:bg-violet-500/10" },
    { label: "Active Schedules", value: String(activeSchedules.length), icon: Repeat, color: "text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10" },
    { label: "Total Collected", value: formatCurrency(totalCollected), icon: Banknote, color: "text-teal-600 bg-teal-50 dark:bg-teal-500/10" },
    { label: "Total Disbursed", value: formatCurrency(totalDisbursed), icon: ArrowRight, color: "text-cyan-600 bg-cyan-50 dark:bg-cyan-500/10" },
    { label: "Failed/Retrying", value: String(failedTxns.length), icon: AlertCircle, color: "text-rose-600 bg-rose-50 dark:bg-rose-500/10" },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {kpis.map((k) => {
          const Icon = k.icon;
          return (
            <div key={k.label} className="panel p-4 fade-in">
              <div className="flex items-center gap-2">
                <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${k.color}`}>
                  <Icon className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase text-slate-400">{k.label}</p>
                  <p className="text-lg font-bold text-slate-700 dark:text-slate-200">{k.value}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* PCI-DSS Security Notice */}
      <div className="panel border-2 border-emerald-200 p-4 dark:border-emerald-500/30 fade-in">
        <div className="flex items-start gap-3">
          <Shield className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <div>
            <p className="text-sm font-bold text-slate-800 dark:text-slate-100">PCI-DSS Compliance Boundary</p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              All card data is tokenised at the gateway level. Raw PAN and CVV are never stored in the database.
              API keys are stored as edge function secret references, not plaintext. Each tenant organization
              configures their own gateway credentials independently.
            </p>
          </div>
        </div>
      </div>

      {/* Recent Failed Transactions */}
      {failedTxns.length > 0 && (
        <div className="panel p-4 fade-in">
          <div className="mb-3 flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-rose-500" />
            <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100">Failed & Retrying Transactions</h4>
          </div>
          <div className="space-y-2">
            {failedTxns.slice(0, 5).map((txn) => (
              <div key={txn.id} className="flex items-center gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                <FileWarning className="h-4 w-4 shrink-0 text-rose-500" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-700 dark:text-slate-300">{formatCurrency(txn.amount)}</p>
                  <p className="text-[10px] text-slate-400">{txn.failure_reason ?? "Unknown failure"}</p>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${GTSM[txn.status].color}`}>
                  {GTSM[txn.status].label.toUpperCase()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Reconciliation Alerts */}
      {failedReconciliations.length > 0 && (
        <div className="panel p-4 fade-in">
          <div className="mb-3 flex items-center gap-2">
            <Shield className="h-4 w-4 text-amber-500" />
            <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100">Reconciliation Exceptions</h4>
          </div>
          <div className="space-y-2">
            {failedReconciliations.slice(0, 5).map((rec) => (
              <div key={rec.id} className="flex items-center gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                <Clock className="h-4 w-4 shrink-0 text-amber-500" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-700 dark:text-slate-300">
                    Variance: {formatCurrency(rec.variance)}
                  </p>
                  <p className="text-[10px] text-slate-400">Expected {formatCurrency(rec.expected_amount)} · Received {formatCurrency(rec.actual_amount)}</p>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${RSM[rec.status].color}`}>
                  {RSM[rec.status].label.toUpperCase()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Gateway Configs Tab — White-Label Setup
// ============================================================

function GatewayConfigsTab({ orgId }: { orgId: string }) {
  const { data: configs, loading, error, reload } = useGatewayConfigs(orgId);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<PaymentGatewayConfig | null>(null);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [verifyResult, setVerifyResult] = useState<Record<string, { connected: boolean; message: string }>>({});
  const [actionError, setActionError] = useState<string | null>(null);

  const handleDelete = async (id: string) => {
    if (!confirm("Remove this gateway configuration?")) return;
    try {
      await deleteGatewayConfig(id);
      reload();
    } catch (e) { setActionError((e as Error).message); }
  };

  const handleVerify = async (config: PaymentGatewayConfig) => {
    setVerifying(config.id);
    setActionError(null);
    try {
      const result = await verifyGatewayConnection(config);
      setVerifyResult((prev) => ({ ...prev, [config.id]: result }));
    } catch (e) {
      setVerifyResult((prev) => ({ ...prev, [config.id]: { connected: false, message: (e as Error).message } }));
    }
    setVerifying(null);
  };

  if (loading) return <div className="skeleton h-40 rounded-xl" />;
  if (error) return <div className="panel p-4 text-sm text-rose-600">{error}</div>;

  return (
    <div className="space-y-4">
      {actionError && <div className="rounded-xl bg-rose-50 px-4 py-2 text-sm text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">{actionError}</div>}

      <div className="panel flex items-center justify-between p-4 fade-in">
        <div>
          <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100">Gateway Configurations</h4>
          <p className="text-xs text-slate-400">Configure your own payment processor credentials. API keys are stored as secret references, never plaintext.</p>
        </div>
        <button onClick={() => { setEditing(null); setShowForm(true); }} className="btn btn-primary bg-emerald-600 text-sm hover:bg-emerald-700">
          <Plus className="h-4 w-4" /> Add Gateway
        </button>
      </div>

      {configs.length === 0 ? (
        <div className="panel p-8 text-center">
          <Plug className="mx-auto mb-3 h-8 w-8 text-slate-300 dark:text-slate-600" />
          <p className="text-sm text-slate-500">No gateway configurations yet. Add a gateway to start processing payments.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {configs.map((config) => (
            <div key={config.id} className="panel p-4 fade-in">
              <div className="flex flex-wrap items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800">
                  {config.gateway_type === "stripe" ? <CreditCard className="h-5 w-5 text-violet-600" /> :
                   config.gateway_type === "gocardless" ? <Building2 className="h-5 w-5 text-blue-600" /> :
                   <Plug className="h-5 w-5 text-slate-500" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{config.display_name}</p>
                    <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${GTM[config.gateway_type].color}`}>
                      {GTM[config.gateway_type].label.toUpperCase()}
                    </span>
                    {config.test_mode && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-bold text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">TEST MODE</span>}
                    {config.is_active ? <BadgeCheck className="h-4 w-4 text-emerald-500" /> : <XCircle className="h-4 w-4 text-slate-400" />}
                  </div>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    Merchant ID: {config.merchant_id || "—"} · Secret Ref: <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">{config.secret_ref}</code>
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {config.supported_features.map((f) => (
                      <span key={f} className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">{f}</span>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {verifyResult[config.id] && (
                    <span className={`flex items-center gap-1 text-[10px] font-bold ${verifyResult[config.id].connected ? "text-emerald-600" : "text-rose-600"}`}>
                      {verifyResult[config.id].connected ? <Link2 className="h-3 w-3" /> : <Link2Off className="h-3 w-3" />}
                      {verifyResult[config.id].message}
                    </span>
                  )}
                  <button onClick={() => handleVerify(config)} disabled={verifying === config.id} className="btn btn-secondary text-xs">
                    {verifying === config.id ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                    Verify
                  </button>
                  <button onClick={() => { setEditing(config); setShowForm(true); }} className="btn btn-secondary text-xs">
                    <Settings className="h-3.5 w-3.5" /> Edit
                  </button>
                  <button onClick={() => handleDelete(config.id)} className="btn text-xs text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <GatewayConfigForm
          orgId={orgId}
          editing={editing}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={() => { setShowForm(false); setEditing(null); reload(); }}
        />
      )}
    </div>
  );
}

function GatewayConfigForm({ orgId, editing, onClose, onSaved }: {
  orgId: string;
  editing: PaymentGatewayConfig | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [gatewayType, setGatewayType] = useState<GatewayType>(editing?.gateway_type ?? "stripe");
  const [displayName, setDisplayName] = useState(editing?.display_name ?? "");
  const [merchantId, setMerchantId] = useState(editing?.merchant_id ?? "");
  const [secretRef, setSecretRef] = useState(editing?.secret_ref ?? "");
  const [webhookSecretRef, setWebhookSecretRef] = useState(editing?.webhook_secret_ref ?? "");
  const [testMode, setTestMode] = useState(editing?.test_mode ?? true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName || !secretRef) return;
    setSaving(true); setErr(null);
    try {
      if (editing) {
        await updateGatewayConfig(editing.id, { display_name: displayName, merchant_id: merchantId, secret_ref: secretRef, webhook_secret_ref: webhookSecretRef, test_mode: testMode });
      } else {
        await createGatewayConfig({ organization_id: orgId, gateway_type: gatewayType, display_name: displayName, merchant_id: merchantId, secret_ref: secretRef, webhook_secret_ref: webhookSecretRef, test_mode: testMode });
      }
      onSaved();
    } catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  };

  return (
    <Modal title={editing ? "Edit Gateway Configuration" : "Add Gateway Configuration"} onClose={onClose}>
      <form onSubmit={handleSave} className="space-y-3">
        {err && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">{err}</div>}
        {!editing && (
          <Field label="Gateway Type">
            <select value={gatewayType} onChange={(e) => setGatewayType(e.target.value as GatewayType)} className="input text-sm">
              <option value="stripe">Stripe</option>
              <option value="gocardless">GoCardless (Direct Debit)</option>
              <option value="open_banking">Open Banking</option>
              <option value="merchant_acquirer">Merchant Acquirer</option>
              <option value="custom">Custom Gateway</option>
            </select>
          </Field>
        )}
        <Field label="Display Name"><input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="input text-sm" placeholder="My Stripe Account" required autoFocus /></Field>
        <Field label="Merchant ID (optional)"><input value={merchantId} onChange={(e) => setMerchantId(e.target.value)} className="input text-sm" placeholder="acct_12345" /></Field>
        <Field label="Secret Reference Name">
          <input value={secretRef} onChange={(e) => setSecretRef(e.target.value)} className="input text-sm font-mono" placeholder="STRIPE_SECRET_KEY_ORG_123" required />
          <p className="mt-1 text-[10px] text-slate-400">The name of the secure setting that holds your API key. The key itself is stored encrypted outside the database and is never shown here.</p>
        </Field>
        <Field label="Webhook Secret Reference (optional)">
          <input value={webhookSecretRef} onChange={(e) => setWebhookSecretRef(e.target.value)} className="input text-sm font-mono" placeholder="STRIPE_WEBHOOK_SECRET_ORG_123" />
        </Field>
        <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
          <input type="checkbox" checked={testMode} onChange={(e) => setTestMode(e.target.checked)} className="rounded" />
          Test Mode (sandbox)
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn btn-secondary text-sm">Cancel</button>
          <button type="submit" disabled={saving} className="btn btn-primary bg-emerald-600 text-sm hover:bg-emerald-700">{saving ? "Saving..." : "Save Gateway"}</button>
        </div>
      </form>
    </Modal>
  );
}

// ============================================================
// Payment Methods Tab — Tokenised Card Storage
// ============================================================

function PaymentMethodsTab({ orgId, caseId }: { orgId: string; caseId: string | null }) {
  const { data: methods, loading, error, reload } = useTokenisedPaymentMethods(caseId);
  const { data: configs } = useGatewayConfigs(orgId);
  const { data: cases } = useDebtCases();
  const [showForm, setShowForm] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const handleDelete = async (id: string) => {
    if (!confirm("Remove this payment method? The token will be revoked at the gateway.")) return;
    try {
      await deletePaymentMethod(id);
      reload();
      setActionSuccess("Payment method removed");
      setTimeout(() => setActionSuccess(null), 3000);
    } catch (e) { setActionError((e as Error).message); }
  };

  const handleSetDefault = async (id: string) => {
    try {
      await updatePaymentMethod(id, { is_default: true });
      reload();
    } catch (e) { setActionError((e as Error).message); }
  };

  if (!caseId) return <div className="panel p-8 text-center text-sm text-slate-400">Select a case to manage payment methods</div>;
  if (loading) return <div className="skeleton h-40 rounded-xl" />;
  if (error) return <div className="panel p-4 text-sm text-rose-600">{error}</div>;

  return (
    <div className="space-y-4">
      {actionError && <div className="rounded-xl bg-rose-50 px-4 py-2 text-sm text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">{actionError}</div>}
      {actionSuccess && <div className="rounded-xl bg-emerald-50 px-4 py-2 text-sm text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">{actionSuccess}</div>}

      <div className="panel flex items-center justify-between p-4 fade-in">
        <div>
          <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100">Tokenised Payment Methods</h4>
          <p className="text-xs text-slate-400">Cards are tokenised at the gateway level. No raw card data is stored.</p>
        </div>
        <button onClick={() => setShowForm(true)} disabled={configs.length === 0} className="btn btn-primary bg-emerald-600 text-sm hover:bg-emerald-700 disabled:opacity-50">
          <Plus className="h-4 w-4" /> Add Card
        </button>
      </div>

      {configs.length === 0 && (
        <div className="panel border-2 border-amber-200 p-4 dark:border-amber-500/30">
          <p className="text-xs text-amber-700 dark:text-amber-300">Configure a payment gateway first before adding payment methods.</p>
        </div>
      )}

      {methods.length === 0 ? (
        <div className="panel p-8 text-center">
          <CreditCard className="mx-auto mb-3 h-8 w-8 text-slate-300 dark:text-slate-600" />
          <p className="text-sm text-slate-500">No payment methods on file. Add a card to enable recurring payments.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {methods.map((pm) => (
            <div key={pm.id} className="panel p-4 fade-in">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800">
                  {pm.payment_type === "card" ? <CreditCard className="h-5 w-5 text-slate-600 dark:text-slate-400" /> : <Building2 className="h-5 w-5 text-slate-600 dark:text-slate-400" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold text-slate-800 dark:text-slate-100">
                      {pm.card_brand ? pm.card_brand.toUpperCase() : pm.payment_type.toUpperCase()} •••• {pm.last4}
                    </p>
                    {pm.is_default && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-bold text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">DEFAULT</span>}
                  </div>
                  <p className="text-[11px] text-slate-400">
                    {pm.cardholder_name} · Exp {pm.expiry_month}/{pm.expiry_year}
                  </p>
                  <p className="text-[10px] text-slate-400">Token: <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">{pm.gateway_token.slice(0, 16)}...</code></p>
                </div>
                <div className="flex flex-col gap-1">
                  {!pm.is_default && <button onClick={() => handleSetDefault(pm.id)} className="btn btn-secondary text-[10px] px-2 py-1">Set Default</button>}
                  <button onClick={() => handleDelete(pm.id)} className="btn text-[10px] px-2 py-1 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10">
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <AddCardModal orgId={orgId} caseId={caseId} configs={configs} onClose={() => setShowForm(false)} onSaved={() => { setShowForm(false); reload(); }} />
      )}
    </div>
  );
}

function AddCardModal({ orgId, caseId, configs, onClose, onSaved }: {
  orgId: string;
  caseId: string;
  configs: PaymentGatewayConfig[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [gatewayConfigId, setGatewayConfigId] = useState(configs[0]?.id ?? "");
  const [cardholderName, setCardholderName] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [expiryMonth, setExpiryMonth] = useState("");
  const [expiryYear, setExpiryYear] = useState("");
  const [cvc, setCvc] = useState("");
  const [billingPostcode, setBillingPostcode] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!gatewayConfigId || !cardholderName || !cardNumber || !expiryMonth || !expiryYear || !cvc) return;
    setSaving(true); setErr(null);
    try {
      const config = configs.find((c) => c.id === gatewayConfigId);
      if (!config) throw new Error("Gateway not found");
      const adapter = getGatewayAdapter(config.gateway_type);
      if (!adapter) throw new Error("No adapter for this gateway type");

      const result = await adapter.tokeniseCard(
        { cardholderName, cardNumber, expiryMonth: parseInt(expiryMonth), expiryYear: parseInt(expiryYear), cvc, billingPostcode },
        { apiKey: "", merchantId: config.merchant_id || undefined, testMode: config.test_mode },
      );

      await savePaymentMethod({
        organization_id: orgId,
        case_id: caseId,
        gateway_config_id: gatewayConfigId,
        gateway_token: result.gatewayToken,
        payment_type: "card",
        card_brand: result.cardBrand,
        last4: result.last4,
        expiry_month: result.expiryMonth,
        expiry_year: result.expiryYear,
        cardholder_name: cardholderName,
        is_default: true,
      });

      onSaved();
    } catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  };

  return (
    <Modal title="Add Payment Method (Tokenised)" onClose={onClose}>
      <form onSubmit={handleSave} className="space-y-3">
        {err && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">{err}</div>}
        <div className="rounded-lg bg-emerald-50 px-3 py-2 text-[11px] text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
          <Shield className="mr-1 inline h-3 w-3" />
          Card details are sent directly to the payment gateway for tokenisation. They are never stored in our database.
        </div>
        <Field label="Gateway">
          <select value={gatewayConfigId} onChange={(e) => setGatewayConfigId(e.target.value)} className="input text-sm" required>
            {configs.filter((c) => c.is_active).map((c) => (
              <option key={c.id} value={c.id}>{c.display_name} ({GTM[c.gateway_type].label})</option>
            ))}
          </select>
        </Field>
        <Field label="Cardholder Name"><input value={cardholderName} onChange={(e) => setCardholderName(e.target.value)} className="input text-sm" placeholder="John Smith" required autoFocus /></Field>
        <Field label="Card Number"><input value={cardNumber} onChange={(e) => setCardNumber(e.target.value)} className="input text-sm font-mono" placeholder="4242 4242 4242 4242" required maxLength={19} /></Field>
        <div className="grid grid-cols-3 gap-2">
          <Field label="Expiry Month"><input type="number" value={expiryMonth} onChange={(e) => setExpiryMonth(e.target.value)} className="input text-sm" placeholder="12" min={1} max={12} required /></Field>
          <Field label="Expiry Year"><input type="number" value={expiryYear} onChange={(e) => setExpiryYear(e.target.value)} className="input text-sm" placeholder="28" min={25} max={99} required /></Field>
          <Field label="CVC"><input type="password" value={cvc} onChange={(e) => setCvc(e.target.value)} className="input text-sm" placeholder="123" required maxLength={4} /></Field>
        </div>
        <Field label="Billing Postcode (optional)"><input value={billingPostcode} onChange={(e) => setBillingPostcode(e.target.value)} className="input text-sm" placeholder="SW1A 1AA" /></Field>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn btn-secondary text-sm">Cancel</button>
          <button type="submit" disabled={saving} className="btn btn-primary bg-emerald-600 text-sm hover:bg-emerald-700">{saving ? "Tokenising..." : "Tokenise & Save"}</button>
        </div>
      </form>
    </Modal>
  );
}

// ============================================================
// Recurring Schedules Tab
// ============================================================

function RecurringSchedulesTab({ orgId, caseId }: { orgId: string; caseId: string | null }) {
  const { data: schedules, loading, error, reload } = useRecurringSchedules(caseId);
  const { data: methods } = useTokenisedPaymentMethods(caseId);
  const { data: configs } = useGatewayConfigs(orgId);
  const { data: cases } = useDebtCases();
  const [showForm, setShowForm] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const handleStatusChange = async (id: string, status: RecurringPaymentSchedule["status"]) => {
    try {
      await updateRecurringSchedule(id, { status });
      reload();
    } catch (e) { setActionError((e as Error).message); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this recurring schedule?")) return;
    try {
      await deleteRecurringSchedule(id);
      reload();
    } catch (e) { setActionError((e as Error).message); }
  };

  if (!caseId) return <div className="panel p-8 text-center text-sm text-slate-400">Select a case to manage recurring schedules</div>;
  if (loading) return <div className="skeleton h-40 rounded-xl" />;
  if (error) return <div className="panel p-4 text-sm text-rose-600">{error}</div>;

  const selectedCase = cases.find((c) => c.id === caseId);

  return (
    <div className="space-y-4">
      {actionError && <div className="rounded-xl bg-rose-50 px-4 py-2 text-sm text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">{actionError}</div>}

      <div className="panel flex items-center justify-between p-4 fade-in">
        <div>
          <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100">Recurring Payment Schedules</h4>
          <p className="text-xs text-slate-400">Automated card collections linked to payment plans or SFS budget frequency</p>
        </div>
        <button onClick={() => setShowForm(true)} disabled={methods.length === 0} className="btn btn-primary bg-emerald-600 text-sm hover:bg-emerald-700 disabled:opacity-50">
          <Plus className="h-4 w-4" /> New Schedule
        </button>
      </div>

      {methods.length === 0 && (
        <div className="panel border-2 border-amber-200 p-4 dark:border-amber-500/30">
          <p className="text-xs text-amber-700 dark:text-amber-300">Add a tokenised payment method first before creating a recurring schedule.</p>
        </div>
      )}

      {schedules.length === 0 ? (
        <div className="panel p-8 text-center">
          <Repeat className="mx-auto mb-3 h-8 w-8 text-slate-300 dark:text-slate-600" />
          <p className="text-sm text-slate-500">No recurring schedules set up. Create one to automate collections.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {schedules.map((schedule) => {
            const pm = methods.find((m) => m.id === schedule.payment_method_id);
            const config = configs.find((c) => c.id === schedule.gateway_config_id);
            return (
              <div key={schedule.id} className="panel p-4 fade-in">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 dark:bg-emerald-500/10">
                    <Repeat className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-bold text-slate-800 dark:text-slate-100">
                        {formatCurrency(schedule.installment_amount)} / {schedule.frequency}
                      </p>
                      <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${SSM[schedule.status].color}`}>
                        {SSM[schedule.status].label.toUpperCase()}
                      </span>
                      {schedule.linked_plan_type && (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-bold text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                          {schedule.linked_plan_type.toUpperCase()}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      {pm ? `${pm.card_brand?.toUpperCase()} •••• ${pm.last4}` : "No payment method"} ·
                      Next: {formatDateShort(schedule.next_collection_date)} ·
                      Retries: {schedule.retry_count}/{schedule.max_retries}
                    </p>
                    {config && <p className="text-[10px] text-slate-400">Gateway: {config.display_name}</p>}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {schedule.status === "active" && (
                      <button onClick={() => handleStatusChange(schedule.id, "paused")} className="btn btn-secondary text-[10px] px-2 py-1">Pause</button>
                    )}
                    {schedule.status === "paused" && (
                      <button onClick={() => handleStatusChange(schedule.id, "active")} className="btn btn-secondary text-[10px] px-2 py-1">Resume</button>
                    )}
                    <button onClick={() => handleDelete(schedule.id)} className="btn text-[10px] px-2 py-1 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showForm && (
        <ScheduleFormModal
          orgId={orgId}
          caseId={caseId}
          methods={methods}
          configs={configs}
          suggestedAmount={selectedCase?.installment_amount ?? selectedCase?.monthly_disposable_income ?? 0}
          suggestedFrequency={selectedCase?.payment_frequency ?? "monthly"}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); reload(); }}
        />
      )}
    </div>
  );
}

function ScheduleFormModal({ orgId, caseId, methods, configs, suggestedAmount, suggestedFrequency, onClose, onSaved }: {
  orgId: string;
  caseId: string;
  methods: TokenisedPaymentMethod[];
  configs: PaymentGatewayConfig[];
  suggestedAmount: number;
  suggestedFrequency: PaymentFrequency;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [paymentMethodId, setPaymentMethodId] = useState(methods[0]?.id ?? "");
  const [frequency, setFrequency] = useState<PaymentFrequency>(suggestedFrequency);
  const [installmentAmount, setInstallmentAmount] = useState(String(suggestedAmount || ""));
  const [preferredPaymentDay, setPreferredPaymentDay] = useState("1");
  const [linkedPlanType, setLinkedPlanType] = useState<"dmp" | "iva" | "sfs" | "settlement">("dmp");
  const [maxRetries, setMaxRetries] = useState("3");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentMethodId || !installmentAmount) return;
    setSaving(true); setErr(null);
    try {
      const pm = methods.find((m) => m.id === paymentMethodId);
      await createRecurringSchedule({
        organization_id: orgId,
        case_id: caseId,
        payment_method_id: paymentMethodId,
        gateway_config_id: pm?.gateway_config_id,
        frequency,
        installment_amount: parseFloat(installmentAmount),
        preferred_payment_day: preferredPaymentDay,
        max_retries: parseInt(maxRetries),
        linked_plan_type: linkedPlanType,
      });
      onSaved();
    } catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  };

  return (
    <Modal title="Create Recurring Payment Schedule" onClose={onClose}>
      <form onSubmit={handleSave} className="space-y-3">
        {err && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">{err}</div>}
        <Field label="Payment Method">
          <select value={paymentMethodId} onChange={(e) => setPaymentMethodId(e.target.value)} className="input text-sm" required>
            {methods.map((m) => (
              <option key={m.id} value={m.id}>{m.card_brand?.toUpperCase()} •••• {m.last4} ({m.cardholder_name})</option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Frequency">
            <select value={frequency} onChange={(e) => setFrequency(e.target.value as PaymentFrequency)} className="input text-sm" required>
              <option value="weekly">Weekly</option>
              <option value="fortnightly">Fortnightly</option>
              <option value="four_weekly">Four-Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </Field>
          <Field label="Installment Amount (£)">
            <input type="number" step="0.01" value={installmentAmount} onChange={(e) => setInstallmentAmount(e.target.value)} className="input text-sm" placeholder="250.00" required autoFocus />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Preferred Payment Day">
            <input value={preferredPaymentDay} onChange={(e) => setPreferredPaymentDay(e.target.value)} className="input text-sm" placeholder="1 or last_working_day" />
          </Field>
          <Field label="Max Retries">
            <input type="number" value={maxRetries} onChange={(e) => setMaxRetries(e.target.value)} className="input text-sm" min={1} max={10} />
          </Field>
        </div>
        <Field label="Linked Plan Type">
          <select value={linkedPlanType} onChange={(e) => setLinkedPlanType(e.target.value as "dmp" | "iva" | "sfs" | "settlement")} className="input text-sm">
            <option value="dmp">DMP</option>
            <option value="iva">IVA</option>
            <option value="sfs">SFS Budget</option>
            <option value="settlement">Settlement</option>
          </select>
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn btn-secondary text-sm">Cancel</button>
          <button type="submit" disabled={saving} className="btn btn-primary bg-emerald-600 text-sm hover:bg-emerald-700">{saving ? "Creating..." : "Create Schedule"}</button>
        </div>
      </form>
    </Modal>
  );
}

// ============================================================
// Transactions Tab
// ============================================================

// ============================================================
// Collections & Alerts Tab — Failed collection retry workflow
// ============================================================

function CollectionsAlertsTab({ orgId, caseId }: { orgId: string; caseId: string | null }) {
  const { data: schedules, reload: reloadSchedules } = useRecurringSchedules(caseId);
  const { data: transactions, reload: reloadTxns } = useGatewayTransactions(caseId);
  const { data: methods } = useTokenisedPaymentMethods(caseId);
  const { data: reconciliation, reload: reloadRecon } = useReconciliationLog(caseId);
  const [triggering, setTriggering] = useState<string | null>(null);
  const [triggerResult, setTriggerResult] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);

  const failedTxns = transactions.filter((t) => t.status === "failed" || t.status === "retrying");
  const suspendedSchedules = schedules.filter((s) => s.status === "suspended");
  const shortfalls = reconciliation.filter((r) => r.status === "shortfall" || r.status === "failed");

  const now = new Date();
  const currentYear = now.getFullYear() % 100;
  const currentMonth = now.getMonth() + 1;
  const expiringCards = methods.filter((m) => {
    if (!m.expiry_month || !m.expiry_year) return false;
    const monthsLeft = (m.expiry_year - currentYear) * 12 + (m.expiry_month - currentMonth);
    return monthsLeft >= 0 && monthsLeft <= 2;
  });
  const expiredCards = methods.filter((m) => {
    if (!m.expiry_month || !m.expiry_year) return false;
    return m.expiry_year < currentYear || (m.expiry_year === currentYear && m.expiry_month < currentMonth);
  });

  const handleTriggerDue = async () => {
    setTriggering("due");
    setActionError(null);
    try {
      const result = await triggerDueCollections();
      setTriggerResult(`Processed ${result.processed} schedules: ${result.succeeded} succeeded, ${result.failed} failed, ${result.retrying} retrying`);
      reloadSchedules(); reloadTxns(); reloadRecon();
      setTimeout(() => setTriggerResult(null), 5000);
    } catch (e) { setActionError((e as Error).message); }
    setTriggering(null);
  };

  const handleTriggerRetry = async () => {
    setTriggering("retry");
    setActionError(null);
    try {
      const result = await triggerRetryFailed();
      setTriggerResult(`Retried ${result.retried} transactions: ${result.succeeded} succeeded, ${result.still_retrying} still retrying, ${result.permanently_failed} permanently failed`);
      reloadSchedules(); reloadTxns(); reloadRecon();
      setTimeout(() => setTriggerResult(null), 5000);
    } catch (e) { setActionError((e as Error).message); }
    setTriggering(null);
  };

  const handleDetectExpired = async () => {
    setTriggering("detect");
    setActionError(null);
    try {
      const result = await detectExpiredCards();
      setTriggerResult(`Checked ${result.checked} payment methods: ${result.expired} expired cards found, ${result.schedules_suspended} schedules suspended`);
      reloadSchedules();
      setTimeout(() => setTriggerResult(null), 5000);
    } catch (e) { setActionError((e as Error).message); }
    setTriggering(null);
  };

  const handleRetryTxn = async (txnId: string) => {
    setRetrying(txnId);
    setActionError(null);
    try {
      await retryFailedTransaction(txnId);
      reloadTxns();
      setTriggerResult("Retry transaction queued");
      setTimeout(() => setTriggerResult(null), 3000);
    } catch (e) { setActionError((e as Error).message); }
    setRetrying(null);
  };

  const handleResumeSchedule = async (scheduleId: string) => {
    setActionError(null);
    try {
      await updateRecurringSchedule(scheduleId, { status: "active", retry_count: 0 });
      reloadSchedules();
    } catch (e) { setActionError((e as Error).message); }
  };

  if (!caseId) return <div className="panel p-8 text-center text-sm text-slate-400">Select a case to view collections and alerts</div>;

  const alertCount = failedTxns.length + suspendedSchedules.length + expiredCards.length + expiringCards.length;

  return (
    <div className="space-y-4">
      {actionError && <div className="rounded-xl bg-rose-50 px-4 py-2 text-sm text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">{actionError}</div>}
      {triggerResult && <div className="rounded-xl bg-emerald-50 px-4 py-2 text-sm text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">{triggerResult}</div>}

      {/* Action bar */}
      <div className="panel p-4 fade-in">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100">Automated Collection Engine</h4>
            <p className="text-xs text-slate-400">Trigger recurring collections, retry failed payments, and detect expired card tokens</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={handleTriggerDue} disabled={triggering === "due"} className="btn btn-primary bg-emerald-600 text-sm hover:bg-emerald-700 disabled:opacity-50">
              {triggering === "due" ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
              Process Due
            </button>
            <button onClick={handleTriggerRetry} disabled={triggering === "retry"} className="btn btn-secondary text-sm disabled:opacity-50">
              {triggering === "retry" ? <RefreshCw className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Retry Failed
            </button>
            <button onClick={handleDetectExpired} disabled={triggering === "detect"} className="btn btn-secondary text-sm disabled:opacity-50">
              {triggering === "detect" ? <RefreshCw className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
              Detect Expired Cards
            </button>
          </div>
        </div>
      </div>

      {/* Alert summary */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className={`panel p-4 fade-in ${failedTxns.length > 0 ? "border-rose-200 dark:border-rose-500/30" : ""}`}>
          <div className="flex items-center gap-2">
            <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${failedTxns.length > 0 ? "bg-rose-50 text-rose-600 dark:bg-rose-500/10" : "bg-slate-100 text-slate-400 dark:bg-slate-800"}`}>
              <AlertCircle className="h-4 w-4" />
            </div>
            <div><p className="text-[10px] font-bold uppercase text-slate-400">Failed/Retrying</p><p className="text-lg font-bold text-slate-700 dark:text-slate-200">{failedTxns.length}</p></div>
          </div>
        </div>
        <div className={`panel p-4 fade-in ${suspendedSchedules.length > 0 ? "border-orange-200 dark:border-orange-500/30" : ""}`}>
          <div className="flex items-center gap-2">
            <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${suspendedSchedules.length > 0 ? "bg-orange-50 text-orange-600 dark:bg-orange-500/10" : "bg-slate-100 text-slate-400 dark:bg-slate-800"}`}>
              <Clock className="h-4 w-4" />
            </div>
            <div><p className="text-[10px] font-bold uppercase text-slate-400">Suspended Schedules</p><p className="text-lg font-bold text-slate-700 dark:text-slate-200">{suspendedSchedules.length}</p></div>
          </div>
        </div>
        <div className={`panel p-4 fade-in ${expiredCards.length > 0 ? "border-rose-200 dark:border-rose-500/30" : ""}`}>
          <div className="flex items-center gap-2">
            <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${expiredCards.length > 0 ? "bg-rose-50 text-rose-600 dark:bg-rose-500/10" : "bg-slate-100 text-slate-400 dark:bg-slate-800"}`}>
              <XCircle className="h-4 w-4" />
            </div>
            <div><p className="text-[10px] font-bold uppercase text-slate-400">Expired Cards</p><p className="text-lg font-bold text-slate-700 dark:text-slate-200">{expiredCards.length}</p></div>
          </div>
        </div>
        <div className={`panel p-4 fade-in ${expiringCards.length > 0 ? "border-amber-200 dark:border-amber-500/30" : ""}`}>
          <div className="flex items-center gap-2">
            <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${expiringCards.length > 0 ? "bg-amber-50 text-amber-600 dark:bg-amber-500/10" : "bg-slate-100 text-slate-400 dark:bg-slate-800"}`}>
              <Calendar className="h-4 w-4" />
            </div>
            <div><p className="text-[10px] font-bold uppercase text-slate-400">Expiring Soon</p><p className="text-lg font-bold text-slate-700 dark:text-slate-200">{expiringCards.length}</p></div>
          </div>
        </div>
      </div>

      {/* Expired & Expiring Cards */}
      {(expiredCards.length > 0 || expiringCards.length > 0) && (
        <div className="panel p-4 fade-in">
          <div className="mb-3 flex items-center gap-2">
            <CreditCard className="h-4 w-4 text-rose-500" />
            <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100">Card Token Expiry Alerts</h4>
          </div>
          <div className="space-y-2">
            {expiredCards.map((pm) => (
              <div key={pm.id} className="flex items-center gap-3 rounded-lg border border-rose-200 bg-rose-50/50 p-3 dark:border-rose-500/30 dark:bg-rose-500/10">
                <XCircle className="h-4 w-4 shrink-0 text-rose-500" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{pm.card_brand?.toUpperCase()} •••• {pm.last4}</p>
                  <p className="text-[10px] text-rose-600 dark:text-rose-400">EXPIRED {String(pm.expiry_month).padStart(2, "0")}/{pm.expiry_year} — Update card details required</p>
                </div>
              </div>
            ))}
            {expiringCards.map((pm) => (
              <div key={pm.id} className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50/50 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
                <Calendar className="h-4 w-4 shrink-0 text-amber-500" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{pm.card_brand?.toUpperCase()} •••• {pm.last4}</p>
                  <p className="text-[10px] text-amber-600 dark:text-amber-400">EXPIRING SOON — {String(pm.expiry_month).padStart(2, "0")}/{pm.expiry_year} — Contact debtor to update</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Failed Transactions with Retry */}
      {failedTxns.length > 0 && (
        <div className="panel p-4 fade-in">
          <div className="mb-3 flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-rose-500" />
            <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100">Failed Collection Queue</h4>
          </div>
          <div className="space-y-2">
            {failedTxns.map((txn) => {
              const schedule = schedules.find((s) => s.id === txn.schedule_id);
              return (
                <div key={txn.id} className="flex items-center gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                  <FileWarning className="h-4 w-4 shrink-0 text-rose-500" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{formatCurrency(txn.amount)}</p>
                    <p className="text-[10px] text-slate-400">
                      {txn.failure_reason ?? "Unknown failure"} ·
                      {schedule ? ` Retry ${schedule.retry_count}/${schedule.max_retries}` : ""}
                    </p>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${GTSM[txn.status].color}`}>
                    {GTSM[txn.status].label.toUpperCase()}
                  </span>
                  <button onClick={() => handleRetryTxn(txn.id)} disabled={retrying === txn.id} className="btn btn-secondary text-[10px] px-2 py-1">
                    {retrying === txn.id ? <RefreshCw className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                    Retry Now
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Suspended Schedules */}
      {suspendedSchedules.length > 0 && (
        <div className="panel p-4 fade-in">
          <div className="mb-3 flex items-center gap-2">
            <Clock className="h-4 w-4 text-orange-500" />
            <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100">Suspended Schedules</h4>
          </div>
          <div className="space-y-2">
            {suspendedSchedules.map((schedule) => {
              const pm = methods.find((m) => m.id === schedule.payment_method_id);
              return (
                <div key={schedule.id} className="flex items-center gap-3 rounded-lg border border-orange-200 bg-orange-50/50 p-3 dark:border-orange-500/30 dark:bg-orange-500/10">
                  <Clock className="h-4 w-4 shrink-0 text-orange-500" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{formatCurrency(schedule.installment_amount)} / {schedule.frequency}</p>
                    <p className="text-[10px] text-slate-400">
                      {pm ? `${pm.card_brand?.toUpperCase()} •••• ${pm.last4}` : "No card"} ·
                      Retries exhausted ({schedule.retry_count}/{schedule.max_retries})
                    </p>
                  </div>
                  <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[9px] font-bold text-orange-700 dark:bg-orange-500/20 dark:text-orange-300">SUSPENDED</span>
                  <button onClick={() => handleResumeSchedule(schedule.id)} className="btn btn-secondary text-[10px] px-2 py-1">
                    <CheckCircle2 className="h-3 w-3" /> Resume
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Reconciliation Shortfalls */}
      {shortfalls.length > 0 && (
        <div className="panel p-4 fade-in">
          <div className="mb-3 flex items-center gap-2">
            <Shield className="h-4 w-4 text-amber-500" />
            <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100">Collection Shortfalls</h4>
          </div>
          <div className="space-y-2">
            {shortfalls.slice(0, 10).map((rec) => (
              <div key={rec.id} className="flex items-center gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                <FileWarning className="h-4 w-4 shrink-0 text-amber-500" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Shortfall: {formatCurrency(Math.abs(rec.variance))}</p>
                  <p className="text-[10px] text-slate-400">Expected {formatCurrency(rec.expected_amount)} · Received {formatCurrency(rec.actual_amount)} · {rec.failure_code ?? "—"}</p>
                </div>
                {rec.retry_scheduled && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[9px] font-bold text-blue-700 dark:bg-blue-500/20 dark:text-blue-300">RETRY SCHEDULED</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {alertCount === 0 && (
        <div className="panel p-8 text-center">
          <CheckCircle2 className="mx-auto mb-3 h-8 w-8 text-emerald-500" />
          <p className="text-sm text-slate-500">No alerts. All collections are up to date and no cards are expired or expiring.</p>
        </div>
      )}
    </div>
  );
}

function TransactionsTab({ orgId, caseId }: { orgId: string; caseId: string | null }) {
  const { data: transactions, loading, error, reload } = useGatewayTransactions(caseId);
  const [actionError, setActionError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);

  const handleRetry = async (txnId: string) => {
    setRetrying(txnId);
    setActionError(null);
    try {
      await retryFailedTransaction(txnId);
      reload();
    } catch (e) { setActionError((e as Error).message); }
    setRetrying(null);
  };

  if (!caseId) return <div className="panel p-8 text-center text-sm text-slate-400">Select a case to view transactions</div>;
  if (loading) return <div className="skeleton h-40 rounded-xl" />;
  if (error) return <div className="panel p-4 text-sm text-rose-600">{error}</div>;

  const totalSucceeded = transactions.filter((t) => t.status === "succeeded").reduce((s, t) => s + t.amount, 0);
  const totalFailed = transactions.filter((t) => t.status === "failed").reduce((s, t) => s + t.amount, 0);

  return (
    <div className="space-y-4">
      {actionError && <div className="rounded-xl bg-rose-50 px-4 py-2 text-sm text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">{actionError}</div>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="panel p-3 fade-in"><p className="text-[10px] font-bold uppercase text-slate-400">Total Transactions</p><p className="text-lg font-bold text-slate-700 dark:text-slate-200">{transactions.length}</p></div>
        <div className="panel p-3 fade-in"><p className="text-[10px] font-bold uppercase text-slate-400">Total Collected</p><p className="text-lg font-bold text-emerald-600">{formatCurrency(totalSucceeded)}</p></div>
        <div className="panel p-3 fade-in"><p className="text-[10px] font-bold uppercase text-slate-400">Failed Amount</p><p className="text-lg font-bold text-rose-600">{formatCurrency(totalFailed)}</p></div>
        <div className="panel p-3 fade-in"><p className="text-[10px] font-bold uppercase text-slate-400">Retrying</p><p className="text-lg font-bold text-blue-600">{transactions.filter((t) => t.status === "retrying").length}</p></div>
      </div>

      {transactions.length === 0 ? (
        <div className="panel p-8 text-center">
          <Banknote className="mx-auto mb-3 h-8 w-8 text-slate-300 dark:text-slate-600" />
          <p className="text-sm text-slate-500">No gateway transactions yet. Transactions appear here when recurring schedules process payments.</p>
        </div>
      ) : (
        <div className="panel overflow-x-auto p-0 fade-in">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50">
              <tr>
                <th className="px-3 py-2 text-left text-[10px] font-bold uppercase text-slate-400">Date</th>
                <th className="px-3 py-2 text-left text-[10px] font-bold uppercase text-slate-400">Amount</th>
                <th className="px-3 py-2 text-left text-[10px] font-bold uppercase text-slate-400">Status</th>
                <th className="px-3 py-2 text-left text-[10px] font-bold uppercase text-slate-400">Gateway Ref</th>
                <th className="px-3 py-2 text-left text-[10px] font-bold uppercase text-slate-400">Failure Reason</th>
                <th className="px-3 py-2 text-right text-[10px] font-bold uppercase text-slate-400">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
              {transactions.map((txn) => (
                <tr key={txn.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                  <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400">{formatDateShort(txn.attempted_at)}</td>
                  <td className="px-3 py-2 font-bold text-slate-700 dark:text-slate-300">{formatCurrency(txn.amount)}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${GTSM[txn.status].color}`}>
                      {GTSM[txn.status].label.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-[10px] font-mono text-slate-400">{txn.gateway_transaction_id?.slice(0, 20) ?? "—"}</td>
                  <td className="px-3 py-2 text-xs text-rose-600 dark:text-rose-400">{txn.failure_reason ?? "—"}</td>
                  <td className="px-3 py-2 text-right">
                    {(txn.status === "failed" || txn.status === "retrying") && (
                      <button onClick={() => handleRetry(txn.id)} disabled={retrying === txn.id} className="btn btn-secondary text-[10px] px-2 py-1">
                        {retrying === txn.id ? <RefreshCw className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                        Retry
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Disbursement Waterfall Tab
// ============================================================

function DisbursementWaterfallTab({ orgId, caseId }: { orgId: string; caseId: string | null }) {
  const { data: waterfall, loading, error, reload } = useDisbursementWaterfall(caseId);
  const { data: transactions } = useGatewayTransactions(caseId);
  const { data: creditors } = useDebtCreditors(caseId);
  const { data: cases } = useDebtCases();
  const { data: reconciliation } = useReconciliationLog(caseId);
  const [showForm, setShowForm] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [expandedTxn, setExpandedTxn] = useState<string | null>(null);

  const handleSettle = async (id: string) => {
    try {
      await updateDisbursementStatus(id, { status: "settled" });
      reload();
    } catch (e) { setActionError((e as Error).message); }
  };

  const handleFail = async (id: string) => {
    try {
      await updateDisbursementStatus(id, { status: "failed" });
      reload();
    } catch (e) { setActionError((e as Error).message); }
  };

  if (!caseId) return <div className="panel p-8 text-center text-sm text-slate-400">Select a case to manage disbursements</div>;
  if (loading) return <div className="skeleton h-40 rounded-xl" />;
  if (error) return <div className="panel p-4 text-sm text-rose-600">{error}</div>;

  const succeededTxns = transactions.filter((t) => t.status === "succeeded");
  const unallocatedTxns = succeededTxns.filter((t) => !waterfall.some((w) => w.source_transaction_id === t.id));
  const totalCollected = succeededTxns.reduce((s, t) => s + t.amount, 0);
  const totalAllocated = waterfall.reduce((s, d) => s + d.allocated_amount, 0);
  const totalSettled = waterfall.filter((d) => d.status === "settled").reduce((s, d) => s + d.allocated_amount, 0);
  const totalPending = waterfall.filter((d) => d.status === "scheduled").reduce((s, d) => s + d.allocated_amount, 0);
  const totalFailed = waterfall.filter((d) => d.status === "failed").reduce((s, d) => s + d.allocated_amount, 0);

  // Category breakdown
  const categoryTotals = waterfall.reduce((acc, entry) => {
    const key = entry.category;
    if (!acc[key]) acc[key] = { total: 0, settled: 0, pending: 0, count: 0 };
    acc[key].total += entry.allocated_amount;
    if (entry.status === "settled") acc[key].settled += entry.allocated_amount;
    if (entry.status === "scheduled") acc[key].pending += entry.allocated_amount;
    acc[key].count += 1;
    return acc;
  }, {} as Record<string, { total: number; settled: number; pending: number; count: number }>);

  const categoryOrder: DisbursementWaterfallEntry["category"][] = ["nominee_fee", "supervisor_fee", "nominee_cost", "third_party_disbursement", "creditor_dividend", "reserve"];

  // Group waterfall entries by source transaction
  const waterfallByTxn = waterfall.reduce((acc, entry) => {
    const key = entry.source_transaction_id ?? "manual";
    if (!acc[key]) acc[key] = [];
    acc[key].push(entry);
    return acc;
  }, {} as Record<string, DisbursementWaterfallEntry[]>);

  return (
    <div className="space-y-4">
      {actionError && <div className="rounded-xl bg-rose-50 px-4 py-2 text-sm text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">{actionError}</div>}

      <div className="panel flex items-center justify-between p-4 fade-in">
        <div>
          <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100">Disbursement & Creditor Waterfall Ledger</h4>
          <p className="text-xs text-slate-400">Incoming client funds, statutory fee deductions, nominee costs, and pro-rata creditor dividend disbursements</p>
        </div>
        <button onClick={() => setShowForm(true)} disabled={unallocatedTxns.length === 0} className="btn btn-primary bg-emerald-600 text-sm hover:bg-emerald-700 disabled:opacity-50">
          <Plus className="h-4 w-4" /> Create Waterfall
        </button>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <div className="panel p-3 fade-in"><p className="text-[10px] font-bold uppercase text-slate-400">Total Collected</p><p className="text-lg font-bold text-emerald-600">{formatCurrency(totalCollected)}</p></div>
        <div className="panel p-3 fade-in"><p className="text-[10px] font-bold uppercase text-slate-400">Total Allocated</p><p className="text-lg font-bold text-blue-600">{formatCurrency(totalAllocated)}</p></div>
        <div className="panel p-3 fade-in"><p className="text-[10px] font-bold uppercase text-slate-400">Settled</p><p className="text-lg font-bold text-emerald-600">{formatCurrency(totalSettled)}</p></div>
        <div className="panel p-3 fade-in"><p className="text-[10px] font-bold uppercase text-slate-400">Pending</p><p className="text-lg font-bold text-amber-600">{formatCurrency(totalPending)}</p></div>
        <div className="panel p-3 fade-in"><p className="text-[10px] font-bold uppercase text-slate-400">Failed</p><p className="text-lg font-bold text-rose-600">{formatCurrency(totalFailed)}</p></div>
      </div>

      {/* Category breakdown */}
      {Object.keys(categoryTotals).length > 0 && (
        <div className="panel p-4 fade-in">
          <div className="mb-3 flex items-center gap-2">
            <Receipt className="h-4 w-4 text-slate-500" />
            <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100">Distribution Breakdown by Category</h4>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {categoryOrder.filter((cat) => categoryTotals[cat]).map((cat) => {
              const stats = categoryTotals[cat];
              const settledPct = stats.total > 0 ? Math.round((stats.settled / stats.total) * 100) : 0;
              return (
                <div key={cat} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                  <div className="flex items-center justify-between">
                    <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${DCM[cat].color}`}>{DCM[cat].label.toUpperCase()}</span>
                    <span className="text-[10px] text-slate-400">{stats.count} entries</span>
                  </div>
                  <p className="mt-1.5 text-lg font-bold text-slate-700 dark:text-slate-200">{formatCurrency(stats.total)}</p>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
                    <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${settledPct}%` }} />
                  </div>
                  <p className="mt-1 text-[10px] text-slate-400">{settledPct}% settled · {formatCurrency(stats.pending)} pending</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Incoming funds — unallocated succeeded transactions */}
      {unallocatedTxns.length > 0 && (
        <div className="panel p-4 fade-in">
          <div className="mb-3 flex items-center gap-2">
            <Banknote className="h-4 w-4 text-emerald-500" />
            <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100">Incoming Client Funds (Awaiting Distribution)</h4>
          </div>
          <div className="space-y-2">
            {unallocatedTxns.map((txn) => (
              <div key={txn.id} className="flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 dark:border-emerald-500/30 dark:bg-emerald-500/10">
                <Banknote className="h-4 w-4 shrink-0 text-emerald-500" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-slate-700 dark:text-slate-300">{formatCurrency(txn.amount)}</p>
                  <p className="text-[10px] text-slate-400">Received {formatDateShort(txn.settled_at ?? txn.attempted_at)} · Ref: {txn.gateway_transaction_id?.slice(0, 20) ?? "—"}</p>
                </div>
                <button onClick={() => setShowForm(true)} className="btn btn-primary bg-emerald-600 text-xs hover:bg-emerald-700">
                  <ArrowRight className="h-3.5 w-3.5" /> Distribute
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Waterfall entries grouped by source transaction */}
      {waterfall.length === 0 && unallocatedTxns.length === 0 ? (
        <div className="panel p-8 text-center">
          <ArrowRight className="mx-auto mb-3 h-8 w-8 text-slate-300 dark:text-slate-600" />
          <p className="text-sm text-slate-500">No disbursement entries yet. Incoming client payments will appear here for distribution.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {Object.entries(waterfallByTxn).map(([txnId, entries]) => {
            const sourceTxn = succeededTxns.find((t) => t.id === txnId);
            const txnTotal = entries.reduce((s, e) => s + e.allocated_amount, 0);
            const txnSettled = entries.filter((e) => e.status === "settled").reduce((s, e) => s + e.allocated_amount, 0);
            const isExpanded = expandedTxn === txnId;
            return (
              <div key={txnId} className="panel p-3 fade-in">
                {/* Transaction header */}
                <button
                  onClick={() => setExpandedTxn(isExpanded ? null : txnId)}
                  className="flex w-full items-center gap-3 rounded-lg p-1 text-left hover:bg-slate-50 dark:hover:bg-slate-800/30"
                >
                  {isExpanded ? <ChevronUp className="h-4 w-4 shrink-0 text-slate-400" /> : <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />}
                  <Banknote className="h-4 w-4 shrink-0 text-emerald-500" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-slate-700 dark:text-slate-300">{formatCurrency(sourceTxn?.amount ?? txnTotal)} collected</p>
                    <p className="text-[10px] text-slate-400">
                      {entries.length} disbursement lines · {formatCurrency(txnSettled)} settled · {formatCurrency(txnTotal - txnSettled)} pending
                    </p>
                  </div>
                  <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
                    <div className="h-full rounded-full bg-emerald-500" style={{ width: `${txnTotal > 0 ? (txnSettled / txnTotal) * 100 : 0}%` }} />
                  </div>
                </button>
                {/* Expanded entries */}
                {isExpanded && (
                  <div className="mt-2 space-y-1.5 border-t border-slate-100 pt-2 dark:border-slate-700/50">
                    {entries.map((entry) => (
                      <div key={entry.id} className="flex items-center gap-3 rounded-lg border border-slate-200 p-2.5 dark:border-slate-700">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-[10px] font-bold text-slate-500 dark:bg-slate-800">
                          {entry.waterfall_order}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className={`rounded-full px-2 py-0.5 text-[8px] font-bold ${DCM[entry.category].color}`}>
                              {DCM[entry.category].label.toUpperCase()}
                            </span>
                            <p className="truncate text-xs font-medium text-slate-700 dark:text-slate-300">{entry.payee_name}</p>
                          </div>
                          <p className="text-[10px] text-slate-400">
                            {formatCurrency(entry.allocated_amount)} · {entry.payee_reference || "No ref"}
                            {entry.settled_date && ` · Settled ${formatDateShort(entry.settled_date)}`}
                          </p>
                        </div>
                        <span className={`rounded-full px-2 py-0.5 text-[8px] font-bold ${DSM[entry.status].color}`}>
                          {DSM[entry.status].label.toUpperCase()}
                        </span>
                        {entry.status === "scheduled" && (
                          <div className="flex gap-1">
                            <button onClick={() => handleSettle(entry.id)} className="btn btn-secondary text-[9px] px-1.5 py-0.5">
                              <CheckCircle2 className="h-3 w-3" />
                            </button>
                            <button onClick={() => handleFail(entry.id)} className="btn text-[9px] px-1.5 py-0.5 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10">
                              <XCircle className="h-3 w-3" />
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Reconciliation summary integrated into waterfall view */}
      {reconciliation.length > 0 && (
        <div className="panel p-4 fade-in">
          <div className="mb-3 flex items-center gap-2">
            <Shield className="h-4 w-4 text-blue-500" />
            <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100">Reconciliation Tracking</h4>
          </div>
          <div className="mb-3 grid grid-cols-3 gap-2">
            <div className="rounded-lg bg-emerald-50 p-2 text-center dark:bg-emerald-500/10">
              <p className="text-[9px] font-bold uppercase text-emerald-600 dark:text-emerald-400">Matched</p>
              <p className="text-base font-bold text-emerald-700 dark:text-emerald-300">{reconciliation.filter((r) => r.status === "matched").length}</p>
            </div>
            <div className="rounded-lg bg-amber-50 p-2 text-center dark:bg-amber-500/10">
              <p className="text-[9px] font-bold uppercase text-amber-600 dark:text-amber-400">Exceptions</p>
              <p className="text-base font-bold text-amber-700 dark:text-amber-300">{reconciliation.filter((r) => r.status !== "matched").length}</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-2 text-center dark:bg-slate-800/50">
              <p className="text-[9px] font-bold uppercase text-slate-500">Net Variance</p>
              <p className={`text-base font-bold ${reconciliation.reduce((s, r) => s + r.variance, 0) < 0 ? "text-rose-600" : "text-slate-600"}`}>
                {formatCurrency(reconciliation.reduce((s, r) => s + r.variance, 0))}
              </p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <th className="px-2 py-1.5 text-left text-[9px] font-bold uppercase text-slate-400">Date</th>
                  <th className="px-2 py-1.5 text-left text-[9px] font-bold uppercase text-slate-400">Expected</th>
                  <th className="px-2 py-1.5 text-left text-[9px] font-bold uppercase text-slate-400">Actual</th>
                  <th className="px-2 py-1.5 text-left text-[9px] font-bold uppercase text-slate-400">Variance</th>
                  <th className="px-2 py-1.5 text-left text-[9px] font-bold uppercase text-slate-400">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                {reconciliation.slice(0, 8).map((rec) => (
                  <tr key={rec.id}>
                    <td className="px-2 py-1.5 text-[10px] text-slate-500">{formatDateShort(rec.reconciliation_date)}</td>
                    <td className="px-2 py-1.5 text-[10px] font-medium text-slate-600 dark:text-slate-400">{formatCurrency(rec.expected_amount)}</td>
                    <td className="px-2 py-1.5 text-[10px] font-medium text-slate-600 dark:text-slate-400">{formatCurrency(rec.actual_amount)}</td>
                    <td className={`px-2 py-1.5 text-[10px] font-bold ${rec.variance < 0 ? "text-rose-600" : rec.variance > 0 ? "text-amber-600" : "text-slate-400"}`}>
                      {rec.variance !== 0 ? formatCurrency(rec.variance) : "—"}
                    </td>
                    <td className="px-2 py-1.5">
                      <span className={`rounded-full px-1.5 py-0.5 text-[8px] font-bold ${RSM[rec.status].color}`}>{RSM[rec.status].label.toUpperCase()}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showForm && (
        <WaterfallFormModal
          orgId={orgId}
          caseId={caseId}
          availableTxns={unallocatedTxns}
          creditors={creditors}
          ipDetails={null}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); reload(); }}
        />
      )}
    </div>
  );
}

function WaterfallFormModal({ orgId, caseId, availableTxns, creditors, ipDetails, onClose, onSaved }: {
  orgId: string;
  caseId: string;
  availableTxns: GatewayPaymentTransaction[];
  creditors: { id: string; creditor_name: string; current_balance: number }[];
  ipDetails: { nominee_fee_percent?: number; supervisor_fee_percent?: number } | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [sourceTxnId, setSourceTxnId] = useState(availableTxns[0]?.id ?? "");
  const [nomineeFeePct, setNomineeFeePct] = useState(String(ipDetails?.nominee_fee_percent ?? 5));
  const [supervisorFeePct, setSupervisorFeePct] = useState(String(ipDetails?.supervisor_fee_percent ?? 3));
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const selectedTxn = availableTxns.find((t) => t.id === sourceTxnId);
  const totalCollected = selectedTxn?.amount ?? 0;

  const preview = useMemo(() => {
    if (totalCollected <= 0) return null;
    return calculateWaterfallAllocation({
      totalCollected,
      nomineeFeePercent: parseFloat(nomineeFeePct) || 0,
      supervisorFeePercent: parseFloat(supervisorFeePct) || 0,
      nomineeCosts: [],
      thirdPartyDisbursements: [],
      creditorClaims: creditors.map((c) => ({ creditorId: c.id, creditorName: c.creditor_name, admittedDebt: c.current_balance })),
    });
  }, [totalCollected, nomineeFeePct, supervisorFeePct, creditors]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sourceTxnId || !preview) return;
    setCreating(true); setErr(null);
    try {
      await createDisbursementEntries(caseId, orgId, sourceTxnId, preview.entries.map((e) => ({
        category: e.category as DisbursementWaterfallEntry["category"],
        payeeName: e.payeeName,
        payeeReference: e.payeeReference,
        allocatedAmount: e.allocatedAmount,
        creditorId: e.creditorId,
      })));
      onSaved();
    } catch (e) { setErr((e as Error).message); } finally { setCreating(false); }
  };

  return (
    <Modal title="Create Disbursement Waterfall" onClose={onClose}>
      <form onSubmit={handleCreate} className="space-y-3">
        {err && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">{err}</div>}
        <Field label="Source Transaction (Collected Funds)">
          <select value={sourceTxnId} onChange={(e) => setSourceTxnId(e.target.value)} className="input text-sm" required>
            {availableTxns.map((t) => (
              <option key={t.id} value={t.id}>{formatCurrency(t.amount)} — {formatDateShort(t.attempted_at)}</option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Nominee Fee %">
            <input type="number" step="0.1" value={nomineeFeePct} onChange={(e) => setNomineeFeePct(e.target.value)} className="input text-sm" />
          </Field>
          <Field label="Supervisor Fee %">
            <input type="number" step="0.1" value={supervisorFeePct} onChange={(e) => setSupervisorFeePct(e.target.value)} className="input text-sm" />
          </Field>
        </div>
        {preview && (
          <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
            <p className="mb-2 text-xs font-bold text-slate-600 dark:text-slate-300">Waterfall Preview ({formatCurrency(totalCollected)})</p>
            <div className="space-y-1.5">
              {preview.entries.map((e, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5">
                    <span className="flex h-5 w-5 items-center justify-center rounded bg-slate-100 text-[9px] font-bold text-slate-500 dark:bg-slate-800">{i + 1}</span>
                    <span className="text-slate-600 dark:text-slate-400">{e.payeeName}</span>
                  </div>
                  <span className="font-bold text-slate-700 dark:text-slate-300">{formatCurrency(e.allocatedAmount)}</span>
                </div>
              ))}
              <div className="mt-2 border-t border-slate-200 pt-1.5 dark:border-slate-700">
                <div className="flex justify-between text-xs font-bold">
                  <span className="text-slate-600 dark:text-slate-400">Total Allocated</span>
                  <span className="text-blue-600">{formatCurrency(preview.totalAllocated)}</span>
                </div>
                {preview.remainingReserve > 0 && (
                  <div className="flex justify-between text-[10px]">
                    <span className="text-slate-400">Remaining Reserve</span>
                    <span className="text-amber-600">{formatCurrency(preview.remainingReserve)}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn btn-secondary text-sm">Cancel</button>
          <button type="submit" disabled={creating || !preview} className="btn btn-primary bg-emerald-600 text-sm hover:bg-emerald-700">{creating ? "Creating..." : "Create Waterfall"}</button>
        </div>
      </form>
    </Modal>
  );
}

// ============================================================
// Reconciliation Tab
// ============================================================

function ReconciliationTab({ orgId, caseId }: { orgId: string; caseId: string | null }) {
  const { data: reconciliation, loading, error, reload } = useReconciliationLog(caseId);
  const { data: transactions } = useGatewayTransactions(caseId);
  const [actionError, setActionError] = useState<string | null>(null);

  if (!caseId) return <div className="panel p-8 text-center text-sm text-slate-400">Select a case to view reconciliation</div>;
  if (loading) return <div className="skeleton h-40 rounded-xl" />;
  if (error) return <div className="panel p-4 text-sm text-rose-600">{error}</div>;

  const matched = reconciliation.filter((r) => r.status === "matched").length;
  const exceptions = reconciliation.filter((r) => r.status !== "matched");
  const totalVariance = reconciliation.reduce((s, r) => s + r.variance, 0);

  return (
    <div className="space-y-4">
      {actionError && <div className="rounded-xl bg-rose-50 px-4 py-2 text-sm text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">{actionError}</div>}

      <div className="grid grid-cols-3 gap-3">
        <div className="panel p-3 fade-in"><p className="text-[10px] font-bold uppercase text-slate-400">Matched</p><p className="text-lg font-bold text-emerald-600">{matched}</p></div>
        <div className="panel p-3 fade-in"><p className="text-[10px] font-bold uppercase text-slate-400">Exceptions</p><p className="text-lg font-bold text-rose-600">{exceptions.length}</p></div>
        <div className="panel p-3 fade-in"><p className="text-[10px] font-bold uppercase text-slate-400">Total Variance</p><p className={`text-lg font-bold ${totalVariance < 0 ? "text-rose-600" : "text-amber-600"}`}>{formatCurrency(totalVariance)}</p></div>
      </div>

      {reconciliation.length === 0 ? (
        <div className="panel p-8 text-center">
          <Shield className="mx-auto mb-3 h-8 w-8 text-slate-300 dark:text-slate-600" />
          <p className="text-sm text-slate-500">No reconciliation entries yet. Reconciliation records are created when payments are matched against expected amounts.</p>
        </div>
      ) : (
        <div className="panel overflow-x-auto p-0 fade-in">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50">
              <tr>
                <th className="px-3 py-2 text-left text-[10px] font-bold uppercase text-slate-400">Date</th>
                <th className="px-3 py-2 text-left text-[10px] font-bold uppercase text-slate-400">Expected</th>
                <th className="px-3 py-2 text-left text-[10px] font-bold uppercase text-slate-400">Actual</th>
                <th className="px-3 py-2 text-left text-[10px] font-bold uppercase text-slate-400">Variance</th>
                <th className="px-3 py-2 text-left text-[10px] font-bold uppercase text-slate-400">Status</th>
                <th className="px-3 py-2 text-left text-[10px] font-bold uppercase text-slate-400">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
              {reconciliation.map((rec) => (
                <tr key={rec.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                  <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400">{formatDateShort(rec.reconciliation_date)}</td>
                  <td className="px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-300">{formatCurrency(rec.expected_amount)}</td>
                  <td className="px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-300">{formatCurrency(rec.actual_amount)}</td>
                  <td className={`px-3 py-2 text-xs font-bold ${rec.variance < 0 ? "text-rose-600" : rec.variance > 0 ? "text-amber-600" : "text-slate-400"}`}>
                    {rec.variance !== 0 ? formatCurrency(rec.variance) : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${RSM[rec.status].color}`}>
                      {RSM[rec.status].label.toUpperCase()}
                    </span>
                    {rec.retry_scheduled && <span className="ml-1 rounded-full bg-blue-100 px-1.5 py-0.5 text-[8px] font-bold text-blue-700 dark:bg-blue-500/20 dark:text-blue-300">RETRY</span>}
                  </td>
                  <td className="px-3 py-2 text-[10px] text-slate-400">{rec.failure_code ?? rec.notes ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
