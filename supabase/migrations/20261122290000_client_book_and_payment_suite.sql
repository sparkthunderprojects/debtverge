-- Client book: every client on the firm's books, filterable, sortable and paged. Payment suite: the firm's money in one place.
CREATE OR REPLACE FUNCTION public.dv_client_book(p_q text DEFAULT NULL, p_status text DEFAULT NULL, p_plan text DEFAULT NULL, p_adviser uuid DEFAULT NULL, p_flag text DEFAULT NULL,
  p_sort text DEFAULT 'name', p_dir text DEFAULT 'asc', p_limit int DEFAULT 50, p_offset int DEFAULT 0)
RETURNS TABLE (case_id uuid, case_number text, debtor_name text, status text, plan_type text, adviser_id uuid, adviser_name text, total_debt numeric, creditor_count int,
  installment_amount numeric, payment_frequency text, next_due_date date, arrears_days int, open_complaints int, last_contact timestamptz, created_at timestamptz, total_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE o uuid := dv_my_org(); lim int := greatest(1, least(coalesce(p_limit, 50), 500)); off int := greatest(0, coalesce(p_offset, 0)); q text := nullif(btrim(coalesce(p_q, '')), '');
        pat text; srt text := coalesce(p_sort, 'name'); dir text := CASE WHEN lower(coalesce(p_dir, 'asc')) = 'desc' THEN 'desc' ELSE 'asc' END;
BEGIN
  IF o IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF lim > 100 AND NOT dv_is_manager(o) THEN lim := 100; END IF;
  IF srt NOT IN ('name','case_number','status','adviser','debt','next_due','arrears','last_contact','created') THEN srt := 'name'; END IF;
  IF p_flag IS NOT NULL AND p_flag NOT IN ('arrears','complaint','quiet_30d','no_schedule') THEN RAISE EXCEPTION 'unknown filter' USING ERRCODE = '22023'; END IF;
  IF q IS NOT NULL THEN pat := '%' || replace(replace(replace(lower(q), '\', '\\'), '%', '\%'), '_', '\_') || '%'; END IF;
  RETURN QUERY
  WITH base AS (
    SELECT c.id, c.case_number AS cn, c.debtor_name AS dn, c.status::text AS st, c.plan_type::text AS pt, c.assigned_to, coalesce(pr.full_name, pr.email) AS an,
           c.total_debt AS td, (SELECT count(*)::int FROM debt_creditors dc WHERE dc.case_id = c.id AND dc.deleted_at IS NULL) AS cc,
           c.installment_amount AS ia, c.payment_frequency AS pf, c.next_due_date AS nd,
           coalesce((SELECT max(current_date - t.due_date) FROM debt_payment_transactions t WHERE t.case_id = c.id AND t.deleted_at IS NULL
                      AND (t.status::text IN ('missed','bounced','overdue') OR (t.status::text = 'scheduled' AND t.due_date < current_date)) AND t.amount_paid < t.amount_due), 0)::int AS ad,
           (SELECT count(*)::int FROM complaints x WHERE x.case_id = c.id AND x.deleted_at IS NULL AND x.status <> 'closed') AS oc,
           (SELECT max(m.created_at) FROM debtverge_communications m WHERE m.case_id = c.id AND m.deleted_at IS NULL AND m.channel <> 'internal_note') AS lc,
           c.created_at AS ca
    FROM debt_cases c LEFT JOIN profiles pr ON pr.id = c.assigned_to
    WHERE c.organization_id = o AND c.deleted_at IS NULL AND dv_can_read_case(c.id)
      AND (p_status IS NULL OR c.status::text = p_status) AND (p_plan IS NULL OR c.plan_type::text = p_plan) AND (p_adviser IS NULL OR c.assigned_to = p_adviser)
      AND (pat IS NULL OR lower(c.debtor_name) LIKE pat ESCAPE '\' OR lower(c.case_number) LIKE pat ESCAPE '\')
  ), f AS (
    SELECT b.* FROM base b WHERE p_flag IS NULL
       OR (p_flag = 'arrears' AND b.ad > 0) OR (p_flag = 'complaint' AND b.oc > 0)
       OR (p_flag = 'quiet_30d' AND b.st NOT IN ('completed','closed') AND (b.lc IS NULL OR b.lc < now() - interval '30 days'))
       OR (p_flag = 'no_schedule' AND b.st NOT IN ('completed','closed','intake') AND b.nd IS NULL)
  )
  SELECT f.id, f.cn, f.dn, f.st, f.pt, f.assigned_to, f.an, f.td, f.cc, f.ia, f.pf, f.nd, f.ad, f.oc, f.lc, f.ca, count(*) OVER ()
  FROM f
  ORDER BY
    CASE WHEN srt = 'name' AND dir = 'asc' THEN lower(f.dn) END ASC, CASE WHEN srt = 'name' AND dir = 'desc' THEN lower(f.dn) END DESC,
    CASE WHEN srt = 'case_number' AND dir = 'asc' THEN f.cn END ASC, CASE WHEN srt = 'case_number' AND dir = 'desc' THEN f.cn END DESC,
    CASE WHEN srt = 'status' AND dir = 'asc' THEN f.st END ASC, CASE WHEN srt = 'status' AND dir = 'desc' THEN f.st END DESC,
    CASE WHEN srt = 'adviser' AND dir = 'asc' THEN lower(f.an) END ASC, CASE WHEN srt = 'adviser' AND dir = 'desc' THEN lower(f.an) END DESC,
    CASE WHEN srt = 'debt' AND dir = 'asc' THEN f.td END ASC, CASE WHEN srt = 'debt' AND dir = 'desc' THEN f.td END DESC,
    CASE WHEN srt = 'next_due' AND dir = 'asc' THEN f.nd END ASC, CASE WHEN srt = 'next_due' AND dir = 'desc' THEN f.nd END DESC,
    CASE WHEN srt = 'arrears' AND dir = 'asc' THEN f.ad END ASC, CASE WHEN srt = 'arrears' AND dir = 'desc' THEN f.ad END DESC,
    CASE WHEN srt = 'last_contact' AND dir = 'asc' THEN f.lc END ASC, CASE WHEN srt = 'last_contact' AND dir = 'desc' THEN f.lc END DESC,
    CASE WHEN srt = 'created' AND dir = 'asc' THEN f.ca END ASC, CASE WHEN srt = 'created' AND dir = 'desc' THEN f.ca END DESC,
    f.id
  LIMIT lim OFFSET off;
END $function$;
REVOKE ALL ON FUNCTION public.dv_client_book(text,text,text,uuid,text,text,text,int,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dv_client_book(text,text,text,uuid,text,text,text,int,int) TO authenticated;

CREATE OR REPLACE FUNCTION public.dv_payment_suite() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE o uuid := dv_my_org(); res jsonb;
BEGIN
  IF o IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  WITH vis AS (SELECT c.id, c.case_number, c.debtor_name, coalesce(pr.full_name, pr.email) AS adviser FROM debt_cases c LEFT JOIN profiles pr ON pr.id = c.assigned_to
                WHERE c.organization_id = o AND c.deleted_at IS NULL AND dv_can_read_case(c.id)),
  due AS (SELECT t.id, t.case_id, t.due_date, t.amount_due, t.amount_paid, t.status::text AS st, t.failure_reason FROM debt_payment_transactions t JOIN vis ON vis.id = t.case_id WHERE t.deleted_at IS NULL),
  overdue AS (SELECT d.*, current_date - d.due_date AS days FROM due d WHERE d.amount_paid < d.amount_due AND (d.st IN ('missed','bounced','overdue') OR (d.st = 'scheduled' AND d.due_date < current_date))),
  upcoming AS (SELECT d.* FROM due d WHERE d.st = 'scheduled' AND d.due_date >= current_date AND d.due_date <= current_date + 30),
  rec AS (SELECT p.id, p.case_id, p.amount, p.payment_date, p.reference, p.is_shortfall, p.shortfall_amount FROM debt_payments p JOIN vis ON vis.id = p.case_id WHERE p.deleted_at IS NULL AND p.payment_date >= current_date - 90),
  links AS (SELECT l.id, l.case_id, l.amount, l.reason, l.channel, l.status, l.created_at, l.expires_at, l.paid_at FROM payment_links l JOIN vis ON vis.id = l.case_id WHERE l.deleted_at IS NULL)
  SELECT jsonb_build_object(
    'kpis', jsonb_build_object(
      'due_today_count', (SELECT count(*) FROM upcoming WHERE due_date = current_date), 'due_today_amount', coalesce((SELECT sum(amount_due - amount_paid) FROM upcoming WHERE due_date = current_date), 0),
      'next7_count', (SELECT count(*) FROM upcoming WHERE due_date <= current_date + 7), 'next7_amount', coalesce((SELECT sum(amount_due - amount_paid) FROM upcoming WHERE due_date <= current_date + 7), 0),
      'overdue_count', (SELECT count(*) FROM overdue), 'overdue_amount', coalesce((SELECT sum(amount_due - amount_paid) FROM overdue), 0),
      'overdue_clients', (SELECT count(DISTINCT case_id) FROM overdue),
      'received_90d', coalesce((SELECT sum(amount) FROM rec), 0), 'received_90d_count', (SELECT count(*) FROM rec),
      'shortfalls_90d', (SELECT count(*) FROM rec WHERE is_shortfall),
      'links_open_count', (SELECT count(*) FROM links WHERE paid_at IS NULL AND status NOT IN ('paid','cancelled','expired','void') AND (expires_at IS NULL OR expires_at > now())),
      'links_open_amount', coalesce((SELECT sum(amount) FROM links WHERE paid_at IS NULL AND status NOT IN ('paid','cancelled','expired','void') AND (expires_at IS NULL OR expires_at > now())), 0),
      'links_paid_30d', (SELECT count(*) FROM links WHERE paid_at >= now() - interval '30 days')),
    'overdue', coalesce((SELECT jsonb_agg(jsonb_build_object('case_id', x.case_id, 'case_number', vis.case_number, 'debtor_name', vis.debtor_name, 'adviser', vis.adviser, 'due_date', x.due_date, 'days', x.days, 'amount', x.amount_due - x.amount_paid, 'status', x.st, 'reason', x.failure_reason) ORDER BY x.days DESC)
                         FROM (SELECT * FROM overdue ORDER BY days DESC LIMIT 100) x JOIN vis ON vis.id = x.case_id), '[]'::jsonb),
    'upcoming', coalesce((SELECT jsonb_agg(jsonb_build_object('case_id', x.case_id, 'case_number', vis.case_number, 'debtor_name', vis.debtor_name, 'adviser', vis.adviser, 'due_date', x.due_date, 'amount', x.amount_due - x.amount_paid) ORDER BY x.due_date)
                          FROM (SELECT * FROM upcoming ORDER BY due_date LIMIT 100) x JOIN vis ON vis.id = x.case_id), '[]'::jsonb),
    'receipts', coalesce((SELECT jsonb_agg(jsonb_build_object('case_id', x.case_id, 'case_number', vis.case_number, 'debtor_name', vis.debtor_name, 'date', x.payment_date, 'amount', x.amount, 'reference', x.reference, 'shortfall', x.is_shortfall, 'shortfall_amount', x.shortfall_amount) ORDER BY x.payment_date DESC)
                          FROM (SELECT * FROM rec ORDER BY payment_date DESC LIMIT 100) x JOIN vis ON vis.id = x.case_id), '[]'::jsonb),
    'links', coalesce((SELECT jsonb_agg(jsonb_build_object('id', x.id, 'case_id', x.case_id, 'case_number', vis.case_number, 'debtor_name', vis.debtor_name, 'amount', x.amount, 'reason', x.reason, 'channel', x.channel, 'status', x.status, 'created_at', x.created_at, 'expires_at', x.expires_at, 'paid_at', x.paid_at) ORDER BY x.created_at DESC)
                          FROM (SELECT * FROM links ORDER BY created_at DESC LIMIT 100) x JOIN vis ON vis.id = x.case_id), '[]'::jsonb)
  ) INTO res;
  RETURN res;
END $function$;
REVOKE ALL ON FUNCTION public.dv_payment_suite() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dv_payment_suite() TO authenticated;
