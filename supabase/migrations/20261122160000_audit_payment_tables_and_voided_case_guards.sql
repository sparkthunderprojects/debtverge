-- Audit function: never copies bank/card details or tokens into the log; audits payment tables; voided cases are ignored by helpers;
-- call-record tables get soft delete + audit.
CREATE OR REPLACE FUNCTION dv_audit_row() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o jsonb; n jsonb; rec jsonb; cid uuid; org uuid; act text; chg jsonb := '{}'; oldv jsonb := '{}'; k text; keys text;
  secret_keys text[] := ARRAY['token','link_token','gateway_token','counterparty_account','cardholder_name','account_number','sort_code','iban'];
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
      CONTINUE WHEN k = 'updated_at' OR k = ANY (secret_keys);
      IF o -> k IS DISTINCT FROM n -> k THEN chg := chg || jsonb_build_object(k, n -> k); oldv := oldv || jsonb_build_object(k, o -> k); END IF;
    END LOOP;
    IF chg = '{}'::jsonb THEN RETURN NEW; END IF;
    act := CASE WHEN (n ->> 'deleted_at') IS NOT NULL AND (o ->> 'deleted_at') IS NULL THEN 'void' ELSE 'update' END;
  ELSIF TG_OP = 'INSERT' THEN act := 'insert'; chg := n - secret_keys; oldv := NULL;
  ELSE act := 'delete'; oldv := o - secret_keys; chg := NULL; END IF;
  keys := (SELECT string_agg(x, ', ') FROM (SELECT jsonb_object_keys(COALESCE(CASE WHEN act IN ('update','void') THEN chg ELSE '{}'::jsonb END, '{}'::jsonb)) x LIMIT 6) s);
  INSERT INTO debt_audit_log (case_id, organization_id, milestone, description, table_name, record_id, action, old_value, new_value)
  VALUES (cid, org,
          CASE act WHEN 'insert' THEN 'Record added' WHEN 'update' THEN 'Record changed' WHEN 'void' THEN 'Record voided' ELSE 'Record removed' END,
          format('%s in %s%s', initcap(act), replace(replace(TG_TABLE_NAME, 'debt_', ''), '_', ' '), CASE WHEN keys IS NOT NULL THEN ' (' || keys || ')' ELSE '' END),
          TG_TABLE_NAME, NULLIF(rec ->> 'id', '')::uuid, act, oldv, chg);
  RETURN COALESCE(NEW, OLD);
END $$;
REVOKE EXECUTE ON FUNCTION dv_audit_row() FROM PUBLIC, anon, authenticated;

DO $$ DECLARE f record; def text; BEGIN
  FOR f IN SELECT p.oid FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('assign_case','set_case_restricted','log_case_view','list_org_members') LOOP
    def := pg_get_functiondef(f.oid);
    def := replace(def, 'FROM debt_cases WHERE id = p_case;', 'FROM debt_cases WHERE id = p_case AND deleted_at IS NULL;');
    def := replace(def, 'UPDATE debt_cases SET is_restricted = p_restricted, updated_at = now() WHERE id = p_case;', 'UPDATE debt_cases SET is_restricted = p_restricted, updated_at = now() WHERE id = p_case AND deleted_at IS NULL;');
    def := replace(def, 'FROM debt_cases c WHERE c.organization_id = ou.organization_id', 'FROM debt_cases c WHERE c.deleted_at IS NULL AND c.organization_id = ou.organization_id');
    EXECUTE def;
  END LOOP;
  FOR f IN SELECT c.relname FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('v','m') LOOP
    EXECUTE format('REVOKE TRUNCATE, TRIGGER, REFERENCES ON %I FROM anon, authenticated', f.relname);
  END LOOP;
END $$;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['bank_transactions','batch_payment_items','disbursement_waterfall_entries','gateway_payment_transactions','payment_attempts','payment_link_invitations','payment_methods'] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS deleted_at timestamptz', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS deleted_by uuid', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_row ON %I', t);
    EXECUTE format('CREATE TRIGGER trg_audit_row AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION dv_audit_row()', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['storm_call_timeline_events','storm_call_callbacks','storm_call_sessions'] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS deleted_at timestamptz', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS deleted_by uuid', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_soft_delete ON %I', t);
    EXECUTE format('CREATE TRIGGER trg_soft_delete BEFORE DELETE ON %I FOR EACH ROW EXECUTE FUNCTION dv_soft_delete()', t);
    EXECUTE format('DROP POLICY IF EXISTS dv_r_live_sel ON %I', t);
    EXECUTE format('CREATE POLICY dv_r_live_sel ON %I AS RESTRICTIVE FOR SELECT USING (deleted_at IS NULL)', t);
    EXECUTE format('DROP POLICY IF EXISTS dv_r_live_upd ON %I', t);
    EXECUTE format('CREATE POLICY dv_r_live_upd ON %I AS RESTRICTIVE FOR UPDATE USING (deleted_at IS NULL) WITH CHECK (deleted_at IS NULL)', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_row ON %I', t);
    EXECUTE format('CREATE TRIGGER trg_audit_row AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION dv_audit_row()', t);
  END LOOP;
END $$;
