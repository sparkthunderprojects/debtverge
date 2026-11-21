/*
# Storm Call Ecosystem Integration

Extends Storm Call tables to support cross-application call launching from
DebtVerge, IVAVerge, DraftVerge, and LeadVerge dashboards.

## Changes

### 1. storm_call_sessions — new columns
- application_source, customer_reference, lead_reference, team_name
- is_recording_paused, recording_paused_at, recording_resumed_at, recording_pause_reason
- conference_participants (jsonb), is_conference

### 2. storm_call_call_notes — new table
Structured call notes with timestamps, tags, and follow-up task creation.

### 3. storm_call_conference_participants — new table
Tracks participants in conference calls.

### 4. storm_call_recording_events — new table
Audit trail for recording pause/resume events.

## Security
- All new tables have RLS enabled with organization-scoped policies
*/

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'storm_call_sessions' AND column_name = 'application_source') THEN
    ALTER TABLE storm_call_sessions ADD COLUMN application_source text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'storm_call_sessions' AND column_name = 'customer_reference') THEN
    ALTER TABLE storm_call_sessions ADD COLUMN customer_reference text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'storm_call_sessions' AND column_name = 'lead_reference') THEN
    ALTER TABLE storm_call_sessions ADD COLUMN lead_reference text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'storm_call_sessions' AND column_name = 'team_name') THEN
    ALTER TABLE storm_call_sessions ADD COLUMN team_name text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'storm_call_sessions' AND column_name = 'is_recording_paused') THEN
    ALTER TABLE storm_call_sessions ADD COLUMN is_recording_paused boolean NOT NULL DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'storm_call_sessions' AND column_name = 'recording_paused_at') THEN
    ALTER TABLE storm_call_sessions ADD COLUMN recording_paused_at timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'storm_call_sessions' AND column_name = 'recording_resumed_at') THEN
    ALTER TABLE storm_call_sessions ADD COLUMN recording_resumed_at timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'storm_call_sessions' AND column_name = 'recording_pause_reason') THEN
    ALTER TABLE storm_call_sessions ADD COLUMN recording_pause_reason text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'storm_call_sessions' AND column_name = 'conference_participants') THEN
    ALTER TABLE storm_call_sessions ADD COLUMN conference_participants jsonb NOT NULL DEFAULT '[]'::jsonb;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'storm_call_sessions' AND column_name = 'is_conference') THEN
    ALTER TABLE storm_call_sessions ADD COLUMN is_conference boolean NOT NULL DEFAULT false;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS storm_call_call_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES storm_call_sessions(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  note_text text NOT NULL,
  note_tag text NOT NULL DEFAULT 'general',
  is_follow_up boolean NOT NULL DEFAULT false,
  is_completed boolean NOT NULL DEFAULT false,
  follow_up_due_date timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

ALTER TABLE storm_call_call_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_sc_call_notes" ON storm_call_call_notes;
CREATE POLICY "select_sc_call_notes" ON storm_call_call_notes FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organizations o WHERE o.id = storm_call_call_notes.organization_id AND o.owner_id = auth.uid())
  );

DROP POLICY IF EXISTS "insert_sc_call_notes" ON storm_call_call_notes;
CREATE POLICY "insert_sc_call_notes" ON storm_call_call_notes FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM organizations o WHERE o.id = storm_call_call_notes.organization_id AND o.owner_id = auth.uid())
  );

DROP POLICY IF EXISTS "update_sc_call_notes" ON storm_call_call_notes;
CREATE POLICY "update_sc_call_notes" ON storm_call_call_notes FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organizations o WHERE o.id = storm_call_call_notes.organization_id AND o.owner_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM organizations o WHERE o.id = storm_call_call_notes.organization_id AND o.owner_id = auth.uid())
  );

DROP POLICY IF EXISTS "delete_sc_call_notes" ON storm_call_call_notes;
CREATE POLICY "delete_sc_call_notes" ON storm_call_call_notes FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organizations o WHERE o.id = storm_call_call_notes.organization_id AND o.owner_id = auth.uid())
  );

CREATE TABLE IF NOT EXISTS storm_call_conference_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES storm_call_sessions(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  participant_name text NOT NULL,
  participant_role text,
  participant_type text NOT NULL DEFAULT 'adviser',
  joined_at timestamptz NOT NULL DEFAULT now(),
  left_at timestamptz,
  is_active boolean NOT NULL DEFAULT true
);

ALTER TABLE storm_call_conference_participants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_sc_conf_participants" ON storm_call_conference_participants;
CREATE POLICY "select_sc_conf_participants" ON storm_call_conference_participants FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organizations o WHERE o.id = storm_call_conference_participants.organization_id AND o.owner_id = auth.uid())
  );

DROP POLICY IF EXISTS "insert_sc_conf_participants" ON storm_call_conference_participants;
CREATE POLICY "insert_sc_conf_participants" ON storm_call_conference_participants FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM organizations o WHERE o.id = storm_call_conference_participants.organization_id AND o.owner_id = auth.uid())
  );

DROP POLICY IF EXISTS "update_sc_conf_participants" ON storm_call_conference_participants;
CREATE POLICY "update_sc_conf_participants" ON storm_call_conference_participants FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organizations o WHERE o.id = storm_call_conference_participants.organization_id AND o.owner_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM organizations o WHERE o.id = storm_call_conference_participants.organization_id AND o.owner_id = auth.uid())
  );

DROP POLICY IF EXISTS "delete_sc_conf_participants" ON storm_call_conference_participants;
CREATE POLICY "delete_sc_conf_participants" ON storm_call_conference_participants FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organizations o WHERE o.id = storm_call_conference_participants.organization_id AND o.owner_id = auth.uid())
  );

CREATE TABLE IF NOT EXISTS storm_call_recording_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES storm_call_sessions(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  event_timestamp timestamptz NOT NULL DEFAULT now(),
  reason text,
  user_id uuid,
  user_email text,
  duration_seconds integer
);

ALTER TABLE storm_call_recording_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_sc_rec_events" ON storm_call_recording_events;
CREATE POLICY "select_sc_rec_events" ON storm_call_recording_events FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organizations o WHERE o.id = storm_call_recording_events.organization_id AND o.owner_id = auth.uid())
  );

DROP POLICY IF EXISTS "insert_sc_rec_events" ON storm_call_recording_events;
CREATE POLICY "insert_sc_rec_events" ON storm_call_recording_events FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM organizations o WHERE o.id = storm_call_recording_events.organization_id AND o.owner_id = auth.uid())
  );

DROP POLICY IF EXISTS "update_sc_rec_events" ON storm_call_recording_events;
CREATE POLICY "update_sc_rec_events" ON storm_call_recording_events FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organizations o WHERE o.id = storm_call_recording_events.organization_id AND o.owner_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM organizations o WHERE o.id = storm_call_recording_events.organization_id AND o.owner_id = auth.uid())
  );

DROP POLICY IF EXISTS "delete_sc_rec_events" ON storm_call_recording_events;
CREATE POLICY "delete_sc_rec_events" ON storm_call_recording_events FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organizations o WHERE o.id = storm_call_recording_events.organization_id AND o.owner_id = auth.uid())
  );

CREATE INDEX IF NOT EXISTS idx_sc_call_notes_session ON storm_call_call_notes(session_id);
CREATE INDEX IF NOT EXISTS idx_sc_conf_participants_session ON storm_call_conference_participants(session_id);
CREATE INDEX IF NOT EXISTS idx_sc_rec_events_session ON storm_call_recording_events(session_id);
CREATE INDEX IF NOT EXISTS idx_sc_sessions_app_source ON storm_call_sessions(application_source);
CREATE INDEX IF NOT EXISTS idx_sc_sessions_customer_ref ON storm_call_sessions(customer_reference);
