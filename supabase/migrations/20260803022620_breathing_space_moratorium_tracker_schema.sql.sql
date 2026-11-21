/*
# Statutory Breathing Space & Mental Health Crisis Moratorium Tracker

## Purpose
Creates the database table to track Statutory Breathing Space (Standard 60-Day)
and Mental Health Crisis Moratorium records for debtor cases in DebtVerge.

## New Tables

### debt_breathing_spaces
Tracks breathing space / moratorium registrations per case.

Columns:
- id (uuid, PK)
- case_id (uuid, FK to debt_cases, ON DELETE CASCADE)
- user_id (uuid, NOT NULL, DEFAULT auth.uid() — owner of the record)
- moratorium_type (text: 'standard' | 'mental_health_crisis')
- status (text: 'active' | 'expired' | 'cancelled')
- start_date (date — when the breathing space began)
- standard_end_date (date — 60 days from start_date, for standard type)
- treatment_end_date (date, nullable — when MH crisis treatment ended, for MHC type)
- post_treatment_exit_date (date, nullable — treatment_end_date + 30 days, for MHC type)
- amhp_evidence_file_name (text, nullable — uploaded AMHP evidence form filename)
- amhp_evidence_url (text, nullable — storage path for AMHP evidence)
- nominated_contact_name (text, nullable — nominated point of contact for MHC)
- nominated_contact_phone (text, nullable)
- nominated_contact_email (text, nullable)
- nominated_contact_relationship (text, nullable)
- included_creditor_ids (jsonb — array of creditor UUIDs included in the breathing space)
- eligibility_checks (jsonb — stored results of eligibility verification)
- review_tasks (jsonb — auto-scheduled review task definitions)
- account_lock_active (boolean, default true — whether payment/interest freeze is active)
- cancelled_reason (text, nullable)
- cancelled_at (timestamptz, nullable)
- created_at (timestamptz, default now())
- updated_at (timestamptz, default now())

## Security
- RLS enabled on debt_breathing_spaces.
- Owner-scoped CRUD policies using auth.uid() = user_id (same pattern as other debt tables).
- 4 separate policies (SELECT, INSERT, UPDATE, DELETE), scoped TO authenticated.

## Notes
1. This table is a child of debt_cases — each case can have multiple breathing space
   records over time (history), but only one can be 'active' at any given time.
2. The standard 60-day breathing space auto-expires after 60 days.
3. The Mental Health Crisis moratorium has no fixed end date — it ends 30 days after
   treatment concludes, tracked via treatment_end_date and post_treatment_exit_date.
4. account_lock_active flag controls whether the system pauses payment schedules,
   disables reminders, and freezes interest/fee additions.
*/

CREATE TABLE IF NOT EXISTS debt_breathing_spaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES debt_cases(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  moratorium_type text NOT NULL DEFAULT 'standard' CHECK (moratorium_type IN ('standard', 'mental_health_crisis')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'cancelled')),
  start_date date NOT NULL DEFAULT CURRENT_DATE,
  standard_end_date date,
  treatment_end_date date,
  post_treatment_exit_date date,
  amhp_evidence_file_name text,
  amhp_evidence_url text,
  nominated_contact_name text,
  nominated_contact_phone text,
  nominated_contact_email text,
  nominated_contact_relationship text,
  included_creditor_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  eligibility_checks jsonb NOT NULL DEFAULT '{}'::jsonb,
  review_tasks jsonb NOT NULL DEFAULT '[]'::jsonb,
  account_lock_active boolean NOT NULL DEFAULT true,
  cancelled_reason text,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Index for querying active breathing spaces by case
CREATE INDEX IF NOT EXISTS idx_breathing_spaces_case_id ON debt_breathing_spaces(case_id);
CREATE INDEX IF NOT EXISTS idx_breathing_spaces_status ON debt_breathing_spaces(status);

ALTER TABLE debt_breathing_spaces ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_breathing_spaces" ON debt_breathing_spaces;
CREATE POLICY "select_own_breathing_spaces"
  ON debt_breathing_spaces FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_breathing_spaces" ON debt_breathing_spaces;
CREATE POLICY "insert_own_breathing_spaces"
  ON debt_breathing_spaces FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_breathing_spaces" ON debt_breathing_spaces;
CREATE POLICY "update_own_breathing_spaces"
  ON debt_breathing_spaces FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_breathing_spaces" ON debt_breathing_spaces;
CREATE POLICY "delete_own_breathing_spaces"
  ON debt_breathing_spaces FOR DELETE
  TO authenticated USING (auth.uid() = user_id);