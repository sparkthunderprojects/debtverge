/*
  DebtVerge security regression test: firm isolation, role boundaries, licences, restricted cases, append-only audit.
  Run against the database (SQL editor or MCP execute_sql). Everything happens inside one transaction that is rolled back.
  Result: a single row 'ALL TESTS PASSED', or an error naming the first failing test.
*/
BEGIN;

-- two firms; firm A has an advisor, a second advisor and a manager; firm B has an advisor
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at) VALUES
  ('aaaaaaaa-0000-0000-0000-00000000000a','00000000-0000-0000-0000-000000000000','authenticated','authenticated','t-adv-a@test.invalid','x',now(),now()),
  ('aaaaaaaa-0000-0000-0000-00000000000c','00000000-0000-0000-0000-000000000000','authenticated','authenticated','t-adv-a2@test.invalid','x',now(),now()),
  ('aaaaaaaa-0000-0000-0000-00000000000d','00000000-0000-0000-0000-000000000000','authenticated','authenticated','t-mgr-a@test.invalid','x',now(),now()),
  ('bbbbbbbb-0000-0000-0000-00000000000b','00000000-0000-0000-0000-000000000000','authenticated','authenticated','t-adv-b@test.invalid','x',now(),now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO organizations (id, name, slug, owner_id) VALUES
  ('aaaaaaaa-1111-0000-0000-000000000001','Test Firm A','test-firm-a','aaaaaaaa-0000-0000-0000-00000000000d'),
  ('bbbbbbbb-1111-0000-0000-000000000002','Test Firm B','test-firm-b','bbbbbbbb-0000-0000-0000-00000000000b');
SELECT seed_debtverge_roles('aaaaaaaa-1111-0000-0000-000000000001');
SELECT seed_debtverge_roles('bbbbbbbb-1111-0000-0000-000000000002');
INSERT INTO dv_org_products (organization_id, product_key) VALUES
  ('aaaaaaaa-1111-0000-0000-000000000001','dmp_advisor'),
  ('bbbbbbbb-1111-0000-0000-000000000002','dmp_advisor');

INSERT INTO organization_users (organization_id, user_id, role_id)
SELECT 'aaaaaaaa-1111-0000-0000-000000000001', u.id, r.id FROM (VALUES
  ('aaaaaaaa-0000-0000-0000-00000000000a'::uuid,'Advisor'),('aaaaaaaa-0000-0000-0000-00000000000c'::uuid,'Advisor'),('aaaaaaaa-0000-0000-0000-00000000000d'::uuid,'Team Manager')) u(id,rn)
JOIN rbac_roles r ON r.organization_id = 'aaaaaaaa-1111-0000-0000-000000000001' AND r.name = u.rn;
INSERT INTO organization_users (organization_id, user_id, role_id)
SELECT 'bbbbbbbb-1111-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-00000000000b', r.id FROM rbac_roles r WHERE r.organization_id='bbbbbbbb-1111-0000-0000-000000000002' AND r.name='Advisor';

-- cases: A1 (assigned to advisor A), A2 restricted (assigned to advisor A), B1 (firm B)
INSERT INTO debt_cases (id, user_id, organization_id, assigned_to, case_number, debtor_name, is_restricted) VALUES
  ('aaaaaaaa-2222-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000000a','aaaaaaaa-1111-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000000a','T-A1','Test A1',false),
  ('aaaaaaaa-2222-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-00000000000a','aaaaaaaa-1111-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000000a','T-A2','Test A2 restricted',true),
  ('bbbbbbbb-2222-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-00000000000b','bbbbbbbb-1111-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-00000000000b','T-B1','Test B1',false);
INSERT INTO debt_audit_log (case_id, milestone, description) VALUES ('aaaaaaaa-2222-0000-0000-000000000001','Test entry','audit row');
INSERT INTO case_tasks (case_id, title) VALUES ('aaaaaaaa-2222-0000-0000-000000000001','Test task');

-- ===== signed in as advisor A (firm A, assigned to A1 and A2) =====
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}',true);
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM debt_cases WHERE id = 'bbbbbbbb-2222-0000-0000-000000000001';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 1: firm A adviser can read firm B case'; END IF;
  SELECT count(*) INTO n FROM debt_cases WHERE case_number LIKE 'T-%';
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL 2: assigned adviser should see own 2 cases, saw %', n; END IF;
  UPDATE debt_cases SET notes = 'x' WHERE id = 'bbbbbbbb-2222-0000-0000-000000000001';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 3: firm A adviser updated firm B case'; END IF;
  DELETE FROM debt_cases WHERE id = 'bbbbbbbb-2222-0000-0000-000000000001';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 4: firm A adviser deleted firm B case'; END IF;
  UPDATE debt_cases SET notes = 'mine' WHERE id = 'aaaaaaaa-2222-0000-0000-000000000001';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL 5: adviser cannot update own assigned case'; END IF;
  DELETE FROM debt_cases WHERE id = 'aaaaaaaa-2222-0000-0000-000000000001';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 6: adviser (not manager) deleted a case'; END IF;
  BEGIN
    UPDATE debt_audit_log SET description = 'tampered' WHERE case_id = 'aaaaaaaa-2222-0000-0000-000000000001';
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN RAISE EXCEPTION 'FAIL 7: audit log row was edited'; END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    DELETE FROM debt_audit_log WHERE case_id = 'aaaaaaaa-2222-0000-0000-000000000001';
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN RAISE EXCEPTION 'FAIL 8: audit log row was deleted'; END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  SELECT count(*) INTO n FROM debt_audit_log WHERE case_id = 'aaaaaaaa-2222-0000-0000-000000000001';
  IF n < 1 THEN RAISE EXCEPTION 'FAIL 8b: audit log row missing'; END IF;
  SELECT count(*) INTO n FROM case_tasks WHERE case_id = 'bbbbbbbb-2222-0000-0000-000000000001';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 9: firm A adviser can read firm B tasks'; END IF;
  BEGIN
    PERFORM set_case_restricted('aaaaaaaa-2222-0000-0000-000000000001', true);
    RAISE EXCEPTION 'FAIL 10: adviser could restrict a case';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF;
  END;
END $$;

-- ===== signed in as the OTHER advisor in firm A (not assigned) =====
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-00000000000c","role":"authenticated"}',true);
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM debt_cases WHERE id = 'aaaaaaaa-2222-0000-0000-000000000001';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL 11: adviser cannot search/read another adviser''s normal case'; END IF;
  SELECT count(*) INTO n FROM debt_cases WHERE id = 'aaaaaaaa-2222-0000-0000-000000000002';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 12: restricted case visible to unrelated adviser'; END IF;
  SELECT count(*) INTO n FROM case_tasks WHERE case_id = 'aaaaaaaa-2222-0000-0000-000000000002';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 13: restricted case tasks visible'; END IF;
  UPDATE debt_cases SET notes = 'hijack' WHERE id = 'aaaaaaaa-2222-0000-0000-000000000001';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 14: unassigned adviser edited a case'; END IF;
  BEGIN
    INSERT INTO case_tasks (case_id, title) VALUES ('aaaaaaaa-2222-0000-0000-000000000001','should be refused');
    RAISE EXCEPTION 'FAIL 15: unassigned adviser added a task to another adviser''s case';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

-- ===== signed in as the firm A manager =====
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-00000000000d","role":"authenticated"}',true);
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM debt_cases WHERE case_number LIKE 'T-%';
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL 16: manager should see both firm A cases (incl. restricted) and none of firm B, saw %', n; END IF;
  UPDATE debt_cases SET notes = 'manager edit' WHERE id = 'aaaaaaaa-2222-0000-0000-000000000001';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL 17: manager cannot edit a firm A case'; END IF;
  PERFORM set_case_restricted('aaaaaaaa-2222-0000-0000-000000000001', true);
  PERFORM log_case_view('aaaaaaaa-2222-0000-0000-000000000002');
  SELECT count(*) INTO n FROM case_access_log WHERE case_id = 'aaaaaaaa-2222-0000-0000-000000000002';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL 18: case view was not logged'; END IF;
  BEGIN
    UPDATE case_access_log SET action = 'edited';
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN RAISE EXCEPTION 'FAIL 19: access log was edited'; END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

-- ===== firm B: own case visible; withdrawing its licence hides everything =====
RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"bbbbbbbb-0000-0000-0000-00000000000b","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM debt_cases WHERE case_number LIKE 'T-%';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL 20: firm B adviser should see exactly its own case, saw %', n; END IF;
END $$;
RESET ROLE;
UPDATE dv_org_products SET enabled = false WHERE organization_id = 'bbbbbbbb-1111-0000-0000-000000000002';
SET LOCAL ROLE authenticated;
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM debt_cases WHERE case_number LIKE 'T-%';
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 21: unlicensed firm can still read cases'; END IF;
END $$;

-- ===== signed out =====
RESET ROLE;
DO $$
BEGIN
  IF has_function_privilege('anon','assign_case(uuid,uuid)','execute') THEN RAISE EXCEPTION 'FAIL 22: anon can run assign_case'; END IF;
  IF has_function_privilege('anon','set_case_restricted(uuid,boolean)','execute') THEN RAISE EXCEPTION 'FAIL 23: anon can run set_case_restricted'; END IF;
  IF has_function_privilege('anon','list_org_members()','execute') THEN RAISE EXCEPTION 'FAIL 24: anon can list members'; END IF;
  IF NOT has_function_privilege('anon','get_payment_link(text)','execute') THEN RAISE EXCEPTION 'FAIL 25: public payment link function not callable'; END IF;
END $$;

SELECT 'ALL TESTS PASSED' AS result;
ROLLBACK;
