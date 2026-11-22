import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/core/supabase";

export type KnowledgeLibrary = "leadverge" | "debtverge" | "ivaverge" | "draftverge";

export interface KnowledgeArticle {
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
  status: string;
  version: number;
  last_updated: string;
  created_at: string;
}

export interface KnowledgeSearchResult {
  id: string;
  library: string;
  title: string;
  category: string;
  subcategory: string | null;
  summary: string | null;
  rank: number;
}

const LIBRARY_LABELS: Record<KnowledgeLibrary, string> = {
  leadverge: "LeadVerge",
  debtverge: "DebtVerge",
  ivaverge: "IVAVerge",
  draftverge: "DraftVerge",
};

export function getLibraryLabel(lib: string): string {
  return LIBRARY_LABELS[lib as KnowledgeLibrary] || lib;
}

export function useKnowledgeSearch() {
  const [query, setQuery] = useState("");
  const [library, setLibrary] = useState<KnowledgeLibrary | "all">("all");
  const [category, setCategory] = useState<string | "all">("all");
  const [results, setResults] = useState<KnowledgeSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [categories, setCategories] = useState<string[]>([]);

  const fetchCategories = useCallback(async (lib: KnowledgeLibrary | "all") => {
    let q = supabase.from("finance_knowledge_articles").select("category").eq("status", "approved");
    if (lib !== "all") q = q.eq("library", lib);
    const { data, error: err } = await q;
    if (err) return;
    const unique = [...new Set(data?.map((d) => d.category) || [])].sort();
    setCategories(unique);
  }, []);

  useEffect(() => {
    fetchCategories(library);
  }, [library, fetchCategories]);

  const search = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (query.trim().length >= 2) {
        let q = supabase
          .from("finance_knowledge_articles")
          .select("id, library, title, category, subcategory, summary")
          .textSearch("fts", query.trim(), { type: "websearch" })
          .eq("status", "approved")
          .order("title")
          .limit(50);
        if (library !== "all") q = q.eq("library", library);
        if (category !== "all") q = q.eq("category", category);
        const { data, error: err } = await q;
        if (err) throw err;
        setResults((data || []).map((d) => ({ ...d, rank: 0 })));
      } else {
        let q = supabase
          .from("finance_knowledge_articles")
          .select("id, library, title, category, subcategory, summary")
          .eq("status", "approved")
          .order("title")
          .limit(50);
        if (library !== "all") q = q.eq("library", library);
        if (category !== "all") q = q.eq("category", category);
        const { data, error: err } = await q;
        if (err) throw err;
        setResults((data || []).map((d) => ({ ...d, rank: 0 })));
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Search failed";
      setError(msg);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [query, library, category]);

  useEffect(() => {
    const timer = setTimeout(() => {
      search();
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  return {
    query, setQuery,
    library, setLibrary,
    category, setCategory,
    results, loading, error,
    categories,
    retry: search,
  };
}

export function useKnowledgeArticle(id: string | null) {
  const [article, setArticle] = useState<KnowledgeArticle | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setArticle(null);
      return;
    }
    setLoading(true);
    setError(null);
    supabase
      .from("finance_knowledge_articles")
      .select("*")
      .eq("id", id)
      .single()
      .then(({ data, error: err }) => {
        if (err) {
          setError(err.message);
          setArticle(null);
        } else {
          setArticle(data as KnowledgeArticle);
        }
        setLoading(false);
      });
  }, [id]);

  return { article, loading, error };
}

export function useContextualKnowledge(library: KnowledgeLibrary, contextTerms: string[]) {
  const [suggestions, setSuggestions] = useState<KnowledgeSearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!contextTerms || contextTerms.length === 0) {
      setSuggestions([]);
      return;
    }
    setLoading(true);
    const searchTerm = contextTerms.slice(0, 3).join(" ");
    supabase
      .from("finance_knowledge_articles")
      .select("id, library, title, category, subcategory, summary")
      .textSearch("fts", searchTerm, { type: "websearch" })
      .eq("status", "approved")
      .eq("library", library)
      .limit(5)
      .then(({ data }) => {
        setSuggestions((data || []).map((d) => ({ ...d, rank: 0 })));
        setLoading(false);
      });
  }, [library, contextTerms.join(",")]);

  return { suggestions, loading };
}

export function useKnowledgeStats() {
  const [stats, setStats] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("finance_knowledge_articles")
      .select("library")
      .eq("status", "approved")
      .then(({ data }) => {
        const counts: Record<string, number> = {};
        for (const row of data || []) {
          counts[row.library] = (counts[row.library] || 0) + 1;
        }
        setStats(counts);
        setLoading(false);
      });
  }, []);

  return { stats, loading };
}
