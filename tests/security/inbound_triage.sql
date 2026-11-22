-- Per-firm numbers: inbound is matched only within the firm that owns the number; unmatched messages are triaged by that firm only.
BEGIN;
DO $$
DECLARE o1 uuid; o2 uuid; c1 uuid; ph text; r jsonb; mid uuid; st text; n int;
BEGIN
  SELECT c.organization_id, c.id, p.mobile_phone INTO o1, c1, ph FROM debt_cases c JOIN debt_customer_profiles p ON p.case_id=c.id
   WHERE c.deleted_at IS NULL AND length(regexp_replace(coalesce(p.mobile_phone,''),'\D','','g')) >= 10 LIMIT 1;
  IF c1 IS NULL THEN RAISE NOTICE 'no case with a phone: skipped'; RETURN; END IF;
  SELECT id INTO o2 FROM organizations WHERE id <> o1 LIMIT 1;
  INSERT INTO org_phone_numbers (organization_id, e164) VALUES (o1, '+447700900111');
  IF o2 IS NOT NULL THEN INSERT INTO org_phone_numbers (organization_id, e164) VALUES (o2, '+447700900222'); END IF;

  r := dv_record_inbound('sms', ph, 'Test', 'hi', 'SMtri1', '+447700900111');
  IF r->>'status' <> 'matched' THEN RAISE EXCEPTION 'T1 own firm number should match: %', r; END IF;
  IF o2 IS NOT NULL THEN
    r := dv_record_inbound('sms', ph, 'Test', 'hi', 'SMtri2', '+447700900222');
    IF r->>'status' <> 'unassigned' THEN RAISE EXCEPTION 'T2 other firm must not match this case: %', r; END IF;
    SELECT count(*) INTO n FROM debtverge_unassigned_messages WHERE provider_id='SMtri2' AND organization_id = o2;
    IF n <> 1 THEN RAISE EXCEPTION 'T3 parked under the firm that owns the number'; END IF;
  END IF;
  r := dv_record_inbound('sms', ph, 'Test', 'hi', 'SMtri3', '+447700900999');
  IF r->>'status' <> 'unknown_number' THEN RAISE EXCEPTION 'T4 unknown number: %', r; END IF;
  r := dv_record_inbound('whatsapp', '+440000000555', 'Stranger', 'hello', 'SMtri4', '+447700900111');
  IF r->>'status' <> 'unassigned' THEN RAISE EXCEPTION 'T5 unknown sender: %', r; END IF;
  SELECT id INTO mid FROM debtverge_unassigned_messages WHERE provider_id='SMtri4';
  IF (SELECT organization_id FROM debtverge_unassigned_messages WHERE id = mid) <> o1 THEN RAISE EXCEPTION 'T6 org on parked message'; END IF;
END $$;

SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN PERFORM dv_record_inbound('sms','1','x','x','p9','+1'); RAISE EXCEPTION 'T7 client can record inbound'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM 1 FROM org_phone_numbers LIMIT 1; RAISE EXCEPTION 'T8 client can read number table'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN INSERT INTO debtverge_unassigned_messages (channel,sender_name,sender_email_or_phone,body) VALUES ('sms','a','b','c'); RAISE EXCEPTION 'T9 client can insert unassigned'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM dv_list_unassigned(); RAISE EXCEPTION 'T10 anon can list'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM dv_assign_unassigned(gen_random_uuid(), gen_random_uuid()); RAISE EXCEPTION 'T11 anon can assign'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT 'INBOUND TRIAGE TESTS PASSED';
ROLLBACK;
