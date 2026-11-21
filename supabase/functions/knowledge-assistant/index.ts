import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface KnowledgeArticleRow {
  id: string;
  library: string;
  title: string;
  category: string;
  subcategory: string | null;
  summary: string | null;
  full_explanation: string | null;
  adviser_guidance: string | null;
  customer_explanation: string | null;
  compliance_notes: string | null;
  related_articles: string[] | null;
  keywords: string[] | null;
}

interface SourceArticle {
  id: string;
  title: string;
  library: string;
  category: string;
  subcategory: string | null;
  summary: string | null;
}

interface RAGResponse {
  answer: string;
  source_articles: SourceArticle[];
  compliance_guidance: string | null;
  next_steps: string[];
  related_questions: string[];
  found_articles: boolean;
  response_source: string;
  query_log_id: string | null;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ============================================================
// Keyword extraction from the user's question
// ============================================================
const STOP_WORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "should",
  "could", "may", "might", "must", "can", "shall", "to", "of", "in",
  "on", "at", "by", "for", "with", "about", "against", "between",
  "into", "through", "during", "before", "after", "above", "below",
  "from", "up", "down", "out", "off", "over", "under", "again",
  "further", "then", "once", "here", "there", "when", "where", "why",
  "how", "all", "each", "few", "more", "most", "other", "some", "such",
  "no", "nor", "not", "only", "own", "same", "so", "than", "too",
  "very", "just", "i", "me", "my", "we", "us", "our", "you", "your",
  "he", "him", "his", "she", "her", "it", "its", "they", "them",
  "their", "what", "which", "who", "whom", "this", "that", "these",
  "those", "if", "because", "as", "until", "while", "and", "but",
  "or", "yet", "so", "also",
]);

function extractContextTerms(question: string): string[] {
  const words = question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
  return [...new Set(words)].slice(0, 10);
}

// ============================================================
// Search the knowledge base using full-text search
// ============================================================
async function searchKnowledgeBase(
  supabase: ReturnType<typeof createClient>,
  query: string,
  library: string,
  contextTerms: string[],
): Promise<KnowledgeArticleRow[]> {
  const results: KnowledgeArticleRow[] = [];
  const seen = new Set<string>();

  // Strategy 1: Full-text search on the fts column
  try {
    let q = supabase
      .from("finance_knowledge_articles")
      .select("*")
      .textSearch("fts", query, { type: "websearch" })
      .eq("status", "approved")
      .limit(8);
    if (library) q = q.eq("library", library);
    const { data } = await q;
    for (const row of data || []) {
      if (!seen.has(row.id)) {
        seen.add(row.id);
        results.push(row as KnowledgeArticleRow);
      }
    }
  } catch {
    // fall through to keyword search
  }

  // Strategy 2: If not enough results, try keyword-based ILIKE search
  if (results.length < 5 && contextTerms.length > 0) {
    const searchTerm = contextTerms.slice(0, 4).join(" | ");
    try {
      let q = supabase
        .from("finance_knowledge_articles")
        .select("*")
        .textSearch("fts", searchTerm, { type: "websearch" })
        .eq("status", "approved")
        .limit(8);
      if (library) q = q.eq("library", library);
      const { data } = await q;
      for (const row of data || []) {
        if (!seen.has(row.id)) {
          seen.add(row.id);
          results.push(row as KnowledgeArticleRow);
        }
      }
    } catch {
      // ignore
    }
  }

  // Strategy 3: Broader search across all libraries if still not enough
  if (results.length < 3 && contextTerms.length > 0) {
    const broadTerm = contextTerms.slice(0, 3).join(" | ");
    try {
      const { data } = await supabase
        .from("finance_knowledge_articles")
        .select("*")
        .textSearch("fts", broadTerm, { type: "websearch" })
        .eq("status", "approved")
        .limit(5);
      for (const row of data || []) {
        if (!seen.has(row.id)) {
          seen.add(row.id);
          results.push(row as KnowledgeArticleRow);
        }
      }
    } catch {
      // ignore
    }
  }

  return results.slice(0, 8);
}

// ============================================================
// Local RAG answer generation (no external LLM required)
// Builds a structured answer from the retrieved articles
// ============================================================
function generateLocalAnswer(
  question: string,
  articles: KnowledgeArticleRow[],
  library: string,
): {
  answer: string;
  compliance_guidance: string | null;
  next_steps: string[];
  related_questions: string[];
} {
  if (articles.length === 0) {
    return {
      answer:
        "Approved guidance not found. Please refer to a supervisor or compliance team.",
      compliance_guidance: null,
      next_steps: [
        "Consult your supervisor for guidance on this matter.",
        "Contact the compliance team for approved procedures.",
        "Submit this question to the knowledge team for future inclusion.",
      ],
      related_questions: [],
    };
  }

  const libLabel = library === "leadverge" ? "LeadVerge"
    : library === "debtverge" ? "DebtVerge"
    : library === "ivaverge" ? "IVAVerge"
    : library === "draftverge" ? "DraftVerge"
    : "Knowledge Base";

  // Build the answer from the most relevant articles
  const primary = articles[0];
  const supporting = articles.slice(1, 4);

  let answer = `Based on ${libLabel} approved knowledge base, here is the guidance for your question:\n\n`;

  // Primary article content
  if (primary.adviser_guidance) {
    answer += `**Guidance:** ${primary.adviser_guidance}\n\n`;
  } else if (primary.full_explanation) {
    answer += `**Explanation:** ${primary.full_explanation}\n\n`;
  } else if (primary.summary) {
    answer += `**Summary:** ${primary.summary}\n\n`;
  }

  // Supporting context from other articles
  if (supporting.length > 0) {
    answer += `**Additional Context:**\n`;
    for (const s of supporting) {
      const text = s.adviser_guidance || s.summary || s.full_explanation;
      if (text) {
        answer += `• ${s.title}: ${text.substring(0, 200)}${text.length > 200 ? "..." : ""}\n`;
      }
    }
    answer += "\n";
  }

  // Compliance guidance
  const complianceParts: string[] = [];
  for (const a of articles) {
    if (a.compliance_notes) {
      complianceParts.push(`${a.compliance_notes}`);
    }
  }
  const compliance_guidance = complianceParts.length > 0
    ? complianceParts.slice(0, 3).join("\n\n")
    : null;

  // Next steps
  const next_steps: string[] = [];
  if (primary.adviser_guidance) {
    const sentences = primary.adviser_guidance.split(/[.]/).filter((s) => s.trim().length > 10);
    const actionSentences = sentences.filter((s) =>
      /ensure|check|verify|confirm|document|review|contact|refer|monitor|assess|recommend/i.test(s),
    );
    for (const s of actionSentences.slice(0, 3)) {
      next_steps.push(s.trim());
    }
  }
  if (next_steps.length < 2 && supporting.length > 0) {
    for (const s of supporting) {
      if (s.adviser_guidance) {
        const sentences = s.adviser_guidance.split(/[.]/).filter((sen) =>
          /ensure|check|verify|confirm|document|review|contact|refer|monitor|assess|recommend/i.test(sen),
        );
        for (const sen of sentences.slice(0, 1)) {
          if (next_steps.length < 4) next_steps.push(sen.trim());
        }
      }
    }
  }
  if (next_steps.length === 0) {
    next_steps.push("Review the full article for detailed guidance.");
    next_steps.push("Document the advice given and the basis for the recommendation.");
  }

  // Related questions from related_articles
  const related_questions: string[] = [];
  for (const a of articles) {
    if (a.related_articles) {
      for (const title of a.related_articles.slice(0, 2)) {
        if (!related_questions.includes(title) && related_questions.length < 4) {
          related_questions.push(`What is the guidance on "${title}"?`);
        }
      }
    }
  }

  return { answer, compliance_guidance, next_steps, related_questions };
}

// ============================================================
// LLM-enhanced answer generation (if API keys are configured)
// ============================================================
async function generateLLMAnswer(
  question: string,
  articles: KnowledgeArticleRow[],
  library: string,
  history: { role: string; content: string }[],
): Promise<{
  answer: string;
  compliance_guidance: string | null;
  next_steps: string[];
  related_questions: string[];
} | null> {
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");

  if (!openaiKey && !anthropicKey) return null;

  // Build context from articles
  const context = articles.map((a, i) =>
    `[Article ${i + 1}: ${a.title}]\nCategory: ${a.category}\nSummary: ${a.summary || "N/A"}\nAdviser Guidance: ${a.adviser_guidance || "N/A"}\nFull Explanation: ${a.full_explanation || "N/A"}\nCompliance Notes: ${a.compliance_notes || "N/A"}`,
  ).join("\n\n---\n\n");

  const libLabel = library === "leadverge" ? "LeadVerge"
    : library === "debtverge" ? "DebtVerge"
    : library === "ivaverge" ? "IVAVerge"
    : "DraftVerge";

  const systemPrompt =
    `You are an AI knowledge assistant for ${libLabel}, a financial services platform. ` +
    "You answer adviser questions using ONLY the approved knowledge base articles provided below. " +
    "CRITICAL RULES:\n" +
    "1. Only use information from the provided articles. Do NOT invent or assume information.\n" +
    "2. If the articles do not contain relevant information, respond with: " +
    '"Approved guidance not found. Please refer to a supervisor or compliance team."\n' +
    "3. Structure your response as a clear, practical answer for a financial adviser.\n" +
    "4. Include compliance considerations when relevant.\n" +
    "5. Suggest recommended next steps based on the article guidance.\n" +
    "6. Be concise but thorough.\n\n" +
    `APPROVED KNOWLEDGE BASE ARTICLES:\n${context}`;

  const localFallback = generateLocalAnswer(question, articles, library);

  if (openaiKey) {
    try {
      const messages = [
        { role: "system", content: systemPrompt },
        ...history.slice(-4).map((m) => ({ role: m.role, content: m.content })),
        { role: "user", content: question },
      ];
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages,
          max_tokens: 800,
          temperature: 0.2,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const answer = data.choices?.[0]?.message?.content;
        if (answer) {
          return {
            answer,
            compliance_guidance: localFallback.compliance_guidance,
            next_steps: localFallback.next_steps,
            related_questions: localFallback.related_questions,
          };
        }
      }
    } catch {
      // fall through to local
    }
  }

  if (anthropicKey) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-3-5-sonnet-20241022",
          max_tokens: 800,
          system: systemPrompt,
          messages: [
            ...history.slice(-4).map((m) => ({
              role: m.role === "assistant" ? "assistant" : "user",
              content: m.content,
            })),
            { role: "user", content: question },
          ],
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const answer = data.content?.[0]?.text;
        if (answer) {
          return {
            answer,
            compliance_guidance: localFallback.compliance_guidance,
            next_steps: localFallback.next_steps,
            related_questions: localFallback.related_questions,
          };
        }
      }
    } catch {
      // fall through to local
    }
  }

  return null;
}

// ============================================================
// Log the query and track knowledge gaps
// ============================================================
async function logQuery(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  userEmail: string | undefined,
  library: string,
  question: string,
  response: RAGResponse,
  contextTerms: string[],
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("ai_query_logs")
      .insert({
        user_id: userId,
        user_email: userEmail,
        library,
        question,
        ai_answer: response.answer,
        source_articles: response.source_articles,
        compliance_guidance: response.compliance_guidance,
        next_steps: response.next_steps,
        related_questions: response.related_questions,
        found_articles: response.found_articles,
        response_source: response.response_source,
        context_terms: contextTerms,
      })
      .select("id")
      .single();

    if (error || !data) return null;

    // Track knowledge gap if no articles were found
    if (!response.found_articles) {
      await supabase.rpc("upsert_knowledge_gap", {
        p_question: question,
        p_library: library,
      });
    }

    return data.id;
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const body = await req.json();
    const question: string = body.question || "";
    const library: string = body.library || "debtverge";
    const history: { role: string; content: string }[] = body.history || [];
    const userId: string | undefined = body.user_id;
    const userEmail: string | undefined = body.user_email;

    if (!question.trim()) {
      return jsonResponse({ error: "Question is required" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") as string,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") as string,
    );

    // Step 1: Extract context terms from the question
    const contextTerms = extractContextTerms(question);

    // Step 2: Search the knowledge base (RAG retrieval)
    const articles = await searchKnowledgeBase(supabase, question, library, contextTerms);

    // Step 3: Generate the answer
    let responseSource = "local";
    let generated: { answer: string; compliance_guidance: string | null; next_steps: string[]; related_questions: string[] };

    const llmResult = await generateLLMAnswer(question, articles, library, history);
    if (llmResult) {
      generated = llmResult;
      responseSource = Deno.env.get("OPENAI_API_KEY") ? "openai" : "anthropic";
    } else {
      generated = generateLocalAnswer(question, articles, library);
    }

    // Build source articles metadata
    const sourceArticles: SourceArticle[] = articles.map((a) => ({
      id: a.id,
      title: a.title,
      library: a.library,
      category: a.category,
      subcategory: a.subcategory,
      summary: a.summary,
    }));

    const ragResponse: RAGResponse = {
      answer: generated.answer,
      source_articles: sourceArticles,
      compliance_guidance: generated.compliance_guidance,
      next_steps: generated.next_steps,
      related_questions: generated.related_questions,
      found_articles: articles.length > 0,
      response_source: responseSource,
      query_log_id: null,
    };

    // Step 4: Log the query
    if (userId) {
      const logId = await logQuery(supabase, userId, userEmail, library, question, ragResponse, contextTerms);
      ragResponse.query_log_id = logId;
    }

    return jsonResponse(ragResponse);
  } catch (err) {
    return jsonResponse({ error: String((err as Error)?.message || err) }, 500);
  }
});
