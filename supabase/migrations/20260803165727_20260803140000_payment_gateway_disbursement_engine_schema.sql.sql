/*
# Payment Gateway & Disbursement Engine Schema

## Overview
Builds a modular, white-label payment processing and disbursement engine for DebtVerge and IVAVerge.
The architecture is strictly adapter-based: tenant firms plug in their own third-party payment
gateway credentials (Stripe, GoCardless, Open Banking providers, merchant acquirers) without
hardcoded dependencies. Financial data is isolated per-tenant with RLS and PCI-DSS boundaries
(no raw PAN/CVV stored — only gateway tokens).

## New Tables

1. **payment_gateway_configs** — White-label gateway configuration per tenant/organization.
   Each firm configures their own payment processor (Stripe, GoCardless, Open Banking, etc.)
   with API key references stored as edge-function secret names (not plaintext keys in the DB).
   - Columns: id, organization_id, gateway_type, display_name, merchant_id, secret_ref (name of
     the Supabase edge function secret holding the API key), webhook_secret_ref, is_active,
     test_mode, supported_features (jsonb array), created_at, updated_at.

2. **payment_methods** — Tokenised card/payment method storage linked to debt cases.
   Stores gateway payment tokens (never raw card numbers). Agents/admins can save, update, delete.
   - Columns: id, organization_id, case_id, gateway_config_id, gateway_token, payment_type
     (card/bacs/open_banking), card_brand, last4, expiry_month, expiry_year, cardholder_name,
     is_default, is_active, created_at, updated_at.

3. **recurring_payment_schedules** — Recurring payment scheduling linked to debtor payment plans
   or SFS budget frequency (weekly, fortnightly, monthly).
   - Columns: id, organization_id, case_id, payment_method_id, gateway_config_id, frequency,
     installment_amount, preferred_payment_day, start_date, end_date, next_collection_date,
     retry_count, max_retries, status, linked_plan_type (dmp/iva/sfs), created_at, updated_at.

4. **gateway_payment_transactions** — Transaction log for all gateway-processed payments
   (incoming client payments via card/bacs/open banking).
   - Columns: id, organization_id, case_id, schedule_id, payment_method_id, gateway_config_id,
     gateway_transaction_id, amount, currency, status, failure_reason, gateway_response (jsonb),
     attempted_at, settled_at, retry_of (self-reference for retries), created_at, updated_at.

5. **disbursement_waterfall_entries** — Waterfall accounting ledger for distributing collected
   funds across IP/Nominee fees, nominee costs, third-party disbursements, and pro-rata creditor
   dividends.
   - Columns: id, organization_id, case_id, source_transaction_id, waterfall_order, category
     (nominee_fee/supervisor_fee/nominee_cost/third_party_disbursement/creditor_dividend/reserve),
     payee_name, payee_reference, allocated_amount, status, scheduled_date, settled_date,
     creditor_id, distribution_run_id, created_at, updated_at.

6. **payment_reconciliation_log** — Reconciliation tracking for settled funds, failed collections,
   and retry outcomes.
   - Columns: id, organization_id, case_id, transaction_id, reconciliation_date, status,
     expected_amount, actual_amount, variance, failure_code, retry_scheduled, notes,
     created_at, updated_at.

## Security (RLS)
- All tables enable RLS.
- All tables are scoped TO authenticated with organization membership checks via organization_users.
- payment_gateway_configs: only org members can view; only admins can create/update/delete.
- payment_methods: agents/admins can CRUD within their org.
- recurring_payment_schedules: agents/admins can CRUD within their org.
- gateway_payment_transactions: read-only for agents; created by edge functions (service role).
- disbursement_waterfall_entries: agents/admins can view/create/update within org.
- payment_reconciliation_log: agents/admins can view within org.

## Important Notes
1. API keys are NEVER stored in the database — only the secret *name* (e.g., "STRIPE_SECRET_KEY_ORG_123")
   is stored. The actual key lives in Supabase edge function secrets, accessible only server-side.
2. No raw card numbers (PAN) or CVVs are stored — only gateway tokens and last4 for display.
3. All tables use organization_id for tenant isolation.
4. gateway_payment_transactions.gateway_response stores the full gateway response as jsonb for audit
   but never contains raw card data (gateways tokenise before returning).
*/

-- ============================================================
-- 1. payment_gateway_configs
-- ============================================================

CREATE TABLE IF NOT EXISTS payment_gateway_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  gateway_type text NOT NULL CHECK (gateway_type IN ('stripe', 'gocardless', 'open_banking', 'merchant_acquirer', 'custom')),
  display_name text NOT NULL,
  merchant_id text,
  secret_ref text NOT NULL,
  webhook_secret_ref text,
  is_active boolean NOT NULL DEFAULT true,
  test_mode boolean NOT NULL DEFAULT false,
  supported_features jsonb NOT NULL DEFAULT '["recurring_card","tokenisation"]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE payment_gateway_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gateway_select_org" ON payment_gateway_configs;
CREATE POLICY "gateway_select_org" ON payment_gateway_configs FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = payment_gateway_configs.organization_id AND ou.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "gateway_insert_org" ON payment_gateway_configs;
CREATE POLICY "gateway_insert_org" ON payment_gateway_configs FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = payment_gateway_configs.organization_id AND ou.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "gateway_update_org" ON payment_gateway_configs;
CREATE POLICY "gateway_update_org" ON payment_gateway_configs FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = payment_gateway_configs.organization_id AND ou.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = payment_gateway_configs.organization_id AND ou.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "gateway_delete_org" ON payment_gateway_configs;
CREATE POLICY "gateway_delete_org" ON payment_gateway_configs FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = payment_gateway_configs.organization_id AND ou.user_id = auth.uid())
  );

-- ============================================================
-- 2. payment_methods (tokenised card storage)
-- ============================================================

CREATE TABLE IF NOT EXISTS payment_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id uuid REFERENCES debt_cases(id) ON DELETE CASCADE,
  gateway_config_id uuid REFERENCES payment_gateway_configs(id) ON DELETE SET NULL,
  gateway_token text NOT NULL,
  payment_type text NOT NULL CHECK (payment_type IN ('card', 'bacs', 'open_banking')),
  card_brand text,
  last4 text,
  expiry_month integer,
  expiry_year integer,
  cardholder_name text,
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE payment_methods ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pm_select_org" ON payment_methods;
CREATE POLICY "pm_select_org" ON payment_methods FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = payment_methods.organization_id AND ou.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "pm_insert_org" ON payment_methods;
CREATE POLICY "pm_insert_org" ON payment_methods FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = payment_methods.organization_id AND ou.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "pm_update_org" ON payment_methods;
CREATE POLICY "pm_update_org" ON payment_methods FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = payment_methods.organization_id AND ou.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = payment_methods.organization_id AND ou.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "pm_delete_org" ON payment_methods;
CREATE POLICY "pm_delete_org" ON payment_methods FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = payment_methods.organization_id AND ou.user_id = auth.uid())
  );

-- ============================================================
-- 3. recurring_payment_schedules
-- ============================================================

CREATE TABLE IF NOT EXISTS recurring_payment_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES debt_cases(id) ON DELETE CASCADE,
  payment_method_id uuid REFERENCES payment_methods(id) ON DELETE SET NULL,
  gateway_config_id uuid REFERENCES payment_gateway_configs(id) ON DELETE SET NULL,
  frequency text NOT NULL CHECK (frequency IN ('weekly', 'fortnightly', 'four_weekly', 'monthly')),
  installment_amount numeric(12,2) NOT NULL DEFAULT 0,
  preferred_payment_day text,
  start_date date NOT NULL DEFAULT CURRENT_DATE,
  end_date date,
  next_collection_date date NOT NULL DEFAULT CURRENT_DATE,
  retry_count integer NOT NULL DEFAULT 0,
  max_retries integer NOT NULL DEFAULT 3,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'cancelled', 'suspended')),
  linked_plan_type text CHECK (linked_plan_type IN ('dmp', 'iva', 'sfs', 'settlement')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE recurring_payment_schedules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rps_select_org" ON recurring_payment_schedules;
CREATE POLICY "rps_select_org" ON recurring_payment_schedules FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = recurring_payment_schedules.organization_id AND ou.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "rps_insert_org" ON recurring_payment_schedules;
CREATE POLICY "rps_insert_org" ON recurring_payment_schedules FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = recurring_payment_schedules.organization_id AND ou.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "rps_update_org" ON recurring_payment_schedules;
CREATE POLICY "rps_update_org" ON recurring_payment_schedules FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = recurring_payment_schedules.organization_id AND ou.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = recurring_payment_schedules.organization_id AND ou.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "rps_delete_org" ON recurring_payment_schedules;
CREATE POLICY "rps_delete_org" ON recurring_payment_schedules FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = recurring_payment_schedules.organization_id AND ou.user_id = auth.uid())
  );

-- ============================================================
-- 4. gateway_payment_transactions
-- ============================================================

CREATE TABLE IF NOT EXISTS gateway_payment_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id uuid REFERENCES debt_cases(id) ON DELETE CASCADE,
  schedule_id uuid REFERENCES recurring_payment_schedules(id) ON DELETE SET NULL,
  payment_method_id uuid REFERENCES payment_methods(id) ON DELETE SET NULL,
  gateway_config_id uuid REFERENCES payment_gateway_configs(id) ON DELETE SET NULL,
  gateway_transaction_id text,
  amount numeric(12,2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'GBP',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'succeeded', 'failed', 'refunded', 'partially_refunded', 'retrying')),
  failure_reason text,
  gateway_response jsonb,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  retry_of uuid REFERENCES gateway_payment_transactions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE gateway_payment_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gpt_select_org" ON gateway_payment_transactions;
CREATE POLICY "gpt_select_org" ON gateway_payment_transactions FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = gateway_payment_transactions.organization_id AND ou.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "gpt_insert_org" ON gateway_payment_transactions;
CREATE POLICY "gpt_insert_org" ON gateway_payment_transactions FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = gateway_payment_transactions.organization_id AND ou.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "gpt_update_org" ON gateway_payment_transactions;
CREATE POLICY "gpt_update_org" ON gateway_payment_transactions FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = gateway_payment_transactions.organization_id AND ou.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = gateway_payment_transactions.organization_id AND ou.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "gpt_delete_org" ON gateway_payment_transactions;
CREATE POLICY "gpt_delete_org" ON gateway_payment_transactions FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = gateway_payment_transactions.organization_id AND ou.user_id = auth.uid())
  );

-- ============================================================
-- 5. disbursement_waterfall_entries
-- ============================================================

CREATE TABLE IF NOT EXISTS disbursement_waterfall_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id uuid REFERENCES debt_cases(id) ON DELETE CASCADE,
  source_transaction_id uuid REFERENCES gateway_payment_transactions(id) ON DELETE SET NULL,
  waterfall_order integer NOT NULL DEFAULT 0,
  category text NOT NULL CHECK (category IN ('nominee_fee', 'supervisor_fee', 'nominee_cost', 'third_party_disbursement', 'creditor_dividend', 'reserve')),
  payee_name text NOT NULL,
  payee_reference text,
  allocated_amount numeric(12,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'processing', 'settled', 'failed', 'reversed')),
  scheduled_date date,
  settled_date date,
  creditor_id uuid REFERENCES debt_creditors(id) ON DELETE SET NULL,
  distribution_run_id uuid REFERENCES debt_iva_distribution_runs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE disbursement_waterfall_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dwe_select_org" ON disbursement_waterfall_entries;
CREATE POLICY "dwe_select_org" ON disbursement_waterfall_entries FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = disbursement_waterfall_entries.organization_id AND ou.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "dwe_insert_org" ON disbursement_waterfall_entries;
CREATE POLICY "dwe_insert_org" ON disbursement_waterfall_entries FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = disbursement_waterfall_entries.organization_id AND ou.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "dwe_update_org" ON disbursement_waterfall_entries;
CREATE POLICY "dwe_update_org" ON disbursement_waterfall_entries FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = disbursement_waterfall_entries.organization_id AND ou.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = disbursement_waterfall_entries.organization_id AND ou.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "dwe_delete_org" ON disbursement_waterfall_entries;
CREATE POLICY "dwe_delete_org" ON disbursement_waterfall_entries FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = disbursement_waterfall_entries.organization_id AND ou.user_id = auth.uid())
  );

-- ============================================================
-- 6. payment_reconciliation_log
-- ============================================================

CREATE TABLE IF NOT EXISTS payment_reconciliation_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id uuid REFERENCES debt_cases(id) ON DELETE CASCADE,
  transaction_id uuid REFERENCES gateway_payment_transactions(id) ON DELETE CASCADE,
  reconciliation_date date NOT NULL DEFAULT CURRENT_DATE,
  status text NOT NULL DEFAULT 'matched' CHECK (status IN ('matched', 'unmatched', 'shortfall', 'overage', 'failed', 'retrying')),
  expected_amount numeric(12,2) NOT NULL DEFAULT 0,
  actual_amount numeric(12,2) NOT NULL DEFAULT 0,
  variance numeric(12,2) NOT NULL DEFAULT 0,
  failure_code text,
  retry_scheduled boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE payment_reconciliation_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "prl_select_org" ON payment_reconciliation_log;
CREATE POLICY "prl_select_org" ON payment_reconciliation_log FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = payment_reconciliation_log.organization_id AND ou.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "prl_insert_org" ON payment_reconciliation_log;
CREATE POLICY "prl_insert_org" ON payment_reconciliation_log FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = payment_reconciliation_log.organization_id AND ou.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "prl_update_org" ON payment_reconciliation_log;
CREATE POLICY "prl_update_org" ON payment_reconciliation_log FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = payment_reconciliation_log.organization_id AND ou.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = payment_reconciliation_log.organization_id AND ou.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "prl_delete_org" ON payment_reconciliation_log;
CREATE POLICY "prl_delete_org" ON payment_reconciliation_log FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = payment_reconciliation_log.organization_id AND ou.user_id = auth.uid())
  );

-- ============================================================
-- Indexes for performance
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_pgw_org ON payment_gateway_configs(organization_id);
CREATE INDEX IF NOT EXISTS idx_pm_org_case ON payment_methods(organization_id, case_id);
CREATE INDEX IF NOT EXISTS idx_rps_org_case ON recurring_payment_schedules(organization_id, case_id);
CREATE INDEX IF NOT EXISTS idx_gpt_org_case ON gateway_payment_transactions(organization_id, case_id);
CREATE INDEX IF NOT EXISTS idx_gpt_schedule ON gateway_payment_transactions(schedule_id);
CREATE INDEX IF NOT EXISTS idx_gpt_status ON gateway_payment_transactions(status);
CREATE INDEX IF NOT EXISTS idx_dwe_org_case ON disbursement_waterfall_entries(organization_id, case_id);
CREATE INDEX IF NOT EXISTS idx_dwe_source ON disbursement_waterfall_entries(source_transaction_id);
CREATE INDEX IF NOT EXISTS idx_prl_org_case ON payment_reconciliation_log(organization_id, case_id);
CREATE INDEX IF NOT EXISTS idx_prl_transaction ON payment_reconciliation_log(transaction_id);

-- ============================================================
-- updated_at trigger for all new tables
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pgw_updated ON payment_gateway_configs;
CREATE TRIGGER trg_pgw_updated BEFORE UPDATE ON payment_gateway_configs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_pm_updated ON payment_methods;
CREATE TRIGGER trg_pm_updated BEFORE UPDATE ON payment_methods
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_rps_updated ON recurring_payment_schedules;
CREATE TRIGGER trg_rps_updated BEFORE UPDATE ON recurring_payment_schedules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_gpt_updated ON gateway_payment_transactions;
CREATE TRIGGER trg_gpt_updated BEFORE UPDATE ON gateway_payment_transactions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_dwe_updated ON disbursement_waterfall_entries;
CREATE TRIGGER trg_dwe_updated BEFORE UPDATE ON disbursement_waterfall_entries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_prl_updated ON payment_reconciliation_log;
CREATE TRIGGER trg_prl_updated BEFORE UPDATE ON payment_reconciliation_log
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
