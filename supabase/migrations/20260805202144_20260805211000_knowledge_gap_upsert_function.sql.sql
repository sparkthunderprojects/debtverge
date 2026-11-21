/*
# Knowledge Gap Upsert Function

Creates a SECURITY DEFINER function to upsert knowledge gap records.
The edge function (using service role key) calls this to track unanswered
questions. SECURITY DEFINER is needed because the function runs before
RLS policies are checked, and we want atomic upsert behavior.

## Security
- SECURITY DEFINER: runs with owner privileges
- Only called by the edge function (service role key)
- No direct user access needed
*/

CREATE OR REPLACE FUNCTION upsert_knowledge_gap(p_question text, p_library text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO ai_knowledge_gaps (question, library, frequency, first_seen, last_seen)
  VALUES (p_question, p_library, 1, now(), now())
  ON CONFLICT (question, library) DO UPDATE
  SET
    frequency = ai_knowledge_gaps.frequency + 1,
    last_seen = now()
  WHERE ai_knowledge_gaps.status = 'open';
END;
$$;

-- Add a unique constraint on (question, library) for the upsert to work
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'idx_ai_gaps_question_library_unique'
    AND tablename = 'ai_knowledge_gaps'
  ) THEN
    ALTER TABLE ai_knowledge_gaps ADD CONSTRAINT uq_gaps_question_library UNIQUE (question, library);
  END IF;
END $$;
