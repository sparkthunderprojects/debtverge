/*
# Drop stale per-user RLS policies from debt_* tables
# The org-scoped policies were added in the previous migration, but the old
# per-user policies used shortened suffixes (e.g. "debt_reviews" instead of
# "debt_annual_reviews") so the DROP statements didn't match.
# This migration cleans them up.
*/

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND policyname LIKE '%_own_%'
      AND (
        tablename LIKE 'debt_%'
        OR tablename LIKE 'debtverge_%'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I;', r.policyname, r.tablename);
  END LOOP;
END $$;