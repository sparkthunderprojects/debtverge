/*
  B1a: calls can belong to a shared client, or to nobody (standalone dialler).
  - dv_call_sessions.client_id, kept in step with the case's client by trigger.
  - core_org_has_client_apps(org): does the firm license any client-stage app. If not, wrap-up needs no client.
  - dv_call_start_for(client, phone): start a call for a client who has no case yet (Lead/Qualify), or with no client at all.
  - dv_call_finish raises call.completed (stormcall -> compliance), once per call.
*/
ALTER TABLE public.dv_call_sessions ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES public.core_clients(id);
CREATE INDEX IF NOT EXISTS dv_call_sessions_client_idx ON public.dv_call_sessions (client_id) WHERE client_id IS NOT NULL;

UPDATE public.dv_call_sessions s SET client_id = c.client_id FROM public.debt_cases c WHERE c.id = s.case_id AND c.client_id IS NOT NULL AND s.client_id IS NULL;

CREATE OR REPLACE FUNCTION public.dv_call_sync_client() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public','pg_temp' AS $$
BEGIN
  IF NEW.case_id IS NOT NULL THEN
    NEW.client_id := coalesce((SELECT client_id FROM debt_cases WHERE id = NEW.case_id), NEW.client_id);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_call_sync_client ON public.dv_call_sessions;
CREATE TRIGGER trg_call_sync_client BEFORE INSERT OR UPDATE OF case_id ON public.dv_call_sessions FOR EACH ROW EXECUTE FUNCTION public.dv_call_sync_client();

CREATE OR REPLACE FUNCTION public.core_org_has_client_apps(p_org uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
  SELECT EXISTS (SELECT 1 FROM core_apps a WHERE a.stage IS NOT NULL AND dv_org_has_product(p_org, a.product_key));
$$;

CREATE OR REPLACE FUNCTION public.dv_call_load(p_call uuid, p_write boolean DEFAULT false) RETURNS dv_call_sessions LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE s dv_call_sessions;
BEGIN
  IF p_write THEN SELECT * INTO s FROM dv_call_sessions WHERE id = p_call FOR UPDATE; ELSE SELECT * INTO s FROM dv_call_sessions WHERE id = p_call; END IF;
  IF s.id IS NULL OR auth.uid() IS NULL OR NOT dv_is_org_member(s.organization_id) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF NOT dv_org_has_product(s.organization_id, 'voip') THEN RAISE EXCEPTION 'this is not part of your licence' USING ERRCODE = '42501'; END IF;
  IF s.case_id IS NOT NULL THEN
    IF NOT dv_can_read_case(s.case_id) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
    IF p_write AND NOT (s.adviser_id = auth.uid() OR dv_is_manager(s.organization_id) OR (s.adviser_id IS NULL AND dv_can_edit_case(s.case_id))) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  ELSE
    IF s.client_id IS NOT NULL AND NOT core_client_can_read(s.client_id) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
    IF NOT (s.adviser_id = auth.uid() OR dv_is_manager(s.organization_id)) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  END IF;
  RETURN s;
END $function$;

CREATE OR REPLACE FUNCTION public.dv_call_finish(p_call uuid, p_outcome text, p_summary text, p_notice boolean DEFAULT NULL, p_vulnerability boolean DEFAULT false, p_possible_complaint boolean DEFAULT false, p_follow_up date DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE s dv_call_sessions; sm text := nullif(btrim(coalesce(p_summary,'')),''); st text; nid uuid; c debt_cases; dur int;
BEGIN
  s := dv_call_load(p_call, true);
  IF s.outcome <> 'pending' THEN RAISE EXCEPTION 'this call has already been wrapped up' USING ERRCODE = '22023'; END IF;
  IF p_outcome NOT IN ('spoke_to_client','spoke_to_third_party','no_answer','voicemail_left','wrong_number','call_back_requested','payment_promised','other') THEN RAISE EXCEPTION 'choose what happened on the call' USING ERRCODE = '22023'; END IF;
  IF s.case_id IS NULL AND s.client_id IS NULL AND p_outcome <> 'wrong_number' AND core_org_has_client_apps(s.organization_id) THEN RAISE EXCEPTION 'file the call to a client first' USING ERRCODE = '22023'; END IF;
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
  PERFORM core_event_emit(s.organization_id, 'call.completed', s.client_id,
    jsonb_build_object('call_id', s.id, 'outcome', p_outcome, 'duration_seconds', dur, 'has_client', (s.case_id IS NOT NULL OR s.client_id IS NOT NULL), 'case_id', s.case_id),
    'call:' || s.id::text, 'stormcall', (SELECT consumer_apps FROM core_event_types WHERE event_type = 'call.completed'), auth.uid());
  PERFORM dv_call_ev(s.id, s.organization_id, 'wrapped_up', jsonb_build_object('outcome', p_outcome));
  UPDATE dv_adviser_presence SET status = 'available', updated_at = now() WHERE organization_id = s.organization_id AND user_id = auth.uid() AND status = 'on_call'
     AND NOT EXISTS (SELECT 1 FROM dv_call_sessions x WHERE x.adviser_id = auth.uid() AND x.id <> s.id AND x.status IN ('ringing','answered','on_hold','transferred'));
END $function$;

CREATE OR REPLACE FUNCTION public.dv_call_start_for(p_client uuid, p_phone text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $function$
DECLARE o uuid; sid uuid; cs uuid; ph text := regexp_replace(coalesce(p_phone,''), '[^0-9+]', '', 'g'); t dv_telephony_settings;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF p_client IS NOT NULL THEN
    SELECT organization_id INTO o FROM core_clients WHERE id = p_client AND deleted_at IS NULL;
    IF o IS NULL OR NOT core_client_can_change(p_client) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
    SELECT id INTO cs FROM debt_cases WHERE client_id = p_client AND deleted_at IS NULL ORDER BY created_at LIMIT 1;
    IF cs IS NOT NULL THEN RETURN dv_call_start(cs, p_phone); END IF;
  ELSE
    o := dv_my_org();
    IF o IS NULL OR NOT dv_is_org_member(o) OR NOT dv_mfa_ok(o) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  END IF;
  PERFORM dv_call_org_ok(o, 'voip');
  IF length(regexp_replace(ph, '\D', '', 'g')) < 6 THEN RAISE EXCEPTION 'enter a phone number' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM dv_call_sessions WHERE adviser_id = auth.uid() AND status IN ('ringing','answered','on_hold','transferred') AND started_at > now() - interval '6 hours') THEN
    RAISE EXCEPTION 'finish your current call first' USING ERRCODE = '22023'; END IF;
  INSERT INTO dv_telephony_settings (organization_id) VALUES (o) ON CONFLICT DO NOTHING;
  SELECT * INTO t FROM dv_telephony_settings WHERE organization_id = o;
  INSERT INTO dv_call_sessions (organization_id, client_id, direction, source, status, phone, adviser_id, started_at, outcome, created_by, customer_identified)
  VALUES (o, p_client, 'outbound', 'softphone', 'ringing', left(ph, 40), auth.uid(), now(), 'pending', auth.uid(), p_client IS NOT NULL) RETURNING id INTO sid;
  PERFORM dv_call_ev(sid, o, 'dialling', jsonb_build_object('source', 'softphone'));
  INSERT INTO dv_adviser_presence (organization_id, user_id, status) VALUES (o, auth.uid(), 'on_call')
    ON CONFLICT (organization_id, user_id) DO UPDATE SET status = 'on_call', updated_at = now();
  RETURN jsonb_build_object('call_id', sid, 'record', t.record_calls, 'notice', t.recording_notice_text, 'phone', ph);
END $function$;

REVOKE ALL ON FUNCTION public.dv_call_sync_client() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.core_org_has_client_apps(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.core_org_has_client_apps(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.dv_call_start_for(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dv_call_start_for(uuid,text) TO authenticated;
