/*
  Shared client record security test: firm isolation, restricted clients, who may change stage,
  allowed moves, approver rule, append-only history, case/client link guards.
  Run against the database (SQL editor or MCP execute_sql). One transaction, rolled back.
  Result: a single row 'ALL TESTS PASSED', or an error naming the first failing test.
*/
BEGIN;

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at) VALUES
  ('c1000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-000000000000','authenticated','authenticated','cc-adv-a@test.invalid','x',now(),now()),
  ('c1000000-0000-0000-0000-00000000000c','00000000-0000-0000-0000-000000000000','authenticated','authenticated','cc-adv-a2@test.invalid','x',now(),now()),
  ('c1000000-0000-0000-0000-00000000000d','00000000-0000-0000-0000-000000000000','authenticated','authenticated','cc-mgr-a@test.invalid','x',now(),now()),
  ('c1000000-0000-0000-0000-00000000000e','00000000-0000-0000-0000-000000000000','authenticated','authenticated','cc-mgr-a2@test.invalid','x',now(),now()),
  ('c2000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-000000000000','authenticated','authenticated','cc-adv-b@test.invalid','x',now(),now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO organizations (id, name, slug, owner_id) VALUES
  ('c1000000-1111-0000-0000-000000000001','CC Firm A','cc-firm-a','c1000000-0000-0000-0000-00000000000d'),
  ('c2000000-1111-0000-0000-000000000002','CC Firm B','cc-firm-b','c2000000-0000-0000-0000-00000000000b');
SELECT seed_debtverge_roles('c1000000-1111-0000-0000-000000000001');
SELECT seed_debtverge_roles('c2000000-1111-0000-0000-000000000002');
INSERT INTO dv_org_products (organization_id, product_key) VALUES
  ('c1000000-1111-0000-0000-000000000001','dmp_advisor'),
  ('c2000000-1111-0000-0000-000000000002','dmp_advisor'),
  ('c1000000-1111-0000-0000-000000000001','qualifyverge');
INSERT INTO rbac_role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM rbac_roles r JOIN rbac_permissions p ON p.module = 'QUALIFY' AND p.action IN ('view','edit')
 WHERE r.organization_id = 'c1000000-1111-0000-0000-000000000001' AND r.name = 'Advisor';
INSERT INTO organization_users (organization_id, user_id, role_id)
SELECT 'c1000000-1111-0000-0000-000000000001', u.id, r.id FROM (VALUES
  ('c1000000-0000-0000-0000-00000000000a'::uuid,'Advisor'),('c1000000-0000-0000-0000-00000000000c'::uuid,'Advisor'),('c1000000-0000-0000-0000-00000000000d'::uuid,'Team Manager'),('c1000000-0000-0000-0000-00000000000e'::uuid,'Operations Manager')) u(id,rn)
JOIN rbac_roles r ON r.organization_id = 'c1000000-1111-0000-0000-000000000001' AND r.name = u.rn;
INSERT INTO organization_users (organization_id, user_id, role_id)
SELECT 'c2000000-1111-0000-0000-000000000002','c2000000-0000-0000-0000-00000000000b', r.id FROM rbac_roles r WHERE r.organization_id='c2000000-1111-0000-0000-000000000002' AND r.name='Advisor';

-- cases: opening a case creates its client automatically
INSERT INTO debt_cases (id, user_id, organization_id, assigned_to, case_number, debtor_name, debtor_reference, is_restricted) VALUES
  ('c1000000-2222-0000-0000-000000000001','c1000000-0000-0000-0000-00000000000a','c1000000-1111-0000-0000-000000000001','c1000000-0000-0000-0000-00000000000a','CC-A1','CC Client A1','REF-A1',false),
  ('c1000000-2222-0000-0000-000000000002','c1000000-0000-0000-0000-00000000000a','c1000000-1111-0000-0000-000000000001','c1000000-0000-0000-0000-00000000000a','CC-A2','CC Client A2 restricted',NULL,true),
  ('c2000000-2222-0000-0000-000000000001','c2000000-0000-0000-0000-00000000000b','c2000000-1111-0000-0000-000000000002','c2000000-0000-0000-0000-00000000000b','CC-B1','CC Client B1',NULL,false);

SELECT set_config('cc.a1client', (SELECT client_id::text FROM debt_cases WHERE case_number='CC-A1'), true),
       set_config('cc.a2client', (SELECT client_id::text FROM debt_cases WHERE case_number='CC-A2'), true),
       set_config('cc.b1client', (SELECT client_id::text FROM debt_cases WHERE case_number='CC-B1'), true);

DO $$
DECLARE n int; r record;
BEGIN
  SELECT count(*) INTO n FROM debt_cases WHERE case_number LIKE 'CC-%' AND client_id IS NOT NULL;
  IF n <> 3 THEN RAISE EXCEPTION 'FAIL 1: every new case should get a client, got %', n; END IF;
  FOR r IN SELECT c.case_number, k.organization_id AS ko, c.organization_id AS co, k.current_stage, k.display_name, c.debtor_name,
                  (SELECT count(*) FROM core_client_stages h WHERE h.client_id = k.id) hist
             FROM debt_cases c JOIN core_clients k ON k.id = c.client_id WHERE c.case_number LIKE 'CC-%' LOOP
    IF r.ko <> r.co THEN RAISE EXCEPTION 'FAIL 2: client in a different firm to its case (%)', r.case_number; END IF;
    IF r.current_stage <> 'debtverge' OR r.hist <> 1 THEN RAISE EXCEPTION 'FAIL 3: new case client should be in debtverge with one history row (%)', r.case_number; END IF;
    IF r.display_name <> r.debtor_name THEN RAISE EXCEPTION 'FAIL 4: client name differs from case (%)', r.case_number; END IF;
  END LOOP;
END $$;

-- a case cannot be attached to another firm's client, and cannot be moved to another client
DO $$
DECLARE other uuid; ok boolean;
BEGIN
  SELECT client_id INTO other FROM debt_cases WHERE id = 'c2000000-2222-0000-0000-000000000001';
  ok := false;
  BEGIN
    INSERT INTO debt_cases (user_id, organization_id, case_number, debtor_name, client_id)
    VALUES ('c1000000-0000-0000-0000-00000000000a','c1000000-1111-0000-0000-000000000001','CC-X1','Cross firm', other);
  EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL 5: a case was attached to another firm''s client'; END IF;
  ok := false;
  BEGIN
    UPDATE debt_cases SET client_id = other WHERE id = 'c1000000-2222-0000-0000-000000000001';
  EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL 6: a case was moved to a different client'; END IF;
END $$;

-- name changes on the case follow to the client
UPDATE debt_cases SET debtor_name = 'CC Client A1 renamed' WHERE id = 'c1000000-2222-0000-0000-000000000001';
DO $$ BEGIN
  IF (SELECT k.display_name FROM core_clients k JOIN debt_cases c ON c.client_id = k.id WHERE c.id = 'c1000000-2222-0000-0000-000000000001') <> 'CC Client A1 renamed'
  THEN RAISE EXCEPTION 'FAIL 7: client name did not follow the case'; END IF;
END $$;

-- history can never be changed or deleted (even by the database owner)
DO $$
DECLARE ok boolean := false;
BEGIN
  BEGIN UPDATE core_client_stages SET reason = 'tampered' WHERE reason LIKE 'Case opened%'; EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL 8: stage history was changed'; END IF;
  ok := false;
  BEGIN DELETE FROM core_client_stages; EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL 9: stage history was deleted'; END IF;
  ok := false;
  BEGIN DELETE FROM core_clients; EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL 10: a client was deleted'; END IF;
END $$;

-- ===== not signed in =====
SET LOCAL ROLE anon;
DO $$
DECLARE ok boolean := false;
BEGIN
  BEGIN PERFORM core_client_list(); EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL 11: anon can call core_client_list'; END IF;
  ok := false;
  BEGIN PERFORM 1 FROM core_clients; EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL 12: anon can read core_clients'; END IF;
END $$;
RESET ROLE;

-- ===== signed in as adviser A (owns A1 and the restricted A2) =====
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"c1000000-0000-0000-0000-00000000000a","role":"authenticated"}',true);
DO $$
DECLARE a1 uuid; a2 uuid; b1 uuid; ok boolean; n int; g jsonb;
BEGIN
  -- the tables themselves are closed
  ok := false;
  BEGIN PERFORM 1 FROM core_clients; EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL 13: signed-in user can read core_clients directly'; END IF;
  ok := false;
  BEGIN INSERT INTO core_clients (organization_id, display_name) VALUES ('c1000000-1111-0000-0000-000000000001','x'); EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL 14: signed-in user can insert core_clients directly'; END IF;

  SELECT client_id INTO a1 FROM debt_cases WHERE id = 'c1000000-2222-0000-0000-000000000001';
  SELECT client_id INTO a2 FROM debt_cases WHERE id = 'c1000000-2222-0000-0000-000000000002';
  g := core_client_get(a1);
  IF g->'client'->>'current_stage' <> 'debtverge' OR (g->>'can_change')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'FAIL 15: adviser cannot read or change own client'; END IF;
  IF jsonb_array_length(g->'history') <> 1 THEN RAISE EXCEPTION 'FAIL 16: history should have one row'; END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(g->'next_stages') s WHERE s->>'to_stage' = 'qualify') THEN RAISE EXCEPTION 'FAIL 17: next stages should include qualify'; END IF;
  g := core_client_get(a2);  -- restricted but assigned to this adviser
  n := jsonb_array_length(core_client_list());
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL 18: adviser A should list 2 clients of firm A, got %', n; END IF;
  IF jsonb_array_length(core_client_list('qualify')) <> 0 THEN RAISE EXCEPTION 'FAIL 19: stage filter returned the wrong clients'; END IF;
  IF jsonb_array_length(core_client_list(NULL,'renamed')) <> 1 THEN RAISE EXCEPTION 'FAIL 20: search failed'; END IF;

  -- stage changes
  ok := false;
  BEGIN PERFORM core_client_change_stage(a1,'debtverge','qualify','short'); EXCEPTION WHEN invalid_parameter_value THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL 21: a change with no real reason was accepted'; END IF;
  ok := false;
  BEGIN PERFORM core_client_change_stage(a1,'debtverge','ivaverge','Trying to skip the stages'); EXCEPTION WHEN invalid_parameter_value THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL 22: a move that is not allowed was accepted'; END IF;
  ok := false;
  BEGIN PERFORM core_client_change_stage(a1,'lead','qualify','Wrong starting stage given'); EXCEPTION WHEN serialization_failure THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL 23: a stale stage was accepted'; END IF;
  ok := false;
  BEGIN PERFORM core_client_change_stage(a1,'debtverge','qualify','Re-assess, may need an IVA', 'c1000000-0000-0000-0000-00000000000d'); EXCEPTION WHEN invalid_parameter_value THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL 24: an approver was accepted on a change that takes none'; END IF;

  PERFORM core_client_change_stage(a1,'debtverge','qualify','Re-assess, may need an IVA');
  g := core_client_get(a1);
  IF g->'client'->>'current_stage' <> 'qualify' OR jsonb_array_length(g->'history') <> 2 THEN RAISE EXCEPTION 'FAIL 25: stage change not recorded'; END IF;
  IF g->'client'->>'assigned_to' IS NOT NULL THEN RAISE EXCEPTION 'FAIL 26: the owner should be cleared when a client changes stage'; END IF;
END $$;
RESET ROLE;

-- ===== adviser A2 (same firm, not the owner): cannot see the restricted client; can claim the unowned client in Qualify =====
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"c1000000-0000-0000-0000-00000000000c","role":"authenticated"}',true);
DO $$
DECLARE a1 uuid; ok boolean; g jsonb;
BEGIN
  a1 := current_setting('cc.a1client')::uuid;
  ok := false;
  BEGIN PERFORM core_client_get(current_setting('cc.a2client')::uuid); EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL 32: restricted client readable by another adviser'; END IF;
  IF jsonb_array_length(core_client_list()) <> 1 THEN RAISE EXCEPTION 'FAIL 33: adviser A2 should list only the unrestricted client'; END IF;
  g := core_client_get(a1);
  IF (g->>'can_change')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'FAIL 34: an unowned client should be workable by someone allowed to edit Qualify'; END IF;
  ok := false;
  BEGIN PERFORM core_client_assign(a1, 'c1000000-0000-0000-0000-00000000000a'); EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL 35: someone assigned a client to a colleague without being owner or manager'; END IF;
  PERFORM core_client_assign(a1, 'c1000000-0000-0000-0000-00000000000c');  -- claim
  g := core_client_get(a1);
  IF g->'client'->>'assigned_to' <> 'c1000000-0000-0000-0000-00000000000c' THEN RAISE EXCEPTION 'FAIL 36: claim did not take'; END IF;
END $$;
RESET ROLE;

-- ===== adviser A again: no longer owns the client, so cannot move or reassign it =====
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"c1000000-0000-0000-0000-00000000000a","role":"authenticated"}',true);
DO $$
DECLARE a1 uuid; ok boolean; g jsonb;
BEGIN
  a1 := current_setting('cc.a1client')::uuid;
  g := core_client_get(a1);
  IF (g->>'can_change')::boolean IS NOT FALSE OR jsonb_array_length(g->'next_stages') <> 0 THEN RAISE EXCEPTION 'FAIL 36b: a non-owner can change a client owned by someone else'; END IF;
  ok := false;
  BEGIN PERFORM core_client_change_stage(a1,'qualify','closed','Trying to close a colleague''s client'); EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL 36c: a non-owner moved the client'; END IF;
END $$;
RESET ROLE;

-- ===== manager A: sees the restricted client, can change any client, and reopens with a second manager =====
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"c1000000-0000-0000-0000-00000000000d","role":"authenticated"}',true);
DO $$
DECLARE a1 uuid; a2 uuid; g jsonb; ok boolean;
BEGIN
  a1 := current_setting('cc.a1client')::uuid;
  IF jsonb_array_length(core_client_list()) <> 2 THEN RAISE EXCEPTION 'FAIL 37: manager should list both clients of firm A'; END IF;
  a2 := current_setting('cc.a2client')::uuid;
  g := core_client_get(a2);
  IF (g->>'can_change')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'FAIL 38: manager cannot change a restricted client'; END IF;

  PERFORM core_client_change_stage(a1,'qualify','closed','Client withdrew from the process');
  ok := false;
  BEGIN PERFORM core_client_change_stage(a1,'closed','qualify','Client wants to restart'); EXCEPTION WHEN invalid_parameter_value THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL 26: reopen without approver was accepted'; END IF;
  ok := false;
  BEGIN PERFORM core_client_change_stage(a1,'closed','qualify','Client wants to restart','c1000000-0000-0000-0000-00000000000d'); EXCEPTION WHEN invalid_parameter_value THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL 27: self-approval was accepted'; END IF;
  ok := false;
  BEGIN PERFORM core_client_change_stage(a1,'closed','qualify','Client wants to restart','c1000000-0000-0000-0000-00000000000c'); EXCEPTION WHEN invalid_parameter_value THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL 28: a non-manager was accepted as approver'; END IF;
  ok := false;
  BEGIN PERFORM core_client_change_stage(a1,'closed','qualify','Client wants to restart','c2000000-0000-0000-0000-00000000000b'); EXCEPTION WHEN invalid_parameter_value THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL 29: another firm''s user was accepted as approver'; END IF;
  PERFORM core_client_change_stage(a1,'closed','qualify','Client wants to restart','c1000000-0000-0000-0000-00000000000e');
  g := core_client_get(a1);
  IF g->'client'->>'current_stage' <> 'qualify' OR jsonb_array_length(g->'history') <> 4 THEN RAISE EXCEPTION 'FAIL 30: reopen not recorded'; END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(g->'history') h WHERE h->>'approved_by' = 'c1000000-0000-0000-0000-00000000000e') THEN RAISE EXCEPTION 'FAIL 31: approver not recorded'; END IF;
END $$;
RESET ROLE;

-- ===== adviser B (other firm): sees and changes nothing of firm A =====
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"c2000000-0000-0000-0000-00000000000b","role":"authenticated"}',true);
DO $$
DECLARE ok boolean := false; n int;
BEGIN
  n := jsonb_array_length(core_client_list());
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL 39: firm B should list only its own client, got %', n; END IF;
  BEGIN PERFORM core_client_get(current_setting('cc.a1client')::uuid); EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL 40: firm B read firm A''s client'; END IF;
  ok := false;
  BEGIN PERFORM core_client_change_stage(current_setting('cc.a1client')::uuid,'qualify','closed','Firm B trying to close firm A client'); EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL 41: firm B changed firm A''s client'; END IF;
END $$;
RESET ROLE;

-- erasing a case blanks the client's name
UPDATE debt_cases SET erased_at = now() WHERE id = 'c2000000-2222-0000-0000-000000000001';
DO $$ BEGIN
  IF (SELECT k.display_name FROM core_clients k JOIN debt_cases c ON c.client_id = k.id WHERE c.id = 'c2000000-2222-0000-0000-000000000001') <> 'Erased'
  THEN RAISE EXCEPTION 'FAIL 42: erased case left the client name in place'; END IF;
END $$;

SELECT 'ALL TESTS PASSED' AS result;
ROLLBACK;
