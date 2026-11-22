-- core_calls security test (B1a: calls belong to a shared client, or to nobody)
-- Paste into the Supabase SQL editor / execute_sql. Runs in a transaction and rolls back.
-- Ends with 'ALL TESTS PASSED' or raises a named FAIL.
BEGIN;

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at) VALUES
  ('f1000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-000000000000','authenticated','authenticated','cc-adv@test.invalid','x',now(),now()),
  ('f1000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-000000000000','authenticated','authenticated','cc-mgr@test.invalid','x',now(),now()),
  ('f2000000-0000-0000-0000-00000000000d','00000000-0000-0000-0000-000000000000','authenticated','authenticated','cc-dial@test.invalid','x',now(),now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO organizations (id, name, slug, owner_id) VALUES
  ('f1000000-1111-0000-0000-000000000001','CC Firm A','cc-firm-a','f1000000-0000-0000-0000-00000000000b'),
  ('f2000000-1111-0000-0000-000000000002','CC Firm D (dialler only)','cc-firm-d','f2000000-0000-0000-0000-00000000000d');
SELECT seed_debtverge_roles('f1000000-1111-0000-0000-000000000001');
SELECT seed_debtverge_roles('f2000000-1111-0000-0000-000000000002');

DELETE FROM dv_org_products WHERE organization_id IN ('f1000000-1111-0000-0000-000000000001','f2000000-1111-0000-0000-000000000002');
INSERT INTO dv_org_products (organization_id, product_key) VALUES
  ('f1000000-1111-0000-0000-000000000001','dmp_advisor'),
  ('f1000000-1111-0000-0000-000000000001','qualifyverge'),
  ('f1000000-1111-0000-0000-000000000001','voip'),
  ('f1000000-1111-0000-0000-000000000001','compliance'),
  ('f2000000-1111-0000-0000-000000000002','voip'),
  ('f2000000-1111-0000-0000-000000000002','compliance');

INSERT INTO organization_users (organization_id, user_id, role_id)
SELECT 'f1000000-1111-0000-0000-000000000001', u.id, r.id FROM (VALUES
  ('f1000000-0000-0000-0000-00000000000a'::uuid,'Advisor'),
  ('f1000000-0000-0000-0000-00000000000b'::uuid,'Team Manager')) u(id,rn)
JOIN rbac_roles r ON r.organization_id = 'f1000000-1111-0000-0000-000000000001' AND r.name = u.rn;
INSERT INTO organization_users (organization_id, user_id, role_id)
SELECT 'f2000000-1111-0000-0000-000000000002','f2000000-0000-0000-0000-00000000000d', r.id
  FROM rbac_roles r WHERE r.organization_id='f2000000-1111-0000-0000-000000000002' AND r.name='Team Manager';

INSERT INTO debt_cases (id, user_id, organization_id, assigned_to, case_number, debtor_name, is_restricted) VALUES
  ('f1000000-2222-0000-0000-000000000001','f1000000-0000-0000-0000-00000000000a','f1000000-1111-0000-0000-000000000001','f1000000-0000-0000-0000-00000000000a','CC-A1','CC Client A1',false);

-- clients with no case: one open, one restricted (Firm A, in Qualify), one in Firm D
INSERT INTO core_clients (id, organization_id, display_name, current_stage, assigned_to, created_by, is_restricted) VALUES
  ('f1000000-3333-0000-0000-000000000001','f1000000-1111-0000-0000-000000000001','CC Qualify Client','qualify','f1000000-0000-0000-0000-00000000000b','f1000000-0000-0000-0000-00000000000b',false),
  ('f1000000-3333-0000-0000-000000000002','f1000000-1111-0000-0000-000000000001','CC Restricted Client','qualify','f1000000-0000-0000-0000-00000000000b','f1000000-0000-0000-0000-00000000000b',true),
  ('f2000000-3333-0000-0000-000000000001','f2000000-1111-0000-0000-000000000002','CC Other Firm Client','qualify','f2000000-0000-0000-0000-00000000000d','f2000000-0000-0000-0000-00000000000d',false);

DO $$ BEGIN
  IF NOT core_org_has_client_apps('f1000000-1111-0000-0000-000000000001') THEN RAISE EXCEPTION 'FAIL 1: firm A has client apps'; END IF;
  IF core_org_has_client_apps('f2000000-1111-0000-0000-000000000002') THEN RAISE EXCEPTION 'FAIL 2: dialler-only firm reports client apps'; END IF;
END $$;

-- anon is shut out
SET LOCAL ROLE anon;
DO $$ DECLARE ok boolean := false; BEGIN
  BEGIN PERFORM dv_call_start_for(NULL, '07700900123'); EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL 3: anon started a call'; END IF;
END $$;
RESET ROLE;

-- Firm A manager: call for a client with no case
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"f1000000-0000-0000-0000-00000000000b","role":"authenticated"}',true);
DO $$
DECLARE r jsonb; ok boolean;
BEGIN
  r := dv_call_start_for('f1000000-3333-0000-0000-000000000001','07700900123');
  PERFORM set_config('cc.c1', r->>'call_id', true);
  ok := false;
  BEGIN PERFORM dv_call_start_for('f2000000-3333-0000-0000-000000000001','07700900123'); EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL 5: started a call for another firm''s client'; END IF;
  ok := false;
  BEGIN PERFORM * FROM dv_call_sessions; EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL 6: direct table read allowed'; END IF;
  PERFORM dv_call_finish(current_setting('cc.c1')::uuid, 'no_answer', NULL);
  ok := false;
  BEGIN PERFORM dv_call_finish(current_setting('cc.c1')::uuid, 'no_answer', NULL); EXCEPTION WHEN SQLSTATE '22023' THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL 8: a call was wrapped up twice'; END IF;
END $$;
RESET ROLE;

DO $$
DECLARE s record; n int; d int;
BEGIN
  SELECT * INTO s FROM dv_call_sessions WHERE id = current_setting('cc.c1')::uuid;
  IF s.client_id IS DISTINCT FROM 'f1000000-3333-0000-0000-000000000001'::uuid OR s.case_id IS NOT NULL THEN RAISE EXCEPTION 'FAIL 4: call not tied to the client alone'; END IF;
  SELECT count(*) INTO n FROM core_events WHERE event_type = 'call.completed' AND dedupe_key = 'call:' || s.id::text;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL 7: expected one call.completed event, got %', n; END IF;
  SELECT count(*) INTO d FROM core_event_deliveries x JOIN core_events e ON e.id = x.event_id
   WHERE e.dedupe_key = 'call:' || s.id::text AND x.app_id = 'compliance';
  IF d <> 1 THEN RAISE EXCEPTION 'FAIL 9: event not delivered to compliance, got %', d; END IF;
  IF (SELECT client_id FROM core_events WHERE dedupe_key = 'call:' || s.id::text) IS DISTINCT FROM s.client_id THEN RAISE EXCEPTION 'FAIL 10: event not tied to client'; END IF;
END $$;

-- Firm A: clientless call must be filed first (wrong number is the one exception); restricted client is closed to an Advisor
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"f1000000-0000-0000-0000-00000000000a","role":"authenticated"}',true);
DO $$
DECLARE r jsonb; ok boolean := false;
BEGIN
  BEGIN PERFORM dv_call_start_for('f1000000-3333-0000-0000-000000000002','07700900123'); EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL 11: advisor called a restricted client'; END IF;
  r := dv_call_start_for(NULL,'07700900124');
  ok := false;
  BEGIN PERFORM dv_call_finish((r->>'call_id')::uuid, 'no_answer', NULL); EXCEPTION WHEN SQLSTATE '22023' THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL 12: clientless call wrapped up in a firm with client apps'; END IF;
  PERFORM dv_call_finish((r->>'call_id')::uuid, 'wrong_number', NULL);
  -- a call on a case picks the client up by itself
  r := dv_call_start('f1000000-2222-0000-0000-000000000001','07700900125');
  PERFORM set_config('cc.c2', r->>'call_id', true);
  PERFORM dv_call_finish((r->>'call_id')::uuid, 'no_answer', NULL);
END $$;
RESET ROLE;

DO $$ BEGIN
  IF (SELECT client_id FROM dv_call_sessions WHERE id = current_setting('cc.c2')::uuid)
     IS DISTINCT FROM (SELECT client_id FROM debt_cases WHERE case_number = 'CC-A1') THEN RAISE EXCEPTION 'FAIL 13: case call did not pick up the client'; END IF;
END $$;

-- Dialler-only firm: no client needed; the event still goes to compliance
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"f2000000-0000-0000-0000-00000000000d","role":"authenticated"}',true);
DO $$
DECLARE r jsonb; ok boolean := false;
BEGIN
  r := dv_call_start_for(NULL,'07700900126');
  PERFORM set_config('cc.c3', r->>'call_id', true);
  PERFORM dv_call_finish((r->>'call_id')::uuid, 'no_answer', NULL);
  BEGIN PERFORM dv_call_start_for('f1000000-3333-0000-0000-000000000001','07700900123'); EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL 14: dialler firm reached another firm''s client'; END IF;
END $$;
RESET ROLE;

DO $$ BEGIN
  IF (SELECT count(*) FROM core_events WHERE event_type='call.completed' AND dedupe_key = 'call:' || current_setting('cc.c3') AND (payload->>'has_client')::boolean = false) <> 1 THEN
    RAISE EXCEPTION 'FAIL 15: dialler call event missing or wrongly marked'; END IF;
  IF (SELECT count(*) FROM core_event_deliveries x JOIN core_events e ON e.id=x.event_id WHERE e.dedupe_key = 'call:' || current_setting('cc.c3') AND x.app_id='compliance') <> 1 THEN
    RAISE EXCEPTION 'FAIL 16: dialler call not delivered to compliance'; END IF;
END $$;

SELECT 'ALL TESTS PASSED' AS result;
ROLLBACK;
