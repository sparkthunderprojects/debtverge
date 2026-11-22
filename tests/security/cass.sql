/* DebtVerge test: client money position, 5 business day breach, hold reasons, reconciliation, manager-only. Rolled back. */
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
  ('aaaaaaaa-2222-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000000a','aaaaaaaa-1111-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000000a','T-C1','Test C1');
-- 100 received 14 days ago, 50 received today
INSERT INTO debt_payments (case_id, amount, payment_date) VALUES
  ('aaaaaaaa-2222-0000-0000-000000000001', 100, current_date - 14),('aaaaaaaa-2222-0000-0000-000000000001', 50, current_date);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}',true);
DO $$ BEGIN
  BEGIN PERFORM * FROM dv_cass_position(); RAISE EXCEPTION 'FAIL C1: adviser can see client money position';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-00000000000d","role":"authenticated"}',true);
DO $$
DECLARE r record; diff numeric;
BEGIN
  SELECT * INTO r FROM dv_cass_position() WHERE case_number = 'T-C1';
  IF r.held <> 150 THEN RAISE EXCEPTION 'FAIL C2: held should be 150, got %', r.held; END IF;
  IF NOT r.breach THEN RAISE EXCEPTION 'FAIL C3: 14 day old money should breach'; END IF;
  PERFORM dv_cass_set_hold('aaaaaaaa-2222-0000-0000-000000000001','creditor_dispute','test', current_date + 7);
  SELECT * INTO r FROM dv_cass_position() WHERE case_number = 'T-C1';
  IF r.breach OR r.hold_reason <> 'creditor_dispute' THEN RAISE EXCEPTION 'FAIL C4: hold reason should clear the breach'; END IF;
  BEGIN PERFORM dv_cass_set_hold('aaaaaaaa-2222-0000-0000-000000000001','other','x', current_date + 90); RAISE EXCEPTION 'FAIL C5: 90 day review accepted';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;
  PERFORM dv_cass_release_hold('aaaaaaaa-2222-0000-0000-000000000001');
  SELECT * INTO r FROM dv_cass_position() WHERE case_number = 'T-C1';
  IF NOT r.breach THEN RAISE EXCEPTION 'FAIL C6: breach should return after release'; END IF;
  diff := dv_cass_reconcile(150, 'test');
  IF diff <> 0 THEN RAISE EXCEPTION 'FAIL C7: reconciliation difference should be 0, got %', diff; END IF;
  diff := dv_cass_reconcile(140, 'short');
  IF diff <> -10 THEN RAISE EXCEPTION 'FAIL C8: expected -10, got %', diff; END IF;
  BEGIN UPDATE cass_reconciliations SET bank_balance = 1; RAISE EXCEPTION 'FAIL C9: reconciliation edited';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

SELECT set_config('request.jwt.claims','{"sub":"bbbbbbbb-0000-0000-0000-00000000000b","role":"authenticated"}',true);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM dv_cass_position()) THEN RAISE EXCEPTION 'FAIL C10: firm B sees firm A money'; END IF;
END $$;

-- once the old 100 is paid out, only today's 50 remains and there is no breach
RESET ROLE;
INSERT INTO disbursement_runs (organization_id, case_id, run_date, status, output_format, total_amount, total_items)
VALUES ('aaaaaaaa-1111-0000-0000-000000000001','aaaaaaaa-2222-0000-0000-000000000001', current_date, 'settled','manual_instruction',100,1);
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-00000000000d","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM dv_cass_position() WHERE case_number = 'T-C1';
  IF r.held <> 50 OR r.breach OR r.oldest_receipt <> current_date THEN RAISE EXCEPTION 'FAIL C11: after payout expected 50 held from today, got % %', r.held, r.oldest_receipt; END IF;
END $$;
RESET ROLE;
SELECT 'CASS TESTS PASSED' AS result;
ROLLBACK;
