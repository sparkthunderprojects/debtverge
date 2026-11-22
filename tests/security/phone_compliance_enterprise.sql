/* DebtVerge test: enterprise Phone and Call compliance - licence gating, firm isolation, restricted cases, live-call rules, recording pause, telephony intake, unidentified calls, review pipeline (second approver, escalation, reassign), QA, search, reports, risks, coaching, transcript and recording access, closed tables, erasure scrub, anon refused. Rolled back. */
BEGIN;
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at) VALUES
  ('aaaaaaaa-0000-0000-0000-00000000000a','00000000-0000-0000-0000-000000000000','authenticated','authenticated','t-adv-a@test.invalid','x',now(),now()),
  ('aaaaaaaa-0000-0000-0000-00000000000d','00000000-0000-0000-0000-000000000000','authenticated','authenticated','t-adm-a@test.invalid','x',now(),now()),
  ('aaaaaaaa-0000-0000-0000-00000000000e','00000000-0000-0000-0000-000000000000','authenticated','authenticated','t-mgr-a@test.invalid','x',now(),now()),
  ('bbbbbbbb-0000-0000-0000-00000000000b','00000000-0000-0000-0000-000000000000','authenticated','authenticated','t-mgr-b@test.invalid','x',now(),now());
INSERT INTO organizations (id, name, slug, owner_id) VALUES
  ('aaaaaaaa-1111-0000-0000-000000000001','Test Firm A','test-firm-a','aaaaaaaa-0000-0000-0000-00000000000d'),
  ('bbbbbbbb-1111-0000-0000-000000000002','Test Firm B','test-firm-b','bbbbbbbb-0000-0000-0000-00000000000b');
SELECT seed_debtverge_roles('aaaaaaaa-1111-0000-0000-000000000001');
SELECT seed_debtverge_roles('bbbbbbbb-1111-0000-0000-000000000002');
INSERT INTO organization_users (organization_id, user_id, role_id) SELECT 'aaaaaaaa-1111-0000-0000-000000000001', u.id, r.id FROM (VALUES ('aaaaaaaa-0000-0000-0000-00000000000a'::uuid,'Advisor'),('aaaaaaaa-0000-0000-0000-00000000000d'::uuid,'Operations Manager'),('aaaaaaaa-0000-0000-0000-00000000000e'::uuid,'Team Manager')) u(id,rn) JOIN rbac_roles r ON r.organization_id='aaaaaaaa-1111-0000-0000-000000000001' AND r.name=u.rn;
INSERT INTO organization_users (organization_id, user_id, role_id) SELECT 'bbbbbbbb-1111-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-00000000000b', r.id FROM rbac_roles r WHERE r.organization_id='bbbbbbbb-1111-0000-0000-000000000002' AND r.name='Team Manager';
INSERT INTO debt_cases (id, user_id, organization_id, assigned_to, case_number, debtor_name, is_restricted) VALUES
  ('aaaaaaaa-2222-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-00000000000d','aaaaaaaa-1111-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000000d','T-B2','Book Restricted', true),
  ('aaaaaaaa-2222-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-00000000000a','aaaaaaaa-1111-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000000a','T-B3','Book Adviser', false),
  ('bbbbbbbb-2222-0000-0000-000000000009','bbbbbbbb-0000-0000-0000-00000000000b','bbbbbbbb-1111-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-00000000000b','T-B9','Book Other', false);
INSERT INTO dv_org_products (organization_id, product_key, enabled) VALUES
  ('aaaaaaaa-1111-0000-0000-000000000001','voip',true),('aaaaaaaa-1111-0000-0000-000000000001','compliance',true)
ON CONFLICT (organization_id, product_key) DO UPDATE SET enabled = true, starts_on = current_date, ends_on = NULL;
DELETE FROM dv_org_products WHERE organization_id = 'bbbbbbbb-1111-0000-0000-000000000002' AND product_key IN ('voip','compliance');
INSERT INTO org_phone_numbers (organization_id, e164, label) VALUES ('aaaaaaaa-1111-0000-0000-000000000001','+442070000001','Main line');

-- 1. adviser live call
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}',true);
DO $$ DECLARE r jsonb; cid uuid; BEGIN
  r := dv_call_start('aaaaaaaa-2222-0000-0000-000000000003','07700900123');
  cid := (r->>'call_id')::uuid; PERFORM set_config('t.c1', cid::text, true);
  IF (r->>'notice') IS NULL THEN RAISE EXCEPTION 'L1 no recording notice returned'; END IF;
  BEGIN PERFORM dv_call_start('aaaaaaaa-2222-0000-0000-000000000003','07700900123'); RAISE EXCEPTION 'L2 second live call allowed'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN PERFORM dv_call_state(cid,'hold'); RAISE EXCEPTION 'L3 hold before answer allowed'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN PERFORM dv_call_start('aaaaaaaa-2222-0000-0000-000000000002','07700900123'); RAISE EXCEPTION 'L4 restricted case call allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM dv_call_start('bbbbbbbb-2222-0000-0000-000000000009','07700900123'); RAISE EXCEPTION 'L5 other firm call allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM * FROM dv_call_sessions; RAISE EXCEPTION 'L6 direct table read allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM dv_call_recording_ref(cid); RAISE EXCEPTION 'L7 adviser can read recording ref'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
UPDATE dv_call_sessions SET status = 'answered', answered_at = now(), recording_status = 'recording' WHERE id = current_setting('t.c1')::uuid;
SET LOCAL ROLE authenticated;
DO $$ DECLARE cid uuid := current_setting('t.c1')::uuid; BEGIN
  PERFORM dv_call_state(cid,'hold'); PERFORM dv_call_state(cid,'resume');
  BEGIN PERFORM dv_call_recording_event(cid,'paused',NULL); RAISE EXCEPTION 'L8 pause without reason'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  PERFORM dv_call_recording_event(cid,'paused','Taking card details');
  BEGIN PERFORM dv_call_recording_event(cid,'paused','Taking card details'); RAISE EXCEPTION 'L9 double pause'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  PERFORM dv_call_recording_event(cid,'resumed');
  BEGIN PERFORM dv_call_transfer(cid,'adviser',NULL,'aaaaaaaa-0000-0000-0000-00000000000e'); RAISE EXCEPTION 'L11 transfer to offline colleague'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  PERFORM dv_call_participant_add(cid,'A. Specialist','Debt specialist','specialist');
  PERFORM dv_call_note_add(cid,'Client mentioned a recent bereavement','vulnerability_indicator', true, current_date + 2);
  IF NOT (SELECT vulnerability_flag FROM dv_call_list('aaaaaaaa-2222-0000-0000-000000000003') LIMIT 1) THEN RAISE EXCEPTION 'L12 vulnerability note did not flag the call'; END IF;
  BEGIN PERFORM dv_call_finish(cid,'spoke_to_client','short',true); RAISE EXCEPTION 'L13 short summary allowed'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN PERFORM dv_call_finish(cid,'spoke_to_client','Discussed the budget and next steps',NULL); RAISE EXCEPTION 'L14 notice answer skipped'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  PERFORM dv_call_finish(cid,'spoke_to_client','Discussed the budget and next steps with the client', true, false, true, current_date + 3);
  BEGIN PERFORM dv_call_finish(cid,'spoke_to_client','Discussed the budget and next steps with the client', true); RAISE EXCEPTION 'L15 wrapped up twice'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  IF (SELECT count(*) FROM dv_my_calls_pending()) <> 0 THEN RAISE EXCEPTION 'L16 pending list not empty'; END IF;
  IF NOT EXISTS (SELECT 1 FROM case_tasks WHERE case_id = 'aaaaaaaa-2222-0000-0000-000000000003' AND title LIKE 'Possible complaint%') THEN RAISE EXCEPTION 'L17 complaint task missing'; END IF;
  PERFORM dv_call_callback_schedule('aaaaaaaa-2222-0000-0000-000000000003','07700900123', now() + interval '1 day', 2, 'Call after payday', cid);
  IF (SELECT count(*) FROM dv_call_callbacks('aaaaaaaa-2222-0000-0000-000000000003')) <> 1 THEN RAISE EXCEPTION 'L18 callback missing'; END IF;
  IF jsonb_array_length(dv_call_timeline('aaaaaaaa-2222-0000-0000-000000000003')) < 3 THEN RAISE EXCEPTION 'L19 timeline thin'; END IF;
  BEGIN PERFORM dv_compliance_queue('all'); RAISE EXCEPTION 'L20 adviser reached compliance'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM dv_telephony_set(true,'This call is recorded for quality',6,true,false,true); RAISE EXCEPTION 'L21 adviser changed settings'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF (dv_call_detail(cid)->'call') ? 'recording_ref' THEN RAISE EXCEPTION 'L22 recording_ref exposed'; END IF;
END $$;

-- 2. telephony intake (service role)
RESET ROLE;
INSERT INTO dv_telephony_settings (organization_id, transcription_enabled) VALUES ('aaaaaaaa-1111-0000-0000-000000000001', true) ON CONFLICT (organization_id) DO UPDATE SET transcription_enabled = true;
SET LOCAL ROLE service_role;
DO $$ DECLARE r jsonb; sid uuid; BEGIN
  r := dv_call_ingest('incoming','{"call_sid":"CA1","from":"+447700900999","to":"+442070000001"}'::jsonb);
  IF r->>'status' <> 'ok' OR (r->>'identified')::boolean THEN RAISE EXCEPTION 'T1 incoming wrong: %', r; END IF;
  sid := (r->>'call_id')::uuid; PERFORM set_config('t.u1', sid::text, true);
  IF dv_call_ingest('incoming','{"call_sid":"CA2","from":"+447700900999","to":"+449999999999"}'::jsonb)->>'status' <> 'unknown_number' THEN RAISE EXCEPTION 'T2 unknown number routed'; END IF;
  PERFORM dv_call_ingest('answered','{"call_sid":"CA1","answered_by":"aaaaaaaa-0000-0000-0000-00000000000a"}'::jsonb);
  PERFORM dv_call_ingest('status','{"call_sid":"CA1","status":"completed","duration":"95"}'::jsonb);
  IF (SELECT status FROM dv_call_sessions WHERE id = sid) <> 'completed' THEN RAISE EXCEPTION 'T3 call not completed'; END IF;
  IF dv_call_ingest('status','{"call_sid":"CA1","status":"failed"}'::jsonb)->>'status' <> 'ignored' THEN RAISE EXCEPTION 'T4 ended call changed'; END IF;
  IF dv_call_ingest('status','{"call_sid":"NOPE","status":"completed"}'::jsonb)->>'status' <> 'unknown_call' THEN RAISE EXCEPTION 'T5 unknown call accepted'; END IF;
  PERFORM dv_call_ingest('recording','{"call_sid":"CA1","ref":"aaaaaaaa-1111-0000-0000-000000000001/CA1.mp3"}'::jsonb);
  PERFORM dv_call_ingest('transcript','{"call_sid":"CA1","text":"Hello this is a test call transcript"}'::jsonb);
  IF NOT EXISTS (SELECT 1 FROM dv_call_sessions WHERE id = sid AND recording_status = 'available') THEN RAISE EXCEPTION 'T6 recording not stored'; END IF;
END $$;
RESET ROLE;
-- transcript is immutable
DO $$ BEGIN
  BEGIN UPDATE dv_call_transcripts SET body = 'changed' WHERE call_id = current_setting('t.u1')::uuid; RAISE EXCEPTION 'T7 transcript changed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

-- 3. unidentified call triage (admin)
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-00000000000d","role":"authenticated"}',true);
DO $$ DECLARE u uuid := current_setting('t.u1')::uuid; BEGIN
  IF NOT EXISTS (SELECT 1 FROM dv_call_unmatched() x WHERE x.id = u) THEN RAISE EXCEPTION 'U1 unidentified call missing'; END IF;
  PERFORM dv_call_attach_case(u, 'aaaaaaaa-2222-0000-0000-000000000003');
  BEGIN PERFORM dv_call_attach_case(u, 'aaaaaaaa-2222-0000-0000-000000000003'); RAISE EXCEPTION 'U2 filed twice'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  PERFORM dv_telephony_get();
  BEGIN PERFORM dv_telephony_set(true,'short',6,true,false,true); RAISE EXCEPTION 'U3 weak notice accepted'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN PERFORM dv_telephony_set(true,'This call is recorded for quality',6,false,true,true); RAISE EXCEPTION 'U4 AI without transcription'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  PERFORM dv_telephony_set(true,'This call is recorded for quality and training',6,true,false,true);
END $$;

-- 4. review pipeline
DO $$ DECLARE c1 uuid := current_setting('t.c1')::uuid; rid uuid; BEGIN
  BEGIN PERFORM dv_compliance_assign(c1,'aaaaaaaa-0000-0000-0000-00000000000a'); RAISE EXCEPTION 'R1 adviser reviews own call'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  rid := dv_compliance_assign(c1,'aaaaaaaa-0000-0000-0000-00000000000d','high', current_date + 5);
  PERFORM set_config('t.r1', rid::text, true);
  BEGIN PERFORM dv_compliance_assign(c1,NULL); RAISE EXCEPTION 'R2 second review'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN PERFORM dv_compliance_submit(rid,'compliant','{"recording_notice":"yes"}'::jsonb,'[]'::jsonb,'[]'::jsonb,NULL); RAISE EXCEPTION 'R3 submit before start'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  PERFORM dv_compliance_start(rid);
  BEGIN PERFORM dv_compliance_submit(rid,'compliant','{"recording_notice":"yes","identity_checked":"yes","vulnerability_considered":"no","options_explained":"yes","affordability_discussed":"na","fees_explained":"na","no_pressure":"na","accurate_information":"na","next_steps_agreed":"na"}'::jsonb,'[]'::jsonb,'[]'::jsonb,NULL); RAISE EXCEPTION 'R4 compliant with a no'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN PERFORM dv_compliance_submit(rid,'non_compliant','{"recording_notice":"no","identity_checked":"yes","vulnerability_considered":"yes","options_explained":"yes","affordability_discussed":"na","fees_explained":"na","no_pressure":"na","accurate_information":"na","next_steps_agreed":"na"}'::jsonb,'[]'::jsonb,'[]'::jsonb,'Notice not given'); RAISE EXCEPTION 'R5 non-compliant without issue'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN PERFORM dv_compliance_submit(rid,'minor_issues','{"recording_notice":"yes","BAD KEY":"yes"}'::jsonb,'[]'::jsonb,'[]'::jsonb,NULL); RAISE EXCEPTION 'R6 bad key'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  IF dv_compliance_submit(rid,'minor_issues','{"recording_notice":"yes","identity_checked":"yes","vulnerability_considered":"no","options_explained":"yes","affordability_discussed":"na","fees_explained":"na","no_pressure":"na","accurate_information":"na","next_steps_agreed":"na"}'::jsonb,'[{"severity":"minor","text":"Vulnerability not explored"}]'::jsonb,'[{"text":"Refresh vulnerability prompts"}]'::jsonb,'Needs a prompt on vulnerability') <> 75 THEN RAISE EXCEPTION 'R7 score wrong'; END IF;
  BEGIN PERFORM dv_compliance_decide(rid,'approve'); RAISE EXCEPTION 'R8 reviewer approved own review'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}',true);
DO $$ BEGIN
  BEGIN PERFORM dv_compliance_decide(current_setting('t.r1')::uuid,'approve'); RAISE EXCEPTION 'R9 adviser approved'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF jsonb_typeof(dv_call_detail(current_setting('t.c1')::uuid)->'review') <> 'null' THEN RAISE EXCEPTION 'R10 adviser saw review before approval'; END IF;
END $$;
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-00000000000e","role":"authenticated"}',true);
DO $$ DECLARE rid uuid := current_setting('t.r1')::uuid; BEGIN
  BEGIN PERFORM dv_compliance_decide(rid,'reject','x'); RAISE EXCEPTION 'R11 weak rejection'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  PERFORM dv_compliance_decide(rid,'approve','Agreed');
  BEGIN PERFORM dv_compliance_reassign(rid,'aaaaaaaa-0000-0000-0000-00000000000d','changed my mind'); RAISE EXCEPTION 'R12 approved review reassigned'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN PERFORM dv_compliance_decide(rid,'approve'); RAISE EXCEPTION 'R13 decided twice'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}',true);
DO $$ DECLARE d jsonb; BEGIN
  d := dv_call_detail(current_setting('t.c1')::uuid);
  IF d->'review'->>'outcome' <> 'minor_issues' OR (d->'review') ? 'comments' OR (d->'review') ? 'checklist' OR (d->'review') ? 'steps' THEN RAISE EXCEPTION 'R14 adviser view wrong: %', d->'review'; END IF;
END $$;

-- 5. escalation and reassignment on a second call
RESET ROLE;
INSERT INTO dv_call_sessions (id, organization_id, case_id, direction, source, status, phone, adviser_id, started_at, outcome, duration_seconds, customer_identified)
VALUES ('aaaaaaaa-3333-0000-0000-000000000002','aaaaaaaa-1111-0000-0000-000000000001','aaaaaaaa-2222-0000-0000-000000000003','outbound','softphone','completed','07700900123','aaaaaaaa-0000-0000-0000-00000000000a', now() - interval '2 hours','spoke_to_client', 120, true);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-00000000000d","role":"authenticated"}',true);
DO $$ DECLARE rid uuid; BEGIN
  IF NOT EXISTS (SELECT 1 FROM dv_compliance_unreviewed(50) u WHERE u.call_id = 'aaaaaaaa-3333-0000-0000-000000000002') THEN RAISE EXCEPTION 'E1 unreviewed call without notice not listed'; END IF;
  rid := dv_compliance_assign('aaaaaaaa-3333-0000-0000-000000000002', NULL, 'normal', current_date + 3);
  PERFORM set_config('t.r2', rid::text, true);
  PERFORM dv_compliance_claim(rid);
  PERFORM dv_compliance_reassign(rid,'aaaaaaaa-0000-0000-0000-00000000000e','Workload');
  BEGIN PERFORM dv_compliance_extend(rid, current_date + 1, 'earlier'); RAISE EXCEPTION 'E2 extension to earlier date'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  PERFORM dv_compliance_extend(rid, current_date + 6, 'Reviewer on leave');
END $$;
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-00000000000e","role":"authenticated"}',true);
DO $$ DECLARE rid uuid := current_setting('t.r2')::uuid; BEGIN
  PERFORM dv_compliance_start(rid);
  PERFORM dv_compliance_submit(rid,'major_issues','{"recording_notice":"no","identity_checked":"yes","vulnerability_considered":"yes","options_explained":"yes","affordability_discussed":"na","fees_explained":"na","no_pressure":"na","accurate_information":"na","next_steps_agreed":"na"}'::jsonb,'[{"severity":"major","text":"No recording notice given"}]'::jsonb,'[]'::jsonb,'The recording notice was not given at the start');
  BEGIN PERFORM dv_compliance_escalate(rid,'aaaaaaaa-0000-0000-0000-00000000000a','Serious breach found'); RAISE EXCEPTION 'E3 escalated to the adviser'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  PERFORM dv_compliance_escalate(rid,'aaaaaaaa-0000-0000-0000-00000000000d','Serious breach found on the call');
  BEGIN PERFORM dv_compliance_decide(rid,'approve'); RAISE EXCEPTION 'E4 reviewer decided own escalated review'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-00000000000d","role":"authenticated"}',true);
DO $$ DECLARE rid uuid := current_setting('t.r2')::uuid; BEGIN
  PERFORM dv_compliance_decide(rid,'approve','Confirmed breach');
  PERFORM dv_call_risk_raise('aaaaaaaa-3333-0000-0000-000000000002','disclosure_missing','high','Recording notice missing on the call');
  IF (SELECT count(*) FROM dv_compliance_risks('open')) <> 1 THEN RAISE EXCEPTION 'E5 risk missing'; END IF;
  BEGIN PERFORM dv_call_risk_resolve((SELECT id FROM dv_compliance_risks('open') LIMIT 1), 'x'); RAISE EXCEPTION 'E6 weak resolution'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  PERFORM dv_call_risk_resolve((SELECT id FROM dv_compliance_risks('open') LIMIT 1), 'Adviser retrained on opening script');
  PERFORM dv_coaching_assign('aaaaaaaa-0000-0000-0000-00000000000a','coaching_session','Recording notice refresher','Practise the opening script','high', current_date + 7, rid, 'aaaaaaaa-3333-0000-0000-000000000002');
  IF (SELECT count(*) FROM jsonb_array_elements(dv_call_detail('aaaaaaaa-3333-0000-0000-000000000002')->'review'->'steps')) < 6 THEN RAISE EXCEPTION 'E7 workflow steps missing'; END IF;
END $$;
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}',true);
DO $$ DECLARE a uuid; BEGIN
  SELECT id INTO a FROM dv_my_coaching() LIMIT 1;
  IF a IS NULL THEN RAISE EXCEPTION 'C1 coaching missing'; END IF;
  BEGIN PERFORM dv_coaching_update(a,'completed',NULL); RAISE EXCEPTION 'C2 completed without notes'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  PERFORM dv_coaching_update(a,'completed','Practised the script twice with my team lead');
  BEGIN PERFORM dv_coaching_review(a,5,'ok'); RAISE EXCEPTION 'C3 adviser rated own coaching'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

-- 6. manager views: dashboard, search, QA, reports, audit, recording and transcript access
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-00000000000d","role":"authenticated"}',true);
DO $$ DECLARE d jsonb; c1 uuid := current_setting('t.c1')::uuid; t text; BEGIN
  PERFORM dv_coaching_review((SELECT id FROM dv_coaching_list('completed') LIMIT 1), 5, 'Good progress');
  d := dv_compliance_dashboard(30);
  IF (d->>'reviewed')::int <> 2 OR (d->>'calls')::int < 3 THEN RAISE EXCEPTION 'D1 dashboard wrong: %', d; END IF;
  IF (dv_compliance_search('{"flagged":true}'::jsonb, 50, 0)->>'total')::int < 1 THEN RAISE EXCEPTION 'D2 search found nothing'; END IF;
  IF (dv_compliance_search('{"no_notice":true}'::jsonb, 50, 0)->>'total')::int <> 1 THEN RAISE EXCEPTION 'D3 no-notice search wrong'; END IF;
  BEGIN PERFORM dv_compliance_search('{"direction":"sideways"}'::jsonb); RAISE EXCEPTION 'D4 bad filter accepted'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  IF jsonb_array_length(dv_compliance_adviser_qa(30)->'advisers') <> 1 THEN RAISE EXCEPTION 'D5 QA wrong'; END IF;
  FOREACH t IN ARRAY ARRAY['compliance_summary','adviser_performance','risk_analysis','audit_trail','complaint_trends','regulatory_return'] LOOP
    IF jsonb_array_length(dv_compliance_report(t, current_date - 30, current_date)->'columns') < 2 THEN RAISE EXCEPTION 'D6 report % broken', t; END IF;
  END LOOP;
  BEGIN PERFORM dv_compliance_report('nope', current_date - 1, current_date); RAISE EXCEPTION 'D7 unknown report'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN PERFORM dv_compliance_report('audit_trail', current_date - 800, current_date); RAISE EXCEPTION 'D8 huge range'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  IF (SELECT count(*) FROM dv_compliance_audit(100, NULL, NULL, NULL, NULL)) < 3 THEN RAISE EXCEPTION 'D9 audit empty'; END IF;
  IF dv_call_transcript((current_setting('t.u1'))::uuid)->>'body' IS NULL THEN RAISE EXCEPTION 'D10 transcript unreadable by manager'; END IF;
  IF NOT dv_call_recording_check((current_setting('t.u1'))::uuid, true) THEN RAISE EXCEPTION 'D11 manager download refused'; END IF;
  IF NOT EXISTS (SELECT 1 FROM dv_compliance_audit(100,'download_recording',NULL,NULL,NULL)) THEN RAISE EXCEPTION 'D12 download not logged'; END IF;
END $$;
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}',true);
DO $$ BEGIN
  IF NOT dv_call_recording_check(current_setting('t.u1')::uuid, false) THEN RAISE EXCEPTION 'P1 adviser playback refused'; END IF;
  BEGIN PERFORM dv_call_recording_check(current_setting('t.u1')::uuid, true); RAISE EXCEPTION 'P2 adviser download allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

-- 7. other firm and anon
SELECT set_config('request.jwt.claims','{"sub":"bbbbbbbb-0000-0000-0000-00000000000b","role":"authenticated"}',true);
DO $$ BEGIN
  BEGIN PERFORM dv_call_detail(current_setting('t.c1')::uuid); RAISE EXCEPTION 'X1 other firm read a call'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM dv_compliance_dashboard(30); RAISE EXCEPTION 'X2 unlicensed firm reached compliance'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM dv_telephony_get(); RAISE EXCEPTION 'X3 unlicensed firm reached telephony'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM dv_call_transcript(current_setting('t.u1')::uuid); RAISE EXCEPTION 'X4 other firm read transcript'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE; SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM dv_call_detail(current_setting('t.c1')::uuid); RAISE EXCEPTION 'X5 anon read a call'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM dv_compliance_search('{}'::jsonb); RAISE EXCEPTION 'X6 anon searched'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM dv_call_ingest('incoming','{}'::jsonb); RAISE EXCEPTION 'X7 anon ingested'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
UPDATE debt_cases SET deleted_at = now() WHERE id = 'aaaaaaaa-2222-0000-0000-000000000003';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-00000000000d","role":"authenticated"}',true);
DO $$ BEGIN
  BEGIN PERFORM dv_call_ingest('incoming','{}'::jsonb); RAISE EXCEPTION 'X8 user ingested'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM * FROM dv_call_transcripts; RAISE EXCEPTION 'X9 direct transcript read'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM * FROM dv_call_reviews; RAISE EXCEPTION 'X10 direct review read'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  -- erasure scrubs the call tables
  PERFORM dv_erase_case('aaaaaaaa-2222-0000-0000-000000000003','Test erasure request from the client');
END $$;
RESET ROLE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM dv_call_transcripts WHERE body LIKE '%transcript%') THEN RAISE EXCEPTION 'Z1 transcript survived erasure'; END IF;
  IF EXISTS (SELECT 1 FROM dv_call_notes WHERE note_text LIKE '%bereavement%') THEN RAISE EXCEPTION 'Z2 call note survived erasure'; END IF;
  IF EXISTS (SELECT 1 FROM dv_call_reviews WHERE comments LIKE '%vulnerability%' OR issues <> '[]'::jsonb) THEN RAISE EXCEPTION 'Z3 review text survived erasure'; END IF;
  IF EXISTS (SELECT 1 FROM dv_call_callbacks WHERE phone LIKE '%7700900123%') THEN RAISE EXCEPTION 'Z4 callback survived erasure'; END IF;
END $$;
SELECT 'phone_compliance_enterprise: all checks passed' AS result;
ROLLBACK;
