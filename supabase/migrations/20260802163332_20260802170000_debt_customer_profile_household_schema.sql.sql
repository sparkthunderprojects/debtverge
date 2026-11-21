/*
# Debt Verge — Customer Profile & Household Schema

## Overview
Adds two new tables to support the Customer Profile & Household tab:
1. debt_customer_profiles — one-to-one record per case storing personal contact info, current address, household composition, and property/housing details
2. debt_previous_addresses — previous address history for cases where time at current address is under 3 years

## New Tables

### debt_customer_profiles (one-to-one with debt_cases)
Stores all customer profile and household data per case.
- `id` (uuid, PK)
- `case_id` (uuid, FK to debt_cases, UNIQUE, CASCADE) — one profile per case
- Personal & Contact: full_name, primary_email, landline_phone, mobile_phone, work_phone
- Address: address_street, address_city, address_postcode, time_at_address_years, time_at_address_months
- Household: household_adults, household_children_under_16, household_children_16_to_18
- Property: tenure_type (enum), property_value, outstanding_mortgage_or_rent, monthly_rent_or_mortgage, landlord_lender_name
- `created_at`, `updated_at` (timestamptz)

### debt_previous_addresses
Previous address repeater entries, ordered by recency.
- `id` (uuid, PK)
- `case_id` (uuid, FK to debt_cases, CASCADE)
- `address_line` (text) — full previous address line
- `time_at_address` (text) — human-readable duration (e.g. "2 years 6 months")
- `created_at` (timestamptz)

## New Types
- `debt_tenure_type` ENUM: 'owned', 'private_rented', 'social_rented', 'council', 'leased', 'living_with_family'

## Security
- RLS enabled on both new tables.
- TO authenticated with ownership scoped through parent debt_cases via EXISTS subquery (same pattern as existing debt child tables).
- 4 policies each (SELECT, INSERT, UPDATE, DELETE).
*/

DO $$ BEGIN
  CREATE TYPE debt_tenure_type AS ENUM ('owned', 'private_rented', 'social_rented', 'council', 'leased', 'living_with_family');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- debt_customer_profiles
-- ============================================================

CREATE TABLE IF NOT EXISTS debt_customer_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL UNIQUE REFERENCES debt_cases(id) ON DELETE CASCADE,
  -- Personal & Contact
  full_name text,
  primary_email text,
  landline_phone text,
  mobile_phone text,
  work_phone text,
  -- Current Address
  address_street text,
  address_city text,
  address_postcode text,
  time_at_address_years int NOT NULL DEFAULT 0,
  time_at_address_months int NOT NULL DEFAULT 0,
  -- Household Composition
  household_adults int NOT NULL DEFAULT 1,
  household_children_under_16 int NOT NULL DEFAULT 0,
  household_children_16_to_18 int NOT NULL DEFAULT 0,
  -- Property & Housing
  tenure_type debt_tenure_type,
  property_value numeric(12,2),
  outstanding_mortgage_or_rent numeric(12,2),
  monthly_rent_or_mortgage numeric(12,2),
  landlord_lender_name text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE debt_customer_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_debt_profiles" ON debt_customer_profiles;
CREATE POLICY "select_own_debt_profiles" ON debt_customer_profiles FOR SELECT
  TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_customer_profiles.case_id AND debt_cases.user_id = auth.uid()));

DROP POLICY IF EXISTS "insert_own_debt_profiles" ON debt_customer_profiles;
CREATE POLICY "insert_own_debt_profiles" ON debt_customer_profiles FOR INSERT
  TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_customer_profiles.case_id AND debt_cases.user_id = auth.uid()));

DROP POLICY IF EXISTS "update_own_debt_profiles" ON debt_customer_profiles;
CREATE POLICY "update_own_debt_profiles" ON debt_customer_profiles FOR UPDATE
  TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_customer_profiles.case_id AND debt_cases.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_customer_profiles.case_id AND debt_cases.user_id = auth.uid()));

DROP POLICY IF EXISTS "delete_own_debt_profiles" ON debt_customer_profiles;
CREATE POLICY "delete_own_debt_profiles" ON debt_customer_profiles FOR DELETE
  TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_customer_profiles.case_id AND debt_cases.user_id = auth.uid()));

-- ============================================================
-- debt_previous_addresses
-- ============================================================

CREATE TABLE IF NOT EXISTS debt_previous_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES debt_cases(id) ON DELETE CASCADE,
  address_line text NOT NULL,
  time_at_address text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE debt_previous_addresses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_debt_prev_addr" ON debt_previous_addresses;
CREATE POLICY "select_own_debt_prev_addr" ON debt_previous_addresses FOR SELECT
  TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_previous_addresses.case_id AND debt_cases.user_id = auth.uid()));

DROP POLICY IF EXISTS "insert_own_debt_prev_addr" ON debt_previous_addresses;
CREATE POLICY "insert_own_debt_prev_addr" ON debt_previous_addresses FOR INSERT
  TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_previous_addresses.case_id AND debt_cases.user_id = auth.uid()));

DROP POLICY IF EXISTS "update_own_debt_prev_addr" ON debt_previous_addresses;
CREATE POLICY "update_own_debt_prev_addr" ON debt_previous_addresses FOR UPDATE
  TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_previous_addresses.case_id AND debt_cases.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_previous_addresses.case_id AND debt_cases.user_id = auth.uid()));

DROP POLICY IF EXISTS "delete_own_debt_prev_addr" ON debt_previous_addresses;
CREATE POLICY "delete_own_debt_prev_addr" ON debt_previous_addresses FOR DELETE
  TO authenticated USING (EXISTS (SELECT 1 FROM debt_cases WHERE debt_cases.id = debt_previous_addresses.case_id AND debt_cases.user_id = auth.uid()));

-- ============================================================
-- Indexes
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_debt_profiles_case_id ON debt_customer_profiles(case_id);
CREATE INDEX IF NOT EXISTS idx_debt_prev_addr_case_id ON debt_previous_addresses(case_id);