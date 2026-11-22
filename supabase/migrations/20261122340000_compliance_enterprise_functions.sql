-- Call compliance: review pipeline, call record, QA, search, risks, coaching, audit, reports.
-- Every function checks licence + role itself; none of these are reachable by anon.

CREATE OR REPLACE FUNCTION public.dv_rev_step(p_review uuid, p_org uuid, p_step text, p_detail jsonb DEFAULT '{}'::jsonb) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  INSERT INTO dv_call_review_steps (organization_id, review_id, step, actor, detail) VALUES (p_org, p_review, p_step, auth.uid(), coalesce(p_detail, '{}'::jsonb));
$$;

-- ---------- review workflow ----------
CREATE OR REPLACE FUNCTION public.dv_compliance_assign(p_call uuid, p_reviewer uuid, p_priority text DEFAULT 'normal', p_due date DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE o uuid := dv_compliance_gate(); s dv_call_sessions; rid uuid; due date := coalesce(p_due, current_date + 7);
BEGIN
  SELECT * INTO s FROM dv_call_sessions WHERE id = p_call AND organization_id = o;
  IF s.id IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF s.outcome = 'pending' OR s.status IN ('ringing','answered','on_hold','transferred') THEN RAISE EXCEPTION 'the call must be finished and wrapped up first' USING ERRCODE = '22023'; END IF;
  IF p_priority NOT IN ('low','normal','high','critical') THEN RAISE EXCEPTION 'choose a priority' USING ERRCODE = '22023'; END IF;
  IF due < current_date OR due > current_date + 90 THEN RAISE EXCEPTION 'choose a due date in the next 90 days' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM dv_call_reviews WHERE call_id = p_call) THEN RAISE EXCEPTION 'this call already has a review' USING ERRCODE = '22023'; END IF;
  IF p_reviewer IS NOT NULL THEN
    IF NOT dv_call_user_mgr(o, p_reviewer) THEN RAISE EXCEPTION 'the reviewer must be a manager in your firm' USING ERRCODE = '22023'; END IF;
    IF p_reviewer = s.adviser_id THEN RAISE EXCEPTION 'an adviser cannot review their own call' USING ERRCODE = '22023'; END IF;
  END IF;
  INSERT INTO dv_call_reviews (organization_id, call_id, case_id, status, priority, reviewer_id, assigned_by, assigned_at, due_date)
  VALUES (o, p_call, s.case_id, 'assigned', p_priority, p_reviewer, auth.uid(), now(), due) RETURNING id INTO rid;
  PERFORM dv_rev_step(rid, o, 'review_created', jsonb_build_object('priority', p_priority));
  IF p_reviewer IS NOT NULL THEN
    INSERT INTO dv_call_review_assignments (organization_id, review_id, assigned_to, assigned_by, status) VALUES (o, rid, p_reviewer, auth.uid(), 'active');
    PERFORM dv_rev_step(rid, o, 'review_assigned', jsonb_build_object('reviewer', p_reviewer));
  END IF;
  PERFORM dv_call_acc(p_call, o, 'review_opened', jsonb_build_object('review', rid));
  RETURN rid;
END $function$;

CREATE OR REPLACE FUNCTION public.dv_compliance_claim(p_review uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE o uuid := dv_compliance_gate(); r dv_call_reviews; s dv_call_sessions;
BEGIN
  SELECT * INTO r FROM dv_call_reviews WHERE id = p_review AND organization_id = o FOR UPDATE;
  IF r.id IS NULL OR r.status <> 'assigned' OR r.reviewer_id IS NOT NULL THEN RAISE EXCEPTION 'this review cannot be picked up' USING ERRCODE = '22023'; END IF;
  SELECT * INTO s FROM dv_call_sessions WHERE id = r.call_id;
  IF s.adviser_id = auth.uid() THEN RAISE EXCEPTION 'you cannot review your own call' USING ERRCODE = '22023'; END IF;
  UPDATE dv_call_reviews SET reviewer_id = auth.uid(), assigned_at = now(), updated_at = now() WHERE id = r.id;
  INSERT INTO dv_call_review_assignments (organization_id, review_id, assigned_to, assigned_by, status) VALUES (o, r.id, auth.uid(), auth.uid(), 'active');
  PERFORM dv_rev_step(r.id, o, 'review_assigned', jsonb_build_object('reviewer', auth.uid(), 'claimed', true));
END $function$;

CREATE OR REPLACE FUNCTION public.dv_compliance_start(p_review uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE o uuid := dv_compliance_gate(); r dv_call_reviews;
BEGIN
  SELECT * INTO r FROM dv_call_reviews WHERE id = p_review AND organization_id = o FOR UPDATE;
  IF r.id IS NULL OR r.reviewer_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF r.status NOT IN ('assigned','rejected') THEN RAISE EXCEPTION 'this review cannot be started' USING ERRCODE = '22023'; END IF;
  UPDATE dv_call_reviews SET status = 'in_review', started_at = coalesce(started_at, now()), updated_at = now() WHERE id = r.id;
  PERFORM dv_rev_step(r.id, o, 'review_started');
END $function$;

CREATE OR REPLACE FUNCTION public.dv_compliance_submit(p_review uuid, p_outcome text, p_checklist jsonb, p_issues jsonb, p_actions jsonb, p_comments text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE o uuid := dv_compliance_gate(); r dv_call_reviews; yes int; nos int; sc int; cm text := nullif(btrim(coalesce(p_comments,'')),''); iss jsonb := coalesce(p_issues, '[]'::jsonb); act jsonb := coalesce(p_actions, '[]'::jsonb); e record;
BEGIN
  SELECT * INTO r FROM dv_call_reviews WHERE id = p_review AND organization_id = o FOR UPDATE;
  IF r.id IS NULL OR r.reviewer_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF r.status <> 'in_review' THEN RAISE EXCEPTION 'start the review first' USING ERRCODE = '22023'; END IF;
  IF p_outcome NOT IN ('compliant','minor_issues','major_issues','non_compliant') THEN RAISE EXCEPTION 'choose an outcome' USING ERRCODE = '22023'; END IF;
  IF jsonb_typeof(p_checklist) <> 'object' OR jsonb_typeof(iss) <> 'array' OR jsonb_typeof(act) <> 'array' THEN RAISE EXCEPTION 'review form is malformed' USING ERRCODE = '22023'; END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(p_checklist)) > 40 OR jsonb_array_length(iss) > 20 OR jsonb_array_length(act) > 10 THEN RAISE EXCEPTION 'too many entries' USING ERRCODE = '22023'; END IF;
  FOR e IN SELECT key, value FROM jsonb_each(p_checklist) LOOP
    IF e.key !~ '^[a-z_]{2,40}$' OR e.value NOT IN ('"yes"'::jsonb, '"no"'::jsonb, '"na"'::jsonb) THEN RAISE EXCEPTION 'each checklist answer must be yes, no or na' USING ERRCODE = '22023'; END IF;
  END LOOP;
  FOR e IN SELECT value FROM jsonb_array_elements(iss) LOOP
    IF jsonb_typeof(e.value) <> 'object' OR length(btrim(coalesce(e.value->>'text',''))) < 5 OR length(e.value->>'text') > 500 OR coalesce(e.value->>'severity','') NOT IN ('minor','major','critical') THEN
      RAISE EXCEPTION 'each issue needs a severity (minor, major or critical) and a description' USING ERRCODE = '22023'; END IF;
  END LOOP;
  FOR e IN SELECT value FROM jsonb_array_elements(act) LOOP
    IF jsonb_typeof(e.value) <> 'object' OR length(btrim(coalesce(e.value->>'text',''))) < 5 OR length(e.value->>'text') > 500 THEN RAISE EXCEPTION 'each corrective action needs a description' USING ERRCODE = '22023'; END IF;
  END LOOP;
  SELECT count(*) FILTER (WHERE value = '"yes"'::jsonb), count(*) FILTER (WHERE value = '"no"'::jsonb) INTO yes, nos FROM jsonb_each(p_checklist);
  IF yes + nos = 0 THEN RAISE EXCEPTION 'answer at least one checklist item' USING ERRCODE = '22023'; END IF;
  IF p_outcome = 'compliant' AND (nos > 0 OR jsonb_array_length(iss) > 0) THEN RAISE EXCEPTION 'a call with failed checks or issues cannot be marked compliant' USING ERRCODE = '22023'; END IF;
  IF p_outcome IN ('major_issues','non_compliant') AND jsonb_array_length(iss) = 0 THEN RAISE EXCEPTION 'record the issue that justifies this outcome' USING ERRCODE = '22023'; END IF;
  IF p_outcome IN ('major_issues','non_compliant') AND (cm IS NULL OR length(cm) < 10) THEN RAISE EXCEPTION 'explain the outcome in your comments (at least 10 characters)' USING ERRCODE = '22023'; END IF;
  sc := round(100.0 * yes / (yes + nos));
  UPDATE dv_call_reviews SET status = 'pending_approval', outcome = p_outcome, score = sc, checklist = p_checklist, issues = iss, corrective_actions = act, comments = left(cm, 3000),
         submitted_at = now(), updated_at = now(), approved_by = NULL, approved_at = NULL, decision_note = NULL WHERE id = r.id;
  UPDATE dv_call_review_assignments SET status = 'completed', ended_at = now() WHERE review_id = r.id AND status = 'active';
  PERFORM dv_rev_step(r.id, o, 'review_completed', jsonb_build_object('outcome', p_outcome, 'score', sc));
  IF jsonb_array_length(act) > 0 THEN PERFORM dv_rev_step(r.id, o, 'corrective_action_added', jsonb_build_object('count', jsonb_array_length(act))); END IF;
  RETURN sc;
END $function$;

CREATE OR REPLACE FUNCTION public.dv_compliance_decide(p_review uuid, p_decision text, p_note text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE o uuid := dv_compliance_gate(); r dv_call_reviews; s dv_call_sessions; t dv_telephony_settings; nt text := nullif(btrim(coalesce(p_note,'')),'');
BEGIN
  SELECT * INTO r FROM dv_call_reviews WHERE id = p_review AND organization_id = o FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF r.status NOT IN ('pending_approval','escalated') THEN RAISE EXCEPTION 'this review is not waiting for a decision' USING ERRCODE = '22023'; END IF;
  IF p_decision NOT IN ('approve','reject') THEN RAISE EXCEPTION 'choose approve or reject' USING ERRCODE = '22023'; END IF;
  SELECT * INTO s FROM dv_call_sessions WHERE id = r.call_id;
  SELECT * INTO t FROM dv_telephony_settings WHERE organization_id = o;
  IF s.adviser_id = auth.uid() THEN RAISE EXCEPTION 'you cannot decide on a review of your own call' USING ERRCODE = '42501'; END IF;
  IF r.reviewer_id = auth.uid() AND coalesce(t.require_second_approver, true) THEN RAISE EXCEPTION 'a second person must approve this review' USING ERRCODE = '42501'; END IF;
  IF r.status = 'escalated' AND r.escalated_to IS NOT NULL AND r.escalated_to <> auth.uid() AND NOT dv_is_org_admin(o) THEN RAISE EXCEPTION 'this review was escalated to someone else' USING ERRCODE = '42501'; END IF;
  IF p_decision = 'reject' AND (nt IS NULL OR length(nt) < 5) THEN RAISE EXCEPTION 'say what needs to change' USING ERRCODE = '22023'; END IF;
  IF p_decision = 'approve' THEN
    UPDATE dv_call_reviews SET status = 'approved', approved_by = auth.uid(), approved_at = now(), decision_note = left(nt, 1000), updated_at = now() WHERE id = r.id;
    PERFORM dv_rev_step(r.id, o, 'review_approved', jsonb_build_object('outcome', r.outcome));
  ELSE
    UPDATE dv_call_reviews SET status = 'rejected', decision_note = left(nt, 1000), is_escalated = false, updated_at = now() WHERE id = r.id;
    UPDATE dv_call_review_assignments SET status = 'active', ended_at = NULL WHERE id = (SELECT id FROM dv_call_review_assignments WHERE review_id = r.id AND assigned_to = r.reviewer_id ORDER BY assigned_at DESC LIMIT 1);
    PERFORM dv_rev_step(r.id, o, 'review_rejected', jsonb_build_object('note', left(nt, 300)));
  END IF;
END $function$;

CREATE OR REPLACE FUNCTION public.dv_compliance_escalate(p_review uuid, p_to uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE o uuid := dv_compliance_gate(); r dv_call_reviews; s dv_call_sessions; rs text := nullif(btrim(coalesce(p_reason,'')),'');
BEGIN
  SELECT * INTO r FROM dv_call_reviews WHERE id = p_review AND organization_id = o FOR UPDATE;
  IF r.id IS NULL OR r.status <> 'pending_approval' THEN RAISE EXCEPTION 'only a review waiting for approval can be escalated' USING ERRCODE = '22023'; END IF;
  IF rs IS NULL OR length(rs) < 10 THEN RAISE EXCEPTION 'give the reason for escalating (at least 10 characters)' USING ERRCODE = '22023'; END IF;
  SELECT * INTO s FROM dv_call_sessions WHERE id = r.call_id;
  IF p_to IS NULL OR NOT dv_call_user_mgr(o, p_to) OR p_to = s.adviser_id OR p_to = r.reviewer_id THEN RAISE EXCEPTION 'choose a different senior manager' USING ERRCODE = '22023'; END IF;
  UPDATE dv_call_reviews SET status = 'escalated', is_escalated = true, escalation_reason = left(rs, 1000), escalated_to = p_to, escalated_at = now(), updated_at = now() WHERE id = r.id;
  PERFORM dv_rev_step(r.id, o, 'review_escalated', jsonb_build_object('to', p_to));
END $function$;

CREATE OR REPLACE FUNCTION public.dv_compliance_reassign(p_review uuid, p_reviewer uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE o uuid := dv_compliance_gate(); r dv_call_reviews; s dv_call_sessions; rs text := nullif(btrim(coalesce(p_reason,'')),'');
BEGIN
  SELECT * INTO r FROM dv_call_reviews WHERE id = p_review AND organization_id = o FOR UPDATE;
  IF r.id IS NULL OR r.status NOT IN ('assigned','in_review','rejected') THEN RAISE EXCEPTION 'this review cannot be reassigned' USING ERRCODE = '22023'; END IF;
  IF rs IS NULL OR length(rs) < 5 THEN RAISE EXCEPTION 'give a reason for reassigning' USING ERRCODE = '22023'; END IF;
  SELECT * INTO s FROM dv_call_sessions WHERE id = r.call_id;
  IF p_reviewer IS NULL OR NOT dv_call_user_mgr(o, p_reviewer) OR p_reviewer = s.adviser_id OR p_reviewer IS NOT DISTINCT FROM r.reviewer_id THEN RAISE EXCEPTION 'choose a different manager (not the adviser on the call)' USING ERRCODE = '22023'; END IF;
  UPDATE dv_call_review_assignments SET status = 'reassigned', ended_at = now(), reason = left(rs, 500) WHERE review_id = r.id AND status = 'active';
  INSERT INTO dv_call_review_assignments (organization_id, review_id, assigned_to, assigned_by, status) VALUES (o, r.id, p_reviewer, auth.uid(), 'active');
  UPDATE dv_call_reviews SET reviewer_id = p_reviewer, status = 'assigned', started_at = NULL, assigned_by = auth.uid(), assigned_at = now(), updated_at = now() WHERE id = r.id;
  PERFORM dv_rev_step(r.id, o, 'reviewer_changed', jsonb_build_object('from', r.reviewer_id, 'to', p_reviewer, 'reason', left(rs, 200)));
END $function$;

CREATE OR REPLACE FUNCTION public.dv_compliance_decline(p_review uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE o uuid := dv_compliance_gate(); r dv_call_reviews; rs text := nullif(btrim(coalesce(p_reason,'')),'');
BEGIN
  SELECT * INTO r FROM dv_call_reviews WHERE id = p_review AND organization_id = o FOR UPDATE;
  IF r.id IS NULL OR r.reviewer_id IS DISTINCT FROM auth.uid() OR r.status <> 'assigned' THEN RAISE EXCEPTION 'you cannot decline this review' USING ERRCODE = '22023'; END IF;
  IF rs IS NULL OR length(rs) < 5 THEN RAISE EXCEPTION 'say why you are declining' USING ERRCODE = '22023'; END IF;
  UPDATE dv_call_review_assignments SET status = 'declined', ended_at = now(), reason = left(rs, 500) WHERE review_id = r.id AND status = 'active';
  UPDATE dv_call_reviews SET reviewer_id = NULL, updated_at = now() WHERE id = r.id;
  PERFORM dv_rev_step(r.id, o, 'review_declined', jsonb_build_object('reason', left(rs, 200)));
END $function$;

CREATE OR REPLACE FUNCTION public.dv_compliance_extend(p_review uuid, p_due date, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE o uuid := dv_compliance_gate(); r dv_call_reviews; rs text := nullif(btrim(coalesce(p_reason,'')),'');
BEGIN
  SELECT * INTO r FROM dv_call_reviews WHERE id = p_review AND organization_id = o FOR UPDATE;
  IF r.id IS NULL OR r.status NOT IN ('assigned','in_review','rejected') THEN RAISE EXCEPTION 'this review cannot be extended' USING ERRCODE = '22023'; END IF;
  IF p_due IS NULL OR p_due <= coalesce(r.due_date, current_date) OR p_due > current_date + 90 THEN RAISE EXCEPTION 'choose a later date within 90 days' USING ERRCODE = '22023'; END IF;
  IF rs IS NULL OR length(rs) < 5 THEN RAISE EXCEPTION 'give a reason for the extension' USING ERRCODE = '22023'; END IF;
  UPDATE dv_call_reviews SET due_date = p_due, updated_at = now() WHERE id = r.id;
  PERFORM dv_rev_step(r.id, o, 'due_date_extended', jsonb_build_object('from', r.due_date, 'to', p_due, 'reason', left(rs, 200)));
END $function$;

-- ---------- queue ----------
CREATE OR REPLACE FUNCTION public.dv_compliance_queue(p_filter text DEFAULT 'all')
RETURNS TABLE (review_id uuid, call_id uuid, case_id uuid, case_number text, adviser_name text, reviewer_id uuid, reviewer_name text, status text, priority text, due_date date, overdue boolean,
  outcome text, score int, is_escalated boolean, escalated_to_name text, call_started_at timestamptz, direction text, duration_seconds int, mine boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE o uuid := dv_compliance_gate();
BEGIN
  IF p_filter NOT IN ('all','mine','pending_approval','overdue','escalated','unassigned','completed','open') THEN RAISE EXCEPTION 'unknown filter' USING ERRCODE = '22023'; END IF;
  RETURN QUERY
    SELECT r.id, r.call_id, r.case_id, c.case_number, coalesce(pa.full_name, pa.email)::text, r.reviewer_id, coalesce(pr.full_name, pr.email)::text, r.status, r.priority, r.due_date,
           (r.status IN ('assigned','in_review','rejected') AND r.due_date < current_date), r.outcome, r.score, r.is_escalated, coalesce(pe.full_name, pe.email)::text,
           s.started_at, s.direction, s.duration_seconds, r.reviewer_id = auth.uid()
      FROM dv_call_reviews r JOIN dv_call_sessions s ON s.id = r.call_id LEFT JOIN debt_cases c ON c.id = r.case_id
      LEFT JOIN profiles pa ON pa.id = s.adviser_id LEFT JOIN profiles pr ON pr.id = r.reviewer_id LEFT JOIN profiles pe ON pe.id = r.escalated_to
     WHERE r.organization_id = o AND (r.case_id IS NULL OR dv_can_read_case(r.case_id))
       AND CASE p_filter WHEN 'mine' THEN r.reviewer_id = auth.uid() AND r.status IN ('assigned','in_review','rejected')
                         WHEN 'pending_approval' THEN r.status = 'pending_approval'
                         WHEN 'overdue' THEN r.status IN ('assigned','in_review','rejected') AND r.due_date < current_date
                         WHEN 'escalated' THEN r.status = 'escalated'
                         WHEN 'unassigned' THEN r.reviewer_id IS NULL AND r.status = 'assigned'
                         WHEN 'completed' THEN r.status = 'approved'
                         WHEN 'open' THEN r.status <> 'approved' ELSE true END
     ORDER BY (r.status = 'approved'), CASE r.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, r.due_date NULLS LAST LIMIT 300;
END $function$;

CREATE OR REPLACE FUNCTION public.dv_compliance_unreviewed(p_limit int DEFAULT 50)
RETURNS TABLE (call_id uuid, case_id uuid, case_number text, adviser_name text, started_at timestamptz, direction text, duration_seconds int, outcome text, reasons text[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE o uuid := dv_compliance_gate();
BEGIN
  RETURN QUERY
    SELECT s.id, s.case_id, c.case_number, coalesce(p.full_name, p.email)::text, s.started_at, s.direction, s.duration_seconds, s.outcome,
           array_remove(ARRAY[CASE WHEN s.vulnerability_flag THEN 'vulnerability flagged' END, CASE WHEN s.possible_complaint THEN 'possible complaint' END,
             CASE WHEN s.outcome = 'spoke_to_client' AND s.recording_notice_given IS NOT TRUE THEN 'recording notice not confirmed' END,
             CASE WHEN s.recording_status = 'failed' THEN 'recording failed' END,
             CASE WHEN EXISTS (SELECT 1 FROM dv_call_recording_events e WHERE e.call_id = s.id AND e.event = 'paused') THEN 'recording was paused' END], NULL)
      FROM dv_call_sessions s LEFT JOIN debt_cases c ON c.id = s.case_id LEFT JOIN profiles p ON p.id = s.adviser_id
     WHERE s.organization_id = o AND s.outcome <> 'pending' AND (s.case_id IS NULL OR dv_can_read_case(s.case_id)) AND NOT EXISTS (SELECT 1 FROM dv_call_reviews r WHERE r.call_id = s.id)
       AND (s.vulnerability_flag OR s.possible_complaint OR (s.outcome = 'spoke_to_client' AND s.recording_notice_given IS NOT TRUE) OR s.recording_status = 'failed'
            OR EXISTS (SELECT 1 FROM dv_call_recording_events e WHERE e.call_id = s.id AND e.event = 'paused'))
     ORDER BY s.started_at DESC LIMIT least(greatest(coalesce(p_limit, 50), 1), 200);
END $function$;

-- ---------- dashboard ----------
CREATE OR REPLACE FUNCTION public.dv_compliance_dashboard(p_days int DEFAULT 30) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE o uuid := dv_compliance_gate(); f timestamptz; t dv_telephony_settings; res jsonb;
BEGIN
  IF p_days IS NULL OR p_days NOT BETWEEN 1 AND 365 THEN RAISE EXCEPTION 'choose 1 to 365 days' USING ERRCODE = '22023'; END IF;
  f := now() - make_interval(days => p_days);
  SELECT * INTO t FROM dv_telephony_settings WHERE organization_id = o;
  res := jsonb_build_object(
    'days', p_days,
    'calls', (SELECT count(*) FROM dv_call_sessions WHERE organization_id = o AND started_at >= f),
    'recorded', (SELECT count(*) FROM dv_call_sessions WHERE organization_id = o AND started_at >= f AND recording_ref IS NOT NULL),
    'reviewed', (SELECT count(*) FROM dv_call_reviews r JOIN dv_call_sessions s ON s.id = r.call_id WHERE r.organization_id = o AND r.status = 'approved' AND s.started_at >= f),
    'avg_score', (SELECT round(avg(r.score)) FROM dv_call_reviews r JOIN dv_call_sessions s ON s.id = r.call_id WHERE r.organization_id = o AND r.status = 'approved' AND s.started_at >= f),
    'outcomes', coalesce((SELECT jsonb_object_agg(x.outcome, x.n) FROM (SELECT r.outcome, count(*) n FROM dv_call_reviews r JOIN dv_call_sessions s ON s.id = r.call_id
                    WHERE r.organization_id = o AND r.status = 'approved' AND s.started_at >= f GROUP BY r.outcome) x), '{}'::jsonb),
    'awaiting_reviewer', (SELECT count(*) FROM dv_call_reviews WHERE organization_id = o AND status = 'assigned' AND reviewer_id IS NULL),
    'in_progress', (SELECT count(*) FROM dv_call_reviews WHERE organization_id = o AND status IN ('assigned','in_review','rejected') AND reviewer_id IS NOT NULL),
    'pending_approval', (SELECT count(*) FROM dv_call_reviews WHERE organization_id = o AND status = 'pending_approval'),
    'overdue', (SELECT count(*) FROM dv_call_reviews WHERE organization_id = o AND status IN ('assigned','in_review','rejected') AND due_date < current_date),
    'escalated', (SELECT count(*) FROM dv_call_reviews WHERE organization_id = o AND status = 'escalated'),
    'flagged_unreviewed', (SELECT count(*) FROM dv_call_sessions s WHERE s.organization_id = o AND s.started_at >= f AND s.outcome <> 'pending' AND (s.vulnerability_flag OR s.possible_complaint)
                             AND NOT EXISTS (SELECT 1 FROM dv_call_reviews r WHERE r.call_id = s.id)),
    'no_notice', (SELECT count(*) FROM dv_call_sessions WHERE organization_id = o AND started_at >= f AND outcome = 'spoke_to_client' AND recording_notice_given IS NOT TRUE),
    'recording_gaps', (SELECT count(*) FROM dv_call_sessions WHERE organization_id = o AND started_at >= f AND duration_seconds > 0 AND (recording_status = 'failed' OR (recording_status = 'none' AND coalesce(t.record_calls, true)))),
    'coaching_open', (SELECT count(*) FROM dv_coaching_actions WHERE organization_id = o AND status IN ('open','in_progress')),
    'coaching_overdue', (SELECT count(*) FROM dv_coaching_actions WHERE organization_id = o AND status IN ('open','in_progress') AND due_date < current_date),
    'open_risks', (SELECT count(*) FROM dv_call_risk_indicators WHERE organization_id = o AND status = 'open'),
    'recent', coalesce((SELECT jsonb_agg(jsonb_build_object('call_id', s.id, 'started_at', s.started_at, 'direction', s.direction, 'outcome', s.outcome, 'adviser', coalesce(p.full_name, p.email), 'review_status', r.status, 'review_outcome', r.outcome) ORDER BY s.started_at DESC)
                          FROM (SELECT * FROM dv_call_sessions WHERE organization_id = o AND outcome <> 'pending' ORDER BY started_at DESC LIMIT 8) s
                          LEFT JOIN profiles p ON p.id = s.adviser_id LEFT JOIN dv_call_reviews r ON r.call_id = s.id), '[]'::jsonb),
    'attention', coalesce((SELECT jsonb_agg(to_jsonb(a)) FROM (
        SELECT 'overdue_review'::text AS kind, r.call_id, r.id AS review_id, ('Review overdue since ' || to_char(r.due_date, 'DD Mon'))::text AS label, r.due_date::timestamptz AS at
          FROM dv_call_reviews r WHERE r.organization_id = o AND r.status IN ('assigned','in_review','rejected') AND r.due_date < current_date
        UNION ALL SELECT 'escalated', r.call_id, r.id, 'Escalated: ' || left(coalesce(r.escalation_reason, ''), 80), r.escalated_at FROM dv_call_reviews r WHERE r.organization_id = o AND r.status = 'escalated'
        UNION ALL SELECT 'flagged_call', s.id, NULL, CASE WHEN s.possible_complaint THEN 'Possible complaint, no review' ELSE 'Vulnerability flagged, no review' END, s.started_at
          FROM dv_call_sessions s WHERE s.organization_id = o AND s.started_at >= f AND s.outcome <> 'pending' AND (s.vulnerability_flag OR s.possible_complaint) AND NOT EXISTS (SELECT 1 FROM dv_call_reviews r WHERE r.call_id = s.id)
        ORDER BY at LIMIT 12) a), '[]'::jsonb));
  RETURN res;
END $function$;

-- ---------- search ----------
CREATE OR REPLACE FUNCTION public.dv_compliance_search(p_filters jsonb DEFAULT '{}'::jsonb, p_limit int DEFAULT 50, p_offset int DEFAULT 0) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE o uuid := dv_compliance_gate(); fl jsonb := coalesce(p_filters, '{}'::jsonb); d_from date; d_to date; adv uuid; dir text; oc text; rst text; ph text; q text; total int; rws jsonb; lim int := least(greatest(coalesce(p_limit, 50), 1), 100); off int := greatest(coalesce(p_offset, 0), 0);
BEGIN
  IF jsonb_typeof(fl) <> 'object' THEN RAISE EXCEPTION 'filters are malformed' USING ERRCODE = '22023'; END IF;
  d_from := nullif(fl->>'from','')::date; d_to := nullif(fl->>'to','')::date; adv := nullif(fl->>'adviser','')::uuid;
  dir := nullif(fl->>'direction',''); oc := nullif(fl->>'outcome',''); rst := nullif(fl->>'review_status',''); ph := nullif(regexp_replace(coalesce(fl->>'phone',''), '\D', '', 'g'), '');
  q := nullif(btrim(coalesce(fl->>'q','')), '');
  IF q IS NOT NULL THEN q := '%' || replace(replace(replace(left(q, 80), '\', '\\'), '%', '\%'), '_', '\_') || '%'; END IF;
  IF dir IS NOT NULL AND dir NOT IN ('inbound','outbound') THEN RAISE EXCEPTION 'unknown direction' USING ERRCODE = '22023'; END IF;
  IF rst IS NOT NULL AND rst NOT IN ('none','assigned','in_review','pending_approval','approved','rejected','escalated') THEN RAISE EXCEPTION 'unknown review status' USING ERRCODE = '22023'; END IF;
  SELECT count(*) INTO total FROM dv_call_sessions s LEFT JOIN dv_call_reviews r ON r.call_id = s.id
   WHERE s.organization_id = o AND (s.case_id IS NULL OR dv_can_read_case(s.case_id)) AND s.outcome <> 'pending'
     AND (d_from IS NULL OR s.started_at >= d_from) AND (d_to IS NULL OR s.started_at < d_to + 1) AND (adv IS NULL OR s.adviser_id = adv) AND (dir IS NULL OR s.direction = dir) AND (oc IS NULL OR s.outcome = oc)
     AND (rst IS NULL OR (rst = 'none' AND r.id IS NULL) OR r.status = rst) AND (ph IS NULL OR right(regexp_replace(coalesce(s.phone,''), '\D', '', 'g'), 10) LIKE '%' || right(ph, 10) || '%')
     AND (q IS NULL OR s.summary ILIKE q ESCAPE '\')
     AND (NOT coalesce((fl->>'flagged')::boolean, false) OR s.vulnerability_flag OR s.possible_complaint)
     AND (NOT coalesce((fl->>'no_notice')::boolean, false) OR (s.outcome = 'spoke_to_client' AND s.recording_notice_given IS NOT TRUE));
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.started_at DESC), '[]'::jsonb) INTO rws FROM (
    SELECT s.id AS call_id, s.case_id, c.case_number, s.started_at, s.direction, s.phone, s.duration_seconds, s.outcome, left(coalesce(s.summary, ''), 160) AS summary, coalesce(p.full_name, p.email) AS adviser,
           s.vulnerability_flag, s.possible_complaint, s.recording_notice_given, (s.recording_ref IS NOT NULL) AS has_recording, r.status AS review_status, r.outcome AS review_outcome, r.score
      FROM dv_call_sessions s LEFT JOIN dv_call_reviews r ON r.call_id = s.id LEFT JOIN debt_cases c ON c.id = s.case_id LEFT JOIN profiles p ON p.id = s.adviser_id
     WHERE s.organization_id = o AND (s.case_id IS NULL OR dv_can_read_case(s.case_id)) AND s.outcome <> 'pending'
       AND (d_from IS NULL OR s.started_at >= d_from) AND (d_to IS NULL OR s.started_at < d_to + 1) AND (adv IS NULL OR s.adviser_id = adv) AND (dir IS NULL OR s.direction = dir) AND (oc IS NULL OR s.outcome = oc)
       AND (rst IS NULL OR (rst = 'none' AND r.id IS NULL) OR r.status = rst) AND (ph IS NULL OR right(regexp_replace(coalesce(s.phone,''), '\D', '', 'g'), 10) LIKE '%' || right(ph, 10) || '%')
       AND (q IS NULL OR s.summary ILIKE q ESCAPE '\')
       AND (NOT coalesce((fl->>'flagged')::boolean, false) OR s.vulnerability_flag OR s.possible_complaint)
       AND (NOT coalesce((fl->>'no_notice')::boolean, false) OR (s.outcome = 'spoke_to_client' AND s.recording_notice_given IS NOT TRUE))
     ORDER BY s.started_at DESC LIMIT lim OFFSET off) x;
  RETURN jsonb_build_object('total', total, 'rows', rws);
END $function$;

-- ---------- adviser QA ----------
CREATE OR REPLACE FUNCTION public.dv_compliance_adviser_qa(p_days int DEFAULT 30, p_adviser uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE o uuid := dv_compliance_gate(); f timestamptz; pf timestamptz;
BEGIN
  IF p_days IS NULL OR p_days NOT BETWEEN 7 AND 365 THEN RAISE EXCEPTION 'choose 7 to 365 days' USING ERRCODE = '22023'; END IF;
  f := now() - make_interval(days => p_days); pf := f - make_interval(days => p_days);
  RETURN jsonb_build_object(
    'advisers', coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.avg_score NULLS LAST) FROM (
        SELECT s.adviser_id, coalesce(p.full_name, p.email) AS name, count(DISTINCT s.id) AS calls, count(DISTINCT r.id) AS reviewed,
               round(avg(r.score)) AS avg_score,
               (SELECT round(avg(r2.score)) FROM dv_call_reviews r2 JOIN dv_call_sessions s2 ON s2.id = r2.call_id WHERE r2.organization_id = o AND r2.status = 'approved' AND s2.adviser_id = s.adviser_id AND s2.started_at >= pf AND s2.started_at < f) AS previous_avg_score,
               count(*) FILTER (WHERE r.outcome = 'compliant') AS compliant, count(*) FILTER (WHERE r.outcome = 'minor_issues') AS minor_issues,
               count(*) FILTER (WHERE r.outcome = 'major_issues') AS major_issues, count(*) FILTER (WHERE r.outcome = 'non_compliant') AS non_compliant,
               (SELECT count(*) FROM dv_coaching_actions c WHERE c.organization_id = o AND c.adviser_id = s.adviser_id AND c.status IN ('open','in_progress')) AS coaching_open
          FROM dv_call_sessions s LEFT JOIN dv_call_reviews r ON r.call_id = s.id AND r.status = 'approved' LEFT JOIN profiles p ON p.id = s.adviser_id
         WHERE s.organization_id = o AND s.adviser_id IS NOT NULL AND s.started_at >= f AND s.outcome <> 'pending' AND (p_adviser IS NULL OR s.adviser_id = p_adviser)
           AND (s.case_id IS NULL OR dv_can_read_case(s.case_id))
         GROUP BY s.adviser_id, p.full_name, p.email) x), '[]'::jsonb),
    'common_failures', coalesce((SELECT jsonb_agg(jsonb_build_object('item', k.key, 'count', k.n) ORDER BY k.n DESC) FROM (
        SELECT e.key, count(*) n FROM dv_call_reviews r JOIN dv_call_sessions s ON s.id = r.call_id, jsonb_each_text(r.checklist) e
         WHERE r.organization_id = o AND r.status = 'approved' AND s.started_at >= f AND e.value = 'no' AND (p_adviser IS NULL OR s.adviser_id = p_adviser) GROUP BY e.key ORDER BY n DESC LIMIT 10) k), '[]'::jsonb));
END $function$;

-- ---------- risk indicators ----------
CREATE OR REPLACE FUNCTION public.dv_call_risk_raise(p_call uuid, p_type text, p_severity text, p_description text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE o uuid := dv_compliance_gate(); s dv_call_sessions; rid uuid; ds text := nullif(btrim(coalesce(p_description,'')),'');
BEGIN
  SELECT * INTO s FROM dv_call_sessions WHERE id = p_call AND organization_id = o;
  IF s.id IS NULL OR (s.case_id IS NOT NULL AND NOT dv_can_read_case(s.case_id)) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF p_type NOT IN ('compliance_breach','complaint_risk','vulnerability_concern','affordability_issue','disclosure_missing','advice_quality','recording_gap','mis_selling','data_protection') OR p_severity NOT IN ('low','medium','high','critical') THEN
    RAISE EXCEPTION 'choose a risk type and severity' USING ERRCODE = '22023'; END IF;
  IF ds IS NULL OR length(ds) < 5 OR length(ds) > 1000 THEN RAISE EXCEPTION 'describe the risk (5 to 1000 characters)' USING ERRCODE = '22023'; END IF;
  INSERT INTO dv_call_risk_indicators (organization_id, call_id, case_id, risk_type, severity, description, raised_by) VALUES (o, p_call, s.case_id, p_type, p_severity, ds, auth.uid()) RETURNING id INTO rid;
  PERFORM dv_call_ev(p_call, o, 'risk_raised', jsonb_build_object('type', p_type, 'severity', p_severity));
  RETURN rid;
END $function$;
CREATE OR REPLACE FUNCTION public.dv_call_risk_resolve(p_risk uuid, p_note text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE o uuid := dv_compliance_gate(); k dv_call_risk_indicators; nt text := nullif(btrim(coalesce(p_note,'')),'');
BEGIN
  SELECT * INTO k FROM dv_call_risk_indicators WHERE id = p_risk AND organization_id = o FOR UPDATE;
  IF k.id IS NULL OR k.status <> 'open' THEN RAISE EXCEPTION 'this risk cannot be resolved' USING ERRCODE = '22023'; END IF;
  IF nt IS NULL OR length(nt) < 5 THEN RAISE EXCEPTION 'say how it was resolved' USING ERRCODE = '22023'; END IF;
  UPDATE dv_call_risk_indicators SET status = 'resolved', resolved_by = auth.uid(), resolved_at = now(), resolution_note = left(nt, 1000) WHERE id = k.id;
  PERFORM dv_call_ev(k.call_id, o, 'risk_resolved', jsonb_build_object('type', k.risk_type));
END $function$;
CREATE OR REPLACE FUNCTION public.dv_compliance_risks(p_status text DEFAULT 'open')
RETURNS TABLE (id uuid, call_id uuid, case_id uuid, case_number text, risk_type text, severity text, description text, status text, raised_at timestamptz, raised_by_name text, resolved_at timestamptz, resolution_note text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE o uuid := dv_compliance_gate();
BEGIN
  IF p_status NOT IN ('open','resolved','all') THEN RAISE EXCEPTION 'unknown filter' USING ERRCODE = '22023'; END IF;
  RETURN QUERY SELECT k.id, k.call_id, k.case_id, c.case_number, k.risk_type, k.severity, k.description, k.status, k.raised_at, coalesce(p.full_name, p.email)::text, k.resolved_at, k.resolution_note
    FROM dv_call_risk_indicators k LEFT JOIN debt_cases c ON c.id = k.case_id LEFT JOIN profiles p ON p.id = k.raised_by
   WHERE k.organization_id = o AND (k.case_id IS NULL OR dv_can_read_case(k.case_id)) AND (p_status = 'all' OR k.status = p_status)
   ORDER BY (k.status = 'open') DESC, CASE k.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, k.raised_at DESC LIMIT 300;
END $function$;

-- ---------- coaching ----------
CREATE OR REPLACE FUNCTION public.dv_coaching_assign(p_adviser uuid, p_type text, p_title text, p_description text, p_priority text, p_due date, p_review uuid DEFAULT NULL, p_call uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE o uuid := dv_compliance_gate(); cid uuid; tt text := nullif(btrim(coalesce(p_title,'')),'');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM organization_users WHERE organization_id = o AND user_id = p_adviser) THEN RAISE EXCEPTION 'choose a colleague' USING ERRCODE = '22023'; END IF;
  IF p_type NOT IN ('feedback','training','coaching_session','corrective_action','improvement_plan') OR p_priority NOT IN ('low','normal','high','critical') THEN RAISE EXCEPTION 'choose a type and priority' USING ERRCODE = '22023'; END IF;
  IF tt IS NULL OR length(tt) < 3 OR length(tt) > 150 OR length(coalesce(p_description,'')) > 2000 THEN RAISE EXCEPTION 'give the action a title (3 to 150 characters)' USING ERRCODE = '22023'; END IF;
  IF p_due IS NULL OR p_due < current_date OR p_due > current_date + 180 THEN RAISE EXCEPTION 'choose a due date within 180 days' USING ERRCODE = '22023'; END IF;
  IF p_review IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dv_call_reviews WHERE id = p_review AND organization_id = o) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF p_call IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dv_call_sessions WHERE id = p_call AND organization_id = o) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  INSERT INTO dv_coaching_actions (organization_id, adviser_id, review_id, call_id, action_type, title, description, priority, assigned_by, due_date)
  VALUES (o, p_adviser, p_review, p_call, p_type, tt, nullif(btrim(coalesce(p_description,'')),''), p_priority, auth.uid(), p_due) RETURNING id INTO cid;
  IF p_review IS NOT NULL THEN PERFORM dv_rev_step(p_review, o, 'coaching_assigned', jsonb_build_object('action', cid)); END IF;
  IF p_call IS NOT NULL THEN PERFORM dv_call_acc(p_call, o, 'coaching_added', jsonb_build_object('action', cid)); END IF;
  RETURN cid;
END $function$;

CREATE OR REPLACE FUNCTION public.dv_coaching_list(p_scope text DEFAULT 'open', p_adviser uuid DEFAULT NULL)
RETURNS TABLE (id uuid, adviser_id uuid, adviser_name text, action_type text, title text, description text, status text, priority text, due_date date, overdue boolean, assigned_by_name text, review_id uuid, call_id uuid,
  completed_at timestamptz, completion_notes text, feedback_text text, manager_rating int)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE o uuid := dv_compliance_gate();
BEGIN
  IF p_scope NOT IN ('open','all','completed') THEN RAISE EXCEPTION 'unknown filter' USING ERRCODE = '22023'; END IF;
  RETURN QUERY SELECT a.id, a.adviser_id, coalesce(pa.full_name, pa.email)::text, a.action_type, a.title, a.description, a.status, a.priority, a.due_date, (a.status IN ('open','in_progress') AND a.due_date < current_date),
      coalesce(pb.full_name, pb.email)::text, a.review_id, a.call_id, a.completed_at, a.completion_notes, a.feedback_text, a.manager_rating
    FROM dv_coaching_actions a LEFT JOIN profiles pa ON pa.id = a.adviser_id LEFT JOIN profiles pb ON pb.id = a.assigned_by
   WHERE a.organization_id = o AND (p_adviser IS NULL OR a.adviser_id = p_adviser) AND CASE p_scope WHEN 'open' THEN a.status IN ('open','in_progress') WHEN 'completed' THEN a.status = 'completed' ELSE true END
   ORDER BY (a.status IN ('open','in_progress')) DESC, a.due_date LIMIT 300;
END $function$;

CREATE OR REPLACE FUNCTION public.dv_my_coaching()
RETURNS TABLE (id uuid, action_type text, title text, description text, status text, priority text, due_date date, overdue boolean, call_id uuid, assigned_by_name text, feedback_text text, manager_rating int)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE o uuid := dv_my_org();
BEGIN
  IF o IS NULL OR NOT dv_org_has_product(o, 'compliance') THEN RETURN; END IF;
  RETURN QUERY SELECT a.id, a.action_type, a.title, a.description, a.status, a.priority, a.due_date, (a.status IN ('open','in_progress') AND a.due_date < current_date), a.call_id, coalesce(pb.full_name, pb.email)::text, a.feedback_text, a.manager_rating
    FROM dv_coaching_actions a LEFT JOIN profiles pb ON pb.id = a.assigned_by
   WHERE a.organization_id = o AND a.adviser_id = auth.uid() AND (a.status IN ('open','in_progress') OR a.completed_at > now() - interval '30 days') ORDER BY (a.status = 'completed'), a.due_date LIMIT 50;
END $function$;

CREATE OR REPLACE FUNCTION public.dv_coaching_update(p_id uuid, p_status text, p_notes text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE a dv_coaching_actions; nt text := nullif(btrim(coalesce(p_notes,'')),'');
BEGIN
  SELECT * INTO a FROM dv_coaching_actions WHERE id = p_id FOR UPDATE;
  IF a.id IS NULL OR NOT dv_org_has_product(a.organization_id, 'compliance') OR NOT (a.adviser_id = auth.uid() OR (dv_is_manager(a.organization_id) AND dv_is_org_member(a.organization_id))) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF a.status NOT IN ('open','in_progress') OR p_status NOT IN ('in_progress','completed') THEN RAISE EXCEPTION 'cannot change this action' USING ERRCODE = '22023'; END IF;
  IF p_status = 'completed' AND (nt IS NULL OR length(nt) < 5 OR length(nt) > 1000) THEN RAISE EXCEPTION 'say what was done (5 to 1000 characters)' USING ERRCODE = '22023'; END IF;
  UPDATE dv_coaching_actions SET status = p_status, completed_at = CASE WHEN p_status = 'completed' THEN now() END, completion_notes = CASE WHEN p_status = 'completed' THEN nt END WHERE id = a.id;
  IF p_status = 'completed' AND a.review_id IS NOT NULL THEN PERFORM dv_rev_step(a.review_id, a.organization_id, 'coaching_completed', jsonb_build_object('action', a.id)); END IF;
END $function$;
CREATE OR REPLACE FUNCTION public.dv_coaching_review(p_id uuid, p_rating int, p_feedback text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE o uuid := dv_compliance_gate(); a dv_coaching_actions;
BEGIN
  SELECT * INTO a FROM dv_coaching_actions WHERE id = p_id AND organization_id = o FOR UPDATE;
  IF a.id IS NULL OR a.status <> 'completed' THEN RAISE EXCEPTION 'only a completed action can be reviewed' USING ERRCODE = '22023'; END IF;
  IF p_rating IS NULL OR p_rating NOT BETWEEN 1 AND 5 OR length(coalesce(p_feedback,'')) > 1000 THEN RAISE EXCEPTION 'rate 1 to 5 and keep feedback under 1000 characters' USING ERRCODE = '22023'; END IF;
  UPDATE dv_coaching_actions SET manager_rating = p_rating, feedback_text = nullif(btrim(coalesce(p_feedback,'')),'') WHERE id = a.id;
END $function$;
CREATE OR REPLACE FUNCTION public.dv_coaching_cancel(p_id uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE o uuid := dv_compliance_gate(); a dv_coaching_actions; rs text := nullif(btrim(coalesce(p_reason,'')),'');
BEGIN
  SELECT * INTO a FROM dv_coaching_actions WHERE id = p_id AND organization_id = o FOR UPDATE;
  IF a.id IS NULL OR a.status NOT IN ('open','in_progress') THEN RAISE EXCEPTION 'cannot cancel this action' USING ERRCODE = '22023'; END IF;
  IF rs IS NULL OR length(rs) < 5 OR length(rs) > 300 THEN RAISE EXCEPTION 'give a reason (5 to 300 characters)' USING ERRCODE = '22023'; END IF;
  UPDATE dv_coaching_actions SET status = 'cancelled', cancel_reason = rs WHERE id = a.id;
END $function$;

-- ---------- audit ----------
CREATE OR REPLACE FUNCTION public.dv_compliance_audit(p_limit int DEFAULT 100, p_action text DEFAULT NULL, p_from date DEFAULT NULL, p_to date DEFAULT NULL, p_user uuid DEFAULT NULL)
RETURNS TABLE (at timestamptz, user_id uuid, user_name text, action text, call_id uuid, detail jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE o uuid := dv_compliance_gate();
BEGIN
  RETURN QUERY SELECT l.at, l.user_id, coalesce(p.full_name, p.email)::text, l.action, l.call_id, l.detail FROM dv_call_access_log l LEFT JOIN profiles p ON p.id = l.user_id
   WHERE l.organization_id = o AND (p_action IS NULL OR l.action = p_action) AND (p_from IS NULL OR l.at >= p_from) AND (p_to IS NULL OR l.at < p_to + 1) AND (p_user IS NULL OR l.user_id = p_user)
   ORDER BY l.at DESC LIMIT least(greatest(coalesce(p_limit, 100), 1), 500);
END $function$;

-- ---------- reports ----------
CREATE OR REPLACE FUNCTION public.dv_compliance_report(p_type text, p_from date, p_to date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE o uuid := dv_compliance_gate(); cols jsonb; rws jsonb; ttl text;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 366 THEN RAISE EXCEPTION 'choose a date range of up to a year' USING ERRCODE = '22023'; END IF;
  IF p_type = 'compliance_summary' THEN
    ttl := 'Compliance summary'; cols := '["Measure","Value"]'::jsonb;
    SELECT jsonb_agg(jsonb_build_array(m, v::text) ORDER BY ord) INTO rws FROM (VALUES
      (1,'Calls handled', (SELECT count(*) FROM dv_call_sessions WHERE organization_id = o AND started_at >= p_from AND started_at < p_to + 1 AND outcome <> 'pending')),
      (2,'Calls recorded', (SELECT count(*) FROM dv_call_sessions WHERE organization_id = o AND started_at >= p_from AND started_at < p_to + 1 AND recording_ref IS NOT NULL)),
      (3,'Calls reviewed (approved)', (SELECT count(*) FROM dv_call_reviews r JOIN dv_call_sessions s ON s.id = r.call_id WHERE r.organization_id = o AND r.status = 'approved' AND s.started_at >= p_from AND s.started_at < p_to + 1)),
      (4,'Compliant', (SELECT count(*) FROM dv_call_reviews r JOIN dv_call_sessions s ON s.id = r.call_id WHERE r.organization_id = o AND r.status = 'approved' AND r.outcome = 'compliant' AND s.started_at >= p_from AND s.started_at < p_to + 1)),
      (5,'Minor issues', (SELECT count(*) FROM dv_call_reviews r JOIN dv_call_sessions s ON s.id = r.call_id WHERE r.organization_id = o AND r.status = 'approved' AND r.outcome = 'minor_issues' AND s.started_at >= p_from AND s.started_at < p_to + 1)),
      (6,'Major issues', (SELECT count(*) FROM dv_call_reviews r JOIN dv_call_sessions s ON s.id = r.call_id WHERE r.organization_id = o AND r.status = 'approved' AND r.outcome = 'major_issues' AND s.started_at >= p_from AND s.started_at < p_to + 1)),
      (7,'Non-compliant', (SELECT count(*) FROM dv_call_reviews r JOIN dv_call_sessions s ON s.id = r.call_id WHERE r.organization_id = o AND r.status = 'approved' AND r.outcome = 'non_compliant' AND s.started_at >= p_from AND s.started_at < p_to + 1)),
      (8,'Average score', (SELECT coalesce(round(avg(r.score))::int, 0) FROM dv_call_reviews r JOIN dv_call_sessions s ON s.id = r.call_id WHERE r.organization_id = o AND r.status = 'approved' AND s.started_at >= p_from AND s.started_at < p_to + 1)),
      (9,'Escalated reviews', (SELECT count(*) FROM dv_call_reviews WHERE organization_id = o AND is_escalated AND escalated_at >= p_from AND escalated_at < p_to + 1)),
      (10,'Coaching actions set', (SELECT count(*) FROM dv_coaching_actions WHERE organization_id = o AND created_at >= p_from AND created_at < p_to + 1))
    ) t(ord, m, v);
  ELSIF p_type = 'adviser_performance' THEN
    ttl := 'Adviser performance'; cols := '["Adviser","Calls","Reviewed","Average score","Compliant","Minor","Major","Non-compliant"]'::jsonb;
    SELECT coalesce(jsonb_agg(jsonb_build_array(x.name, x.calls::text, x.reviewed::text, coalesce(x.avg::text, ''), x.c::text, x.mi::text, x.ma::text, x.nc::text) ORDER BY x.name), '[]'::jsonb) INTO rws FROM (
      SELECT coalesce(p.full_name, p.email) AS name, count(DISTINCT s.id) calls, count(DISTINCT r.id) reviewed, round(avg(r.score)) avg, count(*) FILTER (WHERE r.outcome = 'compliant') c, count(*) FILTER (WHERE r.outcome = 'minor_issues') mi,
             count(*) FILTER (WHERE r.outcome = 'major_issues') ma, count(*) FILTER (WHERE r.outcome = 'non_compliant') nc
        FROM dv_call_sessions s LEFT JOIN dv_call_reviews r ON r.call_id = s.id AND r.status = 'approved' LEFT JOIN profiles p ON p.id = s.adviser_id
       WHERE s.organization_id = o AND s.adviser_id IS NOT NULL AND s.started_at >= p_from AND s.started_at < p_to + 1 AND s.outcome <> 'pending' GROUP BY p.full_name, p.email) x;
  ELSIF p_type = 'risk_analysis' THEN
    ttl := 'Risk analysis'; cols := '["Risk type","Severity","Raised","Still open"]'::jsonb;
    SELECT coalesce(jsonb_agg(jsonb_build_array(replace(k.risk_type, '_', ' '), k.severity, k.n::text, k.n_open::text) ORDER BY k.risk_type, k.severity), '[]'::jsonb) INTO rws FROM (
      SELECT risk_type, severity, count(*) n, count(*) FILTER (WHERE status = 'open') n_open FROM dv_call_risk_indicators WHERE organization_id = o AND raised_at >= p_from AND raised_at < p_to + 1 GROUP BY 1, 2) k;
  ELSIF p_type = 'audit_trail' THEN
    ttl := 'Call access audit trail'; cols := '["When","User","Action","Call","Detail"]'::jsonb;
    SELECT coalesce(jsonb_agg(jsonb_build_array(to_char(l.at, 'YYYY-MM-DD HH24:MI'), coalesce(p.full_name, p.email), l.action, l.call_id::text, l.detail::text) ORDER BY l.at DESC), '[]'::jsonb) INTO rws FROM (
      SELECT * FROM dv_call_access_log WHERE organization_id = o AND at >= p_from AND at < p_to + 1 ORDER BY at DESC LIMIT 5000) l LEFT JOIN profiles p ON p.id = l.user_id;
  ELSIF p_type = 'complaint_trends' THEN
    ttl := 'Complaint indicators by week'; cols := '["Week starting","Calls flagged as possible complaint","Complaint-risk indicators raised"]'::jsonb;
    SELECT coalesce(jsonb_agg(jsonb_build_array(to_char(w.wk, 'YYYY-MM-DD'), w.calls::text, w.risks::text) ORDER BY w.wk), '[]'::jsonb) INTO rws FROM (
      SELECT g.wk, (SELECT count(*) FROM dv_call_sessions s WHERE s.organization_id = o AND s.possible_complaint AND s.started_at >= g.wk AND s.started_at < g.wk + interval '7 days') calls,
             (SELECT count(*) FROM dv_call_risk_indicators k WHERE k.organization_id = o AND k.risk_type = 'complaint_risk' AND k.raised_at >= g.wk AND k.raised_at < g.wk + interval '7 days') risks
        FROM generate_series(date_trunc('week', p_from::timestamp), p_to::timestamp, interval '7 days') AS g(wk)) w;
  ELSIF p_type = 'regulatory_return' THEN
    ttl := 'Regulatory return'; cols := '["Measure","Value"]'::jsonb;
    SELECT jsonb_agg(jsonb_build_array(m, v::text) ORDER BY ord) INTO rws FROM (VALUES
      (1,'Calls in period', (SELECT count(*) FROM dv_call_sessions WHERE organization_id = o AND started_at >= p_from AND started_at < p_to + 1)),
      (2,'Calls with recording notice confirmed', (SELECT count(*) FROM dv_call_sessions WHERE organization_id = o AND started_at >= p_from AND started_at < p_to + 1 AND recording_notice_given)),
      (3,'Client conversations without confirmed notice', (SELECT count(*) FROM dv_call_sessions WHERE organization_id = o AND started_at >= p_from AND started_at < p_to + 1 AND outcome = 'spoke_to_client' AND recording_notice_given IS NOT TRUE)),
      (4,'Recordings paused during a call', (SELECT count(DISTINCT call_id) FROM dv_call_recording_events WHERE organization_id = o AND event = 'paused' AND at >= p_from AND at < p_to + 1)),
      (5,'Calls with vulnerability flagged', (SELECT count(*) FROM dv_call_sessions WHERE organization_id = o AND started_at >= p_from AND started_at < p_to + 1 AND vulnerability_flag)),
      (6,'Calls flagged as possible complaint', (SELECT count(*) FROM dv_call_sessions WHERE organization_id = o AND started_at >= p_from AND started_at < p_to + 1 AND possible_complaint)),
      (7,'Calls reviewed and approved', (SELECT count(*) FROM dv_call_reviews r JOIN dv_call_sessions s ON s.id = r.call_id WHERE r.organization_id = o AND r.status = 'approved' AND s.started_at >= p_from AND s.started_at < p_to + 1)),
      (8,'Reviews outcome non-compliant or major issues', (SELECT count(*) FROM dv_call_reviews r JOIN dv_call_sessions s ON s.id = r.call_id WHERE r.organization_id = o AND r.status = 'approved' AND r.outcome IN ('non_compliant','major_issues') AND s.started_at >= p_from AND s.started_at < p_to + 1)),
      (9,'Call record retention (years)', coalesce((SELECT retention_years FROM dv_telephony_settings WHERE organization_id = o), 6))
    ) t(ord, m, v);
  ELSE RAISE EXCEPTION 'unknown report' USING ERRCODE = '22023';
  END IF;
  RETURN jsonb_build_object('title', ttl, 'from', p_from, 'to', p_to, 'columns', cols, 'rows', coalesce(rws, '[]'::jsonb), 'generated_at', now());
END $function$;

-- ---------- call record ----------
CREATE OR REPLACE FUNCTION public.dv_call_detail(p_call uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE s dv_call_sessions; mgr boolean; rv dv_call_reviews; res jsonb; own boolean;
BEGIN
  s := dv_call_load(p_call, false);
  mgr := dv_is_manager(s.organization_id) AND dv_org_has_product(s.organization_id, 'compliance');
  own := s.adviser_id = auth.uid();
  PERFORM dv_call_acc(s.id, s.organization_id, 'view_call');
  SELECT * INTO rv FROM dv_call_reviews WHERE call_id = s.id;
  res := jsonb_build_object(
    'call', to_jsonb(s) - 'recording_ref' - 'created_by' - 'provider_call_id',
    'has_recording', s.recording_ref IS NOT NULL, 'has_transcript', EXISTS (SELECT 1 FROM dv_call_transcripts WHERE call_id = s.id),
    'can_hear', s.recording_ref IS NOT NULL AND (own OR mgr), 'can_download', s.recording_ref IS NOT NULL AND mgr, 'can_read_transcript', own OR mgr, 'is_compliance_manager', mgr,
    'events', coalesce((SELECT jsonb_agg(jsonb_build_object('event', e.event, 'detail', e.detail, 'at', e.at, 'by', coalesce(p.full_name, p.email)) ORDER BY e.at) FROM dv_call_events e LEFT JOIN profiles p ON p.id = e.actor WHERE e.call_id = s.id), '[]'::jsonb),
    'drafts', coalesce((SELECT jsonb_agg(jsonb_build_object('id', d.id, 'kind', d.kind, 'body', d.body, 'payload', d.payload, 'model', d.model, 'model_version', d.model_version, 'confidence', d.confidence, 'status', d.status, 'final_body', d.final_body, 'decided_at', d.decided_at) ORDER BY d.created_at)
                         FROM dv_call_ai_drafts d WHERE d.call_id = s.id), '[]'::jsonb),
    'participants', coalesce((SELECT jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'role', x.role, 'type', x.ptype, 'joined_at', x.joined_at, 'left_at', x.left_at) ORDER BY x.joined_at) FROM dv_call_participants x WHERE x.call_id = s.id), '[]'::jsonb),
    'notes', coalesce((SELECT jsonb_agg(jsonb_build_object('id', n.id, 'text', n.note_text, 'tag', n.tag, 'follow_up', n.is_follow_up, 'due', n.follow_up_due, 'completed', n.is_completed, 'at', n.created_at, 'by', coalesce(p.full_name, p.email)) ORDER BY n.created_at)
                         FROM dv_call_notes n LEFT JOIN profiles p ON p.id = n.created_by WHERE n.call_id = s.id), '[]'::jsonb),
    'recording_events', coalesce((SELECT jsonb_agg(jsonb_build_object('event', r.event, 'reason', r.reason, 'at', r.at, 'seconds', r.duration_seconds) ORDER BY r.at) FROM dv_call_recording_events r WHERE r.call_id = s.id), '[]'::jsonb),
    'callbacks', coalesce((SELECT jsonb_agg(jsonb_build_object('id', b.id, 'scheduled_at', b.scheduled_at, 'status', b.status, 'priority', b.priority) ORDER BY b.scheduled_at) FROM dv_call_callbacks b WHERE b.call_id = s.id), '[]'::jsonb),
    'risks', CASE WHEN mgr THEN coalesce((SELECT jsonb_agg(jsonb_build_object('id', k.id, 'type', k.risk_type, 'severity', k.severity, 'description', k.description, 'status', k.status, 'raised_at', k.raised_at) ORDER BY k.raised_at) FROM dv_call_risk_indicators k WHERE k.call_id = s.id), '[]'::jsonb) ELSE '[]'::jsonb END,
    'review', CASE WHEN rv.id IS NULL THEN NULL
      WHEN mgr THEN jsonb_build_object('id', rv.id, 'status', rv.status, 'priority', rv.priority, 'reviewer_id', rv.reviewer_id, 'reviewer', (SELECT coalesce(full_name, email) FROM profiles WHERE id = rv.reviewer_id), 'due_date', rv.due_date, 'outcome', rv.outcome, 'score', rv.score,
           'checklist', rv.checklist, 'issues', rv.issues, 'corrective_actions', rv.corrective_actions, 'comments', rv.comments, 'decision_note', rv.decision_note, 'is_escalated', rv.is_escalated, 'escalation_reason', rv.escalation_reason,
           'mine', rv.reviewer_id = auth.uid(), 'submitted_at', rv.submitted_at, 'approved_at', rv.approved_at,
           'steps', coalesce((SELECT jsonb_agg(jsonb_build_object('step', st.step, 'detail', st.detail, 'at', st.at, 'by', coalesce(p.full_name, p.email)) ORDER BY st.at) FROM dv_call_review_steps st LEFT JOIN profiles p ON p.id = st.actor WHERE st.review_id = rv.id), '[]'::jsonb),
           'assignments', coalesce((SELECT jsonb_agg(jsonb_build_object('to', coalesce(p.full_name, p.email), 'status', a.status, 'assigned_at', a.assigned_at, 'reason', a.reason) ORDER BY a.assigned_at) FROM dv_call_review_assignments a LEFT JOIN profiles p ON p.id = a.assigned_to WHERE a.review_id = rv.id), '[]'::jsonb))
      WHEN rv.status = 'approved' AND own THEN jsonb_build_object('status', rv.status, 'outcome', rv.outcome, 'score', rv.score, 'issues', rv.issues, 'corrective_actions', rv.corrective_actions)
      ELSE NULL END);
  RETURN res;
END $function$;

CREATE OR REPLACE FUNCTION public.dv_call_ai_decide(p_draft uuid, p_decision text, p_final_body text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE d dv_call_ai_drafts; s dv_call_sessions; st text;
BEGIN
  SELECT * INTO d FROM dv_call_ai_drafts WHERE id = p_draft FOR UPDATE;
  IF d.id IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  s := dv_call_load(d.call_id, true);
  IF d.status <> 'draft' THEN RAISE EXCEPTION 'this draft has already been decided' USING ERRCODE = '22023'; END IF;
  st := CASE p_decision WHEN 'approve' THEN 'approved' WHEN 'amend' THEN 'amended' WHEN 'reject' THEN 'rejected' ELSE NULL END;
  IF st IS NULL THEN RAISE EXCEPTION 'choose approve, amend or reject' USING ERRCODE = '22023'; END IF;
  IF st = 'amended' AND (p_final_body IS NULL OR btrim(p_final_body) = '') THEN RAISE EXCEPTION 'enter the corrected text' USING ERRCODE = '22023'; END IF;
  UPDATE dv_call_ai_drafts SET status = st, final_body = CASE st WHEN 'amended' THEN btrim(p_final_body) WHEN 'approved' THEN body ELSE NULL END, decided_by = auth.uid(), decided_at = now() WHERE id = p_draft;
  PERFORM dv_call_ev(s.id, s.organization_id, 'ai_draft_decided', jsonb_build_object('kind', d.kind, 'decision', st));
  IF st IN ('approved','amended') THEN PERFORM dv_call_acc(s.id, s.organization_id, CASE WHEN st = 'approved' THEN 'summary_approved' ELSE 'summary_amended' END, jsonb_build_object('kind', d.kind)); END IF;
END $function$;

CREATE OR REPLACE FUNCTION public.dv_call_transcript(p_call uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE s dv_call_sessions; t dv_call_transcripts;
BEGIN
  s := dv_call_load(p_call, false);
  IF NOT (s.adviser_id = auth.uid() OR (dv_is_manager(s.organization_id) AND dv_org_has_product(s.organization_id, 'compliance'))) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO t FROM dv_call_transcripts WHERE call_id = s.id;
  IF t.id IS NULL THEN RETURN NULL; END IF;
  PERFORM dv_call_acc(s.id, s.organization_id, 'view_transcript');
  RETURN jsonb_build_object('body', t.body, 'language', t.language, 'confidence', t.confidence);
END $function$;

-- Playback is two steps: the signed-in user is checked and logged here, then the edge function (service role) fetches the reference.
CREATE OR REPLACE FUNCTION public.dv_call_recording_check(p_call uuid, p_download boolean DEFAULT false) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE s dv_call_sessions; mgr boolean;
BEGIN
  s := dv_call_load(p_call, false);
  mgr := dv_is_manager(s.organization_id) AND dv_org_has_product(s.organization_id, 'compliance');
  IF s.recording_ref IS NULL OR s.recording_status <> 'available' THEN RAISE EXCEPTION 'there is no recording for this call' USING ERRCODE = '22023'; END IF;
  IF coalesce(p_download, false) THEN IF NOT mgr THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  ELSIF NOT (mgr OR s.adviser_id = auth.uid()) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  PERFORM dv_call_acc(s.id, s.organization_id, CASE WHEN coalesce(p_download, false) THEN 'download_recording' ELSE 'play_recording' END);
  RETURN true;
END $function$;
CREATE OR REPLACE FUNCTION public.dv_call_recording_ref(p_call uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$ SELECT recording_ref FROM dv_call_sessions WHERE id = p_call; $$;

-- ---------- grants ----------
DO $$ DECLARE f text; BEGIN
  REVOKE ALL ON FUNCTION public.dv_rev_step(uuid,uuid,text,jsonb) FROM PUBLIC, anon, authenticated;
  FOREACH f IN ARRAY ARRAY['dv_compliance_assign(uuid,uuid,text,date)','dv_compliance_claim(uuid)','dv_compliance_start(uuid)','dv_compliance_submit(uuid,text,jsonb,jsonb,jsonb,text)','dv_compliance_decide(uuid,text,text)',
    'dv_compliance_escalate(uuid,uuid,text)','dv_compliance_reassign(uuid,uuid,text)','dv_compliance_decline(uuid,text)','dv_compliance_extend(uuid,date,text)','dv_compliance_queue(text)','dv_compliance_unreviewed(int)',
    'dv_compliance_dashboard(int)','dv_compliance_search(jsonb,int,int)','dv_compliance_adviser_qa(int,uuid)','dv_call_risk_raise(uuid,text,text,text)','dv_call_risk_resolve(uuid,text)','dv_compliance_risks(text)',
    'dv_coaching_assign(uuid,text,text,text,text,date,uuid,uuid)','dv_coaching_list(text,uuid)','dv_my_coaching()','dv_coaching_update(uuid,text,text)','dv_coaching_review(uuid,int,text)','dv_coaching_cancel(uuid,text)',
    'dv_compliance_audit(int,text,date,date,uuid)','dv_compliance_report(text,date,date)','dv_call_detail(uuid)','dv_call_ai_decide(uuid,text,text)','dv_call_transcript(uuid)','dv_call_recording_check(uuid,boolean)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
  REVOKE ALL ON FUNCTION public.dv_call_recording_ref(uuid) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.dv_call_recording_ref(uuid) TO service_role;
END $$;
