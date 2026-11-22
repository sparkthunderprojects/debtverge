-- 1. Soft delete: a DELETE from the app marks the row voided instead of removing it. Voided rows are hidden by RLS and ignored by money functions.
CREATE OR REPLACE FUNCTION dv_soft_delete() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  EXECUTE format('UPDATE %I.%I SET deleted_at = now(), deleted_by = %L WHERE id = %L AND deleted_at IS NULL', TG_TABLE_SCHEMA, TG_TABLE_NAME, auth.uid(), OLD.id);
  RETURN NULL;
END $$;
REVOKE EXECUTE ON FUNCTION dv_soft_delete() FROM PUBLIC, anon, authenticated;

DO $$ DECLARE t text; BEGIN
  FOR t IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND (c.relname = 'debt_cases' OR c.relname = 'disbursement_run_items' OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'case_id' AND NOT a.attisdropped))
      AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'id' AND NOT a.attisdropped)
      AND c.relname NOT IN ('debt_audit_log','case_access_log','cashier_audit_logs','payment_reconciliation_log','storm_call_callbacks','storm_call_sessions','storm_call_timeline_events')
  LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS deleted_at timestamptz', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS deleted_by uuid', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_soft_delete ON %I', t);
    EXECUTE format('CREATE TRIGGER trg_soft_delete BEFORE DELETE ON %I FOR EACH ROW EXECUTE FUNCTION dv_soft_delete()', t);
    EXECUTE format('DROP POLICY IF EXISTS dv_r_live_sel ON %I', t);
    EXECUTE format('CREATE POLICY dv_r_live_sel ON %I AS RESTRICTIVE FOR SELECT USING (deleted_at IS NULL)', t);
    EXECUTE format('DROP POLICY IF EXISTS dv_r_live_upd ON %I', t);
    EXECUTE format('CREATE POLICY dv_r_live_upd ON %I AS RESTRICTIVE FOR UPDATE USING (deleted_at IS NULL) WITH CHECK (deleted_at IS NULL)', t);
  END LOOP;
END $$;

REVOKE DELETE ON fee_rules, cass_reconciliations, complaint_events FROM authenticated, anon;

-- 2. Functions ignore voided rows and lock the rows they change (one writer at a time per case / run / fee)
DO $$ DECLARE f record; def text; BEGIN
  FOR f IN SELECT p.oid, p.proname, p.provolatile FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname IN ('dv_annual_statement','dv_approve_distribution_run','dv_cancel_distribution_run','dv_case_funds_held','dv_cass_position','dv_cass_release_hold','dv_cass_set_hold','dv_create_distribution_run','dv_decide_fee','dv_mark_distribution_paid','dv_post_fees','get_payment_link','dv_can_read_case','dv_can_edit_case','dv_create_signing_request','dv_ensure_case_tasks','dv_queue_message','dv_queue_annual_reviews','dv_queue_missed_payment_chasers')
  LOOP
    def := pg_get_functiondef(f.oid);
    def := replace(def, 'FROM debt_payments WHERE ', 'FROM debt_payments WHERE deleted_at IS NULL AND ');
    def := replace(def, 'FROM debt_payments p WHERE ', 'FROM debt_payments p WHERE p.deleted_at IS NULL AND ');
    def := replace(def, 'JOIN debt_payments p ON p.case_id = h.id', 'JOIN debt_payments p ON p.case_id = h.id AND p.deleted_at IS NULL');
    def := replace(def, 'FROM debt_creditors WHERE ', 'FROM debt_creditors WHERE deleted_at IS NULL AND ');
    def := replace(def, 'JOIN debt_creditors d ON d.case_id = p_case AND d.creditor_name = i.payee_name', 'JOIN debt_creditors d ON d.case_id = p_case AND d.deleted_at IS NULL AND d.creditor_name = i.payee_name');
    def := replace(def, 'FROM debt_cases c WHERE c.organization_id = org', 'FROM debt_cases c WHERE c.deleted_at IS NULL AND c.organization_id = org');
    def := replace(def, 'WHERE c.id = cid AND', 'WHERE c.id = cid AND c.deleted_at IS NULL AND');
    def := replace(def, 'FROM debt_cases WHERE status = ''payment_schedule_active''', 'FROM debt_cases WHERE deleted_at IS NULL AND status = ''payment_schedule_active''');
    def := replace(def, 'WHERE c.status = ''payment_schedule_active'' AND c.next_due_date', 'WHERE c.deleted_at IS NULL AND c.status = ''payment_schedule_active'' AND c.next_due_date');
    def := replace(def, 'LEFT JOIN debt_customer_profiles p ON p.case_id = c.id', 'LEFT JOIN debt_customer_profiles p ON p.case_id = c.id AND p.deleted_at IS NULL');
    IF f.provolatile = 'v' AND f.proname IN ('dv_post_fees','dv_cass_set_hold','dv_cass_release_hold','dv_create_distribution_run') THEN
      def := replace(def, 'SELECT * INTO c FROM debt_cases WHERE id = p_case;', 'SELECT * INTO c FROM debt_cases WHERE id = p_case AND deleted_at IS NULL FOR UPDATE;');
    ELSE
      def := replace(def, 'SELECT * INTO c FROM debt_cases WHERE id = p_case;', 'SELECT * INTO c FROM debt_cases WHERE id = p_case AND deleted_at IS NULL;');
    END IF;
    def := replace(def, 'SELECT * INTO r FROM disbursement_runs WHERE id = p_run;', 'SELECT * INTO r FROM disbursement_runs WHERE id = p_run FOR UPDATE;');
    def := replace(def, 'SELECT * INTO f FROM fee_charges WHERE id = p_charge;', 'SELECT * INTO f FROM fee_charges WHERE id = p_charge FOR UPDATE;');
    EXECUTE def;
  END LOOP;
END $$;

-- 3. Hard guarantee: one open distribution run per case, even if two requests race
CREATE UNIQUE INDEX IF NOT EXISTS disbursement_runs_one_open_per_case ON disbursement_runs (case_id) WHERE status IN ('draft','approved');
