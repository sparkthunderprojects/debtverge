/*
# Client Payment Schedule & Transaction Ledger

## Overview
Adds a client payment schedule and transaction ledger to the DebtVerge
platform. The schedule stores the agreed-upon frequency, preferred
payment day, installment amount, and next due date on the existing
debt_cases table. The ledger table tracks individual payment
transactions (scheduled, cleared, missed, bounced, overdue) with
amount due vs paid, failure reasons, and cleared dates.

## Modified Tables
1. debt_cases — adds four nullable columns:
   - payment_frequency (text): 'weekly' | 'fortnightly' | 'four_weekly' | 'monthly' | 'specific_date'
   - preferred_payment_day (text): numeric day ('1'–'28'), 'last_working_day', or 'monday'
   - installment_amount (numeric(12,2)): per-frequency installment value
   - next_due_date (date): ISO date of the next scheduled payment

## New Tables
1. debt_payment_transactions — per-installment ledger rows:
   - id (uuid, PK)
   - case_id (uuid FK → debt_cases ON DELETE CASCADE)
   - due_date (date, not null)
   - amount_due (numeric(12,2), not null, default 0)
   - amount_paid (numeric(12,2), not null, default 0)
   - status (debt_payment_txn_status enum: scheduled, awaiting_clearance, cleared, missed, bounced, overdue)
   - failure_reason (text, nullable — e.g. "Refer to Drawer / Insufficient Funds")
   - cleared_date (date, nullable)
   - created_at (timestamptz, default now())

## Security
- RLS enabled on debt_payment_transactions.
- TO authenticated with ownership scoped through parent debt_cases
  via EXISTS subquery (same pattern as debt_creditors, debt_sfs_entries, etc.).
- Four policies: select, insert, update, delete — no FOR ALL.

## Indexes
- idx_debt_payment_txn_case_id on debt_payment_transactions(case_id)
- idx_debt_payment_txn_status on debt_payment_transactions(status)

## Notes
1. All new debt_cases columns are nullable so existing rows are
   unaffected — the schedule is opt-in per case.
2. The enum uses IF NOT EXISTS via DO $$ / EXCEPTION pattern for
   idempotency.
3. No existing tables, columns, policies, or data are removed or
   renamed — this is purely additive.
*/

-- New enum for transaction status
DO $$ BEGIN
  CREATE TYPE debt_payment_txn_status AS ENUM (
    'scheduled', 'awaiting_clearance', 'cleared', 'missed', 'bounced', 'overdue'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Additive columns on debt_cases (all nullable, no data loss)
ALTER TABLE debt_cases ADD COLUMN IF NOT EXISTS payment_frequency text;
ALTER TABLE debt_cases ADD COLUMN IF NOT EXISTS preferred_payment_day text;
ALTER TABLE debt_cases ADD COLUMN IF NOT EXISTS installment_amount numeric(12,2);
ALTER TABLE debt_cases ADD COLUMN IF NOT EXISTS next_due_date date;

-- Transaction ledger table
CREATE TABLE IF NOT EXISTS debt_payment_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES debt_cases(id) ON DELETE CASCADE,
  due_date date NOT NULL,
  amount_due numeric(12,2) NOT NULL DEFAULT 0,
  amount_paid numeric(12,2) NOT NULL DEFAULT 0,
  status debt_payment_txn_status NOT NULL DEFAULT 'scheduled',
  failure_reason text,
  cleared_date date,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE debt_payment_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_debt_payment_txn" ON debt_payment_transactions;
CREATE POLICY "select_own_debt_payment_txn" ON debt_payment_transactions
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_payment_transactions.case_id AND debt_cases.user_id = auth.uid()));

DROP POLICY IF EXISTS "insert_own_debt_payment_txn" ON debt_payment_transactions;
CREATE POLICY "insert_own_debt_payment_txn" ON debt_payment_transactions
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_payment_transactions.case_id AND debt_cases.user_id = auth.uid()));

DROP POLICY IF EXISTS "update_own_debt_payment_txn" ON debt_payment_transactions;
CREATE POLICY "update_own_debt_payment_txn" ON debt_payment_transactions
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_payment_transactions.case_id AND debt_cases.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_payment_transactions.case_id AND debt_cases.user_id = auth.uid()));

DROP POLICY IF EXISTS "delete_own_debt_payment_txn" ON debt_payment_transactions;
CREATE POLICY "delete_own_debt_payment_txn" ON debt_payment_transactions
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_payment_transactions.case_id AND debt_cases.user_id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_debt_payment_txn_case_id ON debt_payment_transactions(case_id);
CREATE INDEX IF NOT EXISTS idx_debt_payment_txn_status ON debt_payment_transactions(status);