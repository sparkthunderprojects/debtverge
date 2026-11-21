# DebtVerge Standalone — Architecture Document

> **Source of truth:** `DEBTVERGE_STANDALONE_SPECIFICATION.md` (the complete recreation specification).
> **Purpose:** Define the architecture for a clean, standalone, production DebtVerge.
> **Date:** 2026-08-09
> **Status:** Architecture only. No code to be built, modified, or migrated during this stage.

---

## TABLE OF CONTENTS

1. [Section 1 — Core Ownership Classification](#section-1--core-ownership-classification)
2. [Section 2 — DebtVerge Database](#section-2--debtverge-database)
3. [Section 3 — API Boundaries](#section-3--api-boundaries)
4. [Section 4 — LeadVerge → Qualify → DebtVerge](#section-4--leadverge--qualify--debtverge)
5. [Section 5 — DebtVerge → IVA Verge](#section-5--debtverge--iva-verge)
6. [Section 6 — Compliance Architecture](#section-6--compliance-architecture)
7. [Section 7 — Tenant Isolation](#section-7--tenant-isolation)
8. [Section 8 — Security Boundaries](#section-8--security-boundaries)
9. [Section 9 — Application Structure](#section-9--application-structure)
10. [Section 10 — Data Flow Diagrams](#section-10--data-flow-diagrams)
11. [Section 11 — Standalone Principle](#section-11--standalone-principle)
12. [Section 12 — Remove Prototype Coupling](#section-12--remove-prototype-coupling)
13. [Section 13 — Build Order](#section-13--build-order)
14. [DEBTVERGE STANDALONE ARCHITECTURAL CONTRACT](#debtverge-standalone-architectural-contract)

---

## Section 1 — Core Ownership Classification

Every major feature and database entity is classified as one of:

- **A. DEBTVERGE OWNED** — lives inside the standalone DebtVerge database/codebase.
- **B. STORMREEF SHARED SERVICE** — platform infrastructure shared across all Storm apps. DebtVerge depends on it but does not own it.
- **C. SEPARATE STORM APPLICATION** — a distinct product with its own database and deployment. DebtVerge communicates with it via API only.
- **D. EXTERNAL SERVICE** — a third-party provider outside the Storm ecosystem entirely.

### 1.1 Feature Classification

| Feature | Classification | Reasoning |
|---------|---------------|-----------|
| Case management | A | DebtVerge is the authoritative source for debt-management case data. No other system creates or owns debt cases. |
| Customer profile | A | The customer's personal/financial profile is created and maintained inside DebtVerge. If a lead arrives from LeadVerge/Qualify, DebtVerge creates its own customer record from the handover payload — it does not read the upstream system's tables. |
| SFS (Standard Financial Statement) | A | SFS construction is a core DebtVerge function. The SFS entries, disposable income calculation, and allowance thresholds are all DebtVerge-owned. |
| Creditor ledger | A | Creditor data is DebtVerge-specific. No other Storm app manages creditor balances or pro-rata calculations. |
| Pro-rata distribution engine | A | Pure financial calculation logic. DebtVerge owns it. |
| Payment logging | A | Incoming debtor payments and automatic splits are DebtVerge-owned. |
| Payment scheduling | A | Frequency, preferred day, installment amount, and transaction ledger are DebtVerge-owned. |
| Payment gateway integration | A (wrapper) / D (provider) | DebtVerge owns the gateway configuration, tokenised payment methods, recurring schedules, and transaction logs. The actual payment processing is delegated to external providers (Stripe, GoCardless) via adapters. |
| Cashier operations | A | Bank feeds, batch processing, disbursement runs, ledger locks — all DebtVerge-owned operational data. |
| Disbursement waterfall | A | The waterfall accounting ledger is DebtVerge-owned. |
| BACS file generation | A | DebtVerge owns the file generation logic. File submission to a BACS service is external (D). |
| Vulnerability assessment | A | The 16-item checklist, scoring, and FCA vulnerability flags are DebtVerge-owned. |
| Benefits checking | A | Benefits entitlement estimates are DebtVerge-owned. |
| Bank transaction auto-categorization | A | The 40+ UK merchant pattern matching and SFS import logic are DebtVerge-owned. |
| Annual reviews | A | 12-month SFS review snapshots are DebtVerge-owned. |
| Breathing Space / MH Crisis | A | Statutory moratorium records are DebtVerge-owned. |
| IVA insolvency (IP, proposals, voting, PoD) | A | All IVA-specific data is DebtVerge-owned. When a case is handed over to IVA Verge, the data is copied via API — DebtVerge retains its own snapshot. |
| Compliance scripting & attestation | A | FCA compliance scripts, disclaimers, and immutable attestation records are DebtVerge-owned. |
| Pathfinder engine | A | Automated solution routing is pure calculation logic owned by DebtVerge. |
| Solution suitability matrix | A | Suitability scoring is DebtVerge-owned. |
| Offer letter generation | A | DMP offer letter text generation is DebtVerge-owned. |
| IVA proposal pack generation | A | Document generation logic is DebtVerge-owned. |
| Omnichannel communications | A | Message threads, FCA templates, and communication logs are DebtVerge-owned. External providers (Twilio, SMTP) deliver messages (D). |
| Debtor self-service portal | A | The portal is a DebtVerge feature. |
| Tenant signup & provisioning | A | DebtVerge owns its own tenant onboarding. |
| Authentication | B | Supabase Auth is a shared platform service. DebtVerge uses it but does not own the auth.users table. |
| RBAC (roles, permissions) | A (DebtVerge-specific roles) / B (platform RBAC schema) | DebtVerge owns its role definitions (Advisor, Cashier, Compliance Officer). The RBAC table schema (`rbac_roles`, `rbac_permissions`, `rbac_role_permissions`) is shared platform infrastructure that DebtVerge creates its own rows in. |
| Organization management | B | The `organizations` and `organization_users` tables are shared platform infrastructure. DebtVerge creates its own orgs and memberships but does not own the table definitions. |
| Licensing / entitlements | B | The `packages`, `catalog_items`, `organization_licenses` tables are shared platform infrastructure. DebtVerge's modules appear as catalog items. |
| Background job queue | A | DebtVerge owns its own job queue (`background_jobs` table) and job types. The queue-worker edge function is DebtVerge-owned. |
| Audit logging | A | All audit tables (`dv_audit_log`, `dv_cashier_audit_logs`, `dv_compliance_attestations`) are DebtVerge-owned and INSERT-only. |
| Document storage | A (metadata) / B (storage service) | DebtVerge owns the document checklist table and metadata. Supabase Storage is the shared storage service (B). |
| LeadVerge | C | Separate Storm application. DebtVerge receives leads via handover API. |
| Qualify | C | Separate Storm application. DebtVerge receives qualified clients via handover API. |
| IVA Verge | C | Separate Storm application. DebtVerge sends cases via handover API. |
| Draft Verge | C | Separate Storm application. DebtVerge sends cases via handover API. |
| StormCall | C | Separate Storm application. DebtVerge receives call compliance data via API. |
| StormSign | C | Separate Storm application. DebtVerge sends documents for e-signing via API and receives signing status back. |
| StormDrive | C | Separate Storm application. If used, DebtVerge references documents by URL — does not store file content. |
| Storm ID | C | Separate Storm application (identity/SSO). If used, provides cross-app user identity. |
| Knowledge Assistant | C | Separate Storm application. If used, provides AI guidance via API. |
| Stripe | D | External payment provider. |
| GoCardless | D | External Direct Debit / BACS provider. |
| Twilio | D | External SMS provider. |
| SMTP provider (SendGrid / AWS SES) | D | External email delivery provider. |
| Open Banking provider (TrueLayer / Plaid) | D | External bank data provider. |
| Credit reference agencies | D | External credit search providers (future). |
| BACS submission service | D | External BACS file submission service. |

### 1.2 Database Entity Classification

| Entity (existing name) | Standalone name | Classification | Reasoning |
|------------------------|----------------|---------------|-----------|
| `debt_cases` | `dv_cases` | A | Master case record. DebtVerge owns it. |
| `debt_creditors` | `dv_creditors` | A | Creditor ledger. DebtVerge owns it. |
| `debt_sfs_entries` | `dv_sfs_entries` | A | SFS line items. DebtVerge owns it. |
| `debt_distributions` | `dv_distributions` | A | Scheduled creditor payments. DebtVerge owns it. |
| `debt_audit_log` | `dv_audit_log` | A | Case audit timeline. DebtVerge owns it. INSERT-only. |
| `debt_payments` | `dv_payments` | A | Incoming debtor payments. DebtVerge owns it. |
| `debt_negotiations` | `dv_negotiations` | A | Per-creditor negotiation events. DebtVerge owns it. |
| `debt_customer_profiles` | `dv_customer_profiles` | A | Customer details. DebtVerge owns it. |
| `debt_previous_addresses` | `dv_previous_addresses` | A | Address history. DebtVerge owns it. |
| `debt_vulnerability_assessments` | `dv_vulnerability_assessments` | A | Vulnerability checklist. DebtVerge owns it. |
| `debt_benefits_checks` | `dv_benefits_checks` | A | Benefits entitlement checks. DebtVerge owns it. |
| `debt_bank_transactions` | `dv_bank_transactions` | A | Auto-categorized bank transactions (SFS). DebtVerge owns it. |
| `debt_annual_reviews` | `dv_annual_reviews` | A | Annual SFS review snapshots. DebtVerge owns it. |
| `debtverge_tenants` | `dv_tenants` | A | DM firm tenant sign-up. DebtVerge owns it. |
| `debt_ip_details` | `dv_ip_details` | A | Insolvency practitioner details. DebtVerge owns it. |
| `debt_document_checklist` | `dv_document_checklist` | A | Verification documents. DebtVerge owns it. |
| `debt_iva_proposals` | `dv_iva_proposals` | A | IVA protocol parameters. DebtVerge owns it. |
| `debt_creditor_votes` | `dv_creditor_votes` | A | Proxy votes on IVA proposals. DebtVerge owns it. |
| `debt_proof_of_debt` | `dv_proof_of_debt` | A | Creditor PoD submissions. DebtVerge owns it. |
| `debt_signposting_assessments` | `dv_signposting_assessments` | A | Lead intake routing assessments. DebtVerge owns it. |
| `debt_iva_contributions` | `dv_iva_contributions` | A | Monthly IVA contributions. DebtVerge owns it. |
| `debt_iva_distribution_runs` | `dv_iva_distribution_runs` | A | IVA distribution calculator runs. DebtVerge owns it. |
| `debt_iva_distribution_items` | `dv_iva_distribution_items` | A | Creditor line items in distribution runs. DebtVerge owns it. |
| `debtverge_communications` | `dv_communications` | A | Omnichannel message log. DebtVerge owns it. |
| `debtverge_unassigned_messages` | `dv_unassigned_messages` | A | Unmatched inbound buffer. DebtVerge owns it. |
| `debtverge_compliance_attestations` | `dv_compliance_attestations` | A | FCA disclaimer confirmations. DebtVerge owns it. INSERT-only. |
| `debtverge_vulnerability_flags` | `dv_vulnerability_flags` | A | FCA category vulnerability markers. DebtVerge owns it. |
| `debt_payment_transactions` | `dv_payment_transactions` | A | Per-installment ledger. DebtVerge owns it. |
| `debt_breathing_spaces` | `dv_breathing_spaces` | A | Statutory moratorium records. DebtVerge owns it. |
| `payment_gateway_configs` | `dv_gateway_configs` | A | White-label gateway config. DebtVerge owns it. |
| `payment_methods` | `dv_payment_methods` | A | Tokenised payment methods. DebtVerge owns it. |
| `recurring_payment_schedules` | `dv_recurring_schedules` | A | Recurring payment scheduling. DebtVerge owns it. |
| `gateway_payment_transactions` | `dv_gateway_transactions` | A | Gateway transaction log. DebtVerge owns it. |
| `disbursement_waterfall_entries` | `dv_waterfall_entries` | A | Waterfall accounting ledger. DebtVerge owns it. |
| `payment_reconciliation_log` | `dv_reconciliation_log` | A | Reconciliation tracking. DebtVerge owns it. |
| `bank_feeds` | `dv_bank_feeds` | A | Bank feed connections. DebtVerge owns it. |
| `bank_transactions` (cashier) | `dv_cashier_transactions` | A | Cashier bank transactions. DebtVerge owns it. |
| `batch_payment_runs` | `dv_batch_runs` | A | Batch processing queues. DebtVerge owns it. |
| `batch_payment_items` | `dv_batch_items` | A | Items within batch runs. DebtVerge owns it. |
| `cashier_audit_logs` | `dv_cashier_audit_logs` | A | Immutable audit trail. DebtVerge owns it. INSERT-only. |
| `ledger_locks` | `dv_ledger_locks` | A | End-of-day balancing. DebtVerge owns it. |
| `disbursement_runs` | `dv_disbursement_runs` | A | Creditor disbursement batches. DebtVerge owns it. |
| `disbursement_run_items` | `dv_disbursement_items` | A | Items in disbursement runs. DebtVerge owns it. |
| `payment_link_invitations` | `dv_payment_links` | A | SMS/email payment links. DebtVerge owns it. |
| `organizations` | (shared) | B | Shared platform table. DebtVerge creates rows but does not own the table. |
| `organization_users` | (shared) | B | Shared platform table. |
| `profiles` | (shared) | B | Shared platform table. |
| `rbac_roles` | (shared) | B | Shared platform table. DebtVerge creates its own roles. |
| `rbac_permissions` | (shared) | B | Shared platform table. |
| `rbac_role_permissions` | (shared) | B | Shared platform table. |
| `packages` | (shared) | B | Shared platform table. |
| `catalog_items` | (shared) | B | Shared platform table. |
| `organization_licenses` | (shared) | B | Shared platform table. |
| `background_jobs` | `dv_background_jobs` | A | DebtVerge owns its own job queue. |
| `storm_call_compliance_audit` | (not copied) | C | Owned by StormCall. Accessed via API only. |
| `sv_mailboxes` / `sv_threads` / `sv_messages` | (not copied) | C | Owned by StormVerge Mail. Not part of DebtVerge. |

### 1.3 New Entities Required for Standalone

| New Entity | Classification | Reasoning |
|-----------|---------------|-----------|
| `dv_handover_records` | A | Records of inbound/outbound case handovers. DebtVerge owns it. |
| `dv_consent_records` | A | GDPR consent tracking. DebtVerge owns it. |
| `dv_aml_assessments` | A | AML risk assessments. DebtVerge owns it. |
| `dv_dpa_register` | A | Data Protection Act register. DebtVerge owns it. |
| `dv_field_change_audit` | A | Field-level change tracking for critical fields. INSERT-only. |
| `dv_external_api_calls` | A | Audit log of all external API interactions. INSERT-only. |
| `dv_document_versions` | A | Document version history. DebtVerge owns it. |

---

## Section 2 — DebtVerge Database

### 2.1 Tables DebtVerge Must Own

DebtVerge owns **44 existing tables** (renamed with `dv_` prefix) plus **7 new tables** = **51 total**.

The complete owned table inventory, grouped by domain:

**Core Case (5):** `dv_cases`, `dv_creditors`, `dv_sfs_entries`, `dv_distributions`, `dv_audit_log`

**Payments & Negotiation (2):** `dv_payments`, `dv_negotiations`

**Customer Profile (2):** `dv_customer_profiles`, `dv_previous_addresses`

**Vulnerability & Benefits (2):** `dv_vulnerability_assessments`, `dv_benefits_checks`

**Open Banking & Reviews (2):** `dv_bank_transactions`, `dv_annual_reviews`

**Tenant Provisioning (1):** `dv_tenants`

**IVA / Insolvency (5):** `dv_ip_details`, `dv_document_checklist`, `dv_iva_proposals`, `dv_creditor_votes`, `dv_proof_of_debt`

**In-flight & Signposting (4):** `dv_signposting_assessments`, `dv_iva_contributions`, `dv_iva_distribution_runs`, `dv_iva_distribution_items`

**Communications (2):** `dv_communications`, `dv_unassigned_messages`

**Compliance (2):** `dv_compliance_attestations`, `dv_vulnerability_flags`

**Payment Schedule (1):** `dv_payment_transactions`

**Breathing Space (1):** `dv_breathing_spaces`

**Payment Gateway (6):** `dv_gateway_configs`, `dv_payment_methods`, `dv_recurring_schedules`, `dv_gateway_transactions`, `dv_waterfall_entries`, `dv_reconciliation_log`

**Cashier Operations (9):** `dv_bank_feeds`, `dv_cashier_transactions`, `dv_batch_runs`, `dv_batch_items`, `dv_cashier_audit_logs`, `dv_ledger_locks`, `dv_disbursement_runs`, `dv_disbursement_items`, `dv_payment_links`

**Background Jobs (1):** `dv_background_jobs`

**New — Handover (1):** `dv_handover_records`

**New — Compliance (3):** `dv_consent_records`, `dv_aml_assessments`, `dv_dpa_register`

**New — Audit (2):** `dv_field_change_audit`, `dv_external_api_calls`

**New — Documents (1):** `dv_document_versions`

### 2.2 Tables That Must NOT Be Copied

| Table | Reason |
|-------|--------|
| `storm_call_compliance_audit` | Owned by StormCall (C). Access via API only. |
| `sv_mailboxes`, `sv_threads`, `sv_messages`, `sv_attachments` | Owned by StormVerge Mail (C). DebtVerge has its own `dv_communications` table. |
| `projects`, `tasks`, `task_comments`, `time_logs`, `task_attachments` | Owned by StormTalent/workspace system (C). Not relevant to DebtVerge. |
| `job_applications`, `freelancer_profiles`, `job_postings`, `contracts`, `milestone_payments` | Owned by StormTalent (C). |
| `drive_files`, `drive_folders`, `shared_drives`, `file_versions` (IndexedDB) | Owned by StormDrive (C). DebtVerge uses Supabase Storage. |
| `social_*` tables | Owned by StormSocial (C). |
| `mail_*` (marketing) tables | Owned by StormMail (C). |
| `pulse_*` tables | Owned by StormPulse (C). |
| `helpdesk_*` tables | Owned by StormDesk (C). |

### 2.3 Tables Replaced by API References

| Existing coupling | Replacement |
|-------------------|-------------|
| Direct DB reads from `profiles` table | API call to Storm ID (if available) or local `dv_profiles` cache table seeded from Supabase Auth |
| Direct DB reads from `organizations` / `organization_users` | DebtVerge creates its own `dv_organizations` and `dv_organization_users` tables. If Storm ID is available, org data is synced via API. If not, DebtVerge manages orgs locally. |
| Cross-app transfer via shared frontend components | `dv_handover_records` table with API handover edge functions |
| StormCall compliance audit table reads | API call to StormCall compliance endpoint |

### 2.4 Tables That Should Be Redesigned

| Table | Issue | Redesign |
|-------|-------|----------|
| `dv_unassigned_messages` | Missing `organization_id` — unassigned messages invisible to agents (existing bug) | Add `organization_id NOT NULL` column. RLS checks org membership directly. |
| `dv_signposting_assessments` | Missing `organization_id` — assessments with null `case_id` are invisible | Add `organization_id Not NULL` column. |
| `dv_breathing_spaces` | Dead `user_id` column (ignored by RLS) | Remove `user_id` column. Use `organization_id` + `case_id` for RLS. |
| `dv_cases` | `organization_id` is nullable — cases without org membership are invisible | Make `organization_id NOT NULL`. Set at case creation from the creating user's org. |
| `dv_cashier_transactions` vs `dv_bank_transactions` | Two separate bank transaction tables with overlapping purposes | Keep both but clarify: `dv_bank_transactions` = SFS auto-categorization (case-scoped). `dv_cashier_transactions` = cashier reconciliation (org-scoped). Different purposes, different RLS patterns. |
| `dv_iva_distribution_runs` vs `dv_disbursement_runs` | Two distribution concepts | Keep both: `dv_iva_distribution_runs` = IVA-specific fee-deducted distributions. `dv_disbursement_runs` = cashier BACS output. Different lifecycles. |
| All payment gateway tables | No `is_super_admin()` bypass (inconsistent with debt tables) | Add `is_super_admin()` bypass to all gateway/cashier table RLS policies for consistency. |
| All child tables (26 `dv_*` tables with `case_id`) | No direct `organization_id` — RLS requires EXISTS subquery through `dv_cases` | **Decision:** Keep parent-linked RLS for child tables (avoids data duplication and sync issues). BUT add `organization_id` to tables that can exist without a case (`dv_unassigned_messages`, `dv_signposting_assessments`). |

### 2.5 Audit/Event Tables (Must Remain Inside DebtVerge)

| Table | Type | Immutability |
|-------|------|-------------|
| `dv_audit_log` | Case milestone audit | INSERT-only. No UPDATE or DELETE RLS policies. |
| `dv_cashier_audit_logs` | Cashier operations audit | INSERT-only. No UPDATE or DELETE RLS policies. |
| `dv_compliance_attestations` | FCA disclaimer attestation | INSERT-only. No UPDATE or DELETE RLS policies. |
| `dv_field_change_audit` (NEW) | Field-level change tracking | INSERT-only. No UPDATE or DELETE RLS policies. |
| `dv_external_api_calls` (NEW) | External API interaction log | INSERT-only. No UPDATE or DELETE RLS policies. |
| `dv_handover_records` | Case handover audit | INSERT-only for handover creation. UPDATE allowed only for status transitions (pending → accepted/rejected). |

### 2.6 Customer/Case Ownership Boundaries

**DebtVerge is the authoritative source for:**
- Customer profile data (name, contact, address, household)
- Case records (status, pipeline, plan type)
- SFS entries (income, expenses, disposable income)
- Creditor ledger (balances, interest rates, pro-rata)
- Payment records (incoming payments, splits, schedules)
- Distribution records (scheduled creditor payments)
- Vulnerability assessments and flags
- Compliance attestations
- Communication logs
- IVA/insolvency data (IP, proposals, votes, PoD)
- Breathing Space / moratorium records
- Annual review snapshots
- Cashier operations data
- Payment gateway configuration and transaction logs

**DebtVerge is NOT authoritative for:**
- Lead data (LeadVerge owns leads until handover)
- Qualification results (Qualify owns qualification until handover)
- IVA supervision data after handover (IVA Verge becomes authoritative for the IVA supervision lifecycle)
- Call recordings (StormCall owns recordings)
- E-signed documents (StormSign owns signing events)
- File storage (Supabase Storage owns file blobs; DebtVerge owns metadata)

### 2.7 Organisation/Tenant Boundaries

**Every DebtVerge-owned table must enforce organisation isolation:**

1. Tables with direct `organization_id` column (17 tables): `dv_cases`, `dv_tenants`, `dv_gateway_configs`, `dv_payment_methods`, `dv_recurring_schedules`, `dv_gateway_transactions`, `dv_waterfall_entries`, `dv_reconciliation_log`, `dv_bank_feeds`, `dv_cashier_transactions`, `dv_batch_runs`, `dv_cashier_audit_logs`, `dv_ledger_locks`, `dv_disbursement_runs`, `dv_payment_links`, `dv_unassigned_messages` (redesigned), `dv_signposting_assessments` (redesigned), `dv_background_jobs`, `dv_handover_records`, `dv_external_api_calls`, `dv_consent_records`, `dv_aml_assessments`, `dv_dpa_register`

2. Child tables scoped via parent `dv_cases` (26 tables): all tables with `case_id` FK. RLS uses EXISTS subquery through `dv_cases.organization_id`.

3. `dv_batch_items` and `dv_disbursement_items`: scoped via parent run's `organization_id` (EXISTS through `dv_batch_runs` / `dv_disbursement_runs`).

4. `dv_tenants`: scoped by `auth_user_id = auth.uid()` or super-admin bypass.

---

## Section 3 — API Boundaries

### 3.1 DebtVerge ↔ Stormreef (Shared Services)

**Relationship:** DebtVerge uses shared platform infrastructure (auth, RBAC schema, org management, licensing schema, storage).

**REQUEST (DebtVerge → Stormreef):**
- Authentication: Supabase Auth (shared `auth.users` table)
- RBAC: DebtVerge creates roles/permissions in shared `rbac_*` tables
- Org management: DebtVerge creates orgs/memberships in shared `organization*` tables
- Licensing: DebtVerge's modules appear as `catalog_items`; orgs have `organization_licenses` rows
- Storage: DebtVerge uses Supabase Storage buckets

**RESPONSE (Stormreef → DebtVerge):**
- Auth: JWT tokens, session management
- RBAC: Permission grants, role assignments
- Storage: File URLs, signed URLs

**OWNERSHIP:** Stormreef owns the table schemas. DebtVerge owns its rows (its orgs, roles, users, licenses).

**FAILURE:** If Supabase Auth is unavailable, DebtVerge cannot authenticate users. If Storage is unavailable, document upload/preview fails. These are platform dependencies — DebtVerge degrades gracefully with error messages.

**AUDIT:** Auth events logged by Supabase. DebtVerge logs its own RBAC changes in `dv_audit_log`.

### 3.2 DebtVerge ↔ LeadVerge

**Direction:** LeadVerge → DebtVerge (inbound handover)

**REQUEST (LeadVerge → DebtVerge):**
```
POST /functions/v1/dv-handover-receive
Authorization: Bearer <service_token>
Content-Type: application/json

{
  "handover_id": "uuid",
  "source_app": "leadverge",
  "target_org_id": "uuid",
  "lead_snapshot": {
    "lead_reference": "LV-2026-0001",
    "customer": {
      "full_name": "John Smith",
      "email": "john@example.com",
      "mobile_phone": "07123456789",
      "address": { "street": "...", "city": "...", "postcode": "..." }
    },
    "debt_summary": {
      "estimated_total_debt": 25000,
      "creditor_count": 5,
      "monthly_disposable_income": 350
    },
    "advisor": { "id": "uuid", "name": "Jane Advisor" },
    "consent": {
      "data_processing": true,
      "consented_at": "2026-08-09T10:00:00Z"
    },
    "documents": [
      { "type": "bank_statement", "url": "https://...", "filename": "stmt.pdf" }
    ]
  }
}
```

**RESPONSE (DebtVerge → LeadVerge):**
```
{
  "accepted": true,
  "case_id": "uuid",
  "case_number": "DV-2026-0001",
  "status": "intake"
}
```
or
```
{
  "accepted": false,
  "reason": "duplicate_lead_reference",
  "existing_case_id": "uuid"
}
```

**OWNERSHIP:** Once accepted, DebtVerge owns the case and all downstream data. LeadVerge retains the original lead record but no longer has write access to the case.

**FAILURE:** If DebtVerge is unavailable, LeadVerge retries with exponential backoff (3 attempts). If all retries fail, LeadVerge queues the handover for later delivery. The handover is not lost.

**AUDIT:** DebtVerge records the handover in `dv_handover_records` (source_app, source_reference, payload_snapshot, accepted_at). A milestone entry is written to `dv_audit_log` ("Case created from LeadVerge handover").

### 3.3 DebtVerge ↔ Qualify

**Direction:** Qualify → DebtVerge (inbound handover)

**REQUEST (Qualify → DebtVerge):**
```
POST /functions/v1/dv-handover-receive
Authorization: Bearer <service_token>
Content-Type: application/json

{
  "handover_id": "uuid",
  "source_app": "qualify",
  "target_org_id": "uuid",
  "lead_snapshot": {
    "lead_reference": "QUAL-2026-0001",
    "customer": { "full_name": "...", "email": "...", "mobile_phone": "..." },
    "qualification_result": {
      "recommended_route": "iva",
      "confidence": 85,
      "sfs_data": {
        "income_entries": [...],
        "expense_entries": [...],
        "disposable_income": 450
      },
      "creditor_list": [...]
    },
    "advisor": { "id": "uuid", "name": "..." },
    "consent": { "data_processing": true, "consented_at": "..." },
    "documents": [...]
  }
}
```

**RESPONSE:** Same as LeadVerge handover.

**OWNERSHIP:** DebtVerge owns the case. Qualify's SFS data is imported as `dv_sfs_entries`. The qualification result is stored in `dv_signposting_assessments` for audit.

**FAILURE:** Same as LeadVerge — retry with backoff, queue for later.

**AUDIT:** `dv_handover_records` + `dv_audit_log` milestone.

### 3.4 DebtVerge → IVA Verge

**Direction:** DebtVerge → IVA Verge (outbound handover)

See [Section 5](#section-5--debtverge--iva-verge) for full specification.

### 3.5 DebtVerge ↔ StormCall

**Direction:** Bidirectional. StormCall sends call compliance data to DebtVerge. DebtVerge sends case context to StormCall.

**REQUEST (StormCall → DebtVerge):**
```
POST /functions/v1/dv-external-event
Authorization: Bearer <service_token>
Content-Type: application/json

{
  "event_type": "call_completed",
  "organization_id": "uuid",
  "case_id": "uuid",
  "call_data": {
    "call_id": "uuid",
    "direction": "outbound",
    "duration_seconds": 180,
    "outcome": "answered",
    "recording_url": "https://stormcall.../recording.mp3",
    "transcript_url": "https://stormcall.../transcript.json",
    "compliance_status": "approved",
    "advisor_id": "uuid",
    "advisor_name": "..."
  }
}
```

**RESPONSE (DebtVerge → StormCall):**
```
{ "acknowledged": true, "recorded_at": "2026-08-09T10:00:00Z" }
```

**REQUEST (DebtVerge → StormCall):**
```
POST /functions/v1/stormcall-initiate
Authorization: Bearer <service_token>
Content-Type: application/json

{
  "organization_id": "uuid",
  "case_id": "uuid",
  "debtor_phone": "07123456789",
  "advisor_id": "uuid"
}
```

**RESPONSE (StormCall → DebtVerge):**
```
{ "call_id": "uuid", "status": "initiated" }
```

**OWNERSHIP:** StormCall owns call recordings, transcripts, and compliance review data. DebtVerge owns a reference to the call (call_id, recording_url) stored in `dv_communications` as an internal note with `[VOIP]` prefix.

**FAILURE:** If StormCall is unavailable, VoIP call initiation fails. DebtVerge shows an error. Call compliance data delivery from StormCall is retried. DebtVerge's core case management is unaffected.

**AUDIT:** DebtVerge logs the call in `dv_communications` and `dv_audit_log`. StormCall logs its own compliance audit. DebtVerge logs the external API call in `dv_external_api_calls`.

### 3.6 DebtVerge ↔ StormSign

**Direction:** DebtVerge sends documents for e-signing. StormSign returns signing status.

**REQUEST (DebtVerge → StormSign):**
```
POST /functions/v1/stormsign-send
Authorization: Bearer <service_token>
Content-Type: application/json

{
  "organization_id": "uuid",
  "case_id": "uuid",
  "document": {
    "type": "iva_proposal",
    "filename": "IVA-Proposal-JohnSmith.pdf",
    "file_url": "https://supabase.../dv-documents/...",
    "signers": [
      { "name": "John Smith", "email": "john@example.com", "role": "debtor" },
      { "name": "Jane IP", "email": "jane@ipfirm.com", "role": "nominee" }
    ]
  }
}
```

**RESPONSE (StormSign → DebtVerge):**
```
{ "envelope_id": "uuid", "status": "sent" }
```

**REQUEST (StormSign → DebtVerge — webhook callback):**
```
POST /functions/v1/dv-external-event
{
  "event_type": "document_signed",
  "organization_id": "uuid",
  "case_id": "uuid",
  "signing_data": {
    "envelope_id": "uuid",
    "status": "completed",
    "signed_by": [{ "name": "...", "signed_at": "..." }],
    "signed_document_url": "https://stormsign.../signed.pdf"
  }
}
```

**OWNERSHIP:** StormSign owns the signing process and events. DebtVerge owns the document metadata and the signed document reference.

**FAILURE:** If StormSign is unavailable, document sending fails. DebtVerge shows an error. The case continues — signing is not blocking for case management.

**AUDIT:** DebtVerge logs the signing event in `dv_audit_log` and `dv_external_api_calls`.

### 3.7 DebtVerge ↔ StormDrive

**Direction:** DebtVerge references documents stored in StormDrive by URL.

**REQUEST (DebtVerge → StormDrive — if integrated):**
```
GET /functions/v1/stormdrive-file?file_id=uuid
Authorization: Bearer <service_token>
```

**RESPONSE:**
```
{ "file_url": "https://...", "filename": "...", "content_type": "..." }
```

**OWNERSHIP:** StormDrive owns file blobs and folder structure. DebtVerge stores file URLs in `dv_document_checklist`.

**FAILURE:** If StormDrive is unavailable, document preview fails. DebtVerge shows an error. Case management is unaffected.

**AUDIT:** DebtVerge logs file access in `dv_external_api_calls`.

**Note:** DebtVerge should use Supabase Storage as its primary document store. StormDrive integration is optional and only for cross-platform document sharing.

### 3.8 DebtVerge ↔ Storm ID

**Direction:** Storm ID provides cross-app user identity and SSO.

**REQUEST (DebtVerge → Storm ID — if integrated):**
```
GET /functions/v1/stormid-user?user_id=uuid
Authorization: Bearer <service_token>
```

**RESPONSE:**
```
{ "user_id": "uuid", "email": "...", "organizations": [...], "roles": [...] }
```

**OWNERSHIP:** Storm ID owns user identity. DebtVerge syncs user/org/role data locally.

**FAILURE:** If Storm ID is unavailable, DebtVerge falls back to its local `dv_organization_users` cache. Auth continues via Supabase Auth.

**AUDIT:** DebtVerge logs identity sync in `dv_external_api_calls`.

**Note:** DebtVerge must function without Storm ID. Supabase Auth + local org management is the baseline.

### 3.9 DebtVerge ↔ Draft Verge

**Direction:** DebtVerge → Draft Verge (outbound handover, same pattern as IVA Verge)

**REQUEST (DebtVerge → Draft Verge):**
```
POST /functions/v1/draftverge-handover-receive
Authorization: Bearer <service_token>

{
  "handover_id": "uuid",
  "source_app": "debtverge",
  "source_case_id": "uuid",
  "source_case_number": "DV-2026-0001",
  "target_org_id": "uuid",
  "case_snapshot": { ... same as IVA Verge handover ... }
}
```

**RESPONSE, OWNERSHIP, FAILURE, AUDIT:** Same as IVA Verge handover (see Section 5).

### 3.10 DebtVerge ↔ Open Banking Provider

**Direction:** DebtVerge initiates bank feed connection. Provider returns transaction data.

**REQUEST (DebtVerge → Open Banking provider, e.g. TrueLayer):**
```
POST /functions/v1/dv-open-banking-connect
Authorization: Bearer <user_jwt>

{
  "organization_id": "uuid",
  "case_id": "uuid",
  "bank_reference": "..."
}
```

**RESPONSE (Provider → DebtVerge — via callback/webhook):**
```
POST /functions/v1/dv-open-banking-webhook
{
  "event_type": "transactions_ready",
  "case_id": "uuid",
  "transactions": [
    { "date": "2026-08-01", "description": "TESCO STORES", "amount": -45.20, "merchant_hint": "TESCO" },
    ...
  ]
}
```

**OWNERSHIP:** DebtVerge owns the imported transaction data (`dv_bank_transactions`). The provider owns the banking connection and raw feed.

**FAILURE:** If the provider is unavailable, bank feed import fails. CSV import remains as a fallback. Case management is unaffected.

**AUDIT:** DebtVerge logs the external API call in `dv_external_api_calls`. Import event in `dv_audit_log`.

### 3.11 DebtVerge ↔ Credit Search Provider

**Direction:** DebtVerge requests credit search. Provider returns creditor data.

**REQUEST (DebtVerge → Credit provider, e.g. Experian):**
```
POST /functions/v1/dv-credit-search
Authorization: Bearer <user_jwt>

{
  "organization_id": "uuid",
  "case_id": "uuid",
  "customer": { "full_name": "...", "dob": "...", "address": {...} }
}
```

**RESPONSE:**
```
{
  "search_id": "uuid",
  "creditors": [
    { "name": "Barclaycard", "account_reference": "...", "balance": 4500, "debt_type": "credit_card" },
    ...
  ],
  "total_debt": 25000
}
```

**OWNERSHIP:** DebtVerge owns the imported creditor data (`dv_creditors`). The provider owns the credit search query and result.

**FAILURE:** If the provider is unavailable, credit search fails. Advisor can enter creditors manually. Case management is unaffected.

**AUDIT:** DebtVerge logs the external API call in `dv_external_api_calls`.

### 3.12 DebtVerge ↔ Payment Providers (Stripe / GoCardless)

**Direction:** DebtVerge initiates payment operations. Provider returns transaction results.

**REQUEST (DebtVerge → Stripe, via edge function):**
```
POST /functions/v1/dv-payment-gateway
Authorization: Bearer <user_jwt>

{
  "action": "charge",
  "organization_id": "uuid",
  "case_id": "uuid",
  "gateway_config_id": "uuid",
  "payment_method_id": "uuid",
  "amount": 150.00,
  "currency": "GBP"
}
```

**RESPONSE:**
```
{
  "gateway_transaction_id": "pi_stripe_abc123",
  "status": "succeeded",
  "gateway_response": { ... full Stripe response ... }
}
```

**OWNERSHIP:** DebtVerge owns the transaction record (`dv_gateway_transactions`) including the gateway's transaction ID and full response. Stripe owns the payment processing.

**FAILURE:** If Stripe is unavailable, the charge fails. DebtVerge records the failure in `dv_gateway_transactions` (status: failed) and `dv_reconciliation_log`. Recurring collection retries on next cycle.

**AUDIT:** DebtVerge logs the external API call in `dv_external_api_calls`. Transaction recorded in `dv_gateway_transactions` and `dv_cashier_audit_logs`.

---

## Section 4 — LeadVerge → Qualify → DebtVerge

### 4.1 Handoff Chain

```
LeadVerge          Qualify           DebtVerge
   │                  │                  │
   │  Lead created    │                  │
   │─────────────────▶│                  │
   │                  │                  │
   │         Qualification done          │
   │                  │                  │
   │         Handover to DebtVerge       │
   │                  │─────────────────▶│
   │                  │                  │
   │                  │         Case created
   │                  │                  │
   │                  │     SFS imported  │
   │                  │     Creditors imported
   │                  │     Customer profile created
   │                  │                  │
```

### 4.2 Reference Chain

| Stage | Reference | Owner | Persisted In |
|-------|-----------|-------|-------------|
| Lead | `lead_reference` (e.g. `LV-2026-0001`) | LeadVerge | LeadVerge DB, DebtVerge `dv_handover_records.source_reference` |
| Qualification | `qualification_reference` (e.g. `QUAL-2026-0001`) | Qualify | Qualify DB, DebtVerge `dv_handover_records.source_reference` |
| Case | `case_number` (e.g. `DV-2026-0001`) | DebtVerge | DebtVerge `dv_cases.case_number` |

The reference chain is: `lead_reference → qualification_reference → case_number`. Each system stores the upstream reference in its handover records. DebtVerge stores both the lead reference and qualification reference in `dv_handover_records` for full traceability.

### 4.3 Data Transfer Rules

**Principle:** Minimise data duplication. DebtVerge creates its own records from the handover payload. It does not read upstream databases.

| Data Item | Source | DebtVerge Action |
|-----------|--------|-----------------|
| Customer identity (name, email, phone) | LeadVerge/Qualify handover | Create `dv_customer_profiles` record. Store source reference in `dv_handover_records`. |
| Address | LeadVerge/Qualify handover | Create `dv_customer_profiles` address fields. |
| Household composition | Qualify handover (if available) | Create `dv_customer_profiles` household fields. If not provided, advisor completes during fact-find. |
| SFS data (income, expenses) | Qualify handover (if available) | Create `dv_sfs_entries` records. Mark as `imported_from: "qualify"` in audit log. |
| Creditor list | Qualify handover (if available) | Create `dv_creditors` records. |
| Documents | LeadVerge/Qualify handover | Download from source URL, re-upload to DebtVerge's Supabase Storage bucket. Create `dv_document_checklist` entries. |
| Consent | LeadVerge/Qualify handover | Create `dv_consent_records` entry. If no consent data in handover, advisor must obtain consent before proceeding. |
| Advisor ownership | Handover payload | Assign case to the receiving org's advisor. If the advisor doesn't exist in DebtVerge, assign to org admin. |
| Organisation ownership | Handover `target_org_id` | Set `dv_cases.organization_id` = `target_org_id`. |

### 4.4 What DebtVerge Does NOT Accept from Upstream

- DebtVerge does NOT accept upstream case status. The case always starts at `intake` in DebtVerge regardless of upstream status.
- DebtVerge does NOT accept upstream audit logs. It creates its own audit trail from the handover event.
- DebtVerge does NOT accept upstream payment records. Payment history starts fresh in DebtVerge.
- DebtVerge does NOT accept upstream compliance attestations. Compliance must be re-attested in DebtVerge.

### 4.5 Failure Handling

If the handover fails (DebtVerge unavailable):
1. Source system retries 3 times with exponential backoff (1s, 5s, 30s).
2. If all retries fail, source system queues the handover in its own outbox.
3. Source system retries from the queue every 5 minutes until DebtVerge responds.
4. The handover is idempotent — `handover_id` prevents duplicate case creation.

---

## Section 5 — DebtVerge → IVA Verge

### 5.1 Trigger

A case is handed over to IVA Verge when:
- The Pathfinder engine recommends IVA as the primary route
- The solution suitability matrix scores IVA as `eligible` or `likely`
- The advisor confirms IVA is the appropriate solution
- The case has completed at least SFS construction and creditor information gathering

### 5.2 Data Transferred

The handover payload is a complete snapshot of the case at the point of transfer:

```json
{
  "handover_id": "uuid",
  "source_app": "debtverge",
  "source_case_id": "uuid",
  "source_case_number": "DV-2026-0001",
  "target_org_id": "uuid",
  "handover_reason": "advisor_confirmed_iva",
  "case_snapshot": {
    "case": {
      "case_number": "DV-2026-0001",
      "status": "sfs_approved",
      "plan_type": "dmp",
      "monthly_disposable_income": 450.00,
      "total_debt": 25000.00,
      "recovery_rate_target": 90.00
    },
    "customer_profile": { "full_name": "...", "email": "...", "phones": {...}, "address": {...}, "household": {...}, "tenure": {...} },
    "previous_addresses": [...],
    "sfs_entries": [...],
    "creditors": [...],
    "vulnerability_assessment": { "score": 25, "level": "low", "flags": [...] },
    "benefits_checks": [...],
    "compliance_attestations": [...],
    "documents": [
      { "type": "bank_statement", "url": "https://supabase.../...", "filename": "..." },
      ...
    ],
    "communications_summary": { "total_messages": 15, "last_message_at": "..." },
    "pathfinder_result": { "recommended_route": "iva", "confidence": 85, "scores": {...} },
    "suitability_matrix": { "iva": { "verdict": "eligible", "score": 92, "reasons": [...] } },
    "consent": { "data_processing": true, "consented_at": "..." }
  }
}
```

### 5.3 Authoritative System

After handover:
- **IVA Verge** becomes the authoritative system for the IVA supervision lifecycle: IP appointment, proposal drafting, creditor voting, proof of debt, contributions, distribution runs, supervision.
- **DebtVerge** remains the authoritative system for: the original case record, customer profile, SFS, creditor ledger, payment history, compliance attestations, and communications that occurred before handover.

### 5.4 What Remains Visible in DebtVerge

After handover, the DebtVerge case:
- Status changes to `handed_over` (terminal state)
- Remains in the case list (read-only)
- Shows a "Handed over to IVA Verge" banner with the IVA Verge case reference
- All pre-handover tabs remain visible (read-only)
- A new "IVA Verge Status" panel shows the current IVA stage (synced via API or webhook)

### 5.5 Cross-System Referencing

| Reference | Stored In | Purpose |
|-----------|----------|---------|
| `source_case_id` (DebtVerge UUID) | IVA Verge `iv_cases.source_dv_case_id` | IVA Verge can reference back to DebtVerge |
| `iva_verge_case_id` | DebtVerge `dv_cases.handed_over_to_case_id` | DebtVerge can link to IVA Verge |
| `iva_verge_case_number` | DebtVerge `dv_cases.handed_over_to_case_number` | Display in UI |
| `handover_id` | Both systems' handover records | Shared transaction ID for audit |

### 5.6 Documents and Communications

**Documents:**
- DebtVerge's document URLs are included in the handover payload.
- IVA Verge downloads and re-uploads to its own storage (same as LeadVerge → DebtVerge pattern).
- Both systems can reference the same document by URL if storage is shared (Supabase Storage).
- New documents created in IVA Verge are NOT copied back to DebtVerge. DebtVerge shows "See IVA Verge for post-handover documents."

**Communications:**
- Pre-handover communications remain in DebtVerge (`dv_communications`).
- Post-handover communications are managed by IVA Verge.
- DebtVerge shows "See IVA Verge for post-handover communications."
- If a webhook from IVA Verge sends a communication summary, DebtVerge can display it in the IVA Verge Status panel.

### 5.7 Status Synchronisation

| Mechanism | Direction | Frequency |
|-----------|-----------|-----------|
| Webhook from IVA Verge → DebtVerge | IVA Verge stage changes → DebtVerge IVA Status panel | Real-time |
| API poll (fallback) | DebtVerge polls IVA Verge for case status | Every 1 hour if webhook not received |
| Manual refresh | Advisor clicks "Refresh IVA Status" button | On demand |

**IVA Verge stage values synced to DebtVerge:**
`proposal_drafting` → `meeting_of_creditors` → `active_supervision` → `in_breach` / `transfer` / `completed`

### 5.8 Failure/Retry Handling

1. DebtVerge sends handover to IVA Verge via `POST /functions/v1/ivaverge-handover-receive`.
2. If IVA Verge is unavailable, DebtVerge retries 3 times (1s, 5s, 30s backoff).
3. If all retries fail, DebtVerge stores the handover in `dv_handover_records` with status `pending` and queues it for retry.
4. A background job (`dv-queue-worker`) retries pending handovers every 5 minutes.
5. The case in DebtVerge remains in its current status until the handover is accepted. It does NOT change to `handed_over` until IVA Verge confirms acceptance.
6. If IVA Verge rejects the handover (e.g. duplicate, validation failure), DebtVerge sets `dv_handover_records.status = rejected` and the case returns to its previous status. The advisor is notified.

### 5.9 Audit Trail Preservation

| Event | Recorded In | Details |
|-------|------------|---------|
| Handover initiated | DebtVerge `dv_handover_records` (status: pending) + `dv_audit_log` | "Case handover initiated to IVA Verge" |
| Handover accepted | DebtVerge `dv_handover_records` (status: accepted) + `dv_audit_log` | "Case handed over to IVA Verge. IVA Verge case: IV-2026-XXXX" |
| Handover rejected | DebtVerge `dv_handover_records` (status: rejected) + `dv_audit_log` | "Case handover rejected by IVA Verge. Reason: ..." |
| IVA Verge stage update | DebtVerge `dv_audit_log` | "IVA Verge stage updated: proposal_drafting → meeting_of_creditors" |
| Complete case snapshot | DebtVerge `dv_handover_records.payload_snapshot` (jsonb) | Full case data at point of handover |

The `payload_snapshot` in `dv_handover_records` ensures that even if IVA Verge loses data, the complete case state at handover is preserved in DebtVerge.

---

## Section 6 — Compliance Architecture

### 6.1 Ordinary Application Data vs Immutable/Audit/Event Data

**Ordinary Application Data (mutable, CRUD):**
- `dv_cases` (status, notes, plan_type can be updated)
- `dv_creditors` (balances, pro-rata can be updated)
- `dv_sfs_entries` (entries can be added/modified)
- `dv_customer_profiles` (profile can be updated)
- `dv_payments` (payments can be logged)
- `dv_distributions` (distributions can be scheduled/updated)
- `dv_communications` (messages can be sent, threads updated)
- `dv_document_checklist` (documents can be uploaded, reviewed)
- All other operational tables

**Immutable/Audit/Event Data (INSERT-only):**
- `dv_audit_log` — case milestone events
- `dv_cashier_audit_logs` — cashier operations audit
- `dv_compliance_attestations` — FCA disclaimer confirmations
- `dv_field_change_audit` (NEW) — field-level change tracking
- `dv_external_api_calls` (NEW) — external API interaction log
- `dv_handover_records` — handover audit (INSERT for creation, UPDATE only for status)
- `dv_consent_records` (NEW) — consent events (INSERT for grant, INSERT for withdrawal)

### 6.2 What Must Be Auditable

**Every important customer action:**
- Case creation, status change, pipeline switch
- SFS submission/approval
- Creditor offer acceptance/rejection
- Payment plan agreement
- Breathing Space activation/cancellation
- IVA proposal acceptance/rejection
- Document upload/approval/rejection
- Case closure

**Every advisor action:**
- Case creation
- Status change
- Pipeline switch
- SFS entry modification
- Creditor addition/modification
- Payment logging
- Distribution scheduling
- Compliance attestation
- Vulnerability flag creation
- Communication sending (email/SMS/WhatsApp/internal note)
- Document upload/review
- Breathing Space activation
- Handover initiation
- Data export
- Ledger lock/unlock
- Batch run creation/execution
- Disbursement run approval

**Every data change (field-level for critical fields):**
- `dv_cases.status` — old value, new value, actor, timestamp
- `dv_cases.plan_type` — old value, new value, actor, timestamp
- `dv_cases.total_debt` — old value, new value, actor, timestamp
- `dv_cases.monthly_disposable_income` — old value, new value, actor, timestamp
- `dv_creditors.current_balance` — old value, new value, actor, timestamp
- `dv_recurring_schedules.status` — old value, new value, actor, timestamp
- `dv_gateway_transactions.status` — old value, new value, actor, timestamp

### 6.3 Audit Table Design

**`dv_field_change_audit` (NEW):**
```sql
CREATE TABLE dv_field_change_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  case_id uuid,
  table_name text NOT NULL,
  record_id uuid NOT NULL,
  field_name text NOT NULL,
  old_value jsonb,
  new_value jsonb,
  changed_by uuid NOT NULL,    -- auth.uid()
  changed_by_email text,
  changed_at timestamptz NOT NULL DEFAULT now()
);
-- RLS: INSERT only (authenticated, org-scoped). No SELECT from frontend — compliance officer access via SECURITY DEFINER function.
```

**`dv_external_api_calls` (NEW):**
```sql
CREATE TABLE dv_external_api_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  case_id uuid,
  api_target text NOT NULL,      -- 'stripe', 'gocardless', 'twilio', 'stormcall', 'ivaverge', etc.
  api_endpoint text NOT NULL,
  request_method text NOT NULL,
  request_payload jsonb,
  response_status int,
  response_body jsonb,
  initiated_by uuid,
  initiated_at timestamptz NOT NULL DEFAULT now(),
  duration_ms int
);
-- RLS: INSERT only (authenticated, org-scoped). SELECT for compliance officers.
```

### 6.4 Communication and Document Linkage

**Communications:**
- Every message in `dv_communications` has `case_id` and `thread_id`.
- Every message records `agent_id`, `agent_name`, `channel`, `direction`, `created_at`.
- Messages are linked to the case audit trail via `dv_audit_log` entries.
- Attachments are linked to `dv_document_checklist` entries by file URL.

**Documents:**
- Every document in `dv_document_checklist` has `case_id`, `uploaded_by_role`, `file_name`, `file_url`.
- Document review (approve/reject) records `reviewed_by`, `reviewed_at`, `rejection_reason`.
- Document changes are tracked in `dv_field_change_audit` (status field).
- `dv_document_versions` (NEW) tracks version history when documents are replaced.

### 6.5 Consent and DPA Events

**`dv_consent_records` (NEW):**
```sql
CREATE TABLE dv_consent_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  case_id uuid NOT NULL,
  consent_type text NOT NULL,     -- 'data_processing', 'marketing', 'communication', 'credit_search', 'open_banking'
  granted boolean NOT NULL,
  granted_by text NOT NULL,       -- 'advisor' | 'debtor' | 'system'
  granted_at timestamptz,
  withdrawn_at timestamptz,
  withdrawal_reason text,
  notes text
);
-- RLS: org-scoped, INSERT-only for grant/withdrawal events.
```

**`dv_dpa_register` (NEW):**
```sql
CREATE TABLE dv_dpa_register (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  case_id uuid NOT NULL,
  dpa_completed boolean NOT NULL DEFAULT false,
  completed_at timestamptz,
  completed_by uuid,
  completed_by_name text,
  dpa_version text,              -- version of DPA statement used
  notes text
);
-- RLS: org-scoped, full CRUD.
```

**`dv_aml_assessments` (NEW):**
```sql
CREATE TABLE dv_aml_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  case_id uuid NOT NULL,
  risk_level text NOT NULL DEFAULT 'low',  -- 'low', 'medium', 'high'
  checked_by uuid,
  checked_by_name text,
  checked_at timestamptz,
  risk_factors text[],
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- RLS: org-scoped, full CRUD.
```

### 6.6 External API Interaction Recording

Every external API call made by DebtVerge (to Stripe, GoCardless, Twilio, SMTP, StormCall, StormSign, IVA Verge, Open Banking, credit search) must be recorded in `dv_external_api_calls` with:
- API target and endpoint
- Request method and payload (redact sensitive data like card numbers)
- Response status and body (redact sensitive data)
- Initiated by (user ID)
- Duration

This ensures complete traceability of all external interactions for regulatory audits.

---

## Section 7 — Tenant Isolation

### 7.1 Production Multi-Tenant Model

**Organisation:**
- Each debt-management company is an `organization` in the shared platform.
- An organization has one owner (`owner_id`) and multiple users (`organization_users`).
- An organization has one or more roles (`rbac_roles`) and role permissions.

**Users:**
- Users authenticate via Supabase Auth (email/password).
- Users are linked to organizations via `organization_users`.
- A user can belong to multiple organizations (multi-tenant staff).
- Each membership has a role (`rbac_roles.id`).

**Roles:**
- Each organization creates its own roles (Admin, Advisor, Compliance Officer, Cashier).
- Roles are scoped to the organization — role A in Org X has no relation to role A in Org Y.
- Permissions follow `MODULE:action` format (e.g. `DEBTVERGE:view`, `PAYMENTS:manage`).

**Permissions:**
- Permissions are granted to roles via `rbac_role_permissions`.
- A user's effective permissions = union of all permissions across all their roles in the current organization.
- Super-admin bypass: `is_super_admin()` returns true if `profiles.is_super_admin = true`.

### 7.2 Customer/Case Ownership

- Every customer profile belongs to exactly one organization (via `dv_cases.organization_id`).
- Every case belongs to exactly one organization.
- Cases are never shared between organizations.
- Case ownership is set at creation and never changes (except via handover to another app — but the DebtVerge case record retains its org).
- A user in Organization A cannot see, search, or reference any case, customer, creditor, payment, communication, or document belonging to Organization B.

### 7.3 RLS Enforcement

**Pattern 1 — Tables with direct `organization_id` (23 tables):**
```sql
CREATE POLICY "select_own" ON dv_cases FOR SELECT TO authenticated
  USING (is_super_admin() OR EXISTS(
    SELECT 1 FROM organization_users ou
    WHERE ou.user_id = auth.uid()
    AND ou.organization_id = dv_cases.organization_id
  ));
-- Same pattern for INSERT (WITH CHECK), UPDATE (USING + WITH CHECK), DELETE (USING).
```

**Pattern 2 — Child tables scoped via parent `dv_cases` (26 tables):**
```sql
CREATE POLICY "select_own" ON dv_creditors FOR SELECT TO authenticated
  USING (is_super_admin() OR EXISTS(
    SELECT 1 FROM dv_cases
    WHERE dv_cases.id = dv_creditors.case_id
    AND EXISTS(
      SELECT 1 FROM organization_users ou
      WHERE ou.user_id = auth.uid()
      AND ou.organization_id = dv_cases.organization_id
    )
  ));
-- Same pattern for INSERT/UPDATE/DELETE.
```

**Pattern 3 — Audit tables (INSERT-only):**
```sql
CREATE POLICY "insert_own" ON dv_audit_log FOR INSERT TO authenticated
  WITH CHECK (is_super_admin() OR EXISTS(
    SELECT 1 FROM organization_users ou
    WHERE ou.user_id = auth.uid()
    AND ou.organization_id = dv_audit_log.organization_id
  ));
CREATE POLICY "select_own" ON dv_audit_log FOR SELECT TO authenticated
  USING (is_super_admin() OR EXISTS(
    SELECT 1 FROM organization_users ou
    WHERE ou.user_id = auth.uid()
    AND ou.organization_id = dv_audit_log.organization_id
  ));
-- NO UPDATE or DELETE policies.
```

### 7.4 API-Level Tenant Enforcement

**Edge functions must validate org membership:**
1. Extract JWT from Authorization header.
2. Extract `organization_id` from request body or query param.
3. Query `organization_users` to verify the user belongs to the organization.
4. Reject with 403 if the user is not a member.
5. Super-admin bypass: if `is_super_admin()` returns true, skip org check.

**Edge functions using service role key:**
- Service role key bypasses RLS — so edge functions MUST manually validate org membership.
- The existing implementation does NOT do this — it trusts the request payload. This must be fixed.

### 7.5 File/Storage Isolation

- Supabase Storage bucket: `dv-documents`
- Path structure: `{organization_id}/{case_id}/{document_type}/{filename}`
- Storage RLS policies:
  - SELECT: user must be a member of the organization in the path.
  - INSERT/UPDATE: user must be a member of the organization.
  - DELETE: user must be a member of the organization.
- Signed URLs with short expiry (15 minutes) for document access.

### 7.6 Cross-Application Tenant Identity

- If Storm ID is available, user identity is synced across all Storm apps.
- If Storm ID is not available, each app manages its own `organization_users` table. User IDs are Supabase Auth user IDs (UUIDs) — consistent across apps using the same Supabase project.
- For standalone deployment with its own Supabase project, DebtVerge manages its own auth.users, organizations, and organization_users. Cross-app handovers use service-to-service authentication (API keys), not user JWTs.

### 7.7 Weaknesses in Existing Implementation That Must NOT Be Carried Over

| Weakness | Impact | Fix |
|----------|--------|-----|
| `dv_unassigned_messages` has no `organization_id` | Agents cannot see unassigned messages | Add `organization_id NOT NULL` to the table |
| `dv_signposting_assessments` has no `organization_id` | Pre-case assessments are invisible | Add `organization_id NOT NULL` to the table |
| `dv_cases.organization_id` is nullable | Cases without org membership are invisible to everyone | Make `organization_id NOT NULL` |
| Payment gateway tables lack `is_super_admin()` bypass | Super admins can't manage payment configs across orgs | Add `is_super_admin() OR ...` to all gateway/cashier RLS policies |
| `dv_breathing_spaces.user_id` column is dead | Confusing dead column that serves no purpose | Remove `user_id` column. Use `organization_id` + `case_id` for RLS. |
| Edge functions use service role key without org validation | Any caller can access any org's data via edge functions | Add JWT validation + org membership check to all edge functions |
| `is_super_admin()` is SECURITY DEFINER reading `profiles` | If profiles table is compromised, all RLS bypassed | Keep the function but add defence-in-depth: log all super-admin access in `dv_external_api_calls` |
| No real-time tenant isolation on channels | Realtime channels might leak cross-org data | Use org-scoped channel names: `org:{org_id}:case:{case_id}` |

---

## Section 8 — Security Boundaries

### 8.1 What Must Never Be Trusted from the Frontend

| Data Category | Frontend Can | Frontend Cannot |
|--------------|-------------|----------------|
| Customer data | Display, edit (with RBAC) | Determine org ownership, bypass RLS, access other orgs' data |
| Financial data | Display, enter payments | Determine pro-rata calculations (server-side), set transaction status directly, modify reconciliation logs |
| Documents | Upload, preview | Set file URLs directly (must go through storage upload), bypass document review workflow |
| Communications | Compose, send | Set `agent_id` to another user, set `direction` to inbound for outbound messages, modify message status after sending |
| Calls | Initiate, view metadata | Access recordings directly (must use signed URLs), modify call compliance status |
| Transcripts | View (if permitted) | Modify transcript content, change compliance review status |
| Credentials | None | Store or transmit any passwords, API keys, gateway secrets |
| Tokens | None | Store gateway tokens in frontend code, transmit tokens outside of HTTPS |
| API keys | None | Access gateway API keys (stored as edge function secrets only), call external APIs directly from frontend |
| Audit records | View (if permitted) | Modify, delete, or create fake audit entries. Audit INSERT must go through server-side functions. |
| Organisation ID | Send as context | The server must verify the user belongs to the org — never trust the frontend-supplied org_id without verification |
| Role/permission | Display current role | Grant roles to self, escalate permissions, modify `is_super_admin` flag |
| Payment amounts | Enter | The server must validate amounts are positive, within limits, and match the schedule. Never trust frontend-calculated amounts. |
| Status changes | Request | The server must validate status transitions follow the state machine. Never accept arbitrary status values. |

### 8.2 Security Boundary Definitions

**Customer data:**
- RLS enforced at database level.
- Edge functions validate JWT + org membership before returning data.
- Frontend never receives data outside the user's org.

**Financial data:**
- Pro-rata calculations performed server-side (edge function or database function).
- Payment amounts validated server-side.
- Transaction status transitions validated server-side.
- Gateway transactions created by edge functions only — frontend cannot insert directly.

**Documents:**
- Upload via Supabase Storage with org-scoped paths.
- Signed URLs with 15-minute expiry for access.
- Document review status changes validated server-side (only advisor/compliance officer can approve/reject).

**Communications:**
- Messages sent via edge functions (which call external providers).
- Frontend cannot directly send email/SMS — must go through edge function.
- Agent ID set from JWT, not from request body.
- Message status managed by edge function, not frontend.

**Calls:**
- Call initiation via StormCall API (edge function proxy).
- Recording access via signed URLs only.
- Call metadata stored in `dv_communications` by edge function.

**Transcripts:**
- Transcript access via StormCall API only.
- Frontend never has direct database access to transcript tables.

**Credentials:**
- User passwords: Supabase Auth manages — never stored in DebtVerge tables.
- Gateway API keys: stored as Supabase Edge Function secrets (`secret_ref` in `dv_gateway_configs`). Never in the database. Never in frontend code.
- Service-to-service tokens: stored as Supabase Edge Function secrets. Used for cross-app API calls.

**Tokens:**
- Payment method tokens: stored in `dv_payment_methods.gateway_token`. These are gateway-specific tokens (e.g. Stripe customer/card IDs), not raw card data.
- JWT tokens: managed by Supabase Auth, stored in browser session. Short-lived. Auto-refreshed.

**API keys:**
- All external API keys (Stripe, GoCardless, Twilio, SMTP) stored as Supabase Edge Function secrets.
- Never in `.env` files committed to git.
- Never in frontend code.
- Never in database columns.

**Audit records:**
- Audit tables are INSERT-only at the RLS level.
- Frontend has SELECT access (for compliance officers) but no UPDATE/DELETE.
- Audit INSERT performed by edge functions or database triggers, not frontend direct inserts.

### 8.3 Edge Function Security Requirements

Every edge function must:
1. Validate JWT token from Authorization header (except webhook receivers which use webhook secrets).
2. Extract `auth.uid()` from JWT.
3. Validate org membership for the requested `organization_id`.
4. Validate input payload (types, ranges, required fields).
5. Use service role key for database operations (bypass RLS) — but only after steps 1-3 pass.
6. Log the API call in `dv_external_api_calls` (for external API calls).
7. Return appropriate HTTP status codes (401 unauth, 403 forbidden, 400 bad request, 404 not found, 200/201 success).
8. Include CORS headers on all responses.

---

## Section 9 — Application Structure

### 9.1 Recommended Project Structure

```
debtverge-standalone/
├── package.json
├── vite.config.ts
├── tsconfig.json
├── tailwind.config.js
├── postcss.config.js
├── index.html
├── .env                          (Supabase URL, anon key, service role key — NOT committed)
├── .env.example                  (Template — committed)
├── .gitignore
│
├── src/                          (Frontend)
│   ├── main.tsx                  (Entry point)
│   ├── App.tsx                   (Root component: auth gate → workspace)
│   ├── index.css                 (Tailwind directives + global styles)
│   ├── vite-env.d.ts
│   │
│   ├── lib/                      (Business logic & hooks)
│   │   ├── supabase.ts           (Supabase client)
│   │   ├── auth.tsx              (Auth context: login, logout, session, user)
│   │   ├── types.ts              (TypeScript types for all entities)
│   │   ├── format.ts             (Currency, date, percentage formatters)
│   │   ├── case-hooks.ts         (Case CRUD, creditors, SFS, distributions)
│   │   ├── case-context.tsx      (Aggregated case context provider)
│   │   ├── payment-hooks.ts      (Gateway, schedules, transactions)
│   │   ├── cashier-hooks.ts      (Bank feeds, batches, disbursements, ledger)
│   │   ├── compliance-hooks.ts   (Scripts, attestations, vulnerability, consent, AML, DPA)
│   │   ├── comms-hooks.ts        (Communications, threads, templates)
│   │   ├── insolvency-hooks.ts   (IVA, IP, votes, PoD, contributions, distributions)
│   │   ├── insolvency-docs.ts    (Proposal pack, Chairs Report, offer letter, Pathfinder)
│   │   ├── provisioning.ts       (Tenant signup wizard logic)
│   │   ├── gateway-adapters.ts   (Payment gateway adapter interface)
│   │   ├── rbac-hooks.ts         (Roles, permissions, module metadata)
│   │   ├── org-hooks.ts          (Organisation management — local, not shared)
│   │   ├── uk-tax.ts             (UK tax/NI calculations)
│   │   ├── queue-hooks.ts        (Background job monitoring)
│   │   ├── handover-hooks.ts     (Inbound/outbound handover records)
│   │   └── audit-hooks.ts        (Audit log queries for compliance officers)
│   │
│   ├── components/               (UI components)
│   │   ├── Login.tsx
│   │   ├── SignupWizard.tsx      (5-step tenant signup)
│   │   ├── DebtVergeApp.tsx      (Main workspace shell: top bar + sidebar + tabs)
│   │   ├── Dashboard.tsx
│   │   ├── CustomerProfile.tsx
│   │   ├── SfsIntake.tsx
│   │   ├── CreditorLedger.tsx
│   │   ├── PayoffForecast.tsx
│   │   ├── PlanComparison.tsx
│   │   ├── Disbursement.tsx
│   │   ├── PaymentSchedule.tsx
│   │   ├── PaymentGateway.tsx
│   │   ├── CashierOps.tsx        (6 sub-tabs)
│   │   ├── Vulnerability.tsx
│   │   ├── Compliance.tsx
│   │   ├── IVAInsolvency.tsx     (IP, proposal, voting, PoD, contributions, distributions)
│   │   ├── Pathfinder.tsx
│   │   ├── ProposalGenerator.tsx
│   │   ├── BreathingSpace.tsx
│   │   ├── AnnualReviews.tsx
│   │   ├── DebtorPortal.tsx
│   │   ├── comms/
│   │   │   ├── TeamInbox.tsx
│   │   │   ├── ThreadQueueSidebar.tsx
│   │   │   ├── ActiveThreadWorkspace.tsx
│   │   │   ├── DebtorContextSidebar.tsx
│   │   │   ├── ComplianceOverlay.tsx
│   │   │   └── shared.ts          (FCA templates, action cards, channel icons)
│   │   └── ui.tsx                 (Shared UI: Card, Badge, Button, Modal, Drawer, Toast)
│   │
│   └── __tests__/                 (Unit tests — Phase 11)
│
├── supabase/
│   ├── migrations/
│   │   ├── 001_core_schema.sql           (dv_cases, dv_creditors, dv_sfs_entries, dv_distributions, dv_audit_log + RLS)
│   │   ├── 002_payments_negotiation.sql  (dv_payments, dv_negotiations + RLS)
│   │   ├── 003_customer_profile.sql      (dv_customer_profiles, dv_previous_addresses + RLS)
│   │   ├── 004_vulnerability_benefits.sql (dv_vulnerability_assessments, dv_benefits_checks + RLS)
│   │   ├── 005_bank_transactions_reviews.sql (dv_bank_transactions, dv_annual_reviews + RLS)
│   │   ├── 006_tenant_provisioning.sql   (dv_tenants + RLS)
│   │   ├── 007_iva_insolvency.sql        (dv_ip_details, dv_document_checklist, dv_iva_proposals, dv_creditor_votes, dv_proof_of_debt + RLS)
│   │   ├── 008_signposting_contributions.sql (dv_signposting_assessments, dv_iva_contributions, dv_iva_distribution_runs, dv_iva_distribution_items + RLS)
│   │   ├── 009_communications.sql        (dv_communications, dv_unassigned_messages + RLS)
│   │   ├── 010_compliance.sql            (dv_compliance_attestations, dv_vulnerability_flags + RLS)
│   │   ├── 011_payment_schedule.sql      (dv_payment_transactions + RLS, dv_cases columns)
│   │   ├── 012_breathing_space.sql       (dv_breathing_spaces + RLS)
│   │   ├── 013_payment_gateway.sql       (dv_gateway_configs, dv_payment_methods, dv_recurring_schedules, dv_gateway_transactions, dv_waterfall_entries, dv_reconciliation_log + RLS)
│   │   ├── 014_cashier_operations.sql    (dv_bank_feeds, dv_cashier_transactions, dv_batch_runs, dv_batch_items, dv_cashier_audit_logs, dv_ledger_locks, dv_disbursement_runs, dv_disbursement_items, dv_payment_links + RLS)
│   │   ├── 015_background_jobs.sql       (dv_background_jobs + RLS)
│   │   ├── 016_handover_api.sql          (dv_handover_records + RLS)
│   │   ├── 017_compliance_extensions.sql (dv_consent_records, dv_aml_assessments, dv_dpa_register, dv_field_change_audit, dv_external_api_calls + RLS)
│   │   ├── 018_document_versions.sql     (dv_document_versions + RLS)
│   │   └── 019_org_management.sql        (dv_organizations, dv_organization_users, dv_roles, dv_role_permissions, dv_profiles + RLS — if standalone, not using shared platform tables)
│   │
│   └── functions/
│       ├── provision-tenant/             (Tenant onboarding)
│       ├── payment-gateway/              (REAL Stripe/GoCardless integration)
│       ├── recurring-collection/         (Automated recurring payments)
│       ├── batch-processing/             (Batch payment processing)
│       ├── disbursement-run/             (Disbursement file generation)
│       ├── queue-worker/                 (Background job worker)
│       ├── handover-receive/             (Receive from LeadVerge/Qualify)
│       ├── handover-send/                (Send to IVA Verge/Draft Verge)
│       ├── external-event/               (Webhook receiver for StormCall/StormSign/IVA Verge callbacks)
│       ├── send-email/                   (SMTP integration)
│       ├── send-sms/                     (Twilio integration)
│       └── open-banking-webhook/         (Open Banking provider callback receiver)
│
├── supabase/                  (Edge function secrets — configured via Supabase dashboard or CLI)
│   └── .env                  (STRIPE_SECRET_KEY, GC_SECRET_KEY, TWILIO_AUTH_TOKEN, SMTP_API_KEY, etc.)
│
└── README.md
```

### 9.2 Layer Definitions

**Frontend:**
- Vite + React + TypeScript + Tailwind CSS (dark mode)
- lucide-react for icons
- @/ path alias → src/
- No direct database access outside of Supabase client with RLS

**Backend:**
- Supabase Edge Functions (Deno runtime)
- All edge functions validate JWT + org membership
- Service role key used only after auth validation

**Database:**
- Supabase Postgres
- 51 tables with `dv_` prefix
- RLS on every table
- 7 INSERT-only audit tables
- Triggers for `updated_at` and field-level change tracking

**Authentication:**
- Supabase Auth (email/password)
- No social providers
- Email confirmation OFF
- Session management by Supabase (JWT with auto-refresh)

**Authorisation:**
- RBAC: roles → permissions → module access
- RLS: org-scoped with super-admin bypass
- Dual-gate: license + role permission (client-side check; server-side RLS is the real enforcement)

**API Layer:**
- Edge functions for all server-side operations
- RESTful pattern: POST with JSON body, action field or query param
- CORS headers on all responses
- No direct database access from frontend outside Supabase client

**Integration Layer:**
- Edge function adapters for external services (Stripe, GoCardless, Twilio, SMTP)
- Webhook receivers for external callbacks
- Handover API for cross-app communication
- All external calls logged in `dv_external_api_calls`

**Background Jobs:**
- `dv_background_jobs` table (queue)
- `queue-worker` edge function (SKIP LOCKED pattern)
- 7 job types: batch_collection, disbursement_run, bank_reconciliation, recurring_collection, retry_failed, expired_card_check, ledger_posting
- Cron-triggered (external scheduler or Supabase scheduled function)

**Event/Outbox Layer:**
- `dv_handover_records` with status: pending → accepted/rejected
- Outbound handovers queued in `dv_handover_records` and processed by `queue-worker`
- Inbound webhooks received by `external-event` edge function

**Audit Layer:**
- `dv_audit_log` — case milestones
- `dv_cashier_audit_logs` — cashier operations
- `dv_compliance_attestations` — FCA disclaimers
- `dv_field_change_audit` — field-level changes
- `dv_external_api_calls` — external API interactions
- All INSERT-only (no UPDATE/DELETE)

**File/Document Integration:**
- Supabase Storage bucket: `dv-documents`
- Path: `{organization_id}/{case_id}/{document_type}/{filename}`
- Storage RLS: org membership check
- Signed URLs with 15-minute expiry
- `dv_document_checklist` for metadata
- `dv_document_versions` for version history

**Configuration:**
- `.env` for local development (Supabase URL, anon key, service role key)
- Supabase Edge Function secrets for production (Stripe key, Twilio token, etc.)
- No secrets in frontend code
- No secrets in database columns

**Secrets:**
- `SUPABASE_URL` — Supabase project URL
- `SUPABASE_ANON_KEY` — public anon key (safe for frontend)
- `SUPABASE_SERVICE_ROLE_KEY` — service role key (edge functions only, never frontend)
- `STRIPE_SECRET_KEY` — Stripe API key (edge function secret)
- `GC_SECRET_KEY` — GoCardless API key (edge function secret)
- `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` — Twilio credentials (edge function secret)
- `SMTP_API_KEY` — SMTP provider key (edge function secret)
- `DV_HANDOVER_TOKEN` — service-to-service token for cross-app handovers (edge function secret)

---

## Section 10 — Data Flow Diagrams

### A. Lead → Qualify → DebtVerge

```
┌──────────┐     ┌──────────┐     ┌──────────┐
│LeadVerge │     │ Qualify  │     │ DebtVerge│
│          │     │          │     │          │
│ Lead     │     │ Qualify  │     │ Case     │
│ created  │────▶│ lead     │────▶│ created  │
│          │     │          │     │          │
│ LV-2026  │     │ QUAL-2026│     │ DV-2026  │
│ -0001    │     │ -0001    │     │ -0001    │
└──────────┘     └──────────┘     └──────────┘
      │                │                │
      │   handover     │   handover     │
      │   payload      │   payload      │
      │   (customer,   │   (customer,   │
      │    debt sum)   │    SFS,        │
      │                │    creditors,  │
      │                │    qualification│
      │                │    result)     │
      ▼                ▼                ▼
┌─────────────────────────────────────────────┐
│         dv_handover_records                 │
│  source_app: leadverge / qualify            │
│  source_reference: LV-2026-0001             │
│  payload_snapshot: { full handover data }   │
│  status: accepted                           │
└─────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────┐
│         dv_cases (created)                  │
│  case_number: DV-2026-0001                  │
│  status: intake                             │
│  organization_id: <target org>              │
└─────────────────────────────────────────────┘
                     │
        ┌────────────┼────────────┐
        ▼            ▼            ▼
┌──────────┐ ┌──────────┐ ┌──────────┐
│dv_customer│ │dv_sfs_   │ │dv_creditors│
│_profiles  │ │entries   │ │           │
│(created)  │ │(imported)│ │(imported) │
└──────────┘ └──────────┘ └──────────┘
```

### B. DebtVerge → IVA Verge

```
┌──────────┐                               ┌──────────┐
│DebtVerge │                               │IVA Verge │
│          │                               │          │
│ Case     │   POST /functions/v1/         │ Case     │
│ DV-2026  │   ivaverge-handover-receive   │ IV-2026  │
│ -0001    │──────────────────────────────▶│ -0001    │
│ status:  │                               │ status:  │
│ sfs_     │   payload: {                  │ proposal │
│ approved │     case_snapshot,            │ _drafting│
│          │     customer_profile,         │          │
│          │     sfs_entries,              │          │
│          │     creditors,                │          │
│          │     vulnerability,            │          │
│          │     compliance,               │          │
│          │     documents,                │          │
│          │     pathfinder_result,        │          │
│          │     suitability_matrix,       │          │
│          │     consent                   │          │
│          │   }                           │          │
│          │                               │          │
│          │◀──────────────────────────────│          │
│          │   { accepted: true,           │          │
│          │     iva_verge_case_id: uuid,  │          │
│          │     iva_verge_case_number:    │          │
│          │       "IV-2026-0001" }        │          │
│          │                               │          │
│ status → │                               │          │
│ handed_  │                               │          │
│ over     │                               │          │
│          │                               │          │
│ handed_  │                               │          │
│ over_    │                               │          │
│ to_case_ │                               │ stage    │
│ id: uuid │                               │ updates  │
│          │◀──────────────────────────────│ via      │
│          │   webhook: stage_changed      │ webhook  │
│          │   { stage: "meeting_of_       │          │
│          │     creditors" }              │          │
└──────────┘                               └──────────┘

Audit:
  DebtVerge: dv_handover_records (accepted)
             dv_audit_log ("Case handed over to IVA Verge")
  IVA Verge:  iv_handover_records (received from DebtVerge)
             iv_audit_log ("Case received from DebtVerge")
```

### C. DebtVerge → StormCall

```
┌──────────┐                               ┌──────────┐
│DebtVerge │                               │StormCall │
│          │                               │          │
│ Advisor  │   POST /functions/v1/         │ VoIP     │
│ clicks   │   stormcall-initiate          │ call     │
│ "Start   │──────────────────────────────▶│ initiated│
│ VoIP"    │   { case_id, debtor_phone,    │          │
│          │     advisor_id }              │          │
│          │                               │          │
│          │◀──────────────────────────────│          │
│          │   { call_id, status }         │          │
│          │                               │          │
│ dv_comm  │                               │ recording│
│ _ications│                               │ created  │
│ INSERT   │                               │          │
│ [VOIP]   │                               │          │
│ call_id  │                               │          │
│          │                               │          │
│          │◀──────────────────────────────│          │
│          │   webhook: call_completed     │          │
│          │   { call_id, duration,        │          │
│          │     recording_url,            │          │
│          │     transcript_url,           │          │
│          │     compliance_status }       │          │
│          │                               │          │
│ dv_comm  │                               │          │
│ _ications│                               │          │
│ UPDATE   │                               │          │
│ (recording│                              │          │
│  url)    │                               │          │
│          │                               │          │
│ dv_audit │                               │          │
│ _log     │                               │          │
│ INSERT   │                               │          │
│ dv_ext   │                               │          │
│ _api_    │                               │          │
│ calls    │                               │          │
│ INSERT   │                               │          │
└──────────┘                               └──────────┘
```

### D. DebtVerge → StormSign

```
┌──────────┐                               ┌──────────┐
│DebtVerge │                               │StormSign │
│          │                               │          │
│ Advisor  │   POST /functions/v1/         │ Envelope │
│ sends    │   stormsign-send              │ created  │
│ doc for  │──────────────────────────────▶│          │
│ signing  │   { case_id, document,        │          │
│          │     signers }                 │          │
│          │                               │          │
│          │◀──────────────────────────────│          │
│          │   { envelope_id, status:      │          │
│          │     "sent" }                  │          │
│          │                               │          │
│ dv_audit │                               │ signing  │
│ _log     │                               │ events   │
│ INSERT   │                               │          │
│          │                               │          │
│          │◀──────────────────────────────│          │
│          │   webhook: document_signed    │          │
│          │   { envelope_id, status:      │          │
│          │     "completed",              │          │
│          │     signed_document_url }     │          │
│          │                               │          │
│ dv_doc_  │                               │          │
│ checklist│                               │          │
│ UPDATE   │                               │          │
│ (signed  │                               │          │
│  url)    │                               │          │
│          │                               │          │
│ dv_audit │                               │          │
│ _log     │                               │          │
│ INSERT   │                               │          │
└──────────┘                               └──────────┘
```

### E. DebtVerge → StormDrive

```
┌──────────┐                               ┌──────────┐
│DebtVerge │                               │StormDrive│
│          │                               │          │
│ Advisor  │   GET /functions/v1/          │ File     │
│ previews │   stormdrive-file?file_id=    │ retrieved│
│ doc      │──────────────────────────────▶│          │
│          │                               │          │
│          │◀──────────────────────────────│          │
│          │   { file_url, filename,       │          │
│          │     content_type }            │          │
│          │                               │          │
│ dv_ext   │                               │          │
│ _api_    │                               │          │
│ calls    │                               │          │
│ INSERT   │                               │          │
│          │                               │          │
│ (document│                               │          │
│  shown in│                               │          │
│  browser │                               │          │
│  via     │                               │          │
│  signed  │                               │          │
│  URL)    │                               │          │
└──────────┘                               └──────────┘

Note: DebtVerge uses Supabase Storage as primary document store.
StormDrive integration is optional for cross-platform sharing only.
```

### F. DebtVerge → Storm ID

```
┌──────────┐                               ┌──────────┐
│DebtVerge │                               │Storm ID  │
│          │                               │          │
│ User     │   GET /functions/v1/          │ User     │
│ logs in  │   stormid-user?user_id=       │ identity │
│          │──────────────────────────────▶│ returned │
│          │                               │          │
│          │◀──────────────────────────────│          │
│          │   { user_id, email,           │          │
│          │     organizations, roles }    │          │
│          │                               │          │
│ dv_org_  │                               │          │
│ users    │                               │          │
│ (synced  │                               │          │
│  locally)│                               │          │
│          │                               │          │
│ If Storm ID unavailable:                 │          │
│   Fall back to local dv_organization_users│         │
│   Auth via Supabase Auth directly        │          │
└──────────┘                               └──────────┘

Note: DebtVerge must function WITHOUT Storm ID.
Supabase Auth + local org management is the baseline.
```

### G. DebtVerge → Open Banking

```
┌──────────┐                               ┌──────────┐
│DebtVerge │                               │Open Bank │
│          │                               │Provider  │
│          │                               │(TrueLayer│
│          │                               │ / Plaid) │
│ Advisor  │   POST /functions/v1/         │          │
│ connects │   dv-open-banking-connect     │ Bank     │
│ bank     │──────────────────────────────▶│ consent  │
│ feed     │   { case_id, bank_reference } │ flow     │
│          │                               │          │
│          │                               │ User     │
│          │                               │ authenticates│
│          │                               │ with bank │
│          │                               │          │
│          │◀──────────────────────────────│          │
│          │   { consent_id, status:       │          │
│          │     "connected" }             │          │
│          │                               │          │
│          │                               │          │
│          │◀──────────────────────────────│          │
│          │   webhook: transactions_ready │          │
│          │   { case_id, transactions[] } │          │
│          │                               │          │
│ dv_bank_ │                               │          │
│ _transac │                               │          │
│ _tions   │                               │          │
│ INSERT   │                               │          │
│ (auto-   │                               │          │
│  catego- │                               │          │
│  rized)  │                               │          │
│          │                               │          │
│ dv_audit │                               │          │
│ _log     │                               │          │
│ dv_ext   │                               │          │
│ _api_    │                               │          │
│ calls    │                               │          │
└──────────┘                               └──────────┘

Fallback: CSV import if Open Banking provider unavailable.
```

### H. DebtVerge → Credit Search

```
┌──────────┐                               ┌──────────┐
│DebtVerge │                               │Credit    │
│          │                               │Reference │
│          │                               │Agency    │
│          │                               │(Experian │
│          │                               │/Equifax) │
│ Advisor  │   POST /functions/v1/         │          │
│ requests │   dv-credit-search            │ Credit   │
│ credit   │──────────────────────────────▶│ search   │
│ search   │   { case_id, customer }       │ performed│
│          │                               │          │
│          │◀──────────────────────────────│          │
│          │   { search_id, creditors[],   │          │
│          │     total_debt }              │          │
│          │                               │          │
│ dv_cred  │                               │          │
│ _itors   │                               │          │
│ INSERT   │                               │          │
│ (imported│                               │          │
│  from    │                               │          │
│  search) │                               │          │
│          │                               │          │
│ dv_audit │                               │          │
│ _log     │                               │          │
│ dv_ext   │                               │          │
│ _api_    │                               │          │
│ calls    │                               │          │
│          │                               │          │
│ Fallback: Manual creditor entry if       │          │
│ credit search unavailable.               │          │
└──────────┘                               └──────────┘
```

---

## Section 11 — Standalone Principle

### 11.1 Core Requirements

The standalone DebtVerge must be capable of operating completely independently. The following capabilities must work WITHOUT any other Storm application running:

| Capability | Standalone Implementation | External Dependency |
|-----------|--------------------------|-------------------|
| Logging in | Supabase Auth (email/password) | None — Supabase is the platform |
| Managing organisations | `dv_organizations` table (local) | None |
| Managing users | `dv_organization_users` + Supabase Auth | None |
| Managing customers | `dv_customer_profiles` | None |
| Managing cases | `dv_cases` + all child tables | None |
| Managing debts | `dv_creditors` + pro-rata engine | None |
| Managing creditors | `dv_creditors` | None |
| Managing income/expenditure | `dv_sfs_entries` | None |
| Managing SFS | `dv_sfs_entries` + calculation engine | None |
| Managing documents | Supabase Storage + `dv_document_checklist` | None — Supabase Storage is the platform |
| Managing communications | `dv_communications` + edge functions | External providers (Twilio, SMTP) for delivery — but messages can be composed and stored even if delivery fails |
| Managing compliance | `dv_compliance_attestations` + scripts | None |
| Maintaining audit trails | `dv_audit_log` + all audit tables | None |

### 11.2 Degradation Behavior

| External System | If Unavailable | DebtVerge Behavior |
|----------------|---------------|-------------------|
| LeadVerge | No new leads from LeadVerge | Advisor can create cases manually. All other functionality works. |
| Qualify | No qualified clients from Qualify | Advisor can create cases manually. All other functionality works. |
| IVA Verge | Cannot hand over IVA cases | Cases remain in DebtVerge with IVA tabs fully functional. Advisor manages IVA process within DebtVerge. |
| Draft Verge | Cannot hand over Draft cases | Same as IVA Verge — cases remain in DebtVerge. |
| StormCall | No VoIP calls, no call compliance | Communications tab works without VoIP. Call initiation button shows "StormCall unavailable." All other functionality works. |
| StormSign | Cannot send documents for e-signing | Documents can be uploaded, reviewed, and downloaded. E-signing button shows "StormSign unavailable." |
| StormDrive | No cross-platform document sharing | Supabase Storage is the primary store. StormDrive is optional. |
| Storm ID | No cross-app SSO | Supabase Auth handles authentication locally. |
| Knowledge Assistant | No AI guidance | Drawer shows "Knowledge Assistant unavailable." |
| Stripe / GoCardless | No payment processing | Payment gateway tab shows "Gateway unavailable." Payment logging (manual) still works. Recurring collection edge function records failures. |
| Twilio | No SMS sending | SMS channel shows "SMS delivery unavailable." Email and internal notes work. |
| SMTP provider | No email sending | Email channel shows "Email delivery unavailable." SMS and internal notes work. |
| Open Banking provider | No bank feed import | CSV import works as fallback. |
| Credit search provider | No credit search | Manual creditor entry works. |

### 11.3 Key Principle

**External Storm applications enhance DebtVerge through APIs rather than make the core application unusable.**

The architecture is designed so that:
1. Core case management, SFS, creditors, payments, compliance, and audit are ALWAYS available.
2. External integrations are layered on top and can fail without blocking core operations.
3. The application degrades gracefully with clear error messages.
4. No external dependency is required for the application to start, authenticate, or manage cases.

---

## Section 12 — Remove Prototype Coupling

### 12.1 Hard-Coded Assumptions

| Existing Coupling | Location | Replacement |
|------------------|----------|-------------|
| `generateCaseNumber()` hardcodes year 2026 | `DebtVerge.tsx` | Use `new Date().getFullYear()` and query for next sequential number |
| `householdSize` hardcoded to 2 | `TeamInbox.tsx` | Load from `dv_customer_profiles` |
| `debtorPhone` hardcoded to null | `TeamInbox.tsx` | Load from `dv_customer_profiles.mobile_phone` |
| SFS quick-adjust income default 2150 | `DebtorContextSidebar.tsx` | Load from `dv_sfs_entries` (income category sum) |
| Debtor portal fact-find steps 0-3 hardcoded complete | `DebtorSelfServicePortal.tsx` | Track actual completion state in a `dv_portal_progress` table or case metadata |
| `IVADemoCases` with 4 fake cases | `DebtVerge.tsx` | Remove entirely or gate behind `DEMO_MODE` env flag |

### 12.2 Mock Integrations

| Existing Mock | Location | Replacement |
|--------------|----------|-------------|
| Payment gateway returns fake tokens/transactions | `supabase/functions/payment-gateway/index.ts` | Real Stripe/GoCardless API integration via edge function |
| BACS file generation is "simplified" | `supabase/functions/disbursement-run/index.ts` | Production BACS Standard 18 format (AABB Standard 22 for Bacs Direct Debit, AUDDIS, ACS) |
| Open Banking is CSV import only | Frontend only | TrueLayer/Plaid API integration via edge function |
| "Play recording" button has no onClick | `ActiveThreadWorkspace.tsx` | StormCall API integration — signed URL for recording playback |
| "Re-assignment panel coming soon" toast | `TeamInbox.tsx` | Full reassignment UI with advisor dropdown |
| Action card "[Secure Portal Link]" placeholder | `ActiveThreadWorkspace.tsx` | Generate real secure portal links with tokenised URLs |
| VoIP call logging as internal notes with `[VOIP]` prefix | `comms-hooks.ts` | StormCall API integration — structured call metadata |
| `Math.random() > 0.05` for 95% payment success | `payment-gateway/index.ts` | Real gateway response — success/failure from provider |

### 12.3 Shared Database Assumptions

| Existing Coupling | Location | Replacement |
|------------------|----------|-------------|
| DebtVerge reads from shared `organizations` table | `workspace-hooks.ts` | Standalone: create `dv_organizations` table. If shared platform available, sync via API. |
| DebtVerge reads from shared `organization_users` | `workspace-hooks.ts`, `rbac-hooks.ts` | Standalone: create `dv_organization_users` table. |
| DebtVerge reads from shared `profiles` table | `rbac-hooks.ts`, `is_super_admin()` | Standalone: create `dv_profiles` table. `is_super_admin()` reads from `dv_profiles`. |
| DebtVerge reads from shared `rbac_*` tables | `rbac-hooks.ts` | Standalone: create `dv_roles`, `dv_role_permissions` tables. |
| DebtVerge reads from shared `packages`/`catalog_items`/`organization_licenses` | `entitlement-hooks.ts` | Standalone: create `dv_licenses` table. Or simplify to org-level feature flags. |
| Cross-app transfer via shared frontend components | `DebtVerge.tsx`, `IVAVerge.tsx`, `DraftVerge.tsx` | API handover via `dv-handover-send` edge function. Remove shared frontend switching. |

### 12.4 Prototype Authentication

| Existing Coupling | Location | Replacement |
|------------------|----------|-------------|
| Edge functions use service role key with no per-request auth | All edge functions | JWT validation + org membership check on every edge function |
| `api-inbound` accepts requests with no auth if webhook secret absent | `api-inbound/index.ts` | Require webhook secret always. Reject unauthenticated requests. |
| No MFA | Auth context | Add TOTP-based MFA via Supabase Auth MFA enroller |
| No password reset flow in DebtVerge code | Auth context | Use Supabase Auth `resetPasswordForEmail()` |

### 12.5 Direct Cross-Application Database Access

| Existing Coupling | Location | Replacement |
|------------------|----------|-------------|
| DebtVerge shares database with all Storm apps | Single Supabase project | Standalone: separate Supabase project OR separate schema with `dv_` prefix. No cross-app table reads. |
| `storm_call_compliance_audit` table read from DebtVerge | `compliance-hooks.ts` | API call to StormCall compliance endpoint |
| `sv_mailboxes` / `sv_threads` / `sv_messages` read from DebtVerge | `mail-inbox-hooks.ts` | DebtVerge uses its own `dv_communications` table. No reads from StormVerge Mail tables. |

### 12.6 Fake API Responses

| Existing Fake | Location | Replacement |
|--------------|----------|-------------|
| `payment-gateway` returns `tok_stripe_{uuid}` | `payment-gateway/index.ts` | Real Stripe `PaymentIntent` creation |
| `payment-gateway` returns `pi_stripe_{uuid}` | `payment-gateway/index.ts` | Real Stripe `PaymentIntent` ID |
| `payment-gateway` returns `re_stripe_{uuid}` | `payment-gateway/index.ts` | Real Stripe `Refund` ID |
| `payment-gateway` returns `{deleted: true}` for delete_token | `payment-gateway/index.ts` | Real Stripe customer/source deletion |
| `payment-gateway` returns `{connected: true}` for verify | `payment-gateway/index.ts` | Real Stripe account verification |

### 12.7 Development-Only Shortcuts

| Existing Shortcut | Location | Replacement |
|------------------|----------|-------------|
| `prompt()` for attachment filenames | `ActiveThreadWorkspace.tsx`, `DebtorSelfServicePortal.tsx` | Real file upload via Supabase Storage with `<input type="file">` |
| Demo cases with fake client data | `DebtVerge.tsx` | Remove or gate behind `import.meta.env.DEV` |
| Hardcoded SFS thresholds | `SfsIntake.tsx` | Load from configuration table or compute from household composition |

### 12.8 UI Dependencies

| Existing Coupling | Location | Replacement |
|------------------|----------|-------------|
| Shared frontend workspace (`App.tsx`) switches between DebtVerge/IVAVerge/DraftVerge/Qualify | `App.tsx` | Standalone: `App.tsx` only renders DebtVerge. No cross-app frontend switching. |
| `AppLauncher` component shows all Storm apps | `AppLauncher.tsx` | Standalone: remove `AppLauncher` or show only DebtVerge. Cross-app navigation via external URLs. |
| Shared `Header` component with all app icons | `Header.tsx` | Standalone: DebtVerge-specific header with only DebtVerge branding. |
| Shared `CopilotDrawer` (Knowledge Assistant) | `CopilotDrawer.tsx` | Optional integration via API. Drawer shows "Knowledge Assistant unavailable" if not configured. |
| Shared `AdminHub` for platform administration | `AdminHub.tsx` | Standalone: DebtVerge-specific admin panel for tenant management. |

### 12.9 Test Data

| Existing Test Data | Location | Replacement |
|-------------------|----------|-------------|
| `IVADemoCases` (4 fake cases) | `DebtVerge.tsx` | Remove from production. Provide as seed data only in dev environment via migration with `INSERT ... WHERE current_setting('app.demo_mode') = 'true'` |
| Demo organisations and users | Various | Remove. Real tenants created via signup wizard only. |
| Stormtalk seed data | `stormtalk-seed` edge function | Not relevant to DebtVerge. Do not copy. |
| Knowledge seed data | `knowledge-seed` edge function | Not relevant to DebtVerge. Do not copy. |

---

## Section 13 — Build Order

### PHASE 1 — Foundation

**Dependencies:** None.

**Deliverables:**
- Vite + React + TypeScript project initialised
- Tailwind CSS configured with dark mode
- Supabase client configured
- `.env` and `.env.example` created
- Project structure created (directories, empty files)

**Acceptance Criteria:**
- `npm run dev` starts the dev server
- `npm run build` completes without errors
- Supabase client connects to the project

### PHASE 2 — Authentication and Tenancy

**Dependencies:** Phase 1.

**Deliverables:**
- Auth context (login, logout, session management)
- Login screen
- `dv_organizations`, `dv_organization_users`, `dv_profiles`, `dv_roles`, `dv_role_permissions` tables with RLS
- `is_super_admin()` function
- `dv_tenants` table
- 5-step tenant signup wizard UI
- `provision-tenant` edge function
- RBAC hooks (roles, permissions, org membership)

**Acceptance Criteria:**
- User can sign up as a new debt management firm
- User can log in with email/password
- Tenant provisioning creates org, user, role, and membership
- RLS prevents cross-org access
- Super admin can see all orgs

### PHASE 3 — Customer/Case Core

**Dependencies:** Phase 2.

**Deliverables:**
- `dv_cases` table with RLS (`organization_id NOT NULL`)
- `dv_customer_profiles` table with RLS
- `dv_previous_addresses` table with RLS
- `dv_audit_log` table (INSERT-only RLS)
- Case list view (searchable, filterable)
- New case modal (auto-generated case number)
- Customer profile tab
- Case context provider (aggregated case data)

**Acceptance Criteria:**
- Advisor can create a new case with auto-generated case number
- Advisor can view and edit customer profile
- Case list shows only cases in the advisor's org
- All case creation and status changes are logged in `dv_audit_log`
- Case number format: `DV-{current_year}-{sequential}`

### PHASE 4 — Financial/SFS Engine

**Dependencies:** Phase 3.

**Deliverables:**
- `dv_sfs_entries` table with RLS
- SFS intake tab (income, essential expenses, discretionary expenses, debt repayments)
- Disposable income calculation (automatic)
- SFS allowance thresholds (computed from household composition)
- Pro-rata distribution preview
- `dv_field_change_audit` table (INSERT-only) + database triggers for critical field changes
- UK tax calculation module (`uk-tax.ts`)

**Acceptance Criteria:**
- Advisor can add/edit/delete SFS entries in 4 categories
- Disposable income updates automatically when entries change
- SFS allowance thresholds display correctly based on household composition
- Pro-rata distribution preview shows correct creditor splits
- Changes to `dv_cases.total_debt` and `monthly_disposable_income` are tracked in `dv_field_change_audit`

### PHASE 5 — Creditors/Debts

**Dependencies:** Phase 4.

**Deliverables:**
- `dv_creditors` table with RLS
- `dv_distributions` table with RLS
- `dv_negotiations` table with RLS
- Creditor ledger tab (add/edit/delete creditors)
- Pro-rata calculation engine (priority creditors first, remainder pro-rata by balance)
- Negotiation timeline per creditor
- Offer letter generation (full UK DMP offer letter text)
- Payoff forecast tab (DMP amortization, settlement projection)
- Plan comparison tab (DMP vs IVA vs DRO vs Settlement vs Bankruptcy)
- Pathfinder engine (automated solution routing)
- Solution suitability matrix modal

**Acceptance Criteria:**
- Advisor can add creditors with debt types, balances, interest rates
- Pro-rata amounts calculate correctly (priority first, then pro-rata)
- Negotiation events display on creditor timeline
- Offer letter generates with correct SFS breakdown and creditor details
- Pathfinder recommends a route based on case data
- Solution suitability matrix scores all 5 solutions

### PHASE 6 — Documents/Compliance

**Dependencies:** Phase 3, Phase 5.

**Deliverables:**
- `dv_document_checklist` table with RLS
- `dv_document_versions` table with RLS (NEW)
- `dv_compliance_attestations` table (INSERT-only RLS)
- `dv_vulnerability_flags` table with RLS
- `dv_vulnerability_assessments` table with RLS
- `dv_benefits_checks` table with RLS
- `dv_consent_records` table (INSERT-only RLS) (NEW)
- `dv_aml_assessments` table with RLS (NEW)
- `dv_dpa_register` table with RLS (NEW)
- Supabase Storage bucket `dv-documents` with org-scoped path and storage RLS
- Document upload (real file upload via `<input type="file">` + Supabase Storage)
- Document preview (in-browser viewer)
- Document verification workflow (pending → approved/rejected)
- Vulnerability assessment tab (16-item checklist, score/level)
- Benefits checking (12 UK benefit types)
- Compliance scripting overlay (6 script types, mandatory disclaimers, attestation)
- Objection/FAQ database (12 pre-approved responses)
- FCA vulnerability flagging modal

**Acceptance Criteria:**
- Advisor can upload documents via real file upload (not prompt())
- Documents are stored in org-scoped Supabase Storage paths
- Document preview works for PDFs and images
- Document review (approve/reject) records reviewer and timestamp
- Vulnerability assessment calculates correct score and level
- Compliance attestation creates immutable record
- Consent, AML, and DPA records can be created and tracked

### PHASE 7 — Communications

**Dependencies:** Phase 3, Phase 6.

**Deliverables:**
- `dv_communications` table with RLS
- `dv_unassigned_messages` table with RLS (`organization_id NOT NULL` — fixed)
- 3-column communications workspace (queue sidebar + thread workspace + context sidebar)
- FCA message templates (6 templates with variable substitution)
- Action cards (Open Banking consent, Payslip upload, Direct Debit instruction)
- SFS quick-adjust calculator in context sidebar
- Unassigned message triage
- Thread assignment and closure
- `send-email` edge function (SMTP integration)
- `send-sms` edge function (Twilio integration)
- Character limits (SMS 160, WhatsApp 4096) with multi-part SMS detection

**Acceptance Criteria:**
- Advisor can send email, SMS, WhatsApp, and internal notes
- FCA templates substitute variables correctly
- Unassigned messages are visible to agents (bug fixed)
- SFS quick-adjust updates disposable income in real-time
- SMS character counter shows correct multi-part count
- Email and SMS delivery uses real providers (not mock)

### PHASE 8 — Integrations

**Dependencies:** Phase 5, Phase 6.

**Deliverables:**
- `dv_payments` table with RLS
- `dv_payment_transactions` table with RLS
- `dv_gateway_configs` table with RLS
- `dv_payment_methods` table with RLS
- `dv_recurring_schedules` table with RLS
- `dv_gateway_transactions` table with RLS
- `dv_reconciliation_log` table with RLS
- `dv_waterfall_entries` table with RLS
- Payment logging with automatic distribution splits
- Payment schedule tab (frequency, preferred day, installment amount, transaction ledger)
- Payment gateway tab (configs, payment methods, schedules, transactions)
- `payment-gateway` edge function (REAL Stripe integration)
- `recurring-collection` edge function (process due, retry failed, detect expired)
- `dv_external_api_calls` table (INSERT-only RLS) (NEW)
- All external API calls logged in `dv_external_api_calls`

**Acceptance Criteria:**
- Advisor can log a payment and system auto-splits across creditors
- Payment schedule generates correct transaction sequence
- Payment gateway integrates with real Stripe (tokenise, charge, refund)
- Recurring collection processes due schedules automatically
- Failed payments are retried up to max_retries
- Expired cards are detected and schedules suspended
- All external API calls (Stripe, Twilio, SMTP) are logged in `dv_external_api_calls`

### PHASE 9 — External Storm Application Connections

**Dependencies:** Phase 3, Phase 7, Phase 8.

**Deliverables:**
- `dv_handover_records` table with RLS
- `dv_background_jobs` table with RLS
- `dv_batch_runs`, `dv_batch_items`, `dv_cashier_transactions`, `dv_bank_feeds`, `dv_cashier_audit_logs`, `dv_ledger_locks`, `dv_disbursement_runs`, `dv_disbursement_items`, `dv_payment_links` tables with RLS
- `dv_iva_proposals`, `dv_creditor_votes`, `dv_proof_of_debt`, `dv_ip_details`, `dv_iva_contributions`, `dv_iva_distribution_runs`, `dv_iva_distribution_items`, `dv_signposting_assessments`, `dv_breathing_spaces`, `dv_annual_reviews`, `dv_bank_transactions` tables with RLS
- IVA insolvency tabs (IP, proposals, voting, PoD, contributions, distributions)
- Breathing Space tab
- Annual Reviews tab
- Cashier Operations (6 sub-tabs: bank feeds, batch processing, exceptions, disbursement runs, audit trail, queue monitor)
- Pathfinder tab
- Proposal Generator tab
- `handover-receive` edge function
- `handover-send` edge function
- `external-event` edge function (webhook receiver)
- `batch-processing` edge function
- `disbursement-run` edge function (production BACS format)
- `queue-worker` edge function (7 job types)
- Debtor self-service portal

**Acceptance Criteria:**
- IVA insolvency tabs display and function correctly
- Breathing Space tracking works (standard and MH Crisis)
- Annual review snapshots capture correct SFS data
- Cashier operations: bank feeds, batch processing, disbursement runs all work
- BACS file generation produces production-standard format
- Background job queue processes all 7 job types
- Handover receive accepts payloads from LeadVerge/Qualify
- Handover send transfers cases to IVA Verge/Draft Verge
- Webhook receiver accepts callbacks from StormCall/StormSign/IVA Verge
- Debtor portal allows document upload and signposting self-assessment

### PHASE 10 — Security Hardening

**Dependencies:** All previous phases.

**Deliverables:**
- JWT validation on all edge functions
- Org membership validation on all edge functions
- Input validation on all edge function payloads (types, ranges, required fields)
- Rate limiting on edge functions (per-user, per-org)
- MFA support (TOTP via Supabase Auth MFA)
- Session timeout configuration
- Audit logging for data exports (CSV export)
- Data classification (sensitive data handling)
- Field-level change tracking triggers active for all critical fields
- All audit tables confirmed INSERT-only (no UPDATE/DELETE RLS policies)
- All `organization_id` columns confirmed NOT NULL
- Consistent `is_super_admin()` bypass across all tables
- Storage RLS confirmed org-scoped
- Real-time channels org-scoped

**Acceptance Criteria:**
- All edge functions reject unauthenticated requests (401)
- All edge functions reject cross-org requests (403)
- MFA enrollment and verification works
- Data exports are logged in `dv_audit_log`
- No audit table allows UPDATE or DELETE
- No table has nullable `organization_id`
- Security review passes (use `security-review` skill)

### PHASE 11 — Testing and Production Readiness

**Dependencies:** All previous phases.

**Deliverables:**
- Unit tests for calculation engines (pro-rata, Pathfinder, SFS, UK tax, amortization)
- Integration tests for edge functions (payment-gateway, recurring-collection, handover-receive, handover-send)
- End-to-end tests for critical user journeys (signup, case creation, SFS, payment logging, compliance attestation, handover)
- Error handling and error boundaries
- Loading states (skeletons)
- Empty states with guidance text
- Toast notifications for all actions
- Responsive design (mobile, tablet, desktop)
- Dark mode verified across all screens
- Accessibility audit (WCAG AA)
- Performance optimisation (code splitting, lazy loading for tabs)
- Production deployment configuration
- Monitoring and alerting setup
- Documentation (README, API docs)

**Acceptance Criteria:**
- All unit tests pass
- All integration tests pass
- All end-to-end tests pass
- `npm run build` completes without errors
- Lighthouse audit score > 90
- WCAG AA compliance verified
- No console errors in production build
- All acceptance criteria from `DEBTVERGE_STANDALONE_SPECIFICATION.md` Part 19 are met

---

## DEBTVERGE STANDALONE ARCHITECTURAL CONTRACT

The following rules are non-negotiable. Bolt must follow every rule when building the standalone DebtVerge application.

### Rule 1: Standalone Independence

DebtVerge must log in, manage organisations, manage users, manage customers, manage cases, manage debts, manage creditors, manage income/expenditure, manage SFS, manage documents, manage communications, manage compliance, and maintain audit trails WITHOUT requiring any other Storm application to be running. External Storm applications enhance DebtVerge through APIs; they do not make the core application unusable.

### Rule 2: Database Ownership

DebtVerge owns 51 tables with `dv_` prefix. Every table has `organization_id` (NOT NULL, either direct or via parent `dv_cases`). RLS is enabled on every table. Audit tables (`dv_audit_log`, `dv_cashier_audit_logs`, `dv_compliance_attestations`, `dv_field_change_audit`, `dv_external_api_calls`, `dv_consent_records`) are INSERT-only — no UPDATE or DELETE RLS policies. DebtVerge is the authoritative source for its own debt-management case data.

### Rule 3: No Shared Database Access

DebtVerge does not read from or write to any table owned by another Storm application. Cross-app communication is via API (edge functions) only. DebtVerge does not read `storm_call_compliance_audit`, `sv_mailboxes`, `sv_threads`, `sv_messages`, `projects`, `tasks`, or any table outside its `dv_` prefix.

### Rule 4: No Mock Integrations

Payment gateway integration must use real Stripe/GoCardless APIs. BACS file generation must use the production BACS standard. Document upload must use real file upload via Supabase Storage (not `prompt()`). Open Banking must use a real provider (TrueLayer/Plaid) with CSV import as fallback. All mock/placeholder logic from the existing implementation must be replaced with real integrations or removed.

### Rule 5: Edge Function Security

Every edge function must validate the JWT token from the Authorization header. Every edge function must validate org membership for the requested organisation. Every edge function must validate input payloads. Service role key is used only after JWT + org validation passes. Webhook receivers must validate webhook secrets. All external API calls must be logged in `dv_external_api_calls`.

### Rule 6: Tenant Isolation

A debt-management company must never be able to access another company's customers, cases, documents, communications, or financial information. RLS enforces this at the database level. Edge functions enforce this at the API level. Storage enforces this at the file level. Real-time channels are org-scoped. Super-admin bypass is consistent across ALL tables.

### Rule 7: Audit Completeness

Every important customer action is auditable. Every advisor action is auditable. Every data change to critical fields (status, plan_type, total_debt, monthly_disposable_income, creditor balances, schedule status, transaction status) is tracked in `dv_field_change_audit`. Every external API interaction is logged in `dv_external_api_calls`. Every compliance attestation is immutable. Every consent event is recorded. Audit tables never allow UPDATE or DELETE.

### Rule 8: API Boundaries for Cross-App Communication

Case handovers (LeadVerge → DebtVerge, Qualify → DebtVerge, DebtVerge → IVA Verge, DebtVerge → Draft Verge) go through `dv_handover_records` with edge function API calls. No shared frontend component switching. No direct database access across apps. Handovers are idempotent (deduplicated by `handover_id`). Handover payloads include complete case snapshots. Failures are retried with backoff and queued.

### Rule 9: No Prototype Coupling

Hard-coded assumptions (year 2026, householdSize 2, debtorPhone null, SFS income 2150, demo cases) must not be copied. Shared frontend workspace switching must not be copied. Shared platform table reads must be replaced with local tables. Test/demo data must not be included in production. All `prompt()` calls must be replaced with real UI components.

### Rule 10: Graceful Degradation

If any external Storm application is unavailable, DebtVerge degrades gracefully with clear error messages. Core case management, SFS, creditors, payments, compliance, and audit are always available. External integrations are layered on top and can fail without blocking core operations.

---

*End of architecture document.*
