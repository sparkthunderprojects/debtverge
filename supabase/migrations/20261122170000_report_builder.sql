-- Report builder: fixed catalogue of manager reports, firm-scoped, case-restriction aware, audited.
CREATE OR REPLACE FUNCTION public.dv_run_report(p_kind text, p_from date DEFAULT NULL, p_to date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE
  v_org uuid := dv_my_org();
  v_from date := coalesce(p_from, current_date - 90);
  v_to date := coalesce(p_to, current_date);
  v_rows jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_org IS NULL OR NOT dv_is_manager(v_org) THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
  IF v_from > v_to OR v_to - v_from > 1100 THEN RAISE EXCEPTION 'Invalid date range' USING ERRCODE = '22023'; END IF;
  IF p_kind = 'cases_by_status' THEN
    SELECT coalesce(jsonb_agg(r ORDER BY r.cases DESC), '[]') INTO v_rows FROM (SELECT status::text AS status, plan_type::text AS plan, count(*) AS cases, coalesce(sum(total_debt),0) AS total_debt FROM debt_cases c WHERE c.organization_id = v_org AND c.deleted_at IS NULL AND dv_can_read_case(c.id) GROUP BY 1,2) r;
  ELSIF p_kind = 'caseload_by_advisor' THEN
    SELECT coalesce(jsonb_agg(r ORDER BY r.cases DESC), '[]') INTO v_rows FROM (SELECT coalesce(c.assigned_to::text,'Unassigned') AS advisor, count(*) AS cases, coalesce(sum(total_debt),0) AS total_debt FROM debt_cases c WHERE c.organization_id = v_org AND c.deleted_at IS NULL AND dv_can_read_case(c.id) GROUP BY 1) r;
  ELSIF p_kind = 'missed_payments' THEN
    SELECT coalesce(jsonb_agg(r ORDER BY r.payment_date DESC), '[]') INTO v_rows FROM (SELECT c.case_number, c.debtor_name, p.payment_date, p.expected_amount, p.amount, p.shortfall_amount FROM debt_payments p JOIN debt_cases c ON c.id = p.case_id WHERE c.organization_id = v_org AND c.deleted_at IS NULL AND p.deleted_at IS NULL AND p.is_shortfall AND p.payment_date BETWEEN v_from AND v_to AND dv_can_read_case(c.id) LIMIT 5000) r;
  ELSIF p_kind = 'overdue_tasks' THEN
    SELECT coalesce(jsonb_agg(r ORDER BY r.due_date), '[]') INTO v_rows FROM (SELECT c.case_number, c.debtor_name, t.title, t.due_date, t.assigned_to FROM case_tasks t JOIN debt_cases c ON c.id = t.case_id WHERE t.organization_id = v_org AND t.deleted_at IS NULL AND c.deleted_at IS NULL AND t.status <> 'done' AND t.due_date < current_date AND dv_can_read_case(c.id) LIMIT 5000) r;
  ELSIF p_kind = 'complaints' THEN
    SELECT coalesce(jsonb_agg(r ORDER BY r.received_on DESC), '[]') INTO v_rows FROM (SELECT reference, received_on, category, status, vulnerable, referred_to_fos, redress_amount, outcome FROM complaints WHERE organization_id = v_org AND deleted_at IS NULL AND received_on BETWEEN v_from AND v_to LIMIT 5000) r;
  ELSIF p_kind = 'fees' THEN
    SELECT coalesce(jsonb_agg(r ORDER BY r.charged_on DESC), '[]') INTO v_rows FROM (SELECT c.case_number, f.charged_on, f.amount, f.status FROM fee_charges f JOIN debt_cases c ON c.id = f.case_id WHERE f.organization_id = v_org AND f.deleted_at IS NULL AND c.deleted_at IS NULL AND f.charged_on BETWEEN v_from AND v_to AND dv_can_read_case(c.id) LIMIT 5000) r;
  ELSE RAISE EXCEPTION 'Unknown report' USING ERRCODE = '22023';
  END IF;
  INSERT INTO debt_audit_log (organization_id, milestone, description, action, table_name, new_value)
  SELECT v_org, 'report_run', 'Report run: ' || p_kind, 'report_run', 'reports', jsonb_build_object('kind', p_kind, 'from', v_from, 'to', v_to, 'rows', jsonb_array_length(v_rows));
  RETURN v_rows;
END $function$;
REVOKE ALL ON FUNCTION public.dv_run_report(text,date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dv_run_report(text,date,date) TO authenticated;
