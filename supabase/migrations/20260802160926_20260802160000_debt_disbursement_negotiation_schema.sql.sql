/*
# Debt Verge — Disbursement & Negotiation Schema

## Overview
Adds two new tables to support the Disbursement & Negotiation tab:
1. debt_payments — records of incoming debtor payments with auto-split metadata
2. debt_negotiations — per-creditor negotiation event timeline tracking communication status

## New Tables

### debt_payments
Tracks each incoming payment from the debtor and whether it was split across creditors.
- `id` (uuid, PK)
- `case_id` (uuid, FK to debt_cases, CASCADE)
- `amount` (numeric) — the amount received from the debtor
- `payment_date` (date) — when the payment was received
- `expected_amount` (numeric) — the scheduled/expected monthly amount (for shortfall detection)
- `is_shortfall` (boolean) — true if amount < expected_amount
- `shortfall_amount` (numeric) — the difference (expected - amount), 0 if no shortfall
- `reference` (text) — bank reference or notes
- `created_at` (timestamptz)

### debt_negotiations
Per-creditor negotiation event history. Each row is one event in the timeline.
- `id` (uuid, PK)
- `case_id` (uuid, FK to debt_cases, CASCADE)
- `creditor_id` (uuid, FK to debt_creditors, CASCADE)
- `event_type` (text) — e.g. "offer_pack_sent", "hold_placed", "interest_freeze_accepted", "interest_freeze_rejected", "full_offer_accepted", "full_offer_rejected", "counter_offer_received", "follow_up_call", "winding_up_threat"
- `event_label` (text) — human-readable label for the event
- `notes` (text) — optional detail
- `actor` (text) — who performed the action
- `created_at` (timestamptz)

## Security
- RLS enabled on both new tables.
- TO authenticated with ownership scoped through parent debt_cases via EXISTS subquery (same pattern as existing debt child tables).
- 4 policies each (SELECT, INSERT, UPDATE, DELETE).
*/ 

-- ============================================================
-- debt_payments
-- ============================================================

CREATE TABLE IF NOT EXISTS debt_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES debt_cases(id) ON DELETE CASCADE,
  amount numeric(12,2) NOT NULL DEFAULT 0,
  payment_date date NOT NULL DEFAULT CURRENT_DATE,
  expected_amount numeric(12,2) NOT NULL DEFAULT 0,
  is_shortfall boolean NOT NULL DEFAULT false,
  shortfall_amount numeric(12,2) NOT NULL DEFAULT 0,
  reference text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE debt_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_debt_payments" ON debt_payments;
CREATE POLICY "select_own_debt_payments" ON debt_payments FOR SELECT
  TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_payments.case_id AND debt_cases.user_id = auth.uid()));

DROP POLICY IF EXISTS "insert_own_debt_payments" ON debt_payments;
CREATE POLICY "insert_own_debt_payments" ON debt_payments FOR INSERT
  TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_payments.case_id AND debt_cases.user_id = auth.uid()));

DROP POLICY IF EXISTS "update_own_debt_payments" ON debt_payments;
CREATE POLICY "update_own_debt_payments" ON debt_payments FOR UPDATE
  TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_payments.case_id AND debt_cases.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_payments.case_id AND debt_cases.user_id = auth.uid()));

DROP POLICY IF EXISTS "delete_own_debt_payments" ON debt_payments;
CREATE POLICY "delete_own_debt_payments" ON debt_payments FOR DELETE
  TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_payments.case_id AND debt_cases.user_id = auth.uid()));

-- ============================================================
-- debt_negotiations
-- ============================================================

CREATE TABLE IF NOT EXISTS debt_negotiations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES debt_cases(id) ON DELETE CASCADE,
  creditor_id uuid NOT NULL REFERENCES debt_creditors(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  event_label text NOT NULL,
  notes text,
  actor text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE debt_negotiations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_debt_negotiations" ON debt_negotiations;
CREATE POLICY "select_own_debt_negotiations" ON debt_negotiations FOR SELECT
  TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_negotiations.case_id AND debt_cases.user_id = auth.uid()));

DROP POLICY IF EXISTS "insert_own_debt_negotiations" ON debt_negotiations;
CREATE POLICY "insert_own_debt_negotiations" ON debt_negotiations FOR INSERT
  TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_negotiations.case_id AND debt_cases.user_id = auth.uid()));

DROP POLICY IF EXISTS "update_own_debt_negotiations" ON debt_negotiations;
CREATE POLICY "update_own_debt_negotiations" ON debt_negotiations FOR UPDATE
  TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_negotiations.case_id AND debt_cases.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_negotiations.case_id AND debt_cases.user_id = auth.uid()));

DROP POLICY IF EXISTS "delete_own_debt_negotiations" ON debt_negotiations;
CREATE POLICY "delete_own_debt_negotiations" ON debt_negotiations FOR DELETE
  TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_negotiations.case_id AND debt_cases.user_id = auth.uid()));

-- ============================================================
-- Indexes
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_debt_payments_case_id ON debt_payments(case_id);
CREATE INDEX IF NOT EXISTS idx_debt_payments_payment_date ON debt_payments(payment_date);
CREATE INDEX IF NOT EXISTS idx_debt_negotiations_case_id ON debt_negotiations(case_id);
CREATE INDEX IF NOT EXISTS idx_debt_negotiations_creditor_id ON debt_negotiations(creditor_id);