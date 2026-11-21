/*
# Storm Call — Enterprise Adviser Communications & Contact Centre

## Purpose
A regulated-business contact centre module for debt management and IVA firms.
Authorised advisers log in, manage customer communications, make/receive calls
via a provider-agnostic VoIP layer, and all communication activity is automatically
linked to customer cases. Includes AI call intelligence, compliance scoring,
and a unified customer communication timeline.

## New Tables

1. `storm_call_adviser_profiles` — Extends auth.users with adviser-specific fields
   - id uuid PK, user_id uuid FK→auth.users, organization_id uuid FK→organizations
   - adviser_id text (unique HR ID), team text, department text
   - role text (adviser|senior_adviser|team_leader|manager|compliance_officer|administrator)
   - permissions jsonb (granular permission set)
   - availability_status text (available|busy|on_call|break|offline)
   - phone_extension text, voip_user_id text (provider-specific SIP/user ID)
   - assigned_case_ids uuid[] (cases assigned to this adviser)
   - is_active boolean, created_at, updated_at

2. `storm_call_telephony_providers` — Provider-agnostic telephony configuration
   - id uuid PK, organization_id uuid FK
   - provider_name text, provider_type text (storm_call|external_voip|sip|cloud)
   - api_endpoint text, webhook_url text
   - is_active boolean, config jsonb (provider-specific settings, NOT secrets)
   - created_at

3. `storm_call_sessions` — Individual call sessions (inbound or outbound)
   - id uuid PK, organization_id uuid FK
   - call_direction text (inbound|outbound)
   - call_status text (ringing|answered|on_hold|muted|transferred|completed|missed|failed)
   - caller_phone text, caller_name text
   - callee_phone text, callee_name text
   - adviser_id uuid FK→auth.users, adviser_profile_id uuid FK→storm_call_adviser_profiles
   - case_id uuid (link to debt_cases), customer_id uuid
   - customer_identified boolean (auto-matched to existing customer)
   - provider_id uuid FK→storm_call_telephony_providers
   - provider_call_id text (external call reference)
   - started_at timestamptz, answered_at timestamptz, ended_at timestamptz
   - duration_seconds int
   - is_on_hold boolean, is_muted boolean
   - transfer_target text, transfer_status text
   - call_notes text (adviser notes during call)
   - recording_url text, recording_id text
   - transcript_id uuid FK→storm_call_transcripts
   - summary_id uuid FK→storm_call_ai_summaries
   - compliance_score_id uuid FK→storm_call_compliance_scores
   - follow_up_task_created boolean
   - created_at

4. `storm_call_transcripts` — Call transcripts (generated or uploaded)
   - id uuid PK, session_id uuid FK→storm_call_sessions ON DELETE CASCADE
   - organization_id uuid FK
   - transcript_text text, transcript_segments jsonb (timestamped speaker segments)
   - language text, confidence_score numeric(3,2)
   - generated_by text (ai|manual|provider)
   - created_at

5. `storm_call_ai_summaries` — AI-generated call intelligence
   - id uuid PK, session_id uuid FK→storm_call_sessions ON DELETE CASCADE
   - organization_id uuid FK
   - summary_text text (overall summary)
   - key_points jsonb (array of key discussion points)
   - customer_concerns jsonb
   - adviser_actions jsonb
   - promises_made jsonb (customer promises: amount, date, etc.)
   - follow_up_required jsonb (array of follow-up items)
   - compliance_risks jsonb (identified risks)
   - customer_sentiment text (positive|neutral|negative|distressed)
   - sentiment_score numeric(3,2)
   - actions_required jsonb (auto-identified actions)
   - review_status text (pending|reviewed|approved|amended)
   - reviewed_by uuid, reviewed_at timestamptz
   - coaching_notes text (manager coaching feedback)
   - approved_by uuid, approved_at timestamptz
   - amended_text text (manager's amended summary if different)
   - created_at

6. `storm_call_compliance_scores` — FCA compliance scoring per call
   - id uuid PK, session_id uuid FK→storm_call_sessions ON DELETE CASCADE
   - organization_id uuid FK
   - total_score numeric(5,2) (0-100)
   - required_disclosures_completed boolean
   - affordability_discussed boolean
   - vulnerability_identified boolean
   - correct_advice_process_followed boolean
   - disclosure_score int, affordability_score int, vulnerability_score int, advice_score int
   - compliance_checks jsonb (detailed checklist results)
   - risk_flags jsonb (identified compliance risks)
   - created_at

7. `storm_call_compliance_audit` — Immutable audit trail for all compliance-sensitive actions
   - id uuid PK, organization_id uuid FK
   - session_id uuid nullable FK→storm_call_sessions
   - user_id uuid (who performed the action)
   - user_email text
   - action_type text (recording_accessed|transcript_viewed|notes_edited|summary_approved|summary_amended|coaching_added|call_transferred|recording_downloaded)
   - entity_type text, entity_id uuid
   - details jsonb
   - created_at timestamptz DEFAULT now()

8. `storm_call_timeline_events` — Unified customer communication timeline
   - id uuid PK, organization_id uuid FK
   - customer_id uuid, case_id uuid nullable
   - event_type text (call|recording|transcript|ai_summary|adviser_note|email|document|task|compliance_event|callback_scheduled)
   - event_title text, event_description text
   - session_id uuid nullable FK→storm_call_sessions
   - adviser_id uuid nullable
   - adviser_name text
   - metadata jsonb (event-specific data)
   - event_timestamp timestamptz NOT NULL DEFAULT now()
   - created_at timestamptz DEFAULT now()

9. `storm_call_callbacks` — Scheduled callback queue
   - id uuid PK, organization_id uuid FK
   - customer_id uuid, case_id uuid nullable
   - adviser_id uuid (assigned adviser)
   - phone_number text, customer_name text
   - scheduled_at timestamptz, completed_at timestamptz nullable
   - status text (pending|in_progress|completed|cancelled|missed)
   - priority int, notes text
   - session_id uuid nullable (linked call session when completed)
   - created_at

## Security
- RLS enabled on all 9 new tables.
- Owner-scoped via organization_id membership check using organization_users.
- Compliance audit table is insert+select only (immutable).
- 4 policies per table (select/insert/update/delete) for authenticated users.
*/

-- ============================================================
-- storm_call_adviser_profiles
-- ============================================================
CREATE TABLE IF NOT EXISTS storm_call_adviser_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  adviser_id text NOT NULL,
  team text,
  department text,
  role text NOT NULL DEFAULT 'adviser' CHECK (role IN ('adviser','senior_adviser','team_leader','manager','compliance_officer','administrator')),
  permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  availability_status text NOT NULL DEFAULT 'offline' CHECK (availability_status IN ('available','busy','on_call','break','offline')),
  phone_extension text,
  voip_user_id text,
  assigned_case_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE storm_call_adviser_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_sc_advisers" ON storm_call_adviser_profiles;
CREATE POLICY "select_sc_advisers" ON storm_call_adviser_profiles FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_adviser_profiles.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "insert_sc_advisers" ON storm_call_adviser_profiles;
CREATE POLICY "insert_sc_advisers" ON storm_call_adviser_profiles FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_adviser_profiles.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "update_sc_advisers" ON storm_call_adviser_profiles;
CREATE POLICY "update_sc_advisers" ON storm_call_adviser_profiles FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_adviser_profiles.organization_id AND organization_users.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_adviser_profiles.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "delete_sc_advisers" ON storm_call_adviser_profiles;
CREATE POLICY "delete_sc_advisers" ON storm_call_adviser_profiles FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_adviser_profiles.organization_id AND organization_users.user_id = auth.uid())
  );

-- ============================================================
-- storm_call_telephony_providers
-- ============================================================
CREATE TABLE IF NOT EXISTS storm_call_telephony_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider_name text NOT NULL,
  provider_type text NOT NULL DEFAULT 'external_voip' CHECK (provider_type IN ('storm_call','external_voip','sip','cloud')),
  api_endpoint text,
  webhook_url text,
  is_active boolean NOT NULL DEFAULT true,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE storm_call_telephony_providers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_sc_providers" ON storm_call_telephony_providers;
CREATE POLICY "select_sc_providers" ON storm_call_telephony_providers FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_telephony_providers.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "insert_sc_providers" ON storm_call_telephony_providers;
CREATE POLICY "insert_sc_providers" ON storm_call_telephony_providers FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_telephony_providers.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "update_sc_providers" ON storm_call_telephony_providers;
CREATE POLICY "update_sc_providers" ON storm_call_telephony_providers FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_telephony_providers.organization_id AND organization_users.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_telephony_providers.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "delete_sc_providers" ON storm_call_telephony_providers;
CREATE POLICY "delete_sc_providers" ON storm_call_telephony_providers FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_telephony_providers.organization_id AND organization_users.user_id = auth.uid())
  );

-- ============================================================
-- storm_call_sessions
-- ============================================================
CREATE TABLE IF NOT EXISTS storm_call_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  call_direction text NOT NULL CHECK (call_direction IN ('inbound','outbound')),
  call_status text NOT NULL DEFAULT 'ringing' CHECK (call_status IN ('ringing','answered','on_hold','muted','transferred','completed','missed','failed')),
  caller_phone text,
  caller_name text,
  callee_phone text,
  callee_name text,
  adviser_id uuid,
  adviser_profile_id uuid REFERENCES storm_call_adviser_profiles(id) ON DELETE SET NULL,
  case_id uuid,
  customer_id uuid,
  customer_identified boolean NOT NULL DEFAULT false,
  provider_id uuid REFERENCES storm_call_telephony_providers(id) ON DELETE SET NULL,
  provider_call_id text,
  started_at timestamptz NOT NULL DEFAULT now(),
  answered_at timestamptz,
  ended_at timestamptz,
  duration_seconds int,
  is_on_hold boolean NOT NULL DEFAULT false,
  is_muted boolean NOT NULL DEFAULT false,
  transfer_target text,
  transfer_status text,
  call_notes text,
  recording_url text,
  recording_id text,
  transcript_id uuid,
  summary_id uuid,
  compliance_score_id uuid,
  follow_up_task_created boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE storm_call_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_sc_sessions" ON storm_call_sessions;
CREATE POLICY "select_sc_sessions" ON storm_call_sessions FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_sessions.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "insert_sc_sessions" ON storm_call_sessions;
CREATE POLICY "insert_sc_sessions" ON storm_call_sessions FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_sessions.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "update_sc_sessions" ON storm_call_sessions;
CREATE POLICY "update_sc_sessions" ON storm_call_sessions FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_sessions.organization_id AND organization_users.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_sessions.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "delete_sc_sessions" ON storm_call_sessions;
CREATE POLICY "delete_sc_sessions" ON storm_call_sessions FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_sessions.organization_id AND organization_users.user_id = auth.uid())
  );

-- ============================================================
-- storm_call_transcripts
-- ============================================================
CREATE TABLE IF NOT EXISTS storm_call_transcripts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES storm_call_sessions(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  transcript_text text,
  transcript_segments jsonb,
  language text DEFAULT 'en-GB',
  confidence_score numeric(3,2),
  generated_by text NOT NULL DEFAULT 'ai' CHECK (generated_by IN ('ai','manual','provider')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE storm_call_transcripts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_sc_transcripts" ON storm_call_transcripts;
CREATE POLICY "select_sc_transcripts" ON storm_call_transcripts FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_transcripts.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "insert_sc_transcripts" ON storm_call_transcripts;
CREATE POLICY "insert_sc_transcripts" ON storm_call_transcripts FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_transcripts.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "update_sc_transcripts" ON storm_call_transcripts;
CREATE POLICY "update_sc_transcripts" ON storm_call_transcripts FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_transcripts.organization_id AND organization_users.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_transcripts.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "delete_sc_transcripts" ON storm_call_transcripts;
CREATE POLICY "delete_sc_transcripts" ON storm_call_transcripts FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_transcripts.organization_id AND organization_users.user_id = auth.uid())
  );

-- ============================================================
-- storm_call_ai_summaries
-- ============================================================
CREATE TABLE IF NOT EXISTS storm_call_ai_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES storm_call_sessions(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  summary_text text,
  key_points jsonb NOT NULL DEFAULT '[]'::jsonb,
  customer_concerns jsonb NOT NULL DEFAULT '[]'::jsonb,
  adviser_actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  promises_made jsonb NOT NULL DEFAULT '[]'::jsonb,
  follow_up_required jsonb NOT NULL DEFAULT '[]'::jsonb,
  compliance_risks jsonb NOT NULL DEFAULT '[]'::jsonb,
  customer_sentiment text CHECK (customer_sentiment IN ('positive','neutral','negative','distressed')),
  sentiment_score numeric(3,2),
  actions_required jsonb NOT NULL DEFAULT '[]'::jsonb,
  review_status text NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending','reviewed','approved','amended')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  coaching_notes text,
  approved_by uuid,
  approved_at timestamptz,
  amended_text text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE storm_call_ai_summaries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_sc_summaries" ON storm_call_ai_summaries;
CREATE POLICY "select_sc_summaries" ON storm_call_ai_summaries FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_ai_summaries.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "insert_sc_summaries" ON storm_call_ai_summaries;
CREATE POLICY "insert_sc_summaries" ON storm_call_ai_summaries FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_ai_summaries.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "update_sc_summaries" ON storm_call_ai_summaries;
CREATE POLICY "update_sc_summaries" ON storm_call_ai_summaries FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_ai_summaries.organization_id AND organization_users.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_ai_summaries.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "delete_sc_summaries" ON storm_call_ai_summaries;
CREATE POLICY "delete_sc_summaries" ON storm_call_ai_summaries FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_ai_summaries.organization_id AND organization_users.user_id = auth.uid())
  );

-- ============================================================
-- storm_call_compliance_scores
-- ============================================================
CREATE TABLE IF NOT EXISTS storm_call_compliance_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES storm_call_sessions(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  total_score numeric(5,2) NOT NULL DEFAULT 0,
  required_disclosures_completed boolean NOT NULL DEFAULT false,
  affordability_discussed boolean NOT NULL DEFAULT false,
  vulnerability_identified boolean NOT NULL DEFAULT false,
  correct_advice_process_followed boolean NOT NULL DEFAULT false,
  disclosure_score int NOT NULL DEFAULT 0,
  affordability_score int NOT NULL DEFAULT 0,
  vulnerability_score int NOT NULL DEFAULT 0,
  advice_score int NOT NULL DEFAULT 0,
  compliance_checks jsonb NOT NULL DEFAULT '{}'::jsonb,
  risk_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE storm_call_compliance_scores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_sc_compliance" ON storm_call_compliance_scores;
CREATE POLICY "select_sc_compliance" ON storm_call_compliance_scores FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_compliance_scores.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "insert_sc_compliance" ON storm_call_compliance_scores;
CREATE POLICY "insert_sc_compliance" ON storm_call_compliance_scores FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_compliance_scores.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "update_sc_compliance" ON storm_call_compliance_scores;
CREATE POLICY "update_sc_compliance" ON storm_call_compliance_scores FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_compliance_scores.organization_id AND organization_users.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_compliance_scores.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "delete_sc_compliance" ON storm_call_compliance_scores;
CREATE POLICY "delete_sc_compliance" ON storm_call_compliance_scores FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_compliance_scores.organization_id AND organization_users.user_id = auth.uid())
  );

-- ============================================================
-- storm_call_compliance_audit (insert+select only — immutable)
-- ============================================================
CREATE TABLE IF NOT EXISTS storm_call_compliance_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  session_id uuid REFERENCES storm_call_sessions(id) ON DELETE CASCADE,
  user_id uuid,
  user_email text,
  action_type text NOT NULL,
  entity_type text,
  entity_id uuid,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE storm_call_compliance_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_sc_audit" ON storm_call_compliance_audit;
CREATE POLICY "select_sc_audit" ON storm_call_compliance_audit FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_compliance_audit.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "insert_sc_audit" ON storm_call_compliance_audit;
CREATE POLICY "insert_sc_audit" ON storm_call_compliance_audit FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_compliance_audit.organization_id AND organization_users.user_id = auth.uid())
  );

-- ============================================================
-- storm_call_timeline_events
-- ============================================================
CREATE TABLE IF NOT EXISTS storm_call_timeline_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id uuid,
  case_id uuid,
  event_type text NOT NULL,
  event_title text,
  event_description text,
  session_id uuid REFERENCES storm_call_sessions(id) ON DELETE SET NULL,
  adviser_id uuid,
  adviser_name text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  event_timestamp timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE storm_call_timeline_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_sc_timeline" ON storm_call_timeline_events;
CREATE POLICY "select_sc_timeline" ON storm_call_timeline_events FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_timeline_events.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "insert_sc_timeline" ON storm_call_timeline_events;
CREATE POLICY "insert_sc_timeline" ON storm_call_timeline_events FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_timeline_events.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "update_sc_timeline" ON storm_call_timeline_events;
CREATE POLICY "update_sc_timeline" ON storm_call_timeline_events FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_timeline_events.organization_id AND organization_users.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_timeline_events.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "delete_sc_timeline" ON storm_call_timeline_events;
CREATE POLICY "delete_sc_timeline" ON storm_call_timeline_events FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_timeline_events.organization_id AND organization_users.user_id = auth.uid())
  );

-- ============================================================
-- storm_call_callbacks
-- ============================================================
CREATE TABLE IF NOT EXISTS storm_call_callbacks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id uuid,
  case_id uuid,
  adviser_id uuid,
  phone_number text NOT NULL,
  customer_name text,
  scheduled_at timestamptz NOT NULL,
  completed_at timestamptz,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed','cancelled','missed')),
  priority int NOT NULL DEFAULT 5,
  notes text,
  session_id uuid REFERENCES storm_call_sessions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE storm_call_callbacks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_sc_callbacks" ON storm_call_callbacks;
CREATE POLICY "select_sc_callbacks" ON storm_call_callbacks FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_callbacks.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "insert_sc_callbacks" ON storm_call_callbacks;
CREATE POLICY "insert_sc_callbacks" ON storm_call_callbacks FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_callbacks.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "update_sc_callbacks" ON storm_call_callbacks;
CREATE POLICY "update_sc_callbacks" ON storm_call_callbacks FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_callbacks.organization_id AND organization_users.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_callbacks.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "delete_sc_callbacks" ON storm_call_callbacks;
CREATE POLICY "delete_sc_callbacks" ON storm_call_callbacks FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = storm_call_callbacks.organization_id AND organization_users.user_id = auth.uid())
  );

-- ============================================================
-- Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_sc_sessions_org ON storm_call_sessions(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sc_sessions_adviser ON storm_call_sessions(adviser_id);
CREATE INDEX IF NOT EXISTS idx_sc_sessions_case ON storm_call_sessions(case_id);
CREATE INDEX IF NOT EXISTS idx_sc_sessions_status ON storm_call_sessions(call_status);
CREATE INDEX IF NOT EXISTS idx_sc_transcripts_session ON storm_call_transcripts(session_id);
CREATE INDEX IF NOT EXISTS idx_sc_summaries_session ON storm_call_ai_summaries(session_id);
CREATE INDEX IF NOT EXISTS idx_sc_compliance_session ON storm_call_compliance_scores(session_id);
CREATE INDEX IF NOT EXISTS idx_sc_audit_org ON storm_call_compliance_audit(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sc_timeline_customer ON storm_call_timeline_events(customer_id, event_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_sc_callbacks_adviser ON storm_call_callbacks(adviser_id, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_sc_callbacks_status ON storm_call_callbacks(status);
CREATE INDEX IF NOT EXISTS idx_sc_advisers_org ON storm_call_adviser_profiles(organization_id);
CREATE INDEX IF NOT EXISTS idx_sc_advisers_user ON storm_call_adviser_profiles(user_id);
