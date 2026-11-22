-- Immutable, automatic audit trail. Every insert/update/delete on a case-linked table writes who, which firm,
-- what changed (old and new values) and when, into debt_audit_log. The log cannot be edited or deleted by anyone.

ALTER TABLE debt_audit_log ADD COLUMN IF NOT EXISTS organization_id uuid;
ALTER TABLE debt_audit_log ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE debt_audit_log ADD COLUMN IF NOT EXISTS table_name text;
ALTER TABLE debt_audit_log ADD COLUMN IF NOT EXISTS record_id uuid;
ALTER TABLE debt_audit_log ADD COLUMN IF NOT EXISTS action text;
ALTER TABLE debt_audit_log ADD COLUMN IF NOT EXISTS old_value jsonb;
ALTER TABLE debt_audit_log ADD COLUMN IF NOT EXISTS new_value jsonb;
ALTER TABLE debt_audit_log ALTER COLUMN case_id DROP NOT NULL;
CREATE INDEX IF NOT EXISTS debt_audit_log_org_idx ON debt_audit_log (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS debt_audit_log_record_idx ON debt_audit_log (table_name, record_id);

-- Backfill the firm on existing rows
UPDATE debt_audit_log a SET organization_id = c.organization_id FROM debt_cases c WHERE c.id = a.case_id AND a.organization_id IS NULL;

-- Stamp who/when on every insert so a client cannot forge the actor or back-date an entry
CREATE OR REPLACE FUNCTION dv_audit_stamp() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.created_at := now();
  IF auth.uid() IS NOT NULL THEN
    NEW.user_id := auth.uid();
    NEW.actor := COALESCE(auth.jwt() ->> 'email', auth.uid()::text);
  ELSE
    NEW.actor := COALESCE(NEW.actor, 'system');
  END IF;
  IF NEW.organization_id IS NULL AND NEW.case_id IS NOT NULL THEN
    SELECT organization_id INTO NEW.organization_id FROM debt_cases WHERE id = NEW.case_id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_audit_stamp ON debt_audit_log;
CREATE TRIGGER trg_audit_stamp BEFORE INSERT ON debt_audit_log FOR EACH ROW EXECUTE FUNCTION dv_audit_stamp();

-- The log can never be changed or removed, by anyone (including service role and super admins)
CREATE OR REPLACE FUNCTION dv_audit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'the audit log is append-only' USING ERRCODE = '42501'; END $$;
DROP TRIGGER IF EXISTS trg_audit_no_change ON debt_audit_log;
CREATE TRIGGER trg_audit_no_change BEFORE UPDATE OR DELETE ON debt_audit_log FOR EACH ROW EXECUTE FUNCTION dv_audit_immutable();
DROP TRIGGER IF EXISTS trg_audit_no_truncate ON debt_audit_log;
CREATE TRIGGER trg_audit_no_truncate BEFORE TRUNCATE ON debt_audit_log FOR EACH STATEMENT EXECUTE FUNCTION dv_audit_immutable();
REVOKE UPDATE, DELETE, TRUNCATE ON debt_audit_log FROM authenticated, anon, service_role;

-- Replace the legacy and duplicate policies with one clear set
DO $$ DECLARE p record; BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'debt_audit_log' LOOP
    EXECUTE format('DROP POLICY %I ON debt_audit_log', p.policyname);
  END LOOP;
END $$;
ALTER TABLE debt_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY dv_audit_select ON debt_audit_log FOR SELECT TO authenticated
  USING ((case_id IS NOT NULL AND dv_can_read_case(case_id)) OR (case_id IS NULL AND organization_id IS NOT NULL AND dv_is_manager(organization_id)));
CREATE POLICY dv_audit_insert ON debt_audit_log FOR INSERT TO authenticated
  WITH CHECK (case_id IS NOT NULL AND dv_can_edit_case(case_id));

-- The automatic recorder
CREATE OR REPLACE FUNCTION dv_audit_row() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o jsonb; n jsonb; rec jsonb; cid uuid; org uuid; act text; chg jsonb := '{}'; oldv jsonb := '{}'; k text; keys text;
BEGIN
  IF TG_OP = 'DELETE' THEN o := to_jsonb(OLD); rec := o;
  ELSIF TG_OP = 'INSERT' THEN n := to_jsonb(NEW); rec := n;
  ELSE o := to_jsonb(OLD); n := to_jsonb(NEW); rec := n; END IF;

  IF TG_TABLE_NAME = 'debt_cases' THEN cid := (rec ->> 'id')::uuid;
  ELSIF rec ? 'case_id' THEN cid := NULLIF(rec ->> 'case_id', '')::uuid;
  ELSIF rec ? 'disbursement_run_id' THEN SELECT r.case_id INTO cid FROM disbursement_runs r WHERE r.id = (rec ->> 'disbursement_run_id')::uuid;
  END IF;
  org := NULLIF(rec ->> 'organization_id', '')::uuid;
  IF org IS NULL AND cid IS NOT NULL THEN SELECT c.organization_id INTO org FROM debt_cases c WHERE c.id = cid; END IF;
  IF cid IS NULL AND org IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  IF TG_OP = 'UPDATE' THEN
    FOR k IN SELECT jsonb_object_keys(n) LOOP
      CONTINUE WHEN k = 'updated_at';
      IF o -> k IS DISTINCT FROM n -> k THEN chg := chg || jsonb_build_object(k, n -> k); oldv := oldv || jsonb_build_object(k, o -> k); END IF;
    END LOOP;
    IF chg = '{}'::jsonb THEN RETURN NEW; END IF;
    act := CASE WHEN (n ->> 'deleted_at') IS NOT NULL AND (o ->> 'deleted_at') IS NULL THEN 'void' ELSE 'update' END;
  ELSIF TG_OP = 'INSERT' THEN act := 'insert'; chg := n; oldv := NULL;
  ELSE act := 'delete'; oldv := o; chg := NULL; END IF;

  -- never copy link tokens into the log
  IF chg IS NOT NULL THEN chg := chg - 'token'; END IF;
  IF oldv IS NOT NULL THEN oldv := oldv - 'token'; END IF;
  keys := (SELECT string_agg(x, ', ') FROM (SELECT jsonb_object_keys(COALESCE(CASE WHEN act IN ('update','void') THEN chg ELSE '{}'::jsonb END, '{}'::jsonb)) x LIMIT 6) s);

  INSERT INTO debt_audit_log (case_id, organization_id, milestone, description, table_name, record_id, action, old_value, new_value)
  VALUES (cid, org,
          CASE act WHEN 'insert' THEN 'Record added' WHEN 'update' THEN 'Record changed' WHEN 'void' THEN 'Record voided' ELSE 'Record removed' END,
          format('%s in %s%s', initcap(act), replace(replace(TG_TABLE_NAME, 'debt_', ''), '_', ' '), CASE WHEN keys IS NOT NULL THEN ' (' || keys || ')' ELSE '' END),
          TG_TABLE_NAME, NULLIF(rec ->> 'id', '')::uuid, act, oldv, chg);
  RETURN COALESCE(NEW, OLD);
END $$;
REVOKE EXECUTE ON FUNCTION dv_audit_row(), dv_audit_stamp(), dv_audit_immutable() FROM PUBLIC, anon, authenticated;

-- Attach to every case-linked table
DO $$ DECLARE t text; BEGIN
  FOR t IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname LIKE 'debt\_%' AND c.relname <> 'debt_audit_log'
    UNION SELECT x FROM unnest(ARRAY['case_documents','case_tasks','cass_holds','cass_reconciliations','complaints','fee_charges','fee_rules','signing_requests','client_mandates','recurring_payment_schedules','payment_links','portal_change_requests','disbursement_runs','disbursement_run_items','debtverge_vulnerability_flags','debtverge_compliance_attestations','debtverge_communications']) x
  LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_row ON %I', t);
      EXECUTE format('CREATE TRIGGER trg_audit_row AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION dv_audit_row()', t);
    END IF;
  END LOOP;
END $$;

-- Nobody signed in via the API needs TRUNCATE, TRIGGER or REFERENCES on any table
DO $$ DECLARE t record; BEGIN
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r','p') LOOP
    EXECUTE format('REVOKE TRUNCATE, TRIGGER, REFERENCES ON %I FROM anon, authenticated', t.relname);
  END LOOP;
END $$;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLES FROM anon, authenticated;
