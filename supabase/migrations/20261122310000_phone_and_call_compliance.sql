-- Phone (call log tied to the case) and Call compliance (review, QA, coaching, access trail) as separately licensed add-ons.
-- Replaces the original Storm Call tables, whose rules let every staff member read, edit and delete every call.
-- No AI scoring here: nothing is shown as a transcript or score unless a real source wrote it, and a person approves it.

-- ---------- 1. close the original tables (all empty) ----------
DO $$ DECLARE t text; p record; BEGIN
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname LIKE 'storm_call\_%' ESCAPE '\' LOOP
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, t);
    END LOOP;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('CREATE POLICY deny_all_clients ON public.%I AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)', t);
  END LOOP;
END $$;

-- ---------- 2. licences ----------
INSERT INTO dv_products (key, name, description, display_order) VALUES
  ('voip', 'Phone', 'Call log tied to the case: every call, its outcome, flags, follow-ups, and AI-drafted notes that a person approves', 30),
  ('compliance', 'Call compliance', 'Call review and quality assurance: review queue, checklists, adviser QA, coaching and an access trail', 40)
ON CONFLICT (key) DO NOTHING;
-- firms already licensed get both for the first draft (switch off per firm in dv_org_products)
INSERT INTO dv_org_products (organization_id, product_key)
  SELECT DISTINCT o.organization_id, k.key FROM dv_org_products o CROSS JOIN (VALUES ('voip'),('compliance')) k(key)
ON CONFLICT DO NOTHING;

-- ---------- 3. tables ----------
CREATE TABLE IF NOT EXISTS public.dv_call_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES public.debt_cases(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('inbound','outbound')),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','softphone','provider')),
  status text NOT NULL CHECK (status IN ('completed','missed','voicemail','failed')),
  phone text CHECK (length(phone) <= 40),
  adviser_id uuid,
  started_at timestamptz NOT NULL,
  duration_seconds int NOT NULL DEFAULT 0 CHECK (duration_seconds BETWEEN 0 AND 86400),
  outcome text NOT NULL CHECK (outcome IN ('spoke_to_client','spoke_to_third_party','no_answer','voicemail_left','wrong_number','call_back_requested','payment_promised','other')),
  summary text CHECK (length(summary) <= 2000),
  recording_notice_given boolean,
  recording_status text NOT NULL DEFAULT 'none' CHECK (recording_status IN ('none','recording','paused','available','failed')),
  recording_ref text,                       -- object key in private storage; never a public link
  vulnerability_flag boolean NOT NULL DEFAULT false,
  possible_complaint boolean NOT NULL DEFAULT false,
  note_id uuid,
  provider_call_id text UNIQUE,
  retention_class text NOT NULL DEFAULT 'call_recording',
  retention_expires_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dv_call_sessions_case_idx ON public.dv_call_sessions (case_id, started_at DESC);
CREATE INDEX IF NOT EXISTS dv_call_sessions_org_idx ON public.dv_call_sessions (organization_id, started_at DESC);

CREATE TABLE IF NOT EXISTS public.dv_call_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  call_id uuid NOT NULL REFERENCES public.dv_call_sessions(id) ON DELETE CASCADE,
  event text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor uuid,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dv_call_events_call_idx ON public.dv_call_events (call_id, at);

CREATE TABLE IF NOT EXISTS public.dv_call_access_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  call_id uuid NOT NULL REFERENCES public.dv_call_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('view_call','play_recording','view_transcript','download')),
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dv_call_access_org_idx ON public.dv_call_access_log (organization_id, at DESC);

-- AI-produced drafts. Only the service role writes them; a person approves, amends or rejects each one.
CREATE TABLE IF NOT EXISTS public.dv_call_ai_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  case_id uuid NOT NULL REFERENCES public.debt_cases(id) ON DELETE CASCADE,
  call_id uuid NOT NULL REFERENCES public.dv_call_sessions(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('transcript','summary')),
  body text NOT NULL CHECK (length(body) <= 60000),
  model text NOT NULL,
  model_version text,
  confidence numeric CHECK (confidence BETWEEN 0 AND 1),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','amended','rejected')),
  final_body text CHECK (length(final_body) <= 60000),
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'draft') = (decided_at IS NULL)),
  CHECK (status <> 'amended' OR final_body IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS dv_call_ai_drafts_call_idx ON public.dv_call_ai_drafts (call_id);

CREATE TABLE IF NOT EXISTS public.dv_call_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  call_id uuid NOT NULL UNIQUE REFERENCES public.dv_call_sessions(id) ON DELETE CASCADE,
  reviewer_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','completed')),
  due_date date NOT NULL,
  outcome text CHECK (outcome IN ('pass','pass_with_feedback','fail','escalated')),
  checklist jsonb NOT NULL DEFAULT '{}'::jsonb,
  comments text CHECK (length(comments) <= 3000),
  coaching_action text CHECK (length(coaching_action) <= 1000),
  coaching_due date,
  coaching_done_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK (status = 'open' OR (outcome IS NOT NULL AND completed_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS dv_call_reviews_org_idx ON public.dv_call_reviews (organization_id, status, due_date);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['dv_call_sessions','dv_call_events','dv_call_access_log','dv_call_ai_drafts','dv_call_reviews'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO service_role', t);
    EXECUTE format('CREATE POLICY deny_all_clients ON public.%I AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)', t);
    EXECUTE format('CREATE TRIGGER trg_no_delete BEFORE DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.dv_no_delete()', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['dv_call_sessions','dv_call_ai_drafts','dv_call_reviews'] LOOP
    EXECUTE format('CREATE TRIGGER trg_audit_row AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.dv_audit_row()', t);
  END LOOP;
END $$;
GRANT INSERT ON public.dv_call_ai_drafts TO service_role;   -- the transcription/summary job writes drafts here; no client can

-- the event and access trails cannot be edited
CREATE OR REPLACE FUNCTION public.dv_call_trail_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN RAISE EXCEPTION 'call trail rows cannot be changed' USING ERRCODE = '42501'; END $$;
REVOKE ALL ON FUNCTION public.dv_call_trail_immutable() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_immutable BEFORE UPDATE ON public.dv_call_events FOR EACH ROW EXECUTE FUNCTION public.dv_call_trail_immutable();
CREATE TRIGGER trg_immutable BEFORE UPDATE ON public.dv_call_access_log FOR EACH ROW EXECUTE FUNCTION public.dv_call_trail_immutable();

-- ---------- 4. helpers ----------
CREATE OR REPLACE FUNCTION public.dv_call_org_ok(p_org uuid, p_product text) RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF p_org IS NULL OR NOT dv_org_has_product(p_org, p_product) THEN
    RAISE EXCEPTION 'this is not part of your licence' USING ERRCODE = '42501';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.dv_call_org_ok(uuid, text) FROM PUBLIC, anon, authenticated;

-- ---------- 5. adviser functions ----------
CREATE OR REPLACE FUNCTION public.dv_call_log(p_case uuid, p_direction text, p_phone text, p_started_at timestamptz, p_duration_seconds int, p_outcome text,
  p_summary text, p_notice_given boolean DEFAULT NULL, p_vulnerability boolean DEFAULT false, p_possible_complaint boolean DEFAULT false, p_follow_up date DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE c debt_cases; sid uuid; nid uuid; st text; sm text := nullif(btrim(coalesce(p_summary,'')),'');
BEGIN
  SELECT * INTO c FROM debt_cases WHERE id = p_case AND deleted_at IS NULL;
  IF c.id IS NULL OR NOT dv_can_edit_case(p_case) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  PERFORM dv_call_org_ok(c.organization_id, 'voip');
  IF p_direction NOT IN ('inbound','outbound') THEN RAISE EXCEPTION 'choose inbound or outbound' USING ERRCODE = '22023'; END IF;
  IF p_outcome NOT IN ('spoke_to_client','spoke_to_third_party','no_answer','voicemail_left','wrong_number','call_back_requested','payment_promised','other') THEN
    RAISE EXCEPTION 'choose what happened on the call' USING ERRCODE = '22023'; END IF;
  IF p_started_at IS NULL OR p_started_at > now() + interval '5 minutes' OR p_started_at < now() - interval '30 days' THEN
    RAISE EXCEPTION 'the call time must be within the last 30 days and not in the future' USING ERRCODE = '22023'; END IF;
  IF p_duration_seconds IS NULL OR p_duration_seconds < 0 OR p_duration_seconds > 86400 THEN RAISE EXCEPTION 'check the call length' USING ERRCODE = '22023'; END IF;
  IF p_outcome IN ('spoke_to_client','spoke_to_third_party','call_back_requested','payment_promised') AND (sm IS NULL OR length(sm) < 10) THEN
    RAISE EXCEPTION 'write a short summary of the call (at least 10 characters)' USING ERRCODE = '22023'; END IF;
  IF p_outcome = 'spoke_to_client' AND p_notice_given IS NULL THEN
    RAISE EXCEPTION 'say whether the recording notice was given' USING ERRCODE = '22023'; END IF;
  st := CASE p_outcome WHEN 'no_answer' THEN 'missed' WHEN 'voicemail_left' THEN 'voicemail' ELSE 'completed' END;
  nid := dv_add_note(p_case, 'call', coalesce(sm, 'Call: ' || replace(p_outcome, '_', ' ')), false, p_direction, NULL, replace(p_outcome, '_', ' '), p_follow_up);
  INSERT INTO dv_call_sessions (organization_id, case_id, direction, source, status, phone, adviser_id, started_at, duration_seconds, outcome, summary,
      recording_notice_given, vulnerability_flag, possible_complaint, note_id, created_by)
  VALUES (c.organization_id, p_case, p_direction, 'manual', st, left(nullif(btrim(coalesce(p_phone,'')),''),40), auth.uid(), p_started_at, p_duration_seconds, p_outcome, sm,
      p_notice_given, coalesce(p_vulnerability,false), coalesce(p_possible_complaint,false), nid, auth.uid())
  RETURNING id INTO sid;
  INSERT INTO dv_call_events (organization_id, call_id, event, detail, actor) VALUES (c.organization_id, sid, 'logged', jsonb_build_object('source','manual'), auth.uid());
  IF coalesce(p_possible_complaint,false) THEN
    INSERT INTO case_tasks (case_id, organization_id, title, kind, due_date, status, assigned_to, source, created_by)
    VALUES (p_case, c.organization_id, 'Possible complaint raised on a call: log it or record why not', 'call', current_date + 1, 'open', coalesce(c.assigned_to, auth.uid()), 'manual', auth.uid());
  END IF;
  IF st = 'missed' AND p_direction = 'inbound' THEN
    INSERT INTO case_tasks (case_id, organization_id, title, kind, due_date, status, assigned_to, source, created_by)
    VALUES (p_case, c.organization_id, 'Return the missed call', 'call', current_date, 'open', coalesce(c.assigned_to, auth.uid()), 'manual', auth.uid());
  END IF;
  RETURN sid;
END $function$;

CREATE OR REPLACE FUNCTION public.dv_call_list(p_case uuid)
RETURNS TABLE (id uuid, direction text, status text, phone text, started_at timestamptz, duration_seconds int, outcome text, summary text, adviser_name text,
  recording_status text, recording_notice_given boolean, vulnerability_flag boolean, possible_complaint boolean, source text, draft_count int, reviewed boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE org uuid;
BEGIN
  SELECT organization_id INTO org FROM debt_cases WHERE debt_cases.id = p_case AND deleted_at IS NULL;
  IF org IS NULL OR NOT dv_can_read_case(p_case) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  PERFORM dv_call_org_ok(org, 'voip');
  RETURN QUERY
    SELECT s.id, s.direction, s.status, s.phone, s.started_at, s.duration_seconds, s.outcome, s.summary, coalesce(p.full_name, p.email)::text,
           s.recording_status, s.recording_notice_given, s.vulnerability_flag, s.possible_complaint, s.source,
           (SELECT count(*)::int FROM dv_call_ai_drafts d WHERE d.call_id = s.id AND d.status = 'draft'),
           EXISTS (SELECT 1 FROM dv_call_reviews r WHERE r.call_id = s.id AND r.status = 'completed')
      FROM dv_call_sessions s LEFT JOIN profiles p ON p.id = s.adviser_id
     WHERE s.case_id = p_case ORDER BY s.started_at DESC LIMIT 200;
END $function$;

-- full call record; each opening is written to the access trail
CREATE OR REPLACE FUNCTION public.dv_call_detail(p_call uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE s dv_call_sessions; mgr boolean; res jsonb; rv dv_call_reviews;
BEGIN
  SELECT * INTO s FROM dv_call_sessions WHERE id = p_call;
  IF s.id IS NULL OR NOT dv_can_read_case(s.case_id) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  PERFORM dv_call_org_ok(s.organization_id, 'voip');
  mgr := dv_is_manager(s.organization_id);
  INSERT INTO dv_call_access_log (organization_id, call_id, user_id, action) VALUES (s.organization_id, s.id, auth.uid(), 'view_call');
  SELECT * INTO rv FROM dv_call_reviews WHERE call_id = s.id;
  res := jsonb_build_object(
    'call', to_jsonb(s) - 'recording_ref' - 'created_by' - 'provider_call_id',
    'events', coalesce((SELECT jsonb_agg(jsonb_build_object('event', e.event, 'detail', e.detail, 'at', e.at, 'by', coalesce(p.full_name, p.email)) ORDER BY e.at)
                          FROM dv_call_events e LEFT JOIN profiles p ON p.id = e.actor WHERE e.call_id = s.id), '[]'::jsonb),
    'drafts', coalesce((SELECT jsonb_agg(jsonb_build_object('id', d.id, 'kind', d.kind, 'body', d.body, 'model', d.model, 'model_version', d.model_version, 'confidence', d.confidence,
                          'status', d.status, 'final_body', d.final_body, 'decided_at', d.decided_at) ORDER BY d.created_at)
                          FROM dv_call_ai_drafts d WHERE d.call_id = s.id), '[]'::jsonb),
    'review', CASE WHEN rv.id IS NULL THEN NULL
                   WHEN mgr THEN jsonb_build_object('id', rv.id, 'status', rv.status, 'outcome', rv.outcome, 'checklist', rv.checklist, 'comments', rv.comments, 'coaching_action', rv.coaching_action,
                          'coaching_due', rv.coaching_due, 'due_date', rv.due_date, 'mine', rv.reviewer_id = auth.uid())
                   WHEN rv.status = 'completed' THEN jsonb_build_object('status', rv.status, 'outcome', rv.outcome, 'coaching_action', rv.coaching_action, 'coaching_due', rv.coaching_due)
                   ELSE NULL END);
  RETURN res;
END $function$;

-- approve, amend or reject an AI draft: the adviser on the call or a manager
CREATE OR REPLACE FUNCTION public.dv_call_ai_decide(p_draft uuid, p_decision text, p_final_body text DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE d dv_call_ai_drafts; s dv_call_sessions; st text;
BEGIN
  SELECT * INTO d FROM dv_call_ai_drafts WHERE id = p_draft FOR UPDATE;
  IF d.id IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO s FROM dv_call_sessions WHERE id = d.call_id;
  IF NOT dv_can_edit_case(s.case_id) OR NOT (s.adviser_id = auth.uid() OR dv_is_manager(s.organization_id)) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  PERFORM dv_call_org_ok(s.organization_id, 'voip');
  IF d.status <> 'draft' THEN RAISE EXCEPTION 'this draft has already been decided' USING ERRCODE = '22023'; END IF;
  st := CASE p_decision WHEN 'approve' THEN 'approved' WHEN 'amend' THEN 'amended' WHEN 'reject' THEN 'rejected' ELSE NULL END;
  IF st IS NULL THEN RAISE EXCEPTION 'choose approve, amend or reject' USING ERRCODE = '22023'; END IF;
  IF st = 'amended' AND (p_final_body IS NULL OR btrim(p_final_body) = '') THEN RAISE EXCEPTION 'enter the corrected text' USING ERRCODE = '22023'; END IF;
  UPDATE dv_call_ai_drafts SET status = st, final_body = CASE st WHEN 'amended' THEN btrim(p_final_body) WHEN 'approved' THEN body ELSE NULL END, decided_by = auth.uid(), decided_at = now() WHERE id = p_draft;
  INSERT INTO dv_call_events (organization_id, call_id, event, detail, actor) VALUES (s.organization_id, s.id, 'ai_draft_decided', jsonb_build_object('kind', d.kind, 'decision', st), auth.uid());
END $function$;

-- ---------- 6. compliance functions (managers with a second step, firm licensed for Call compliance) ----------
CREATE OR REPLACE FUNCTION public.dv_compliance_gate() RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE o uuid := dv_my_org();
BEGIN
  IF o IS NULL OR NOT dv_is_manager(o) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  PERFORM dv_call_org_ok(o, 'compliance');
  RETURN o;
END $$;
REVOKE ALL ON FUNCTION public.dv_compliance_gate() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.dv_compliance_queue(p_filter text DEFAULT 'needs_review')
RETURNS TABLE (id uuid, case_id uuid, case_number text, debtor_name text, direction text, started_at timestamptz, duration_seconds int, outcome text, adviser_id uuid, adviser_name text,
  flags text[], review_id uuid, review_status text, review_outcome text, reviewer_name text, due_date date, mine boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE o uuid := dv_compliance_gate();
BEGIN
  IF p_filter NOT IN ('needs_review','open','completed','flagged') THEN RAISE EXCEPTION 'unknown filter' USING ERRCODE = '22023'; END IF;
  RETURN QUERY
    WITH q AS (
      SELECT s.id, s.case_id, c.case_number, c.debtor_name, s.direction, s.started_at, s.duration_seconds, s.outcome, s.adviser_id, coalesce(pa.full_name, pa.email)::text an,
             array_remove(ARRAY[CASE WHEN s.possible_complaint THEN 'possible complaint' END, CASE WHEN s.vulnerability_flag THEN 'vulnerability' END,
                                CASE WHEN s.outcome = 'spoke_to_client' AND s.recording_notice_given IS NOT TRUE THEN 'no recording notice' END], NULL) fl,
             r.id rid, r.status rs, r.outcome ro, coalesce(pr.full_name, pr.email)::text rn, r.due_date, (r.reviewer_id = auth.uid()) mine
        FROM dv_call_sessions s JOIN debt_cases c ON c.id = s.case_id
        LEFT JOIN dv_call_reviews r ON r.call_id = s.id
        LEFT JOIN profiles pa ON pa.id = s.adviser_id LEFT JOIN profiles pr ON pr.id = r.reviewer_id
       WHERE s.organization_id = o AND c.deleted_at IS NULL AND dv_can_read_case(s.case_id) AND s.status = 'completed' AND s.outcome <> 'wrong_number')
    SELECT q.id, q.case_id, q.case_number, q.debtor_name, q.direction, q.started_at, q.duration_seconds, q.outcome, q.adviser_id, q.an, q.fl, q.rid, q.rs, q.ro, q.rn, q.due_date, q.mine
      FROM q
     WHERE CASE p_filter WHEN 'needs_review' THEN q.rid IS NULL WHEN 'open' THEN q.rs = 'open' WHEN 'completed' THEN q.rs = 'completed' ELSE cardinality(q.fl) > 0 END
     ORDER BY (cardinality(q.fl) > 0) DESC, q.started_at ASC LIMIT 200;
END $function$;

CREATE OR REPLACE FUNCTION public.dv_compliance_dashboard() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE o uuid := dv_compliance_gate(); res jsonb;
BEGIN
  WITH calls AS (
    SELECT s.* FROM dv_call_sessions s JOIN debt_cases c ON c.id = s.case_id
     WHERE s.organization_id = o AND c.deleted_at IS NULL AND dv_can_read_case(s.case_id) AND s.started_at >= now() - interval '30 days' AND s.status = 'completed' AND s.outcome <> 'wrong_number'),
  rv AS (SELECT r.*, c.adviser_id FROM dv_call_reviews r JOIN calls c ON c.id = r.call_id)
  SELECT jsonb_build_object(
    'calls_30d', (SELECT count(*) FROM calls),
    'reviewed_30d', (SELECT count(*) FROM rv WHERE status = 'completed'),
    'open_reviews', (SELECT count(*) FROM rv WHERE status = 'open'),
    'overdue_reviews', (SELECT count(*) FROM rv WHERE status = 'open' AND due_date < current_date),
    'passed', (SELECT count(*) FROM rv WHERE outcome IN ('pass','pass_with_feedback')),
    'failed', (SELECT count(*) FROM rv WHERE outcome IN ('fail','escalated')),
    'flagged_unreviewed', (SELECT count(*) FROM calls c WHERE NOT EXISTS (SELECT 1 FROM dv_call_reviews r WHERE r.call_id = c.id)
                              AND (c.possible_complaint OR c.vulnerability_flag OR (c.outcome = 'spoke_to_client' AND c.recording_notice_given IS NOT TRUE))),
    'no_notice', (SELECT count(*) FROM calls c WHERE c.outcome = 'spoke_to_client' AND c.recording_notice_given IS NOT TRUE),
    'coaching_open', (SELECT count(*) FROM rv WHERE coaching_action IS NOT NULL AND coaching_done_at IS NULL),
    'by_adviser', coalesce((SELECT jsonb_agg(jsonb_build_object('adviser_id', x.aid, 'name', x.nm, 'calls', x.n, 'reviewed', x.rvd, 'passed', x.ps, 'failed', x.fl) ORDER BY x.n DESC)
        FROM (SELECT c.adviser_id aid, coalesce(p.full_name, p.email) nm, count(*) n,
                     count(r.id) FILTER (WHERE r.status = 'completed') rvd,
                     count(r.id) FILTER (WHERE r.outcome IN ('pass','pass_with_feedback')) ps,
                     count(r.id) FILTER (WHERE r.outcome IN ('fail','escalated')) fl
                FROM calls c LEFT JOIN dv_call_reviews r ON r.call_id = c.id LEFT JOIN profiles p ON p.id = c.adviser_id GROUP BY 1, 2) x), '[]'::jsonb)
  ) INTO res;
  RETURN res;
END $function$;

-- take a call for review. The reviewer cannot be the adviser who took the call.
CREATE OR REPLACE FUNCTION public.dv_compliance_take_review(p_call uuid, p_due date DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE o uuid := dv_compliance_gate(); s dv_call_sessions; rid uuid;
BEGIN
  SELECT * INTO s FROM dv_call_sessions WHERE id = p_call AND organization_id = o FOR UPDATE;
  IF s.id IS NULL OR NOT dv_can_read_case(s.case_id) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF s.adviser_id = auth.uid() THEN RAISE EXCEPTION 'you cannot review a call you took yourself' USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM dv_call_reviews WHERE call_id = p_call) THEN RAISE EXCEPTION 'this call already has a review' USING ERRCODE = '22023'; END IF;
  IF p_due IS NOT NULL AND (p_due < current_date OR p_due > current_date + 60) THEN RAISE EXCEPTION 'choose a due date within the next 60 days' USING ERRCODE = '22023'; END IF;
  INSERT INTO dv_call_reviews (organization_id, call_id, reviewer_id, due_date) VALUES (o, p_call, auth.uid(), coalesce(p_due, current_date + 5)) RETURNING id INTO rid;
  INSERT INTO dv_call_events (organization_id, call_id, event, detail, actor) VALUES (o, p_call, 'review_started', '{}'::jsonb, auth.uid());
  RETURN rid;
END $function$;

CREATE OR REPLACE FUNCTION public.dv_compliance_complete(p_review uuid, p_outcome text, p_checklist jsonb, p_comments text, p_coaching text DEFAULT NULL, p_coaching_due date DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE o uuid := dv_compliance_gate(); r dv_call_reviews; k text; v text; cm text := nullif(btrim(coalesce(p_comments,'')),''); has_no boolean := false;
  allowed text[] := ARRAY['recording_notice','identity_checked','affordability_discussed','vulnerability_considered','options_explained','no_pressure','accurate_information','next_steps_agreed'];
BEGIN
  SELECT * INTO r FROM dv_call_reviews WHERE id = p_review AND organization_id = o FOR UPDATE;
  IF r.id IS NULL OR r.reviewer_id <> auth.uid() THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF r.status <> 'open' THEN RAISE EXCEPTION 'this review is already complete' USING ERRCODE = '22023'; END IF;
  IF p_outcome NOT IN ('pass','pass_with_feedback','fail','escalated') THEN RAISE EXCEPTION 'choose an outcome' USING ERRCODE = '22023'; END IF;
  IF p_checklist IS NULL OR jsonb_typeof(p_checklist) <> 'object' THEN RAISE EXCEPTION 'complete the checklist' USING ERRCODE = '22023'; END IF;
  FOR k, v IN SELECT key, value FROM jsonb_each_text(p_checklist) LOOP
    IF NOT k = ANY (allowed) OR v NOT IN ('yes','no','na') THEN RAISE EXCEPTION 'unknown checklist answer' USING ERRCODE = '22023'; END IF;
    IF v = 'no' THEN has_no := true; END IF;
  END LOOP;
  IF (SELECT count(*) FROM jsonb_object_keys(p_checklist)) < cardinality(allowed) THEN RAISE EXCEPTION 'answer every checklist item' USING ERRCODE = '22023'; END IF;
  IF p_outcome = 'pass' AND has_no THEN RAISE EXCEPTION 'a call with a "no" answer cannot be a clean pass' USING ERRCODE = '22023'; END IF;
  IF p_outcome <> 'pass' AND (cm IS NULL OR length(cm) < 10) THEN RAISE EXCEPTION 'explain the outcome in the comments' USING ERRCODE = '22023'; END IF;
  IF p_coaching_due IS NOT NULL AND (p_coaching_due < current_date OR p_coaching_due > current_date + 180) THEN RAISE EXCEPTION 'check the coaching due date' USING ERRCODE = '22023'; END IF;
  UPDATE dv_call_reviews SET status = 'completed', outcome = p_outcome, checklist = p_checklist, comments = left(cm, 3000), coaching_action = left(nullif(btrim(coalesce(p_coaching,'')),''), 1000),
         coaching_due = p_coaching_due, completed_at = now() WHERE id = p_review;
  INSERT INTO dv_call_events (organization_id, call_id, event, detail, actor) VALUES (o, r.call_id, 'review_completed', jsonb_build_object('outcome', p_outcome), auth.uid());
END $function$;

-- an adviser sees coaching set after their calls was reviewed and marks it done
CREATE OR REPLACE FUNCTION public.dv_my_coaching() RETURNS TABLE (review_id uuid, call_id uuid, case_id uuid, case_number text, debtor_name text, outcome text, coaching_action text, coaching_due date, done boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
BEGIN
  RETURN QUERY
    SELECT r.id, s.id, s.case_id, c.case_number, c.debtor_name, r.outcome, r.coaching_action, r.coaching_due, r.coaching_done_at IS NOT NULL
      FROM dv_call_reviews r JOIN dv_call_sessions s ON s.id = r.call_id JOIN debt_cases c ON c.id = s.case_id
     WHERE s.adviser_id = auth.uid() AND r.status = 'completed' AND r.coaching_action IS NOT NULL AND dv_org_has_product(r.organization_id, 'compliance') AND dv_can_read_case(s.case_id)
     ORDER BY (r.coaching_done_at IS NULL) DESC, r.coaching_due NULLS LAST LIMIT 50;
END $function$;

CREATE OR REPLACE FUNCTION public.dv_coaching_done(p_review uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE r dv_call_reviews; s dv_call_sessions;
BEGIN
  SELECT * INTO r FROM dv_call_reviews WHERE id = p_review FOR UPDATE;
  SELECT * INTO s FROM dv_call_sessions WHERE id = r.call_id;
  IF r.id IS NULL OR s.adviser_id IS DISTINCT FROM auth.uid() OR r.coaching_action IS NULL OR NOT dv_can_read_case(s.case_id) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  UPDATE dv_call_reviews SET coaching_done_at = coalesce(coaching_done_at, now()) WHERE id = p_review;
END $function$;

CREATE OR REPLACE FUNCTION public.dv_compliance_audit(p_limit int DEFAULT 200)
RETURNS TABLE (at timestamptz, action text, user_name text, call_id uuid, case_number text, debtor_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE o uuid := dv_compliance_gate();
BEGIN
  RETURN QUERY
    SELECT a.at, a.action, coalesce(p.full_name, p.email)::text, a.call_id, c.case_number, c.debtor_name
      FROM dv_call_access_log a JOIN dv_call_sessions s ON s.id = a.call_id JOIN debt_cases c ON c.id = s.case_id LEFT JOIN profiles p ON p.id = a.user_id
     WHERE a.organization_id = o AND dv_can_read_case(s.case_id) ORDER BY a.at DESC LIMIT least(greatest(coalesce(p_limit, 200), 1), 500);
END $function$;

DO $$ DECLARE f text; BEGIN
  FOREACH f IN ARRAY ARRAY['dv_call_log(uuid,text,text,timestamptz,int,text,text,boolean,boolean,boolean,date)','dv_call_list(uuid)','dv_call_detail(uuid)','dv_call_ai_decide(uuid,text,text)',
     'dv_compliance_queue(text)','dv_compliance_dashboard()','dv_compliance_take_review(uuid,date)','dv_compliance_complete(uuid,text,jsonb,text,text,date)',
     'dv_my_coaching()','dv_coaching_done(uuid)','dv_compliance_audit(int)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;

-- ---------- 7. erasure: call text and phone numbers are personal data ----------
DO $$ DECLARE d text; d0 text;
BEGIN
  d0 := pg_get_functiondef('public.dv_erase_case(uuid,text)'::regprocedure);
  d := replace(d0, '"case_notes":["body","contact_name","outcome","withdraw_reason"],', '"case_notes":["body","contact_name","outcome","withdraw_reason"], "dv_call_sessions":["phone","summary"], "dv_call_ai_drafts":["body","final_body"],');
  IF d = d0 THEN RAISE EXCEPTION 'erase patch did not apply'; END IF;
  EXECUTE d;
END $$;
