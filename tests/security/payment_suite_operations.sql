/* DebtVerge test: payment suite operations - payout runs follow case access, reconciliation / client money / fees are manager-only and firm-scoped, anon refused. Rolled back. */

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
INSERT INTO disbursement_runs (id, organization_id, case_id, run_date, status, total_amount, total_items, created_by) VALUES
  ('aaaaaaaa-3333-0000-0000-000000000001','aaaaaaaa-1111-0000-0000-000000000001','aaaaaaaa-2222-0000-0000-000000000001',current_date,'draft',250,2,'aaaaaaaa-0000-0000-0000-00000000000d'),
  ('aaaaaaaa-3333-0000-0000-000000000002','aaaaaaaa-1111-0000-0000-000000000001','aaaaaaaa-2222-0000-0000-000000000002',current_date,'draft',500,3,'aaaaaaaa-0000-0000-0000-00000000000d'),
  ('bbbbbbbb-3333-0000-0000-000000000009','bbbbbbbb-1111-0000-0000-000000000002','bbbbbbbb-2222-0000-0000-000000000009',current_date,'draft',900,1,'bbbbbbbb-0000-0000-0000-00000000000b');
INSERT INTO bank_transactions (organization_id, transaction_date, amount, direction, reference, match_status) VALUES
  ('aaaaaaaa-1111-0000-0000-000000000001', current_date, 40, 'credit', 'A-UNM', 'unmatched'),
  ('bbbbbbbb-1111-0000-0000-000000000002', current_date, 60, 'credit', 'B-UNM', 'unmatched');
INSERT INTO cass_reconciliations (organization_id, recon_date, bank_balance, ledger_total) VALUES
  ('aaaaaaaa-1111-0000-0000-000000000001', current_date, 1000, 1000),
  ('bbbbbbbb-1111-0000-0000-000000000002', current_date, 5, 9);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-00000000000d","role":"authenticated"}',true);
DO $$ DECLARE r jsonb; BEGIN
  r := dv_payment_suite_ops();
  IF (r->'payouts'->>'awaiting_amount')::numeric <> 750 THEN RAISE EXCEPTION 'O1 manager sees both own-firm runs only, got %', r->'payouts'->>'awaiting_amount'; END IF;
  IF jsonb_array_length(r->'reconciliation'->'unmatched') <> 1 THEN RAISE EXCEPTION 'O2 other firm bank rows leaked'; END IF;
  IF (r->'client_money'->'last'->>'bank_balance')::numeric <> 1000 THEN RAISE EXCEPTION 'O3 wrong firm reconciliation'; END IF;
END $$;
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}',true);
DO $$ DECLARE r jsonb; BEGIN
  r := dv_payment_suite_ops();
  IF (r->'payouts'->>'awaiting_amount')::numeric <> 250 THEN RAISE EXCEPTION 'O4 adviser must see the open case payout but not the restricted one, got %', r->'payouts'->>'awaiting_amount'; END IF;
  IF r->'reconciliation' <> 'null'::jsonb OR r->'client_money' <> 'null'::jsonb OR r->'fees' <> 'null'::jsonb THEN RAISE EXCEPTION 'O5 non-manager must not see reconciliation, client money or fees'; END IF;
END $$;
SELECT set_config('request.jwt.claims','{"sub":"bbbbbbbb-0000-0000-0000-00000000000b","role":"authenticated"}',true);
DO $$ BEGIN
  IF (dv_payment_suite_ops()->'payouts'->>'awaiting_amount')::numeric <> 900 THEN RAISE EXCEPTION 'O6 firm B sees only its own run'; END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM dv_payment_suite_ops(); RAISE EXCEPTION 'O7 anon allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT 'payment_suite_operations: all checks passed' AS result;
ROLLBACK;
