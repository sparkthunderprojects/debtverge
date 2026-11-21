/*
# Debt Verge — Bank Transaction Auto-Categorization & Annual SFS Review Workflow

## Overview
Adds two new tables to extend the Debt Verge module:
1. debt_bank_transactions — parsed bank statement line items that auto-map to SFS expense categories
2. debt_annual_reviews — 12-month SFS review snapshots with year-on-year comparison data

## New Tables

### debt_bank_transactions
Stores imported bank statement line items with automatic and manual categorization.
- case_id (uuid FK to debt_cases)
- transaction_date (date, when the transaction occurred)
- description (text, raw bank statement description e.g. "TESCO STORES 4823")
- amount (numeric, transaction amount — positive for income/credit, negative for expense/debit)
- merchant_hint (text, extracted merchant name for matching)
- auto_category (DebtSfsCategory, auto-assigned from merchant mapping rules)
- auto_label (text, auto-assigned SFS label e.g. "Food & Housekeeping")
- manual_category (DebtSfsCategory, advisor override — takes precedence when set)
- manual_label (text, advisor override label)
- confidence (text: high, medium, low, unmatched — confidence of auto-match)
- imported_to_sfs (boolean, whether the txn has been pushed to debt_sfs_entries)
- sfs_entry_id (uuid, FK to debt_sfs_entries if imported)
- created_at (timestamptz)

### debt_annual_reviews
Stores annual SFS review snapshots for 12-month compliance workflow.
- case_id (uuid FK to debt_cases)
- review_number (int, sequential — 1 for first annual, 2 for second, etc.)
- review_date (date, when the review was initiated)
- review_due_date (date, calculated due date — 12 months from last review/case creation)
- status (text: pending, in_progress, completed, overdue)
- snapshot_income (numeric, total income at review time)
- snapshot_essential_expenses (numeric)
- snapshot_discretionary_expenses (numeric)
- snapshot_disposable_income (numeric)
- snapshot_total_debt (numeric)
- snapshot_property_value (numeric, nullable)
- snapshot_tenure_type (text, nullable)
- previous_review_id (uuid, FK to self for chaining)
- income_change (numeric, delta from previous snapshot)
- housing_change (boolean, whether tenure/property changed)
- audit_log (jsonb, year-on-year comparison details)
- completed_at (timestamptz, nullable)
- created_at (timestamptz)

## Security
- RLS enabled on both tables.
- TO authenticated, ownership through parent debt_cases via EXISTS subquery.
- 4 policies each (SELECT, INSERT, UPDATE, DELETE).
*/

CREATE TABLE IF NOT EXISTS debt_bank_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES debt_cases(id) ON DELETE CASCADE,
  transaction_date date NOT NULL,
  description text NOT NULL,
  amount numeric(12,2) NOT NULL,
  merchant_hint text,
  auto_category text NOT NULL DEFAULT 'discretionary_expense',
  auto_label text NOT NULL DEFAULT 'Uncategorized',
  manual_category text,
  manual_label text,
  confidence text NOT NULL DEFAULT 'unmatched',
  imported_to_sfs boolean NOT NULL DEFAULT false,
  sfs_entry_id uuid,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE debt_bank_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_debt_bank_txns" ON debt_bank_transactions;
CREATE POLICY "select_own_debt_bank_txns" ON debt_bank_transactions FOR SELECT
  TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_bank_transactions.case_id AND debt_cases.user_id = auth.uid()));

DROP POLICY IF EXISTS "insert_own_debt_bank_txns" ON debt_bank_transactions;
CREATE POLICY "insert_own_debt_bank_txns" ON debt_bank_transactions FOR INSERT
  TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_bank_transactions.case_id AND debt_cases.user_id = auth.uid()));

DROP POLICY IF EXISTS "update_own_debt_bank_txns" ON debt_bank_transactions;
CREATE POLICY "update_own_debt_bank_txns" ON debt_bank_transactions FOR UPDATE
  TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_bank_transactions.case_id AND debt_cases.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_bank_transactions.case_id AND debt_cases.user_id = auth.uid()));

DROP POLICY IF EXISTS "delete_own_debt_bank_txns" ON debt_bank_transactions;
CREATE POLICY "delete_own_debt_bank_txns" ON debt_bank_transactions FOR DELETE
  TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_bank_transactions.case_id AND debt_cases.user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS debt_annual_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES debt_cases(id) ON DELETE CASCADE,
  review_number int NOT NULL DEFAULT 1,
  review_date date NOT NULL DEFAULT CURRENT_DATE,
  review_due_date date NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  snapshot_income numeric(12,2) NOT NULL DEFAULT 0,
  snapshot_essential_expenses numeric(12,2) NOT NULL DEFAULT 0,
  snapshot_discretionary_expenses numeric(12,2) NOT NULL DEFAULT 0,
  snapshot_disposable_income numeric(12,2) NOT NULL DEFAULT 0,
  snapshot_total_debt numeric(12,2) NOT NULL DEFAULT 0,
  snapshot_property_value numeric(12,2),
  snapshot_tenure_type text,
  previous_review_id uuid,
  income_change numeric(12,2) NOT NULL DEFAULT 0,
  housing_change boolean NOT NULL DEFAULT false,
  audit_log jsonb NOT NULL DEFAULT '{}'::jsonb,
  completed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE debt_annual_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_debt_reviews" ON debt_annual_reviews;
CREATE POLICY "select_own_debt_reviews" ON debt_annual_reviews FOR SELECT
  TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_annual_reviews.case_id AND debt_cases.user_id = auth.uid()));

DROP POLICY IF EXISTS "insert_own_debt_reviews" ON debt_annual_reviews;
CREATE POLICY "insert_own_debt_reviews" ON debt_annual_reviews FOR INSERT
  TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_annual_reviews.case_id AND debt_cases.user_id = auth.uid()));

DROP POLICY IF EXISTS "update_own_debt_reviews" ON debt_annual_reviews;
CREATE POLICY "update_own_debt_reviews" ON debt_annual_reviews FOR UPDATE
  TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_annual_reviews.case_id AND debt_cases.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_annual_reviews.case_id AND debt_cases.user_id = auth.uid()));

DROP POLICY IF EXISTS "delete_own_debt_reviews" ON debt_annual_reviews;
CREATE POLICY "delete_own_debt_reviews" ON debt_annual_reviews FOR DELETE
  TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_annual_reviews.case_id AND debt_cases.user_id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_debt_bank_txns_case_id ON debt_bank_transactions(case_id);
CREATE INDEX IF NOT EXISTS idx_debt_annual_reviews_case_id ON debt_annual_reviews(case_id);
CREATE INDEX IF NOT EXISTS idx_debt_annual_reviews_due_date ON debt_annual_reviews(review_due_date);