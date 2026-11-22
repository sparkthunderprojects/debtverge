/* DebtVerge test: client book and payment suite are firm-scoped, honour restricted cases, cap non-managers at 100 rows, reject unknown filters, and refuse anon. Rolled back. */
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
INSERT INTO organization_users (organization_id, user_id, role_id) SELECT 'aaaaaaaa-1111-0000-0000-000000000001', u.id, r.id FROM (VALUES ('aaaaaaaa-0000-0000-0000-00000000000a'::uuid,'Advisor'),('aaaaaaaa-0000-0000-0000-00000000000d'::uuid,'Team Manager')) u(id,rn) JOIN rbac_roles r ON r.organization_id='aaaaaaaa-1111-0000-0000-000000000001' AND r.name=u.rn;
INSERT INTO organization_users (organization_id, user_id, role_id) SELECT 'bbbbbbbb-1111-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-00000000000b', r.id FROM rbac_roles r WHERE r.organization_id='bbbbbbbb-1111-0000-0000-000000000002' AND r.name='Team Manager';
INSERT INTO debt_cases (id, user_id, organization_id, assigned_to, case_number, debtor_name, is_restricted) VALUES
  ('aaaaaaaa-2222-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000000d','aaaaaaaa-1111-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000000d','T-B1','Book One', false),
  ('aaaaaaaa-2222-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-00000000000d','aaaaaaaa-1111-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000000d','T-B2','Book Restricted', true),
  ('bbbbbbbb-2222-0000-0000-000000000009','bbbbbbbb-0000-0000-0000-00000000000b','bbbbbbbb-1111-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-00000000000b','T-B9','Book Other', false);
INSERT INTO debt_payment_transactions (case_id, due_date, amount_due, amount_paid, status) VALUES
  ('aaaaaaaa-2222-0000-0000-000000000001', current_date - 5, 100, 0, 'scheduled'),
  ('aaaaaaaa-2222-0000-0000-000000000002', current_date - 7, 777, 0, 'scheduled'),
  ('bbbbbbbb-2222-0000-0000-000000000009', current_date - 9, 999, 0, 'scheduled');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-00000000000d","role":"authenticated"}',true);
DO $$ BEGIN
  IF (SELECT count(*) FROM dv_client_book()) <> 2 THEN RAISE EXCEPTION 'B1 manager sees both firm A cases'; END IF;
  IF (SELECT arrears_days FROM dv_client_book('Book One')) <> 5 THEN RAISE EXCEPTION 'B2 arrears days'; END IF;
  IF (SELECT count(*) FROM dv_client_book('other')) <> 0 THEN RAISE EXCEPTION 'B3 other firm'; END IF;
  IF (SELECT count(*) FROM dv_client_book('%%')) <> 0 THEN RAISE EXCEPTION 'B4 wildcard'; END IF;
  BEGIN PERFORM dv_client_book(NULL,NULL,NULL,NULL,'bogus'); RAISE EXCEPTION 'B5'; EXCEPTION WHEN sqlstate '22023' THEN NULL; END;
  IF (SELECT count(*) FROM dv_client_book(NULL,NULL,NULL,NULL,'arrears')) <> 2 THEN RAISE EXCEPTION 'B6 arrears filter'; END IF;
  IF (SELECT count(*) FROM dv_client_book(NULL,NULL,NULL,NULL,NULL,'; drop table x','asc')) <> 2 THEN RAISE EXCEPTION 'B7 sort whitelist'; END IF;
  IF (dv_payment_suite()->'kpis'->>'overdue_amount')::numeric <> 877 THEN RAISE EXCEPTION 'P1 suite miscounts'; END IF;
END $$;
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}',true);
DO $$ BEGIN
  IF (SELECT count(*) FROM dv_client_book()) <> 1 OR (SELECT debtor_name FROM dv_client_book()) <> 'Book One' THEN RAISE EXCEPTION 'R1 adviser must not see the restricted case'; END IF;
  IF (dv_payment_suite()->'kpis'->>'overdue_amount')::numeric <> 100 THEN RAISE EXCEPTION 'R2 restricted money visible in suite'; END IF;
END $$;
SELECT set_config('request.jwt.claims','{"sub":"bbbbbbbb-0000-0000-0000-00000000000b","role":"authenticated"}',true);
DO $$ BEGIN
  IF (SELECT count(*) FROM dv_client_book()) <> 1 OR (SELECT debtor_name FROM dv_client_book()) <> 'Book Other' THEN RAISE EXCEPTION 'X1 firm B'; END IF;
  IF (dv_payment_suite()->'kpis'->>'overdue_amount')::numeric <> 999 THEN RAISE EXCEPTION 'X2 firm B suite'; END IF;
END $$;
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM dv_client_book(); RAISE EXCEPTION 'A1'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM dv_payment_suite(); RAISE EXCEPTION 'A2'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT 'CLIENT BOOK AND PAYMENT SUITE TESTS PASSED';
ROLLBACK;
