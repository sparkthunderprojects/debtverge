/*
# Debt Verge — Tenant Sign-Up & Provisioning Schema

## Overview
Adds a new table to support self-service sign-up for Debt Management (DM) firms
subscribing to the DebtVerge platform. Each row represents a tenant (a DM firm)
that has registered through the sign-up wizard, with their company details, selected
plan tier, billing cycle, add-ons, subscription status, and provisioning state.

## New Tables

### debtverge_tenants
Stores DM firm tenant records created via the self-service sign-up wizard.
- id (uuid, primary key)
- company_name (text, not null — the DM firm's legal name)
- fca_frn (text, not null — FCA Firm Reference Number, 6-7 digits)
- admin_first_name (text, not null)
- admin_last_name (text, not null)
- admin_email (text, not null — work/corporate email)
- admin_mobile (text, not null — UK mobile number)
- auth_user_id (uuid, nullable — links to auth.users once the admin account is created)
- plan_tier (text, not null, default 'starter' — 'starter' | 'professional' | 'enterprise')
- billing_cycle (text, not null, default 'monthly' — 'monthly' | 'annual')
- base_price_gbp (numeric, monthly base price of selected tier)
- additional_seats (int, not null, default 0 — extra advisor seats purchased)
- open_banking_credits (int, not null, default 0 — Open Banking API fetch credit pack count)
- sms_pack_enabled (boolean, not null, default false — automated SMS/WhatsApp messaging pack)
- subtotal_gbp (numeric, pre-tax total)
- vat_gbp (numeric, 20% VAT)
- total_gbp (numeric, total due today including VAT)
- subscription_status (text, not null, default 'trial' — 'trial' | 'active' | 'suspended' | 'cancelled')
- provisioning_status (text, not null, default 'pending' — 'pending' | 'in_progress' | 'complete' | 'failed')
- tenant_slug (text, unique — URL-friendly workspace identifier derived from company name)
- workspace_url (text, nullable — full URL to the provisioned workspace)
- created_at (timestamptz)
- updated_at (timestamptz)

## Security
- RLS enabled on debtverge_tenants.
- This table is written during public self-service sign-up (before auth), so it uses
  TO anon, authenticated for INSERT (the wizard runs unauthenticated) and SELECT.
- UPDATE/DELETE restricted to authenticated (only logged-in admins can modify tenants).
- 4 separate policies (SELECT, INSERT, UPDATE, DELETE).
*/

CREATE TABLE IF NOT EXISTS debtverge_tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name text NOT NULL,
  fca_frn text NOT NULL,
  admin_first_name text NOT NULL,
  admin_last_name text NOT NULL,
  admin_email text NOT NULL,
  admin_mobile text NOT NULL,
  auth_user_id uuid,
  plan_tier text NOT NULL DEFAULT 'starter',
  billing_cycle text NOT NULL DEFAULT 'monthly',
  base_price_gbp numeric(10,2) NOT NULL DEFAULT 299,
  additional_seats int NOT NULL DEFAULT 0,
  open_banking_credits int NOT NULL DEFAULT 0,
  sms_pack_enabled boolean NOT NULL DEFAULT false,
  subtotal_gbp numeric(10,2) NOT NULL DEFAULT 0,
  vat_gbp numeric(10,2) NOT NULL DEFAULT 0,
  total_gbp numeric(10,2) NOT NULL DEFAULT 0,
  subscription_status text NOT NULL DEFAULT 'trial',
  provisioning_status text NOT NULL DEFAULT 'pending',
  tenant_slug text UNIQUE,
  workspace_url text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE debtverge_tenants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_debtverge_tenants" ON debtverge_tenants;
CREATE POLICY "anon_select_debtverge_tenants" ON debtverge_tenants FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_debtverge_tenants" ON debtverge_tenants;
CREATE POLICY "anon_insert_debtverge_tenants" ON debtverge_tenants FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "auth_update_debtverge_tenants" ON debtverge_tenants;
CREATE POLICY "auth_update_debtverge_tenants" ON debtverge_tenants FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "auth_delete_debtverge_tenants" ON debtverge_tenants;
CREATE POLICY "auth_delete_debtverge_tenants" ON debtverge_tenants FOR DELETE
  TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_debtverge_tenants_slug ON debtverge_tenants(tenant_slug);
CREATE INDEX IF NOT EXISTS idx_debtverge_tenants_email ON debtverge_tenants(admin_email);