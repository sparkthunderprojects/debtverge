/* DebtVerge test: firm-required MFA is enforced in the database (aal2 needed), cannot be self-lockout, and is firm-scoped. Rolled back. */
BEGIN;
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at) VALUES
  ('aaaaaaaa-0000-0000-0000-00000000000a','00000000-0000-0000-0000-000000000000','authenticated','authenticated','t-adv-a@test.invalid','x',now(),now()),
  ('aaaaaaaa-0000-0000-0000-00000000000d','00000000-0000-0000-0000-000000000000','authenticated','authenticated','t-ops-a@test.invalid','x',now(),now()),
  ('bbbbbbbb-0000-0000-0000-00000000000b','00000000-0000-0000-0000-000000000000','authenticated','authenticated','t-adv-b@test.invalid','x',now(),now());
INSERT INTO organizations (id, name, slug, owner_id) VALUES
  ('aaaaaaaa-1111-0000-0000-000000000001','Test Firm A','test-firm-a','aaaaaaaa-0000-0000-0000-00000000000d'),
  ('bbbbbbbb-1111-0000-0000-000000000002','Test Firm B','test-firm-b','bbbbbbbb-0000-0000-0000-00000000000b');
SELECT seed_debtverge_roles('aaaaaaaa-1111-0000-0000-000000000001');
SELECT seed_debtverge_roles('bbbbbbbb-1111-0000-0000-000000000002');
INSERT INTO dv_org_products (organization_id, product_key) VALUES ('aaaaaaaa-1111-0000-0000-000000000001','dmp_advisor'),('bbbbbbbb-1111-0000-0000-000000000002','dmp_advisor');
INSERT INTO organization_users (organization_id, user_id, role_id)
SELECT 'aaaaaaaa-1111-0000-0000-000000000001', u.id, r.id FROM (VALUES
  ('aaaaaaaa-0000-0000-0000-00000000000a'::uuid,'Advisor'),('aaaaaaaa-0000-0000-0000-00000000000d'::uuid,'Operations Manager')) u(id,rn)
JOIN rbac_roles r ON r.organization_id = 'aaaaaaaa-1111-0000-0000-000000000001' AND r.name = u.rn;
INSERT INTO organization_users (organization_id, user_id, role_id)
SELECT 'bbbbbbbb-1111-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-00000000000b', r.id FROM rbac_roles r WHERE r.organization_id='bbbbbbbb-1111-0000-0000-000000000002' AND r.name='Advisor';
INSERT INTO debt_cases (id, user_id, organization_id, assigned_to, case_number, debtor_name) VALUES
  ('aaaaaaaa-2222-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000000a','aaaaaaaa-1111-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000000a','T-F1','Firm A case'),
  ('bbbbbbbb-2222-0000-0000-000000000009','bbbbbbbb-0000-0000-0000-00000000000b','bbbbbbbb-1111-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-00000000000b','T-B1','Firm B case');

-- ops manager (admin level) passes MFA and turns the requirement on
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-00000000000d","role":"authenticated","aal":"aal1"}',true);
DO $$ BEGIN
  BEGIN PERFORM dv_set_require_mfa(true); RAISE EXCEPTION 'M1 enabled without own MFA'; EXCEPTION WHEN sqlstate '22023' THEN NULL; END;
  PERFORM set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-00000000000d","role":"authenticated","aal":"aal2"}',true);
  PERFORM dv_set_require_mfa(true);
  IF (dv_get_security()->>'require_mfa')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'M2 flag not set'; END IF;
  IF (SELECT count(*) FROM dv_mfa_status()) <> 2 THEN RAISE EXCEPTION 'M3 status list'; END IF;
END $$;
-- advisor on aal1 in firm A: case hidden, cannot edit, not a manager
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated","aal":"aal1"}',true);
DO $$ BEGIN
  IF (SELECT count(*) FROM debt_cases) <> 0 THEN RAISE EXCEPTION 'M4 aal1 user can read cases'; END IF;
  IF dv_can_read_case('aaaaaaaa-2222-0000-0000-000000000001') THEN RAISE EXCEPTION 'M5 can_read at aal1'; END IF;
  IF dv_can_edit_case('aaaaaaaa-2222-0000-0000-000000000001') THEN RAISE EXCEPTION 'M6 can_edit at aal1'; END IF;
END $$;
-- same advisor after the second step: normal access
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated","aal":"aal2"}',true);
DO $$ BEGIN
  IF (SELECT count(*) FROM debt_cases) <> 1 THEN RAISE EXCEPTION 'M7 aal2 user cannot read own case'; END IF;
END $$;
-- manager at aal1 loses manager powers too
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-00000000000d","role":"authenticated","aal":"aal1"}',true);
DO $$ BEGIN
  BEGIN PERFORM dv_mfa_status(); RAISE EXCEPTION 'M8 manager function at aal1'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM dv_set_require_mfa(false); RAISE EXCEPTION 'M9 turned off at aal1'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
-- advisor cannot change the setting even with aal2
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated","aal":"aal2"}',true);
DO $$ BEGIN
  BEGIN PERFORM dv_set_require_mfa(false); RAISE EXCEPTION 'M10 advisor changed setting'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
-- firm B is unaffected by firm A's requirement
SELECT set_config('request.jwt.claims','{"sub":"bbbbbbbb-0000-0000-0000-00000000000b","role":"authenticated","aal":"aal1"}',true);
DO $$ BEGIN
  IF (SELECT count(*) FROM debt_cases) <> 1 THEN RAISE EXCEPTION 'M11 firm B affected'; END IF;
  IF (dv_get_security()->>'require_mfa')::boolean THEN RAISE EXCEPTION 'M12 firm B flag'; END IF;
END $$;
-- clients cannot read or write the settings table; anon cannot call anything
DO $$ BEGIN
  BEGIN PERFORM 1 FROM dv_org_security LIMIT 1; RAISE EXCEPTION 'M13 table readable'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM dv_get_security(); RAISE EXCEPTION 'M14 anon'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM dv_set_require_mfa(true); RAISE EXCEPTION 'M15 anon'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT 'STAFF MFA TESTS PASSED';
ROLLBACK;
