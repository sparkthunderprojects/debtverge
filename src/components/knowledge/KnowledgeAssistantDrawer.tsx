import { useEffect, useRef, useState } from "react";
import {
  Sparkles, X, Send, Bot, User as UserIcon, BookOpen,
  ShieldAlert, ListChecks, HelpCircle, ThumbsUp, ThumbsDown,
  Loader2, ChevronRight, FileText, Lightbulb, Zap, Scale, Gavel, PenSquare,
} from "lucide-react";
import { useKnowledgeAssistant, useAIPermissions, type AIChatMessage } from "@/lib/ai-knowledge-hooks";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import type { KnowledgeLibrary } from "@/lib/knowledge-hooks";

const LIBRARY_ICONS: Record<string, React.ReactNode> = {
  leadverge: <Zap className="h-4 w-4" />,
  debtverge: <Scale className="h-4 w-4" />,
  ivaverge: <Gavel className="h-4 w-4" />,
  draftverge: <PenSquare className="h-4 w-4" />,
};

const LIBRARY_LABELS: Record<string, string> = {
  leadverge: "LeadVerge",
  debtverge: "DebtVerge",
  ivaverge: "IVAVerge",
  draftverge: "DraftVerge",
};

const SUGGESTED_QUESTIONS: Record<KnowledgeLibrary, string[]> = {
  leadverge: [
    "How do I qualify a lead using BANT?",
    "What is the best approach for lead nurturing?",
    "How should I handle lead scoring?",
    "What compliance rules apply to lead generation?",
  ],
  debtverge: [
    "What should I do if a customer can't pay their debts?",
    "How does breathing space work?",
    "What are the options for someone with council tax arrears?",
    "How do I assess vulnerability in a debt client?",
  ],
  ivaverge: [
    "What should I do if a customer in an IVA loses their employment?",
    "How do I handle an IVA variation?",
    "What are the supervisor's annual report requirements?",
    "How does IVA completion work?",
  ],
  draftverge: [
    "What are the eligibility criteria for a DRO?",
    "How is property treated in bankruptcy?",
    "What assets are protected in bankruptcy?",
    "How do I rebuild credit after insolvency?",
  ],
};

interface Props {
  open: boolean;
  onClose: () => void;
  library: KnowledgeLibrary;
  onArticleClick?: (articleId: string) => void;
}

export function KnowledgeAssistantDrawer({ open, onClose, library, onArticleClick }: Props) {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const { user } = useAuth();
  const { ensurePermissions } = useAIPermissions();
  const { messages, loading, error, ask, clear, submitFeedback } = useKnowledgeAssistant(library);
  const [input, setInput] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (user?.id) {
      ensurePermissions(user.id, user.email);
    }
  }, [user?.id, ensurePermissions]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  useEffect(() => {
    if (open) {
      setShowSuggestions(messages.length === 0);
    }
  }, [open]);

  const send = async (question: string) => {
    if (!question.trim() || loading) return;
    setInput("");
    setShowSuggestions(false);
    await ask(question, user?.id, user?.email);
  };

  const libLabel = LIBRARY_LABELS[library] || "Knowledge";

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-sm transition-opacity ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        className={`fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col shadow-2xl transition-transform duration-300 ${
          open ? "translate-x-0" : "translate-x-full"
        } ${isDark ? "bg-slate-900" : "bg-white"}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-blue-500/20 bg-gradient-to-r from-blue-700 to-cyan-600 p-4 text-white">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/15 backdrop-blur">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold">AI Knowledge Assistant</h3>
              <p className="flex items-center gap-1 text-xs text-blue-100">
                {LIBRARY_ICONS[library]}
                {libLabel} context
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {messages.length > 0 && (
              <button
                onClick={() => { clear(); setShowSuggestions(true); }}
                className="rounded-lg px-2 py-1 text-xs text-blue-100 hover:bg-white/10"
              >
                Clear
              </button>
            )}
            <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-white/10">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div
          ref={scrollRef}
          className={`min-h-0 flex-1 overflow-y-auto p-4 ${isDark ? "bg-slate-950" : "bg-slate-50"}`}
        >
          {messages.length === 0 && showSuggestions ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <div className={`mb-3 flex h-14 w-14 items-center justify-center rounded-2xl ${isDark ? "bg-blue-900/40" : "bg-blue-50"}`}>
                <Bot className={`h-7 w-7 ${isDark ? "text-blue-400" : "text-blue-600"}`} />
              </div>
              <p className={`text-sm font-semibold ${isDark ? "text-slate-100" : "text-slate-900"}`}>
                Ask about {libLabel} guidance
              </p>
              <p className={`mt-1 text-xs ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                I answer only from approved knowledge base articles.
              </p>
              <div className="mt-5 w-full space-y-2">
                {(SUGGESTED_QUESTIONS[library] || []).map((q) => (
                  <button
                    key={q}
                    onClick={() => send(q)}
                    className={`w-full rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
                      isDark
                        ? "border-slate-700 bg-slate-800/60 text-slate-300 hover:border-blue-500/50 hover:bg-slate-800"
                        : "border-slate-200 text-slate-700 hover:border-blue-300 hover:bg-blue-50"
                    }`}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              {messages.map((msg) => (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  isDark={isDark}
                  onArticleClick={onArticleClick}
                  onRelatedClick={(q) => send(q)}
                  onFeedback={(rating) => msg.queryLogId && submitFeedback(msg.queryLogId, rating)}
                />
              ))}
              {loading && (
                <div className={`flex items-center gap-2 text-sm ${isDark ? "text-slate-400" : "text-slate-400"}`}>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Searching knowledge base...</span>
                </div>
              )}
              {error && (
                <div className={`rounded-lg border px-3 py-2 text-xs ${isDark ? "border-red-900/50 bg-red-950/30 text-red-400" : "border-red-200 bg-red-50 text-red-600"}`}>
                  {error}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Input */}
        <div className={`border-t p-4 ${isDark ? "border-slate-800 bg-slate-900" : "border-slate-200 bg-white"}`}>
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              placeholder={`Ask about ${libLabel} guidance...`}
              rows={1}
              className={`max-h-32 flex-1 resize-none rounded-xl border px-3 py-2.5 text-sm outline-none transition-all focus:ring-2 ${
                isDark
                  ? "border-slate-700 bg-slate-800 text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:ring-blue-500/20"
                  : "border-slate-200 bg-white text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:ring-blue-500/20"
              }`}
            />
            <button
              onClick={() => send(input)}
              disabled={!input.trim() || loading}
              className="flex shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-cyan-500 p-2.5 text-white shadow-sm transition-all hover:shadow-md disabled:opacity-40"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
          <p className={`mt-2 text-[10px] ${isDark ? "text-slate-600" : "text-slate-400"}`}>
            AI responses are generated from approved knowledge base articles only.
          </p>
        </div>
      </div>
    </>
  );
}

function MessageBubble({
  message,
  isDark,
  onArticleClick,
  onRelatedClick,
  onFeedback,
}: {
  message: AIChatMessage;
  isDark: boolean;
  onArticleClick?: (id: string) => void;
  onRelatedClick: (question: string) => void;
  onFeedback: (rating: "helpful" | "not_helpful") => void;
}) {
  const isUser = message.role === "user";
  const [feedbackGiven, setFeedbackGiven] = useState<"helpful" | "not_helpful" | null>(null);

  if (isUser) {
    return (
      <div className="flex gap-3 flex-row-reverse">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-200 text-slate-500 dark:bg-slate-700">
          <UserIcon className="h-4 w-4" />
        </div>
        <div className="max-w-[85%] whitespace-pre-wrap rounded-xl bg-gradient-to-br from-blue-600 to-blue-700 px-3.5 py-2.5 text-sm leading-relaxed text-white">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
        message.foundArticles === false
          ? "bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400"
          : "bg-gradient-to-br from-blue-600 to-cyan-500 text-white"
      }`}>
        {message.foundArticles === false ? <ShieldAlert className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
      </div>
      <div className="min-w-0 flex-1 space-y-3">
        {/* Answer */}
        <div className={`whitespace-pre-wrap rounded-xl px-3.5 py-2.5 text-sm leading-relaxed ${
          isDark ? "bg-slate-800 text-slate-200" : "bg-white text-slate-800 border border-slate-200"
        }`}>
          {formatAnswer(message.content, isDark)}
        </div>

        {/* Sources */}
        {message.sources && message.sources.length > 0 && (
          <div className={`rounded-lg border p-3 ${isDark ? "border-slate-700 bg-slate-800/40" : "border-slate-200 bg-slate-50"}`}>
            <p className={`mb-2 flex items-center gap-1.5 text-xs font-semibold ${isDark ? "text-slate-400" : "text-slate-500"}`}>
              <BookOpen className="h-3.5 w-3.5" />
              Knowledge Sources ({message.sources.length})
            </p>
            <div className="space-y-1.5">
              {message.sources.map((src) => (
                <button
                  key={src.id}
                  onClick={() => onArticleClick?.(src.id)}
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors ${
                    isDark ? "text-slate-300 hover:bg-slate-700/60" : "text-slate-600 hover:bg-white"
                  }`}
                >
                  <FileText className="h-3.5 w-3.5 shrink-0 text-blue-500" />
                  <span className="line-clamp-1 flex-1">{src.title}</span>
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${isDark ? "bg-slate-700 text-slate-400" : "bg-slate-200 text-slate-500"}`}>
                    {LIBRARY_LABELS[src.library] || src.library}
                  </span>
                  <ChevronRight className="h-3 w-3 shrink-0 text-slate-400" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Compliance Guidance */}
        {message.complianceGuidance && (
          <div className={`rounded-lg border-l-2 border-amber-400 p-3 ${isDark ? "bg-amber-950/20" : "bg-amber-50"}`}>
            <p className={`mb-1.5 flex items-center gap-1.5 text-xs font-semibold ${isDark ? "text-amber-400" : "text-amber-700"}`}>
              <ShieldAlert className="h-3.5 w-3.5" />
              Compliance Guidance
            </p>
            <p className={`text-xs leading-relaxed ${isDark ? "text-amber-300/80" : "text-amber-800"}`}>
              {message.complianceGuidance}
            </p>
          </div>
        )}

        {/* Next Steps */}
        {message.nextSteps && message.nextSteps.length > 0 && (
          <div className={`rounded-lg border p-3 ${isDark ? "border-slate-700 bg-slate-800/40" : "border-slate-200 bg-slate-50"}`}>
            <p className={`mb-2 flex items-center gap-1.5 text-xs font-semibold ${isDark ? "text-slate-400" : "text-slate-500"}`}>
              <ListChecks className="h-3.5 w-3.5" />
              Recommended Next Steps
            </p>
            <ul className="space-y-1.5">
              {message.nextSteps.map((step, i) => (
                <li key={i} className={`flex items-start gap-2 text-xs ${isDark ? "text-slate-300" : "text-slate-600"}`}>
                  <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-blue-500 text-[9px] font-bold text-white">
                    {i + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Related Questions */}
        {message.relatedQuestions && message.relatedQuestions.length > 0 && (
          <div>
            <p className={`mb-2 flex items-center gap-1.5 text-xs font-semibold ${isDark ? "text-slate-400" : "text-slate-500"}`}>
              <HelpCircle className="h-3.5 w-3.5" />
              Related Questions
            </p>
            <div className="flex flex-wrap gap-1.5">
              {message.relatedQuestions.map((q, i) => (
                <button
                  key={i}
                  onClick={() => onRelatedClick(q)}
                  className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                    isDark
                      ? "border-slate-700 bg-slate-800 text-slate-300 hover:border-blue-500/50 hover:text-blue-400"
                      : "border-slate-200 bg-white text-slate-600 hover:border-blue-300 hover:text-blue-600"
                  }`}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Feedback */}
        {message.queryLogId && message.foundArticles !== false && (
          <div className="flex items-center gap-2">
            {feedbackGiven ? (
              <span className={`text-xs ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                Thanks for your feedback
              </span>
            ) : (
              <>
                <span className={`text-xs ${isDark ? "text-slate-500" : "text-slate-400"}`}>Was this helpful?</span>
                <button
                  onClick={() => { setFeedbackGiven("helpful"); onFeedback("helpful"); }}
                  className={`rounded-lg p-1 transition-colors ${isDark ? "text-slate-400 hover:bg-green-900/30 hover:text-green-400" : "text-slate-400 hover:bg-green-50 hover:text-green-600"}`}
                >
                  <ThumbsUp className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => { setFeedbackGiven("not_helpful"); onFeedback("not_helpful"); }}
                  className={`rounded-lg p-1 transition-colors ${isDark ? "text-slate-400 hover:bg-red-900/30 hover:text-red-400" : "text-slate-400 hover:bg-red-50 hover:text-red-600"}`}
                >
                  <ThumbsDown className="h-3.5 w-3.5" />
                </button>
              </>
            )}
            {message.responseSource && message.responseSource !== "local" && (
              <span className={`ml-auto rounded px-1.5 py-0.5 text-[10px] ${isDark ? "bg-slate-800 text-slate-500" : "bg-slate-100 text-slate-400"}`}>
                AI-powered
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function formatAnswer(text: string, isDark: boolean): React.ReactNode {
  // Parse simple **bold** markdown and split into paragraphs
  const paragraphs = text.split("\n\n");
  return paragraphs.map((para, i) => {
    const parts = para.split(/(\*\*[^*]+\*\*)/g);
    return (
      <p key={i} className={i > 0 ? "mt-2" : ""}>
        {parts.map((part, j) => {
          if (part.startsWith("**") && part.endsWith("**")) {
            return <strong key={j} className="font-semibold">{part.slice(2, -2)}</strong>;
          }
          return <span key={j}>{part}</span>;
        })}
      </p>
    );
  });
}
