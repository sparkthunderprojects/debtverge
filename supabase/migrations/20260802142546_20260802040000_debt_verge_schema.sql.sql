/*
# Debt Verge — Debt Management Platform Schema

## Overview
Creates the database backend for "Debt Verge", an enterprise-grade debt management
platform module. It manages debtor cases, creditor ledgers, Standard Financial
Statement (SFS) income/expenditure data, pro-rata creditor distributions, plan
comparisons, and a compliance audit timeline.

## New Tables
1. debt_cases — top-level debtor case record (case_number, debtor_name, status, plan_type, disposable income, total debt, distribution date)
2. debt_creditors — creditor ledger lines (creditor_name, debt_type, balance, interest_rate, pro_rata_amount, settlement_offer)
3. debt_sfs_entries — SFS income & expenditure line items (category, label, amount)
4. debt_distributions — scheduled creditor payment distributions (date, amount, status)
5. debt_audit_log — compliance timeline milestones

## Security
- RLS enabled on ALL five tables.
- TO authenticated with auth.uid() = user_id ownership checks.
- Child tables scope ownership through parent debt_cases via EXISTS subquery.
- user_id on debt_cases defaults to auth.uid().
*/

DO $$ BEGIN
  CREATE TYPE debt_case_status AS ENUM ('intake', 'sfs_pending', 'sfs_approved', 'creditor_pack_sent', 'payment_schedule_active', 'completed', 'closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE debt_plan_type AS ENUM ('dmp', 'settlement', 'pending');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE debt_type AS ENUM ('credit_card', 'personal_loan', 'mortgage_arrears', 'utility_arrears', 'council_tax', 'overdraft', 'store_card', 'hire_purchase', 'other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE debt_sfs_category AS ENUM ('income', 'essential_expense', 'discretionary_expense', 'debt_repayment');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE debt_distribution_status AS ENUM ('scheduled', 'processing', 'sent', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS debt_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  case_number text UNIQUE NOT NULL,
  debtor_name text NOT NULL,
  debtor_reference text,
  status debt_case_status NOT NULL DEFAULT 'intake',
  plan_type debt_plan_type NOT NULL DEFAULT 'pending',
  monthly_disposable_income numeric(12,2) NOT NULL DEFAULT 0,
  total_debt numeric(12,2) NOT NULL DEFAULT 0,
  recovery_rate_target numeric(5,2) NOT NULL DEFAULT 90.00,
  next_distribution_date date,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE debt_cases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "select_own_debt_cases" ON debt_cases;
CREATE POLICY "select_own_debt_cases" ON debt_cases FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "insert_own_debt_cases" ON debt_cases;
CREATE POLICY "insert_own_debt_cases" ON debt_cases FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "update_own_debt_cases" ON debt_cases;
CREATE POLICY "update_own_debt_cases" ON debt_cases FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "delete_own_debt_cases" ON debt_cases;
CREATE POLICY "delete_own_debt_cases" ON debt_cases FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS debt_creditors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES debt_cases(id) ON DELETE CASCADE,
  creditor_name text NOT NULL,
  debt_type debt_type NOT NULL DEFAULT 'credit_card',
  account_reference text,
  current_balance numeric(12,2) NOT NULL DEFAULT 0,
  interest_rate numeric(5,2) NOT NULL DEFAULT 0,
  minimum_payment numeric(12,2),
  pro_rata_amount numeric(12,2) NOT NULL DEFAULT 0,
  is_priority boolean NOT NULL DEFAULT false,
  settlement_offer numeric(12,2),
  created_at timestamptz DEFAULT now()
);
ALTER TABLE debt_creditors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "select_own_debt_creditors" ON debt_creditors;
CREATE POLICY "select_own_debt_creditors" ON debt_creditors FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_creditors.case_id AND debt_cases.user_id = auth.uid()));
DROP POLICY IF EXISTS "insert_own_debt_creditors" ON debt_creditors;
CREATE POLICY "insert_own_debt_creditors" ON debt_creditors FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_creditors.case_id AND debt_cases.user_id = auth.uid()));
DROP POLICY IF EXISTS "update_own_debt_creditors" ON debt_creditors;
CREATE POLICY "update_own_debt_creditors" ON debt_creditors FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_creditors.case_id AND debt_cases.user_id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_creditors.case_id AND debt_cases.user_id = auth.uid()));
DROP POLICY IF EXISTS "delete_own_debt_creditors" ON debt_creditors;
CREATE POLICY "delete_own_debt_creditors" ON debt_creditors FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_creditors.case_id AND debt_cases.user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS debt_sfs_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES debt_cases(id) ON DELETE CASCADE,
  category debt_sfs_category NOT NULL,
  label text NOT NULL,
  amount numeric(12,2) NOT NULL DEFAULT 0,
  is_recurring boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE debt_sfs_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "select_own_debt_sfs" ON debt_sfs_entries;
CREATE POLICY "select_own_debt_sfs" ON debt_sfs_entries FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_sfs_entries.case_id AND debt_cases.user_id = auth.uid()));
DROP POLICY IF EXISTS "insert_own_debt_sfs" ON debt_sfs_entries;
CREATE POLICY "insert_own_debt_sfs" ON debt_sfs_entries FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_sfs_entries.case_id AND debt_cases.user_id = auth.uid()));
DROP POLICY IF EXISTS "update_own_debt_sfs" ON debt_sfs_entries;
CREATE POLICY "update_own_debt_sfs" ON debt_sfs_entries FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_sfs_entries.case_id AND debt_cases.user_id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_sfs_entries.case_id AND debt_cases.user_id = auth.uid()));
DROP POLICY IF EXISTS "delete_own_debt_sfs" ON debt_sfs_entries;
CREATE POLICY "delete_own_debt_sfs" ON debt_sfs_entries FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_sfs_entries.case_id AND debt_cases.user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS debt_distributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES debt_cases(id) ON DELETE CASCADE,
  creditor_id uuid NOT NULL REFERENCES debt_creditors(id) ON DELETE CASCADE,
  distribution_date date NOT NULL,
  amount numeric(12,2) NOT NULL DEFAULT 0,
  status debt_distribution_status NOT NULL DEFAULT 'scheduled',
  reference text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE debt_distributions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "select_own_debt_dist" ON debt_distributions;
CREATE POLICY "select_own_debt_dist" ON debt_distributions FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_distributions.case_id AND debt_cases.user_id = auth.uid()));
DROP POLICY IF EXISTS "insert_own_debt_dist" ON debt_distributions;
CREATE POLICY "insert_own_debt_dist" ON debt_distributions FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_distributions.case_id AND debt_cases.user_id = auth.uid()));
DROP POLICY IF EXISTS "update_own_debt_dist" ON debt_distributions;
CREATE POLICY "update_own_debt_dist" ON debt_distributions FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_distributions.case_id AND debt_cases.user_id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_distributions.case_id AND debt_cases.user_id = auth.uid()));
DROP POLICY IF EXISTS "delete_own_debt_dist" ON debt_distributions;
CREATE POLICY "delete_own_debt_dist" ON debt_distributions FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_distributions.case_id AND debt_cases.user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS debt_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES debt_cases(id) ON DELETE CASCADE,
  milestone text NOT NULL,
  description text,
  actor text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE debt_audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "select_own_debt_audit" ON debt_audit_log;
CREATE POLICY "select_own_debt_audit" ON debt_audit_log FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_audit_log.case_id AND debt_cases.user_id = auth.uid()));
DROP POLICY IF EXISTS "insert_own_debt_audit" ON debt_audit_log;
CREATE POLICY "insert_own_debt_audit" ON debt_audit_log FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_audit_log.case_id AND debt_cases.user_id = auth.uid()));
DROP POLICY IF EXISTS "update_own_debt_audit" ON debt_audit_log;
CREATE POLICY "update_own_debt_audit" ON debt_audit_log FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_audit_log.case_id AND debt_cases.user_id = auth.uid())) WITH CHECK (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_audit_log.case_id AND debt_cases.user_id = auth.uid()));
DROP POLICY IF EXISTS "delete_own_debt_audit" ON debt_audit_log;
CREATE POLICY "delete_own_debt_audit" ON debt_audit_log FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_audit_log.case_id AND debt_cases.user_id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_debt_creditors_case_id ON debt_creditors(case_id);
CREATE INDEX IF NOT EXISTS idx_debt_sfs_case_id ON debt_sfs_entries(case_id);
CREATE INDEX IF NOT EXISTS idx_debt_dist_case_id ON debt_distributions(case_id);
CREATE INDEX IF NOT EXISTS idx_debt_dist_creditor_id ON debt_distributions(creditor_id);
CREATE INDEX IF NOT EXISTS idx_debt_audit_case_id ON debt_audit_log(case_id);
CREATE INDEX IF NOT EXISTS idx_debt_cases_user_id ON debt_cases(user_id);

CREATE OR REPLACE FUNCTION update_debt_cases_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_debt_cases_updated_at ON debt_cases;
CREATE TRIGGER trg_debt_cases_updated_at BEFORE UPDATE ON debt_cases FOR EACH ROW EXECUTE FUNCTION update_debt_cases_updated_at();