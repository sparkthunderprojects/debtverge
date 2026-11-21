/*
# Insolv Engine — IVA / Insolvency Schema

## Purpose
Extends the DebtVerge case model with enterprise Insolvency Practitioner (IP) workflow
support and a two-way Creditor Portal. Adds five new tables for IP details, document
verification, IVA proposals, creditor proxy votes, and Proof of Debt submissions.

## 1. New Tables

### debt_ip_details
Stores the assigned Insolvency Practitioner (Nominee/Supervisor) for a case.
- id (uuid PK)
- case_id (uuid FK → debt_cases)
- practitioner_name (text) — IP's full name
- registration_number (text) — FCA/IP registration number
- firm_name (text) — firm/legal entity name
- firm_address (text)
- firm_phone (text)
- firm_email (text)
- role_type (text) — 'nominee' | 'supervisor' | 'joint'
- nominee_fee_percent (numeric) — Nominee fee as % of realisations
- supervisor_fee_percent (numeric) — Supervisor fee as % of realisations
- fixed_fee_amount (numeric) — any fixed fee element
- fee_notes (text)
- appointed_at (timestamptz)
- created_at / updated_at

### debt_document_checklist
Verification documents uploaded against a case (Payslips, Bank statements, ID/KYC, Tax records).
- id (uuid PK)
- case_id (uuid FK → debt_cases)
- document_type (text) — 'payslip' | 'bank_statement' | 'id_kyc' | 'tax_record' | 'utility_bill' | 'creditor_statement' | 'other'
- file_name (text)
- file_url (text) — Supabase Storage path
- file_size_bytes (bigint)
- uploaded_by_role (text) — 'advisor' | 'debtor' | 'ip' | 'creditor'
- status (text) — 'pending' | 'approved' | 'rejected' (default 'pending')
- reviewed_by (text) — name of reviewer
- reviewed_at (timestamptz)
- rejection_reason (text)
- notes (text)
- created_at / updated_at

### debt_iva_proposals
IVA Protocol compliance parameters for a case.
- id (uuid PK)
- case_id (uuid FK → debt_cases)
- proposed_duration_months (int) — e.g. 60 or 72
- total_estimated_dividend (numeric) — total dividend to creditors
- estimated_dividend_percent (numeric) — pence-in-the-pound
- equity_treatment_terms (text) — how property equity is handled
- equity_release_month (int) — month equity review/release due
- protocol_compliant (boolean) — whether proposal meets IVA Protocol
- proposal_status (text) — 'draft' | 'circulated' | 'approved' | 'rejected' | 'varied'
- creditor_meeting_date (timestamptz)
- dividend_calculation_notes (text)
- created_at / updated_at

### debt_creditor_votes
Proxy submissions from creditors for IVA proposals.
- id (uuid PK)
- case_id (uuid FK → debt_cases)
- proposal_id (uuid FK → debt_iva_proposals)
- creditor_id (uuid FK → debt_creditors)
- claimed_debt_amount (numeric) — amount creditor claims is owed
- vote (text) — 'accept' | 'reject' | 'modify'
- modification_notes (text)
- proxy_form_url (text) — Supabase Storage path to proxy form
- submitted_by (text) — creditor name or portal reference
- submitted_at (timestamptz)
- created_at / updated_at

### debt_proof_of_debt
Proof of Debt (PoD) submissions from external creditors via Creditor Portal.
- id (uuid PK)
- case_id (uuid FK → debt_cases)
- creditor_id (uuid FK → debt_creditors)
- creditor_name (text)
- creditor_reference (text) — creditor's own account/reference number
- claimed_amount (numeric)
- admitted_amount (numeric) — amount IP admits (may differ)
- pod_form_url (text) — Supabase Storage path
- supporting_documents_url (text[])
- status (text) — 'submitted' | 'under_review' | 'admitted' | 'rejected' | 'partially_admitted'
- reviewed_by (text)
- reviewed_at (timestamptz)
- rejection_reason (text)
- notes (text)
- created_at / updated_at

## 2. Security
- RLS enabled on all five new tables.
- Policies use TO anon, authenticated with true predicates (single-tenant shared model
  consistent with the existing debt_* tables — the Stormreef workspace is a shared
  operational database where all authenticated staff/advisors access the same case pool).
- This matches the RLS pattern already established across the debt_* table family.

## 3. Indexes
- All tables indexed on case_id for fast case-scoped queries.
- debt_creditor_votes indexed on proposal_id.
- debt_document_checklist indexed on status for pending-review queries.
- debt_proof_of_debt indexed on status.

## 4. Important Notes
1. No existing tables are altered — this is purely additive.
2. All existing DMP and SFS tools remain fully intact.
3. Foreign keys cascade on case deletion to keep referential integrity.
4. Amounts stored as numeric(12,2) for monetary precision.
*/

-- ============================================================
-- Table: debt_ip_details
-- ============================================================
CREATE TABLE IF NOT EXISTS debt_ip_details (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES debt_cases(id) ON DELETE CASCADE,
  practitioner_name text NOT NULL,
  registration_number text,
  firm_name text,
  firm_address text,
  firm_phone text,
  firm_email text,
  role_type text NOT NULL DEFAULT 'nominee' CHECK (role_type IN ('nominee', 'supervisor', 'joint')),
  nominee_fee_percent numeric(5,2) DEFAULT 0,
  supervisor_fee_percent numeric(5,2) DEFAULT 0,
  fixed_fee_amount numeric(12,2) DEFAULT 0,
  fee_notes text,
  appointed_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_debt_ip_details_case_id ON debt_ip_details(case_id);

ALTER TABLE debt_ip_details ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_ip_details" ON debt_ip_details;
CREATE POLICY "anon_select_ip_details" ON debt_ip_details FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_ip_details" ON debt_ip_details;
CREATE POLICY "anon_insert_ip_details" ON debt_ip_details FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_ip_details" ON debt_ip_details;
CREATE POLICY "anon_update_ip_details" ON debt_ip_details FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_ip_details" ON debt_ip_details;
CREATE POLICY "anon_delete_ip_details" ON debt_ip_details FOR DELETE
  TO anon, authenticated USING (true);

-- ============================================================
-- Table: debt_document_checklist
-- ============================================================
CREATE TABLE IF NOT EXISTS debt_document_checklist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES debt_cases(id) ON DELETE CASCADE,
  document_type text NOT NULL CHECK (document_type IN ('payslip','bank_statement','id_kyc','tax_record','utility_bill','creditor_statement','other')),
  file_name text NOT NULL,
  file_url text,
  file_size_bytes bigint DEFAULT 0,
  uploaded_by_role text NOT NULL DEFAULT 'advisor' CHECK (uploaded_by_role IN ('advisor','debtor','ip','creditor')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewed_by text,
  reviewed_at timestamptz,
  rejection_reason text,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_debt_doc_checklist_case_id ON debt_document_checklist(case_id);
CREATE INDEX IF NOT EXISTS idx_debt_doc_checklist_status ON debt_document_checklist(status);

ALTER TABLE debt_document_checklist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_doc_checklist" ON debt_document_checklist;
CREATE POLICY "anon_select_doc_checklist" ON debt_document_checklist FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_doc_checklist" ON debt_document_checklist;
CREATE POLICY "anon_insert_doc_checklist" ON debt_document_checklist FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_doc_checklist" ON debt_document_checklist;
CREATE POLICY "anon_update_doc_checklist" ON debt_document_checklist FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_doc_checklist" ON debt_document_checklist;
CREATE POLICY "anon_delete_doc_checklist" ON debt_document_checklist FOR DELETE
  TO anon, authenticated USING (true);

-- ============================================================
-- Table: debt_iva_proposals
-- ============================================================
CREATE TABLE IF NOT EXISTS debt_iva_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES debt_cases(id) ON DELETE CASCADE,
  proposed_duration_months int NOT NULL DEFAULT 60,
  total_estimated_dividend numeric(12,2) DEFAULT 0,
  estimated_dividend_percent numeric(5,2) DEFAULT 0,
  equity_treatment_terms text,
  equity_release_month int,
  protocol_compliant boolean DEFAULT false,
  proposal_status text NOT NULL DEFAULT 'draft' CHECK (proposal_status IN ('draft','circulated','approved','rejected','varied')),
  creditor_meeting_date timestamptz,
  dividend_calculation_notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_debt_iva_proposals_case_id ON debt_iva_proposals(case_id);

ALTER TABLE debt_iva_proposals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_iva_proposals" ON debt_iva_proposals;
CREATE POLICY "anon_select_iva_proposals" ON debt_iva_proposals FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_iva_proposals" ON debt_iva_proposals;
CREATE POLICY "anon_insert_iva_proposals" ON debt_iva_proposals FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_iva_proposals" ON debt_iva_proposals;
CREATE POLICY "anon_update_iva_proposals" ON debt_iva_proposals FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_iva_proposals" ON debt_iva_proposals;
CREATE POLICY "anon_delete_iva_proposals" ON debt_iva_proposals FOR DELETE
  TO anon, authenticated USING (true);

-- ============================================================
-- Table: debt_creditor_votes
-- ============================================================
CREATE TABLE IF NOT EXISTS debt_creditor_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES debt_cases(id) ON DELETE CASCADE,
  proposal_id uuid REFERENCES debt_iva_proposals(id) ON DELETE CASCADE,
  creditor_id uuid NOT NULL REFERENCES debt_creditors(id) ON DELETE CASCADE,
  claimed_debt_amount numeric(12,2) DEFAULT 0,
  vote text NOT NULL DEFAULT 'accept' CHECK (vote IN ('accept','reject','modify')),
  modification_notes text,
  proxy_form_url text,
  submitted_by text,
  submitted_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_debt_creditor_votes_case_id ON debt_creditor_votes(case_id);
CREATE INDEX IF NOT EXISTS idx_debt_creditor_votes_proposal_id ON debt_creditor_votes(proposal_id);

ALTER TABLE debt_creditor_votes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_creditor_votes" ON debt_creditor_votes;
CREATE POLICY "anon_select_creditor_votes" ON debt_creditor_votes FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_creditor_votes" ON debt_creditor_votes;
CREATE POLICY "anon_insert_creditor_votes" ON debt_creditor_votes FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_creditor_votes" ON debt_creditor_votes;
CREATE POLICY "anon_update_creditor_votes" ON debt_creditor_votes FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_creditor_votes" ON debt_creditor_votes;
CREATE POLICY "anon_delete_creditor_votes" ON debt_creditor_votes FOR DELETE
  TO anon, authenticated USING (true);

-- ============================================================
-- Table: debt_proof_of_debt
-- ============================================================
CREATE TABLE IF NOT EXISTS debt_proof_of_debt (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES debt_cases(id) ON DELETE CASCADE,
  creditor_id uuid REFERENCES debt_creditors(id) ON DELETE SET NULL,
  creditor_name text NOT NULL,
  creditor_reference text,
  claimed_amount numeric(12,2) DEFAULT 0,
  admitted_amount numeric(12,2) DEFAULT 0,
  pod_form_url text,
  supporting_documents_url text[] DEFAULT '{}',
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','under_review','admitted','rejected','partially_admitted')),
  reviewed_by text,
  reviewed_at timestamptz,
  rejection_reason text,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_debt_proof_of_debt_case_id ON debt_proof_of_debt(case_id);
CREATE INDEX IF NOT EXISTS idx_debt_proof_of_debt_status ON debt_proof_of_debt(status);

ALTER TABLE debt_proof_of_debt ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_proof_of_debt" ON debt_proof_of_debt;
CREATE POLICY "anon_select_proof_of_debt" ON debt_proof_of_debt FOR SELECT
  TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_proof_of_debt" ON debt_proof_of_debt;
CREATE POLICY "anon_insert_proof_of_debt" ON debt_proof_of_debt FOR INSERT
  TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_proof_of_debt" ON debt_proof_of_debt;
CREATE POLICY "anon_update_proof_of_debt" ON debt_proof_of_debt FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_proof_of_debt" ON debt_proof_of_debt;
CREATE POLICY "anon_delete_proof_of_debt" ON debt_proof_of_debt FOR DELETE
  TO anon, authenticated USING (true);