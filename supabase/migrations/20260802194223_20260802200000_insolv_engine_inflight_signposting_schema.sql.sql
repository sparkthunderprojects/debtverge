/*
# Insolv Engine — In-Flight Case Management & Signposting Schema

## Purpose
Extends the Insolv Engine with post-approval IVA case management tables
(contributions, distribution runs, distribution line items) and a signposting
assessment table for the automated lead intake / debtor routing workflow.

## 1. New Tables

### debt_signposting_assessments
Initial debt assessment that routes consumers to the correct support path
based on total debt, disposable income, and creditor count.
- id (uuid PK)
- case_id (uuid FK → debt_cases, nullable — assessment can happen before a case exists)
- total_debt (numeric) — total unsecured debt
- monthly_disposable_income (numeric) — SFS disposable income
- creditor_count (int) — number of creditors
- recommended_route (text) — 'iva' | 'dmp' | 'dro' | 'bankruptcy' | 'signposting'
- route_confidence (numeric) — confidence percentage 0–100
- route_reasons (text[]) — human-readable rationale bullets
- assessment_data (jsonb) — full assessment payload for audit
- created_at / updated_at

### debt_iva_contributions
Monthly debtor contributions logged during IVA in-flight administration.
- id (uuid PK)
- case_id (uuid FK → debt_cases)
- amount (numeric) — contribution amount received
- contribution_date (date) — when the contribution was received
- payment_method (text) — 'bacs' | 'standing_order' | 'card' | 'cash' | 'other'
- reference (text) — bank reference / transaction ID
- status (text) — 'expected' | 'received' | 'missed' | 'late' | 'partial'
- allocated_amount (numeric) — amount already allocated to distribution runs
- notes (text)
- created_at / updated_at

### debt_iva_distribution_runs
Distribution calculator runs that split collected funds across creditor dividend
schedules, deducting IP fees (Nominee & Supervisor fees) before disbursement.
- id (uuid PK)
- case_id (uuid FK → debt_cases)
- run_date (date) — when the distribution was calculated
- total_collected (numeric) — total funds available for distribution
- nominee_fee_deducted (numeric) — Nominee fee deducted from collected funds
- supervisor_fee_deducted (numeric) — Supervisor fee deducted from collected funds
- total_disbursed (numeric) — total amount disbursed to creditors
- status (text) — 'calculated' | 'approved' | 'executed' | 'reversed'
- approved_by (text) — name of approver
- approved_at (timestamptz)
- notes (text)
- created_at / updated_at

### debt_iva_distribution_items
Individual creditor line items within a distribution run.
- id (uuid PK)
- run_id (uuid FK → debt_iva_distribution_runs, cascade delete)
- case_id (uuid FK → debt_cases)
- creditor_id (uuid FK → debt_creditors, set null on delete)
- creditor_name (text) — snapshot of creditor name at distribution time
- original_debt (numeric) — creditor's original debt balance
- pro_rata_percent (numeric) — pro-rata share percentage
- distribution_amount (numeric) — amount disbursed to this creditor
- created_at (timestamptz)

## 2. Security
- RLS enabled on all four new tables.
- Policies use TO anon, authenticated with true predicates, matching the
  existing debt_* table family's shared operational model.

## 3. Indexes
- All tables indexed on case_id.
- debt_iva_distribution_items indexed on run_id.
- debt_iva_contributions indexed on contribution_date.
- debt_iva_distribution_runs indexed on status.

## 4. Important Notes
1. No existing tables altered — purely additive.
2. All existing DMP, SFS, and insolvency tools remain fully intact.
3. Distribution items cascade-delete with their parent run.
4. Amounts stored as numeric(12,2) for monetary precision.
*/

-- ============================================================
-- Table: debt_signposting_assessments
-- ============================================================
CREATE TABLE IF NOT EXISTS debt_signposting_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid REFERENCES debt_cases(id) ON DELETE CASCADE,
  total_debt numeric(12,2) DEFAULT 0,
  monthly_disposable_income numeric(12,2) DEFAULT 0,
  creditor_count int DEFAULT 0,
  recommended_route text NOT NULL DEFAULT 'signposting' CHECK (recommended_route IN ('iva','dmp','dro','bankruptcy','signposting')),
  route_confidence numeric(5,2) DEFAULT 0,
  route_reasons text[] DEFAULT '{}',
  assessment_data jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_signpost_case_id ON debt_signposting_assessments(case_id);

ALTER TABLE debt_signposting_assessments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sel_signpost" ON debt_signposting_assessments;
CREATE POLICY "sel_signpost" ON debt_signposting_assessments FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "ins_signpost" ON debt_signposting_assessments;
CREATE POLICY "ins_signpost" ON debt_signposting_assessments FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "upd_signpost" ON debt_signposting_assessments;
CREATE POLICY "upd_signpost" ON debt_signposting_assessments FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "del_signpost" ON debt_signposting_assessments;
CREATE POLICY "del_signpost" ON debt_signposting_assessments FOR DELETE
  TO anon, authenticated USING (true);

-- ============================================================
-- Table: debt_iva_contributions
-- ============================================================
CREATE TABLE IF NOT EXISTS debt_iva_contributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES debt_cases(id) ON DELETE CASCADE,
  amount numeric(12,2) NOT NULL DEFAULT 0,
  contribution_date date NOT NULL DEFAULT CURRENT_DATE,
  payment_method text CHECK (payment_method IN ('bacs','standing_order','card','cash','other')),
  reference text,
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('expected','received','missed','late','partial')),
  allocated_amount numeric(12,2) DEFAULT 0,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_iva_contrib_case_id ON debt_iva_contributions(case_id);
CREATE INDEX IF NOT EXISTS idx_iva_contrib_date ON debt_iva_contributions(contribution_date);

ALTER TABLE debt_iva_contributions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sel_iva_contrib" ON debt_iva_contributions;
CREATE POLICY "sel_iva_contrib" ON debt_iva_contributions FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "ins_iva_contrib" ON debt_iva_contributions;
CREATE POLICY "ins_iva_contrib" ON debt_iva_contributions FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "upd_iva_contrib" ON debt_iva_contributions;
CREATE POLICY "upd_iva_contrib" ON debt_iva_contributions FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "del_iva_contrib" ON debt_iva_contributions;
CREATE POLICY "del_iva_contrib" ON debt_iva_contributions FOR DELETE
  TO anon, authenticated USING (true);

-- ============================================================
-- Table: debt_iva_distribution_runs
-- ============================================================
CREATE TABLE IF NOT EXISTS debt_iva_distribution_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES debt_cases(id) ON DELETE CASCADE,
  run_date date NOT NULL DEFAULT CURRENT_DATE,
  total_collected numeric(12,2) NOT NULL DEFAULT 0,
  nominee_fee_deducted numeric(12,2) DEFAULT 0,
  supervisor_fee_deducted numeric(12,2) DEFAULT 0,
  total_disbursed numeric(12,2) DEFAULT 0,
  status text NOT NULL DEFAULT 'calculated' CHECK (status IN ('calculated','approved','executed','reversed')),
  approved_by text,
  approved_at timestamptz,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_iva_dist_runs_case ON debt_iva_distribution_runs(case_id);
CREATE INDEX IF NOT EXISTS idx_iva_dist_runs_status ON debt_iva_distribution_runs(status);

ALTER TABLE debt_iva_distribution_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sel_iva_dist_run" ON debt_iva_distribution_runs;
CREATE POLICY "sel_iva_dist_run" ON debt_iva_distribution_runs FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "ins_iva_dist_run" ON debt_iva_distribution_runs;
CREATE POLICY "ins_iva_dist_run" ON debt_iva_distribution_runs FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "upd_iva_dist_run" ON debt_iva_distribution_runs;
CREATE POLICY "upd_iva_dist_run" ON debt_iva_distribution_runs FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "del_iva_dist_run" ON debt_iva_distribution_runs;
CREATE POLICY "del_iva_dist_run" ON debt_iva_distribution_runs FOR DELETE
  TO anon, authenticated USING (true);

-- ============================================================
-- Table: debt_iva_distribution_items
-- ============================================================
CREATE TABLE IF NOT EXISTS debt_iva_distribution_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES debt_iva_distribution_runs(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES debt_cases(id) ON DELETE CASCADE,
  creditor_id uuid REFERENCES debt_creditors(id) ON DELETE SET NULL,
  creditor_name text NOT NULL,
  original_debt numeric(12,2) DEFAULT 0,
  pro_rata_percent numeric(5,2) DEFAULT 0,
  distribution_amount numeric(12,2) NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_iva_dist_items_run ON debt_iva_distribution_items(run_id);
CREATE INDEX IF NOT EXISTS idx_iva_dist_items_case ON debt_iva_distribution_items(case_id);

ALTER TABLE debt_iva_distribution_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sel_iva_dist_item" ON debt_iva_distribution_items;
CREATE POLICY "sel_iva_dist_item" ON debt_iva_distribution_items FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "ins_iva_dist_item" ON debt_iva_distribution_items;
CREATE POLICY "ins_iva_dist_item" ON debt_iva_distribution_items FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "upd_iva_dist_item" ON debt_iva_distribution_items;
CREATE POLICY "upd_iva_dist_item" ON debt_iva_distribution_items FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "del_iva_dist_item" ON debt_iva_distribution_items;
CREATE POLICY "del_iva_dist_item" ON debt_iva_distribution_items FOR DELETE
  TO anon, authenticated USING (true);