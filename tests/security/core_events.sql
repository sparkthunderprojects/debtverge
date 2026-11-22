-- core_events security test (A5: events between apps)
-- Paste into the Supabase SQL editor / execute_sql. Runs in a transaction and rolls back.
-- Ends with 'ALL TESTS PASSED' or raises a named FAIL.
BEGIN;

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at) VALUES
  ('e1000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ce-qual@test.invalid','x',now(),now()),
  ('e1000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ce-mgr@test.invalid','x',now(),now()),
  ('e1000000-0000-0000-0000-00000000000c','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ce-draft@test.invalid','x',now(),now()),
  ('e1000000-0000-0000-0000-00000000000f','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ce-adv@test.invalid','x',now(),now()),
  ('e1000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ce-qual2@test.invalid','x',now(),now()),
  ('e2000000-0000-0000-0000-00000000000e','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ce-adv-b@test.invalid','x',now(),now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO organizations (id, name, slug, owner_id) VALUES
  ('e1000000-1111-0000-0000-000000000001','CE Firm A','ce-firm-a','e1000000-0000-0000-0000-00000000000b'),
  ('e2000000-1111-0000-0000-000000000002','CE Firm B','ce-firm-b','e2000000-0000-0000-0000-00000000000e');
SELECT seed_debtverge_roles('e1000000-1111-0000-0000-000000000001');
SELECT seed_debtverge_roles('e2000000-1111-0000-0000-000000000002');

-- Firm A: DebtVerge, Qualify, Draft and Storm Call (not Compliance). Firm B: DebtVerge only.
INSERT INTO dv_org_products (organization_id, product_key) VALUES
  ('e1000000-1111-0000-0000-000000000001','dmp_advisor'),
  ('e1000000-1111-0000-0000-000000000001','qualifyverge'),
  ('e1000000-1111-0000-0000-000000000001','draftverge'),
  ('e1000000-1111-0000-0000-000000000001','voip'),
  ('e2000000-1111-0000-0000-000000000002','dmp_advisor');

INSERT INTO organization_users (organization_id, user_id, role_id)
SELECT 'e1000000-1111-0000-0000-000000000001', u.id, r.id FROM (VALUES
  ('e1000000-0000-0000-0000-00000000000a'::uuid,'Qualifier'),
  ('e1000000-0000-0000-0000-00000000000b'::uuid,'Team Manager'),
  ('e1000000-0000-0000-0000-00000000000c'::uuid,'Drafter'),
  ('e1000000-0000-0000-0000-00000000000f'::uuid,'Advisor'),
  ('e1000000-0000-0000-0000-000000000011'::uuid,'Qualifier')) u(id,rn)
JOIN rbac_roles r ON r.organization_id = 'e1000000-1111-0000-0000-000000000001' AND r.name = u.rn;
INSERT INTO organization_users (organization_id, user_id, role_id)
SELECT 'e2000000-1111-0000-0000-000000000002','e2000000-0000-0000-0000-00000000000e', r.id
  FROM rbac_roles r WHERE r.organization_id='e2000000-1111-0000-0000-000000000002' AND r.name='Advisor';

INSERT INTO debt_cases (id, user_id, organization_id, assigned_to, case_number, debtor_name, is_restricted) VALUES
  ('e1000000-2222-0000-0000-000000000001','e1000000-0000-0000-0000-00000000000f','e1000000-1111-0000-0000-000000000001','e1000000-0000-0000-0000-00000000000f','CE-A1','CE Client A1',false),
  ('e1000000-2222-0000-0000-000000000002','e1000000-0000-0000-0000-00000000000f','e1000000-1111-0000-0000-000000000001','e1000000-0000-0000-0000-00000000000f','CE-A2','CE Client A2',false),
  ('e2000000-2222-0000-0000-000000000001','e2000000-0000-0000-0000-00000000000e','e2000000-1111-0000-0000-000000000002','e2000000-0000-0000-0000-00000000000e','CE-B1','CE Client B1',false);

SELECT set_config('ce.a1', (SELECT client_id::text FROM debt_cases WHERE case_number='CE-A1'), true),
       set_config('ce.a2', (SELECT client_id::text FROM debt_cases WHERE case_number='CE-A2'), true),
       set_config('ce.b1', (SELECT client_id::text FROM debt_cases WHERE case_number='CE-B1'), true);

-- Opening a case announces itself to DebtVerge only
DO $$
DECLARE n int;
BEGIN
  IF (SELECT count(*) FROM core_event_types) <> 3 THEN RAISE EXCEPTION 'FAIL 1: expected 3 event types'; END IF;
  SELECT count(*) INTO n FROM core_events WHERE event_type = 'client.stage_changed'
     AND client_id IN (current_setting('ce.a1')::uuid, current_setting('ce.a2')::uuid, current_setting('ce.b1')::uuid)
     AND payload->>'from_stage' IS NULL AND payload->>'to_stage' = 'debtverge';
  IF n <> 3 THEN RAISE EXCEPTION 'FAIL 2: each new case should raise one stage event, got %', n; END IF;
  SELECT count(*) INTO n FROM core_event_deliveries d JOIN core_events e ON e.id = d.event_id
   WHERE e.client_id IN (current_setting('ce.a1')::uuid, current_setting('ce.a2')::uuid, current_setting('ce.b1')::uuid);
  IF n <> 3 THEN RAISE EXCEPTION 'FAIL 3: opening a case should deliver to DebtVerge only, got % deliveries', n; END IF;
END $$;

-- anon is shut out; signed-in users cannot touch the tables
SET LOCAL ROLE anon;
DO $$
DECLARE ok boolean := false;
BEGIN
  BEGIN PERFORM core_event_claim('debtverge'); EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL 4: anon can claim events'; END IF;
  ok := false;
  BEGIN PERFORM core_event_raise('call.completed'); EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL 5: anon can raise events'; END IF;
END $$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"e1000000-0000-0000-0000-00000000000a","role":"authenticated"}',true);
DO $$
DECLARE ok boolean := false;
BEGIN
  BEGIN PERFORM 1 FROM core_events; EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL 6: a user read core_events directly'; END IF;
  ok := false;
  BEGIN PERFORM 1 FROM core_event_deliveries; EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL 7: a user read core_event_deliveries directly'; END IF;
  ok := false;
  BEGIN INSERT INTO core_events (organization_id, event_type, source_app) VALUES ('e1000000-1111-0000-0000-000000000001','call.completed','stormcall'); EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL 8: a user wrote core_events directly'; END IF;
  ok := false;
  BEGIN PERFORM core_event_emit('e1000000-1111-0000-0000-000000000001','call.completed',NULL,'{}','x','stormcall',ARRAY['compliance'],NULL); EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL 9: a user called the internal emit function'; END IF;
END $$;
RESET ROLE;

-- The manager moves A1 into Qualify: one event, to the app being left and the app being entered
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"e1000000-0000-0000-0000-00000000000b","role":"authenticated"}',true);
DO $$ BEGIN PERFORM core_client_change_stage(current_setting('ce.a1')::uuid,'debtverge','qualify','Re-assess, may need an IVA'); END $$;
RESET ROLE;
DO $$
DECLARE apps text[];
BEGIN
  SELECT array_agg(d.app_id ORDER BY d.app_id) INTO apps FROM core_event_deliveries d JOIN core_events e ON e.id = d.event_id
   WHERE e.client_id = current_setting('ce.a1')::uuid AND e.payload->>'to_stage' = 'qualify';
  IF apps IS DISTINCT FROM ARRAY['debtverge','qualifyverge'] THEN RAISE EXCEPTION 'FAIL 10: stage move should go to debtverge and qualifyverge, got %', apps; END IF;
END $$;

-- Qualifier: receives it once, only for its own app
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"e1000000-0000-0000-0000-00000000000a","role":"authenticated"}',true);
DO $$
DECLARE g jsonb; ok boolean := false;
BEGIN
  g := core_event_claim('qualifyverge');
  IF jsonb_array_length(g) <> 1 THEN RAISE EXCEPTION 'FAIL 11: qualifier should receive 1 event, got %', jsonb_array_length(g); END IF;
  IF g->0->>'event_type' <> 'client.stage_changed' OR g->0->'payload'->>'to_stage' <> 'qualify' OR (g->0->>'attempts')::int <> 1 THEN
    RAISE EXCEPTION 'FAIL 12: wrong event received'; END IF;
  PERFORM set_config('ce.d1', g->0->>'delivery_id', true);
  IF jsonb_array_length(core_event_claim('qualifyverge')) <> 0 THEN RAISE EXCEPTION 'FAIL 13: a leased event was handed out twice'; END IF;
  BEGIN PERFORM core_event_claim('debtverge'); EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL 14: qualifier received events for an app they cannot use'; END IF;
END $$;
RESET ROLE;

-- Another qualifier cannot confirm someone else's delivery; the owner can, and only once
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"e1000000-0000-0000-0000-000000000011","role":"authenticated"}',true);
DO $$
DECLARE ok boolean := false;
BEGIN
  BEGIN PERFORM core_event_ack(current_setting('ce.d1')::uuid); EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL 15: confirmed a delivery claimed by someone else'; END IF;
  ok := false;
  BEGIN PERFORM core_event_fail(current_setting('ce.d1')::uuid, 'not mine'); EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL 16: failed a delivery claimed by someone else'; END IF;
END $$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"e1000000-0000-0000-0000-00000000000a","role":"authenticated"}',true);
DO $$
BEGIN
  PERFORM core_event_ack(current_setting('ce.d1')::uuid);
  PERFORM core_event_ack(current_setting('ce.d1')::uuid);  -- confirming again is harmless
  IF jsonb_array_length(core_event_claim('qualifyverge')) <> 0 THEN RAISE EXCEPTION 'FAIL 17: a delivered event came back'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
  IF (SELECT status FROM core_event_deliveries WHERE id = current_setting('ce.d1')::uuid) <> 'delivered'
     OR (SELECT delivered_at FROM core_event_deliveries WHERE id = current_setting('ce.d1')::uuid) IS NULL
  THEN RAISE EXCEPTION 'FAIL 18: delivery not marked delivered'; END IF;
END $$;

-- Advisor: sees only events for clients they can read (A1 has moved to a stage they cannot use), retries then gives up
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"e1000000-0000-0000-0000-00000000000f","role":"authenticated"}',true);
DO $$
DECLARE g jsonb; ok boolean := false; i int;
BEGIN
  g := core_event_claim('debtverge');
  IF jsonb_array_length(g) <> 1 OR (g->0->>'client_id')::uuid <> current_setting('ce.a2')::uuid THEN
    RAISE EXCEPTION 'FAIL 19: advisor should receive only the event for the client they can read, got %', g; END IF;
  BEGIN PERFORM core_event_claim('qualifyverge'); EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL 20: advisor claimed qualify events'; END IF;
  FOR i IN 1..4 LOOP
    PERFORM core_event_fail((g->0->>'delivery_id')::uuid, 'boom');
    g := core_event_claim('debtverge');
    IF jsonb_array_length(g) <> 1 OR (g->0->>'attempts')::int <> i + 1 THEN RAISE EXCEPTION 'FAIL 21: retry % did not come back with the right attempt count', i; END IF;
  END LOOP;
  PERFORM core_event_fail((g->0->>'delivery_id')::uuid, 'boom');
  IF jsonb_array_length(core_event_claim('debtverge')) <> 0 THEN RAISE EXCEPTION 'FAIL 22: an event that failed 5 times kept coming back'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM core_event_deliveries d JOIN core_events e ON e.id = d.event_id
                  WHERE e.client_id = current_setting('ce.a2')::uuid AND d.status = 'dead' AND d.last_error = 'boom' AND d.attempts = 5)
  THEN RAISE EXCEPTION 'FAIL 23: the delivery was not marked dead with its error'; END IF;
END $$;

-- Raising: licence, permission, payload, client and firm checks
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"e1000000-0000-0000-0000-00000000000f","role":"authenticated"}',true);
DO $$
DECLARE ok boolean := false;
BEGIN
  BEGIN PERFORM core_event_raise('qualification.decided', current_setting('ce.a2')::uuid, '{"outcome":"dmp"}', 'x'); EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL 24: advisor raised a Qualify event'; END IF;
END $$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"e1000000-0000-0000-0000-00000000000b","role":"authenticated"}',true);
DO $$
DECLARE ok boolean := false;
BEGIN
  BEGIN PERFORM core_event_raise('client.stage_changed', current_setting('ce.a1')::uuid, '{}', 'forged'); EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL 25: a user forged a system event'; END IF;
  ok := false;
  BEGIN PERFORM core_event_raise('no.such_event'); EXCEPTION WHEN invalid_parameter_value THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL 26: unknown event type accepted'; END IF;
  ok := false;
  BEGIN PERFORM core_event_raise('qualification.decided', current_setting('ce.a1')::uuid, '[1]'::jsonb); EXCEPTION WHEN invalid_parameter_value THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL 27: a payload that is not an object was accepted'; END IF;
  ok := false;
  BEGIN PERFORM core_event_raise('qualification.decided', current_setting('ce.a1')::uuid, jsonb_build_object('x', repeat('a', 9000))); EXCEPTION WHEN invalid_parameter_value THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL 28: an oversized payload was accepted'; END IF;
END $$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"e1000000-0000-0000-0000-00000000000a","role":"authenticated"}',true);
DO $$
DECLARE r jsonb; r2 jsonb; ok boolean := false;
BEGIN
  r := core_event_raise('qualification.decided', current_setting('ce.a1')::uuid, '{"outcome":"iva"}', 'dec-1');
  IF (r->>'duplicate')::boolean OR (r->>'deliveries')::int <> 2 THEN RAISE EXCEPTION 'FAIL 29: decision should go to debtverge and draftverge, got %', r; END IF;
  r2 := core_event_raise('qualification.decided', current_setting('ce.a1')::uuid, '{"outcome":"iva"}', 'dec-1');
  IF NOT (r2->>'duplicate')::boolean OR r2->>'event_id' <> r->>'event_id' OR (r2->>'deliveries')::int <> 0 THEN RAISE EXCEPTION 'FAIL 30: the same dedupe key raised a second event'; END IF;
  -- Compliance is not licensed to this firm, so a completed call is logged but delivered nowhere
  r := core_event_raise('call.completed', current_setting('ce.a1')::uuid, '{"seconds":120}', 'call-1');
  IF (r->>'deliveries')::int <> 0 THEN RAISE EXCEPTION 'FAIL 31: delivered to an app the firm is not licensed for'; END IF;
  BEGIN PERFORM core_event_raise('qualification.decided', current_setting('ce.b1')::uuid, '{}', 'cross'); EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL 32: raised an event about another firm''s client'; END IF;
END $$;
RESET ROLE;

-- Drafter receives the decision, and an expired lease is offered again
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"e1000000-0000-0000-0000-00000000000c","role":"authenticated"}',true);
DO $$
DECLARE g jsonb;
BEGIN
  g := core_event_claim('draftverge');
  IF jsonb_array_length(g) <> 1 OR g->0->>'event_type' <> 'qualification.decided' OR g->0->'payload'->>'outcome' <> 'iva' THEN
    RAISE EXCEPTION 'FAIL 33: drafter should receive the decision, got %', g; END IF;
  PERFORM set_config('ce.d2', g->0->>'delivery_id', true);
END $$;
RESET ROLE;
UPDATE core_event_deliveries SET claimed_until = now() - interval '1 minute' WHERE id = current_setting('ce.d2')::uuid;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"e1000000-0000-0000-0000-00000000000c","role":"authenticated"}',true);
DO $$
DECLARE g jsonb;
BEGIN
  g := core_event_claim('draftverge');
  IF jsonb_array_length(g) <> 1 OR (g->0->>'attempts')::int <> 2 THEN RAISE EXCEPTION 'FAIL 34: an expired lease was not offered again, got %', g; END IF;
END $$;
RESET ROLE;

-- Manager log; others refused
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"e1000000-0000-0000-0000-00000000000b","role":"authenticated"}',true);
DO $$
DECLARE l jsonb;
BEGIN
  l := core_event_log(current_setting('ce.a1')::uuid);
  IF jsonb_array_length(l) <> 4 THEN RAISE EXCEPTION 'FAIL 35: client log should hold 4 events, got %', jsonb_array_length(l); END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(l) e WHERE e->>'event_type' = 'qualification.decided' AND jsonb_array_length(e->'deliveries') = 2) THEN
    RAISE EXCEPTION 'FAIL 36: log is missing the delivery rows'; END IF;
END $$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"e1000000-0000-0000-0000-00000000000a","role":"authenticated"}',true);
DO $$
DECLARE ok boolean := false;
BEGIN
  BEGIN PERFORM core_event_log(); EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL 37: a non-manager read the event log'; END IF;
END $$;
RESET ROLE;

-- Firm B sees only its own events and cannot touch firm A's
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"e2000000-0000-0000-0000-00000000000e","role":"authenticated"}',true);
DO $$
DECLARE g jsonb; ok boolean := false;
BEGIN
  g := core_event_claim('debtverge');
  IF jsonb_array_length(g) <> 1 OR (g->0->>'client_id')::uuid <> current_setting('ce.b1')::uuid THEN RAISE EXCEPTION 'FAIL 38: firm B should receive only its own event, got %', g; END IF;
  BEGIN PERFORM core_event_ack(current_setting('ce.d1')::uuid); EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL 39: firm B confirmed firm A''s delivery'; END IF;
  ok := false;
  BEGIN PERFORM core_event_claim('draftverge'); EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL 40: firm B claimed events for an app it is not licensed for'; END IF;
  ok := false;
  BEGIN PERFORM core_event_raise('call.completed', NULL, '{}', 'b-call'); EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL 41: firm B raised an event for an app it is not licensed for'; END IF;
END $$;
RESET ROLE;

-- The log can never be changed or removed
DO $$
DECLARE ok boolean := false;
BEGIN
  BEGIN UPDATE core_events SET payload = '{"x":1}'; EXCEPTION WHEN OTHERS THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL 42: an event was changed'; END IF;
  ok := false;
  BEGIN DELETE FROM core_events; EXCEPTION WHEN OTHERS THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL 43: an event was deleted'; END IF;
  ok := false;
  BEGIN DELETE FROM core_event_deliveries; EXCEPTION WHEN OTHERS THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL 44: a delivery was deleted'; END IF;
END $$;

SELECT 'ALL TESTS PASSED' AS result;
ROLLBACK;
