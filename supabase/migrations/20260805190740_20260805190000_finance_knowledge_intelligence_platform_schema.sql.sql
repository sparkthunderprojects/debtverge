/*
# Financial Knowledge Intelligence Platform Schema

## Purpose
Create a central knowledge system shared across the Verge ecosystem (LeadVerge, DebtVerge, IVAVerge, DraftVerge).
Each application accesses the same knowledge table while filtering by its own library scope.

## New Tables

### finance_knowledge_articles
The main knowledge store. Each article is scoped to a library (leadverge, debtverge, ivaverge, draftverge)
and has a structured format with title, category, subcategory, summary, full explanation, adviser guidance,
customer-friendly explanation, compliance notes, keywords, status, and version tracking.

### finance_knowledge_categories
Lookup table for category metadata per library (display order, description).

## Full-Text Search
A tsvector column `fts` is maintained by a trigger, combining title (weight A), summary + keywords (weight B),
and full_explanation + adviser_guidance (weight C) for PostgreSQL full-text search.

## Security (RLS)
- SELECT: authenticated users can read all articles (shared knowledge base)
- INSERT/UPDATE/DELETE: authenticated users can manage articles
*/

-- ============================================================
-- finance_knowledge_articles
-- ============================================================

CREATE TABLE IF NOT EXISTS finance_knowledge_articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  library text NOT NULL CHECK (library IN ('leadverge', 'debtverge', 'ivaverge', 'draftverge')),
  title text NOT NULL,
  category text NOT NULL,
  subcategory text,
  summary text,
  full_explanation text,
  adviser_guidance text,
  customer_explanation text,
  compliance_notes text,
  related_articles text[] DEFAULT '{}',
  keywords text[] DEFAULT '{}',
  status text NOT NULL DEFAULT 'approved' CHECK (status IN ('draft', 'approved', 'archived')),
  version int NOT NULL DEFAULT 1,
  last_updated timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  fts tsvector
);

ALTER TABLE finance_knowledge_articles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_knowledge_articles" ON finance_knowledge_articles;
CREATE POLICY "select_knowledge_articles" ON finance_knowledge_articles
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_knowledge_articles" ON finance_knowledge_articles;
CREATE POLICY "insert_knowledge_articles" ON finance_knowledge_articles
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_knowledge_articles" ON finance_knowledge_articles;
CREATE POLICY "update_knowledge_articles" ON finance_knowledge_articles
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "delete_knowledge_articles" ON finance_knowledge_articles;
CREATE POLICY "delete_knowledge_articles" ON finance_knowledge_articles
  FOR DELETE TO authenticated USING (true);

-- ============================================================
-- finance_knowledge_categories
-- ============================================================

CREATE TABLE IF NOT EXISTS finance_knowledge_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  library text NOT NULL CHECK (library IN ('leadverge', 'debtverge', 'ivaverge', 'draftverge')),
  category text NOT NULL,
  subcategory text,
  display_order int NOT NULL DEFAULT 0,
  description text,
  UNIQUE(library, category, subcategory)
);

ALTER TABLE finance_knowledge_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_knowledge_categories" ON finance_knowledge_categories;
CREATE POLICY "select_knowledge_categories" ON finance_knowledge_categories
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_knowledge_categories" ON finance_knowledge_categories;
CREATE POLICY "insert_knowledge_categories" ON finance_knowledge_categories
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_knowledge_categories" ON finance_knowledge_categories;
CREATE POLICY "update_knowledge_categories" ON finance_knowledge_categories
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "delete_knowledge_categories" ON finance_knowledge_categories;
CREATE POLICY "delete_knowledge_categories" ON finance_knowledge_categories
  FOR DELETE TO authenticated USING (true);

-- ============================================================
-- FTS trigger to maintain the tsvector column
-- ============================================================

CREATE OR REPLACE FUNCTION finance_knowledge_fts_update() RETURNS trigger AS $$
BEGIN
  NEW.fts :=
    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.summary, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(array_to_string(NEW.keywords, ' '), '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.full_explanation, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(NEW.adviser_guidance, '')), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_knowledge_fts ON finance_knowledge_articles;
CREATE TRIGGER trg_knowledge_fts
  BEFORE INSERT OR UPDATE ON finance_knowledge_articles
  FOR EACH ROW EXECUTE FUNCTION finance_knowledge_fts_update();

-- ============================================================
-- Indexes
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_knowledge_library ON finance_knowledge_articles(library);
CREATE INDEX IF NOT EXISTS idx_knowledge_category ON finance_knowledge_articles(library, category);
CREATE INDEX IF NOT EXISTS idx_knowledge_status ON finance_knowledge_articles(status);
CREATE INDEX IF NOT EXISTS idx_knowledge_keywords ON finance_knowledge_articles USING GIN(keywords);
CREATE INDEX IF NOT EXISTS idx_knowledge_fts ON finance_knowledge_articles USING GIN(fts);
CREATE INDEX IF NOT EXISTS idx_knowledge_last_updated ON finance_knowledge_articles(last_updated DESC);
