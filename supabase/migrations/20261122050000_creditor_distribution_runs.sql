-- Creditor distribution run with maker-checker: one person prepares, a different manager approves, then it is marked paid.
ALTER TABLE disbursement_runs ADD COLUMN IF NOT EXISTS created_by uuid;

-- Funds available to distribute on a case = payments received minus everything already in a non-failed run.
CREATE OR REPLACE FUNCTION dv_case_funds_held(p_case uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN dv_can_read_case(p_case) THEN
    COALESCE((SELECT sum(amount) FROM debt_payments WHERE case_id = p_case),0)
    - COALESCE((SELECT sum(total_amount) FROM disbursement_runs WHERE case_id = p_case AND status <> 'failed'),0)
  END;
$$;

CREATE OR REPLACE FUNCTION dv_create_distribution_run(p_case uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c debt_cases; funds numeric; tot numeric; rid uuid; allocated numeric;
BEGIN
  SELECT * INTO c FROM debt_cases WHERE id = p_case;
  IF c.id IS NULL OR NOT dv_can_edit_case(p_case) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM disbursement_runs WHERE case_id = p_case AND status IN ('draft','approved')) THEN
    RAISE EXCEPTION 'there is already a distribution run waiting to be approved or paid on this case';
  END IF;
  funds := dv_case_funds_held(p_case);
  IF funds IS NULL OR funds < 0.01 THEN RAISE EXCEPTION 'no funds available to distribute'; END IF;
  SELECT COALESCE(sum(current_balance),0) INTO tot FROM debt_creditors WHERE case_id = p_case AND current_balance > 0;
  IF tot <= 0 THEN RAISE EXCEPTION 'no creditors with an outstanding balance'; END IF;
  funds := LEAST(funds, tot);

  INSERT INTO disbursement_runs (organization_id, case_id, run_date, status, output_format, total_amount, total_items, created_by, file_reference)
  VALUES (c.organization_id, p_case, current_date, 'draft', 'manual_instruction', funds, 0, auth.uid(), 'DIST-' || to_char(current_date,'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,6)))
  RETURNING id INTO rid;

  INSERT INTO disbursement_run_items (disbursement_run_id, payee_name, payee_reference, category, amount, status)
  SELECT rid, creditor_name, account_reference, 'creditor',
         LEAST(current_balance, round(funds * current_balance / tot, 2)), 'pending'
  FROM debt_creditors WHERE case_id = p_case AND current_balance > 0;

  -- put any rounding remainder on the creditor with the largest balance
  SELECT COALESCE(sum(amount),0) INTO allocated FROM disbursement_run_items WHERE disbursement_run_id = rid;
  IF funds - allocated <> 0 THEN
    UPDATE disbursement_run_items SET amount = amount + (funds - allocated)
    WHERE id = (SELECT i.id FROM disbursement_run_items i JOIN debt_creditors d ON d.case_id = p_case AND d.creditor_name = i.payee_name
                WHERE i.disbursement_run_id = rid ORDER BY d.current_balance DESC LIMIT 1);
  END IF;
  UPDATE disbursement_runs SET total_items = (SELECT count(*) FROM disbursement_run_items WHERE disbursement_run_id = rid),
                               total_amount = (SELECT sum(amount) FROM disbursement_run_items WHERE disbursement_run_id = rid)
  WHERE id = rid;
  INSERT INTO debt_audit_log (case_id, milestone, description) VALUES (p_case, 'Distribution prepared', format('Creditor distribution of £%s prepared for approval', to_char(funds,'FM999999990.00')));
  RETURN rid;
END $$;

CREATE OR REPLACE FUNCTION dv_approve_distribution_run(p_run uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r disbursement_runs;
BEGIN
  SELECT * INTO r FROM disbursement_runs WHERE id = p_run;
  IF r.id IS NULL OR r.organization_id IS NULL OR NOT dv_is_manager(r.organization_id) OR NOT dv_can_read_case(r.case_id) THEN RAISE EXCEPTION 'managers only' USING ERRCODE = '42501'; END IF;
  IF r.status <> 'draft' THEN RAISE EXCEPTION 'run is not waiting for approval'; END IF;
  IF r.created_by IS NOT DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'a different manager must approve a run you prepared' USING ERRCODE = '42501'; END IF;
  UPDATE disbursement_runs SET status = 'approved', approved_by = auth.uid(), approved_at = now() WHERE id = p_run;
  INSERT INTO debt_audit_log (case_id, milestone, description) VALUES (r.case_id, 'Distribution approved', format('Creditor distribution %s approved', r.file_reference));
END $$;

CREATE OR REPLACE FUNCTION dv_cancel_distribution_run(p_run uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r disbursement_runs;
BEGIN
  SELECT * INTO r FROM disbursement_runs WHERE id = p_run;
  IF r.id IS NULL OR NOT dv_can_edit_case(r.case_id) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF r.status NOT IN ('draft','approved') THEN RAISE EXCEPTION 'only runs not yet paid can be cancelled'; END IF;
  UPDATE disbursement_runs SET status = 'failed' WHERE id = p_run;
  UPDATE disbursement_run_items SET status = 'failed' WHERE disbursement_run_id = p_run;
  INSERT INTO debt_audit_log (case_id, milestone, description) VALUES (r.case_id, 'Distribution cancelled', format('Creditor distribution %s cancelled', r.file_reference));
END $$;

-- Record that the approved run has been paid out (manual BACS/Faster Payments by the firm) and log each creditor payment.
CREATE OR REPLACE FUNCTION dv_mark_distribution_paid(p_run uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r disbursement_runs;
BEGIN
  SELECT * INTO r FROM disbursement_runs WHERE id = p_run;
  IF r.id IS NULL OR r.organization_id IS NULL OR NOT dv_is_manager(r.organization_id) OR NOT dv_can_read_case(r.case_id) THEN RAISE EXCEPTION 'managers only' USING ERRCODE = '42501'; END IF;
  IF r.status <> 'approved' THEN RAISE EXCEPTION 'run must be approved first'; END IF;
  UPDATE disbursement_runs SET status = 'settled', settled_at = now() WHERE id = p_run;
  UPDATE disbursement_run_items SET status = 'settled' WHERE disbursement_run_id = p_run;
  INSERT INTO debt_audit_log (case_id, milestone, description) VALUES (r.case_id, 'Distribution paid', format('Creditor distribution %s marked as paid (£%s)', r.file_reference, to_char(r.total_amount,'FM999999990.00')));
END $$;

-- Run items can only change through the functions above.
CREATE POLICY dv_r_items_no_direct_ins ON disbursement_run_items AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY dv_r_items_no_direct_upd ON disbursement_run_items AS RESTRICTIVE FOR UPDATE TO authenticated USING (false);
CREATE POLICY dv_r_items_no_direct_del ON disbursement_run_items AS RESTRICTIVE FOR DELETE TO authenticated USING (false);

REVOKE EXECUTE ON FUNCTION dv_case_funds_held(uuid), dv_create_distribution_run(uuid), dv_approve_distribution_run(uuid), dv_cancel_distribution_run(uuid), dv_mark_distribution_paid(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION dv_case_funds_held(uuid), dv_create_distribution_run(uuid), dv_approve_distribution_run(uuid), dv_cancel_distribution_run(uuid), dv_mark_distribution_paid(uuid) TO authenticated, service_role;
