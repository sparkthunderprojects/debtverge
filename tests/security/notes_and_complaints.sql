/* DebtVerge test: case notes (permissions, firm isolation, versions, withdraw, links, follow-up task, search) and the complaints workflow
   (flagging, deadlines, handler routing, auto-acknowledgement, structured outcome, maker-checker redress, timeline, MI). Rolled back. */
BEGIN;
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at) VALUES
  ('aaaaaaaa-0000-0000-0000-00000000000a','00000000-0000-0000-0000-000000000000','authenticated','authenticated','t-adv-a@test.invalid','x',now(),now()),
  ('aaaaaaaa-0000-0000-0000-00000000000c','00000000-0000-0000-0000-000000000000','authenticated','authenticated','t-adv2-a@test.invalid','x',now(),now()),
  ('aaaaaaaa-0000-0000-0000-00000000000d','00000000-0000-0000-0000-000000000000','authenticated','authenticated','t-mgr-a@test.invalid','x',now(),now()),
  ('aaaaaaaa-0000-0000-0000-00000000000e','00000000-0000-0000-0000-000000000000','authenticated','authenticated','t-mgr2-a@test.invalid','x',now(),now()),
  ('bbbbbbbb-0000-0000-0000-00000000000b','00000000-0000-0000-0000-000000000000','authenticated','authenticated','t-mgr-b@test.invalid','x',now(),now());
INSERT INTO organizations (id, name, slug, owner_id) VALUES
  ('aaaaaaaa-1111-0000-0000-000000000001','Test Firm A','test-firm-a','aaaaaaaa-0000-0000-0000-00000000000d'),
  ('bbbbbbbb-1111-0000-0000-000000000002','Test Firm B','test-firm-b','bbbbbbbb-0000-0000-0000-00000000000b');
SELECT seed_debtverge_roles('aaaaaaaa-1111-0000-0000-000000000001');
SELECT seed_debtverge_roles('bbbbbbbb-1111-0000-0000-000000000002');
INSERT INTO dv_org_products (organization_id, product_key) VALUES ('aaaaaaaa-1111-0000-0000-000000000001','dmp_advisor'),('bbbbbbbb-1111-0000-0000-000000000002','dmp_advisor');
INSERT INTO organization_users (organization_id, user_id, role_id)
SELECT 'aaaaaaaa-1111-0000-0000-000000000001', u.id, r.id FROM (VALUES
  ('aaaaaaaa-0000-0000-0000-00000000000a'::uuid,'Advisor'),('aaaaaaaa-0000-0000-0000-00000000000c'::uuid,'Advisor'),
  ('aaaaaaaa-0000-0000-0000-00000000000d'::uuid,'Team Manager'),('aaaaaaaa-0000-0000-0000-00000000000e'::uuid,'Team Manager')) u(id,rn)
JOIN rbac_roles r ON r.organization_id = 'aaaaaaaa-1111-0000-0000-000000000001' AND r.name = u.rn;
INSERT INTO organization_users (organization_id, user_id, role_id)
SELECT 'bbbbbbbb-1111-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-00000000000b', r.id FROM rbac_roles r WHERE r.organization_id='bbbbbbbb-1111-0000-0000-000000000002' AND r.name='Team Manager';
INSERT INTO debt_cases (id, user_id, organization_id, assigned_to, case_number, debtor_name) VALUES
  ('aaaaaaaa-2222-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000000a','aaaaaaaa-1111-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000000a','T-N1','Client One'),
  ('bbbbbbbb-2222-0000-0000-000000000009','bbbbbbbb-0000-0000-0000-00000000000b','bbbbbbbb-1111-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-00000000000b','T-N9','Client Nine');
INSERT INTO debt_customer_profiles (case_id, full_name, primary_email) VALUES ('aaaaaaaa-2222-0000-0000-000000000001','Client One','client1@test.invalid');
-- a message that reads like a complaint is flagged on the way in
INSERT INTO debtverge_communications (id, case_id, channel, direction, sender_name, sender_type, body, status)
VALUES ('aaaaaaaa-3333-0000-0000-000000000001','aaaaaaaa-2222-0000-0000-000000000001','email','inbound','Client One','client','I am not happy and want to make a complaint','delivered'),
       ('aaaaaaaa-3333-0000-0000-000000000002','aaaaaaaa-2222-0000-0000-000000000001','email','inbound','Client One','client','Thanks for the update','delivered');
DO $$ BEGIN
  IF NOT (SELECT possible_complaint FROM debtverge_communications WHERE id='aaaaaaaa-3333-0000-0000-000000000001') THEN RAISE EXCEPTION 'F1 not flagged'; END IF;
  IF (SELECT possible_complaint FROM debtverge_communications WHERE id='aaaaaaaa-3333-0000-0000-000000000002') THEN RAISE EXCEPTION 'F2 wrongly flagged'; END IF;
END $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}',true);
DO $$ DECLARE nid uuid; nid2 uuid; n int; t int; BEGIN
  -- notes
  nid := dv_add_note('aaaaaaaa-2222-0000-0000-000000000001','call','Spoke to client about budget', false, 'inbound','Client One','Agreed to review', current_date + 3, NULL, NULL, false);
  IF NOT EXISTS (SELECT 1 FROM case_tasks WHERE case_id='aaaaaaaa-2222-0000-0000-000000000001' AND due_date = current_date + 3 AND kind='call') THEN RAISE EXCEPTION 'N1 no follow-up task'; END IF;
  BEGIN PERFORM dv_add_note('aaaaaaaa-2222-0000-0000-000000000001','general','x', false, NULL,NULL,NULL,NULL,'payment', gen_random_uuid(), false); RAISE EXCEPTION 'N2'; EXCEPTION WHEN sqlstate '22023' THEN NULL; END;
  BEGIN PERFORM dv_add_note('bbbbbbbb-2222-0000-0000-000000000009','general','cross firm'); RAISE EXCEPTION 'N3'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM dv_edit_note(nid, 'Spoke to client about budget and priority debts');
  IF (SELECT count(*) FROM dv_note_history(nid)) < 1 THEN RAISE EXCEPTION 'N4 no history'; END IF;
  PERFORM dv_pin_note(nid, true);
  IF (SELECT count(*) FROM dv_search_notes('priority debts')) <> 1 THEN RAISE EXCEPTION 'N5 search'; END IF;
  BEGIN PERFORM dv_withdraw_note(nid, 'no'); RAISE EXCEPTION 'N6'; EXCEPTION WHEN sqlstate '22023' THEN NULL; END;
  PERFORM dv_withdraw_note(nid, 'Entered on the wrong case');
  IF NOT EXISTS (SELECT 1 FROM case_tasks WHERE case_id='aaaaaaaa-2222-0000-0000-000000000001' AND due_date = current_date + 3 AND status='cancelled') THEN RAISE EXCEPTION 'N7 task not cancelled'; END IF;
  -- other advisor in the same firm cannot read a case they are not on only if restricted; direct table access is closed
  BEGIN PERFORM 1 FROM case_notes; RAISE EXCEPTION 'N8 direct read'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN DELETE FROM case_notes; RAISE EXCEPTION 'N9'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claims','{"sub":"bbbbbbbb-0000-0000-0000-00000000000b","role":"authenticated"}',true);
DO $$ BEGIN
  IF (SELECT count(*) FROM dv_search_notes('priority debts')) <> 0 THEN RAISE EXCEPTION 'N10 other firm sees notes'; END IF;
END $$;

-- complaints: an adviser cannot manage them, a manager can
SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}',true);
DO $$ DECLARE cid uuid; r complaints; BEGIN
  BEGIN PERFORM dv_log_complaint('aaaaaaaa-2222-0000-0000-000000000001','Client One','x','service','email', current_date + 1, false); RAISE EXCEPTION 'C0 future'; EXCEPTION WHEN sqlstate '22023' THEN NULL; END;
  BEGIN PERFORM dv_log_complaint('aaaaaaaa-2222-0000-0000-000000000001','Client One','x','service','email', current_date, false, 'aaaaaaaa-3333-0000-0000-00000000ffff'); RAISE EXCEPTION 'C0b'; EXCEPTION WHEN sqlstate '22023' THEN NULL; END;
  cid := dv_log_complaint('aaaaaaaa-2222-0000-0000-000000000001','Client One','I am not happy','service','email', NULL, true, 'aaaaaaaa-3333-0000-0000-000000000001');
  SELECT * INTO r FROM complaints WHERE id = cid;
  IF r.priority <> 'high' THEN RAISE EXCEPTION 'C1 priority'; END IF;
  IF r.assigned_to = 'aaaaaaaa-0000-0000-0000-00000000000a' OR r.assigned_to IS NULL THEN RAISE EXCEPTION 'C2 handler'; END IF;
  IF (SELECT count(*) FROM case_tasks WHERE auto_key LIKE 'complaint:' || cid || ':%') <> 5 THEN RAISE EXCEPTION 'C3 tasks'; END IF;
  IF r.ack_outbox_id IS NULL THEN RAISE EXCEPTION 'C4 no acknowledgement queued'; END IF;
  IF (SELECT possible_complaint FROM debtverge_communications WHERE id='aaaaaaaa-3333-0000-0000-000000000001') THEN RAISE EXCEPTION 'C5 flag not cleared'; END IF;
  PERFORM set_config('t.cid', cid::text, true);
  BEGIN PERFORM dv_complaint_update(cid, 'acknowledged'); RAISE EXCEPTION 'C6'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM dv_complaints_mi(NULL, NULL); RAISE EXCEPTION 'C7'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-00000000000d","role":"authenticated"}',true);
DO $$ DECLARE cid uuid := current_setting('t.cid')::uuid; rid uuid; d jsonb; BEGIN
  BEGIN PERFORM dv_complaint_update(cid, 'closed'); RAISE EXCEPTION 'D1 closed too early'; EXCEPTION WHEN sqlstate '22023' THEN NULL; END;
  BEGIN PERFORM dv_complaint_update(cid, 'final_response', 'upheld'); RAISE EXCEPTION 'D2 no reasoning'; EXCEPTION WHEN sqlstate '22023' THEN NULL; END;
  BEGIN PERFORM dv_complaint_update(cid, 'final_response', 'upheld', NULL, NULL, 'We took too long to contact the creditor', 'delay', 'firm'); RAISE EXCEPTION 'D3 vulnerable adjustments'; EXCEPTION WHEN sqlstate '22023' THEN NULL; END;
  BEGIN PERFORM dv_complaint_update(cid, 'investigating', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'bbbbbbbb-0000-0000-0000-00000000000b'); RAISE EXCEPTION 'D4 other firm handler'; EXCEPTION WHEN sqlstate '22023' THEN NULL; END;
  PERFORM dv_complaint_update(cid, 'investigating');
  BEGIN PERFORM dv_complaint_update(cid, 'open'); RAISE EXCEPTION 'D5 backwards'; EXCEPTION WHEN sqlstate '22023' THEN NULL; END;
  BEGIN PERFORM dv_request_redress(cid, 50, 'goodwill'); RAISE EXCEPTION 'D6 no outcome yet'; EXCEPTION WHEN sqlstate '22023' THEN NULL; END;
  PERFORM dv_complaint_update(cid, 'final_response', 'upheld', 'Sent final response', NULL, 'We took too long to contact the creditor', 'delay', 'firm', 'FR-1', true);
  IF EXISTS (SELECT 1 FROM case_tasks WHERE auto_key LIKE 'complaint:' || cid || ':%' AND status = 'open') THEN RAISE EXCEPTION 'D7 tasks still open'; END IF;
  rid := dv_request_redress(cid, 50, 'Goodwill for the delay');
  BEGIN PERFORM dv_decide_redress(rid, true); RAISE EXCEPTION 'D8 self-approve'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('t.rid', rid::text, true);
END $$;

SELECT set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-00000000000e","role":"authenticated"}',true);
DO $$ DECLARE cid uuid := current_setting('t.cid')::uuid; rid uuid := current_setting('t.rid')::uuid; d jsonb; m jsonb; BEGIN
  BEGIN PERFORM dv_mark_redress_paid(rid); RAISE EXCEPTION 'E1 pay before approval'; EXCEPTION WHEN sqlstate '22023' THEN NULL; END;
  PERFORM dv_decide_redress(rid, true);
  IF (SELECT redress_amount FROM complaints WHERE id = cid) <> 50 THEN RAISE EXCEPTION 'E2 amount'; END IF;
  PERFORM dv_mark_redress_paid(rid);
  PERFORM dv_complaint_update(cid, 'closed');
  BEGIN PERFORM dv_complaint_update(cid, 'closed'); RAISE EXCEPTION 'E3 reclose'; EXCEPTION WHEN sqlstate '22023' THEN NULL; END;
  d := dv_complaint_detail(cid);
  IF jsonb_array_length(d->'timeline') < 5 THEN RAISE EXCEPTION 'E4 timeline short'; END IF;
  IF jsonb_array_length(d->'redress') <> 1 THEN RAISE EXCEPTION 'E5 redress'; END IF;
  m := dv_complaints_mi(NULL, NULL);
  IF (m->>'total')::int <> 1 OR (m->>'upheld')::int <> 1 THEN RAISE EXCEPTION 'E6 mi %', m; END IF;
END $$;

-- other firm: no access to the detail, MI is its own
SELECT set_config('request.jwt.claims','{"sub":"bbbbbbbb-0000-0000-0000-00000000000b","role":"authenticated"}',true);
DO $$ DECLARE cid uuid := current_setting('t.cid')::uuid; BEGIN
  BEGIN PERFORM dv_complaint_detail(cid); RAISE EXCEPTION 'G1'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM dv_complaint_update(cid, 'acknowledged'); RAISE EXCEPTION 'G2'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF (dv_complaints_mi(NULL, NULL)->>'total')::int <> 0 THEN RAISE EXCEPTION 'G3 mi leak'; END IF;
END $$;

-- anon cannot call any of the new functions
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM dv_add_note('aaaaaaaa-2222-0000-0000-000000000001','general','x'); RAISE EXCEPTION 'H1'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM dv_complaints_mi(NULL, NULL); RAISE EXCEPTION 'H2'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM dv_complaint_detail(gen_random_uuid()); RAISE EXCEPTION 'H3'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT 'NOTES AND COMPLAINTS TESTS PASSED';
ROLLBACK;
