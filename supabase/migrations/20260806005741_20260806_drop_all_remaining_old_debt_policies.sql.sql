/*
# Drop remaining old non-org-scoped policies from debt tables
# These use non-standard naming conventions from earlier migrations.
*/

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (
        tablename LIKE 'debt_%'
        OR tablename LIKE 'debtverge_%'
      )
      AND policyname NOT LIKE '%_org_%'
      AND policyname NOT LIKE '%_debtverge_tenants'
      -- Keep only the org-scoped policies we created
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I;', r.policyname, r.tablename);
  END LOOP;
END $$;