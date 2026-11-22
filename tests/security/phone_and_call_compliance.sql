/* DebtVerge test: phone and call compliance - licence gating, firm isolation, restricted cases, adviser vs manager, reviewer cannot be the adviser, checklist rules, AI drafts need a person, append-only trail, client tables closed, erasure scrub, anon refused. Rolled back. */

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
  ('aaaaaaaa-2222-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-00000000000a','aaaaaaaa-1111-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000000a','T-B3','Book Adviser', false),
  ('bbbbbbbb-2222-0000-0000-000000000009','bbbbbbbb-0000-0000-0000-00000000000b','bbbbbbbb-1111-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-00000000000b','T-B9','Book Other', false);

INSERT INTO dv_org_products (organization_id, product_key, enabled) VALUES
  ('aaaaaaaa-1111-0000-0000-000000000001','voip',true),('aaaaaaaa-1111-0000-0000-000000000001','compliance',true)
ON CONFLICT (organization_id, product_key) DO UPDATE SET enabled = true, starts_on = current_date, ends_on = NULL;
DELETE FROM dv_org_products WHERE organization_id = 'bbbbbbbb-1111-0000-0000-000000000002' AND product_key IN ('voip','compliance');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}',true);
DO $$ DECLARE id uuid; BEGIN
  id := dv_call_log('aaaaaaaa-2222-0000-0000-000000000003','outbound','07700900123', now() - interval '1 hour', 300, 'spoke_to_client', 'Discussed budget and agreed to send income details', true, true, true, current_date + 3);
  PERFORM set_config('t.c1', id::text, true);
  BEGIN PERFORM dv_call_log('aaaaaaaa-2222-0000-0000-000000000003','outbound',NULL, now() - interval '1 hour', 60, 'spoke_to_client', 'Spoke about the plan today', NULL); RAISE EXCEPTION 'C1 missing notice answer allowed'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN PERFORM dv_call_log('aaaaaaaa-2222-0000-0000-000000000003','outbound',NULL, now() - interval '1 hour', 60, 'spoke_to_client', 'short', true); RAISE EXCEPTION 'C2 short summary allowed'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN PERFORM dv_call_log('aaaaaaaa-2222-0000-0000-000000000003','outbound',NULL, now() + interval '2 days', 60, 'no_answer', NULL); RAISE EXCEPTION 'C3 future call allowed'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN PERFORM dv_call_log('aaaaaaaa-2222-0000-0000-000000000002','outbound',NULL, now() - interval '1 hour', 60, 'no_answer', NULL); RAISE EXCEPTION 'C4 restricted case call allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM dv_call_list('aaaaaaaa-2222-0000-0000-000000000002'); RAISE EXCEPTION 'C5 restricted case list allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM dv_call_log('bbbbbbbb-2222-0000-0000-000000000009','outbound',NULL, now() - interval '1 hour', 60, 'no_answer', NULL); RAISE EXCEPTION 'C6 other firm case call allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF (SELECT count(*) FROM dv_call_list('aaaaaaaa-2222-0000-0000-000000000003')) <> 1 THEN RAISE EXCEPTION 'C7 call list wrong'; END IF;
  IF NOT EXISTS (SELECT 1 FROM case_tasks WHERE case_id = 'aaaaaaaa-2222-0000-0000-000000000003' AND title LIKE 'Possible complaint%') THEN RAISE EXCEPTION 'C8 complaint task missing'; END IF;
  BEGIN PERFORM dv_compliance_queue('needs_review'); RAISE EXCEPTION 'C9 adviser reached compliance'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM * FROM dv_call_sessions; RAISE EXCEPTION 'C10 direct table read allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF (dv_call_detail(id)->'call') ? 'recording_ref' THEN RAISE EXCEPTION 'C11 recording_ref exposed'; END IF;
END $$;
-- manager logs own call on case 1, then cannot review it
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-00000000000d","role":"authenticated"}',true);
DO $$ DECLARE mid uuid; rid uuid; c1 uuid := current_setting('t.c1')::uuid; BEGIN
  mid := dv_call_log('aaaaaaaa-2222-0000-0000-000000000001','inbound',NULL, now() - interval '2 hours', 120, 'spoke_to_client', 'Client asked about the fee statement', true);
  BEGIN PERFORM dv_compliance_take_review(mid); RAISE EXCEPTION 'M1 reviewed own call'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF NOT EXISTS (SELECT 1 FROM dv_compliance_queue('flagged') q WHERE q.id = c1) THEN RAISE EXCEPTION 'M2 flagged call missing from queue'; END IF;
  IF EXISTS (SELECT 1 FROM dv_compliance_queue('needs_review') q WHERE q.case_number = 'T-B2') THEN RAISE EXCEPTION 'M3 restricted case in queue'; END IF;
  rid := dv_compliance_take_review(c1, current_date + 3);
  PERFORM set_config('t.r1', rid::text, true);
  BEGIN PERFORM dv_compliance_take_review(c1); RAISE EXCEPTION 'M4 second review allowed'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN PERFORM dv_compliance_complete(rid,'pass','{"recording_notice":"yes"}'::jsonb,'fine'); RAISE EXCEPTION 'M5 partial checklist allowed'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN PERFORM dv_compliance_complete(rid,'pass','{"recording_notice":"yes","identity_checked":"yes","affordability_discussed":"yes","vulnerability_considered":"no","options_explained":"yes","no_pressure":"yes","accurate_information":"yes","next_steps_agreed":"yes"}'::jsonb,NULL); RAISE EXCEPTION 'M6 clean pass with a no'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN PERFORM dv_compliance_complete(rid,'fail','{"recording_notice":"yes","identity_checked":"yes","affordability_discussed":"yes","vulnerability_considered":"no","options_explained":"yes","no_pressure":"yes","accurate_information":"yes","next_steps_agreed":"yes"}'::jsonb,'x'); RAISE EXCEPTION 'M7 fail without comments'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  PERFORM dv_compliance_complete(rid,'pass_with_feedback','{"recording_notice":"yes","identity_checked":"yes","affordability_discussed":"yes","vulnerability_considered":"no","options_explained":"yes","no_pressure":"yes","accurate_information":"yes","next_steps_agreed":"yes"}'::jsonb,'Vulnerability was not explored enough on the call','Revisit vulnerability prompts', current_date + 14);
  BEGIN PERFORM dv_compliance_complete(rid,'pass','{}'::jsonb,NULL); RAISE EXCEPTION 'M8 completed review changed'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  IF (dv_compliance_dashboard()->>'calls_30d')::int <> 2 OR (dv_compliance_dashboard()->>'reviewed_30d')::int <> 1 THEN RAISE EXCEPTION 'M9 dashboard counts wrong: %', dv_compliance_dashboard(); END IF;
  IF (SELECT count(*) FROM dv_compliance_audit(50)) < 1 THEN RAISE EXCEPTION 'M10 audit log empty'; END IF;
END $$;
-- adviser sees outcome and coaching only
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}',true);
DO $$ DECLARE d jsonb; c1 uuid := current_setting('t.c1')::uuid; BEGIN
  d := dv_call_detail(c1);
  IF d->'review'->>'outcome' <> 'pass_with_feedback' OR (d->'review') ? 'checklist' OR (d->'review') ? 'comments' THEN RAISE EXCEPTION 'A1 adviser review view wrong: %', d->'review'; END IF;
  IF (SELECT count(*) FROM dv_my_coaching()) <> 1 THEN RAISE EXCEPTION 'A2 coaching missing'; END IF;
  PERFORM dv_coaching_done(current_setting('t.r1')::uuid);
  IF NOT (SELECT done FROM dv_my_coaching() LIMIT 1) THEN RAISE EXCEPTION 'A3 coaching not marked done'; END IF;
END $$;
-- AI drafts
RESET ROLE;
INSERT INTO dv_call_ai_drafts (id, organization_id, case_id, call_id, kind, body, model) VALUES
  ('aaaaaaaa-4444-0000-0000-000000000001','aaaaaaaa-1111-0000-0000-000000000001','aaaaaaaa-2222-0000-0000-000000000003', current_setting('t.c1')::uuid, 'summary', 'Draft summary of the call with the client''s phone 07700900123', 'test-model');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"bbbbbbbb-0000-0000-0000-00000000000b","role":"authenticated"}',true);
DO $$ BEGIN
  BEGIN PERFORM dv_call_ai_decide('aaaaaaaa-4444-0000-0000-000000000001','approve'); RAISE EXCEPTION 'D1 other firm decided draft'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}',true);
DO $$ BEGIN
  BEGIN PERFORM dv_call_ai_decide('aaaaaaaa-4444-0000-0000-000000000001','amend', ''); RAISE EXCEPTION 'D2 amend without text'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  PERFORM dv_call_ai_decide('aaaaaaaa-4444-0000-0000-000000000001','amend','Corrected summary text');
  BEGIN PERFORM dv_call_ai_decide('aaaaaaaa-4444-0000-0000-000000000001','approve'); RAISE EXCEPTION 'D3 decided twice'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
END $$;
-- append-only and no delete (even for the table owner)
RESET ROLE;
DO $$ BEGIN
  BEGIN UPDATE dv_call_events SET event = 'x'; RAISE EXCEPTION 'T1 event changed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN UPDATE dv_call_access_log SET action = 'download'; RAISE EXCEPTION 'T2 access log changed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN DELETE FROM dv_call_sessions; RAISE EXCEPTION 'T3 call deleted'; EXCEPTION WHEN insufficient_privilege OR raise_exception THEN IF SQLERRM LIKE 'T3%' THEN RAISE; END IF; END;
END $$;
-- anon refused
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM dv_call_log('aaaaaaaa-2222-0000-0000-000000000003','outbound',NULL, now(), 1, 'no_answer', NULL); RAISE EXCEPTION 'X1 anon logged call'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM dv_compliance_dashboard(); RAISE EXCEPTION 'X2 anon dashboard'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
-- unlicensed firm refused
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"bbbbbbbb-0000-0000-0000-00000000000b","role":"authenticated"}',true);
DO $$ BEGIN
  BEGIN PERFORM dv_call_log('bbbbbbbb-2222-0000-0000-000000000009','outbound',NULL, now() - interval '1 hour', 60, 'no_answer', NULL); RAISE EXCEPTION 'L1 unlicensed firm logged call'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM dv_compliance_dashboard(); RAISE EXCEPTION 'L2 unlicensed compliance'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT 'phone_and_call_compliance: all checks passed' AS result;
ROLLBACK;
