/*
# AI Knowledge Assistant Schema

## Purpose
Creates tables for an AI-powered Knowledge Assistant using RAG over the
existing finance_knowledge_articles table. Tracks queries, feedback,
knowledge gaps, and permissions.

## New Tables
1. ai_query_logs — every question asked to the AI, with answer, sources, review status
2. ai_query_feedback — thumbs up/down on AI answers
3. ai_knowledge_gaps — unanswered questions for content team review
4. ai_assistant_permissions — who can use/admin the assistant

## Security
- RLS on all tables
- Owner-scoped for user data; admin-scoped via permission checks
- auth.uid() for ownership
*/

-- ============================================================
-- Create ALL tables first (before any policies that reference them)
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_assistant_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  user_email text,
  can_use_assistant boolean NOT NULL DEFAULT true,
  can_review_answers boolean NOT NULL DEFAULT false,
  can_manage_knowledge boolean NOT NULL DEFAULT false,
  can_manage_permissions boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_query_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  user_email text,
  library text NOT NULL,
  question text NOT NULL,
  ai_answer text,
  source_articles jsonb DEFAULT '[]'::jsonb,
  compliance_guidance text,
  next_steps jsonb DEFAULT '[]'::jsonb,
  related_questions jsonb DEFAULT '[]'::jsonb,
  found_articles boolean NOT NULL DEFAULT false,
  response_source text DEFAULT 'local',
  context_terms text[] DEFAULT '{}'::text[],
  review_status text NOT NULL DEFAULT 'unreviewed',
  reviewer_id uuid,
  reviewer_notes text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_query_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  query_log_id uuid NOT NULL REFERENCES ai_query_logs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  rating text NOT NULL CHECK (rating IN ('helpful', 'not_helpful')),
  comment text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_knowledge_gaps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question text NOT NULL,
  library text NOT NULL,
  frequency int NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  resolved_article_id uuid,
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- Enable RLS on all tables
-- ============================================================
ALTER TABLE ai_assistant_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_query_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_query_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_knowledge_gaps ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_ai_query_logs_user ON ai_query_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_query_logs_library ON ai_query_logs(library);
CREATE INDEX IF NOT EXISTS idx_ai_query_logs_review ON ai_query_logs(review_status);
CREATE INDEX IF NOT EXISTS idx_ai_query_logs_created ON ai_query_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_feedback_query ON ai_query_feedback(query_log_id);
CREATE INDEX IF NOT EXISTS idx_ai_gaps_status ON ai_knowledge_gaps(status);
CREATE INDEX IF NOT EXISTS idx_ai_gaps_library ON ai_knowledge_gaps(library);

-- ============================================================
-- Policies: ai_assistant_permissions
-- ============================================================
DROP POLICY IF EXISTS "select_own_ai_permissions" ON ai_assistant_permissions;
CREATE POLICY "select_own_ai_permissions"
  ON ai_assistant_permissions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "select_all_ai_permissions_admin" ON ai_assistant_permissions;
CREATE POLICY "select_all_ai_permissions_admin"
  ON ai_assistant_permissions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM ai_assistant_permissions p
      WHERE p.user_id = auth.uid() AND p.can_manage_permissions = true
    )
  );

DROP POLICY IF EXISTS "insert_ai_permissions_admin" ON ai_assistant_permissions;
CREATE POLICY "insert_ai_permissions_admin"
  ON ai_assistant_permissions FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM ai_assistant_permissions p
      WHERE p.user_id = auth.uid() AND p.can_manage_permissions = true
    )
  );

DROP POLICY IF EXISTS "insert_own_ai_permissions" ON ai_assistant_permissions;
CREATE POLICY "insert_own_ai_permissions"
  ON ai_assistant_permissions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_ai_permissions_admin" ON ai_assistant_permissions;
CREATE POLICY "update_ai_permissions_admin"
  ON ai_assistant_permissions FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM ai_assistant_permissions p
      WHERE p.user_id = auth.uid() AND p.can_manage_permissions = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM ai_assistant_permissions p
      WHERE p.user_id = auth.uid() AND p.can_manage_permissions = true
    )
  );

-- ============================================================
-- Policies: ai_query_logs
-- ============================================================
DROP POLICY IF EXISTS "select_own_ai_query_logs" ON ai_query_logs;
CREATE POLICY "select_own_ai_query_logs"
  ON ai_query_logs FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "select_all_ai_query_logs_admin" ON ai_query_logs;
CREATE POLICY "select_all_ai_query_logs_admin"
  ON ai_query_logs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM ai_assistant_permissions p
      WHERE p.user_id = auth.uid() AND p.can_review_answers = true
    )
  );

DROP POLICY IF EXISTS "insert_own_ai_query_logs" ON ai_query_logs;
CREATE POLICY "insert_own_ai_query_logs"
  ON ai_query_logs FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_ai_query_logs" ON ai_query_logs;
CREATE POLICY "update_own_ai_query_logs"
  ON ai_query_logs FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_ai_query_logs_admin" ON ai_query_logs;
CREATE POLICY "update_ai_query_logs_admin"
  ON ai_query_logs FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM ai_assistant_permissions p
      WHERE p.user_id = auth.uid() AND p.can_review_answers = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM ai_assistant_permissions p
      WHERE p.user_id = auth.uid() AND p.can_review_answers = true
    )
  );

-- ============================================================
-- Policies: ai_query_feedback
-- ============================================================
DROP POLICY IF EXISTS "select_own_ai_feedback" ON ai_query_feedback;
CREATE POLICY "select_own_ai_feedback"
  ON ai_query_feedback FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "select_all_ai_feedback_admin" ON ai_query_feedback;
CREATE POLICY "select_all_ai_feedback_admin"
  ON ai_query_feedback FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM ai_assistant_permissions p
      WHERE p.user_id = auth.uid() AND p.can_review_answers = true
    )
  );

DROP POLICY IF EXISTS "insert_own_ai_feedback" ON ai_query_feedback;
CREATE POLICY "insert_own_ai_feedback"
  ON ai_query_feedback FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- Policies: ai_knowledge_gaps (admin-only)
-- ============================================================
DROP POLICY IF EXISTS "select_ai_knowledge_gaps_admin" ON ai_knowledge_gaps;
CREATE POLICY "select_ai_knowledge_gaps_admin"
  ON ai_knowledge_gaps FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM ai_assistant_permissions p
      WHERE p.user_id = auth.uid() AND p.can_manage_knowledge = true
    )
  );

DROP POLICY IF EXISTS "update_ai_knowledge_gaps_admin" ON ai_knowledge_gaps;
CREATE POLICY "update_ai_knowledge_gaps_admin"
  ON ai_knowledge_gaps FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM ai_assistant_permissions p
      WHERE p.user_id = auth.uid() AND p.can_manage_knowledge = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM ai_assistant_permissions p
      WHERE p.user_id = auth.uid() AND p.can_manage_knowledge = true
    )
  );

-- ============================================================
-- Policies: finance_knowledge_articles (admin management)
-- ============================================================
DROP POLICY IF EXISTS "update_knowledge_articles_admin" ON finance_knowledge_articles;
CREATE POLICY "update_knowledge_articles_admin"
  ON finance_knowledge_articles FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM ai_assistant_permissions p
      WHERE p.user_id = auth.uid() AND p.can_manage_knowledge = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM ai_assistant_permissions p
      WHERE p.user_id = auth.uid() AND p.can_manage_knowledge = true
    )
  );

DROP POLICY IF EXISTS "insert_knowledge_articles_admin" ON finance_knowledge_articles;
CREATE POLICY "insert_knowledge_articles_admin"
  ON finance_knowledge_articles FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM ai_assistant_permissions p
      WHERE p.user_id = auth.uid() AND p.can_manage_knowledge = true
    )
  );
