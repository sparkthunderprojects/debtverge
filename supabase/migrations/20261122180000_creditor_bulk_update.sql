-- Creditor bulk update: manager-only CSV-driven update of balance / settlement offer / interest rate.
-- Preview never writes. Apply only updates rows that resolve to exactly one creditor on one editable case in the caller's firm.
-- Row-level changes are captured by the automatic audit trigger; one summary row is added per batch.
CREATE OR REPLACE FUNCTION public.dv_bulk_creditor_resolve(p_rows jsonb)
RETURNS TABLE(idx integer, case_number text, match_key text, creditor_id uuid, creditor_name text, status text, old_balance numeric, new_balance numeric, old_offer numeric, new_offer numeric, old_rate numeric, new_rate numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE
  v_org uuid := dv_my_org();
  r jsonb; i int := 0; n int; v_case uuid; cnt int;
  num text := '^\d{1,12}(\.\d{1,4})?$';
BEGIN
  IF v_org IS NULL OR NOT dv_is_manager(v_org) THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501'; END IF;
  IF jsonb_typeof(p_rows) <> 'array' THEN RAISE EXCEPTION 'Rows must be an array' USING ERRCODE='22023'; END IF;
  n := jsonb_array_length(p_rows);
  IF n = 0 OR n > 2000 THEN RAISE EXCEPTION 'Provide between 1 and 2000 rows' USING ERRCODE='22023'; END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    i := i + 1;
    idx := i; creditor_id := NULL; creditor_name := NULL; status := NULL;
    old_balance := NULL; old_offer := NULL; old_rate := NULL; new_balance := NULL; new_offer := NULL; new_rate := NULL;
    case_number := left(btrim(coalesce(r->>'case_number','')), 100);
    match_key := left(btrim(coalesce(r->>'match','')), 200);
    IF jsonb_typeof(r) <> 'object' OR case_number = '' OR match_key = '' THEN status := 'invalid'; RETURN NEXT; CONTINUE; END IF;
    IF (r ? 'balance' AND coalesce(r->>'balance','') <> '' AND (r->>'balance') !~ num)
    OR (r ? 'offer' AND coalesce(r->>'offer','') <> '' AND (r->>'offer') !~ num)
    OR (r ? 'rate' AND coalesce(r->>'rate','') <> '' AND ((r->>'rate') !~ num OR (r->>'rate')::numeric > 100)) THEN
      status := 'invalid'; RETURN NEXT; CONTINUE;
    END IF;
    new_balance := nullif(r->>'balance','')::numeric; new_offer := nullif(r->>'offer','')::numeric; new_rate := nullif(r->>'rate','')::numeric;
    IF new_balance IS NULL AND new_offer IS NULL AND new_rate IS NULL THEN status := 'nothing_to_update'; RETURN NEXT; CONTINUE; END IF;
    SELECT count(*), min(dc.id::text)::uuid INTO cnt, v_case FROM debt_cases dc
      WHERE dc.organization_id = v_org AND dc.deleted_at IS NULL AND dc.case_number = dv_bulk_creditor_resolve.case_number;
    IF cnt = 0 THEN status := 'case_not_found'; RETURN NEXT; CONTINUE; END IF;
    IF cnt > 1 THEN status := 'ambiguous_case'; RETURN NEXT; CONTINUE; END IF;
    IF NOT dv_can_edit_case(v_case) THEN status := 'case_not_found'; RETURN NEXT; CONTINUE; END IF;
    SELECT count(*), min(cr.id::text)::uuid INTO cnt, creditor_id FROM debt_creditors cr
      WHERE cr.case_id = v_case AND cr.deleted_at IS NULL
        AND (lower(cr.account_reference) = lower(match_key) OR lower(cr.creditor_name) = lower(match_key));
    IF cnt = 0 THEN status := 'creditor_not_found'; creditor_id := NULL; RETURN NEXT; CONTINUE; END IF;
    IF cnt > 1 THEN status := 'ambiguous_creditor'; creditor_id := NULL; RETURN NEXT; CONTINUE; END IF;
    SELECT cr.creditor_name, cr.current_balance, cr.settlement_offer, cr.interest_rate INTO creditor_name, old_balance, old_offer, old_rate
      FROM debt_creditors cr WHERE cr.id = creditor_id;
    status := CASE WHEN coalesce(new_balance, old_balance) IS NOT DISTINCT FROM old_balance
                    AND coalesce(new_offer, old_offer) IS NOT DISTINCT FROM old_offer
                    AND coalesce(new_rate, old_rate) IS NOT DISTINCT FROM old_rate THEN 'unchanged' ELSE 'will_update' END;
    RETURN NEXT;
  END LOOP;
END $function$;

CREATE OR REPLACE FUNCTION public.dv_bulk_creditor_preview(p_rows jsonb)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
  SELECT coalesce(jsonb_agg(to_jsonb(x) - 'creditor_id' ORDER BY x.idx), '[]') FROM dv_bulk_creditor_resolve(p_rows) x;
$function$;

CREATE OR REPLACE FUNCTION public.dv_bulk_creditor_apply(p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE v_org uuid := dv_my_org(); x record; v_upd int := 0; v_skip int := 0;
BEGIN
  FOR x IN SELECT * FROM dv_bulk_creditor_resolve(p_rows) LOOP
    IF x.status = 'will_update' THEN
      UPDATE debt_creditors SET
        current_balance = coalesce(x.new_balance, current_balance),
        settlement_offer = coalesce(x.new_offer, settlement_offer),
        interest_rate = coalesce(x.new_rate, interest_rate)
      WHERE id = x.creditor_id AND deleted_at IS NULL;
      v_upd := v_upd + 1;
    ELSE v_skip := v_skip + 1; END IF;
  END LOOP;
  INSERT INTO debt_audit_log (organization_id, milestone, description, action, table_name, new_value)
  VALUES (v_org, 'bulk_creditor_update', 'Bulk creditor update', 'bulk_update', 'debt_creditors', jsonb_build_object('updated', v_upd, 'skipped', v_skip));
  RETURN jsonb_build_object('updated', v_upd, 'skipped', v_skip);
END $function$;

REVOKE ALL ON FUNCTION public.dv_bulk_creditor_resolve(jsonb), public.dv_bulk_creditor_preview(jsonb), public.dv_bulk_creditor_apply(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dv_bulk_creditor_preview(jsonb), public.dv_bulk_creditor_apply(jsonb) TO authenticated;
