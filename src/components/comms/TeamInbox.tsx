import { useState, useMemo, useEffect, useCallback } from "react";
import {
  Inbox, AlertCircle, ChevronRight, ChevronLeft, Phone, RotateCcw, CalendarClock,
  ExternalLink,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import type {
  DebtVergeCommunication, UnassignedMessage, DebtCase,
} from "@/lib/types";
import {
  useUnassignedMessages, matchUnassignedToCase, sendMessage,
} from "@/lib/comms-hooks";
import { CHANNEL_META } from "@/components/comms/CommsFeed";
import { relativeTime } from "@/lib/format";
import { ThreadQueueSidebar } from "@/components/comms/ThreadQueueSidebar";
import { ActiveThreadWorkspace } from "@/components/comms/ActiveThreadWorkspace";
import { DebtorContextSidebar } from "@/components/comms/DebtorContextSidebar";
import type { QueueItem, FilterTab } from "@/components/comms/comms-shared";
import { mapPlanToPipeline, rowToComm } from "@/components/comms/comms-shared";
import { addAuditMilestone } from "@/lib/debt-hooks";

// ============================================================
// Team Communications Workspace — 3-Column Full-Panel Layout
// ============================================================

export function TeamCommsWorkspace({
  agentId, agentName, selectedCaseId, onViewCaseRecord,
}: { agentId: string; agentName: string; selectedCaseId?: string | null; onViewCaseRecord?: () => void }) {
  // ---- Shared state across all 3 columns ----
  const [activeQueue, setActiveQueue] = useState<FilterTab>("my_assigned");
  const [search, setSearch] = useState("");
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cases, setCases] = useState<DebtCase[]>([]);
  const [vulnCaseIds, setVulnCaseIds] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // ---- Load all cases ----
  useEffect(() => {
    supabase.from("debt_cases").select("*").order("created_at", { ascending: false }).then(({ data, error: err }) => {
      if (err) { setError(err.message); return; }
      setCases((data as DebtCase[] | null) ?? []);
    });
  }, []);

  // ---- Load vulnerability flags per case ----
  useEffect(() => {
    supabase.from("debtverge_vulnerability_flags").select("case_id").then(({ data, error: err }) => {
      if (err) return;
      const ids = new Set<string>(((data as { case_id: string }[] | null) ?? []).map((r) => r.case_id));
      setVulnCaseIds(ids);
    });
  }, []);

  // ---- Load communications grouped by thread ----
  const reloadQueue = useCallback(async () => {
    setLoading(true);
    const { data: comms, error: err } = await supabase
      .from("debtverge_communications")
      .select("*")
      .order("created_at", { ascending: false });
    if (err) { setError(err.message); setLoading(false); return; }

    const allComms = (comms as Record<string, unknown>[] | null) ?? [];
    const byThread = new Map<string, DebtVergeCommunication[]>();

    for (const row of allComms) {
      const mapped = rowToComm(row);
      if (!byThread.has(mapped.threadId)) byThread.set(mapped.threadId, []);
      byThread.get(mapped.threadId)!.push(mapped);
    }

    const items: QueueItem[] = [];
    for (const [threadId, msgs] of byThread) {
      const sorted = msgs.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      const last = sorted[sorted.length - 1];
      const caseData = cases.find((c) => c.id === last.caseId);
      if (!caseData) continue;
      const pipeline = mapPlanToPipeline(caseData.plan_type);
      const isClosed = caseData.status === "closed" || caseData.status === "completed";
      items.push({
        caseId: caseData.id,
        caseNumber: caseData.case_number,
        debtorName: caseData.debtor_name,
        totalDebt: caseData.total_debt,
        monthlyDisposableIncome: caseData.monthly_disposable_income,
        planType: pipeline,
        lastMessage: last,
        messageCount: sorted.length,
        unreadCount: sorted.filter((m) => m.direction === "inbound" && m.status === "delivered").length,
        threadId,
        hasVulnerability: vulnCaseIds.has(caseData.id),
        isClosed,
        assignedAgentId: last.agentId ?? null,
        assignedAgentName: last.agentName ?? null,
        topic: last.content.subject ?? null,
        channel: last.channel,
        debtorEmail: caseData.debtor_reference,
        debtorPhone: null,
        householdSize: 2,
      });
    }
    items.sort((a, b) => {
      const aTime = a.lastMessage ? new Date(a.lastMessage.timestamp).getTime() : 0;
      const bTime = b.lastMessage ? new Date(b.lastMessage.timestamp).getTime() : 0;
      return bTime - aTime;
    });
    setQueue(items);
    setLoading(false);
  }, [cases, vulnCaseIds]);

  useEffect(() => { if (cases.length > 0) reloadQueue(); }, [cases, vulnCaseIds, reloadQueue]);

  // ---- Auto-select thread when a case is chosen elsewhere in the app ----
  useEffect(() => {
    if (!selectedCaseId || queue.length === 0) return;
    const match = queue.find((q) => q.caseId === selectedCaseId);
    if (match) setSelectedThreadId(match.threadId);
  }, [selectedCaseId, queue]);

  // ---- Find selected queue item ----
  const selectedItem = queue.find((q) => q.threadId === selectedThreadId) ?? null;

  // ---- Toast helper ----
  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  // ---- Handlers for right-column actions ----
  async function handleSfsUpdate(caseId: string, newDI: number, _expenses: Record<string, number>) {
    const { error: err } = await supabase
      .from("debt_cases")
      .update({ monthly_disposable_income: newDI, updated_at: new Date().toISOString() })
      .eq("id", caseId);
    if (err) { showToast(`Error: ${err.message}`); return; }
    await addAuditMilestone({
      case_id: caseId,
      milestone: "SFS Quick-Adjust",
      description: `Disposable income updated to £${newDI}/mo from the communications panel.`,
      actor: agentName,
    });
    setCases((prev) => prev.map((c) => c.id === caseId ? { ...c, monthly_disposable_income: newDI } : c));
    showToast(`Disposable income updated to £${newDI}/mo`);
  }

  async function handleStartVoipCall(item: QueueItem) {
    const callLog = {
      durationSeconds: 0,
      direction: "outbound" as const,
      outcome: "completed" as const,
      phoneNumber: item.debtorPhone ?? "Unknown",
    };
    try {
      await sendMessage({
        caseId: item.caseId,
        threadId: item.threadId,
        channel: "internal_note",
        direction: "outbound",
        sender: { name: agentName, emailOrPhone: "", type: "agent" },
        recipient: { name: item.debtorName, emailOrPhone: item.debtorPhone ?? "" },
        agentId,
        agentName,
        content: { body: `[VOIP]${JSON.stringify(callLog)}` },
        status: "delivered",
      });
      await addAuditMilestone({
        case_id: item.caseId,
        milestone: "VoIP Call Initiated",
        description: `Agent ${agentName} started an outbound VoIP call to ${item.debtorName}.`,
        actor: agentName,
      });
      showToast(`VoIP call started for ${item.debtorName}`);
      reloadQueue();
    } catch (e) {
      showToast(`Call failed: ${(e as Error).message}`);
    }
  }

  async function handleIssueBreather(item: QueueItem) {
    try {
      await addAuditMilestone({
        case_id: item.caseId,
        milestone: "30-Day Breather Issued",
        description: `Agent ${agentName} issued a 30-day payment breather for ${item.debtorName}. Creditor contact paused.`,
        actor: agentName,
      });
      showToast(`30-day breather issued for ${item.debtorName}`);
    } catch (e) {
      showToast(`Error: ${(e as Error).message}`);
    }
  }

  async function handleScheduleReview(item: QueueItem) {
    try {
      await addAuditMilestone({
        case_id: item.caseId,
        milestone: "Review Task Scheduled",
        description: `Agent ${agentName} scheduled a case review task for ${item.debtorName}.`,
        actor: agentName,
      });
      showToast(`Review task scheduled for ${item.debtorName}`);
    } catch (e) {
      showToast(`Error: ${(e as Error).message}`);
    }
  }

  async function handleCloseThread() {
    if (!selectedItem) return;
    try {
      await addAuditMilestone({
        case_id: selectedItem.caseId,
        milestone: "Thread Closed",
        description: `Agent ${agentName} closed the communication thread for ${selectedItem.debtorName}.`,
        actor: agentName,
      });
      showToast(`Thread closed for ${selectedItem.debtorName}`);
    } catch (e) {
      showToast(`Error: ${(e as Error).message}`);
    }
  }

  function handleReassign() {
    if (!selectedItem) return;
    showToast("Re-assignment panel coming soon — use the assign button for now.");
  }

  function handleNewMessage() {
    showToast("New message composer — select a case first or use the inbox.");
  }

  return (
    <div className="flex h-[calc(100vh-140px)] gap-3 overflow-hidden">
      {/* Left Column — Thread Queue Sidebar (280px, locked) */}
      <div className="flex w-[280px] shrink-0 flex-col overflow-hidden">
        <ThreadQueueSidebar
          queue={queue}
          loading={loading}
          activeFilter={activeQueue}
          search={search}
          selectedThreadId={selectedThreadId}
          agentId={agentId}
          onFilterChange={setActiveQueue}
          onSearchChange={setSearch}
          onThreadSelect={setSelectedThreadId}
          onNewMessage={handleNewMessage}
        />
      </div>

      {/* Center Column — Active Thread Workspace (flex-1, min 450px) */}
      <div className="flex min-w-[450px] flex-1 flex-col overflow-hidden">
        {selectedItem ? (
          <ActiveThreadWorkspace
            item={selectedItem}
            agentId={agentId}
            agentName={agentName}
            onAssigned={reloadQueue}
            onCloseThread={handleCloseThread}
            onReassign={handleReassign}
            onViewCaseRecord={onViewCaseRecord}
          />
        ) : (
          <div className="panel flex h-full flex-col items-center justify-center text-slate-400">
            <Inbox className="mb-2 h-12 w-12 opacity-30" />
            <p className="text-sm font-medium">Select a thread to view the full client history</p>
            <p className="mt-1 text-xs">Choose a conversation from the left queue</p>
          </div>
        )}
      </div>

      {/* Right Column — Debtor Context Sidebar (300px, locked, collapsible) */}
      <div
        className={`${sidebarCollapsed ? "hidden" : "flex"} w-[300px] shrink-0 flex-col overflow-hidden lg:flex`}
      >
        {selectedItem ? (
          <DebtorContextSidebar
            item={selectedItem}
            onSfsUpdate={handleSfsUpdate}
            onStartVoipCall={handleStartVoipCall}
            onIssueBreather={handleIssueBreather}
            onScheduleReview={handleScheduleReview}
          />
        ) : (
          <div className="panel flex h-full w-full flex-col items-center justify-center text-slate-400">
            <Inbox className="mb-2 h-8 w-8 opacity-30" />
            <p className="text-xs">Client snapshot appears here</p>
          </div>
        )}
      </div>

      {/* Sidebar Collapse Toggle — floating button to expand/collapse right panel */}
      <button
        onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
        className="fixed right-3 top-1/2 z-30 flex h-8 w-6 -translate-y-1/2 items-center justify-center rounded-l-lg border border-slate-200 bg-white text-slate-500 shadow-md transition-all hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700"
        title={sidebarCollapsed ? "Show client snapshot" : "Hide client snapshot"}
      >
        {sidebarCollapsed ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </button>

      {/* Unassigned Messages Banner (floating overlay — preserved) */}
      <UnassignedBanner cases={cases} agentName={agentName} onMatched={reloadQueue} />

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-slate-800 px-4 py-2.5 text-xs font-medium text-white shadow-2xl dark:bg-slate-700">
          {toast}
        </div>
      )}

      {/* Error display */}
      {error && (
        <div className="fixed bottom-4 left-4 z-40 rounded-lg bg-rose-50 px-4 py-2 text-xs text-rose-700 shadow-xl dark:bg-rose-500/20 dark:text-rose-300">
          {error}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Unassigned Messages Banner (preserved from original)
// ============================================================

function UnassignedBanner({
  cases, agentName, onMatched,
}: { cases: DebtCase[]; agentName: string; onMatched: () => void }) {
  const { data: unassigned, loading } = useUnassignedMessages();
  const [expanded, setExpanded] = useState(false);
  const [matching, setMatching] = useState<string | null>(null);

  if (loading || unassigned.length === 0) return null;

  async function handleMatch(messageId: string, caseId: string) {
    setMatching(messageId);
    try {
      await matchUnassignedToCase(messageId, caseId, agentName);
      onMatched();
    } catch (e) {
      console.error("Match failed:", e);
    } finally {
      setMatching(null);
    }
  }

  return (
    <div className="fixed bottom-4 right-4 z-40 w-96 max-w-[calc(100vw-2rem)]">
      <div className="panel border-amber-300 p-3 shadow-xl dark:border-amber-500/40">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex w-full items-center justify-between"
        >
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
              <AlertCircle className="h-4 w-4" />
            </span>
            <span className="text-sm font-bold text-slate-800 dark:text-slate-100">
              {unassigned.length} Unassigned Message{unassigned.length !== 1 ? "s" : ""}
            </span>
          </div>
          <ChevronRight className={`h-4 w-4 text-slate-400 transition-transform ${expanded ? "rotate-90" : ""}`} />
        </button>

        {expanded && (
          <div className="mt-3 max-h-64 space-y-2 overflow-y-auto">
            {unassigned.map((msg) => (
              <UnassignedCard
                key={msg.id}
                message={msg}
                cases={cases}
                onMatch={handleMatch}
                matching={matching === msg.id}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function UnassignedCard({
  message, cases, onMatch, matching,
}: {
  message: UnassignedMessage;
  cases: DebtCase[];
  onMatch: (messageId: string, caseId: string) => void;
  matching: boolean;
}) {
  const [selectedCase, setSelectedCase] = useState("");
  const meta = CHANNEL_META[message.channel];

  return (
    <div className="rounded-lg border border-slate-200 p-2.5 dark:border-slate-700">
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className={`flex h-5 w-5 items-center justify-center rounded ${meta.badge}`}>{meta.icon}</span>
        <span className="text-[10px] font-semibold text-slate-600 dark:text-slate-300">{meta.label}</span>
        <span className="ml-auto text-[10px] text-slate-400">{relativeTime(message.receivedAt)}</span>
      </div>
      <p className="text-xs font-medium text-slate-700 dark:text-slate-200">From: {message.senderName}</p>
      <p className="text-[10px] text-slate-400">{message.senderEmailOrPhone}</p>
      {message.subject && <p className="mt-1 text-xs font-semibold text-slate-600 dark:text-slate-300">{message.subject}</p>}
      <p className="mt-0.5 line-clamp-2 text-[11px] text-slate-500 dark:text-slate-400">{message.body}</p>

      <div className="mt-2 flex gap-1.5">
        <select
          value={selectedCase}
          onChange={(e) => setSelectedCase(e.target.value)}
          className="input flex-1 text-[11px]"
        >
          <option value="">Select case...</option>
          {cases.map((c) => (
            <option key={c.id} value={c.id}>{c.case_number} — {c.debtor_name}</option>
          ))}
        </select>
        <button
          onClick={() => selectedCase && onMatch(message.id, selectedCase)}
          disabled={!selectedCase || matching}
          className="btn btn-primary bg-emerald-600 px-3 text-[11px] hover:bg-emerald-700 disabled:opacity-50"
        >
          {matching ? "..." : "Match"}
        </button>
      </div>
    </div>
  );
}
