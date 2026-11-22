import { useCallback, useRef, useState } from "react";
import { supabase } from "@/core/supabase";
import type { KnowledgeLibrary } from "@/apps/debtverge/lib/knowledge-hooks";

export interface AIChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: AISourceArticle[];
  complianceGuidance?: string | null;
  nextSteps?: string[];
  relatedQuestions?: string[];
  foundArticles?: boolean;
  responseSource?: string;
  queryLogId?: string | null;
  timestamp: number;
}

export interface AISourceArticle {
  id: string;
  title: string;
  library: string;
  category: string;
  subcategory: string | null;
  summary: string | null;
}

export interface AIPermissions {
  can_use_assistant: boolean;
  can_review_answers: boolean;
  can_manage_knowledge: boolean;
  can_manage_permissions: boolean;
}

const ASSISTANT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/knowledge-assistant`;

export function useKnowledgeAssistant(library: KnowledgeLibrary) {
  const [messages, setMessages] = useState<AIChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const historyRef = useRef<{ role: string; content: string }[]>([]);

  const ask = useCallback(async (question: string, userId?: string, userEmail?: string) => {
    if (!question.trim() || loading) return;

    const userMsg: AIChatMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      content: question,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(ASSISTANT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          question,
          library,
          history: historyRef.current,
          user_id: userId,
          user_email: userEmail,
        }),
      });

      if (!response.ok) {
        throw new Error(`AI assistant error (${response.status})`);
      }

      const data = await response.json();

      if (data.error) {
        throw new Error(data.error);
      }

      const aiMsg: AIChatMessage = {
        id: `a-${Date.now()}`,
        role: "assistant",
        content: data.answer || "No response generated.",
        sources: data.source_articles || [],
        complianceGuidance: data.compliance_guidance || null,
        nextSteps: data.next_steps || [],
        relatedQuestions: data.related_questions || [],
        foundArticles: data.found_articles ?? false,
        responseSource: data.response_source || "local",
        queryLogId: data.query_log_id || null,
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, aiMsg]);
      historyRef.current.push(
        { role: "user", content: question },
        { role: "assistant", content: data.answer || "" },
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to get AI response";
      setError(msg);
      const errMsg: AIChatMessage = {
        id: `e-${Date.now()}`,
        role: "assistant",
        content: "I encountered an error while processing your question. Please try again.",
        foundArticles: false,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, errMsg]);
    } finally {
      setLoading(false);
    }
  }, [library, loading]);

  const clear = useCallback(() => {
    setMessages([]);
    historyRef.current = [];
    setError(null);
  }, []);

  const submitFeedback = useCallback(async (queryLogId: string, rating: "helpful" | "not_helpful", comment?: string) => {
    try {
      await supabase.from("ai_query_feedback").insert({
        query_log_id: queryLogId,
        rating,
        comment: comment || null,
      });
    } catch {
      // silent fail - feedback is best-effort
    }
  }, []);

  return { messages, loading, error, ask, clear, submitFeedback };
}

export function useAIPermissions() {
  const [permissions, setPermissions] = useState<AIPermissions | null>(null);
  const [loading, setLoading] = useState(true);

  const ensurePermissions = useCallback(async (userId: string, userEmail?: string): Promise<AIPermissions> => {
    setLoading(true);
    try {
      const { data: existing } = await supabase
        .from("ai_assistant_permissions")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();

      if (existing) {
        const perms: AIPermissions = {
          can_use_assistant: existing.can_use_assistant,
          can_review_answers: existing.can_review_answers,
          can_manage_knowledge: existing.can_manage_knowledge,
          can_manage_permissions: existing.can_manage_permissions,
        };
        setPermissions(perms);
        setLoading(false);
        return perms;
      }

      // Self-insert default permissions
      const { data: created } = await supabase
        .from("ai_assistant_permissions")
        .insert({
          user_id: userId,
          user_email: userEmail,
          can_use_assistant: true,
          can_review_answers: false,
          can_manage_knowledge: false,
          can_manage_permissions: false,
        })
        .select("*")
        .single();

      if (created) {
        const perms: AIPermissions = {
          can_use_assistant: created.can_use_assistant,
          can_review_answers: created.can_review_answers,
          can_manage_knowledge: created.can_manage_knowledge,
          can_manage_permissions: created.can_manage_permissions,
        };
        setPermissions(perms);
        setLoading(false);
        return perms;
      }

      // Fallback: default permissions
      const defaultPerms: AIPermissions = {
        can_use_assistant: true,
        can_review_answers: false,
        can_manage_knowledge: false,
        can_manage_permissions: false,
      };
      setPermissions(defaultPerms);
      setLoading(false);
      return defaultPerms;
    } catch {
      const defaultPerms: AIPermissions = {
        can_use_assistant: true,
        can_review_answers: false,
        can_manage_knowledge: false,
        can_manage_permissions: false,
      };
      setPermissions(defaultPerms);
      setLoading(false);
      return defaultPerms;
    }
  }, []);

  return { permissions, loading, ensurePermissions };
}
