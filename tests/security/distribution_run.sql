/* DebtVerge test: creditor distribution run (pro-rata maths, maker-checker, firm isolation). Rolled back; returns 'DISTRIBUTION TESTS PASSED'. */
BEGIN;
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at) VALUES
  ('aaaaaaaa-0000-0000-0000-00000000000a','00000000-0000-0000-0000-000000000000','authenticated','authenticated','t-adv-a@test.invalid','x',now(),now()),
  ('aaaaaaaa-0000-0000-0000-00000000000d','00000000-0000-0000-0000-000000000000','authenticated','authenticated','t-mgr-a@test.invalid','x',now(),now()),
  ('aaaaaaaa-0000-0000-0000-00000000000e','00000000-0000-0000-0000-000000000000','authenticated','authenticated','t-mgr-a2@test.invalid','x',now(),now()),
  ('bbbbbbbb-0000-0000-0000-00000000000b','00000000-0000-0000-0000-000000000000','authenticated','authenticated','t-mgr-b@test.invalid','x',now(),now());
INSERT INTO organizations (id, name, slug, owner_id) VALUES
  ('aaaaaaaa-1111-0000-0000-000000000001','Test Firm A','test-firm-a','aaaaaaaa-0000-0000-0000-00000000000d'),
  ('bbbbbbbb-1111-0000-0000-000000000002','Test Firm B','test-firm-b','bbbbbbbb-0000-0000-0000-00000000000b');
SELECT seed_debtverge_roles('aaaaaaaa-1111-0000-0000-000000000001');
SELECT seed_debtverge_roles('bbbbbbbb-1111-0000-0000-000000000002');
INSERT INTO dv_org_products (organization_id, product_key) VALUES ('aaaaaaaa-1111-0000-0000-000000000001','dmp_advisor'),('bbbbbbbb-1111-0000-0000-000000000002','dmp_advisor');
INSERT INTO organization_users (organization_id, user_id, role_id)
SELECT 'aaaaaaaa-1111-0000-0000-000000000001', u.id, r.id FROM (VALUES
  ('aaaaaaaa-0000-0000-0000-00000000000a'::uuid,'Advisor'),('aaaaaaaa-0000-0000-0000-00000000000d'::uuid,'Team Manager'),('aaaaaaaa-0000-0000-0000-00000000000e'::uuid,'Team Manager')) u(id,rn)
JOIN rbac_roles r ON r.organization_id = 'aaaaaaaa-1111-0000-0000-000000000001' AND r.name = u.rn;
INSERT INTO organization_users (organization_id, user_id, role_id)
SELECT 'bbbbbbbb-1111-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-00000000000b', r.id FROM rbac_roles r WHERE r.organization_id='bbbbbbbb-1111-0000-0000-000000000002' AND r.name='Team Manager';
INSERT INTO debt_cases (id, user_id, organization_id, assigned_to, case_number, debtor_name) VALUES
  ('aaaaaaaa-2222-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000000a','aaaaaaaa-1111-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000000a','T-D1','Test D1');
INSERT INTO debt_creditors (case_id, creditor_name, current_balance) VALUES
  ('aaaaaaaa-2222-0000-0000-000000000001','Creditor One',3000),('aaaaaaaa-2222-0000-0000-000000000001','Creditor Two',1000),('aaaaaaaa-2222-0000-0000-000000000001','Creditor Three',1000);
INSERT INTO debt_payments (case_id, amount, payment_date) VALUES ('aaaaaaaa-2222-0000-0000-000000000001', 100.01, current_date);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}',true);
DO $$
DECLARE rid uuid; s numeric; n int;
BEGIN
  IF dv_case_funds_held('aaaaaaaa-2222-0000-0000-000000000001') <> 100.01 THEN RAISE EXCEPTION 'FAIL D1: funds held wrong'; END IF;
  rid := dv_create_distribution_run('aaaaaaaa-2222-0000-0000-000000000001');
  SELECT sum(amount), count(*) INTO s, n FROM disbursement_run_items WHERE disbursement_run_id = rid;
  IF s <> 100.01 OR n <> 3 THEN RAISE EXCEPTION 'FAIL D2: items must add up to exactly 100.01 across 3 creditors, got % across %', s, n; END IF;
  IF (SELECT amount FROM disbursement_run_items WHERE disbursement_run_id = rid AND payee_name = 'Creditor One') < 59.9 THEN RAISE EXCEPTION 'FAIL D3: largest creditor should get about 60%%'; END IF;
  BEGIN PERFORM dv_create_distribution_run('aaaaaaaa-2222-0000-0000-000000000001'); RAISE EXCEPTION 'FAIL D4: second open run allowed';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;
  BEGIN PERFORM dv_approve_distribution_run(rid); RAISE EXCEPTION 'FAIL D5: adviser approved a run';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN UPDATE disbursement_run_items SET amount = 99999 WHERE disbursement_run_id = rid; GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN RAISE EXCEPTION 'FAIL D6: run items edited directly'; END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

SELECT set_config('request.jwt.claims','{"sub":"bbbbbbbb-0000-0000-0000-00000000000b","role":"authenticated"}',true);
DO $$
DECLARE rid uuid;
BEGIN
  SELECT id INTO rid FROM disbursement_runs WHERE case_id = 'aaaaaaaa-2222-0000-0000-000000000001';
  IF rid IS NOT NULL THEN RAISE EXCEPTION 'FAIL D7: firm B can see firm A run'; END IF;
END $$;

RESET ROLE;
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-00000000000d","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE rid uuid; st text;
BEGIN
  SELECT id INTO rid FROM disbursement_runs WHERE case_id = 'aaaaaaaa-2222-0000-0000-000000000001';
  PERFORM dv_approve_distribution_run(rid);
  SELECT status INTO st FROM disbursement_runs WHERE id = rid;
  IF st <> 'approved' THEN RAISE EXCEPTION 'FAIL D8: manager could not approve (status %)', st; END IF;
  PERFORM dv_mark_distribution_paid(rid);
  IF dv_case_funds_held('aaaaaaaa-2222-0000-0000-000000000001') <> 0 THEN RAISE EXCEPTION 'FAIL D9: funds should be 0 after payout'; END IF;
END $$;

RESET ROLE;
INSERT INTO debt_cases (id, user_id, organization_id, assigned_to, case_number, debtor_name) VALUES
  ('aaaaaaaa-2222-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-00000000000d','aaaaaaaa-1111-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000000d','T-D2','Test D2');
INSERT INTO debt_creditors (case_id, creditor_name, current_balance) VALUES ('aaaaaaaa-2222-0000-0000-000000000002','Creditor X',500);
INSERT INTO debt_payments (case_id, amount, payment_date) VALUES ('aaaaaaaa-2222-0000-0000-000000000002', 50, current_date);
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-00000000000d","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE rid uuid;
BEGIN
  rid := dv_create_distribution_run('aaaaaaaa-2222-0000-0000-000000000002');
  BEGIN PERFORM dv_approve_distribution_run(rid); RAISE EXCEPTION 'FAIL D10: manager approved own run';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-00000000000e","role":"authenticated"}',true);
DO $$
DECLARE rid uuid;
BEGIN
  SELECT id INTO rid FROM disbursement_runs WHERE case_id = 'aaaaaaaa-2222-0000-0000-000000000002';
  PERFORM dv_approve_distribution_run(rid);
END $$;
RESET ROLE;
SELECT 'DISTRIBUTION TESTS PASSED' AS result;
ROLLBACK;
