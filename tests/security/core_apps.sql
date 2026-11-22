-- core_apps security test (A4: licences and roles per app)
-- Paste into the Supabase SQL editor / execute_sql. Runs in a transaction and rolls back.
-- Ends with 'ALL TESTS PASSED' or raises a named FAIL.
BEGIN;

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at) VALUES
  ('d1000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ca-qual@test.invalid','x',now(),now()),
  ('d1000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ca-mgr@test.invalid','x',now(),now()),
  ('d1000000-0000-0000-0000-00000000000c','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ca-lead@test.invalid','x',now(),now()),
  ('d1000000-0000-0000-0000-00000000000d','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ca-noorg@test.invalid','x',now(),now()),
  ('d1000000-0000-0000-0000-00000000000f','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ca-adv@test.invalid','x',now(),now()),
  ('d2000000-0000-0000-0000-00000000000e','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ca-adv-b@test.invalid','x',now(),now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO organizations (id, name, slug, owner_id) VALUES
  ('d1000000-1111-0000-0000-000000000001','CA Firm A','ca-firm-a','d1000000-0000-0000-0000-00000000000b'),
  ('d2000000-1111-0000-0000-000000000002','CA Firm B','ca-firm-b','d2000000-0000-0000-0000-00000000000e');
SELECT seed_debtverge_roles('d1000000-1111-0000-0000-000000000001');
SELECT seed_debtverge_roles('d2000000-1111-0000-0000-000000000002');

-- Firm A: DebtVerge + QualifyVerge licensed. Firm B: DebtVerge only.
INSERT INTO dv_org_products (organization_id, product_key) VALUES
  ('d1000000-1111-0000-0000-000000000001','dmp_advisor'),
  ('d1000000-1111-0000-0000-000000000001','qualifyverge'),
  ('d2000000-1111-0000-0000-000000000002','dmp_advisor');

INSERT INTO organization_users (organization_id, user_id, role_id)
SELECT 'd1000000-1111-0000-0000-000000000001', u.id, r.id FROM (VALUES
  ('d1000000-0000-0000-0000-00000000000a'::uuid,'Qualifier'),
  ('d1000000-0000-0000-0000-00000000000b'::uuid,'Team Manager'),
  ('d1000000-0000-0000-0000-00000000000c'::uuid,'Lead Handler'),
  ('d1000000-0000-0000-0000-00000000000f'::uuid,'Advisor')) u(id,rn)
JOIN rbac_roles r ON r.organization_id = 'd1000000-1111-0000-0000-000000000001' AND r.name = u.rn;
INSERT INTO organization_users (organization_id, user_id, role_id)
SELECT 'd2000000-1111-0000-0000-000000000002','d2000000-0000-0000-0000-00000000000e', r.id
  FROM rbac_roles r WHERE r.organization_id='d2000000-1111-0000-0000-000000000002' AND r.name='Advisor';

INSERT INTO debt_cases (id, user_id, organization_id, assigned_to, case_number, debtor_name, is_restricted) VALUES
  ('d1000000-2222-0000-0000-000000000001','d1000000-0000-0000-0000-00000000000f','d1000000-1111-0000-0000-000000000001','d1000000-0000-0000-0000-00000000000f','CA-A1','CA Client A1',false),
  ('d1000000-2222-0000-0000-000000000002','d1000000-0000-0000-0000-00000000000f','d1000000-1111-0000-0000-000000000001','d1000000-0000-0000-0000-00000000000f','CA-A2','CA Client A2',false),
  ('d2000000-2222-0000-0000-000000000001','d2000000-0000-0000-0000-00000000000e','d2000000-1111-0000-0000-000000000002','d2000000-0000-0000-0000-00000000000e','CA-B1','CA Client B1',false);

SELECT set_config('ca.a1', (SELECT client_id::text FROM debt_cases WHERE case_number='CA-A1'), true),
       set_config('ca.a2', (SELECT client_id::text FROM debt_cases WHERE case_number='CA-A2'), true),
       set_config('ca.b1', (SELECT client_id::text FROM debt_cases WHERE case_number='CA-B1'), true);

-- Reference data
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM core_apps;
  IF n <> 7 THEN RAISE EXCEPTION 'FAIL 1: expected 7 apps, got %', n; END IF;
  IF EXISTS (SELECT 1 FROM core_apps WHERE product_key NOT IN (SELECT product_key FROM dv_products)) THEN
    RAISE EXCEPTION 'FAIL 2: an app points at a product that does not exist'; END IF;
  IF (SELECT count(*) FROM dv_org_products WHERE product_key IN ('leadverge','draftverge','ivaverge')
        AND organization_id IN ('d1000000-1111-0000-0000-000000000001','d2000000-1111-0000-0000-000000000002')) <> 0
  THEN RAISE EXCEPTION 'FAIL 3: new apps were licensed to a firm without being asked'; END IF;
END $$;

-- anon is shut out
SET LOCAL ROLE anon;
DO $$
DECLARE ok boolean := false;
BEGIN
  BEGIN PERFORM core_my_apps(); EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL 4: anon can call core_my_apps'; END IF;
  ok := false;
  BEGIN PERFORM 1 FROM core_apps; EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL 5: anon can read core_apps'; END IF;
END $$;
RESET ROLE;

-- Qualifier: sees Qualify only, and only the qualify stage
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"d1000000-0000-0000-0000-00000000000a","role":"authenticated"}',true);
DO $$
DECLARE g jsonb; ids text[];
BEGIN
  g := core_my_apps();
  IF (g->>'organization_id')::uuid <> 'd1000000-1111-0000-0000-000000000001' THEN RAISE EXCEPTION 'FAIL 6: wrong organisation'; END IF;
  SELECT array_agg(a->>'app_id' ORDER BY a->>'app_id') INTO ids FROM jsonb_array_elements(g->'apps') a;
  IF ids IS DISTINCT FROM ARRAY['qualifyverge'] THEN RAISE EXCEPTION 'FAIL 7: qualifier should see only qualifyverge, got %', ids; END IF;
  IF NOT (SELECT (a->>'can_edit')::boolean FROM jsonb_array_elements(g->'apps') a WHERE a->>'app_id'='qualifyverge') THEN
    RAISE EXCEPTION 'FAIL 8: qualifier should be able to edit qualify'; END IF;
  IF jsonb_array_length(core_client_list()) <> 0 THEN RAISE EXCEPTION 'FAIL 9: qualifier can see clients that are not in the qualify stage'; END IF;
END $$;
DO $$
DECLARE ok boolean := false;
BEGIN
  BEGIN PERFORM core_client_get(current_setting('ca.a1')::uuid); EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL 10: qualifier read a client in a stage they have no app for'; END IF;
END $$;
RESET ROLE;

-- Lead Handler: has LEADVERGE permission but the firm is not licensed, so nothing shows
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"d1000000-0000-0000-0000-00000000000c","role":"authenticated"}',true);
DO $$
DECLARE g jsonb;
BEGIN
  g := core_my_apps();
  IF jsonb_array_length(g->'apps') <> 0 THEN RAISE EXCEPTION 'FAIL 11: an unlicensed app showed up for a lead handler'; END IF;
END $$;
RESET ROLE;

-- Someone with no organisation
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"d1000000-0000-0000-0000-00000000000d","role":"authenticated"}',true);
DO $$
DECLARE g jsonb;
BEGIN
  g := core_my_apps();
  IF g->>'organization_id' IS NOT NULL THEN RAISE EXCEPTION 'FAIL 12: a user with no firm got an organisation'; END IF;
  IF jsonb_array_length(coalesce(g->'apps','[]'::jsonb)) <> 0 THEN RAISE EXCEPTION 'FAIL 13: a user with no firm got apps'; END IF;
END $$;
RESET ROLE;

-- Advisor in firm A: DebtVerge only (no Qualify permission)
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"d1000000-0000-0000-0000-00000000000f","role":"authenticated"}',true);
DO $$
DECLARE ids text[]; ok boolean := false; g jsonb;
BEGIN
  SELECT array_agg(a->>'app_id' ORDER BY a->>'app_id') INTO ids FROM jsonb_array_elements(core_my_apps()->'apps') a;
  IF ids IS DISTINCT FROM ARRAY['debtverge'] THEN RAISE EXCEPTION 'FAIL 14: advisor should see only debtverge, got %', ids; END IF;
  -- advisor owns the client but has no edit right on the target app side only matters for leaving; leaving debtverge is allowed
  g := core_client_get(current_setting('ca.a1')::uuid);
  IF (g->>'can_change')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'FAIL 15: advisor cannot change own client'; END IF;
  -- core_set_org_app is not for firm users
  BEGIN PERFORM core_set_org_app('d1000000-1111-0000-0000-000000000001','draftverge',true,NULL,NULL); EXCEPTION WHEN OTHERS THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL 16: an advisor switched on an app for the firm'; END IF;
END $$;
RESET ROLE;

-- Manager in firm A: sees licensed apps they hold permission for, moves a client into Qualify
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"d1000000-0000-0000-0000-00000000000b","role":"authenticated"}',true);
DO $$
DECLARE ids text[]; ok boolean := false;
BEGIN
  SELECT array_agg(a->>'app_id' ORDER BY a->>'app_id') INTO ids FROM jsonb_array_elements(core_my_apps()->'apps') a;
  IF ids IS DISTINCT FROM ARRAY['debtverge','qualifyverge'] THEN RAISE EXCEPTION 'FAIL 17: manager should see debtverge and qualifyverge, got %', ids; END IF;
  BEGIN PERFORM core_set_org_app('d1000000-1111-0000-0000-000000000001','draftverge',true,NULL,NULL); EXCEPTION WHEN OTHERS THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL 18: a manager switched on an app for the firm'; END IF;
  -- not licensed for Draft or IVA: the stage rule may allow it, the licence must not
  ok := false;
  BEGIN PERFORM core_client_change_stage(current_setting('ca.a2')::uuid,'debtverge','ivaverge','Trying to skip ahead to IVA'); EXCEPTION WHEN OTHERS THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL 19: moved into an app the firm is not licensed for'; END IF;
  PERFORM core_client_change_stage(current_setting('ca.a1')::uuid,'debtverge','qualify','Re-assess, may need an IVA');
  IF (core_client_get(current_setting('ca.a1')::uuid)->'client'->>'current_stage') <> 'qualify' THEN RAISE EXCEPTION 'FAIL 20: licensed move did not happen'; END IF;
END $$;
RESET ROLE;

-- Qualifier now sees the moved client and can claim it, but still not the other one
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"d1000000-0000-0000-0000-00000000000a","role":"authenticated"}',true);
DO $$
DECLARE g jsonb;
BEGIN
  IF jsonb_array_length(core_client_list()) <> 1 THEN RAISE EXCEPTION 'FAIL 21: qualifier should see exactly the one qualify client'; END IF;
  g := core_client_get(current_setting('ca.a1')::uuid);
  IF (g->>'can_change')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'FAIL 22: qualifier cannot work an unowned qualify client'; END IF;
  PERFORM core_client_assign(current_setting('ca.a1')::uuid, 'd1000000-0000-0000-0000-00000000000a');
  IF (core_client_get(current_setting('ca.a1')::uuid)->'client'->>'assigned_to') <> 'd1000000-0000-0000-0000-00000000000a' THEN
    RAISE EXCEPTION 'FAIL 23: claim did not take'; END IF;
END $$;
RESET ROLE;

-- Firm B: Qualify is not licensed, so a move into it is refused and next_stages hides it
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"d2000000-0000-0000-0000-00000000000e","role":"authenticated"}',true);
DO $$
DECLARE ok boolean := false; g jsonb;
BEGIN
  g := core_client_get(current_setting('ca.b1')::uuid);
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(g->'next_stages') s WHERE s->>'to_stage' = 'qualify') THEN
    RAISE EXCEPTION 'FAIL 24: firm B was offered an unlicensed stage'; END IF;
  BEGIN PERFORM core_client_change_stage(current_setting('ca.b1')::uuid,'debtverge','qualify','Firm B is not licensed for this'); EXCEPTION WHEN OTHERS THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL 25: firm B moved a client into an unlicensed app'; END IF;
  IF (core_client_get(current_setting('ca.b1')::uuid)->'client'->>'current_stage') <> 'debtverge' THEN RAISE EXCEPTION 'FAIL 26: stage changed despite the refusal'; END IF;
END $$;
RESET ROLE;

-- Service role can switch an app on and off for a firm
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
DO $$ BEGIN PERFORM core_set_org_app('d2000000-1111-0000-0000-000000000002','qualifyverge',true,NULL,NULL); END $$;
RESET ROLE;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM dv_org_products WHERE organization_id='d2000000-1111-0000-0000-000000000002' AND product_key='qualifyverge' AND enabled) THEN
    RAISE EXCEPTION 'FAIL 27: the licence was not created'; END IF;
END $$;

-- Firm B can now move into Qualify. Their Advisor role has no Qualify permission, so afterwards
-- they can no longer see the client; check the stage as the table owner.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"d2000000-0000-0000-0000-00000000000e","role":"authenticated"}',true);
DO $$ BEGIN PERFORM core_client_change_stage(current_setting('ca.b1')::uuid,'debtverge','qualify','Now licensed, re-assessing'); END $$;
RESET ROLE;
DO $$ BEGIN
  IF (SELECT current_stage FROM core_clients WHERE id = current_setting('ca.b1')::uuid) <> 'qualify' THEN RAISE EXCEPTION 'FAIL 28: licensed move did not happen'; END IF;
END $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
DO $$ BEGIN PERFORM core_set_org_app('d2000000-1111-0000-0000-000000000002','qualifyverge',false,NULL,NULL); END $$;
RESET ROLE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM dv_org_products WHERE organization_id='d2000000-1111-0000-0000-000000000002' AND product_key='qualifyverge' AND enabled) THEN
    RAISE EXCEPTION 'FAIL 29: the licence is still live after switching it off'; END IF;
END $$;

-- Firm users cannot edit licences directly
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"d1000000-0000-0000-0000-00000000000b","role":"authenticated"}',true);
DO $$
DECLARE ok boolean := false;
BEGIN
  BEGIN INSERT INTO dv_org_products (organization_id, product_key) VALUES ('d1000000-1111-0000-0000-000000000001','draftverge'); EXCEPTION WHEN OTHERS THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL 30: a manager inserted their own licence'; END IF;
  ok := false;
  BEGIN UPDATE dv_org_products SET ends_on = NULL WHERE organization_id='d1000000-1111-0000-0000-000000000001'; EXCEPTION WHEN OTHERS THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL 31: a manager updated a licence'; END IF;
END $$;
RESET ROLE;

SELECT 'ALL TESTS PASSED' AS result;
ROLLBACK;
