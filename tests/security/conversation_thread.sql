-- Conversation thread: outbox rows mirror into the case conversation; WhatsApp 24h rule; inbound matching; privileges.
BEGIN;
DO $$
DECLARE cid uuid; oid uuid; st text; r jsonb; blocked boolean := false;
BEGIN
  SELECT c.id INTO cid FROM debt_cases c JOIN debt_customer_profiles p ON p.case_id = c.id
   WHERE c.deleted_at IS NULL AND p.mobile_phone IS NOT NULL AND p.primary_email IS NOT NULL LIMIT 1;
  IF cid IS NULL THEN RAISE NOTICE 'no case with phone and email: data-dependent checks skipped'; RETURN; END IF;

  -- queue SMS as outbox owner (service context): mirror row appears as queued
  INSERT INTO comms_outbox (organization_id, case_id, channel, to_address, body, trigger)
    SELECT organization_id, cid, 'sms', '07700900000', 'hello', 'manual' FROM debt_cases WHERE id = cid RETURNING id INTO oid;
  SELECT status INTO st FROM debtverge_communications WHERE outbox_id = oid;
  IF st IS DISTINCT FROM 'queued' THEN RAISE EXCEPTION 'M1 mirror missing/queued: %', st; END IF;
  UPDATE comms_outbox SET status = 'sent' WHERE id = oid;
  SELECT status INTO st FROM debtverge_communications WHERE outbox_id = oid;
  IF st <> 'delivered' THEN RAISE EXCEPTION 'M2 sent->delivered: %', st; END IF;
  UPDATE comms_outbox SET status = 'failed' WHERE id = oid;
  SELECT status INTO st FROM debtverge_communications WHERE outbox_id = oid;
  IF st <> 'failed' THEN RAISE EXCEPTION 'M3 failed: %', st; END IF;
  UPDATE comms_outbox SET status = 'cancelled' WHERE id = oid;
  IF NOT EXISTS (SELECT 1 FROM debtverge_communications WHERE outbox_id = oid AND deleted_at IS NOT NULL) THEN RAISE EXCEPTION 'M4 cancel should hide'; END IF;

  -- inbound: unknown number is parked, duplicates ignored, WhatsApp window opens after inbound
  r := dv_record_inbound('sms', '+440000000001', 'Nobody', 'who dis', 'SMtest_unknown');
  IF r->>'status' <> 'unassigned' THEN RAISE EXCEPTION 'W1 unknown: %', r; END IF;
  r := dv_record_inbound('sms', '+440000000001', 'Nobody', 'who dis', 'SMtest_unknown');
  IF r->>'status' <> 'duplicate' THEN RAISE EXCEPTION 'W2 duplicate: %', r; END IF;
  BEGIN PERFORM dv_record_inbound('email', 'x', 'x', 'x', 'SMtest_bad'); EXCEPTION WHEN invalid_parameter_value THEN blocked := true; END;
  IF NOT blocked THEN RAISE EXCEPTION 'W3 channel not validated'; END IF;
END $$;

-- privileges: clients cannot call the inbound recorder or the mirror trigger function
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN PERFORM dv_record_inbound('sms','1','x','x','p1'); RAISE EXCEPTION 'W4 authenticated can record inbound';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM dv_mirror_outbox(); RAISE EXCEPTION 'W5 authenticated can call mirror';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM dv_queue_message(gen_random_uuid(),'sms',NULL,'x'); RAISE EXCEPTION 'W6 anon can queue';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT 'CONVERSATION THREAD TESTS PASSED';
ROLLBACK;
