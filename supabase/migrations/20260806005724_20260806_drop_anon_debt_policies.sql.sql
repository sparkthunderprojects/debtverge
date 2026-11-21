/*
# Drop anon-accessible policies from debt_* tables
# These were found alongside the org-scoped policies and grant the anon role
# full CRUD access — a security hole that bypasses organization isolation.
*/

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND policyname LIKE 'anon_%'
      AND (
        tablename LIKE 'debt_%'
        OR tablename LIKE 'debtverge_%'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I;', r.policyname, r.tablename);
  END LOOP;
END $$;