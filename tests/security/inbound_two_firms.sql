/* DebtVerge test: two firms, one customer phone. Inbound lands on the right firm's case; unmatched messages are triaged by their own firm only. Rolled back. */
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
  ('aaaaaaaa-2222-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000000a','aaaaaaaa-1111-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000000a','T-F1','Firm A case'),
  ('bbbbbbbb-2222-0000-0000-000000000009','bbbbbbbb-0000-0000-0000-00000000000b','bbbbbbbb-1111-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-00000000000b','T-B1','Firm B case');
INSERT INTO debt_customer_profiles (case_id, mobile_phone) VALUES
  ('aaaaaaaa-2222-0000-0000-000000000001','07700 900 555'),('bbbbbbbb-2222-0000-0000-000000000009','07700 900 555');
INSERT INTO org_phone_numbers (organization_id, e164) VALUES ('aaaaaaaa-1111-0000-0000-000000000001','+447700900111'),('bbbbbbbb-1111-0000-0000-000000000002','+447700900222');
DO $$ DECLARE r jsonb; BEGIN
  r := dv_record_inbound('sms','+447700900555','C','to A','SMx1','+447700900111');
  IF r->>'status' <> 'matched' THEN RAISE EXCEPTION 'X1 %', r; END IF;
  IF NOT EXISTS (SELECT 1 FROM debtverge_communications WHERE provider_id='SMx1' AND case_id='aaaaaaaa-2222-0000-0000-000000000001') THEN RAISE EXCEPTION 'X2 wrong case'; END IF;
  PERFORM dv_record_inbound('sms','+447700900555','C','to B','SMx2','+447700900222');
  IF NOT EXISTS (SELECT 1 FROM debtverge_communications WHERE provider_id='SMx2' AND case_id='bbbbbbbb-2222-0000-0000-000000000009') THEN RAISE EXCEPTION 'X3 wrong case'; END IF;
  PERFORM dv_record_inbound('sms','+440000000001','Stranger A','park A','SMx3','+447700900111');
  PERFORM dv_record_inbound('sms','+440000000002','Stranger B','park B','SMx4','+447700900222');
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-00000000000d","role":"authenticated"}',true);
DO $$ DECLARE n int; mid uuid; bmid uuid; BEGIN
  SELECT count(*) INTO n FROM dv_list_unassigned();
  IF n <> 1 THEN RAISE EXCEPTION 'Y1 saw %', n; END IF;
  SELECT id INTO mid FROM dv_list_unassigned();
  SELECT id INTO bmid FROM debtverge_unassigned_messages WHERE provider_id='SMx4';
  IF bmid IS NOT NULL THEN RAISE EXCEPTION 'Y2 direct read of other firm message'; END IF;
  RESET ROLE; SELECT id INTO bmid FROM debtverge_unassigned_messages WHERE provider_id='SMx4'; SET LOCAL ROLE authenticated;
  BEGIN PERFORM dv_assign_unassigned(bmid, 'aaaaaaaa-2222-0000-0000-000000000001'); RAISE EXCEPTION 'Y3'; EXCEPTION WHEN sqlstate '22023' THEN NULL; END;
  BEGIN PERFORM dv_assign_unassigned(mid, 'bbbbbbbb-2222-0000-0000-000000000009'); RAISE EXCEPTION 'Y4'; EXCEPTION WHEN sqlstate '22023' THEN NULL; END;
  BEGIN PERFORM dv_dismiss_unassigned(mid, 'x'); RAISE EXCEPTION 'Y5'; EXCEPTION WHEN sqlstate '22023' THEN NULL; END;
  PERFORM dv_assign_unassigned(mid, 'aaaaaaaa-2222-0000-0000-000000000001');
  IF NOT EXISTS (SELECT 1 FROM debtverge_communications WHERE case_id='aaaaaaaa-2222-0000-0000-000000000001' AND body='park A' AND direction='inbound' AND matched_automatically = false) THEN RAISE EXCEPTION 'Y6'; END IF;
  BEGIN PERFORM dv_assign_unassigned(mid, 'aaaaaaaa-2222-0000-0000-000000000001'); RAISE EXCEPTION 'Y7'; EXCEPTION WHEN sqlstate '22023' THEN NULL; END;
  PERFORM set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}',true);
  BEGIN PERFORM dv_list_unassigned(); RAISE EXCEPTION 'Y8'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-00000000000d","role":"authenticated"}',true);
  BEGIN PERFORM dv_add_org_number('+447700900333','x'); RAISE EXCEPTION 'Y9'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF (SELECT count(*) FROM dv_list_org_numbers()) <> 1 THEN RAISE EXCEPTION 'Y10'; END IF;
END $$;
SET LOCAL ROLE postgres;
SELECT set_config('request.jwt.claims','{"sub":"bbbbbbbb-0000-0000-0000-00000000000b","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  PERFORM dv_dismiss_unassigned((SELECT id FROM dv_list_unassigned() LIMIT 1), 'wrong number');
  IF (SELECT count(*) FROM dv_list_unassigned()) <> 0 THEN RAISE EXCEPTION 'Z1'; END IF;
END $$;
SELECT 'TWO FIRM TRIAGE TESTS PASSED';
ROLLBACK;
