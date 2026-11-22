-- Annual statement for a client: what was paid in, fees taken, what went to each creditor, and what is still owed.
CREATE OR REPLACE FUNCTION dv_annual_statement(p_case uuid, p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE c debt_cases; res jsonb;
BEGIN
  SELECT * INTO c FROM debt_cases WHERE id = p_case;
  IF c.id IS NULL OR NOT dv_can_read_case(p_case) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN RAISE EXCEPTION 'invalid period'; END IF;
  SELECT jsonb_build_object(
    'firm', (SELECT name FROM organizations WHERE id = c.organization_id),
    'client', c.debtor_name, 'case_number', c.case_number, 'from', p_from, 'to', p_to,
    'payments', COALESCE((SELECT jsonb_agg(jsonb_build_object('date', payment_date, 'amount', amount) ORDER BY payment_date) FROM debt_payments WHERE case_id = p_case AND payment_date BETWEEN p_from AND p_to), '[]'),
    'fees', COALESCE((SELECT jsonb_agg(jsonb_build_object('date', decided_at::date, 'amount', amount) ORDER BY decided_at) FROM fee_charges WHERE case_id = p_case AND status = 'taken' AND decided_at::date BETWEEN p_from AND p_to), '[]'),
    'paid_out', COALESCE((SELECT jsonb_agg(jsonb_build_object('date', r.settled_at::date, 'creditor', i.payee_name, 'amount', i.amount) ORDER BY r.settled_at, i.payee_name)
                          FROM disbursement_runs r JOIN disbursement_run_items i ON i.disbursement_run_id = r.id
                          WHERE r.case_id = p_case AND r.status = 'settled' AND r.settled_at::date BETWEEN p_from AND p_to), '[]'),
    'creditors', COALESCE((SELECT jsonb_agg(jsonb_build_object('name', creditor_name, 'reference', account_reference, 'balance', current_balance) ORDER BY creditor_name) FROM debt_creditors WHERE case_id = p_case), '[]'),
    'held_now', dv_case_funds_held(p_case)
  ) INTO res;
  RETURN res;
END $$;

-- Each active plan gets a diary task 30 days before its yearly anniversary, so the annual statement and review is never missed.
CREATE OR REPLACE FUNCTION dv_queue_annual_reviews()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; n int := 0; ann date; yr int; ins int;
BEGIN
  FOR r IN SELECT id, organization_id, assigned_to, created_at::date AS started FROM debt_cases WHERE status = 'payment_schedule_active' LOOP
    yr := extract(year FROM current_date)::int;
    ann := make_date(yr, extract(month FROM r.started)::int, LEAST(extract(day FROM r.started)::int, 28));
    IF ann < current_date THEN ann := ann + interval '1 year'; END IF;
    IF ann - current_date <= 30 AND ann > r.started + 300 THEN
      INSERT INTO case_tasks (case_id, organization_id, title, kind, due_date, assigned_to, source, auto_key)
      VALUES (r.id, r.organization_id, 'Annual statement and plan review', 'review', ann, r.assigned_to, 'auto', 'annual-' || extract(year FROM ann)::int)
      ON CONFLICT DO NOTHING;
      GET DIAGNOSTICS ins = ROW_COUNT; n := n + ins;
    END IF;
  END LOOP;
  RETURN n;
END $$;

REVOKE EXECUTE ON FUNCTION dv_annual_statement(uuid,date,date), dv_queue_annual_reviews() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION dv_annual_statement(uuid,date,date) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION dv_queue_annual_reviews() FROM authenticated;
GRANT EXECUTE ON FUNCTION dv_queue_annual_reviews() TO service_role;
SELECT cron.schedule('dv-annual-reviews', '15 6 * * *', $$ SELECT dv_queue_annual_reviews() $$);
