-- Phone enterprise layer part 2: softphone, live-call controls, wrap-up, callbacks, timeline, telephony intake (service role).

CREATE OR REPLACE FUNCTION public.dv_call_user_mgr(p_org uuid, p_uid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM organization_users ou JOIN rbac_roles r ON r.id = ou.role_id
                  WHERE ou.organization_id = p_org AND ou.user_id = p_uid AND r.name IN ('Admin','Team Manager','Operations Manager'));
$$;
CREATE OR REPLACE FUNCTION public.dv_call_ev(p_call uuid, p_org uuid, p_event text, p_detail jsonb DEFAULT '{}'::jsonb) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  INSERT INTO dv_call_events (organization_id, call_id, event, detail, actor) VALUES (p_org, p_call, p_event, coalesce(p_detail, '{}'::jsonb), auth.uid());
$$;
CREATE OR REPLACE FUNCTION public.dv_call_acc(p_call uuid, p_org uuid, p_action text, p_detail jsonb DEFAULT '{}'::jsonb) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  INSERT INTO dv_call_access_log (organization_id, call_id, user_id, action, detail) VALUES (p_org, p_call, auth.uid(), p_action, coalesce(p_detail, '{}'::jsonb));
$$;

-- Load a call for the signed-in user. Read: anyone who may read the client. Write: the adviser on the call, a manager, or (unanswered) anyone who may edit the client.
CREATE OR REPLACE FUNCTION public.dv_call_load(p_call uuid, p_write boolean DEFAULT false) RETURNS dv_call_sessions LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE s dv_call_sessions;
BEGIN
  IF p_write THEN SELECT * INTO s FROM dv_call_sessions WHERE id = p_call FOR UPDATE; ELSE SELECT * INTO s FROM dv_call_sessions WHERE id = p_call; END IF;
  IF s.id IS NULL OR auth.uid() IS NULL OR NOT dv_is_org_member(s.organization_id) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF NOT dv_org_has_product(s.organization_id, 'voip') THEN RAISE EXCEPTION 'this is not part of your licence' USING ERRCODE = '42501'; END IF;
  IF s.case_id IS NOT NULL THEN
    IF NOT dv_can_read_case(s.case_id) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
    IF p_write AND NOT (s.adviser_id = auth.uid() OR dv_is_manager(s.organization_id) OR (s.adviser_id IS NULL AND dv_can_edit_case(s.case_id))) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  ELSIF NOT (s.adviser_id = auth.uid() OR dv_is_manager(s.organization_id)) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  RETURN s;
END $function$;

-- ---- settings and presence
CREATE OR REPLACE FUNCTION public.dv_telephony_get() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE o uuid := dv_my_org(); t dv_telephony_settings;
BEGIN
  IF o IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  PERFORM dv_call_org_ok(o, 'voip');
  INSERT INTO dv_telephony_settings (organization_id) VALUES (o) ON CONFLICT DO NOTHING;
  SELECT * INTO t FROM dv_telephony_settings WHERE organization_id = o;
  RETURN jsonb_build_object('record_calls', t.record_calls, 'recording_notice_text', t.recording_notice_text, 'retention_years', t.retention_years, 'transcription_enabled', t.transcription_enabled,
    'ai_analysis_enabled', t.ai_analysis_enabled, 'require_second_approver', t.require_second_approver, 'provider', t.provider, 'can_edit', dv_is_org_admin(o),
    'numbers', coalesce((SELECT jsonb_agg(jsonb_build_object('e164', n.e164, 'label', n.label) ORDER BY n.created_at) FROM org_phone_numbers n WHERE n.organization_id = o), '[]'::jsonb));
END $function$;
CREATE OR REPLACE FUNCTION public.dv_telephony_set(p_record boolean, p_notice text, p_years int, p_transcription boolean, p_ai boolean, p_second_approver boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE o uuid := dv_my_org();
BEGIN
  IF o IS NULL OR NOT dv_is_org_admin(o) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  PERFORM dv_call_org_ok(o, 'voip');
  IF p_notice IS NULL OR length(btrim(p_notice)) < 10 OR length(p_notice) > 500 THEN RAISE EXCEPTION 'write the recording notice (10 to 500 characters)' USING ERRCODE = '22023'; END IF;
  IF p_years IS NULL OR p_years < 3 OR p_years > 6 THEN RAISE EXCEPTION 'keep call records for 3 to 6 years' USING ERRCODE = '22023'; END IF;
  IF coalesce(p_ai,false) AND NOT coalesce(p_transcription,false) THEN RAISE EXCEPTION 'AI analysis needs transcription switched on' USING ERRCODE = '22023'; END IF;
  INSERT INTO dv_telephony_settings (organization_id, record_calls, recording_notice_text, retention_years, transcription_enabled, ai_analysis_enabled, require_second_approver, updated_by, updated_at)
  VALUES (o, coalesce(p_record,true), btrim(p_notice), p_years, coalesce(p_transcription,false), coalesce(p_ai,false), coalesce(p_second_approver,true), auth.uid(), now())
  ON CONFLICT (organization_id) DO UPDATE SET record_calls = EXCLUDED.record_calls, recording_notice_text = EXCLUDED.recording_notice_text, retention_years = EXCLUDED.retention_years,
    transcription_enabled = EXCLUDED.transcription_enabled, ai_analysis_enabled = EXCLUDED.ai_analysis_enabled, require_second_approver = EXCLUDED.require_second_approver, updated_by = auth.uid(), updated_at = now();
END $function$;
CREATE OR REPLACE FUNCTION public.dv_presence_set(p_status text, p_extension text DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE o uuid := dv_my_org();
BEGIN
  IF o IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  PERFORM dv_call_org_ok(o, 'voip');
  IF p_status NOT IN ('available','busy','break','offline') THEN RAISE EXCEPTION 'choose available, busy, break or offline' USING ERRCODE = '22023'; END IF;
  INSERT INTO dv_adviser_presence (organization_id, user_id, status, extension) VALUES (o, auth.uid(), p_status, left(nullif(btrim(coalesce(p_extension,'')),''),12))
  ON CONFLICT (organization_id, user_id) DO UPDATE SET status = CASE WHEN dv_adviser_presence.status = 'on_call' AND EXCLUDED.status <> 'offline' THEN 'on_call' ELSE EXCLUDED.status END,
    extension = coalesce(EXCLUDED.extension, dv_adviser_presence.extension), updated_at = now();
END $function$;
CREATE OR REPLACE FUNCTION public.dv_team_presence() RETURNS TABLE (user_id uuid, name text, role_name text, status text, extension text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE o uuid := dv_my_org();
BEGIN
  IF o IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  PERFORM dv_call_org_ok(o, 'voip');
  RETURN QUERY SELECT ou.user_id, coalesce(p.full_name, p.email)::text, r.name::text, coalesce(a.status, 'offline')::text, a.extension::text
    FROM organization_users ou JOIN rbac_roles r ON r.id = ou.role_id LEFT JOIN profiles p ON p.id = ou.user_id LEFT JOIN dv_adviser_presence a ON a.organization_id = ou.organization_id AND a.user_id = ou.user_id
   WHERE ou.organization_id = o ORDER BY coalesce(p.full_name, p.email);
END $function$;

-- ---- placing a call from the case screen
CREATE OR REPLACE FUNCTION public.dv_call_start(p_case uuid, p_phone text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE c debt_cases; sid uuid; ph text := regexp_replace(coalesce(p_phone,''), '[^0-9+]', '', 'g'); t dv_telephony_settings;
BEGIN
  SELECT * INTO c FROM debt_cases WHERE id = p_case AND deleted_at IS NULL;
  IF c.id IS NULL OR NOT dv_can_edit_case(p_case) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  PERFORM dv_call_org_ok(c.organization_id, 'voip');
  IF length(regexp_replace(ph, '\D', '', 'g')) < 6 THEN RAISE EXCEPTION 'enter a phone number' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM dv_call_sessions WHERE adviser_id = auth.uid() AND status IN ('ringing','answered','on_hold','transferred') AND started_at > now() - interval '6 hours') THEN
    RAISE EXCEPTION 'finish your current call first' USING ERRCODE = '22023'; END IF;
  INSERT INTO dv_telephony_settings (organization_id) VALUES (c.organization_id) ON CONFLICT DO NOTHING;
  SELECT * INTO t FROM dv_telephony_settings WHERE organization_id = c.organization_id;
  INSERT INTO dv_call_sessions (organization_id, case_id, direction, source, status, phone, adviser_id, started_at, outcome, created_by, customer_identified)
  VALUES (c.organization_id, p_case, 'outbound', 'softphone', 'ringing', left(ph, 40), auth.uid(), now(), 'pending', auth.uid(), true) RETURNING id INTO sid;
  PERFORM dv_call_ev(sid, c.organization_id, 'dialling', jsonb_build_object('source', 'softphone'));
  INSERT INTO dv_adviser_presence (organization_id, user_id, status) VALUES (c.organization_id, auth.uid(), 'on_call')
    ON CONFLICT (organization_id, user_id) DO UPDATE SET status = 'on_call', updated_at = now();
  RETURN jsonb_build_object('call_id', sid, 'record', t.record_calls, 'notice', t.recording_notice_text, 'phone', ph);
END $function$;

CREATE OR REPLACE FUNCTION public.dv_call_state(p_call uuid, p_event text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE s dv_call_sessions;
BEGIN
  s := dv_call_load(p_call, true);
  IF p_event NOT IN ('hold','resume','mute','unmute') THEN RAISE EXCEPTION 'unknown call control' USING ERRCODE = '22023'; END IF;
  IF s.status NOT IN ('answered','on_hold','transferred') THEN RAISE EXCEPTION 'the call is not connected' USING ERRCODE = '22023'; END IF;
  IF p_event = 'hold' THEN UPDATE dv_call_sessions SET is_on_hold = true, status = 'on_hold' WHERE id = s.id;
  ELSIF p_event = 'resume' THEN UPDATE dv_call_sessions SET is_on_hold = false, status = 'answered' WHERE id = s.id; END IF;
  PERFORM dv_call_ev(s.id, s.organization_id, p_event);
END $function$;

CREATE OR REPLACE FUNCTION public.dv_call_recording_event(p_call uuid, p_event text, p_reason text DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE s dv_call_sessions; r text := nullif(btrim(coalesce(p_reason,'')),''); last_pause timestamptz;
BEGIN
  s := dv_call_load(p_call, true);
  IF s.status NOT IN ('answered','on_hold','transferred') THEN RAISE EXCEPTION 'the call is not connected' USING ERRCODE = '22023'; END IF;
  IF p_event = 'paused' THEN
    IF s.recording_status <> 'recording' THEN RAISE EXCEPTION 'this call is not being recorded' USING ERRCODE = '22023'; END IF;
    IF r IS NULL OR length(r) < 5 THEN RAISE EXCEPTION 'say why the recording is being paused (for example, taking card details)' USING ERRCODE = '22023'; END IF;
    UPDATE dv_call_sessions SET recording_status = 'paused' WHERE id = s.id;
    INSERT INTO dv_call_recording_events (organization_id, call_id, event, reason, user_id) VALUES (s.organization_id, s.id, 'paused', left(r, 300), auth.uid());
    PERFORM dv_call_acc(s.id, s.organization_id, 'recording_paused', jsonb_build_object('reason', left(r, 300)));
  ELSIF p_event = 'resumed' THEN
    IF s.recording_status <> 'paused' THEN RAISE EXCEPTION 'the recording is not paused' USING ERRCODE = '22023'; END IF;
    SELECT at INTO last_pause FROM dv_call_recording_events WHERE call_id = s.id AND event = 'paused' ORDER BY at DESC LIMIT 1;
    UPDATE dv_call_sessions SET recording_status = 'recording' WHERE id = s.id;
    INSERT INTO dv_call_recording_events (organization_id, call_id, event, reason, user_id, duration_seconds) VALUES (s.organization_id, s.id, 'resumed', left(r, 300), auth.uid(), greatest(0, extract(epoch FROM now() - last_pause))::int);
    PERFORM dv_call_acc(s.id, s.organization_id, 'recording_resumed');
  ELSE RAISE EXCEPTION 'unknown recording action' USING ERRCODE = '22023'; END IF;
  PERFORM dv_call_ev(s.id, s.organization_id, 'recording_' || p_event, jsonb_build_object('reason', left(r, 300)));
END $function$;

CREATE OR REPLACE FUNCTION public.dv_call_transfer(p_call uuid, p_kind text, p_target text, p_target_user uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE s dv_call_sessions; tg text := nullif(btrim(coalesce(p_target,'')),''); pres text; tname text;
BEGIN
  s := dv_call_load(p_call, true);
  IF p_kind NOT IN ('adviser','team','queue','supervisor','cold','warm') THEN RAISE EXCEPTION 'choose a transfer type' USING ERRCODE = '22023'; END IF;
  IF s.status NOT IN ('answered','on_hold') THEN RAISE EXCEPTION 'the call is not connected' USING ERRCODE = '22023'; END IF;
  IF p_target_user IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM organization_users WHERE organization_id = s.organization_id AND user_id = p_target_user) OR p_target_user = auth.uid() THEN RAISE EXCEPTION 'choose a colleague' USING ERRCODE = '22023'; END IF;
    SELECT status INTO pres FROM dv_adviser_presence WHERE organization_id = s.organization_id AND user_id = p_target_user;
    IF coalesce(pres,'offline') NOT IN ('available','busy') THEN RAISE EXCEPTION 'that colleague is not available' USING ERRCODE = '22023'; END IF;
    SELECT coalesce(full_name, email) INTO tname FROM profiles WHERE id = p_target_user;
    tg := coalesce(tg, tname);
  END IF;
  IF tg IS NULL THEN RAISE EXCEPTION 'choose who to transfer to' USING ERRCODE = '22023'; END IF;
  UPDATE dv_call_sessions SET transfer_kind = p_kind, transfer_target = left(tg, 120), transfer_status = 'initiated' WHERE id = s.id;
  PERFORM dv_call_ev(s.id, s.organization_id, 'transfer_started', jsonb_build_object('kind', p_kind, 'target', left(tg, 120)));
  PERFORM dv_call_acc(s.id, s.organization_id, 'call_transferred', jsonb_build_object('kind', p_kind, 'target', left(tg, 120)));
  RETURN jsonb_build_object('kind', p_kind, 'target', tg, 'target_user', p_target_user);
END $function$;
CREATE OR REPLACE FUNCTION public.dv_call_transfer_result(p_call uuid, p_status text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE s dv_call_sessions;
BEGIN
  s := dv_call_load(p_call, true);
  IF p_status NOT IN ('completed','failed') OR s.transfer_status IS DISTINCT FROM 'initiated' THEN RAISE EXCEPTION 'no transfer in progress' USING ERRCODE = '22023'; END IF;
  UPDATE dv_call_sessions SET transfer_status = p_status, status = CASE WHEN p_status = 'completed' THEN 'transferred' ELSE status END WHERE id = s.id;
  PERFORM dv_call_ev(s.id, s.organization_id, 'transfer_' || p_status, jsonb_build_object('target', s.transfer_target));
END $function$;

CREATE OR REPLACE FUNCTION public.dv_call_participant_add(p_call uuid, p_name text, p_role text, p_type text, p_user uuid DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE s dv_call_sessions; pid uuid; nm text := nullif(btrim(coalesce(p_name,'')),'');
BEGIN
  s := dv_call_load(p_call, true);
  IF s.status NOT IN ('answered','on_hold') THEN RAISE EXCEPTION 'the call is not connected' USING ERRCODE = '22023'; END IF;
  IF nm IS NULL OR p_type NOT IN ('adviser','supervisor','specialist','external') THEN RAISE EXCEPTION 'enter the name and type of the person joining' USING ERRCODE = '22023'; END IF;
  IF p_user IS NOT NULL AND NOT EXISTS (SELECT 1 FROM organization_users WHERE organization_id = s.organization_id AND user_id = p_user) THEN RAISE EXCEPTION 'choose a colleague' USING ERRCODE = '22023'; END IF;
  INSERT INTO dv_call_participants (organization_id, call_id, name, role, ptype, user_id, added_by) VALUES (s.organization_id, s.id, left(nm, 80), left(nullif(btrim(coalesce(p_role,'')),''),80), p_type, p_user, auth.uid()) RETURNING id INTO pid;
  PERFORM dv_call_ev(s.id, s.organization_id, 'participant_joined', jsonb_build_object('name', left(nm, 80), 'type', p_type));
  RETURN pid;
END $function$;
CREATE OR REPLACE FUNCTION public.dv_call_participant_remove(p_participant uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE pt dv_call_participants; s dv_call_sessions;
BEGIN
  SELECT * INTO pt FROM dv_call_participants WHERE id = p_participant AND left_at IS NULL;
  IF pt.id IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  s := dv_call_load(pt.call_id, true);
  UPDATE dv_call_participants SET left_at = now() WHERE id = p_participant;
  PERFORM dv_call_ev(s.id, s.organization_id, 'participant_left', jsonb_build_object('name', pt.name));
END $function$;

CREATE OR REPLACE FUNCTION public.dv_call_note_add(p_call uuid, p_text text, p_tag text DEFAULT 'general', p_follow_up boolean DEFAULT false, p_due date DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE s dv_call_sessions; nid uuid; tx text := nullif(btrim(coalesce(p_text,'')),''); tid uuid;
BEGIN
  s := dv_call_load(p_call, true);
  IF tx IS NULL OR length(tx) > 2000 THEN RAISE EXCEPTION 'write the note (up to 2000 characters)' USING ERRCODE = '22023'; END IF;
  IF p_tag NOT IN ('customer_request','compliance_point','vulnerability_indicator','adviser_action','general') THEN RAISE EXCEPTION 'choose a note type' USING ERRCODE = '22023'; END IF;
  IF p_due IS NOT NULL AND (p_due < current_date OR p_due > current_date + 365) THEN RAISE EXCEPTION 'check the follow-up date' USING ERRCODE = '22023'; END IF;
  INSERT INTO dv_call_notes (organization_id, call_id, case_id, note_text, tag, is_follow_up, follow_up_due, created_by)
  VALUES (s.organization_id, s.id, s.case_id, tx, p_tag, coalesce(p_follow_up,false), CASE WHEN coalesce(p_follow_up,false) THEN coalesce(p_due, current_date + 1) END, auth.uid()) RETURNING id INTO nid;
  IF coalesce(p_follow_up,false) AND s.case_id IS NOT NULL THEN
    INSERT INTO case_tasks (case_id, organization_id, title, kind, due_date, status, assigned_to, source, created_by)
    VALUES (s.case_id, s.organization_id, left('Call follow-up: ' || tx, 150), 'call', coalesce(p_due, current_date + 1), 'open', coalesce((SELECT assigned_to FROM debt_cases WHERE id = s.case_id), auth.uid()), 'manual', auth.uid());
  END IF;
  IF p_tag = 'vulnerability_indicator' THEN UPDATE dv_call_sessions SET vulnerability_flag = true WHERE id = s.id; END IF;
  PERFORM dv_call_acc(s.id, s.organization_id, 'notes_added', jsonb_build_object('tag', p_tag));
  RETURN nid;
END $function$;
CREATE OR REPLACE FUNCTION public.dv_call_note_complete(p_note uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE n dv_call_notes; s dv_call_sessions;
BEGIN
  SELECT * INTO n FROM dv_call_notes WHERE id = p_note;
  IF n.id IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  s := dv_call_load(n.call_id, true);
  UPDATE dv_call_notes SET is_completed = true, completed_at = coalesce(completed_at, now()) WHERE id = p_note AND is_follow_up;
END $function$;

-- ---- unidentified callers
CREATE OR REPLACE FUNCTION public.dv_call_attach_case(p_call uuid, p_case uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE s dv_call_sessions;
BEGIN
  s := dv_call_load(p_call, true);
  IF s.case_id IS NOT NULL THEN RAISE EXCEPTION 'this call is already filed to a client' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM debt_cases WHERE id = p_case AND organization_id = s.organization_id AND deleted_at IS NULL) OR NOT dv_can_edit_case(p_case) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  UPDATE dv_call_sessions SET case_id = p_case, customer_identified = true WHERE id = s.id;
  UPDATE dv_call_notes SET case_id = p_case WHERE call_id = s.id;
  UPDATE dv_call_transcripts SET case_id = p_case WHERE call_id = s.id AND case_id IS NULL;
  UPDATE dv_call_risk_indicators SET case_id = p_case WHERE call_id = s.id;
  UPDATE dv_call_reviews SET case_id = p_case WHERE call_id = s.id;
  PERFORM dv_call_ev(s.id, s.organization_id, 'filed_to_client', '{}'::jsonb);
  PERFORM dv_call_acc(s.id, s.organization_id, 'call_attached');
END $function$;
CREATE OR REPLACE FUNCTION public.dv_call_dismiss(p_call uuid, p_reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE s dv_call_sessions; r text := nullif(btrim(coalesce(p_reason,'')),'');
BEGIN
  s := dv_call_load(p_call, true);
  IF s.case_id IS NOT NULL OR NOT dv_is_manager(s.organization_id) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF r IS NULL OR length(r) < 3 THEN RAISE EXCEPTION 'give a short reason (wrong number, spam...)' USING ERRCODE = '22023'; END IF;
  IF s.status IN ('ringing','answered','on_hold','transferred') THEN RAISE EXCEPTION 'the call is still live' USING ERRCODE = '22023'; END IF;
  UPDATE dv_call_sessions SET outcome = 'wrong_number', summary = left(r, 2000) WHERE id = s.id AND outcome IN ('pending','no_answer','voicemail_left');
  PERFORM dv_call_ev(s.id, s.organization_id, 'dismissed', jsonb_build_object('reason', left(r, 200)));
END $function$;
CREATE OR REPLACE FUNCTION public.dv_call_unmatched() RETURNS TABLE (id uuid, direction text, status text, phone text, to_number text, started_at timestamptz, duration_seconds int, outcome text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE o uuid := dv_my_org();
BEGIN
  IF o IS NULL OR NOT dv_is_manager(o) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  PERFORM dv_call_org_ok(o, 'voip');
  RETURN QUERY SELECT s.id, s.direction, s.status, s.phone, s.to_number, s.started_at, s.duration_seconds, s.outcome FROM dv_call_sessions s
   WHERE s.organization_id = o AND s.case_id IS NULL AND s.outcome IN ('pending','no_answer','voicemail_left') AND s.status NOT IN ('ringing','answered','on_hold','transferred') ORDER BY s.started_at DESC LIMIT 200;
END $function$;

-- ---- wrap-up after the call
CREATE OR REPLACE FUNCTION public.dv_call_finish(p_call uuid, p_outcome text, p_summary text, p_notice boolean DEFAULT NULL, p_vulnerability boolean DEFAULT false, p_possible_complaint boolean DEFAULT false, p_follow_up date DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE s dv_call_sessions; sm text := nullif(btrim(coalesce(p_summary,'')),''); st text; nid uuid; c debt_cases; dur int;
BEGIN
  s := dv_call_load(p_call, true);
  IF s.outcome <> 'pending' THEN RAISE EXCEPTION 'this call has already been wrapped up' USING ERRCODE = '22023'; END IF;
  IF p_outcome NOT IN ('spoke_to_client','spoke_to_third_party','no_answer','voicemail_left','wrong_number','call_back_requested','payment_promised','other') THEN RAISE EXCEPTION 'choose what happened on the call' USING ERRCODE = '22023'; END IF;
  IF s.case_id IS NULL AND p_outcome <> 'wrong_number' THEN RAISE EXCEPTION 'file the call to a client first' USING ERRCODE = '22023'; END IF;
  IF p_outcome IN ('spoke_to_client','spoke_to_third_party','call_back_requested','payment_promised') AND (sm IS NULL OR length(sm) < 10) THEN RAISE EXCEPTION 'write a short summary of the call (at least 10 characters)' USING ERRCODE = '22023'; END IF;
  IF p_outcome = 'spoke_to_client' AND p_notice IS NULL THEN RAISE EXCEPTION 'say whether the recording notice was given' USING ERRCODE = '22023'; END IF;
  st := CASE WHEN s.status IN ('ringing','answered','on_hold','transferred') THEN CASE p_outcome WHEN 'no_answer' THEN 'missed' WHEN 'voicemail_left' THEN 'voicemail' ELSE 'completed' END ELSE s.status END;
  dur := CASE WHEN s.duration_seconds > 0 THEN s.duration_seconds WHEN s.answered_at IS NOT NULL THEN greatest(0, extract(epoch FROM now() - s.answered_at))::int ELSE 0 END;
  IF s.case_id IS NOT NULL THEN
    nid := dv_add_note(s.case_id, 'call', coalesce(sm, 'Call: ' || replace(p_outcome, '_', ' ')), false, s.direction, NULL, replace(p_outcome, '_', ' '), p_follow_up);
    SELECT * INTO c FROM debt_cases WHERE id = s.case_id;
  END IF;
  UPDATE dv_call_sessions SET outcome = p_outcome, summary = sm, status = st, ended_at = coalesce(ended_at, now()), duration_seconds = dur,
         recording_notice_given = coalesce(p_notice, recording_notice_given), vulnerability_flag = vulnerability_flag OR coalesce(p_vulnerability,false),
         possible_complaint = coalesce(p_possible_complaint,false), note_id = nid, adviser_id = coalesce(adviser_id, auth.uid()), is_on_hold = false WHERE id = s.id;
  IF coalesce(p_possible_complaint,false) AND s.case_id IS NOT NULL THEN
    INSERT INTO case_tasks (case_id, organization_id, title, kind, due_date, status, assigned_to, source, created_by)
    VALUES (s.case_id, s.organization_id, 'Possible complaint raised on a call: log it or record why not', 'call', current_date + 1, 'open', coalesce(c.assigned_to, auth.uid()), 'manual', auth.uid());
  END IF;
  IF st = 'missed' AND s.direction = 'inbound' AND s.case_id IS NOT NULL THEN
    INSERT INTO case_tasks (case_id, organization_id, title, kind, due_date, status, assigned_to, source, created_by)
    SELECT s.case_id, s.organization_id, 'Return the missed call', 'call', current_date, 'open', coalesce(c.assigned_to, auth.uid()), 'manual', auth.uid()
     WHERE NOT EXISTS (SELECT 1 FROM case_tasks WHERE case_id = s.case_id AND title = 'Return the missed call' AND status = 'open');
  END IF;
  PERFORM dv_call_ev(s.id, s.organization_id, 'wrapped_up', jsonb_build_object('outcome', p_outcome));
  UPDATE dv_adviser_presence SET status = 'available', updated_at = now() WHERE organization_id = s.organization_id AND user_id = auth.uid() AND status = 'on_call'
     AND NOT EXISTS (SELECT 1 FROM dv_call_sessions x WHERE x.adviser_id = auth.uid() AND x.id <> s.id AND x.status IN ('ringing','answered','on_hold','transferred'));
END $function$;

CREATE OR REPLACE FUNCTION public.dv_my_calls_pending() RETURNS TABLE (id uuid, case_id uuid, case_number text, debtor_name text, direction text, status text, phone text, started_at timestamptz, duration_seconds int)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE o uuid := dv_my_org();
BEGIN
  IF o IS NULL OR NOT dv_org_has_product(o, 'voip') THEN RETURN; END IF;
  RETURN QUERY SELECT s.id, s.case_id, c.case_number, c.debtor_name, s.direction, s.status, s.phone, s.started_at, s.duration_seconds
    FROM dv_call_sessions s LEFT JOIN debt_cases c ON c.id = s.case_id
   WHERE s.organization_id = o AND s.adviser_id = auth.uid() AND s.outcome = 'pending' AND (s.case_id IS NULL OR dv_can_read_case(s.case_id)) ORDER BY s.started_at DESC LIMIT 20;
END $function$;

CREATE OR REPLACE FUNCTION public.dv_call_list(p_case uuid)
RETURNS TABLE (id uuid, direction text, status text, phone text, started_at timestamptz, duration_seconds int, outcome text, summary text, adviser_name text, recording_status text,
  recording_notice_given boolean, vulnerability_flag boolean, possible_complaint boolean, source text, draft_count int, reviewed boolean, has_recording boolean, has_transcript boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE org uuid;
BEGIN
  SELECT organization_id INTO org FROM debt_cases WHERE debt_cases.id = p_case AND deleted_at IS NULL;
  IF org IS NULL OR NOT dv_can_read_case(p_case) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  PERFORM dv_call_org_ok(org, 'voip');
  RETURN QUERY
    SELECT s.id, s.direction, s.status, s.phone, s.started_at, s.duration_seconds, s.outcome, s.summary, coalesce(p.full_name, p.email)::text, s.recording_status, s.recording_notice_given,
           s.vulnerability_flag, s.possible_complaint, s.source, (SELECT count(*)::int FROM dv_call_ai_drafts d WHERE d.call_id = s.id AND d.status = 'draft'),
           EXISTS (SELECT 1 FROM dv_call_reviews r WHERE r.call_id = s.id AND r.status = 'approved'), s.recording_ref IS NOT NULL, EXISTS (SELECT 1 FROM dv_call_transcripts t WHERE t.call_id = s.id)
      FROM dv_call_sessions s LEFT JOIN profiles p ON p.id = s.adviser_id WHERE s.case_id = p_case ORDER BY s.started_at DESC LIMIT 200;
END $function$;

-- ---- callbacks
CREATE OR REPLACE FUNCTION public.dv_call_callback_schedule(p_case uuid, p_phone text, p_at timestamptz, p_priority int DEFAULT 3, p_notes text DEFAULT NULL, p_call uuid DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE c debt_cases; cid uuid; tid uuid;
BEGIN
  SELECT * INTO c FROM debt_cases WHERE id = p_case AND deleted_at IS NULL;
  IF c.id IS NULL OR NOT dv_can_edit_case(p_case) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  PERFORM dv_call_org_ok(c.organization_id, 'voip');
  IF p_at IS NULL OR p_at < now() - interval '5 minutes' OR p_at > now() + interval '90 days' THEN RAISE EXCEPTION 'choose a time in the next 90 days' USING ERRCODE = '22023'; END IF;
  IF length(regexp_replace(coalesce(p_phone,''), '\D', '', 'g')) < 6 THEN RAISE EXCEPTION 'enter a phone number' USING ERRCODE = '22023'; END IF;
  IF p_priority IS NULL OR p_priority NOT BETWEEN 1 AND 5 THEN RAISE EXCEPTION 'priority is 1 (urgent) to 5' USING ERRCODE = '22023'; END IF;
  IF p_call IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dv_call_sessions WHERE id = p_call AND case_id = p_case) THEN RAISE EXCEPTION 'that call is not on this client' USING ERRCODE = '22023'; END IF;
  INSERT INTO case_tasks (case_id, organization_id, title, kind, due_date, status, assigned_to, source, created_by)
  VALUES (p_case, c.organization_id, 'Call the client back at ' || to_char(p_at AT TIME ZONE 'Europe/London', 'DD Mon HH24:MI'), 'call', (p_at AT TIME ZONE 'Europe/London')::date, 'open', coalesce(c.assigned_to, auth.uid()), 'manual', auth.uid()) RETURNING id INTO tid;
  INSERT INTO dv_call_callbacks (organization_id, case_id, call_id, adviser_id, phone, customer_name, scheduled_at, priority, notes, task_id, created_by)
  VALUES (c.organization_id, p_case, p_call, coalesce(c.assigned_to, auth.uid()), left(btrim(p_phone), 40), left(c.debtor_name, 120), p_at, p_priority, left(nullif(btrim(coalesce(p_notes,'')),''),1000), tid, auth.uid()) RETURNING id INTO cid;
  RETURN cid;
END $function$;
CREATE OR REPLACE FUNCTION public.dv_call_callbacks(p_case uuid DEFAULT NULL)
RETURNS TABLE (id uuid, case_id uuid, case_number text, customer_name text, phone text, scheduled_at timestamptz, status text, priority int, notes text, adviser_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE o uuid := dv_my_org();
BEGIN
  IF o IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  PERFORM dv_call_org_ok(o, 'voip');
  IF p_case IS NOT NULL AND NOT dv_can_read_case(p_case) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  RETURN QUERY SELECT b.id, b.case_id, c.case_number, b.customer_name, b.phone, b.scheduled_at, b.status, b.priority, b.notes, coalesce(p.full_name, p.email)::text
    FROM dv_call_callbacks b JOIN debt_cases c ON c.id = b.case_id LEFT JOIN profiles p ON p.id = b.adviser_id
   WHERE b.organization_id = o AND c.deleted_at IS NULL AND dv_can_read_case(b.case_id)
     AND ((p_case IS NOT NULL AND b.case_id = p_case) OR (p_case IS NULL AND b.status IN ('pending','in_progress') AND (b.adviser_id = auth.uid() OR dv_is_manager(o))))
   ORDER BY (b.status IN ('pending','in_progress')) DESC, b.scheduled_at LIMIT 200;
END $function$;
CREATE OR REPLACE FUNCTION public.dv_call_callback_update(p_id uuid, p_status text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE b dv_call_callbacks;
BEGIN
  SELECT * INTO b FROM dv_call_callbacks WHERE id = p_id FOR UPDATE;
  IF b.id IS NULL OR NOT dv_can_edit_case(b.case_id) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  PERFORM dv_call_org_ok(b.organization_id, 'voip');
  IF p_status NOT IN ('in_progress','completed','cancelled','missed') OR b.status IN ('completed','cancelled') THEN RAISE EXCEPTION 'cannot change this callback' USING ERRCODE = '22023'; END IF;
  UPDATE dv_call_callbacks SET status = p_status, completed_at = CASE WHEN p_status IN ('completed','cancelled','missed') THEN now() END WHERE id = p_id;
  IF p_status IN ('completed','cancelled') AND b.task_id IS NOT NULL THEN
    UPDATE case_tasks SET status = CASE WHEN p_status = 'completed' THEN 'done' ELSE 'cancelled' END, completed_by = auth.uid(), completed_at = now() WHERE id = b.task_id AND status = 'open';
  END IF;
END $function$;

-- ---- the client's contact timeline: calls, call notes, recording pauses, callbacks, messages, case notes
CREATE OR REPLACE FUNCTION public.dv_call_timeline(p_case uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE o uuid; res jsonb;
BEGIN
  SELECT organization_id INTO o FROM debt_cases WHERE id = p_case AND deleted_at IS NULL;
  IF o IS NULL OR NOT dv_can_read_case(p_case) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  PERFORM dv_call_org_ok(o, 'voip');
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.at DESC), '[]'::jsonb) INTO res FROM (
    SELECT * FROM (
      SELECT 'call'::text AS kind, (initcap(s.direction) || ' call · ' || replace(s.outcome, '_', ' ')) AS title, left(coalesce(s.summary,''), 200) AS body, s.started_at AS at, coalesce(p.full_name, p.email) AS who, s.id AS call_id
        FROM dv_call_sessions s LEFT JOIN profiles p ON p.id = s.adviser_id WHERE s.case_id = p_case
      UNION ALL SELECT 'note', 'Call note · ' || replace(n.tag, '_', ' '), left(n.note_text, 200), n.created_at, coalesce(p.full_name, p.email), n.call_id
        FROM dv_call_notes n LEFT JOIN profiles p ON p.id = n.created_by WHERE n.case_id = p_case
      UNION ALL SELECT 'recording', 'Recording ' || e.event, coalesce(e.reason,''), e.at, coalesce(p.full_name, p.email), e.call_id
        FROM dv_call_recording_events e JOIN dv_call_sessions s ON s.id = e.call_id LEFT JOIN profiles p ON p.id = e.user_id WHERE s.case_id = p_case
      UNION ALL SELECT 'callback', 'Callback ' || b.status, left(coalesce(b.notes,''), 200), b.scheduled_at, coalesce(p.full_name, p.email), b.call_id
        FROM dv_call_callbacks b LEFT JOIN profiles p ON p.id = b.adviser_id WHERE b.case_id = p_case
      UNION ALL SELECT 'message', initcap(m.channel) || ' ' || m.direction, left(coalesce(nullif(m.subject,''), m.body, ''), 200), m.created_at, m.sender_name, NULL::uuid
        FROM debtverge_communications m WHERE m.case_id = p_case AND m.deleted_at IS NULL
      UNION ALL SELECT 'case_note', 'Note · ' || replace(cn.kind, '_', ' '), left(cn.body, 200), cn.created_at, coalesce(p.full_name, p.email), NULL::uuid
        FROM case_notes cn LEFT JOIN profiles p ON p.id = cn.created_by WHERE cn.case_id = p_case AND cn.withdrawn_at IS NULL AND cn.kind <> 'call'
    ) u ORDER BY u.at DESC LIMIT 150) x;
  RETURN res;
END $function$;

-- ---- telephony intake: service role only. Providers call this through the telephony-webhook function after it has verified their signature.
CREATE OR REPLACE FUNCTION public.dv_call_ingest(p_event text, p_payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE sid text := nullif(p_payload->>'call_sid',''); s dv_call_sessions; o uuid; t dv_telephony_settings; v_to text; d text; n int; v_case uuid; targets jsonb; new_id uuid; ans uuid; st text; ns text; dur int; assignee uuid;
BEGIN
  IF sid IS NULL THEN RAISE EXCEPTION 'call_sid required' USING ERRCODE = '22023'; END IF;
  IF p_event = 'incoming' THEN
    SELECT * INTO s FROM dv_call_sessions WHERE provider_call_id = sid;
    v_to := '+' || regexp_replace(coalesce(p_payload->>'to',''), '\D', '', 'g');
    IF s.id IS NULL THEN
      SELECT organization_id INTO o FROM org_phone_numbers WHERE e164 = v_to;
      IF o IS NULL THEN RETURN jsonb_build_object('status', 'unknown_number'); END IF;
      IF NOT dv_org_has_product(o, 'voip') THEN RETURN jsonb_build_object('status', 'not_licensed'); END IF;
      d := right(regexp_replace(coalesce(p_payload->>'from',''), '\D', '', 'g'), 10);
      n := 0;
      IF length(d) >= 9 THEN
        SELECT count(DISTINCT p.case_id), min(p.case_id::text)::uuid INTO n, v_case FROM debt_customer_profiles p JOIN debt_cases c ON c.id = p.case_id AND c.deleted_at IS NULL AND c.organization_id = o
         WHERE right(regexp_replace(coalesce(p.mobile_phone,''), '\D','','g'), 10) = d OR right(regexp_replace(coalesce(p.landline_phone,''), '\D','','g'), 10) = d OR right(regexp_replace(coalesce(p.work_phone,''), '\D','','g'), 10) = d;
      END IF;
      IF n <> 1 THEN v_case := NULL; END IF;
      SELECT assigned_to INTO assignee FROM debt_cases WHERE id = v_case;
      INSERT INTO dv_call_sessions (organization_id, case_id, direction, source, status, phone, to_number, caller_name, adviser_id, started_at, outcome, provider_call_id, customer_identified)
      VALUES (o, v_case, 'inbound', 'provider', 'ringing', left(p_payload->>'from', 40), v_to, left(p_payload->>'caller_name', 120), NULL, now(), 'pending', sid, v_case IS NOT NULL) RETURNING * INTO s;
      INSERT INTO dv_call_events (organization_id, call_id, event, detail) VALUES (o, s.id, 'ringing', jsonb_build_object('identified', v_case IS NOT NULL));
    ELSE
      o := s.organization_id; SELECT assigned_to INTO assignee FROM debt_cases WHERE id = s.case_id;
    END IF;
    INSERT INTO dv_telephony_settings (organization_id) VALUES (o) ON CONFLICT DO NOTHING;
    SELECT * INTO t FROM dv_telephony_settings WHERE organization_id = o;
    SELECT coalesce(jsonb_agg(x.user_id), '[]'::jsonb) INTO targets FROM (SELECT a.user_id FROM dv_adviser_presence a WHERE a.organization_id = o AND a.status = 'available'
        ORDER BY (a.user_id = assignee) DESC NULLS LAST, a.updated_at LIMIT 10) x;
    RETURN jsonb_build_object('status', 'ok', 'call_id', s.id, 'organization_id', o, 'record', t.record_calls, 'notice', t.recording_notice_text, 'targets', targets, 'identified', s.case_id IS NOT NULL);
  END IF;

  IF p_event = 'outbound_leg' THEN
    SELECT * INTO s FROM dv_call_sessions WHERE id = nullif(p_payload->>'session_id','')::uuid AND source = 'softphone' FOR UPDATE;
    IF s.id IS NULL OR (s.provider_call_id IS NOT NULL AND s.provider_call_id <> sid) THEN RETURN jsonb_build_object('status', 'unknown_call'); END IF;
    UPDATE dv_call_sessions SET provider_call_id = sid WHERE id = s.id;
    SELECT * INTO t FROM dv_telephony_settings WHERE organization_id = s.organization_id;
    RETURN jsonb_build_object('status', 'ok', 'call_id', s.id, 'organization_id', s.organization_id, 'record', coalesce(t.record_calls, true), 'phone', s.phone);
  END IF;

  SELECT * INTO s FROM dv_call_sessions WHERE provider_call_id = sid FOR UPDATE;
  IF s.id IS NULL THEN RETURN jsonb_build_object('status', 'unknown_call'); END IF;
  o := s.organization_id;
  SELECT * INTO t FROM dv_telephony_settings WHERE organization_id = o;

  IF p_event = 'answered' THEN
    IF s.status IN ('completed','missed','voicemail','failed') THEN RETURN jsonb_build_object('status', 'ignored'); END IF;
    ans := nullif(p_payload->>'answered_by','')::uuid;
    IF ans IS NOT NULL AND NOT EXISTS (SELECT 1 FROM organization_users WHERE organization_id = o AND user_id = ans) THEN ans := NULL; END IF;
    UPDATE dv_call_sessions SET status = 'answered', answered_at = coalesce(answered_at, now()), adviser_id = coalesce(ans, adviser_id),
           recording_status = CASE WHEN coalesce(t.record_calls, true) AND recording_status = 'none' THEN 'recording' ELSE recording_status END WHERE id = s.id;
    IF coalesce(ans, s.adviser_id) IS NOT NULL THEN
      INSERT INTO dv_adviser_presence (organization_id, user_id, status) VALUES (o, coalesce(ans, s.adviser_id), 'on_call') ON CONFLICT (organization_id, user_id) DO UPDATE SET status = 'on_call', updated_at = now();
    END IF;
    INSERT INTO dv_call_events (organization_id, call_id, event, detail) VALUES (o, s.id, 'answered', '{}'::jsonb);
    RETURN jsonb_build_object('status', 'ok', 'call_id', s.id);
  END IF;

  IF p_event = 'status' THEN
    IF s.status IN ('completed','missed','voicemail','failed') THEN RETURN jsonb_build_object('status', 'ignored'); END IF;
    st := lower(coalesce(p_payload->>'status',''));
    ns := CASE WHEN coalesce((p_payload->>'voicemail')::boolean, false) THEN 'voicemail' WHEN st = 'completed' AND s.answered_at IS NOT NULL THEN 'completed'
               WHEN st IN ('completed','busy','no-answer','canceled') THEN 'missed' ELSE 'failed' END;
    dur := coalesce(nullif(p_payload->>'duration','')::int, CASE WHEN s.answered_at IS NOT NULL THEN greatest(0, extract(epoch FROM now() - s.answered_at))::int ELSE 0 END);
    IF ns = 'missed' THEN dur := 0; END IF;
    UPDATE dv_call_sessions SET status = ns, ended_at = now(), duration_seconds = least(dur, 86400), is_on_hold = false,
           outcome = CASE ns WHEN 'missed' THEN 'no_answer' WHEN 'voicemail' THEN 'voicemail_left' WHEN 'failed' THEN 'other' ELSE outcome END,
           summary = CASE WHEN ns = 'failed' THEN 'The call could not be connected' ELSE summary END WHERE id = s.id;
    INSERT INTO dv_call_events (organization_id, call_id, event, detail) VALUES (o, s.id, 'ended', jsonb_build_object('status', ns, 'seconds', least(dur, 86400)));
    IF ns = 'missed' AND s.direction = 'inbound' AND s.case_id IS NOT NULL THEN
      INSERT INTO case_tasks (case_id, organization_id, title, kind, due_date, status, assigned_to, source)
      SELECT s.case_id, o, 'Return the missed call', 'call', current_date, 'open', c.assigned_to, 'manual' FROM debt_cases c WHERE c.id = s.case_id
         AND NOT EXISTS (SELECT 1 FROM case_tasks WHERE case_id = s.case_id AND title = 'Return the missed call' AND status = 'open');
    END IF;
    IF s.adviser_id IS NOT NULL THEN
      UPDATE dv_adviser_presence SET status = CASE WHEN ns = 'completed' THEN 'busy' ELSE 'available' END, updated_at = now() WHERE organization_id = o AND user_id = s.adviser_id AND status = 'on_call';
    END IF;
    RETURN jsonb_build_object('status', 'ok', 'call_id', s.id, 'call_status', ns);
  END IF;

  IF p_event = 'recording' THEN
    UPDATE dv_call_sessions SET recording_ref = CASE WHEN p_payload->>'status' = 'failed' THEN recording_ref ELSE nullif(p_payload->>'ref','') END,
           recording_status = CASE WHEN p_payload->>'status' = 'failed' THEN 'failed' ELSE 'available' END WHERE id = s.id;
    INSERT INTO dv_call_events (organization_id, call_id, event, detail) VALUES (o, s.id, CASE WHEN p_payload->>'status' = 'failed' THEN 'recording_failed' ELSE 'recording_ready' END, '{}'::jsonb);
    RETURN jsonb_build_object('status', 'ok', 'call_id', s.id, 'transcribe', coalesce(t.transcription_enabled, false));
  END IF;

  IF p_event = 'transcript' THEN
    IF NOT coalesce(t.transcription_enabled, false) THEN RETURN jsonb_build_object('status', 'ignored'); END IF;
    INSERT INTO dv_call_transcripts (organization_id, call_id, case_id, body, language, confidence) VALUES (o, s.id, s.case_id, left(coalesce(p_payload->>'text',''), 300000), coalesce(nullif(p_payload->>'language',''), 'en-GB'), nullif(p_payload->>'confidence','')::numeric)
    ON CONFLICT (call_id) DO NOTHING;
    INSERT INTO dv_call_events (organization_id, call_id, event, detail) VALUES (o, s.id, 'transcript_ready', '{}'::jsonb);
    RETURN jsonb_build_object('status', 'ok', 'call_id', s.id, 'analyse', coalesce(t.ai_analysis_enabled, false) AND s.case_id IS NOT NULL);
  END IF;
  RAISE EXCEPTION 'unknown event' USING ERRCODE = '22023';
END $function$;

-- AI analysis helpers: service role only. No analysis is stored unless a model really produced it; a person decides what counts.
CREATE OR REPLACE FUNCTION public.dv_call_ai_context(p_call uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT jsonb_build_object('transcript', t.body, 'direction', s.direction, 'case_id', s.case_id, 'organization_id', s.organization_id)
    FROM dv_call_sessions s JOIN dv_call_transcripts t ON t.call_id = s.id JOIN dv_telephony_settings ts ON ts.organization_id = s.organization_id AND ts.ai_analysis_enabled
   WHERE s.id = p_call AND s.case_id IS NOT NULL;
$$;
CREATE OR REPLACE FUNCTION public.dv_call_ai_store(p_call uuid, p_kind text, p_body text, p_payload text, p_model text, p_version text, p_confidence numeric DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE s dv_call_sessions; id uuid;
BEGIN
  SELECT * INTO s FROM dv_call_sessions WHERE id = p_call AND case_id IS NOT NULL;
  IF s.id IS NULL OR p_kind NOT IN ('summary','analysis') OR coalesce(btrim(p_body),'') = '' OR coalesce(btrim(p_model),'') = '' THEN RAISE EXCEPTION 'cannot store this draft' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM dv_call_ai_drafts WHERE call_id = p_call AND kind = p_kind AND status = 'draft') THEN RAISE EXCEPTION 'a draft is already waiting' USING ERRCODE = '22023'; END IF;
  INSERT INTO dv_call_ai_drafts (organization_id, case_id, call_id, kind, body, payload, model, model_version, confidence) VALUES (s.organization_id, s.case_id, p_call, p_kind, left(p_body, 60000), left(p_payload, 60000), left(p_model, 80), left(p_version, 80), p_confidence) RETURNING dv_call_ai_drafts.id INTO id;
  INSERT INTO dv_call_events (organization_id, call_id, event, detail) VALUES (s.organization_id, s.id, 'ai_draft_created', jsonb_build_object('kind', p_kind, 'model', left(p_model, 80)));
  RETURN id;
END $function$;

-- transcripts may only gain their client when an unidentified call is filed; nothing else about them can change
CREATE OR REPLACE FUNCTION public.dv_call_transcript_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF OLD.case_id IS NOT NULL OR NEW.body IS DISTINCT FROM OLD.body OR NEW.call_id <> OLD.call_id OR NEW.organization_id <> OLD.organization_id OR NEW.language IS DISTINCT FROM OLD.language THEN
    IF coalesce(current_setting('dv.erasing', true), '') <> 'on' THEN RAISE EXCEPTION 'call trail rows cannot be changed' USING ERRCODE = '42501'; END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.dv_call_transcript_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_immutable ON public.dv_call_transcripts;
CREATE TRIGGER trg_immutable BEFORE UPDATE ON public.dv_call_transcripts FOR EACH ROW EXECUTE FUNCTION public.dv_call_transcript_guard();

-- ---- grants
DO $$ DECLARE f text; BEGIN
  FOREACH f IN ARRAY ARRAY['dv_call_user_mgr(uuid,uuid)','dv_call_ev(uuid,uuid,text,jsonb)','dv_call_acc(uuid,uuid,text,jsonb)','dv_call_load(uuid,boolean)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
  END LOOP;
  FOREACH f IN ARRAY ARRAY['dv_telephony_get()','dv_telephony_set(boolean,text,int,boolean,boolean,boolean)','dv_presence_set(text,text)','dv_team_presence()','dv_call_start(uuid,text)','dv_call_state(uuid,text)',
     'dv_call_recording_event(uuid,text,text)','dv_call_transfer(uuid,text,text,uuid)','dv_call_transfer_result(uuid,text)','dv_call_participant_add(uuid,text,text,text,uuid)','dv_call_participant_remove(uuid)',
     'dv_call_note_add(uuid,text,text,boolean,date)','dv_call_note_complete(uuid)','dv_call_attach_case(uuid,uuid)','dv_call_dismiss(uuid,text)','dv_call_unmatched()',
     'dv_call_finish(uuid,text,text,boolean,boolean,boolean,date)','dv_my_calls_pending()','dv_call_list(uuid)','dv_call_callback_schedule(uuid,text,timestamptz,int,text,uuid)',
     'dv_call_callbacks(uuid)','dv_call_callback_update(uuid,text)','dv_call_timeline(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
  FOREACH f IN ARRAY ARRAY['dv_call_ingest(text,jsonb)','dv_call_ai_context(uuid)','dv_call_ai_store(uuid,text,text,text,text,text,numeric)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
END $$;
