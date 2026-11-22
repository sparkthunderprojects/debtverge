import { useMemo, useState } from "react";
import {
  Inbox, Search, Plus, UserCheck, AlertCircle, Archive,
  ShieldAlert, ChevronDown, X, Mail, Phone, MessageSquare,
} from "lucide-react";
import { CHANNEL_META } from "@/apps/debtverge/components/comms/CommsFeed";
import { relativeTime } from "@/core/format";
import type { QueueItem, FilterTab, DepartmentFilter } from "@/apps/debtverge/components/comms/comms-shared";
import {
  FILTER_TABS, DEPARTMENT_FILTERS, PIPELINE_BADGE,
  departmentForPipeline, getInitials, getAvatarColor,
} from "@/apps/debtverge/components/comms/comms-shared";

// ============================================================
// ThreadQueueSidebar — Left Column (320px)
// Queue Navigation, Triage Folders, Department Filters, Thread List
// ============================================================

interface ThreadQueueSidebarProps {
  queue: QueueItem[];
  loading: boolean;
  activeFilter: FilterTab;
  search: string;
  selectedThreadId: string | null;
  agentId: string;
  onFilterChange: (filter: FilterTab) => void;
  onSearchChange: (search: string) => void;
  onThreadSelect: (threadId: string) => void;
  onNewMessage: () => void;
}

export function ThreadQueueSidebar({
  queue, loading, activeFilter, search, selectedThreadId, agentId,
  onFilterChange, onSearchChange, onThreadSelect, onNewMessage,
}: ThreadQueueSidebarProps) {
  const [activeDept, setActiveDept] = useState<DepartmentFilter | null>(null);
  const [deptOpen, setDeptOpen] = useState(false);

  // ---- Compute badge counts for each folder ----
  const folderCounts = useMemo(() => {
    return {
      my_assigned: queue.filter((q) => q.assignedAgentId === agentId && !q.isClosed).length,
      unassigned: queue.filter((q) => !q.assignedAgentId && !q.isClosed).length,
      fca_urgent: queue.filter((q) => q.hasVulnerability && !q.isClosed).length,
      closed: queue.filter((q) => q.isClosed).length,
    };
  }, [queue, agentId]);

  // ---- Filter the queue by folder + department + search ----
  const filteredQueue = useMemo(() => {
    let result = queue;
    switch (activeFilter) {
      case "my_assigned":
        result = result.filter((q) => q.assignedAgentId === agentId && !q.isClosed);
        break;
      case "unassigned":
        result = result.filter((q) => !q.assignedAgentId && !q.isClosed);
        break;
      case "fca_urgent":
        result = result.filter((q) => q.hasVulnerability && !q.isClosed);
        break;
      case "closed":
        result = result.filter((q) => q.isClosed);
        break;
      case "all":
      default:
        result = result.filter((q) => !q.isClosed);
        break;
    }
    if (activeDept) {
      result = result.filter((q) => departmentForPipeline(q.planType) === activeDept);
    }
    if (search.trim()) {
      const sq = search.toLowerCase();
      result = result.filter((item) =>
        item.caseNumber.toLowerCase().includes(sq) ||
        item.debtorName.toLowerCase().includes(sq)
      );
    }
    return result;
  }, [queue, activeFilter, activeDept, search, agentId]);

  const folderIcons: Record<FilterTab, React.ReactNode> = {
    my_assigned: <UserCheck className="h-4 w-4" />,
    unassigned: <AlertCircle className="h-4 w-4" />,
    fca_urgent: <ShieldAlert className="h-4 w-4" />,
    closed: <Archive className="h-4 w-4" />,
    all: <Inbox className="h-4 w-4" />,
  };

  return (
    <div className="panel flex h-full min-h-0 flex-col overflow-hidden p-0">
      {/* ---- Header: Title + New Message button ---- */}
      <div className="shrink-0 border-b border-slate-200 p-3 dark:border-slate-700">
        <div className="mb-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-700 text-white">
              <Inbox className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Triage Inbox</h3>
              <p className="text-[10px] text-slate-400">{queue.filter((q) => !q.isClosed).length} active threads</p>
            </div>
          </div>
          <button
            onClick={onNewMessage}
            className="btn btn-primary bg-emerald-600 px-2.5 py-1.5 text-xs hover:bg-emerald-700"
          >
            <Plus className="h-3.5 w-3.5" />
            New
          </button>
        </div>

        {/* ---- Search ---- */}
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search by name or case ref..."
            className="input pl-8 text-xs"
          />
        </div>
      </div>

      {/* ---- Queue Folders ---- */}
      <div className="shrink-0 space-y-0.5 p-2">
        {FILTER_TABS.map((tab) => {
          const count = folderCounts[tab.id as keyof typeof folderCounts];
          const isActive = activeFilter === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onFilterChange(tab.id)}
              className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium transition-all ${
                isActive
                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
                  : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              }`}
            >
              <span className={isActive ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400"}>
                {folderIcons[tab.id]}
              </span>
              <span className="flex-1 text-left">{tab.label}</span>
              {count > 0 && (
                <span className={`flex h-4.5 min-w-[18px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold ${
                  tab.id === "fca_urgent"
                    ? "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300"
                    : isActive
                    ? "bg-emerald-200 text-emerald-800 dark:bg-emerald-500/30 dark:text-emerald-200"
                    : "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                }`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ---- Department Filters (collapsible) ---- */}
      <div className="shrink-0 border-t border-slate-200 p-2 dark:border-slate-700">
        <button
          onClick={() => setDeptOpen(!deptOpen)}
          className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
        >
          <span>Department Filters</span>
          <ChevronDown className={`h-3 w-3 transition-transform ${deptOpen ? "rotate-180" : ""}`} />
        </button>
        {deptOpen && (
          <div className="mt-1 flex flex-wrap gap-1.5">
            {DEPARTMENT_FILTERS.map((dept) => {
              const isActive = activeDept === dept.id;
              return (
                <button
                  key={dept.id}
                  onClick={() => setActiveDept(isActive ? null : dept.id)}
                  className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-medium transition-all ${
                    isActive
                      ? "bg-slate-700 text-white dark:bg-slate-200 dark:text-slate-800"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${dept.color}`} />
                  {dept.label}
                </button>
              );
            })}
            {activeDept && (
              <button
                onClick={() => setActiveDept(null)}
                className="flex items-center gap-0.5 rounded-full bg-rose-100 px-2 py-1 text-[10px] font-medium text-rose-600 dark:bg-rose-500/20 dark:text-rose-300"
              >
                <X className="h-3 w-3" /> Clear
              </button>
            )}
          </div>
        )}
      </div>

      {/* ---- Thread List ---- */}
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="skeleton h-16 rounded-xl" />
            ))}
          </div>
        ) : filteredQueue.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-slate-400">
            <Inbox className="mb-2 h-8 w-8 opacity-40" />
            <p className="text-xs">No threads in this view</p>
          </div>
        ) : (
          <div className="space-y-1">
            {filteredQueue.map((item) => {
              const isActive = selectedThreadId === item.threadId;
              const meta = item.channel && item.lastMessage ? CHANNEL_META[item.channel] : null;
              return (
                <button
                  key={item.threadId}
                  onClick={() => onThreadSelect(item.threadId)}
                  className={`w-full rounded-xl border p-2.5 text-left transition-all ${
                    isActive
                      ? "border-emerald-500/50 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10"
                      : "border-transparent hover:border-slate-200 hover:bg-slate-50 dark:hover:border-slate-700 dark:hover:bg-slate-800/50"
                  }`}
                >
                  {/* Row 1: Avatar + Name + Case Ref */}
                  <div className="flex items-center gap-2">
                    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white ${getAvatarColor(item.debtorName)}`}>
                      {getInitials(item.debtorName)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-bold text-slate-800 dark:text-slate-100">{item.debtorName}</p>
                      <p className="truncate text-[10px] text-slate-400">{item.caseNumber}</p>
                    </div>
                    {/* Channel icon */}
                    {meta && (
                      <span className={`shrink-0 ${meta.accent}`}>{meta.icon}</span>
                    )}
                  </div>

                  {/* Row 2: Snippet */}
                  {item.lastMessage && (
                    <p className="mt-1.5 truncate pl-11 text-[11px] text-slate-500 dark:text-slate-400">
                      {item.lastMessage.content.subject ?? item.lastMessage.content.body}
                    </p>
                  )}

                  {/* Row 3: Badges + time */}
                  <div className="mt-1.5 flex items-center gap-1.5 pl-11">
                    <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[8px] font-bold ${PIPELINE_BADGE[item.planType]}`}>
                      {item.planType}
                    </span>
                    {item.hasVulnerability && (
                      <span className="flex items-center gap-0.5 shrink-0 rounded-full bg-rose-100 px-1.5 py-0.5 text-[8px] font-bold text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">
                        <ShieldAlert className="h-2.5 w-2.5" /> VULN
                      </span>
                    )}
                    {item.topic && (
                      <span className="shrink-0 truncate rounded-full bg-slate-100 px-1.5 py-0.5 text-[8px] font-medium text-slate-500 dark:bg-slate-700 dark:text-slate-300">
                        {item.topic}
                      </span>
                    )}
                    {item.lastMessage && (
                      <span className="ml-auto shrink-0 text-[9px] text-slate-400">{relativeTime(item.lastMessage.timestamp)}</span>
                    )}
                    {item.unreadCount > 0 && (
                      <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-600 px-1 text-[9px] font-bold text-white">
                        {item.unreadCount}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
