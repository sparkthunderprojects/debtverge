-- Phone and Call compliance, enterprise layer part 1: tables. Everything is closed to browsers (RLS + deny policy); access is by SECURITY DEFINER functions only.

-- ---- sessions: live-call states, unidentified callers, richer fields
ALTER TABLE public.dv_call_sessions ALTER COLUMN case_id DROP NOT NULL;
ALTER TABLE public.dv_call_sessions DROP CONSTRAINT IF EXISTS dv_call_sessions_status_check;
ALTER TABLE public.dv_call_sessions ADD CONSTRAINT dv_call_sessions_status_check CHECK (status IN ('ringing','answered','on_hold','transferred','completed','missed','voicemail','failed'));
ALTER TABLE public.dv_call_sessions DROP CONSTRAINT IF EXISTS dv_call_sessions_outcome_check;
ALTER TABLE public.dv_call_sessions ADD CONSTRAINT dv_call_sessions_outcome_check CHECK (outcome IN ('pending','spoke_to_client','spoke_to_third_party','no_answer','voicemail_left','wrong_number','call_back_requested','payment_promised','other'));
ALTER TABLE public.dv_call_sessions
  ADD COLUMN IF NOT EXISTS caller_name text CHECK (length(caller_name) <= 120),
  ADD COLUMN IF NOT EXISTS to_number text CHECK (length(to_number) <= 40),
  ADD COLUMN IF NOT EXISTS answered_at timestamptz,
  ADD COLUMN IF NOT EXISTS ended_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_on_hold boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS transfer_kind text CHECK (transfer_kind IN ('adviser','team','queue','supervisor','cold','warm')),
  ADD COLUMN IF NOT EXISTS transfer_target text CHECK (length(transfer_target) <= 120),
  ADD COLUMN IF NOT EXISTS transfer_status text CHECK (transfer_status IN ('initiated','completed','failed')),
  ADD COLUMN IF NOT EXISTS customer_identified boolean NOT NULL DEFAULT true;
CREATE INDEX IF NOT EXISTS dv_call_sessions_pending_idx ON public.dv_call_sessions (adviser_id) WHERE outcome = 'pending';

-- ---- audit actions
ALTER TABLE public.dv_call_access_log DROP CONSTRAINT IF EXISTS dv_call_access_log_action_check;
ALTER TABLE public.dv_call_access_log ADD CONSTRAINT dv_call_access_log_action_check CHECK (action IN
  ('view_call','play_recording','view_transcript','download_recording','notes_added','summary_approved','summary_amended','coaching_added','call_transferred','call_attached','review_opened','recording_paused','recording_resumed'));
ALTER TABLE public.dv_call_access_log ADD COLUMN IF NOT EXISTS detail jsonb NOT NULL DEFAULT '{}'::jsonb;

-- ---- AI drafts: a third kind, structured analysis
ALTER TABLE public.dv_call_ai_drafts DROP CONSTRAINT IF EXISTS dv_call_ai_drafts_kind_check;
ALTER TABLE public.dv_call_ai_drafts ADD CONSTRAINT dv_call_ai_drafts_kind_check CHECK (kind IN ('transcript','summary','analysis'));
ALTER TABLE public.dv_call_ai_drafts ADD COLUMN IF NOT EXISTS payload text CHECK (length(payload) <= 60000);

-- ---- settings and presence
CREATE TABLE IF NOT EXISTS public.dv_telephony_settings (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'twilio' CHECK (provider IN ('twilio')),
  record_calls boolean NOT NULL DEFAULT true,
  recording_notice_text text NOT NULL DEFAULT 'Calls may be recorded for training and monitoring purposes.' CHECK (length(recording_notice_text) BETWEEN 10 AND 500),
  retention_years int NOT NULL DEFAULT 6 CHECK (retention_years BETWEEN 3 AND 6),
  transcription_enabled boolean NOT NULL DEFAULT false,
  ai_analysis_enabled boolean NOT NULL DEFAULT false,
  require_second_approver boolean NOT NULL DEFAULT true,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.dv_adviser_presence (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'offline' CHECK (status IN ('available','busy','on_call','break','offline')),
  extension text CHECK (length(extension) <= 12),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);

-- ---- live call detail
CREATE TABLE IF NOT EXISTS public.dv_call_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL, call_id uuid NOT NULL REFERENCES public.dv_call_sessions(id) ON DELETE CASCADE, case_id uuid,
  note_text text NOT NULL CHECK (length(btrim(note_text)) BETWEEN 1 AND 2000),
  tag text NOT NULL DEFAULT 'general' CHECK (tag IN ('customer_request','compliance_point','vulnerability_indicator','adviser_action','general')),
  is_follow_up boolean NOT NULL DEFAULT false, follow_up_due date, is_completed boolean NOT NULL DEFAULT false, completed_at timestamptz,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS dv_call_notes_call_idx ON public.dv_call_notes (call_id, created_at);
CREATE TABLE IF NOT EXISTS public.dv_call_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL, call_id uuid NOT NULL REFERENCES public.dv_call_sessions(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80), role text CHECK (length(role) <= 80),
  ptype text NOT NULL CHECK (ptype IN ('adviser','supervisor','specialist','external')), user_id uuid,
  joined_at timestamptz NOT NULL DEFAULT now(), left_at timestamptz, added_by uuid);
CREATE INDEX IF NOT EXISTS dv_call_participants_call_idx ON public.dv_call_participants (call_id);
CREATE TABLE IF NOT EXISTS public.dv_call_recording_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL, call_id uuid NOT NULL REFERENCES public.dv_call_sessions(id) ON DELETE CASCADE,
  event text NOT NULL CHECK (event IN ('paused','resumed')), reason text CHECK (length(reason) <= 300),
  user_id uuid, at timestamptz NOT NULL DEFAULT now(), duration_seconds int);
CREATE INDEX IF NOT EXISTS dv_call_rec_events_call_idx ON public.dv_call_recording_events (call_id, at);
CREATE TABLE IF NOT EXISTS public.dv_call_transcripts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL, call_id uuid NOT NULL UNIQUE REFERENCES public.dv_call_sessions(id) ON DELETE CASCADE, case_id uuid,
  body text NOT NULL CHECK (length(body) <= 300000), language text NOT NULL DEFAULT 'en-GB', confidence numeric CHECK (confidence BETWEEN 0 AND 1),
  source text NOT NULL DEFAULT 'provider' CHECK (source IN ('provider')), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.dv_call_callbacks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL, case_id uuid NOT NULL REFERENCES public.debt_cases(id) ON DELETE CASCADE, call_id uuid REFERENCES public.dv_call_sessions(id) ON DELETE SET NULL,
  adviser_id uuid, phone text NOT NULL CHECK (length(phone) BETWEEN 5 AND 40), customer_name text CHECK (length(customer_name) <= 120),
  scheduled_at timestamptz NOT NULL, status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed','cancelled','missed')),
  priority int NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5), notes text CHECK (length(notes) <= 1000), completed_at timestamptz, task_id uuid,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS dv_call_callbacks_open_idx ON public.dv_call_callbacks (organization_id, scheduled_at) WHERE status IN ('pending','in_progress');
CREATE TABLE IF NOT EXISTS public.dv_call_risk_indicators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL, call_id uuid NOT NULL REFERENCES public.dv_call_sessions(id) ON DELETE CASCADE, case_id uuid,
  risk_type text NOT NULL CHECK (risk_type IN ('compliance_breach','complaint_risk','vulnerability_concern','affordability_issue','disclosure_missing','advice_quality','recording_gap','mis_selling','data_protection')),
  severity text NOT NULL CHECK (severity IN ('low','medium','high','critical')), description text NOT NULL CHECK (length(btrim(description)) BETWEEN 5 AND 1000),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')), raised_by uuid, raised_at timestamptz NOT NULL DEFAULT now(),
  resolved_by uuid, resolved_at timestamptz, resolution_note text CHECK (length(resolution_note) <= 1000),
  CHECK ((status = 'open') = (resolved_at IS NULL)));
CREATE INDEX IF NOT EXISTS dv_call_risk_open_idx ON public.dv_call_risk_indicators (organization_id, status, severity);

-- ---- review pipeline (rebuilt: the first version held no real data)
DROP TABLE IF EXISTS public.dv_call_reviews CASCADE;
CREATE TABLE public.dv_call_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL, call_id uuid NOT NULL UNIQUE REFERENCES public.dv_call_sessions(id) ON DELETE CASCADE, case_id uuid,
  status text NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned','in_review','pending_approval','approved','rejected','escalated')),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','critical')),
  reviewer_id uuid, assigned_by uuid NOT NULL, assigned_at timestamptz NOT NULL DEFAULT now(), due_date date NOT NULL,
  started_at timestamptz, submitted_at timestamptz,
  outcome text CHECK (outcome IN ('compliant','minor_issues','major_issues','non_compliant')),
  score int CHECK (score BETWEEN 0 AND 100),
  checklist jsonb NOT NULL DEFAULT '{}'::jsonb, issues jsonb NOT NULL DEFAULT '[]'::jsonb, corrective_actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  comments text CHECK (length(comments) <= 3000),
  approved_by uuid, approved_at timestamptz, decision_note text CHECK (length(decision_note) <= 1000),
  is_escalated boolean NOT NULL DEFAULT false, escalation_reason text CHECK (length(escalation_reason) <= 1000), escalated_to uuid, escalated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'approved' OR (outcome IS NOT NULL AND approved_by IS NOT NULL AND approved_at IS NOT NULL)),
  CHECK (status <> 'pending_approval' OR (outcome IS NOT NULL AND submitted_at IS NOT NULL)));
CREATE INDEX dv_call_reviews_org_idx ON public.dv_call_reviews (organization_id, status, due_date);
CREATE INDEX dv_call_reviews_reviewer_idx ON public.dv_call_reviews (reviewer_id) WHERE status IN ('assigned','in_review','rejected','escalated');
CREATE TABLE IF NOT EXISTS public.dv_call_review_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL, review_id uuid NOT NULL REFERENCES public.dv_call_reviews(id) ON DELETE CASCADE,
  assigned_to uuid NOT NULL, assigned_by uuid NOT NULL, status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','reassigned','completed','declined')),
  assigned_at timestamptz NOT NULL DEFAULT now(), ended_at timestamptz, reason text CHECK (length(reason) <= 500));
CREATE TABLE IF NOT EXISTS public.dv_call_review_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL, review_id uuid NOT NULL REFERENCES public.dv_call_reviews(id) ON DELETE CASCADE,
  step text NOT NULL CHECK (step IN ('review_created','review_assigned','review_started','review_completed','review_approved','review_rejected','review_escalated','coaching_assigned','coaching_completed','corrective_action_added','reviewer_changed','review_declined','due_date_extended')),
  actor uuid, detail jsonb NOT NULL DEFAULT '{}'::jsonb, at timestamptz NOT NULL DEFAULT now());
CREATE INDEX dv_call_review_steps_idx ON public.dv_call_review_steps (review_id, at);

-- ---- coaching actions
CREATE TABLE IF NOT EXISTS public.dv_coaching_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL, adviser_id uuid NOT NULL, review_id uuid REFERENCES public.dv_call_reviews(id) ON DELETE SET NULL, call_id uuid REFERENCES public.dv_call_sessions(id) ON DELETE SET NULL,
  action_type text NOT NULL CHECK (action_type IN ('feedback','training','coaching_session','corrective_action','improvement_plan')),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 3 AND 150), description text CHECK (length(description) <= 2000),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','completed','cancelled')),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','critical')),
  assigned_by uuid NOT NULL, due_date date, completed_at timestamptz, completion_notes text CHECK (length(completion_notes) <= 1000),
  feedback_text text CHECK (length(feedback_text) <= 1000), manager_rating int CHECK (manager_rating BETWEEN 1 AND 5),
  cancel_reason text CHECK (length(cancel_reason) <= 300), created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'completed') = (completed_at IS NOT NULL)));
CREATE INDEX IF NOT EXISTS dv_coaching_adviser_idx ON public.dv_coaching_actions (adviser_id, status);

-- ---- close every new table to browsers, keep the trails append-only, audit the changeable ones
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['dv_telephony_settings','dv_adviser_presence','dv_call_notes','dv_call_participants','dv_call_recording_events','dv_call_transcripts','dv_call_callbacks','dv_call_risk_indicators','dv_call_reviews','dv_call_review_assignments','dv_call_review_steps','dv_coaching_actions'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO service_role', t);
    EXECUTE format('DROP POLICY IF EXISTS deny_all_clients ON public.%I', t);
    EXECUTE format('CREATE POLICY deny_all_clients ON public.%I AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_no_delete ON public.%I', t);
    EXECUTE format('CREATE TRIGGER trg_no_delete BEFORE DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.dv_no_delete()', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['dv_call_recording_events','dv_call_transcripts','dv_call_review_steps','dv_call_review_assignments'] LOOP
    IF t IN ('dv_call_recording_events','dv_call_transcripts','dv_call_review_steps') THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_immutable ON public.%I', t);
      EXECUTE format('CREATE TRIGGER trg_immutable BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.dv_call_trail_immutable()', t);
    END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['dv_telephony_settings','dv_call_callbacks','dv_call_risk_indicators','dv_call_reviews','dv_coaching_actions','dv_call_notes','dv_call_transcripts'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_row ON public.%I', t);
    EXECUTE format('CREATE TRIGGER trg_audit_row AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.dv_audit_row()', t);
  END LOOP;
END $$;
DROP TRIGGER IF EXISTS trg_audit_row ON public.dv_call_reviews;
CREATE TRIGGER trg_audit_row AFTER INSERT OR UPDATE OR DELETE ON public.dv_call_reviews FOR EACH ROW EXECUTE FUNCTION public.dv_audit_row();

-- retention date is set when the call starts, from the firm's setting (default 6 years)
CREATE OR REPLACE FUNCTION public.dv_call_set_retention() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.retention_expires_at IS NULL THEN
    NEW.retention_expires_at := NEW.started_at + make_interval(years => coalesce((SELECT retention_years FROM dv_telephony_settings WHERE organization_id = NEW.organization_id), 6));
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.dv_call_set_retention() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_retention ON public.dv_call_sessions;
CREATE TRIGGER trg_retention BEFORE INSERT ON public.dv_call_sessions FOR EACH ROW EXECUTE FUNCTION public.dv_call_set_retention();

-- keep the old unscheduled functions from lingering
DROP FUNCTION IF EXISTS public.dv_compliance_take_review(uuid, date);
DROP FUNCTION IF EXISTS public.dv_compliance_complete(uuid, text, jsonb, text, text, date);
DROP FUNCTION IF EXISTS public.dv_coaching_done(uuid);
DROP FUNCTION IF EXISTS public.dv_my_coaching();
DROP FUNCTION IF EXISTS public.dv_compliance_queue(text);
DROP FUNCTION IF EXISTS public.dv_compliance_audit(int);
DROP FUNCTION IF EXISTS public.dv_call_list(uuid);
