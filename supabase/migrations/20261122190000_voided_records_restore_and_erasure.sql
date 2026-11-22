-- Restore voided cases and GDPR-style erasure of personal data.
-- Erasure anonymises personal fields, keeps financial records, creditor data, document hashes and the audit trail,
-- and writes an immutable erasure_log row. Admin / Operations Manager only; refused while client money, open complaints or open payouts exist.
ALTER TABLE public.debt_cases ADD COLUMN IF NOT EXISTS erased_at timestamptz;

CREATE TABLE IF NOT EXISTS public.erasure_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  case_id uuid NOT NULL,
  case_number text,
  reason text NOT NULL,
  fields_erased int NOT NULL DEFAULT 0,
  erased_by uuid NOT NULL,
  erased_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.erasure_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY erasure_log_read ON public.erasure_log FOR SELECT TO authenticated USING (dv_is_org_admin(organization_id));
REVOKE ALL ON public.erasure_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.erasure_log TO authenticated;
CREATE TRIGGER erasure_log_immutable BEFORE UPDATE OR DELETE ON public.erasure_log FOR EACH ROW EXECUTE FUNCTION dv_audit_immutable();
CREATE TRIGGER erasure_log_no_truncate BEFORE TRUNCATE ON public.erasure_log FOR EACH STATEMENT EXECUTE FUNCTION dv_audit_immutable();

-- Row audit is skipped only while an erasure runs (so personal data is not copied into the audit log); a summary row is written instead.
-- Patch applied to dv_audit_row(): first statement of the body is
--   IF current_setting('dv.erasing', true) = 'on' THEN RETURN COALESCE(NEW, OLD); END IF;
DO $m$ DECLARE d text; BEGIN
  d := pg_get_functiondef('public.dv_audit_row()'::regprocedure);
  d := replace(d, E'BEGIN\n  IF TG_OP = ''DELETE''', E'BEGIN\n  IF current_setting(''dv.erasing'', true) = ''on'' THEN RETURN COALESCE(NEW, OLD); END IF;\n  IF TG_OP = ''DELETE''');
  EXECUTE d;
END $m$;

CREATE OR REPLACE FUNCTION public.dv_list_voided_cases()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE v_org uuid := dv_my_org();
BEGIN
  IF auth.uid() IS NULL OR v_org IS NULL OR NOT dv_is_manager(v_org) THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501'; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'case_number', c.case_number, 'debtor_name', c.debtor_name,
            'voided_at', c.deleted_at, 'erased_at', c.erased_at) ORDER BY c.deleted_at DESC)
     FROM (SELECT * FROM debt_cases WHERE organization_id = v_org AND deleted_at IS NOT NULL
             AND (NOT is_restricted OR dv_is_org_admin(v_org)) ORDER BY deleted_at DESC LIMIT 500) c), '[]');
END $function$;

CREATE OR REPLACE FUNCTION public.dv_restore_case(p_case uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE v_org uuid := dv_my_org(); c debt_cases;
BEGIN
  IF auth.uid() IS NULL OR v_org IS NULL OR NOT dv_is_manager(v_org) THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501'; END IF;
  SELECT * INTO c FROM debt_cases WHERE id = p_case AND organization_id = v_org FOR UPDATE;
  IF NOT FOUND OR c.deleted_at IS NULL THEN RAISE EXCEPTION 'Case is not voided' USING ERRCODE='22023'; END IF;
  IF c.erased_at IS NOT NULL THEN RAISE EXCEPTION 'Erased cases cannot be restored' USING ERRCODE='22023'; END IF;
  IF c.is_restricted AND NOT dv_is_org_admin(v_org) THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501'; END IF;
  UPDATE debt_cases SET deleted_at = NULL, deleted_by = NULL WHERE id = p_case;
END $function$;

CREATE OR REPLACE FUNCTION public.dv_erase_case(p_case uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE
  v_org uuid := dv_my_org(); c debt_cases; v_funds numeric; v_fields int := 0; t record; col text; r record; n int;
  -- personal-data columns per case-linked table. Financial reference data, creditor details and the hash of signed documents are kept.
  plan jsonb := '{
    "debt_customer_profiles":["full_name","primary_email","landline_phone","mobile_phone","work_phone","address_street","address_city","address_postcode","landlord_lender_name"],
    "debt_previous_addresses":["address_line"],
    "debt_breathing_spaces":["nominated_contact_name","nominated_contact_phone","nominated_contact_email","amhp_evidence_file_name"],
    "comms_outbox":["to_address","subject","body"],
    "debtverge_communications":["sender_name","sender_email_or_phone","recipient_name","recipient_email_or_phone","subject","body"],
    "case_documents":["name","body"],
    "case_tasks":["notes"],
    "complaints":["complainant","summary"],
    "signing_requests":["signer_name","signer_agent","body"],
    "storm_call_callbacks":["phone_number","customer_name","notes"],
    "storm_call_sessions":["caller_phone","caller_name","callee_phone","callee_name","call_notes"],
    "payment_link_invitations":["debtor_name"],
    "payment_methods":["cardholder_name"],
    "bank_transactions":["counterparty_name","description"],
    "debt_bank_transactions":["description"],
    "debt_vulnerability_assessments":["notes"],
    "debt_benefits_checks":["notes"],
    "debt_negotiations":["notes"]
  }';
BEGIN
  IF auth.uid() IS NULL OR v_org IS NULL OR NOT dv_is_org_admin(v_org) THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501'; END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 10 THEN RAISE EXCEPTION 'Give a reason (at least 10 characters)' USING ERRCODE='22023'; END IF;
  SELECT * INTO c FROM debt_cases WHERE id = p_case AND organization_id = v_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Case not found' USING ERRCODE='22023'; END IF;
  IF c.deleted_at IS NULL THEN RAISE EXCEPTION 'Void the case before erasing it' USING ERRCODE='22023'; END IF;
  IF c.erased_at IS NOT NULL THEN RAISE EXCEPTION 'Already erased' USING ERRCODE='22023'; END IF;
  IF EXISTS (SELECT 1 FROM complaints WHERE case_id = p_case AND status <> 'closed') THEN RAISE EXCEPTION 'The case has an open complaint' USING ERRCODE='22023'; END IF;
  IF EXISTS (SELECT 1 FROM disbursement_runs WHERE case_id = p_case AND status IN ('draft','approved')) THEN RAISE EXCEPTION 'The case has an open creditor payout' USING ERRCODE='22023'; END IF;
  v_funds := COALESCE((SELECT sum(amount) FROM debt_payments WHERE deleted_at IS NULL AND case_id = p_case),0)
           - COALESCE((SELECT sum(amount) FROM fee_charges WHERE case_id = p_case AND status = 'taken'),0)
           - COALESCE((SELECT sum(total_amount) FROM disbursement_runs WHERE case_id = p_case AND status <> 'failed'),0);
  IF abs(v_funds) > 0.005 THEN RAISE EXCEPTION 'The case still holds client money (%). Distribute or return it first', v_funds USING ERRCODE='22023'; END IF;

  PERFORM set_config('dv.erasing', 'on', true);
  FOR t IN SELECT key AS tbl, value AS cols FROM jsonb_each(plan) LOOP
    IF to_regclass('public.' || t.tbl) IS NULL THEN CONTINUE; END IF;
    FOR col IN SELECT jsonb_array_elements_text(t.cols) LOOP
      SELECT is_nullable, data_type INTO r FROM information_schema.columns WHERE table_schema='public' AND table_name = t.tbl AND column_name = col;
      CONTINUE WHEN NOT FOUND OR r.data_type NOT IN ('text','character varying');
      EXECUTE format('UPDATE public.%I SET %I = %s WHERE case_id = $1 AND %I IS NOT NULL', t.tbl, col,
                     CASE WHEN r.is_nullable = 'YES' THEN 'NULL' ELSE quote_literal('[erased]') END, col) USING p_case;
      GET DIAGNOSTICS n = ROW_COUNT; v_fields := v_fields + n;
    END LOOP;
  END LOOP;
  UPDATE debt_cases SET debtor_name = '[erased]', debtor_reference = NULL, notes = NULL, erased_at = now() WHERE id = p_case;
  PERFORM set_config('dv.erasing', 'off', true);

  INSERT INTO erasure_log (organization_id, case_id, case_number, reason, fields_erased, erased_by) VALUES (v_org, p_case, c.case_number, btrim(p_reason), v_fields, auth.uid());
  INSERT INTO debt_audit_log (case_id, organization_id, milestone, description, action, table_name, record_id, new_value)
  VALUES (p_case, v_org, 'Case erased', 'Personal data erased from case ' || c.case_number, 'erase', 'debt_cases', p_case, jsonb_build_object('fields_erased', v_fields, 'reason', btrim(p_reason)));
  RETURN jsonb_build_object('fields_erased', v_fields);
END $function$;

REVOKE ALL ON FUNCTION public.dv_list_voided_cases(), public.dv_restore_case(uuid), public.dv_erase_case(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dv_list_voided_cases(), public.dv_restore_case(uuid), public.dv_erase_case(uuid, text) TO authenticated;
