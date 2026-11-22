/* DebtVerge test: automatic audit trail, immutable log, soft delete, voided rows ignored by money functions, one open run per case. Rolled back. */
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
INSERT INTO debt_creditors (id, case_id, creditor_name, current_balance) VALUES
  ('aaaaaaaa-3333-0000-0000-000000000001','aaaaaaaa-2222-0000-0000-000000000001','Creditor One',1000),
  ('aaaaaaaa-3333-0000-0000-000000000002','aaaaaaaa-2222-0000-0000-000000000001','Creditor Two',1000);
INSERT INTO debt_payments (id, case_id, amount, payment_date) VALUES
  ('aaaaaaaa-4444-0000-0000-000000000001','aaaaaaaa-2222-0000-0000-000000000001', 300, current_date),
  ('aaaaaaaa-4444-0000-0000-000000000002','aaaaaaaa-2222-0000-0000-000000000001', 100, current_date);

-- seeding as the owner wrote audit rows automatically, attributed to "system"
DO $$ BEGIN
  IF (SELECT count(*) FROM debt_audit_log WHERE case_id='aaaaaaaa-2222-0000-0000-000000000001' AND table_name='debt_payments' AND action='insert' AND actor='system') <> 2 THEN RAISE EXCEPTION 'FAIL A1: payment inserts not audited'; END IF;
  IF (SELECT count(*) FROM debt_audit_log WHERE table_name='debt_cases' AND action='insert' AND organization_id='aaaaaaaa-1111-0000-0000-000000000001') < 1 THEN RAISE EXCEPTION 'FAIL A1b: case insert not audited with firm'; END IF;
END $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated","email":"adv@test.invalid"}',true);
DO $$
DECLARE n int; a debt_audit_log;
BEGIN
  -- change recorded with old/new, the real user and email
  UPDATE debt_creditors SET current_balance = 900 WHERE id='aaaaaaaa-3333-0000-0000-000000000001';
  SELECT * INTO a FROM debt_audit_log WHERE record_id='aaaaaaaa-3333-0000-0000-000000000001' AND action='update';
  IF a.id IS NULL OR (a.old_value->>'current_balance')::numeric <> 1000 OR (a.new_value->>'current_balance')::numeric <> 900 THEN RAISE EXCEPTION 'FAIL A2: change not recorded with old/new'; END IF;
  IF a.user_id <> 'aaaaaaaa-0000-0000-0000-00000000000a' OR a.actor <> 'adv@test.invalid' OR a.organization_id <> 'aaaaaaaa-1111-0000-0000-000000000001' THEN RAISE EXCEPTION 'FAIL A3: wrong actor/user/firm'; END IF;
  -- a no-op update writes nothing
  SELECT count(*) INTO n FROM debt_audit_log WHERE record_id='aaaaaaaa-3333-0000-0000-000000000001';
  UPDATE debt_creditors SET current_balance = 900 WHERE id='aaaaaaaa-3333-0000-0000-000000000001';
  IF (SELECT count(*) FROM debt_audit_log WHERE record_id='aaaaaaaa-3333-0000-0000-000000000001') <> n THEN RAISE EXCEPTION 'FAIL A4: no-op update logged'; END IF;
  -- client cannot forge actor or back-date
  INSERT INTO debt_audit_log (case_id, milestone, actor, created_at) VALUES ('aaaaaaaa-2222-0000-0000-000000000001','Note','someone else','2000-01-01');
  SELECT * INTO a FROM debt_audit_log WHERE milestone='Note' AND case_id='aaaaaaaa-2222-0000-0000-000000000001';
  IF a.actor <> 'adv@test.invalid' OR a.created_at < now() - interval '1 minute' THEN RAISE EXCEPTION 'FAIL A5: actor or time forged'; END IF;
  -- cannot write an audit entry on another firm's case
  BEGIN INSERT INTO debt_audit_log (case_id, milestone) VALUES ('bbbbbbbb-2222-0000-0000-000000000009','x'); RAISE EXCEPTION 'FAIL A6: cross-firm audit insert';
  EXCEPTION WHEN insufficient_privilege OR foreign_key_violation THEN NULL; END;
  -- log cannot be changed, deleted or truncated by a signed-in user
  BEGIN UPDATE debt_audit_log SET milestone='x'; RAISE EXCEPTION 'FAIL A7: update allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN DELETE FROM debt_audit_log; RAISE EXCEPTION 'FAIL A8: delete allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN TRUNCATE debt_audit_log; RAISE EXCEPTION 'FAIL A9: truncate allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN TRUNCATE debt_payments; RAISE EXCEPTION 'FAIL A10: truncate payments allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  -- soft delete: app DELETE hides the row, nothing is removed
  DELETE FROM debt_payments WHERE id='aaaaaaaa-4444-0000-0000-000000000002';
  IF EXISTS (SELECT 1 FROM debt_payments WHERE id='aaaaaaaa-4444-0000-0000-000000000002') THEN RAISE EXCEPTION 'FAIL S1: voided payment still visible'; END IF;
  IF dv_case_funds_held('aaaaaaaa-2222-0000-0000-000000000001') <> 300 THEN RAISE EXCEPTION 'FAIL S2: voided payment still counted (%)', dv_case_funds_held('aaaaaaaa-2222-0000-0000-000000000001'); END IF;
  IF NOT EXISTS (SELECT 1 FROM debt_audit_log WHERE record_id='aaaaaaaa-4444-0000-0000-000000000002' AND action='void' AND user_id='aaaaaaaa-0000-0000-0000-00000000000a') THEN RAISE EXCEPTION 'FAIL S3: void not audited'; END IF;
  -- a client cannot void or restore by editing deleted_at
  BEGIN UPDATE debt_payments SET deleted_at = now() WHERE id='aaaaaaaa-4444-0000-0000-000000000001'; RAISE EXCEPTION 'FAIL S4: client set deleted_at';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  -- voided creditor is left out of a distribution
  DELETE FROM debt_creditors WHERE id='aaaaaaaa-3333-0000-0000-000000000002';
END $$;
RESET ROLE;
DO $$ BEGIN
  IF (SELECT deleted_at IS NULL FROM debt_payments WHERE id='aaaaaaaa-4444-0000-0000-000000000002') THEN RAISE EXCEPTION 'FAIL S5: row not kept as voided'; END IF;
  -- even the owner cannot hard delete a case
  DELETE FROM debt_cases WHERE id='aaaaaaaa-2222-0000-0000-000000000001';
  IF NOT EXISTS (SELECT 1 FROM debt_cases WHERE id='aaaaaaaa-2222-0000-0000-000000000001') THEN RAISE EXCEPTION 'FAIL S6: case hard deleted'; END IF;
  UPDATE debt_cases SET deleted_at = NULL, deleted_by = NULL WHERE id='aaaaaaaa-2222-0000-0000-000000000001';
  -- even the owner cannot edit the log
  BEGIN UPDATE debt_audit_log SET milestone = 'x'; RAISE EXCEPTION 'FAIL A11: owner edited log'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN DELETE FROM debt_audit_log; RAISE EXCEPTION 'FAIL A12: owner deleted log'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  -- one open distribution run per case
  INSERT INTO disbursement_runs (organization_id, case_id, run_date, status, output_format, total_amount, total_items) VALUES ('aaaaaaaa-1111-0000-0000-000000000001','aaaaaaaa-2222-0000-0000-000000000001',current_date,'draft','manual_instruction',10,0);
  BEGIN INSERT INTO disbursement_runs (organization_id, case_id, run_date, status, output_format, total_amount, total_items) VALUES ('aaaaaaaa-1111-0000-0000-000000000001','aaaaaaaa-2222-0000-0000-000000000001',current_date,'approved','manual_instruction',10,0); RAISE EXCEPTION 'FAIL L1: two open runs';
  EXCEPTION WHEN unique_violation THEN NULL; END;
END $$;

-- distribution ignores the voided creditor and respects voided payment
DO $$ BEGIN
  BEGIN DELETE FROM disbursement_runs WHERE case_id='aaaaaaaa-2222-0000-0000-000000000001'; RAISE EXCEPTION 'FAIL L2: run deleted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN DELETE FROM fee_charges; RAISE EXCEPTION 'FAIL L3: fee deleted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
UPDATE disbursement_runs SET status='failed' WHERE case_id='aaaaaaaa-2222-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated","email":"adv@test.invalid"}',true);
DO $$ DECLARE rid uuid; BEGIN
  rid := dv_create_distribution_run('aaaaaaaa-2222-0000-0000-000000000001');
  IF (SELECT count(*) FROM disbursement_run_items WHERE disbursement_run_id = rid) <> 1 THEN RAISE EXCEPTION 'FAIL S7: voided creditor included'; END IF;
  IF (SELECT total_amount FROM disbursement_runs WHERE id = rid) <> 300 THEN RAISE EXCEPTION 'FAIL S8: wrong total %', (SELECT total_amount FROM disbursement_runs WHERE id = rid); END IF;
END $$;

-- Firm B cannot see Firm A's audit trail
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"bbbbbbbb-0000-0000-0000-00000000000b","role":"authenticated"}',true);
DO $$ BEGIN
  IF (SELECT count(*) FROM debt_audit_log WHERE organization_id='aaaaaaaa-1111-0000-0000-000000000001') <> 0 THEN RAISE EXCEPTION 'FAIL I1: firm B reads firm A audit'; END IF;
END $$;
RESET ROLE;
SELECT 'AUDIT + SOFT DELETE TESTS PASSED' AS result;
ROLLBACK;
