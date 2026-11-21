/*
# DebtVerge — Dynamic Compliance Scripting & Vulnerability Markers

## Overview
Adds two new tables to support the Dynamic Compliance Scripting overlay:
1. debtverge_compliance_attestations — immutable record of when an agent confirmed mandatory FCA CONC disclaimers were read verbatim for a specific script type.
2. debtverge_vulnerability_flags — one-click vulnerability markers using official FCA categories (Health, Life Events, Resilience, Capability) with custom guidance notes.

## New Tables

### debtverge_compliance_attestations
- id (uuid PK)
- case_id (uuid FK to debt_cases, ON DELETE CASCADE)
- script_type (text — which script was active: initial_onboarding, annual_review, iva_proposal_review, creditor_negotiation, solution_selection, closure)
- disclaimers_text (text — the exact disclaimer text that was confirmed read verbatim)
- confirmed_by (text — agent name who confirmed)
- confirmed_at (timestamptz — when the confirmation was made)
- created_at (timestamptz DEFAULT now())

### debtverge_vulnerability_flags
- id (uuid PK)
- case_id (uuid FK to debt_cases, ON DELETE CASCADE)
- fca_category (text — health, life_events, resilience, capability)
- sub_category (text — specific trigger e.g. mental_health, bereavement, digital_exclusion, low_literacy)
- guidance_notes (text — custom advisor guidance notes)
- flagged_by (text — agent name who flagged)
- flagged_at (timestamptz DEFAULT now())
- created_at (timestamptz DEFAULT now())

## Security
- RLS enabled on both tables.
- TO authenticated, ownership through parent debt_cases via EXISTS subquery (same pattern as debt_vulnerability_assessments).
- 4 policies each (SELECT, INSERT, UPDATE, DELETE).
*/

CREATE TABLE IF NOT EXISTS debtverge_compliance_attestations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES debt_cases(id) ON DELETE CASCADE,
  script_type text NOT NULL,
  disclaimers_text text NOT NULL,
  confirmed_by text NOT NULL,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE debtverge_compliance_attestations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_compliance_attest" ON debtverge_compliance_attestations;
CREATE POLICY "select_own_compliance_attest" ON debtverge_compliance_attestations FOR SELECT
  TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debtverge_compliance_attestations.case_id AND debt_cases.user_id = auth.uid()));

DROP POLICY IF EXISTS "insert_own_compliance_attest" ON debtverge_compliance_attestations;
CREATE POLICY "insert_own_compliance_attest" ON debtverge_compliance_attestations FOR INSERT
  TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debtverge_compliance_attestations.case_id AND debt_cases.user_id = auth.uid()));

DROP POLICY IF EXISTS "update_own_compliance_attest" ON debtverge_compliance_attestations;
CREATE POLICY "update_own_compliance_attest" ON debtverge_compliance_attestations FOR UPDATE
  TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debtverge_compliance_attestations.case_id AND debt_cases.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debtverge_compliance_attestations.case_id AND debt_cases.user_id = auth.uid()));

DROP POLICY IF EXISTS "delete_own_compliance_attest" ON debtverge_compliance_attestations;
CREATE POLICY "delete_own_compliance_attest" ON debtverge_compliance_attestations FOR DELETE
  TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debtverge_compliance_attestations.case_id AND debt_cases.user_id = auth.uid()));


CREATE TABLE IF NOT EXISTS debtverge_vulnerability_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES debt_cases(id) ON DELETE CASCADE,
  fca_category text NOT NULL,
  sub_category text NOT NULL,
  guidance_notes text,
  flagged_by text,
  flagged_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE debtverge_vulnerability_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_vuln_flags" ON debtverge_vulnerability_flags;
CREATE POLICY "select_own_vuln_flags" ON debtverge_vulnerability_flags FOR SELECT
  TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debtverge_vulnerability_flags.case_id AND debt_cases.user_id = auth.uid()));

DROP POLICY IF EXISTS "insert_own_vuln_flags" ON debtverge_vulnerability_flags;
CREATE POLICY "insert_own_vuln_flags" ON debtverge_vulnerability_flags FOR INSERT
  TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debtverge_vulnerability_flags.case_id AND debt_cases.user_id = auth.uid()));

DROP POLICY IF EXISTS "update_own_vuln_flags" ON debtverge_vulnerability_flags;
CREATE POLICY "update_own_vuln_flags" ON debtverge_vulnerability_flags FOR UPDATE
  TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debtverge_vulnerability_flags.case_id AND debt_cases.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debtverge_vulnerability_flags.case_id AND debt_cases.user_id = auth.uid()));

DROP POLICY IF EXISTS "delete_own_vuln_flags" ON debtverge_vulnerability_flags;
CREATE POLICY "delete_own_vuln_flags" ON debtverge_vulnerability_flags FOR DELETE
  TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debtverge_vulnerability_flags.case_id AND debt_cases.user_id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_compliance_attest_case ON debtverge_compliance_attestations(case_id);
CREATE INDEX IF NOT EXISTS idx_vuln_flags_case ON debtverge_vulnerability_flags(case_id);
