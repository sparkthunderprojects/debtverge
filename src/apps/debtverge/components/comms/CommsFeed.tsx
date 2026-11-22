import { useState, useRef, useEffect, useMemo } from "react";
import {
  Mail, Phone, MessageSquare, StickyNote, Send, Paperclip,
  CheckCheck, Check, AlertTriangle, Clock, Download,
  ChevronDown, Library, X, User, Zap,
} from "lucide-react";
import type {
  DebtVergeCommunication, CommsChannel, SendMessagePayload,
} from "@/core/types";
import {
  useCaseCommunications, sendMessage, updateCommunicationStatus,
} from "@/apps/debtverge/lib/comms-hooks";
import { formatDateTime, relativeTime } from "@/core/format";

// ============================================================
// Channel Metadata
// ============================================================

const CHANNEL_META: Record<CommsChannel, {
  label: string;
  icon: React.ReactNode;
  accent: string;
  badge: string;
}> = {
  email: {
    label: "Email",
    icon: <Mail className="h-4 w-4" />,
    accent: "text-blue-600 dark:text-blue-400",
    badge: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300",
  },
  sms: {
    label: "SMS",
    icon: <Phone className="h-4 w-4" />,
    accent: "text-teal-600 dark:text-teal-400",
    badge: "bg-teal-100 text-teal-700 dark:bg-teal-500/20 dark:text-teal-300",
  },
  whatsapp: {
    label: "WhatsApp",
    icon: <MessageSquare className="h-4 w-4" />,
    accent: "text-emerald-600 dark:text-emerald-400",
    badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
  },
  internal_note: {
    label: "Internal Note",
    icon: <StickyNote className="h-4 w-4" />,
    accent: "text-amber-600 dark:text-amber-400",
    badge: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
  },
};

const STATUS_ICON: Record<string, React.ReactNode> = {
  delivered: <Check className="h-3 w-3" />,
  read: <CheckCheck className="h-3 w-3" />,
  failed: <AlertTriangle className="h-3 w-3" />,
  queued: <Clock className="h-3 w-3" />,
};

const STATUS_COLOR: Record<string, string> = {
  delivered: "text-slate-400",
  read: "text-blue-500",
  failed: "text-rose-500",
  queued: "text-amber-500",
};

// ============================================================
// FCA Template Library
// ============================================================

interface FcaTemplate {
  id: string;
  label: string;
  channel: CommsChannel;
  subject?: string;
  body: string;
}

const FCA_TEMPLATES: FcaTemplate[] = [
  {
    id: "sfs_reminder",
    label: "Send SFS Reminder",
    channel: "email",
    subject: "Action Required: Complete Your Statement of Financial Affairs",
    body: "Dear {client_name},\n\nWe are writing to remind you that your Statement of Financial Affairs (SFS) has not yet been completed. To progress your case, we require this information to assess your financial situation and recommend the most suitable debt solution.\n\nPlease log in to your client portal or contact us to schedule a budget review appointment.\n\nKind regards,\n{agent_name}\nDebtVerge Advisory Team",
  },
  {
    id: "dmp_receipt",
    label: "DMP Payment Receipt",
    channel: "email",
    subject: "DMP Monthly Payment Confirmation",
    body: "Dear {client_name},\n\nWe confirm receipt of your monthly DMP payment of {payment_amount}. Funds have been distributed to your creditors per the agreed pro-rata schedule.\n\nA detailed breakdown is available in your client portal.\n\nKind regards,\n{agent_name}\nDebtVerge Advisory Team",
  },
  {
    id: "meeting_call_link",
    label: "Meeting Call Link",
    channel: "sms",
    body: "Hello {client_name}, your advisory appointment with {agent_name} is scheduled for {meeting_time}. Join via: {call_link}. Reply STOP to opt out. DebtVerge",
  },
  {
    id: "whatsapp_followup",
    label: "WhatsApp Follow-Up",
    channel: "whatsapp",
    body: "Hi {client_name}, this is {agent_name} from DebtVerge. Just following up on your case — do you have any questions about your debt plan? Feel free to reply here.",
  },
  {
    id: "vulnerability_check",
    label: "Vulnerability Welfare Check",
    channel: "email",
    subject: "Checking In — Your Wellbeing Matters",
    body: "Dear {client_name},\n\nAs part of our commitment to supporting vulnerable clients, we want to check in and ensure you have access to the right support. If your circumstances have changed or you need additional assistance, please let us know.\n\nFree independent debt advice is also available from StepChange (0800 138 1111) or Citizens Advice.\n\nWarm regards,\n{agent_name}\nDebtVerge Advisory Team",
  },
  {
    id: "annual_review",
    label: "Annual Review Notice",
    channel: "email",
    subject: "Your Annual Debt Plan Review Is Due",
    body: "Dear {client_name},\n\nYour annual review is now due. We need to reassess your financial situation to ensure your debt plan remains affordable and appropriate.\n\nPlease complete the updated SFS budget in your portal within 14 days.\n\nKind regards,\n{agent_name}\nDebtVerge Advisory Team",
  },
];

// ============================================================
// Case Communications Feed Tab
// ============================================================

interface CaseCommsFeedProps {
  caseId: string;
  clientName: string;
  clientEmail?: string | null;
  clientPhone?: string | null;
  agentId: string;
  agentName: string;
}

export function CaseCommsFeed({
  caseId, clientName, clientEmail, clientPhone, agentId, agentName,
}: CaseCommsFeedProps) {
  const { data: messages, loading, error, reload } = useCaseCommunications(caseId);
  const [composerChannel, setComposerChannel] = useState<CommsChannel>("email");
  const [showTemplates, setShowTemplates] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const groupedByDay = useMemo(() => groupMessagesByDay(messages), [messages]);

  async function handleSend(payload: Omit<SendMessagePayload, "caseId" | "agentId" | "agentName" | "direction">, closeThread?: boolean) {
    setSending(true);
    setSendError(null);
    try {
      await sendMessage({
        ...payload,
        caseId,
        direction: "outbound",
        agentId,
        agentName,
        sender: { name: agentName, emailOrPhone: composerChannel === "email" ? "" : (clientPhone ?? ""), type: "agent" },
        recipient: {
          name: clientName,
          emailOrPhone: composerChannel === "email" ? (clientEmail ?? "") : (clientPhone ?? ""),
        },
        status: "delivered",
      });
      reload();
    } catch (e) {
      setSendError((e as Error).message);
    } finally {
      setSending(false);
    }
    if (closeThread) void closeThread;
  }

  return (
    <div className="flex h-full flex-col gap-3">
      {/* Header */}
      <div className="panel flex shrink-0 items-center justify-between p-4 fade-in">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 dark:bg-emerald-500/10">
            <Mail className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Communications & Audit Feed</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {messages.length} message{messages.length !== 1 ? "s" : ""} across all channels
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {(Object.keys(CHANNEL_META) as CommsChannel[]).map((ch) => {
            const count = messages.filter((m) => m.channel === ch).length;
            if (count === 0) return null;
            return (
              <span key={ch} className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${CHANNEL_META[ch].badge}`}>
                {CHANNEL_META[ch].icon}
                {count}
              </span>
            );
          })}
        </div>
      </div>

      {/* Message Stream */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-slate-400">Loading communications...</p>
          </div>
        ) : error ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-rose-500">{error}</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-slate-400">
            <Mail className="mb-2 h-10 w-10 opacity-30" />
            <p className="text-sm">No communications yet</p>
            <p className="mt-1 text-xs">Use the composer below to send the first message</p>
          </div>
        ) : (
          <div className="space-y-4 px-1">
            {groupedByDay.map((group) => (
              <div key={group.dayKey}>
                <div className="mb-3 flex items-center gap-3">
                  <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    {group.dayLabel}
                  </span>
                  <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
                </div>
                {group.messages.map((msg) => (
                  <MessageBubble key={msg.id} message={msg} agentName={agentName} />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Composer */}
      <Composer
        channel={composerChannel}
        onChannelChange={setComposerChannel}
        onSend={handleSend}
        sending={sending}
        sendError={sendError}
        showTemplates={showTemplates}
        onToggleTemplates={() => setShowTemplates(!showTemplates)}
        clientName={clientName}
      />
    </div>
  );
}

// ============================================================
// Message Bubble
// ============================================================

function MessageBubble({ message, agentName: currentAgent }: { message: DebtVergeCommunication; agentName: string }) {
  const meta = CHANNEL_META[message.channel];
  const isOutbound = message.direction === "outbound";
  const isInternal = message.channel === "internal_note";

  if (isInternal) {
    return (
      <div className="mb-3 fade-in">
        <div className="ml-auto max-w-[85%] rounded-xl border border-amber-200 bg-amber-50 p-3.5 dark:border-amber-500/30 dark:bg-amber-500/10">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={`flex h-6 w-6 items-center justify-center rounded-lg ${meta.badge}`}>{meta.icon}</span>
              <span className="text-xs font-bold text-amber-700 dark:text-amber-300">Internal Agent Note</span>
              <LockBadge label="Agent Only" />
            </div>
          </div>
          <p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">{message.content.body}</p>
          <AuditStamp message={message} currentAgent={currentAgent} />
        </div>
      </div>
    );
  }

  return (
    <div className={`mb-3 flex ${isOutbound ? "justify-end" : "justify-start"} fade-in`}>
      <div className={`max-w-[75%] ${isOutbound ? "items-end" : "items-start"} flex flex-col`}>
        {/* Channel + sender header */}
        <div className={`mb-1 flex items-center gap-2 ${isOutbound ? "flex-row-reverse" : ""}`}>
          <span className={`flex h-6 w-6 items-center justify-center rounded-lg ${meta.badge}`}>{meta.icon}</span>
          <div className={isOutbound ? "text-right" : "text-left"}>
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
              {isOutbound ? (message.agentName ?? "Agent") : message.sender.name}
            </span>
            <span className="ml-1.5 text-[10px] text-slate-400">{meta.label}</span>
          </div>
        </div>

        {/* Bubble body */}
        <div className={`rounded-2xl border p-3.5 ${
          isOutbound
            ? "border-emerald-200 bg-emerald-50 dark:border-emerald-500/20 dark:bg-emerald-500/10"
            : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800"
        }`}>
          {message.content.subject && (
            <p className="mb-1.5 text-xs font-bold text-slate-800 dark:text-slate-100">
              {message.content.subject}
            </p>
          )}
          <p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-200">{message.content.body}</p>

          {/* SMS character count badge */}
          {message.channel === "sms" && (
            <div className="mt-2 flex items-center gap-1">
              <span className="rounded-full bg-teal-100 px-2 py-0.5 text-[9px] font-medium text-teal-700 dark:bg-teal-500/20 dark:text-teal-300">
                {message.content.body.length} chars
              </span>
              {message.content.body.length > 160 && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-medium text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
                  Multi-part SMS
                </span>
              )}
            </div>
          )}

          {/* WhatsApp read receipts */}
          {message.channel === "whatsapp" && isOutbound && (
            <div className={`mt-1.5 flex items-center justify-end gap-1 ${STATUS_COLOR[message.status]}`}>
              {STATUS_ICON[message.status]}
              <span className="text-[10px]">
                {message.status === "read" ? "Read" : message.status === "delivered" ? "Delivered" : message.status}
              </span>
            </div>
          )}

          {/* Attachments */}
          {message.content.attachments && message.content.attachments.length > 0 && (
            <div className="mt-2.5 space-y-1.5 border-t border-slate-200 pt-2 dark:border-slate-700">
              {message.content.attachments.map((att, i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 dark:bg-slate-700/50">
                  <Paperclip className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                  <span className="flex-1 truncate text-xs text-slate-600 dark:text-slate-300">{att}</span>
                  <Download className="h-3.5 w-3.5 shrink-0 cursor-pointer text-blue-500 hover:text-blue-600" />
                </div>
              ))}
            </div>
          )}
        </div>

        <AuditStamp message={message} currentAgent={currentAgent} compact />
      </div>
    </div>
  );
}

function LockBadge({ label }: { label: string }) {
  return (
    <span className="flex items-center gap-0.5 rounded-full bg-amber-200/60 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700 dark:bg-amber-500/20 dark:text-amber-400">
      <X className="h-2.5 w-2.5" /> {label}
    </span>
  );
}

function AuditStamp({ message, currentAgent, compact }: { message: DebtVergeCommunication; currentAgent: string; compact?: boolean }) {
  const isHandledByCurrent = message.agentName === currentAgent;
  return (
    <div className={`flex items-center gap-1.5 ${compact ? "mt-1.5" : "mt-2"} text-[10px] text-slate-400`}>
      <User className="h-3 w-3" />
      <span>
        Handled by: <span className={`font-medium ${isHandledByCurrent ? "text-emerald-600 dark:text-emerald-400" : "text-slate-500 dark:text-slate-400"}`}>{message.agentName ?? "System"}</span>
        {" — "}
        {formatDateTime(message.timestamp)}
      </span>
      {message.matchedAutomatically === false && (
        <span className="ml-1 rounded-full bg-blue-100 px-1.5 py-0.5 text-[9px] font-medium text-blue-700 dark:bg-blue-500/20 dark:text-blue-300">
          Manually matched
        </span>
      )}
    </div>
  );
}

// ============================================================
// Composer
// ============================================================

interface ComposerProps {
  channel: CommsChannel;
  onChannelChange: (ch: CommsChannel) => void;
  onSend: (payload: Omit<SendMessagePayload, "caseId" | "agentId" | "agentName" | "direction">, closeThread?: boolean) => void;
  sending: boolean;
  sendError: string | null;
  showTemplates: boolean;
  onToggleTemplates: () => void;
  clientName: string;
}

function Composer({
  channel, onChannelChange, onSend, sending, sendError,
  showTemplates, onToggleTemplates, clientName,
}: ComposerProps) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);

  const charLimit = channel === "sms" ? 160 : channel === "whatsapp" ? 4096 : 0;
  const charCount = body.length;
  const overLimit = charLimit > 0 && charCount > charLimit;

  function applyTemplate(template: FcaTemplate) {
    onChannelChange(template.channel);
    if (template.subject) setSubject(template.subject);
    setBody(template.body.replace(/{client_name}/g, clientName));
    onToggleTemplates();
  }

  function handleAttach() {
    const name = prompt("Attachment file name:");
    if (name) setAttachments((prev) => [...prev, name]);
  }

  function handleSubmit(closeThread?: boolean) {
    if (!body.trim()) return;
    const payload: Omit<SendMessagePayload, "caseId" | "agentId" | "agentName" | "direction"> = {
      channel,
      sender: { name: "", emailOrPhone: "", type: "agent" },
      recipient: { name: clientName, emailOrPhone: "" },
      content: {
        subject: channel === "email" ? subject : undefined,
        body,
        attachments: attachments.length > 0 ? attachments : undefined,
      },
    };
    onSend(payload, closeThread);
    setSubject("");
    setBody("");
    setAttachments([]);
  }

  return (
    <div className="panel shrink-0 p-3 fade-in">
      {/* Channel Tabs */}
      <div className="mb-2.5 flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1 dark:border-slate-700 dark:bg-slate-800/50">
        {(Object.keys(CHANNEL_META) as CommsChannel[]).map((ch) => (
          <button
            key={ch}
            onClick={() => onChannelChange(ch)}
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
            <button onClick={onToggleTemplates} className="text-slate-400 hover:text-slate-600">
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

      {/* Footer: char counter, templates, attachments, send */}
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {/* Character counter for SMS / WhatsApp */}
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

          {/* Template picker button */}
          <button
            onClick={onToggleTemplates}
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all ${
              showTemplates
                ? "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300"
                : "text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700"
            }`}
          >
            <Library className="h-3.5 w-3.5" />
            FCA Templates
          </button>

          {/* Attachment uploader (email only) */}
          {channel === "email" && (
            <button
              onClick={handleAttach}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-500 transition-all hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700"
            >
              <Paperclip className="h-3.5 w-3.5" />
              {attachments.length > 0 ? `${attachments.length} file${attachments.length !== 1 ? "s" : ""}` : "Attach"}
            </button>
          )}

          {/* Template dropdown for SMS/WhatsApp */}
          {(channel === "sms" || channel === "whatsapp") && (
            <TemplateDropdown
              channel={channel}
              clientName={clientName}
              onSelect={(tpl) => { setBody(tpl.body.replace(/{client_name}/g, clientName)); }}
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

function TemplateDropdown({
  channel, clientName, onSelect,
}: { channel: CommsChannel; clientName: string; onSelect: (tpl: FcaTemplate) => void }) {
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

// ============================================================
// Helpers
// ============================================================

interface DayGroup { dayKey: string; dayLabel: string; messages: DebtVergeCommunication[] }

function groupMessagesByDay(messages: DebtVergeCommunication[]): DayGroup[] {
  const groups: DayGroup[] = [];
  const map = new Map<string, DebtVergeCommunication[]>();
  for (const msg of messages) {
    const d = new Date(msg.timestamp);
    const key = d.toDateString();
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(msg);
  }
  for (const [key, msgs] of map) {
    const d = new Date(key);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    let label: string;
    if (d.toDateString() === today.toDateString()) label = "Today";
    else if (d.toDateString() === yesterday.toDateString()) label = "Yesterday";
    else label = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    groups.push({ dayKey: key, dayLabel: label, messages: msgs });
  }
  return groups;
}

// Re-export for use by other components
export { CHANNEL_META, FCA_TEMPLATES, type FcaTemplate };
