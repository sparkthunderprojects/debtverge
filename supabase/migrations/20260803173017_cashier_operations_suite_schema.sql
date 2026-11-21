/*
# Cashier Operations Suite — Bank Feeds, Batch Processing, Audit Trails, Disbursement Runs, Payment Links

## Purpose
Adds the full cashier operations infrastructure: automated bank feed reconciliation,
one-click batch payment processing, smart exception triage queues, automated creditor
disbursement run generation (BACS/instruction batches), and real-time audit trails with
ledger locking and end-of-day balancing.

## New Tables
1. bank_feeds — Open banking connections or CSV import sources per organization
2. bank_transactions — Individual transactions from bank feeds awaiting matching
3. batch_payment_runs — Batch processing queues for daily collections
4. batch_payment_items — Individual items within a batch run
5. cashier_audit_logs — Immutable audit trail for every manual action
6. ledger_locks — End-of-day balancing and period locking
7. disbursement_runs — Automated creditor disbursement batches (BACS/instruction files)
8. disbursement_run_items — Individual creditor/fee payments within a disbursement run
9. payment_link_invitations — SMS/email payment links sent for failed collections

## Security
- RLS enabled on all 9 new tables.
- Owner-scoped via organization_id membership check using organization_users table.
- 4 policies per table (select/insert/update/delete) for authenticated users.
- Audit logs are insert-only (no update/delete) to preserve immutability.
*/

-- ============================================================
-- bank_feeds
-- ============================================================
CREATE TABLE IF NOT EXISTS bank_feeds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  feed_name text NOT NULL,
  feed_type text NOT NULL DEFAULT 'manual' CHECK (feed_type IN ('open_banking','csv_import','manual')),
  account_number_masked text,
  sort_code text,
  bank_reference text,
  import_frequency text NOT NULL DEFAULT 'manual' CHECK (import_frequency IN ('daily','weekly','manual')),
  last_import_at timestamptz,
  last_import_count int DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE bank_feeds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_bank_feeds" ON bank_feeds;
CREATE POLICY "select_bank_feeds" ON bank_feeds FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = bank_feeds.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "insert_bank_feeds" ON bank_feeds;
CREATE POLICY "insert_bank_feeds" ON bank_feeds FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = bank_feeds.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "update_bank_feeds" ON bank_feeds;
CREATE POLICY "update_bank_feeds" ON bank_feeds FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = bank_feeds.organization_id AND organization_users.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = bank_feeds.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "delete_bank_feeds" ON bank_feeds;
CREATE POLICY "delete_bank_feeds" ON bank_feeds FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = bank_feeds.organization_id AND organization_users.user_id = auth.uid())
  );

-- ============================================================
-- bank_transactions
-- ============================================================
CREATE TABLE IF NOT EXISTS bank_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  bank_feed_id uuid REFERENCES bank_feeds(id) ON DELETE CASCADE,
  case_id uuid,
  transaction_date date NOT NULL,
  amount numeric(12,2) NOT NULL,
  direction text NOT NULL CHECK (direction IN ('credit','debit')),
  reference text,
  description text,
  counterparty_name text,
  counterparty_account text,
  match_status text NOT NULL DEFAULT 'unmatched' CHECK (match_status IN ('unmatched','matched','auto_matched','ignored')),
  matched_transaction_id uuid,
  matched_schedule_id uuid,
  matched_case_id uuid,
  match_confidence text CHECK (match_confidence IN ('high','medium','low','manual')),
  match_notes text,
  imported_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE bank_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_bank_txns" ON bank_transactions;
CREATE POLICY "select_bank_txns" ON bank_transactions FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = bank_transactions.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "insert_bank_txns" ON bank_transactions;
CREATE POLICY "insert_bank_txns" ON bank_transactions FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = bank_transactions.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "update_bank_txns" ON bank_transactions;
CREATE POLICY "update_bank_txns" ON bank_transactions FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = bank_transactions.organization_id AND organization_users.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = bank_transactions.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "delete_bank_txns" ON bank_transactions;
CREATE POLICY "delete_bank_txns" ON bank_transactions FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = bank_transactions.organization_id AND organization_users.user_id = auth.uid())
  );

-- ============================================================
-- batch_payment_runs
-- ============================================================
CREATE TABLE IF NOT EXISTS batch_payment_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  batch_type text NOT NULL DEFAULT 'card_collection' CHECK (batch_type IN ('card_collection','direct_debit','mixed')),
  batch_date date NOT NULL DEFAULT CURRENT_DATE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed','partial')),
  total_items int NOT NULL DEFAULT 0,
  succeeded_count int NOT NULL DEFAULT 0,
  failed_count int NOT NULL DEFAULT 0,
  total_amount numeric(12,2) NOT NULL DEFAULT 0,
  succeeded_amount numeric(12,2) NOT NULL DEFAULT 0,
  failed_amount numeric(12,2) NOT NULL DEFAULT 0,
  initiated_by uuid,
  initiated_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE batch_payment_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_batch_runs" ON batch_payment_runs;
CREATE POLICY "select_batch_runs" ON batch_payment_runs FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = batch_payment_runs.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "insert_batch_runs" ON batch_payment_runs;
CREATE POLICY "insert_batch_runs" ON batch_payment_runs FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = batch_payment_runs.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "update_batch_runs" ON batch_payment_runs;
CREATE POLICY "update_batch_runs" ON batch_payment_runs FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = batch_payment_runs.organization_id AND organization_users.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = batch_payment_runs.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "delete_batch_runs" ON batch_payment_runs;
CREATE POLICY "delete_batch_runs" ON batch_payment_runs FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = batch_payment_runs.organization_id AND organization_users.user_id = auth.uid())
  );

-- ============================================================
-- batch_payment_items
-- ============================================================
CREATE TABLE IF NOT EXISTS batch_payment_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_run_id uuid NOT NULL REFERENCES batch_payment_runs(id) ON DELETE CASCADE,
  schedule_id uuid,
  case_id uuid,
  payment_method_id uuid,
  gateway_config_id uuid,
  amount numeric(12,2) NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','succeeded','failed','retrying')),
  gateway_transaction_id uuid,
  failure_reason text,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE batch_payment_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_batch_items" ON batch_payment_items;
CREATE POLICY "select_batch_items" ON batch_payment_items FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM batch_payment_runs br
     JOIN organization_users ou ON ou.organization_id = br.organization_id
     WHERE br.id = batch_payment_items.batch_run_id AND ou.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "insert_batch_items" ON batch_payment_items;
CREATE POLICY "insert_batch_items" ON batch_payment_items FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM batch_payment_runs br
     JOIN organization_users ou ON ou.organization_id = br.organization_id
     WHERE br.id = batch_payment_items.batch_run_id AND ou.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "update_batch_items" ON batch_payment_items;
CREATE POLICY "update_batch_items" ON batch_payment_items FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM batch_payment_runs br
     JOIN organization_users ou ON ou.organization_id = br.organization_id
     WHERE br.id = batch_payment_items.batch_run_id AND ou.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM batch_payment_runs br
     JOIN organization_users ou ON ou.organization_id = br.organization_id
     WHERE br.id = batch_payment_items.batch_run_id AND ou.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "delete_batch_items" ON batch_payment_items;
CREATE POLICY "delete_batch_items" ON batch_payment_items FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM batch_payment_runs br
     JOIN organization_users ou ON ou.organization_id = br.organization_id
     WHERE br.id = batch_payment_items.batch_run_id AND ou.user_id = auth.uid())
  );

-- ============================================================
-- cashier_audit_logs (insert-only — immutable)
-- ============================================================
CREATE TABLE IF NOT EXISTS cashier_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id uuid,
  user_id uuid,
  user_email text,
  action_type text NOT NULL,
  entity_type text,
  entity_id uuid,
  old_value jsonb,
  new_value jsonb,
  reason text,
  amount_impact numeric(12,2),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE cashier_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_audit_logs" ON cashier_audit_logs;
CREATE POLICY "select_audit_logs" ON cashier_audit_logs FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = cashier_audit_logs.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "insert_audit_logs" ON cashier_audit_logs;
CREATE POLICY "insert_audit_logs" ON cashier_audit_logs FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = cashier_audit_logs.organization_id AND organization_users.user_id = auth.uid())
  );

-- ============================================================
-- ledger_locks
-- ============================================================
CREATE TABLE IF NOT EXISTS ledger_locks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lock_date date NOT NULL,
  lock_type text NOT NULL DEFAULT 'end_of_day' CHECK (lock_type IN ('end_of_day','period','month_end')),
  status text NOT NULL DEFAULT 'locked' CHECK (status IN ('locked','unlocked')),
  total_collected numeric(12,2) NOT NULL DEFAULT 0,
  total_disbursed numeric(12,2) NOT NULL DEFAULT 0,
  variance numeric(12,2) NOT NULL DEFAULT 0,
  locked_by uuid,
  locked_by_email text,
  locked_at timestamptz,
  unlocked_by uuid,
  unlocked_at timestamptz,
  unlock_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ledger_locks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_ledger_locks" ON ledger_locks;
CREATE POLICY "select_ledger_locks" ON ledger_locks FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = ledger_locks.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "insert_ledger_locks" ON ledger_locks;
CREATE POLICY "insert_ledger_locks" ON ledger_locks FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = ledger_locks.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "update_ledger_locks" ON ledger_locks;
CREATE POLICY "update_ledger_locks" ON ledger_locks FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = ledger_locks.organization_id AND organization_users.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = ledger_locks.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "delete_ledger_locks" ON ledger_locks;
CREATE POLICY "delete_ledger_locks" ON ledger_locks FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = ledger_locks.organization_id AND organization_users.user_id = auth.uid())
  );

-- ============================================================
-- disbursement_runs
-- ============================================================
CREATE TABLE IF NOT EXISTS disbursement_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id uuid,
  run_date date NOT NULL DEFAULT CURRENT_DATE,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','generated','submitted','settled','failed')),
  output_format text NOT NULL DEFAULT 'bacs' CHECK (output_format IN ('bacs','sepa','faster_payments','manual_instruction')),
  file_reference text,
  total_amount numeric(12,2) NOT NULL DEFAULT 0,
  total_items int NOT NULL DEFAULT 0,
  approved_by uuid,
  approved_at timestamptz,
  generated_at timestamptz,
  submitted_at timestamptz,
  settled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE disbursement_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_disb_runs" ON disbursement_runs;
CREATE POLICY "select_disb_runs" ON disbursement_runs FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = disbursement_runs.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "insert_disb_runs" ON disbursement_runs;
CREATE POLICY "insert_disb_runs" ON disbursement_runs FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = disbursement_runs.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "update_disb_runs" ON disbursement_runs;
CREATE POLICY "update_disb_runs" ON disbursement_runs FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = disbursement_runs.organization_id AND organization_users.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = disbursement_runs.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "delete_disb_runs" ON disbursement_runs;
CREATE POLICY "delete_disb_runs" ON disbursement_runs FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = disbursement_runs.organization_id AND organization_users.user_id = auth.uid())
  );

-- ============================================================
-- disbursement_run_items
-- ============================================================
CREATE TABLE IF NOT EXISTS disbursement_run_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  disbursement_run_id uuid NOT NULL REFERENCES disbursement_runs(id) ON DELETE CASCADE,
  waterfall_entry_id uuid,
  payee_name text NOT NULL,
  payee_reference text,
  payee_account_number text,
  payee_sort_code text,
  category text NOT NULL,
  amount numeric(12,2) NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','included','submitted','settled','failed')),
  bacs_reference text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE disbursement_run_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_disb_run_items" ON disbursement_run_items;
CREATE POLICY "select_disb_run_items" ON disbursement_run_items FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM disbursement_runs dr
     JOIN organization_users ou ON ou.organization_id = dr.organization_id
     WHERE dr.id = disbursement_run_items.disbursement_run_id AND ou.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "insert_disb_run_items" ON disbursement_run_items;
CREATE POLICY "insert_disb_run_items" ON disbursement_run_items FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM disbursement_runs dr
     JOIN organization_users ou ON ou.organization_id = dr.organization_id
     WHERE dr.id = disbursement_run_items.disbursement_run_id AND ou.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "update_disb_run_items" ON disbursement_run_items;
CREATE POLICY "update_disb_run_items" ON disbursement_run_items FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM disbursement_runs dr
     JOIN organization_users ou ON ou.organization_id = dr.organization_id
     WHERE dr.id = disbursement_run_items.disbursement_run_id AND ou.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM disbursement_runs dr
     JOIN organization_users ou ON ou.organization_id = dr.organization_id
     WHERE dr.id = disbursement_run_items.disbursement_run_id AND ou.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "delete_disb_run_items" ON disbursement_run_items;
CREATE POLICY "delete_disb_run_items" ON disbursement_run_items FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM disbursement_runs dr
     JOIN organization_users ou ON ou.organization_id = dr.organization_id
     WHERE dr.id = disbursement_run_items.disbursement_run_id AND ou.user_id = auth.uid())
  );

-- ============================================================
-- payment_link_invitations
-- ============================================================
CREATE TABLE IF NOT EXISTS payment_link_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id uuid,
  schedule_id uuid,
  failed_transaction_id uuid,
  debtor_name text,
  debtor_contact text,
  contact_channel text NOT NULL DEFAULT 'sms' CHECK (contact_channel IN ('sms','email')),
  amount_requested numeric(12,2) NOT NULL,
  link_token text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','opened','paid','expired','failed')),
  sent_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE payment_link_invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_payment_links" ON payment_link_invitations;
CREATE POLICY "select_payment_links" ON payment_link_invitations FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = payment_link_invitations.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "insert_payment_links" ON payment_link_invitations;
CREATE POLICY "insert_payment_links" ON payment_link_invitations FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = payment_link_invitations.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "update_payment_links" ON payment_link_invitations;
CREATE POLICY "update_payment_links" ON payment_link_invitations FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = payment_link_invitations.organization_id AND organization_users.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = payment_link_invitations.organization_id AND organization_users.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "delete_payment_links" ON payment_link_invitations;
CREATE POLICY "delete_payment_links" ON payment_link_invitations FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM organization_users WHERE organization_users.organization_id = payment_link_invitations.organization_id AND organization_users.user_id = auth.uid())
  );

-- ============================================================
-- Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_bank_txns_org_date ON bank_transactions(organization_id, transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_bank_txns_match_status ON bank_transactions(match_status);
CREATE INDEX IF NOT EXISTS idx_batch_runs_org_date ON batch_payment_runs(organization_id, batch_date DESC);
CREATE INDEX IF NOT EXISTS idx_batch_items_run ON batch_payment_items(batch_run_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_org_date ON cashier_audit_logs(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_case ON cashier_audit_logs(case_id);
CREATE INDEX IF NOT EXISTS idx_ledger_locks_org_date ON ledger_locks(organization_id, lock_date DESC);
CREATE INDEX IF NOT EXISTS idx_disb_runs_org_date ON disbursement_runs(organization_id, run_date DESC);
CREATE INDEX IF NOT EXISTS idx_disb_run_items_run ON disbursement_run_items(disbursement_run_id);
CREATE INDEX IF NOT EXISTS idx_payment_links_org ON payment_link_invitations(organization_id);
CREATE INDEX IF NOT EXISTS idx_payment_links_status ON payment_link_invitations(status);
