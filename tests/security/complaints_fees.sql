/* DebtVerge test: complaints register + fee engine (roles, cap, one charge per payment, effect on distributable funds). Rolled back. */
BEGIN;
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at) VALUES
  ('aaaaaaaa-0000-0000-0000-00000000000a','00000000-0000-0000-0000-000000000000','authenticated','authenticated','t-adv-a@test.invalid','x',now(),now()),
  ('aaaaaaaa-0000-0000-0000-00000000000d','00000000-0000-0000-0000-000000000000','authenticated','authenticated','t-mgr-a@test.invalid','x',now(),now()),
  ('bbbbbbbb-0000-0000-0000-00000000000b','00000000-0000-0000-0000-000000000000','authenticated','authenticated','t-mgr-b@test.invalid','x',now(),now());
INSERT INTO organizations (id, name, slug, owner_id) VALUES
  ('aaaaaaaa-1111-0000-0000-000000000001','Test Firm A','test-firm-a','aaaaaaaa-0000-0000-0000-00000000000d'),
  ('bbbbbbbb-1111-0000-0000-000000000002','Test Firm B','test-firm-b','bbbbbbbb-0000-0000-0000-00000000000b');
SELECT seed_debtverge_roles('aaaaaaaa-1111-0000-0000-000000000001');
SELECT seed_debtverge_roles('bbbbbbbb-1111-0000-0000-000000000002');
INSERT INTO dv_org_products (organization_id, product_key) VALUES ('aaaaaaaa-1111-0000-0000-000000000001','dmp_advisor'),('bbbbbbbb-1111-0000-0000-000000000002','dmp_advisor');
INSERT INTO organization_users (organization_id, user_id, role_id)
SELECT 'aaaaaaaa-1111-0000-0000-000000000001', u.id, r.id FROM (VALUES
  ('aaaaaaaa-0000-0000-0000-00000000000a'::uuid,'Advisor'),('aaaaaaaa-0000-0000-0000-00000000000d'::uuid,'Team Manager')) u(id,rn)
JOIN rbac_roles r ON r.organization_id = 'aaaaaaaa-1111-0000-0000-000000000001' AND r.name = u.rn;
INSERT INTO organization_users (organization_id, user_id, role_id)
SELECT 'bbbbbbbb-1111-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-00000000000b', r.id FROM rbac_roles r WHERE r.organization_id='bbbbbbbb-1111-0000-0000-000000000002' AND r.name='Team Manager';
INSERT INTO debt_cases (id, user_id, organization_id, assigned_to, case_number, debtor_name) VALUES
  ('aaaaaaaa-2222-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000000a','aaaaaaaa-1111-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000000a','T-F1','Test F1');
INSERT INTO debt_creditors (case_id, creditor_name, current_balance) VALUES ('aaaaaaaa-2222-0000-0000-000000000001','Creditor One',1000);
INSERT INTO debt_payments (case_id, amount, payment_date) VALUES
  ('aaaaaaaa-2222-0000-0000-000000000001', 200, current_date),('aaaaaaaa-2222-0000-0000-000000000001', 100, current_date);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}',true);
DO $$
DECLARE cid uuid; ref text;
BEGIN
  cid := dv_log_complaint('aaaaaaaa-2222-0000-0000-000000000001','Test F1','Unhappy with fees','fees','phone',NULL,true);
  SELECT reference INTO ref FROM complaints WHERE id = cid;
  IF ref NOT LIKE 'C-%-0001' THEN RAISE EXCEPTION 'FAIL F1: reference %', ref; END IF;
  BEGIN PERFORM dv_complaint_update(cid,'acknowledged'); RAISE EXCEPTION 'FAIL F2: adviser updated complaint';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN INSERT INTO complaints (organization_id, reference, complainant, summary) VALUES ('aaaaaaaa-1111-0000-0000-000000000001','X','x','x'); RAISE EXCEPTION 'FAIL F3: direct insert allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM dv_save_fee_rule(NULL,'x','percent_of_receipt',10,NULL,NULL,true); RAISE EXCEPTION 'FAIL F4: adviser saved fee rule';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-00000000000d","role":"authenticated"}',true);
DO $$
DECLARE cid uuid; n int; d numeric; fid uuid; f2 uuid;
BEGIN
  SELECT id INTO cid FROM complaints LIMIT 1;
  BEGIN PERFORM dv_complaint_update(cid,'final_response'); RAISE EXCEPTION 'FAIL F5: final response without outcome';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;
  PERFORM dv_complaint_update(cid,'acknowledged',NULL,NULL,'ack sent');
  PERFORM dv_complaint_update(cid,'final_response','partially_upheld',25,'resolved');
  IF (SELECT count(*) FROM complaint_events WHERE complaint_id = cid) <> 3 THEN RAISE EXCEPTION 'FAIL F6: event trail should have 3 rows'; END IF;
  BEGIN PERFORM dv_save_fee_rule(NULL,'bad','percent_of_receipt',150,NULL,NULL,true); RAISE EXCEPTION 'FAIL F7: 150 percent fee accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  PERFORM dv_save_fee_rule(NULL,'10% capped at 25','percent_of_receipt',10,NULL,25,true);
  n := dv_post_fees('aaaaaaaa-2222-0000-0000-000000000001');
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL F8: expected 2 charges, got %', n; END IF;
  IF dv_post_fees('aaaaaaaa-2222-0000-0000-000000000001') <> 0 THEN RAISE EXCEPTION 'FAIL F9: fees charged twice'; END IF;
  IF (SELECT sum(amount) FROM fee_charges) <> 25 THEN RAISE EXCEPTION 'FAIL F10: monthly cap not applied'; END IF;
  d := dv_case_distributable('aaaaaaaa-2222-0000-0000-000000000001');
  IF d <> 275 THEN RAISE EXCEPTION 'FAIL F11: distributable should be 275, got %', d; END IF;
  SELECT id INTO fid FROM fee_charges WHERE amount = 20; SELECT id INTO f2 FROM fee_charges WHERE amount = 5;
  PERFORM dv_decide_fee(fid, true);
  IF dv_case_funds_held('aaaaaaaa-2222-0000-0000-000000000001') <> 280 THEN RAISE EXCEPTION 'FAIL F12: held after taking fee should be 280'; END IF;
  PERFORM dv_decide_fee(f2, false);
  IF dv_case_distributable('aaaaaaaa-2222-0000-0000-000000000001') <> 280 THEN RAISE EXCEPTION 'FAIL F13: distributable after waive should be 280'; END IF;
  BEGIN PERFORM dv_decide_fee(fid, false); RAISE EXCEPTION 'FAIL F14: decided fee changed';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;
  IF (SELECT held FROM dv_cass_position() WHERE case_number = 'T-F1') <> 280 THEN RAISE EXCEPTION 'FAIL F15: client money position should be 280'; END IF;
END $$;

SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}',true);
DO $$
DECLARE rid uuid;
BEGIN
  BEGIN PERFORM dv_decide_fee((SELECT id FROM fee_charges LIMIT 1), true); RAISE EXCEPTION 'FAIL F16: adviser decided a fee';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  rid := dv_create_distribution_run('aaaaaaaa-2222-0000-0000-000000000001');
  IF (SELECT total_amount FROM disbursement_runs WHERE id = rid) <> 280 THEN RAISE EXCEPTION 'FAIL F17: run should pay out 280'; END IF;
END $$;

SELECT set_config('request.jwt.claims','{"sub":"bbbbbbbb-0000-0000-0000-00000000000b","role":"authenticated"}',true);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM complaints) OR EXISTS (SELECT 1 FROM fee_charges) OR EXISTS (SELECT 1 FROM fee_rules) THEN RAISE EXCEPTION 'FAIL F18: firm B sees firm A complaints or fees'; END IF;
END $$;
RESET ROLE;
SELECT 'COMPLAINTS AND FEES TESTS PASSED' AS result;
ROLLBACK;
