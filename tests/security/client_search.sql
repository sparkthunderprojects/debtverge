/* DebtVerge test: client search finds by name/phone/email/DOB/address, never crosses firms, treats % and _ literally, refuses anon. Rolled back. */
BEGIN;
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at) VALUES
  ('aaaaaaaa-0000-0000-0000-00000000000d','00000000-0000-0000-0000-000000000000','authenticated','authenticated','t-mgr-a@test.invalid','x',now(),now()),
  ('bbbbbbbb-0000-0000-0000-00000000000b','00000000-0000-0000-0000-000000000000','authenticated','authenticated','t-mgr-b@test.invalid','x',now(),now());
INSERT INTO organizations (id, name, slug, owner_id) VALUES
  ('aaaaaaaa-1111-0000-0000-000000000001','Test Firm A','test-firm-a','aaaaaaaa-0000-0000-0000-00000000000d'),
  ('bbbbbbbb-1111-0000-0000-000000000002','Test Firm B','test-firm-b','bbbbbbbb-0000-0000-0000-00000000000b');
SELECT seed_debtverge_roles('aaaaaaaa-1111-0000-0000-000000000001');
SELECT seed_debtverge_roles('bbbbbbbb-1111-0000-0000-000000000002');
INSERT INTO organization_users (organization_id, user_id, role_id) SELECT 'aaaaaaaa-1111-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000000d', r.id FROM rbac_roles r WHERE r.organization_id='aaaaaaaa-1111-0000-0000-000000000001' AND r.name='Team Manager';
INSERT INTO organization_users (organization_id, user_id, role_id) SELECT 'bbbbbbbb-1111-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-00000000000b', r.id FROM rbac_roles r WHERE r.organization_id='bbbbbbbb-1111-0000-0000-000000000002' AND r.name='Team Manager';
INSERT INTO debt_cases (id, user_id, organization_id, assigned_to, case_number, debtor_name) VALUES
  ('aaaaaaaa-2222-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000000d','aaaaaaaa-1111-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000000d','T-S1','Zelda Testington'),
  ('bbbbbbbb-2222-0000-0000-000000000009','bbbbbbbb-0000-0000-0000-00000000000b','bbbbbbbb-1111-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-00000000000b','T-S9','Zelda Otherfirm');
INSERT INTO debt_customer_profiles (case_id, full_name, primary_email, mobile_phone, date_of_birth, address_street, address_city, address_postcode) VALUES
  ('aaaaaaaa-2222-0000-0000-000000000001','Zelda Testington','zelda@test.invalid','07700 900777','1990-02-03','1 Test Street','Testville','TE5 7AA'),
  ('bbbbbbbb-2222-0000-0000-000000000009','Zelda Otherfirm','zelda.b@test.invalid','07700 900778','1990-02-03','9 Other Street','Otherton','OT1 1AA');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-00000000000d","role":"authenticated"}',true);
DO $$ DECLARE q text; BEGIN
  FOREACH q IN ARRAY ARRAY['zelda','07700 900777','+447700900777','zelda@test','03/02/1990','1990-02-03','3.2.90','te57aa','Testville','t-s1'] LOOP
    IF (SELECT count(*) FROM dv_search_clients(q)) <> 1 OR (SELECT case_id FROM dv_search_clients(q)) <> 'aaaaaaaa-2222-0000-0000-000000000001' THEN RAISE EXCEPTION 'S1 % found %', q, (SELECT count(*) FROM dv_search_clients(q)); END IF;
  END LOOP;
  IF (SELECT count(*) FROM dv_search_clients('Otherfirm')) <> 0 THEN RAISE EXCEPTION 'S2 other firm visible'; END IF;
  IF (SELECT count(*) FROM dv_search_clients('900778')) <> 0 THEN RAISE EXCEPTION 'S3 other firm phone'; END IF;
  IF (SELECT count(*) FROM dv_search_clients('%%')) <> 0 OR (SELECT count(*) FROM dv_search_clients('__')) <> 0 THEN RAISE EXCEPTION 'S4 wildcard'; END IF;
  IF (SELECT count(*) FROM dv_search_clients('z')) <> 0 THEN RAISE EXCEPTION 'S5 too short'; END IF;
END $$;
SELECT set_config('request.jwt.claims','{"sub":"bbbbbbbb-0000-0000-0000-00000000000b","role":"authenticated"}',true);
DO $$ BEGIN
  IF (SELECT count(*) FROM dv_search_clients('zelda')) <> 1 OR (SELECT case_id FROM dv_search_clients('zelda')) <> 'bbbbbbbb-2222-0000-0000-000000000009' THEN RAISE EXCEPTION 'S6 firm B'; END IF;
END $$;
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM dv_search_clients('zelda'); RAISE EXCEPTION 'S7 anon'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT 'CLIENT SEARCH TESTS PASSED';
ROLLBACK;
