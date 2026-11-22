-- Payment Suite, firm-wide operations: creditor payout runs, bank reconciliation, client-money reconciliation and fees.
-- Payout runs follow case access; reconciliation, client money and fees are manager-only.
CREATE OR REPLACE FUNCTION public.dv_payment_suite_ops() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE o uuid := dv_my_org(); mgr boolean; res jsonb;
BEGIN
  IF o IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  mgr := dv_is_manager(o);
  WITH vis AS (SELECT c.id, c.case_number, c.debtor_name FROM debt_cases c WHERE c.organization_id = o AND c.deleted_at IS NULL AND dv_can_read_case(c.id)),
  runs AS (SELECT r.id, r.case_id, r.run_date, r.status, r.total_amount, r.total_items, r.created_at, r.approved_at, r.settled_at, r.created_by, r.approved_by
             FROM disbursement_runs r JOIN vis ON vis.id = r.case_id WHERE r.deleted_at IS NULL AND r.organization_id = o)
  SELECT jsonb_build_object(
    'payouts', jsonb_build_object(
      'awaiting_count', (SELECT count(*) FROM runs WHERE status = 'draft'),
      'awaiting_amount', coalesce((SELECT sum(total_amount) FROM runs WHERE status = 'draft'), 0),
      'failed_count', (SELECT count(*) FROM runs WHERE status = 'failed'),
      'approved_count', (SELECT count(*) FROM runs WHERE status = 'approved'),
      'approved_amount', coalesce((SELECT sum(total_amount) FROM runs WHERE status = 'approved'), 0),
      'settled_30d_amount', coalesce((SELECT sum(total_amount) FROM runs WHERE status = 'settled' AND coalesce(settled_at, approved_at, created_at) >= now() - interval '30 days'), 0),
      'runs', coalesce((SELECT jsonb_agg(jsonb_build_object('id', x.id, 'case_id', x.case_id, 'case_number', vis.case_number, 'debtor_name', vis.debtor_name, 'run_date', x.run_date, 'status', x.status,
                          'total_amount', x.total_amount, 'total_items', x.total_items, 'created_by_me', x.created_by = auth.uid()) ORDER BY x.created_at DESC)
                        FROM (SELECT * FROM runs ORDER BY created_at DESC LIMIT 100) x JOIN vis ON vis.id = x.case_id), '[]'::jsonb)),
    'reconciliation', CASE WHEN NOT mgr THEN NULL ELSE jsonb_build_object(
      'by_status', coalesce((SELECT jsonb_agg(jsonb_build_object('status', s, 'count', n, 'amount', a) ORDER BY n DESC)
                  FROM (SELECT match_status s, count(*) n, coalesce(sum(amount), 0) a FROM bank_transactions WHERE organization_id = o AND deleted_at IS NULL GROUP BY 1) q), '[]'::jsonb),
      'unmatched', coalesce((SELECT jsonb_agg(jsonb_build_object('id', b.id, 'date', b.transaction_date, 'amount', b.amount, 'direction', b.direction, 'reference', b.reference, 'counterparty', b.counterparty_name, 'status', b.match_status, 'notes', b.match_notes) ORDER BY b.transaction_date DESC)
                  FROM (SELECT * FROM bank_transactions WHERE organization_id = o AND deleted_at IS NULL AND match_status NOT IN ('matched','auto_matched','manual_matched','ignored') ORDER BY transaction_date DESC LIMIT 100) b), '[]'::jsonb),
      'feeds', coalesce((SELECT jsonb_agg(jsonb_build_object('name', f.feed_name, 'type', f.feed_type, 'last_import_at', f.last_import_at, 'last_import_count', f.last_import_count, 'active', f.is_active) ORDER BY f.feed_name)
                  FROM bank_feeds f WHERE f.organization_id = o), '[]'::jsonb)) END,
    'client_money', CASE WHEN NOT mgr THEN NULL ELSE jsonb_build_object(
      'last', (SELECT jsonb_build_object('date', r.recon_date, 'bank_balance', r.bank_balance, 'ledger_total', r.ledger_total, 'difference', r.difference, 'note', r.note) FROM cass_reconciliations r WHERE r.organization_id = o ORDER BY r.recon_date DESC, r.created_at DESC LIMIT 1),
      'history', coalesce((SELECT jsonb_agg(jsonb_build_object('date', r.recon_date, 'bank_balance', r.bank_balance, 'ledger_total', r.ledger_total, 'difference', r.difference) ORDER BY r.recon_date DESC)
                  FROM (SELECT * FROM cass_reconciliations WHERE organization_id = o ORDER BY recon_date DESC LIMIT 12) r), '[]'::jsonb),
      'open_holds', (SELECT count(*) FROM cass_holds WHERE organization_id = o AND released_at IS NULL AND deleted_at IS NULL)) END,
    'fees', CASE WHEN NOT mgr THEN NULL ELSE jsonb_build_object(
      'by_status', coalesce((SELECT jsonb_agg(jsonb_build_object('status', s, 'count', n, 'amount', a) ORDER BY n DESC)
                  FROM (SELECT status s, count(*) n, coalesce(sum(amount), 0) a FROM fee_charges WHERE organization_id = o AND deleted_at IS NULL AND charged_on >= current_date - 90 GROUP BY 1) q), '[]'::jsonb)) END
  ) INTO res;
  RETURN res;
END $function$;
REVOKE ALL ON FUNCTION public.dv_payment_suite_ops() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dv_payment_suite_ops() TO authenticated;
