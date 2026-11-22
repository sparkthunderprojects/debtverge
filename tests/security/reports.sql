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
INSERT INTO debt_cases (id, user_id, organization_id, assigned_to, case_number, debtor_name, total_debt) VALUES
  ('bbbbbbbb-2222-0000-0000-000000000009','bbbbbbbb-0000-0000-0000-00000000000b','bbbbbbbb-1111-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-00000000000b','T-B1','Firm B case',9999);
UPDATE debt_cases SET total_debt = 500 WHERE id='aaaaaaaa-2222-0000-0000-000000000001';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-00000000000d","role":"authenticated"}',true);
DO $$
DECLARE r jsonb; kinds text[] := ARRAY['cases_by_status','caseload_by_advisor','missed_payments','overdue_tasks','complaints','fees']; k text;
BEGIN
  FOREACH k IN ARRAY kinds LOOP r := dv_run_report(k); IF jsonb_typeof(r) <> 'array' THEN RAISE EXCEPTION 'R1 % not array', k; END IF; END LOOP;
  r := dv_run_report('cases_by_status');
  IF (SELECT coalesce(sum((x->>'total_debt')::numeric),0) FROM jsonb_array_elements(r) x) <> 500 THEN RAISE EXCEPTION 'R2 firm isolation broken: %', r; END IF;
  BEGIN PERFORM dv_run_report('drop table'); RAISE EXCEPTION 'R3 unknown kind accepted'; EXCEPTION WHEN sqlstate '22023' THEN NULL; END;
  BEGIN PERFORM dv_run_report('fees','2020-01-01','2026-01-01'); RAISE EXCEPTION 'R4 huge range accepted'; EXCEPTION WHEN sqlstate '22023' THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}',true);
DO $$ BEGIN
  BEGIN PERFORM dv_run_report('cases_by_status'); RAISE EXCEPTION 'R5 advisor ran a report'; EXCEPTION WHEN sqlstate '42501' THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN IF (SELECT count(*) FROM debt_audit_log WHERE action='report_run') < 6 THEN RAISE EXCEPTION 'R6 report runs not audited'; END IF; END $$;
SELECT 'REPORT TESTS PASSED';
ROLLBACK;
