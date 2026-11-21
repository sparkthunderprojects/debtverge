import { useState, useMemo, useRef } from "react";
import {
  Banknote, Upload, FileSpreadsheet, RefreshCw, Plus, Trash2, CheckCircle2,
  XCircle, AlertCircle, Shield, Clock, Zap, Layers, ArrowRight, Receipt,
  Building2, Link2, Link2Off, Eye, EyeOff, Lock, Unlock, Download,
  Play, RotateCw, Send, MessageSquare, Mail, TrendingUp, FileWarning,
  ChevronDown, ChevronUp, Settings, Wallet, Scale, BadgeCheck,
  ListChecks, FileDown, ArrowLeftRight, CreditCard, Cpu,
} from "lucide-react";
import { formatCurrency, formatDateShort } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import { useOrganizations } from "@/lib/workspace-hooks";
import {
  useBankFeeds, createBankFeed, deleteBankFeed, importBankTransactions,
  useBankTransactions, matchBankTransaction, ignoreBankTransaction, autoMatchBankTransactions,
  useBatchRuns, useBatchItems, createBatchRun, executeBatchRun, retryBatchRun,
  executeBatchRunAsync, generateDisbursementFileAsync, autoMatchBankTransactionsAsync,
  useAuditLogs, logAuditAction,
  useLedgerLocks, createLedgerLock, unlockLedger,
  useDisbursementRuns, useDisbursementRunItems, createDisbursementRun,
  approveDisbursementRun, generateDisbursementFile, submitDisbursementRun,
  usePaymentLinks, sendPaymentLink,
} from "@/lib/cashier-hooks";
import {
  useGatewayTransactions, useRecurringSchedules, useTokenisedPaymentMethods,
  useDisbursementWaterfall,
} from "@/lib/payment-hooks";
import type {
  BankFeed, BankTransaction, BatchPaymentRun, BatchPaymentItem,
  CashierAuditLog, LedgerLock, DisbursementRun, DisbursementRunItem,
  PaymentLinkInvitation,
  BankFeedType, BankFeedFrequency, BatchRunType, DisbursementOutputFormat,
  DisbursementRunStatus, PaymentLinkChannel,
} from "@/lib/types";
import {
  BANK_FEED_TYPE_META, BANK_TXN_MATCH_META, BATCH_RUN_STATUS_META,
  BATCH_ITEM_STATUS_META, AUDIT_ACTION_META, DISB_RUN_STATUS_META,
  DISB_OUTPUT_FORMAT_META, PAYMENT_LINK_STATUS_META,
  GATEWAY_TX_STATUS_META, SCHEDULE_STATUS_META, DISBURSEMENT_CATEGORY_META,
  DISBURSEMENT_STATUS_META,
} from "@/lib/types";
import { Modal, Field } from "@/components/projects/SharedUI";
import { QueueMonitorDashboard } from "@/components/debt/QueueMonitorDashboard";

type CashierSubTab = "bank_feeds" | "batch_processing" | "exceptions" | "disbursement_runs" | "audit_trail" | "queue_monitor";

const SUB_TABS: { id: CashierSubTab; label: string; icon: typeof Shield }[] = [
  { id: "bank_feeds", label: "Bank Feeds & Reconciliation", icon: Building2 },
  { id: "batch_processing", label: "Batch Processing", icon: Layers },
  { id: "exceptions", label: "Exception & Bounced Queues", icon: AlertCircle },
  { id: "disbursement_runs", label: "Disbursement Runs", icon: ArrowLeftRight },
  { id: "audit_trail", label: "Audit Trail & Ledger Locks", icon: Shield },
  { id: "queue_monitor", label: "Queue Monitor", icon: Cpu },
];

export function CashierOperationsModule({ caseId }: { caseId: string | null }) {
  const [subTab, setSubTab] = useState<CashierSubTab>("bank_feeds");
  const { data: orgs } = useOrganizations();
  const orgId = orgs[0]?.id ?? null;

  return (
    <div className="space-y-4">
      <div className="panel p-4 fade-in">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-cyan-600 text-white shadow-lg">
            <Wallet className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Cashier Operations Suite</h3>
            <p className="text-xs text-slate-400">Bank feed reconciliation, batch collections, exception triage, disbursement runs, and audit trail with ledger locking</p>
          </div>
          <span className="rounded-full bg-blue-100 px-3 py-1 text-[10px] font-bold text-blue-700 dark:bg-blue-500/20 dark:text-blue-300">CASHIER MODE</span>
        </div>
        <div className="mt-3 flex gap-1.5 overflow-x-auto">
          {SUB_TABS.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => setSubTab(t.id)}
                className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-all ${
                  subTab === t.id
                    ? "bg-blue-600 text-white shadow-sm"
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
      ) : subTab === "bank_feeds" ? (
        <BankFeedsTab orgId={orgId} />
      ) : subTab === "batch_processing" ? (
        <BatchProcessingTab orgId={orgId} />
      ) : subTab === "exceptions" ? (
        <ExceptionsTab orgId={orgId} caseId={caseId} />
      ) : subTab === "disbursement_runs" ? (
        <DisbursementRunsTab orgId={orgId} caseId={caseId} />
      ) : subTab === "audit_trail" ? (
        <AuditTrailTab orgId={orgId} caseId={caseId} />
      ) : subTab === "queue_monitor" ? (
        <QueueMonitorDashboard />
      ) : null}
    </div>
  );
}

// ============================================================
// Bank Feeds & Reconciliation Tab
// ============================================================

function BankFeedsTab({ orgId }: { orgId: string }) {
  const { data: feeds, loading, error, reload } = useBankFeeds(orgId);
  const { data: txns, reload: reloadTxns } = useBankTransactions(orgId);
  const [showFeedForm, setShowFeedForm] = useState(false);
  const [showImport, setShowImport] = useState<BankFeed | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [autoMatching, setAutoMatching] = useState(false);
  const [matchFilter, setMatchFilter] = useState<"all" | "unmatched" | "matched" | "auto_matched" | "ignored">("all");

  const filteredTxns = txns.filter((t) => matchFilter === "all" || t.match_status === matchFilter);
  const unmatchedCount = txns.filter((t) => t.match_status === "unmatched").length;
  const matchedCount = txns.filter((t) => t.match_status === "matched" || t.match_status === "auto_matched").length;

  const handleAutoMatch = async () => {
    setAutoMatching(true); setActionError(null);
    try {
      const result = await autoMatchBankTransactions(orgId);
      setActionSuccess(`Checked ${result.checked} transactions: ${result.matched} matched, ${result.unmatched} still unmatched`);
      reloadTxns();
      setTimeout(() => setActionSuccess(null), 5000);
    } catch (e) { setActionError((e as Error).message); }
    setAutoMatching(false);
  };

  const handleIgnore = async (txnId: string) => {
    try {
      await ignoreBankTransaction(txnId, "Manually ignored by cashier");
      reloadTxns();
    } catch (e) { setActionError((e as Error).message); }
  };

  const handleManualMatch = async (txnId: string, scheduleId: string, caseId: string) => {
    try {
      await matchBankTransaction(txnId, { matched_schedule_id: scheduleId, matched_case_id: caseId, match_confidence: "manual" });
      reloadTxns();
    } catch (e) { setActionError((e as Error).message); }
  };

  if (loading) return <div className="skeleton h-40 rounded-xl" />;
  if (error) return <div className="panel p-4 text-sm text-rose-600">{error}</div>;

  return (
    <div className="space-y-4">
      {actionError && <div className="rounded-xl bg-rose-50 px-4 py-2 text-sm text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">{actionError}</div>}
      {actionSuccess && <div className="rounded-xl bg-emerald-50 px-4 py-2 text-sm text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">{actionSuccess}</div>}

      {/* Feeds section */}
      <div className="panel p-4 fade-in">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100">Bank Feeds</h4>
            <p className="text-xs text-slate-400">Open banking connections or CSV import sources for client account reconciliation</p>
          </div>
          <button onClick={() => setShowFeedForm(true)} className="btn btn-primary bg-blue-600 text-sm hover:bg-blue-700">
            <Plus className="h-4 w-4" /> Add Feed
          </button>
        </div>
      </div>

      {feeds.length === 0 ? (
        <div className="panel p-8 text-center">
          <Building2 className="mx-auto mb-3 h-8 w-8 text-slate-300 dark:text-slate-600" />
          <p className="text-sm text-slate-500">No bank feeds configured. Add a feed to start importing transactions.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {feeds.map((feed) => (
            <div key={feed.id} className="panel p-4 fade-in">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800">
                  {feed.feed_type === "open_banking" ? <Link2 className="h-5 w-5 text-emerald-600" /> :
                   feed.feed_type === "csv_import" ? <FileSpreadsheet className="h-5 w-5 text-blue-600" /> :
                   <Building2 className="h-5 w-5 text-slate-500" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{feed.feed_name}</p>
                    <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${BANK_FEED_TYPE_META[feed.feed_type].color}`}>
                      {BANK_FEED_TYPE_META[feed.feed_type].label.toUpperCase()}
                    </span>
                    {feed.is_active ? <BadgeCheck className="h-4 w-4 text-emerald-500" /> : <XCircle className="h-4 w-4 text-slate-400" />}
                  </div>
                  <p className="text-[11px] text-slate-400">
                    {feed.sort_code ? `Sort: ${feed.sort_code} · ` : ""}
                    {feed.account_number_masked ? `Acc: ****${feed.account_number_masked} · ` : ""}
                    Last import: {feed.last_import_at ? formatDateShort(feed.last_import_at) : "Never"} ({feed.last_import_count} txns)
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => setShowImport(feed)} className="btn btn-secondary text-xs">
                    <Upload className="h-3.5 w-3.5" /> Import
                  </button>
                  <button onClick={() => { if (confirm("Remove this bank feed?")) deleteBankFeed(feed.id).then(reload); }} className="btn text-xs text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Transactions section */}
      <div className="panel p-4 fade-in">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100">Bank Transactions ({filteredTxns.length})</h4>
            <p className="text-xs text-slate-400">{unmatchedCount} unmatched · {matchedCount} matched</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex gap-1">
              {(["all", "unmatched", "matched", "auto_matched", "ignored"] as const).map((f) => (
                <button key={f} onClick={() => setMatchFilter(f)}
                  className={`rounded-lg px-2.5 py-1 text-[10px] font-medium transition-all ${
                    matchFilter === f ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400"
                  }`}>
                  {f.replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                </button>
              ))}
            </div>
            <button onClick={handleAutoMatch} disabled={autoMatching} className="btn btn-secondary text-xs">
              {autoMatching ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
              Auto-Match
            </button>
          </div>
        </div>
      </div>

      {filteredTxns.length === 0 ? (
        <div className="panel p-8 text-center">
          <Banknote className="mx-auto mb-3 h-8 w-8 text-slate-300 dark:text-slate-600" />
          <p className="text-sm text-slate-500">No bank transactions found. Import a statement or connect a feed.</p>
        </div>
      ) : (
        <div className="panel overflow-x-auto p-0 fade-in">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50">
              <tr>
                <th className="px-3 py-2 text-left text-[10px] font-bold uppercase text-slate-400">Date</th>
                <th className="px-3 py-2 text-left text-[10px] font-bold uppercase text-slate-400">Description</th>
                <th className="px-3 py-2 text-right text-[10px] font-bold uppercase text-slate-400">Amount</th>
                <th className="px-3 py-2 text-left text-[10px] font-bold uppercase text-slate-400">Status</th>
                <th className="px-3 py-2 text-left text-[10px] font-bold uppercase text-slate-400">Match Info</th>
                <th className="px-3 py-2 text-right text-[10px] font-bold uppercase text-slate-400">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
              {filteredTxns.slice(0, 50).map((txn) => (
                <tr key={txn.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                  <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400">{formatDateShort(txn.transaction_date)}</td>
                  <td className="px-3 py-2 text-xs">
                    <p className="font-medium text-slate-700 dark:text-slate-300">{txn.description ?? txn.reference ?? "—"}</p>
                    <p className="text-[10px] text-slate-400">{txn.counterparty_name ?? ""}</p>
                  </td>
                  <td className={`px-3 py-2 text-right font-bold ${txn.direction === "credit" ? "text-emerald-600" : "text-rose-600"}`}>
                    {txn.direction === "credit" ? "+" : "-"}{formatCurrency(txn.amount)}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${BANK_TXN_MATCH_META[txn.match_status].color}`}>
                      {BANK_TXN_MATCH_META[txn.match_status].label.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-[10px] text-slate-400">
                    {txn.match_confidence ? `Confidence: ${txn.match_confidence}` : "—"}
                    {txn.match_notes ? ` · ${txn.match_notes}` : ""}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {txn.match_status === "unmatched" && (
                      <button onClick={() => handleIgnore(txn.id)} className="btn text-[10px] text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700">
                        <EyeOff className="h-3 w-3" /> Ignore
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showFeedForm && (
        <BankFeedFormModal orgId={orgId} onClose={() => setShowFeedForm(false)} onSaved={() => { setShowFeedForm(false); reload(); }} />
      )}
      {showImport && (
        <CsvImportModal orgId={orgId} feed={showImport} onClose={() => setShowImport(null)} onSaved={() => { setShowImport(null); reloadTxns(); reload(); }} />
      )}
    </div>
  );
}

function BankFeedFormModal({ orgId, onClose, onSaved }: { orgId: string; onClose: () => void; onSaved: () => void }) {
  const [feedName, setFeedName] = useState("");
  const [feedType, setFeedType] = useState<BankFeedType>("csv_import");
  const [accountMasked, setAccountMasked] = useState("");
  const [sortCode, setSortCode] = useState("");
  const [importFreq, setImportFreq] = useState<BankFeedFrequency>("manual");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setErr(null);
    try {
      await createBankFeed(orgId, {
        feed_name: feedName, feed_type: feedType,
        account_number_masked: accountMasked || undefined,
        sort_code: sortCode || undefined,
        import_frequency: importFreq,
      });
      onSaved();
    } catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  };

  return (
    <Modal title="Add Bank Feed" onClose={onClose}>
      <form onSubmit={handleSave} className="space-y-3">
        {err && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">{err}</div>}
        <Field label="Feed Name"><input value={feedName} onChange={(e) => setFeedName(e.target.value)} className="input text-sm" placeholder="HSBC Client Account" required autoFocus /></Field>
        <Field label="Feed Type">
          <select value={feedType} onChange={(e) => setFeedType(e.target.value as BankFeedType)} className="input text-sm">
            <option value="csv_import">CSV Import</option>
            <option value="open_banking">Open Banking (Live Feed)</option>
            <option value="manual">Manual Entry</option>
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Sort Code (optional)"><input value={sortCode} onChange={(e) => setSortCode(e.target.value)} className="input text-sm font-mono" placeholder="12-34-56" /></Field>
          <Field label="Account (last 4)"><input value={accountMasked} onChange={(e) => setAccountMasked(e.target.value)} className="input text-sm font-mono" placeholder="1234" maxLength={4} /></Field>
        </div>
        <Field label="Import Frequency">
          <select value={importFreq} onChange={(e) => setImportFreq(e.target.value as BankFeedFrequency)} className="input text-sm">
            <option value="manual">Manual</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
          </select>
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn btn-secondary text-sm">Cancel</button>
          <button type="submit" disabled={saving} className="btn btn-primary bg-blue-600 text-sm hover:bg-blue-700">{saving ? "Saving..." : "Add Feed"}</button>
        </div>
      </form>
    </Modal>
  );
}

function CsvImportModal({ orgId, feed, onClose, onSaved }: { orgId: string; feed: BankFeed; onClose: () => void; onSaved: () => void }) {
  const [csvText, setCsvText] = useState("");
  const [importing, setImporting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const parseCsv = (text: string): Array<{ transaction_date: string; amount: number; direction: "credit" | "debit"; reference?: string; description?: string; counterparty_name?: string }> => {
    const lines = text.trim().split("\n").filter((l) => l.trim());
    const results: Array<{ transaction_date: string; amount: number; direction: "credit" | "debit"; reference?: string; description?: string; counterparty_name?: string }> = [];
    // Skip header row if it contains "date" or "amount"
    const startIdx = lines[0]?.toLowerCase().includes("date") || lines[0]?.toLowerCase().includes("amount") ? 1 : 0;
    for (let i = startIdx; i < lines.length; i++) {
      const cols = lines[i].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
      if (cols.length < 3) continue;
      const dateStr = cols[0];
      const amount = parseFloat(cols[cols.length - 1].replace(/[^0-9.-]/g, ""));
      if (isNaN(amount) || !dateStr) continue;
      const direction = amount >= 0 ? "credit" : "debit";
      results.push({
        transaction_date: dateStr,
        amount: Math.abs(amount),
        direction,
        description: cols[1] ?? "",
        reference: cols[2] ?? "",
        counterparty_name: cols[3] ?? undefined,
      });
    }
    return results;
  };

  const handleImport = async () => {
    setImporting(true); setErr(null); setSuccess(null);
    try {
      const transactions = parseCsv(csvText);
      if (transactions.length === 0) {
        setErr("No valid transactions found. Ensure CSV has columns: Date, Description, Reference, Amount");
        setImporting(false);
        return;
      }
      const result = await importBankTransactions(orgId, feed.id, transactions);
      setSuccess(`Imported ${result.imported} transactions. Run auto-match to reconcile.`);
      setCsvText("");
      setTimeout(() => onSaved(), 2000);
    } catch (e) { setErr((e as Error).message); } finally { setImporting(false); }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setCsvText(ev.target?.result as string);
    reader.readAsText(file);
  };

  return (
    <Modal title={`Import Statement — ${feed.feed_name}`} onClose={onClose}>
      <div className="space-y-3">
        {err && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">{err}</div>}
        {success && <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">{success}</div>}

        <div className="rounded-lg bg-blue-50 px-3 py-2 text-[11px] text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">
          <FileSpreadsheet className="mr-1 inline h-3 w-3" />
          Upload a CSV bank statement. Expected columns: Date, Description, Reference, Amount (negative for debits).
          Alternatively, paste CSV text directly below.
        </div>

        <input ref={fileRef} type="file" accept=".csv,.txt" onChange={handleFileUpload} className="hidden" />
        <button onClick={() => fileRef.current?.click()} className="btn btn-secondary text-sm w-full">
          <Upload className="h-4 w-4" /> Choose CSV File
        </button>

        <Field label="Or Paste CSV Text">
          <textarea value={csvText} onChange={(e) => setCsvText(e.target.value)} className="input text-xs font-mono" rows={8} placeholder="Date,Description,Reference,Amount&#10;2026-01-15,Payment from John Smith,REF123,250.00" />
        </Field>

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="btn btn-secondary text-sm">Cancel</button>
          <button onClick={handleImport} disabled={importing || !csvText.trim()} className="btn btn-primary bg-blue-600 text-sm hover:bg-blue-700 disabled:opacity-50">
            {importing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Import & Reconcile
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ============================================================
// Batch Processing Tab
// ============================================================

function BatchProcessingTab({ orgId }: { orgId: string }) {
  const { data: runs, loading, error, reload } = useBatchRuns(orgId);
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const handleCreate = async () => {
    setCreating(true); setActionError(null);
    try {
      const result = await createBatchRun(orgId, "card_collection");
      if (!result.runId) {
        setActionSuccess("No due schedules found for today");
        setTimeout(() => setActionSuccess(null), 3000);
      } else {
        setActionSuccess(`Batch created: ${result.totalItems} items, ${formatCurrency(result.totalAmount)}`);
        reload();
        setSelectedRun(result.runId);
        setTimeout(() => setActionSuccess(null), 5000);
      }
    } catch (e) { setActionError((e as Error).message); }
    setCreating(false);
  };

  const handleExecute = async (runId: string, totalItems: number) => {
    setExecuting(true); setActionError(null);
    try {
      const jobId = await executeBatchRunAsync(orgId, runId, totalItems);
      setActionSuccess(`Batch enqueued as background job ${jobId.slice(0, 8)}... — processing ${totalItems} items asynchronously. Monitor progress in the Queue Monitor tab.`);
      reload();
      setTimeout(() => setActionSuccess(null), 6000);
    } catch (e) { setActionError((e as Error).message); }
    setExecuting(false);
  };

  const handleRetry = async (runId: string) => {
    setRetrying(true); setActionError(null);
    try {
      const result = await retryBatchRun(runId);
      setActionSuccess(`Retried: ${result.succeeded} succeeded, ${result.stillFailed} still failed`);
      reload();
      setTimeout(() => setActionSuccess(null), 5000);
    } catch (e) { setActionError((e as Error).message); }
    setRetrying(false);
  };

  if (loading) return <div className="skeleton h-40 rounded-xl" />;
  if (error) return <div className="panel p-4 text-sm text-rose-600">{error}</div>;

  return (
    <div className="space-y-4">
      {actionError && <div className="rounded-xl bg-rose-50 px-4 py-2 text-sm text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">{actionError}</div>}
      {actionSuccess && <div className="rounded-xl bg-emerald-50 px-4 py-2 text-sm text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">{actionSuccess}</div>}

      <div className="panel p-4 fade-in">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100">Batch Payment Runs</h4>
            <p className="text-xs text-slate-400">One-click batch processing for daily card collections and Direct Debit runs</p>
          </div>
          <button onClick={handleCreate} disabled={creating} className="btn btn-primary bg-blue-600 text-sm hover:bg-blue-700 disabled:opacity-50">
            {creating ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Create Today's Batch
          </button>
        </div>
      </div>

      {runs.length === 0 ? (
        <div className="panel p-8 text-center">
          <Layers className="mx-auto mb-3 h-8 w-8 text-slate-300 dark:text-slate-600" />
          <p className="text-sm text-slate-500">No batch runs yet. Create a batch to process all due recurring collections in one click.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {runs.map((run) => (
            <div key={run.id} className="panel p-4 fade-in">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 dark:bg-blue-500/10">
                  <Layers className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{formatDateShort(run.batch_date)}</p>
                    <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${BATCH_RUN_STATUS_META[run.status].color}`}>
                      {BATCH_RUN_STATUS_META[run.status].label.toUpperCase()}
                    </span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-bold text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                      {run.batch_type.replace("_", " ").toUpperCase()}
                    </span>
                  </div>
                  <div className="mt-1 flex gap-4 text-[11px] text-slate-500 dark:text-slate-400">
                    <span><CheckCircle2 className="mr-0.5 inline h-3 w-3 text-emerald-500" />{run.succeeded_count}/{run.total_items} succeeded</span>
                    <span><XCircle className="mr-0.5 inline h-3 w-3 text-rose-500" />{run.failed_count} failed</span>
                    <span className="font-bold">{formatCurrency(run.total_amount)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => setSelectedRun(selectedRun === run.id ? null : run.id)} className="btn btn-secondary text-xs">
                    <Eye className="h-3.5 w-3.5" /> Details
                  </button>
                  {run.status === "pending" && (
                    <button onClick={() => handleExecute(run.id, run.total_items)} disabled={executing} className="btn btn-primary bg-emerald-600 text-xs hover:bg-emerald-700 disabled:opacity-50">
                      {executing ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                      Execute Async
                    </button>
                  )}
                  {(run.status === "partial" || run.status === "failed") && (
                    <button onClick={() => handleRetry(run.id)} disabled={retrying} className="btn btn-secondary text-xs disabled:opacity-50">
                      {retrying ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />}
                      Retry Failed
                    </button>
                  )}
                </div>
              </div>
              {selectedRun === run.id && <BatchItemsList runId={run.id} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BatchItemsList({ runId }: { runId: string }) {
  const { data: items, loading, error } = useBatchItems(runId);
  if (loading) return <div className="mt-3 skeleton h-20 rounded-lg" />;
  if (error) return <div className="mt-3 text-xs text-rose-600">{error}</div>;
  if (!items.length) return <p className="mt-2 text-xs text-slate-400">No items in this batch.</p>;

  return (
    <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-700/50">
      <div className="space-y-1.5">
        {items.map((item) => (
          <div key={item.id} className="flex items-center gap-2 rounded-lg border border-slate-200 p-2 dark:border-slate-700">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-slate-700 dark:text-slate-300">{formatCurrency(item.amount)}</p>
              <p className="text-[10px] text-slate-400">{item.failure_reason ?? "Processed"}</p>
            </div>
            <span className={`rounded-full px-2 py-0.5 text-[8px] font-bold ${BATCH_ITEM_STATUS_META[item.status].color}`}>
              {BATCH_ITEM_STATUS_META[item.status].label.toUpperCase()}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// Exception & Bounced Payment Queues Tab
// ============================================================

function ExceptionsTab({ orgId, caseId }: { orgId: string; caseId: string | null }) {
  const { data: txns, reload: reloadTxns } = useGatewayTransactions(caseId);
  const { data: schedules, reload: reloadSchedules } = useRecurringSchedules(caseId);
  const { data: methods } = useTokenisedPaymentMethods(caseId);
  const { data: paymentLinks, reload: reloadLinks } = usePaymentLinks(orgId);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [showLinkForm, setShowLinkForm] = useState<BatchPaymentItem | null>(null);
  const [sendingLink, setSendingLink] = useState(false);

  const failedTxns = txns.filter((t) => t.status === "failed" || t.status === "retrying");
  const suspendedSchedules = schedules.filter((s) => s.status === "suspended");
  const now = new Date();
  const currentYear = now.getFullYear() % 100;
  const currentMonth = now.getMonth() + 1;
  const expiredCards = methods.filter((m) => {
    if (!m.expiry_month || !m.expiry_year) return false;
    return m.expiry_year < currentYear || (m.expiry_year === currentYear && m.expiry_month < currentMonth);
  });

  const handleSendLink = async (linkData: {
    case_id?: string; schedule_id?: string; failed_transaction_id?: string;
    debtor_name: string; debtor_contact: string; contact_channel: PaymentLinkChannel;
    amount_requested: number;
  }) => {
    setSendingLink(true); setActionError(null);
    try {
      await sendPaymentLink(orgId, linkData);
      await logAuditAction(orgId, {
        case_id: linkData.case_id,
        action_type: "payment_link_sent",
        entity_type: "payment_link_invitations",
        new_value: { channel: linkData.contact_channel, amount: linkData.amount_requested },
        reason: `Payment link sent to ${linkData.debtor_name} via ${linkData.contact_channel}`,
      });
      setActionSuccess("Payment link sent successfully");
      reloadLinks();
      setShowLinkForm(null);
      setTimeout(() => setActionSuccess(null), 3000);
    } catch (e) { setActionError((e as Error).message); }
    setSendingLink(false);
  };

  const handleResumeSchedule = async (scheduleId: string) => {
    try {
      const { updateRecurringSchedule } = await import("@/lib/payment-hooks");
      await updateRecurringSchedule(scheduleId, { status: "active", retry_count: 0 });
      await logAuditAction(orgId, { action_type: "schedule_resume", entity_type: "recurring_payment_schedules", entity_id: scheduleId, reason: "Manually resumed by cashier" });
      reloadSchedules();
    } catch (e) { setActionError((e as Error).message); }
  };

  return (
    <div className="space-y-4">
      {actionError && <div className="rounded-xl bg-rose-50 px-4 py-2 text-sm text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">{actionError}</div>}
      {actionSuccess && <div className="rounded-xl bg-emerald-50 px-4 py-2 text-sm text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">{actionSuccess}</div>}

      {/* Alert summary */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className={`panel p-4 fade-in ${failedTxns.length > 0 ? "border-rose-200 dark:border-rose-500/30" : ""}`}>
          <div className="flex items-center gap-2">
            <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${failedTxns.length > 0 ? "bg-rose-50 text-rose-600 dark:bg-rose-500/10" : "bg-slate-100 text-slate-400 dark:bg-slate-800"}`}>
              <AlertCircle className="h-4 w-4" />
            </div>
            <div><p className="text-[10px] font-bold uppercase text-slate-400">Failed Txns</p><p className="text-lg font-bold text-slate-700 dark:text-slate-200">{failedTxns.length}</p></div>
          </div>
        </div>
        <div className={`panel p-4 fade-in ${suspendedSchedules.length > 0 ? "border-orange-200 dark:border-orange-500/30" : ""}`}>
          <div className="flex items-center gap-2">
            <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${suspendedSchedules.length > 0 ? "bg-orange-50 text-orange-600 dark:bg-orange-500/10" : "bg-slate-100 text-slate-400 dark:bg-slate-800"}`}>
              <Clock className="h-4 w-4" />
            </div>
            <div><p className="text-[10px] font-bold uppercase text-slate-400">Suspended</p><p className="text-lg font-bold text-slate-700 dark:text-slate-200">{suspendedSchedules.length}</p></div>
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
        <div className="panel p-4 fade-in">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-50 text-violet-600 dark:bg-violet-500/10">
              <Send className="h-4 w-4" />
            </div>
            <div><p className="text-[10px] font-bold uppercase text-slate-400">Links Sent</p><p className="text-lg font-bold text-slate-700 dark:text-slate-200">{paymentLinks.length}</p></div>
          </div>
        </div>
      </div>

      {/* Expired Cards with Remediation */}
      {expiredCards.length > 0 && (
        <div className="panel p-4 fade-in">
          <div className="mb-3 flex items-center gap-2">
            <XCircle className="h-4 w-4 text-rose-500" />
            <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100">Expired Card Tokens — Remediation Required</h4>
          </div>
          <div className="space-y-2">
            {expiredCards.map((pm) => {
              const linkedSchedules = schedules.filter((s) => s.payment_method_id === pm.id);
              return (
                <div key={pm.id} className="rounded-lg border border-rose-200 bg-rose-50/50 p-3 dark:border-rose-500/30 dark:bg-rose-500/10">
                  <div className="flex items-center gap-3">
                    <CreditCard className="h-4 w-4 shrink-0 text-rose-500" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{pm.card_brand?.toUpperCase()} •••• {pm.last4}</p>
                      <p className="text-[10px] text-rose-600 dark:text-rose-400">Expired {String(pm.expiry_month).padStart(2, "0")}/{pm.expiry_year} · {linkedSchedules.length} schedule(s) affected</p>
                    </div>
                    <button onClick={() => setShowLinkForm({ id: pm.id, batch_run_id: "", amount: 0, status: "pending", gateway_transaction_id: null, failure_reason: "Expired card", processed_at: null, created_at: "", schedule_id: linkedSchedules[0]?.id ?? null, case_id: linkedSchedules[0]?.case_id ?? null, payment_method_id: pm.id, gateway_config_id: null })} className="btn btn-secondary text-xs">
                      <Send className="h-3.5 w-3.5" /> Send Payment Link
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Failed Transactions with Remediation Actions */}
      {failedTxns.length > 0 && (
        <div className="panel p-4 fade-in">
          <div className="mb-3 flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-rose-500" />
            <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100">Failed Transaction Triage Queue</h4>
          </div>
          <div className="space-y-2">
            {failedTxns.slice(0, 20).map((txn) => {
              const schedule = schedules.find((s) => s.id === txn.schedule_id);
              return (
                <div key={txn.id} className="flex items-center gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                  <FileWarning className="h-4 w-4 shrink-0 text-rose-500" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{formatCurrency(txn.amount)}</p>
                    <p className="text-[10px] text-slate-400">{txn.failure_reason ?? "Unknown"} · {schedule ? `Retry ${schedule.retry_count}/${schedule.max_retries}` : ""}</p>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${GATEWAY_TX_STATUS_META[txn.status].color}`}>
                    {GATEWAY_TX_STATUS_META[txn.status].label.toUpperCase()}
                  </span>
                  <button onClick={() => setShowLinkForm({ id: txn.id, batch_run_id: "", amount: txn.amount, status: "pending", gateway_transaction_id: null, failure_reason: txn.failure_reason, processed_at: null, created_at: "", schedule_id: txn.schedule_id, case_id: txn.case_id, payment_method_id: null, gateway_config_id: null })} className="btn btn-secondary text-[10px] px-2 py-1">
                    <Send className="h-3 w-3" /> Send Link
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
            <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100">Suspended Schedules — Resume After Remediation</h4>
          </div>
          <div className="space-y-2">
            {suspendedSchedules.map((schedule) => {
              const pm = methods.find((m) => m.id === schedule.payment_method_id);
              return (
                <div key={schedule.id} className="flex items-center gap-3 rounded-lg border border-orange-200 bg-orange-50/50 p-3 dark:border-orange-500/30 dark:bg-orange-500/10">
                  <Clock className="h-4 w-4 shrink-0 text-orange-500" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{formatCurrency(schedule.installment_amount)} / {schedule.frequency}</p>
                    <p className="text-[10px] text-slate-400">{pm ? `${pm.card_brand?.toUpperCase()} •••• ${pm.last4}` : "No card"} · Retries: {schedule.retry_count}/{schedule.max_retries}</p>
                  </div>
                  <button onClick={() => handleResumeSchedule(schedule.id)} className="btn btn-secondary text-[10px] px-2 py-1">
                    <Play className="h-3 w-3" /> Resume
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Payment Link History */}
      {paymentLinks.length > 0 && (
        <div className="panel p-4 fade-in">
          <div className="mb-3 flex items-center gap-2">
            <Send className="h-4 w-4 text-violet-500" />
            <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100">Payment Link History</h4>
          </div>
          <div className="space-y-2">
            {paymentLinks.slice(0, 10).map((link) => (
              <div key={link.id} className="flex items-center gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                {link.contact_channel === "sms" ? <MessageSquare className="h-4 w-4 shrink-0 text-violet-500" /> : <Mail className="h-4 w-4 shrink-0 text-violet-500" />}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{formatCurrency(link.amount_requested)} to {link.debtor_name}</p>
                  <p className="text-[10px] text-slate-400">Sent {formatDateShort(link.sent_at)} · Expires {formatDateShort(link.expires_at)}</p>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${PAYMENT_LINK_STATUS_META[link.status].color}`}>
                  {PAYMENT_LINK_STATUS_META[link.status].label.toUpperCase()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {failedTxns.length === 0 && suspendedSchedules.length === 0 && expiredCards.length === 0 && (
        <div className="panel p-8 text-center">
          <CheckCircle2 className="mx-auto mb-3 h-8 w-8 text-emerald-500" />
          <p className="text-sm text-slate-500">No exceptions. All collections are processing normally.</p>
        </div>
      )}

      {showLinkForm && (
        <PaymentLinkFormModal
          orgId={orgId}
          item={showLinkForm}
          onClose={() => setShowLinkForm(null)}
          onSend={handleSendLink}
          sending={sendingLink}
        />
      )}
    </div>
  );
}

function PaymentLinkFormModal({ item, onClose, onSend, sending }: {
  orgId: string; item: BatchPaymentItem; onClose: () => void; onSend: (data: {
    case_id?: string; schedule_id?: string; failed_transaction_id?: string;
    debtor_name: string; debtor_contact: string; contact_channel: PaymentLinkChannel;
    amount_requested: number;
  }) => void; sending: boolean;
}) {
  const [debtorName, setDebtorName] = useState("");
  const [debtorContact, setDebtorContact] = useState("");
  const [channel, setChannel] = useState<PaymentLinkChannel>("sms");
  const [amount, setAmount] = useState(String(item.amount || ""));

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    onSend({
      case_id: item.case_id ?? undefined,
      schedule_id: item.schedule_id ?? undefined,
      failed_transaction_id: item.gateway_transaction_id ?? undefined,
      debtor_name: debtorName,
      debtor_contact: debtorContact,
      contact_channel: channel,
      amount_requested: parseFloat(amount) || 0,
    });
  };

  return (
    <Modal title="Send Payment Link" onClose={onClose}>
      <form onSubmit={handleSend} className="space-y-3">
        <div className="rounded-lg bg-violet-50 px-3 py-2 text-[11px] text-violet-700 dark:bg-violet-500/10 dark:text-violet-300">
          <Send className="mr-1 inline h-3 w-3" />
          Send a secure one-time payment link via SMS or email. The debtor can pay without logging in.
        </div>
        <Field label="Debtor Name"><input value={debtorName} onChange={(e) => setDebtorName(e.target.value)} className="input text-sm" required autoFocus /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Channel">
            <select value={channel} onChange={(e) => setChannel(e.target.value as PaymentLinkChannel)} className="input text-sm">
              <option value="sms">SMS</option>
              <option value="email">Email</option>
            </select>
          </Field>
          <Field label="Amount (£)"><input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="input text-sm" required /></Field>
        </div>
        <Field label={channel === "sms" ? "Phone Number" : "Email Address"}>
          <input value={debtorContact} onChange={(e) => setDebtorContact(e.target.value)} className="input text-sm" placeholder={channel === "sms" ? "07123456789" : "debtor@example.com"} required />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn btn-secondary text-sm">Cancel</button>
          <button type="submit" disabled={sending} className="btn btn-primary bg-violet-600 text-sm hover:bg-violet-700">{sending ? "Sending..." : "Send Link"}</button>
        </div>
      </form>
    </Modal>
  );
}

// ============================================================
// Disbursement Runs Tab
// ============================================================

function DisbursementRunsTab({ orgId, caseId }: { orgId: string; caseId: string | null }) {
  const { data: runs, loading, error, reload } = useDisbursementRuns(orgId, caseId);
  const { data: waterfall } = useDisbursementWaterfall(caseId);
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generatedFile, setGeneratedFile] = useState<string | null>(null);

  const settledWaterfall = waterfall.filter((w) => w.status === "settled" || w.status === "scheduled");

  const handleApprove = async (runId: string) => {
    try {
      await approveDisbursementRun(runId);
      setActionSuccess("Disbursement run approved");
      reload();
      setTimeout(() => setActionSuccess(null), 3000);
    } catch (e) { setActionError((e as Error).message); }
  };

  const handleGenerate = async (runId: string) => {
    setGenerating(true); setActionError(null);
    try {
      const result = await generateDisbursementFile(runId);
      setGeneratedFile(result.fileContent);
      setActionSuccess(`File generated: ${result.fileReference} — ${result.totalItems} payments, ${formatCurrency(result.totalAmount)}`);
      reload();
      setTimeout(() => setActionSuccess(null), 5000);
    } catch (e) { setActionError((e as Error).message); }
    setGenerating(false);
  };

  const handleSubmit = async (runId: string) => {
    try {
      await submitDisbursementRun(runId);
      setActionSuccess("Disbursement run submitted");
      reload();
      setTimeout(() => setActionSuccess(null), 3000);
    } catch (e) { setActionError((e as Error).message); }
  };

  if (loading) return <div className="skeleton h-40 rounded-xl" />;
  if (error) return <div className="panel p-4 text-sm text-rose-600">{error}</div>;

  return (
    <div className="space-y-4">
      {actionError && <div className="rounded-xl bg-rose-50 px-4 py-2 text-sm text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">{actionError}</div>}
      {actionSuccess && <div className="rounded-xl bg-emerald-50 px-4 py-2 text-sm text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">{actionSuccess}</div>}

      <div className="panel flex items-center justify-between p-4 fade-in">
        <div>
          <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100">Creditor Disbursement Runs</h4>
          <p className="text-xs text-slate-400">Generate BACS files or payment instruction batches for pro-rata creditor dividends and statutory fee allocations</p>
        </div>
        <button onClick={() => setShowCreate(true)} disabled={settledWaterfall.length === 0} className="btn btn-primary bg-blue-600 text-sm hover:bg-blue-700 disabled:opacity-50">
          <Plus className="h-4 w-4" /> New Disbursement Run
        </button>
      </div>

      {runs.length === 0 ? (
        <div className="panel p-8 text-center">
          <ArrowLeftRight className="mx-auto mb-3 h-8 w-8 text-slate-300 dark:text-slate-600" />
          <p className="text-sm text-slate-500">No disbursement runs yet. Create a run from approved waterfall entries to generate BACS payment files.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {runs.map((run) => (
            <div key={run.id} className="panel p-4 fade-in">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 dark:bg-blue-500/10">
                  <ArrowLeftRight className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{run.file_reference ?? "No ref"}</p>
                    <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${DISB_RUN_STATUS_META[run.status].color}`}>
                      {DISB_RUN_STATUS_META[run.status].label.toUpperCase()}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${DISB_OUTPUT_FORMAT_META[run.output_format].color}`}>
                      {DISB_OUTPUT_FORMAT_META[run.output_format].label.toUpperCase()}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    {run.total_items} payments · {formatCurrency(run.total_amount)} · {formatDateShort(run.run_date)}
                    {run.approved_at && ` · Approved ${formatDateShort(run.approved_at)}`}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => setSelectedRun(selectedRun === run.id ? null : run.id)} className="btn btn-secondary text-xs">
                    <Eye className="h-3.5 w-3.5" /> Items
                  </button>
                  {run.status === "draft" && (
                    <button onClick={() => handleApprove(run.id)} className="btn btn-secondary text-xs">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Approve
                    </button>
                  )}
                  {run.status === "approved" && (
                    <button onClick={() => handleGenerate(run.id)} disabled={generating} className="btn btn-primary bg-cyan-600 text-xs hover:bg-cyan-700 disabled:opacity-50">
                      {generating ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />}
                      Generate File
                    </button>
                  )}
                  {run.status === "generated" && (
                    <button onClick={() => handleSubmit(run.id)} className="btn btn-primary bg-blue-600 text-xs hover:bg-blue-700">
                      <Send className="h-3.5 w-3.5" /> Submit
                    </button>
                  )}
                </div>
              </div>
              {selectedRun === run.id && <DisbursementRunItemsList runId={run.id} />}
            </div>
          ))}
        </div>
      )}

      {generatedFile && (
        <div className="panel p-4 fade-in">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100">Generated File Preview</h4>
            <div className="flex gap-2">
              <button onClick={() => navigator.clipboard.writeText(generatedFile)} className="btn btn-secondary text-xs">
                <Download className="h-3.5 w-3.5" /> Copy to Clipboard
              </button>
              <button onClick={() => setGeneratedFile(null)} className="btn text-xs text-slate-500">Close</button>
            </div>
          </div>
          <pre className="max-h-64 overflow-auto rounded-lg bg-slate-900 p-3 text-[10px] text-slate-100 dark:bg-slate-950">{generatedFile}</pre>
        </div>
      )}

      {showCreate && (
        <CreateDisbursementRunModal orgId={orgId} caseId={caseId} waterfallEntries={settledWaterfall} onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); reload(); }} />
      )}
    </div>
  );
}

function DisbursementRunItemsList({ runId }: { runId: string }) {
  const { data: items, loading, error } = useDisbursementRunItems(runId);
  if (loading) return <div className="mt-3 skeleton h-20 rounded-lg" />;
  if (error) return <div className="mt-3 text-xs text-rose-600">{error}</div>;
  if (!items.length) return <p className="mt-2 text-xs text-slate-400">No items in this run.</p>;

  return (
    <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-700/50">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="border-b border-slate-200 dark:border-slate-700">
            <tr>
              <th className="px-2 py-1.5 text-left text-[9px] font-bold uppercase text-slate-400">Payee</th>
              <th className="px-2 py-1.5 text-left text-[9px] font-bold uppercase text-slate-400">Category</th>
              <th className="px-2 py-1.5 text-left text-[9px] font-bold uppercase text-slate-400">Account</th>
              <th className="px-2 py-1.5 text-right text-[9px] font-bold uppercase text-slate-400">Amount</th>
              <th className="px-2 py-1.5 text-left text-[9px] font-bold uppercase text-slate-400">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
            {items.map((item) => (
              <tr key={item.id}>
                <td className="px-2 py-1.5 text-[10px] font-medium text-slate-700 dark:text-slate-300">{item.payee_name}</td>
                <td className="px-2 py-1.5"><span className={`rounded-full px-1.5 py-0.5 text-[8px] font-bold ${DISBURSEMENT_CATEGORY_META[item.category]?.color ?? "bg-slate-100 text-slate-500"}`}>{item.category.replace(/_/g, " ").toUpperCase()}</span></td>
                <td className="px-2 py-1.5 text-[10px] font-mono text-slate-400">{item.payee_sort_code ?? "—"} / {item.payee_account_number ?? "—"}</td>
                <td className="px-2 py-1.5 text-right text-[10px] font-bold text-slate-700 dark:text-slate-300">{formatCurrency(item.amount)}</td>
                <td className="px-2 py-1.5"><span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[8px] font-bold text-slate-600 dark:bg-slate-700 dark:text-slate-300">{item.status.toUpperCase()}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CreateDisbursementRunModal({ orgId, caseId, waterfallEntries, onClose, onCreated }: {
  orgId: string; caseId: string | null;
  waterfallEntries: Array<{ id: string; payee_name: string; allocated_amount: number; category: string; status: string }>;
  onClose: () => void; onCreated: () => void;
}) {
  const [outputFormat, setOutputFormat] = useState<DisbursementOutputFormat>("bacs");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(waterfallEntries.map((e) => e.id)));
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const toggle = (id: string) => {
    const next = new Set(selectedIds);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelectedIds(next);
  };

  const totalSelected = waterfallEntries.filter((e) => selectedIds.has(e.id)).reduce((s, e) => s + e.allocated_amount, 0);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true); setErr(null);
    try {
      await createDisbursementRun(orgId, {
        case_id: caseId ?? undefined,
        output_format: outputFormat,
        waterfall_entry_ids: Array.from(selectedIds),
      });
      onCreated();
    } catch (e) { setErr((e as Error).message); } finally { setCreating(false); }
  };

  return (
    <Modal title="Create Disbursement Run" onClose={onClose}>
      <form onSubmit={handleCreate} className="space-y-3">
        {err && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">{err}</div>}
        <Field label="Output Format">
          <select value={outputFormat} onChange={(e) => setOutputFormat(e.target.value as DisbursementOutputFormat)} className="input text-sm">
            <option value="bacs">BACS (Standard)</option>
            <option value="faster_payments">Faster Payments</option>
            <option value="sepa">SEPA</option>
            <option value="manual_instruction">Manual Instruction Sheet</option>
          </select>
        </Field>
        <div>
          <p className="mb-2 text-xs font-semibold uppercase text-slate-500">Waterfall Entries to Include ({selectedIds.size} selected, {formatCurrency(totalSelected)})</p>
          <div className="max-h-48 space-y-1.5 overflow-y-auto">
            {waterfallEntries.map((entry) => (
              <label key={entry.id} className="flex items-center gap-2 rounded-lg border border-slate-200 p-2 dark:border-slate-700">
                <input type="checkbox" checked={selectedIds.has(entry.id)} onChange={() => toggle(entry.id)} className="rounded" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-slate-700 dark:text-slate-300">{entry.payee_name}</p>
                  <p className="text-[10px] text-slate-400">{entry.category.replace(/_/g, " ")} · {formatCurrency(entry.allocated_amount)}</p>
                </div>
              </label>
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn btn-secondary text-sm">Cancel</button>
          <button type="submit" disabled={creating || selectedIds.size === 0} className="btn btn-primary bg-blue-600 text-sm hover:bg-blue-700 disabled:opacity-50">{creating ? "Creating..." : "Create Run"}</button>
        </div>
      </form>
    </Modal>
  );
}

// ============================================================
// Audit Trail & Ledger Locks Tab
// ============================================================

function AuditTrailTab({ orgId, caseId }: { orgId: string; caseId: string | null }) {
  const { data: logs, loading, error, reload } = useAuditLogs(orgId, caseId, 100);
  const { data: locks, reload: reloadLocks } = useLedgerLocks(orgId);
  const [showLockForm, setShowLockForm] = useState(false);
  const [unlocking, setUnlocking] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const handleUnlock = async (lockId: string) => {
    const reason = prompt("Enter reason for unlocking the ledger:");
    if (!reason) return;
    setUnlocking(lockId); setActionError(null);
    try {
      await unlockLedger(lockId, reason);
      await logAuditAction(orgId, { action_type: "ledger_unlock", entity_type: "ledger_locks", entity_id: lockId, reason });
      reloadLocks(); reload();
    } catch (e) { setActionError((e as Error).message); }
    setUnlocking(null);
  };

  if (loading) return <div className="skeleton h-40 rounded-xl" />;
  if (error) return <div className="panel p-4 text-sm text-rose-600">{error}</div>;

  // End-of-day summary
  const today = new Date().toISOString().split("T")[0];
  const todayLogs = logs.filter((l) => l.created_at.startsWith(today));
  const todayCollected = todayLogs.filter((l) => l.action_type === "batch_execute").reduce((s, l) => s + (l.amount_impact ?? 0), 0);
  const todayDisbursed = todayLogs.filter((l) => l.action_type === "disbursement_settle").reduce((s, l) => s + (l.amount_impact ?? 0), 0);
  const todayVariance = todayCollected - todayDisbursed;
  const isTodayLocked = locks.some((l) => l.lock_date === today && l.status === "locked");

  return (
    <div className="space-y-4">
      {actionError && <div className="rounded-xl bg-rose-50 px-4 py-2 text-sm text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">{actionError}</div>}

      {/* End-of-day balancing summary */}
      <div className="panel p-4 fade-in">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100">End-of-Day Balancing — {formatDateShort(today)}</h4>
            <p className="text-xs text-slate-400">Daily reconciliation summary for financial sign-off</p>
          </div>
          {!isTodayLocked && (
            <button onClick={() => setShowLockForm(true)} className="btn btn-primary bg-blue-600 text-sm hover:bg-blue-700">
              <Lock className="h-4 w-4" /> Lock Today's Ledger
            </button>
          )}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3">
          <div className="rounded-xl bg-emerald-50 p-3 text-center dark:bg-emerald-500/10">
            <p className="text-[10px] font-bold uppercase text-emerald-600 dark:text-emerald-400">Collected Today</p>
            <p className="text-xl font-bold text-emerald-700 dark:text-emerald-300">{formatCurrency(todayCollected)}</p>
          </div>
          <div className="rounded-xl bg-blue-50 p-3 text-center dark:bg-blue-500/10">
            <p className="text-[10px] font-bold uppercase text-blue-600 dark:text-blue-400">Disbursed Today</p>
            <p className="text-xl font-bold text-blue-700 dark:text-blue-300">{formatCurrency(todayDisbursed)}</p>
          </div>
          <div className={`rounded-xl p-3 text-center ${todayVariance === 0 ? "bg-slate-50 dark:bg-slate-800/50" : todayVariance > 0 ? "bg-amber-50 dark:bg-amber-500/10" : "bg-rose-50 dark:bg-rose-500/10"}`}>
            <p className="text-[10px] font-bold uppercase text-slate-500">Variance</p>
            <p className={`text-xl font-bold ${todayVariance === 0 ? "text-slate-600 dark:text-slate-300" : todayVariance > 0 ? "text-amber-600" : "text-rose-600"}`}>{formatCurrency(todayVariance)}</p>
          </div>
        </div>
        {isTodayLocked && (
          <div className="mt-3 flex items-center gap-2 rounded-lg bg-blue-50 px-3 py-2 dark:bg-blue-500/10">
            <Lock className="h-4 w-4 text-blue-600" />
            <p className="text-xs text-blue-700 dark:text-blue-300">Today's ledger is locked. All manual adjustments are prevented until unlocked.</p>
          </div>
        )}
      </div>

      {/* Ledger locks history */}
      {locks.length > 0 && (
        <div className="panel p-4 fade-in">
          <div className="mb-3 flex items-center gap-2">
            <Lock className="h-4 w-4 text-blue-500" />
            <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100">Ledger Lock History</h4>
          </div>
          <div className="space-y-2">
            {locks.slice(0, 10).map((lock) => (
              <div key={lock.id} className="flex items-center gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                {lock.status === "locked" ? <Lock className="h-4 w-4 text-blue-500" /> : <Unlock className="h-4 w-4 text-slate-400" />}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{formatDateShort(lock.lock_date)}</p>
                  <p className="text-[10px] text-slate-400">
                    Collected: {formatCurrency(lock.total_collected)} · Disbursed: {formatCurrency(lock.total_disbursed)} · Variance: {formatCurrency(lock.variance)}
                    {lock.locked_by_email ? ` · Locked by ${lock.locked_by_email}` : ""}
                  </p>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${lock.status === "locked" ? "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300" : "bg-slate-100 text-slate-500 dark:bg-slate-700"}`}>
                  {lock.status.toUpperCase()}
                </span>
                {lock.status === "locked" && (
                  <button onClick={() => handleUnlock(lock.id)} disabled={unlocking === lock.id} className="btn text-xs text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-500/10">
                    {unlocking === lock.id ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Unlock className="h-3.5 w-3.5" />}
                    Unlock
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Audit log */}
      <div className="panel p-4 fade-in">
        <div className="mb-3 flex items-center gap-2">
          <ListChecks className="h-4 w-4 text-slate-500" />
          <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100">Cashier Audit Trail ({logs.length})</h4>
        </div>
        {logs.length === 0 ? (
          <p className="text-sm text-slate-400">No audit entries yet. Actions by cashiers will be recorded here.</p>
        ) : (
          <div className="space-y-2">
            {logs.slice(0, 50).map((log) => (
              <div key={log.id} className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                <div className="mt-0.5">
                  {log.action_type === "refund" ? <XCircle className="h-4 w-4 text-rose-500" /> :
                   log.action_type === "batch_execute" ? <Play className="h-4 w-4 text-blue-500" /> :
                   log.action_type === "ledger_lock" ? <Lock className="h-4 w-4 text-blue-500" /> :
                   log.action_type === "ledger_unlock" ? <Unlock className="h-4 w-4 text-slate-500" /> :
                   log.action_type === "payment_link_sent" ? <Send className="h-4 w-4 text-violet-500" /> :
                   <Shield className="h-4 w-4 text-slate-400" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[8px] font-bold ${AUDIT_ACTION_META[log.action_type]?.color ?? "bg-slate-100 text-slate-500"}`}>
                      {AUDIT_ACTION_META[log.action_type]?.label ?? log.action_type}
                    </span>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{log.user_email ?? "System"}</p>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">{log.reason ?? "No reason provided"}</p>
                  <p className="text-[10px] text-slate-400">{new Date(log.created_at).toLocaleString()}</p>
                </div>
                {log.amount_impact != null && log.amount_impact !== 0 && (
                  <span className="text-xs font-bold text-slate-600 dark:text-slate-300">{formatCurrency(log.amount_impact)}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {showLockForm && (
        <LedgerLockFormModal orgId={orgId} collected={todayCollected} disbursed={todayDisbursed} variance={todayVariance} onClose={() => setShowLockForm(false)} onSaved={() => { setShowLockForm(false); reloadLocks(); reload(); }} />
      )}
    </div>
  );
}

function LedgerLockFormModal({ orgId, collected, disbursed, variance, onClose, onSaved }: {
  orgId: string; collected: number; disbursed: number; variance: number;
  onClose: () => void; onSaved: () => void;
}) {
  const [lockType, setLockType] = useState<"end_of_day" | "period" | "month_end">("end_of_day");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setErr(null);
    try {
      const today = new Date().toISOString().split("T")[0];
      await createLedgerLock(orgId, {
        lock_date: today, lock_type: lockType,
        total_collected: collected, total_disbursed: disbursed, variance,
      });
      await logAuditAction(orgId, {
        action_type: "ledger_lock", entity_type: "ledger_locks",
        new_value: { lock_date: today, lock_type: lockType, collected, disbursed, variance },
        reason: `Ledger locked for ${today}: collected ${formatCurrency(collected)}, disbursed ${formatCurrency(disbursed)}, variance ${formatCurrency(variance)}`,
      });
      onSaved();
    } catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  };

  return (
    <Modal title="Lock Ledger" onClose={onClose}>
      <form onSubmit={handleSave} className="space-y-3">
        {err && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">{err}</div>}
        <div className="rounded-lg bg-blue-50 px-3 py-2 text-[11px] text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">
          <Lock className="mr-1 inline h-3 w-3" />
          Locking the ledger prevents all manual adjustments, refunds, and fee overrides for this date. Unlock requires a documented reason.
        </div>
        <Field label="Lock Type">
          <select value={lockType} onChange={(e) => setLockType(e.target.value as "end_of_day" | "period" | "month_end")} className="input text-sm">
            <option value="end_of_day">End of Day</option>
            <option value="period">Period</option>
            <option value="month_end">Month End</option>
          </select>
        </Field>
        <div className="grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/50">
          <div className="text-center"><p className="text-[10px] font-bold uppercase text-slate-400">Collected</p><p className="text-sm font-bold text-emerald-600">{formatCurrency(collected)}</p></div>
          <div className="text-center"><p className="text-[10px] font-bold uppercase text-slate-400">Disbursed</p><p className="text-sm font-bold text-blue-600">{formatCurrency(disbursed)}</p></div>
          <div className="text-center"><p className="text-[10px] font-bold uppercase text-slate-400">Variance</p><p className={`text-sm font-bold ${variance === 0 ? "text-slate-600" : "text-amber-600"}`}>{formatCurrency(variance)}</p></div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn btn-secondary text-sm">Cancel</button>
          <button type="submit" disabled={saving} className="btn btn-primary bg-blue-600 text-sm hover:bg-blue-700">{saving ? "Locking..." : "Lock Ledger"}</button>
        </div>
      </form>
    </Modal>
  );
}
