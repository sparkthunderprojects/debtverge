import { useState, useEffect, useRef } from "react";
import {
  User, UserCheck, CheckCheck, Send, Paperclip, Library, X, Zap,
  ChevronDown, XCircle, Phone, PlayCircle, Clock, FileText,
  Landmark, CreditCard, MousePointerClick, FolderOpen, ExternalLink,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { CHANNEL_META, FCA_TEMPLATES, type FcaTemplate } from "@/components/comms/CommsFeed";
import { formatDateTime, formatDuration } from "@/lib/format";
import { assignThreadToAgent, sendMessage } from "@/lib/comms-hooks";
import { queueMessage } from "@/lib/outbox-hooks";
import { ComplaintFlagBanner } from "@/components/debt/ComplaintFlagBanner";
import type { DebtVergeCommunication, CommsChannel, SendMessagePayload } from "@/lib/types";
import type { QueueItem } from "@/components/comms/comms-shared";
import {
  rowToComm, isVoipCallLog, ACTION_CARDS,
  getInitials, getAvatarColor,
} from "@/components/comms/comms-shared";

// ============================================================
// ActiveThreadWorkspace — Center Column (flex-1)
// Conversation Timeline + Outbound Multi-Channel Composer
// ============================================================

interface ActiveThreadWorkspaceProps {
  item: QueueItem;
  agentId: string;
  agentName: string;
  onAssigned: () => void;
  onCloseThread: () => void;
  onReassign: () => void;
  onViewCaseRecord?: () => void;
}

export function ActiveThreadWorkspace({
  item, agentId, agentName, onAssigned, onCloseThread, onReassign, onViewCaseRecord,
}: ActiveThreadWorkspaceProps) {
  const [messages, setMessages] = useState<DebtVergeCommunication[]>([]);
  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true);
    supabase
      .from("debtverge_communications")
      .select("*")
      .eq("case_id", item.caseId)
      .order("created_at", { ascending: true })
      .then(({ data, error }) => {
        if (error) { setLoading(false); return; }
        const mapped = ((data as Record<string, unknown>[] | null) ?? []).map(rowToComm);
        setMessages(mapped);
        setLoading(false);
      });
  }, [item.caseId, item.threadId]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  async function handleAssign() {
    setAssigning(true);
    try {
      await assignThreadToAgent(item.threadId, agentId, agentName);
      onAssigned();
    } finally {
      setAssigning(false);
    }
  }

  const isAssignedToMe = item.assignedAgentId === agentId;

  return (
    <div className="panel flex h-full flex-col overflow-hidden p-0">
      {/* ---- Thread Header with Active Context Banner ---- */}
      <div className="shrink-0 border-b border-slate-200 dark:border-slate-700">
        <div className="flex items-center justify-between gap-2 p-3">
          {/* Left: Debtor info + channel status */}
          <div className="flex items-center gap-2.5">
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${getAvatarColor(item.debtorName)}`}>
              {getInitials(item.debtorName)}
            </div>
            <div className="min-w-0">
              <h3 className="truncate text-sm font-bold text-slate-800 dark:text-slate-100">{item.debtorName}</h3>
              <div className="flex items-center gap-2 text-[10px] text-slate-400">
                <span>{item.caseNumber}</span>
                <span>·</span>
                <span>{item.messageCount} messages</span>
                {item.channel && (
                  <>
                    <span>·</span>
                    <span className="flex items-center gap-0.5">
                      <span className={`h-1.5 w-1.5 rounded-full ${item.channel === "email" ? "bg-blue-500" : item.channel === "whatsapp" ? "bg-emerald-500" : "bg-teal-500"}`} />
                      {CHANNEL_META[item.channel].label}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Right: Assigned agent + action buttons */}
          <div className="flex shrink-0 items-center gap-2">
            {/* Assigned agent avatar */}
            {item.assignedAgentName ? (
              <div className="flex items-center gap-1.5 rounded-full bg-slate-100 px-2 py-1 dark:bg-slate-800">
                <div className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-600 text-[9px] font-bold text-white">
                  {getInitials(item.assignedAgentName)}
                </div>
                <span className="text-[10px] font-medium text-slate-600 dark:text-slate-300">{item.assignedAgentName}</span>
              </div>
            ) : (
              <span className="text-[10px] text-slate-400">Unassigned</span>
            )}

            {/* Assign to me */}
            {!isAssignedToMe && (
              <button
                onClick={handleAssign}
                disabled={assigning}
                className="btn btn-secondary px-2.5 py-1.5 text-xs"
              >
                <UserCheck className="h-3.5 w-3.5" />
                {assigning ? "..." : "Assign to Me"}
              </button>
            )}

            {/* Re-assign */}
            <button
              onClick={onReassign}
              className="btn btn-secondary px-2.5 py-1.5 text-xs"
            >
              <ChevronDown className="h-3.5 w-3.5" />
              Re-assign
            </button>

            {/* View Full Master Case Record */}
            {onViewCaseRecord && (
              <button
                onClick={onViewCaseRecord}
                className="btn btn-secondary px-2.5 py-1.5 text-xs"
                title="Open the full master case record (SFS / pipeline view)"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                View Full Master Case Record
              </button>
            )}

            {/* Close thread */}
            <button
              onClick={onCloseThread}
              className="btn btn-secondary px-2.5 py-1.5 text-xs text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10"
            >
              <XCircle className="h-3.5 w-3.5" />
              Close
            </button>
          </div>
        </div>

        {/* Active Context Banner */}
        <div className="flex items-center gap-2 border-t border-slate-100 bg-slate-50 px-3 py-1.5 dark:border-slate-700/50 dark:bg-slate-800/50">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Active Client</span>
          <span className="text-xs font-medium text-slate-700 dark:text-slate-300">{item.debtorName}</span>
          <span className="text-[10px] text-slate-400">·</span>
          <span className="text-[10px] text-slate-400">Case Ref: {item.caseNumber}</span>
        </div>
      </div>

      <ComplaintFlagBanner caseId={item.caseId} clientName={item.debtorName} />

      {/* ---- Conversation Timeline ---- */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-slate-400">Loading conversation timeline...</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-slate-400">
            <FolderOpen className="mb-2 h-10 w-10 opacity-30" />
            <p className="text-sm">No messages in this thread yet</p>
            <p className="mt-1 text-xs">Use the composer below to send the first message</p>
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((msg) => {
              const voip = isVoipCallLog(msg);
              if (voip) return <VoipCallBubble key={msg.id} message={msg} voip={voip} />;
              return <CompactMessage key={msg.id} message={msg} />;
            })}
          </div>
        )}
      </div>

      {/* ---- Composer ---- */}
      <ThreadComposer
        item={item}
        agentId={agentId}
        agentName={agentName}
        onSent={onAssigned}
      />
    </div>
  );
}

// ============================================================
// Compact Message Bubble
// ============================================================

function CompactMessage({ message }: { message: DebtVergeCommunication }) {
  const meta = CHANNEL_META[message.channel];
  const isOutbound = message.direction === "outbound";
  const isInternal = message.channel === "internal_note";

  return (
    <div className={`flex ${isOutbound ? "justify-end" : "justify-start"} fade-in`}>
      <div className={`max-w-[70%] rounded-2xl border p-3.5 ${
        isInternal
          ? "border-amber-300 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-500/10"
          : isOutbound
          ? "border-emerald-200 bg-emerald-50 dark:border-emerald-500/20 dark:bg-emerald-500/10"
          : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800"
      }`}>
        {/* Header row */}
        <div className={`mb-1.5 flex items-center gap-1.5 ${isInternal ? "" : isOutbound ? "flex-row-reverse" : ""}`}>
          <span className={`flex h-6 w-6 items-center justify-center rounded-lg ${meta.badge}`}>{meta.icon}</span>
          <div className={isOutbound && !isInternal ? "text-right" : "text-left"}>
            <span className="text-[10px] font-semibold text-slate-600 dark:text-slate-300">
              {isOutbound ? (message.agentName ?? "Agent") : message.sender.name}
            </span>
          </div>
          {message.channel === "whatsapp" && isOutbound && (
            <span className={`ml-auto flex items-center gap-0.5 ${message.status === "read" ? "text-blue-500" : "text-slate-400"}`}>
              <CheckCheck className="h-3 w-3" />
            </span>
          )}
        </div>

        {message.content.subject && (
          <p className="mb-1 text-xs font-bold text-slate-800 dark:text-slate-100">{message.content.subject}</p>
        )}
        <p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">{message.content.body}</p>

        {/* Attachments */}
        {message.content.attachments && message.content.attachments.length > 0 && (
          <div className="mt-2 space-y-1 border-t border-slate-200 pt-2 dark:border-slate-700">
            {message.content.attachments.map((att, i) => (
              <div key={i} className="flex items-center gap-1.5 rounded-lg bg-slate-50 px-2 py-1 text-[11px] dark:bg-slate-700/50">
                <Paperclip className="h-3 w-3 text-slate-400" />
                <span className="truncate text-slate-600 dark:text-slate-300">{att}</span>
              </div>
            ))}
          </div>
        )}

        <p className="mt-1.5 text-[10px] text-slate-400">{formatDateTime(message.timestamp)}</p>
      </div>
    </div>
  );
}

// ============================================================
// VoIP Call Bubble (internal_note with [VOIP] prefix)
// ============================================================

function VoipCallBubble({ message, voip }: { message: DebtVergeCommunication; voip: { durationSeconds: number; direction: string; outcome: string; phoneNumber: string } }) {
  const isInbound = voip.direction === "inbound";
  const outcomeColor: Record<string, string> = {
    completed: "text-emerald-600 dark:text-emerald-400",
    missed: "text-rose-600 dark:text-rose-400",
    voicemail: "text-amber-600 dark:text-amber-400",
    declined: "text-slate-400",
  };

  return (
    <div className="flex justify-center fade-in">
      <div className="flex max-w-[70%] items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
          voip.outcome === "missed" ? "bg-rose-100 dark:bg-rose-500/20" : "bg-blue-100 dark:bg-blue-500/20"
        }`}>
          <Phone className={`h-4 w-4 ${voip.outcome === "missed" ? "text-rose-600 dark:text-rose-400" : "text-blue-600 dark:text-blue-400"}`} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
              {isInbound ? "Inbound" : "Outbound"} Call
            </span>
            <span className={`text-[10px] font-semibold capitalize ${outcomeColor[voip.outcome]}`}>
              {voip.outcome}
            </span>
          </div>
          <p className="text-[10px] text-slate-400">{voip.phoneNumber}</p>
          <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-400">
            {voip.outcome !== "missed" && (
              <span className="flex items-center gap-0.5">
                <Clock className="h-3 w-3" />
                {formatDuration(voip.durationSeconds)}
              </span>
            )}
            {voip.outcome === "completed" && (
              <button className="flex items-center gap-0.5 text-blue-600 hover:text-blue-700 dark:text-blue-400">
                <PlayCircle className="h-3 w-3" />
                Play recording
              </button>
            )}
            <span className="ml-auto">{formatDateTime(message.timestamp)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Thread Composer — Multi-Channel + FCA Templates + Action Cards
// ============================================================

const ACTION_CARD_ICONS: Record<string, React.ReactNode> = {
  Landmark: <Landmark className="h-4 w-4" />,
  FileText: <FileText className="h-4 w-4" />,
  CreditCard: <CreditCard className="h-4 w-4" />,
};

function ThreadComposer({
  item, agentId, agentName, onSent,
}: { item: QueueItem; agentId: string; agentName: string; onSent: () => void }) {
  const [channel, setChannel] = useState<CommsChannel>(item.channel === "sms" || item.channel === "whatsapp" ? item.channel : "email");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showActionCards, setShowActionCards] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const charLimit = channel === "sms" ? 160 : channel === "whatsapp" ? 4096 : 0;
  const charCount = body.length;
  const overLimit = charLimit > 0 && charCount > charLimit;

  function applyTemplate(template: FcaTemplate) {
    setChannel(template.channel);
    if (template.subject) setSubject(template.subject);
    setBody(template.body.replace(/{client_name}/g, item.debtorName));
    setShowTemplates(false);
  }

  function applyActionCard(cardId: string) {
    const card = ACTION_CARDS.find((c) => c.id === cardId);
    if (!card) return;
    setChannel("email");
    setSubject(`Action Required: ${card.label}`);
    setBody(
      `Dear ${item.debtorName},\n\n${card.description}\n\nPlease use the secure link below to complete this action:\n[Secure Portal Link]\n\nKind regards,\n${agentName}\nDebtVerge Advisory Team`
    );
    setShowActionCards(false);
  }

  function handleAttach() {
    const name = prompt("Attachment file name:");
    if (name) setAttachments((prev) => [...prev, name]);
  }

  async function handleSubmit(closeThread?: boolean) {
    if (!body.trim()) return;
    setSending(true);
    setSendError(null);
    try {
      const payload: SendMessagePayload = {
        caseId: item.caseId,
        threadId: item.threadId,
        channel,
        direction: "outbound",
        sender: { name: agentName, emailOrPhone: "", type: "agent" },
        recipient: { name: item.debtorName, emailOrPhone: "" },
        agentId,
        agentName,
        content: {
          subject: channel === "email" ? subject : undefined,
          body,
          attachments: attachments.length > 0 ? attachments : undefined,
        },
        status: "delivered",
      };
      if (channel === "email" || channel === "sms" || channel === "whatsapp") {
        // real send path: the outbox delivers it and the conversation shows its true status
        await queueMessage(item.caseId, channel, subject, body.trim(), item.threadId, agentName);
      } else {
        await sendMessage(payload);
      }
      setSubject("");
      setBody("");
      setAttachments([]);
      onSent();
    } catch (e) {
      setSendError((e as Error).message);
    } finally {
      setSending(false);
    }
    if (closeThread) void closeThread;
  }

  return (
    <div className="shrink-0 border-t border-slate-200 p-3 dark:border-slate-700">
      {/* Channel Tabs */}
      <div className="mb-2.5 flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1 dark:border-slate-700 dark:bg-slate-800/50">
        {(Object.keys(CHANNEL_META) as CommsChannel[]).map((ch) => (
          <button
            key={ch}
            onClick={() => setChannel(ch)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-all ${
              channel === ch
                ? "bg-white text-slate-800 shadow-sm dark:bg-slate-700 dark:text-slate-100"
                : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
          >
            {CHANNEL_META[ch].icon}
            {CHANNEL_META[ch].label}
          </button>
        ))}
      </div>

      {/* FCA Template Dropdown */}
      {showTemplates && (
        <div className="mb-2.5 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg dark:border-slate-700 dark:bg-slate-800">
          <div className="mb-1.5 flex items-center justify-between px-2">
            <span className="text-xs font-bold text-slate-700 dark:text-slate-200">FCA Template Library</span>
            <button onClick={() => setShowTemplates(false)} className="text-slate-400 hover:text-slate-600">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="max-h-48 overflow-y-auto">
            {FCA_TEMPLATES.map((tpl) => (
              <button
                key={tpl.id}
                onClick={() => applyTemplate(tpl)}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-all hover:bg-slate-50 dark:hover:bg-slate-700"
              >
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${CHANNEL_META[tpl.channel].badge}`}>
                  {CHANNEL_META[tpl.channel].icon}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-slate-700 dark:text-slate-200">{tpl.label}</p>
                  <p className="truncate text-[10px] text-slate-400">{CHANNEL_META[tpl.channel].label}</p>
                </div>
                <Zap className="h-3.5 w-3.5 shrink-0 text-amber-500" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Error */}
      {sendError && (
        <div className="mb-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">
          {sendError}
        </div>
      )}

      {/* Subject line for email */}
      {channel === "email" && (
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Subject line..."
          className="input mb-2 text-sm"
        />
      )}

      {/* Body textarea */}
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={`Compose ${CHANNEL_META[channel].label}...`}
        rows={channel === "internal_note" ? 3 : 4}
        className="input text-sm"
      />

      {/* Footer: char counter, templates, action cards, attachments, send */}
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {charLimit > 0 && (
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
              overLimit
                ? "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300"
                : charCount > charLimit * 0.8
                ? "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300"
                : "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300"
            }`}>
              {charCount}/{charLimit}
            </span>
          )}

          {/* FCA Templates */}
          <button
            onClick={() => { setShowTemplates(!showTemplates); setShowActionCards(false); }}
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all ${
              showTemplates
                ? "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300"
                : "text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700"
            }`}
          >
            <Library className="h-3.5 w-3.5" />
            FCA Templates
          </button>

          {/* Insert Interactive Action Card */}
          <ActionCardDropdown
            open={showActionCards}
            onToggle={() => { setShowActionCards(!showActionCards); setShowTemplates(false); }}
            onSelect={applyActionCard}
          />

          {/* Attachments (email only) */}
          {channel === "email" && (
            <button
              onClick={handleAttach}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-500 transition-all hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700"
            >
              <Paperclip className="h-3.5 w-3.5" />
              {attachments.length > 0 ? `${attachments.length} file${attachments.length !== 1 ? "s" : ""}` : "Attach"}
            </button>
          )}

          {/* SMS/WhatsApp inline templates */}
          {(channel === "sms" || channel === "whatsapp") && (
            <TemplateDropdown
              channel={channel}
              onSelect={(tpl) => { setBody(tpl.body.replace(/{client_name}/g, item.debtorName)); }}
            />
          )}
        </div>

        {/* Send buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleSubmit(false)}
            disabled={sending || !body.trim() || overLimit}
            className="btn btn-primary bg-emerald-600 text-sm hover:bg-emerald-700 disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
            {sending ? "Sending..." : "Send Message"}
          </button>
          <button
            onClick={() => handleSubmit(true)}
            disabled={sending || !body.trim() || overLimit}
            className="btn btn-secondary text-sm disabled:opacity-50"
          >
            Send & Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Action Card Dropdown
// ============================================================

function ActionCardDropdown({
  open, onToggle, onSelect,
}: { open: boolean; onToggle: () => void; onSelect: (id: string) => void }) {
  return (
    <div className="relative">
      <button
        onClick={onToggle}
        className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all ${
          open
            ? "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300"
            : "text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700"
        }`}
      >
        <MousePointerClick className="h-3.5 w-3.5" />
        Action Card
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={onToggle} />
          <div className="absolute bottom-full left-0 z-20 mb-1 w-64 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-800">
            <p className="mb-1.5 px-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">Insert Interactive Action Card</p>
            {ACTION_CARDS.map((card) => (
              <button
                key={card.id}
                onClick={() => onSelect(card.id)}
                className="flex w-full items-start gap-2.5 rounded-lg p-2 text-left transition-all hover:bg-slate-50 dark:hover:bg-slate-700"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400">
                  {ACTION_CARD_ICONS[card.icon]}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">{card.label}</p>
                  <p className="mt-0.5 line-clamp-2 text-[10px] text-slate-400">{card.description}</p>
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ============================================================
// Template Dropdown (SMS / WhatsApp inline)
// ============================================================

function TemplateDropdown({
  channel, onSelect,
}: { channel: CommsChannel; onSelect: (tpl: FcaTemplate) => void }) {
  const [open, setOpen] = useState(false);
  const templates = FCA_TEMPLATES.filter((t) => t.channel === channel);
  if (templates.length === 0) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-500 transition-all hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700"
      >
        Templates <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full left-0 z-20 mb-1 w-56 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-800">
            {templates.map((tpl) => (
              <button
                key={tpl.id}
                onClick={() => { onSelect(tpl); setOpen(false); }}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-slate-600 transition-all hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700"
              >
                {tpl.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
