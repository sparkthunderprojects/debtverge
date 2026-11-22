/* DebtVerge test: creditor bulk update (manager only, firm isolation, preview is read-only, audited). Rolled back. */
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
  ('aaaaaaaa-2222-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000000a','aaaaaaaa-1111-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000000a','T-F1','Test F1'),
  ('bbbbbbbb-2222-0000-0000-000000000009','bbbbbbbb-0000-0000-0000-00000000000b','bbbbbbbb-1111-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-00000000000b','T-B1','Firm B case');
INSERT INTO debt_creditors (id, case_id, creditor_name, account_reference, current_balance) VALUES
  ('aaaaaaaa-3333-0000-0000-000000000001','aaaaaaaa-2222-0000-0000-000000000001','Alpha Bank','ACC-1',1000),
  ('aaaaaaaa-3333-0000-0000-000000000002','aaaaaaaa-2222-0000-0000-000000000001','Beta Card','ACC-2',500),
  ('bbbbbbbb-3333-0000-0000-000000000009','bbbbbbbb-2222-0000-0000-000000000009','Alpha Bank','ACC-1',7777);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-00000000000d","role":"authenticated"}',true);
DO $$
DECLARE p jsonb; a jsonb; bal numeric;
BEGIN
  p := dv_bulk_creditor_preview('[
    {"case_number":"T-F1","match":"ACC-1","balance":"850.50"},
    {"case_number":"T-F1","match":"beta card","offer":"200","rate":"12.5"},
    {"case_number":"T-F1","match":"ACC-1","balance":"1000"},
    {"case_number":"T-B1","match":"ACC-1","balance":"1"},
    {"case_number":"T-F1","match":"NOPE","balance":"1"},
    {"case_number":"T-F1","match":"ACC-1","balance":"abc"},
    {"case_number":"T-F1","match":"ACC-1","rate":"150"}]');
  IF (SELECT array_agg(x->>'status' ORDER BY (x->>'idx')::int) FROM jsonb_array_elements(p) x)
     <> ARRAY['will_update','will_update','unchanged','case_not_found','creditor_not_found','invalid','invalid'] THEN RAISE EXCEPTION 'B1 statuses wrong: %', p; END IF;
  IF p::text LIKE '%creditor_id%' THEN RAISE EXCEPTION 'B2 leaks ids'; END IF;
  SELECT current_balance INTO bal FROM debt_creditors WHERE id='aaaaaaaa-3333-0000-0000-000000000001';
  IF bal <> 1000 THEN RAISE EXCEPTION 'B3 preview changed data'; END IF;
  a := dv_bulk_creditor_apply('[{"case_number":"T-F1","match":"ACC-1","balance":"850.50"},{"case_number":"T-B1","match":"ACC-1","balance":"1"},{"case_number":"T-F1","match":"beta card","offer":"200","rate":"12.5"}]');
  IF (a->>'updated')::int <> 2 OR (a->>'skipped')::int <> 1 THEN RAISE EXCEPTION 'B4 counts wrong: %', a; END IF;
  SELECT current_balance INTO bal FROM debt_creditors WHERE id='aaaaaaaa-3333-0000-0000-000000000001';
  IF bal <> 850.50 THEN RAISE EXCEPTION 'B5 not applied'; END IF;
  IF (SELECT current_balance FROM debt_creditors WHERE id='bbbbbbbb-3333-0000-0000-000000000009') <> 7777 THEN RAISE EXCEPTION 'B6 CROSS-FIRM WRITE'; END IF;
  IF (SELECT settlement_offer FROM debt_creditors WHERE id='aaaaaaaa-3333-0000-0000-000000000002') <> 200 THEN RAISE EXCEPTION 'B7 offer not applied'; END IF;
END $$;
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}',true);
DO $$ BEGIN
  BEGIN PERFORM dv_bulk_creditor_preview('[{"case_number":"T-F1","match":"ACC-1","balance":"1"}]'); RAISE EXCEPTION 'B8 advisor allowed'; EXCEPTION WHEN sqlstate '42501' THEN NULL; END;
  BEGIN PERFORM dv_bulk_creditor_resolve('[]'); RAISE EXCEPTION 'B9 internal fn callable'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN
  IF (SELECT count(*) FROM debt_audit_log WHERE table_name='debt_creditors' AND action='update') < 2 THEN RAISE EXCEPTION 'B10 row audit missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM debt_audit_log WHERE action='bulk_update') THEN RAISE EXCEPTION 'B11 batch audit missing'; END IF;
END $$;
SELECT 'BULK CREDITOR TESTS PASSED';
ROLLBACK;
