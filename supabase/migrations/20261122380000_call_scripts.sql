-- Firm call scripts: a firm lists the points an adviser must cover on a call. The AI marks each point covered or missed
-- from the real transcript as a draft; a human reviewer confirms or changes every answer; the score is the share of
-- answered points the reviewer marked covered. Versions are never edited, a review keeps the script it started with.
ALTER TABLE public.dv_call_reviews ADD COLUMN IF NOT EXISTS script_points jsonb;
CREATE TABLE IF NOT EXISTS public.dv_call_scripts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, version int NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 80), points jsonb NOT NULL CHECK (jsonb_typeof(points) = 'array' AND jsonb_array_length(points) BETWEEN 1 AND 40),
  is_active boolean NOT NULL DEFAULT true, created_by uuid, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (organization_id, version));
CREATE UNIQUE INDEX IF NOT EXISTS dv_call_scripts_one_active ON public.dv_call_scripts (organization_id) WHERE is_active;
ALTER TABLE public.dv_call_scripts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dv_call_scripts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.dv_call_scripts TO service_role;
DROP POLICY IF EXISTS deny_all_clients ON public.dv_call_scripts;
CREATE POLICY deny_all_clients ON public.dv_call_scripts AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
DROP TRIGGER IF EXISTS trg_no_delete ON public.dv_call_scripts;
CREATE TRIGGER trg_no_delete BEFORE DELETE ON public.dv_call_scripts FOR EACH ROW EXECUTE FUNCTION public.dv_no_delete();
DROP TRIGGER IF EXISTS trg_audit_row ON public.dv_call_scripts;
CREATE TRIGGER trg_audit_row AFTER INSERT OR UPDATE OR DELETE ON public.dv_call_scripts FOR EACH ROW EXECUTE FUNCTION public.dv_audit_row();

-- the script in force: the firm's active one, or the built-in nine-point checklist when none has been set
CREATE OR REPLACE FUNCTION public.dv_call_script_active(p_org uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
  SELECT coalesce((SELECT jsonb_build_object('id', s.id, 'version', s.version, 'name', s.name, 'points', s.points, 'is_default', false) FROM dv_call_scripts s WHERE s.organization_id = p_org AND s.is_active),
    jsonb_build_object('id', NULL, 'version', 0, 'name', 'Standard call checklist', 'is_default', true, 'points', jsonb_build_array(
      jsonb_build_object('key','recording_notice','label','Told the client the call may be recorded','guidance',''),
      jsonb_build_object('key','identity_checked','label','Checked who they were speaking to','guidance',''),
      jsonb_build_object('key','affordability_discussed','label','Talked through what the client can afford','guidance',''),
      jsonb_build_object('key','vulnerability_considered','label','Asked about and considered vulnerability','guidance',''),
      jsonb_build_object('key','options_explained','label','Explained the options clearly','guidance',''),
      jsonb_build_object('key','fees_explained','label','Explained any fees and charges','guidance',''),
      jsonb_build_object('key','no_pressure','label','No pressure on the client','guidance',''),
      jsonb_build_object('key','accurate_information','label','Information given was accurate','guidance',''),
      jsonb_build_object('key','next_steps_agreed','label','Next steps agreed','guidance',''))));
$$;
REVOKE ALL ON FUNCTION public.dv_call_script_active(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dv_call_script_active(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.dv_call_script_get() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE o uuid := dv_compliance_gate();
BEGIN
  RETURN jsonb_build_object('active', dv_call_script_active(o), 'can_edit', dv_is_org_admin(o),
    'labels', (SELECT coalesce(jsonb_object_agg(k, l), '{}'::jsonb) FROM (
        SELECT p->>'key' k, p->>'label' l FROM dv_call_scripts s, jsonb_array_elements(s.points) p WHERE s.organization_id = o
        UNION SELECT p->>'key', p->>'label' FROM jsonb_array_elements((dv_call_script_active(NULL))->'points') p) x),
    'versions', (SELECT coalesce(jsonb_agg(jsonb_build_object('version', s.version, 'name', s.name, 'points', jsonb_array_length(s.points), 'is_active', s.is_active, 'created_at', s.created_at) ORDER BY s.version DESC), '[]'::jsonb) FROM dv_call_scripts s WHERE s.organization_id = o));
END $function$;

-- save a new version (admin only). Existing points keep their key so history lines up; new points get a fresh letter-only key.
CREATE OR REPLACE FUNCTION public.dv_call_script_save(p_name text, p_points jsonb) RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE o uuid := dv_compliance_gate(); v int; pts jsonb := '[]'::jsonb; e jsonb; k text; lbl text; gd text; known text[]; seen text[] := '{}';
BEGIN
  IF NOT dv_is_org_admin(o) THEN RAISE EXCEPTION 'only an administrator can change the call script' USING ERRCODE = '42501'; END IF;
  IF p_name IS NULL OR length(btrim(p_name)) < 2 OR length(p_name) > 80 THEN RAISE EXCEPTION 'name the script (2 to 80 characters)' USING ERRCODE = '22023'; END IF;
  IF p_points IS NULL OR jsonb_typeof(p_points) <> 'array' OR jsonb_array_length(p_points) NOT BETWEEN 1 AND 40 THEN RAISE EXCEPTION 'a script needs 1 to 40 points' USING ERRCODE = '22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('dv_call_script:' || o::text));
  SELECT array_agg(p->>'key') INTO known FROM dv_call_scripts s, jsonb_array_elements(s.points) p WHERE s.organization_id = o;
  known := coalesce(known, '{}') || ARRAY(SELECT p->>'key' FROM jsonb_array_elements((dv_call_script_active(NULL))->'points') p);
  FOR e IN SELECT value FROM jsonb_array_elements(p_points) LOOP
    IF jsonb_typeof(e) <> 'object' THEN RAISE EXCEPTION 'script points are malformed' USING ERRCODE = '22023'; END IF;
    lbl := btrim(coalesce(e->>'label','')); gd := btrim(coalesce(e->>'guidance',''));
    IF length(lbl) < 3 OR length(lbl) > 200 THEN RAISE EXCEPTION 'each point needs a description of 3 to 200 characters' USING ERRCODE = '22023'; END IF;
    IF length(gd) > 600 THEN RAISE EXCEPTION 'guidance for a point can be up to 600 characters' USING ERRCODE = '22023'; END IF;
    k := e->>'key';
    IF k IS NULL OR NOT (k = ANY (known)) OR k = ANY (seen) THEN
      k := 'pt_' || translate(substr(md5(gen_random_uuid()::text), 1, 8), '0123456789', 'ghijklmnop');
    END IF;
    seen := seen || k;
    pts := pts || jsonb_build_array(jsonb_build_object('key', k, 'label', lbl, 'guidance', gd));
  END LOOP;
  SELECT coalesce(max(version), 0) + 1 INTO v FROM dv_call_scripts WHERE organization_id = o;
  UPDATE dv_call_scripts SET is_active = false WHERE organization_id = o AND is_active;
  INSERT INTO dv_call_scripts (organization_id, version, name, points, created_by) VALUES (o, v, btrim(p_name), pts, auth.uid());
  RETURN v;
END $function$;

-- the script a review was started with (a manager of the same firm only)
CREATE OR REPLACE FUNCTION public.dv_call_script_review(p_review uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE o uuid := dv_compliance_gate(); r dv_call_reviews;
BEGIN
  SELECT * INTO r FROM dv_call_reviews WHERE id = p_review AND organization_id = o;
  IF r.id IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  RETURN coalesce(r.script_points, (dv_call_script_active(o))->'points');
END $function$;

-- review start now freezes the script; submit checks answers against it
CREATE OR REPLACE FUNCTION public.dv_compliance_start(p_review uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE o uuid := dv_compliance_gate(); r dv_call_reviews;
BEGIN
  SELECT * INTO r FROM dv_call_reviews WHERE id = p_review AND organization_id = o FOR UPDATE;
  IF r.id IS NULL OR r.reviewer_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF r.status NOT IN ('assigned','rejected') THEN RAISE EXCEPTION 'this review cannot be started' USING ERRCODE = '22023'; END IF;
  UPDATE dv_call_reviews SET status = 'in_review', started_at = coalesce(started_at, now()), script_points = coalesce(script_points, (dv_call_script_active(o))->'points'), updated_at = now() WHERE id = r.id;
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
  IF r.script_points IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_checklist) k WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(r.script_points) sp WHERE sp->>'key' = k)) THEN RAISE EXCEPTION 'an answer does not belong to the call script' USING ERRCODE = '22023'; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(r.script_points) sp WHERE NOT (p_checklist ? (sp->>'key'))) THEN RAISE EXCEPTION 'answer every point of the call script' USING ERRCODE = '22023'; END IF;
  END IF;
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

-- the AI gets the script too
CREATE OR REPLACE FUNCTION public.dv_call_ai_context(p_call uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT jsonb_build_object('transcript', t.body, 'direction', s.direction, 'case_id', s.case_id, 'organization_id', s.organization_id, 'script', dv_call_script_active(s.organization_id))
    FROM dv_call_sessions s JOIN dv_call_transcripts t ON t.call_id = s.id JOIN dv_telephony_settings ts ON ts.organization_id = s.organization_id AND ts.ai_analysis_enabled
   WHERE s.id = p_call AND s.case_id IS NOT NULL;
$$;

DO $$ DECLARE f text; BEGIN
  FOREACH f IN ARRAY ARRAY['dv_call_script_get()','dv_call_script_save(text,jsonb)','dv_call_script_review(uuid)','dv_compliance_start(uuid)','dv_compliance_submit(uuid,text,jsonb,jsonb,jsonb,text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
  REVOKE ALL ON FUNCTION public.dv_call_ai_context(uuid) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.dv_call_ai_context(uuid) TO service_role;
END $$;
