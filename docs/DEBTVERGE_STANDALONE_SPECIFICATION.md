# DebtVerge Standalone — Complete Recreation Specification

> **Source of truth:** The current DebtVerge implementation in this project.
> **Purpose:** Master specification for recreating DebtVerge as a standalone application.
> **Date:** 2026-08-09

---

## TABLE OF CONTENTS

1. [PART 1 — Product Definition](#part-1--product-definition)
2. [PART 2 — Functional Requirements](#part-2--functional-requirements)
3. [PART 3 — User Roles](#part-3--user-roles)
4. [PART 4 — Customer Journey](#part-4--customer-journey)
5. [PART 5 — Screen-by-Screen Specification](#part-5--screen-by-screen-specification)
6. [PART 6 — Database Schema](#part-6--database-schema)
7. [PART 7 — API Specification](#part-7--api-specification)
8. [PART 8 — Permissions](#part-8--permissions)
9. [PART 9 — Compliance/Audit Architecture](#part-9--complianceaudit-architecture)
10. [PART 10 — Document Architecture](#part-10--document-architecture)
11. [PART 11 — Communication Architecture](#part-11--communication-architecture)
12. [PART 12 — Integration Architecture](#part-12--integration-architecture)
13. [PART 13 — Multi-Tenant Architecture](#part-13--multi-tenant-architecture)
14. [PART 14 — Security Requirements](#part-14--security-requirements)
15. [PART 15 — UI/UX Requirements](#part-15--uiux-requirements)
16. [PART 16 — Known Issues to Avoid](#part-16--known-issues-to-avoid)
17. [PART 17 — Standalone Build Architecture](#part-17--standalone-build-architecture)
18. [PART 18 — Build Order](#part-18--build-order)
19. [PART 19 — Acceptance Criteria](#part-19--acceptance-criteria)
20. [Master Recreation Prompt](#master-recreation-prompt)

---

## PART 1 — Product Definition

### 1.1 What DebtVerge Is

DebtVerge is an enterprise debt-management platform for UK FCA-regulated debt management firms. It manages the full lifecycle of a client's debt resolution journey — from initial lead intake through fact-find, SFS (Standard Financial Statement) construction, creditor negotiation, payment scheduling, disbursement processing, compliance attestation, and ongoing case management.

The platform supports four debt solution pipelines:
- **DMP (Debt Management Plan)** — informal creditor repayment arrangement
- **IVA (Individual Voluntary Arrangement)** — formal insolvency with IP/Nominee
- **DRO (Debt Relief Order)** — for low-debt, low-income, low-asset clients
- **Settlement** — lump-sum or structured settlement negotiation

### 1.2 Core Value Proposition

- Speed-to-lead pipeline from intake to solution recommendation
- FCA-compliant fact-find and SFS construction
- Automated pro-rata distribution calculations
- Creditor negotiation tracking with offer letter generation
- Payment gateway integration for recurring collections
- Cashier operations suite for bank reconciliation and disbursement
- Compliance scripting with mandatory disclaimer attestation
- Vulnerability flagging (TEX/BSG FCA categories)
- Breathing Space / MH Crisis moratorium tracking
- Multi-tenant architecture for multiple debt management firms

### 1.3 Critical Distinction: EXISTING vs REQUIRED vs FUTURE

**EXISTING FUNCTIONALITY (what DebtVerge does today):**
- Full case management with 24 tabs across DMP/IVA/Draft pipelines
- SFS intake with income/expense categorization
- Creditor ledger with pro-rata calculations
- Payment logging with automatic distribution splits
- Vulnerability assessment (16-item weighted checklist)
- Benefits entitlement checking (12 UK benefit types)
- Bank transaction auto-categorization (40+ UK merchant patterns)
- Annual review snapshots with income/housing change detection
- Breathing Space / MH Crisis moratorium tracking
- IVA insolvency: IP details, proposals, creditor voting, proof of debt, distribution runs
- Omnichannel communications (email/SMS/WhatsApp/internal notes) with FCA templates
- Compliance scripting with 6 script types and mandatory disclaimer attestation
- Vulnerability flagging with 4 FCA categories (health/life_events/resilience/capability)
- Pathfinder engine (automated solution routing)
- Payment gateway adapter pattern (Stripe/GoCardless/Open Banking/Merchant/Custom)
- Cashier operations (bank feeds, batch processing, disbursement runs, ledger locks)
- Tenant self-service signup wizard (5-step)
- Cross-app transfer to IVA Verge and Draft Verge

**REQUIRED FUNCTIONALITY (what the standalone must do):**
- Everything above, but as a self-contained application
- Own authentication, own database tables, own deployment
- Defined API boundaries for cross-app communication (no shared frontend)
- Production-ready payment gateway integration (not mock)
- Real-time updates on case changes
- Proper document storage (not prompt()-based filename entry)
- Production BACS file generation (not simplified)

**FUTURE INTEGRATIONS (connect later, must not block standalone operation):**
- LeadVerge handover API (receiving leads from LeadVerge)
- IVA Verge / Draft Verge handover (sending cases to downstream apps)
- StormCall compliance portal (call recording/compliance review)
- StormSign (document e-signing)
- StormDrive (document storage)
- StormVerge Mail (email ingestion)
- Qualify (client transfer from qualification platform)
- Knowledge Assistant (AI-powered guidance)

---

## PART 2 — Functional Requirements

### 2.1 Case Management
- Create new cases with auto-generated case numbers (format: `DV-YYYY-NNNN`)
- View all cases in a searchable, filterable list
- Select a case to open the full case workspace
- Delete cases (with cascade to all child records)
- Filter cases by status, pipeline type, IVA stage, or Draft stage
- Switch between pipeline view modes: DMP / IVA / Draft / All
- Transfer cases between solution pipelines with audit trail

### 2.2 Customer Profile
- Personal information: full name, email, landline, mobile, work phone
- Address: street, city, postcode, time at address (years + months)
- Previous address history
- Household composition: adults, children under 16, children 16-18
- Tenure type: owned / private_rented / social_rented / council / leased / living_with_family
- Property details: value, outstanding mortgage/rent, monthly rent/mortgage, landlord/lender name
- SFS allowance thresholds computed from household composition

### 2.3 SFS (Standard Financial Statement)
- Income entries (category: `income`)
- Essential expense entries (category: `essential_expense`)
- Discretionary expense entries (category: `discretionary_expense`)
- Debt repayment entries (category: `debt_repayment`)
- Each entry: label, amount, is_recurring flag
- Automatic disposable income calculation (income - essential - discretionary)
- Pro-rata distribution calculation across creditors
- SFS allowance thresholds based on household composition (grocery/transport/utilities/clothing)

### 2.4 Creditor Management
- Creditor ledger per case
- Each creditor: name, debt type, account reference, current balance, interest rate, minimum payment, pro-rata amount, priority flag, settlement offer
- Debt types: credit_card, personal_loan, mortgage_arrears, utility_arrears, council_tax, overdraft, store_card, hire_purchase, other
- Pro-rata calculation: priority creditors get minimum payment first, remainder split pro-rata by balance
- Offer letter generation (full UK DMP offer letter text with SFS breakdown)

### 2.5 Payment Management
- Log monthly payments (amount, date, expected amount)
- Automatic shortfall detection (is_shortfall, shortfall_amount)
- Automatic payment split across creditors (priority first, then pro-rata)
- Payment schedule configuration (frequency, preferred day, installment amount)
- Scheduled transaction generation (weekly/fortnightly/four_weekly/monthly)
- Transaction status tracking: scheduled, awaiting_clearance, cleared, missed, bounced, overdue
- Payment gateway integration for recurring card/BACS collections

### 2.6 Distribution & Disbursement
- Scheduled creditor distributions (date, amount, status, reference)
- Distribution status: scheduled, processing, sent, failed
- IVA distribution runs with fee deduction (Nominee %, Supervisor %, fixed costs)
- Disbursement waterfall: Nominee fee → Supervisor fee → Nominee costs → Third-party disbursements → Reserve → Creditor dividends
- BACS / Faster Payments / SEPA / Manual output file generation

### 2.7 Vulnerability & Benefits
- 16-item weighted vulnerability checklist across 4 categories:
  - Financial Capability (low literacy, no bank account, benefit change, income drop)
  - Health Conditions (mental health, physical disability, long-term illness, cognitive impairment)
  - Life Events (bereavement, relationship breakdown, job loss, pregnancy/new child)
  - Resilience (no support network, language barrier, digital exclusion, housing insecurity)
- Vulnerability score (0-100) and level (none/low/medium/high/critical)
- Recommended communication channel based on vulnerability
- FCA vulnerability flags (TEX/BSG categories): health, life_events, resilience, capability
- Benefits entitlement checks (12 UK benefit types with estimated monthly amounts)

### 2.8 Open Banking
- Bank transaction import (CSV or Open Banking feed)
- Auto-categorization using 40+ UK merchant pattern matching
- Manual category override (takes precedence over auto)
- Confidence levels: high, medium, low, unmatched
- Import transactions to SFS (creates SFS entries from bank transactions)
- Bulk import with progress tracking

### 2.9 Annual Reviews
- 12-month SFS review snapshots
- Income change detection (delta from previous review)
- Housing change detection
- Comparison fields audit log
- Review status: pending, in_progress, completed, overdue
- Review number sequencing

### 2.10 Breathing Space / Moratorium
- Standard Breathing Space (60-day legal protection from creditor action)
- Mental Health Crisis Moratorium (no fixed end date, treatment end + 30 days)
- Account lock (freezes payments and interest)
- Eligibility checking (not available for IVA/DRO cases)
- Review task tracking
- Creditor inclusion list
- AMHP evidence file storage (for MH Crisis)
- Nominated contact details (for MH Crisis)
- Cancellation with reason

### 2.11 IVA / Insolvency
- IP (Insolvency Practitioner) details: name, registration number, firm, role (nominee/supervisor/joint), fees
- Document checklist: payslip, bank_statement, id_kyc, tax_record, utility_bill, creditor_statement, other
- IVA proposal: duration, estimated dividend, equity treatment, protocol compliance, status
- Creditor voting: accept/reject/modify with claimed debt amount, proxy form
- Proof of debt: creditor submissions with claimed/admitted amounts, supporting documents
- IVA contributions: monthly payments with status (expected/received/missed/late/partial)
- Distribution runs: calculated → approved → executed → reversed
- Chairs Report generation
- IVA Protocol Terms (UK IVA Protocol 2021 — 13 clauses)
- MOC (Meeting of Creditors) voting with 75% threshold logic

### 2.12 Compliance
- 6 FCA compliance script types: initial_onboarding, solution_selection, iva_proposal_review, creditor_negotiation, annual_review, closure
- Each script has 4-5 steps and 1-3 mandatory regulatory disclaimers
- Mandatory disclaimer attestation (advisor confirms read verbatim)
- Immutable attestation audit log
- Objection/FAQ database (12 pre-approved responses)
- Vulnerability flagging with FCA categories and sub-categories
- Compliance overlay auto-detects appropriate script based on case status and pipeline

### 2.13 Communications
- Omnichannel: email, SMS, WhatsApp, internal notes
- FCA-compliant message templates (6 templates with variable substitution)
- Thread-based conversation view per case
- Unassigned message buffer with manual case matching
- VoIP call logging (encoded as internal notes with `[VOIP]` prefix)
- Attachments (email only)
- Character limits (SMS: 160, WhatsApp: 4096) with multi-part SMS detection
- Read receipts (WhatsApp)
- Agent assignment and thread closure
- Department routing (general_inquiries, dmp_team, iva_insolvency, client_relations)

### 2.14 Pathfinder Engine
- Automated solution routing based on: total debt, disposable income, creditor count, property equity
- Scores 4 routes: IVA, DMP, DRO, Bankruptcy (0-100 scale)
- Falls back to "signposting" if best score < 30
- Returns recommended route, confidence, reasons, all route scores, estimated duration and cost

### 2.15 Solution Suitability Matrix
- Evaluates 5 solutions: DMP, DRO, IVA, Settlement, Bankruptcy
- Each solution gets: suitability verdict (eligible/likely/marginal/unsuitable), percentage score, reasons, blockers
- IVA: needs £10k+ debt, £100+ DI
- DRO: needs ≤£30k debt, ≤£75 DI, ≤£2k equity
- FCA alignment considerations

### 2.16 Cashier Operations
- Bank feed management (open_banking, csv_import, manual)
- Bank transaction matching (auto and manual)
- Batch payment runs (card_collection, direct_debit, mixed)
- Exception triage (failed transactions, suspended schedules, expired cards)
- Disbursement run lifecycle (draft → approved → generated → submitted → settled)
- Ledger locking (end_of_day, period, month_end) with unlock reason
- Payment link invitations (SMS/email with tokenised links)
- End-of-day balancing summary

### 2.17 Payment Gateway
- White-label gateway adapter pattern (Stripe, GoCardless, Open Banking, Merchant Acquirer, Custom)
- Tokenised payment method storage (card/BACS/open_banking — never raw PAN/CVC)
- Recurring payment schedules with retry logic
- Gateway transaction logging with full response storage
- Expired card detection
- Reconciliation with variance calculation

### 2.18 Tenant Signup & Provisioning
- 5-step self-service signup wizard for new debt management firms
- Company details, FCA FRN validation, admin account creation
- Plan tier selection (Starter/Professional/Enterprise)
- Add-on selection (additional seats, Open Banking credits, SMS pack)
- Checkout with pricing calculation (VAT 20%, annual discount 15%)
- Automated tenant provisioning (creates org, auth user, RBAC role, licenses)

### 2.19 Debtor Self-Service Portal
- Fact-find progress tracking
- Document upload (bank statements, payslips, ID/KYC, tax records)
- Signposting self-assessment
- Free debt advice resources (StepChange, National Debtline, Citizens Advice, MoneyHelper)

### 2.20 Cross-App Transfers
- Transfer case to IVA Verge (with audit trail and data preservation summary)
- Transfer case to Draft Verge
- Pivot from IVA/Draft back to DebtVerge DMP
- Pipeline switcher with reason selection and data carryover checklist

---

## PART 3 — User Roles

### 3.1 Existing Roles

| Role | Scope | Description |
|------|-------|-------------|
| Super Admin | Platform-wide | Bypasses all RLS, can see all organizations. Flagged via `profiles.is_super_admin` |
| Admin (Org) | Organization | Full access within their org. Created during tenant provisioning |
| Advisor | Organization | Manages cases, conducts fact-finds, communicates with clients |
| Compliance Officer | Organization | Reviews compliance, manages attestations, audits calls |
| Cashier | Organization | Operates cashier suite, batch processing, disbursement runs |
| Debtor (Portal) | Case-scoped | Self-service portal access for a specific case |

### 3.2 RBAC Permission Model

The existing system uses a dual-gate entitlement model:
- **Gate 1 (License):** Organization must have an active license for the module
- **Gate 2 (Role):** User's RBAC role must grant view/edit/manage permission for the module

Permissions follow the format `MODULE:action` where modules include `DEBTVERGE`, `IVAVERGE`, `LEADVERGE`, `DRAFTVERGE`, `COMPLIANCE`, etc.

### 3.3 Required Roles for Standalone

The standalone must implement:
- **Super Admin** — platform operator, can see all tenants
- **Org Admin** — tenant admin, full access within their organization
- **Advisor** — case management, client communication, SFS, compliance
- **Compliance Officer** — compliance review, audit log access, vulnerability oversight
- **Cashier** — payment processing, bank reconciliation, disbursement
- **Debtor** — self-service portal, limited to their own case

---

## PART 4 — Customer Journey

### 4.1 Complete Journey Map

```
LEAD (from LeadVerge or manual intake)
  ↓
INITIAL INFORMATION (case created, status: intake)
  ↓
QUALIFICATION (Pathfinder engine, solution suitability matrix)
  ↓
FACT FIND (customer profile, household, address history)
  ↓
SFS CONSTRUCTION (income, expenses, disposable income calculation)
  ↓
CREDITOR/DEBT INFORMATION (creditor ledger, balances, debt types)
  ↓
AFFORDABILITY (pro-rata calculation, disposable income verification)
  ↓
ELIGIBILITY (DMP/IVA/DRO/Settlement suitability scoring)
  ↓
DOCUMENTATION (document checklist, uploads, verification)
  ↓
COMPLIANCE (FCA script attestation, vulnerability assessment, AML)
  ↓
ADVISOR REVIEW (solution recommendation, pipeline selection)
  ↓
OUTCOME
  ├── DMP: creditor negotiation → offer packs → payment schedule → ongoing
  ├── IVA: IP appointment → proposal → MOC → supervision → distribution
  ├── DRO: eligibility check → interim order → moratorium → completion
  └── Settlement: negotiation → lump sum/structured → closure
  ↓
ONGOING CASE MANAGEMENT
  ├── Payment logging → automatic distribution
  ├── Annual reviews (12-month SFS snapshots)
  ├── Breathing Space / MH Crisis moratorium (if needed)
  ├── Compliance re-attestation (annual review script)
  ├── Communications (omnichannel)
  └── Case closure
```

### 4.2 Case Status State Machine

```
intake → sfs_pending → sfs_approved → creditor_pack_sent → payment_schedule_active → completed → closed
                                                                    ↓
                                                              handed_over (to IVA/Draft Verge)

Side states:
  - unqualified (terminal, can be set from any state)
  - handed_over (terminal, case transferred to another app)
```

### 4.3 IVA Pipeline Stages

```
Proposals in Draft → Meeting of Creditors → Active Supervision → In Breach or Transfer
```

### 4.4 Draft Pipeline Stages

```
Proposal Drafting → Notice Issued → MOC Voting Open → Approved-Handover
```

### 4.5 IVA Proposal Status

```
draft → circulated → approved/rejected/varied
```

### 4.6 Breathing Space Status

```
active → expired/cancelled
```

### 4.7 Annual Review Status

```
pending → in_progress → completed
      → overdue (if past due_date and not completed)
```

### 4.8 Payment Transaction Status

```
scheduled → awaiting_clearance → cleared
                            → missed
                            → bounced
                            → overdue
```

### 4.9 Distribution Status

```
scheduled → processing → sent → failed
```

### 4.10 Disbursement Run Status

```
draft → approved → generated → submitted → settled/failed
```

---

## PART 5 — Screen-by-Screen Specification

### 5.1 Login / Signup Wizard

**Signup Wizard (5 steps):**
- Step 1: Company & Account — company name, FCA FRN (6-7 digits), first/last name, corporate email (rejects free providers), UK mobile (07XXXXXXXXX), password (8+ chars, uppercase, number)
- Step 2: Plan & Tier — 3 tiers (Starter £299/mo, Professional £899/mo, Enterprise £2499/mo), monthly/annual toggle (-15% annual)
- Step 3: Add-Ons — additional seats slider (0-50, £45/mo each), Open Banking credits slider (0-20 packs, £0.50/credit), SMS/WhatsApp toggle (£25/mo)
- Step 4: Checkout — card or direct debit form, security badges, order summary with VAT (20%)
- Step 5: Provisioning — animated progress through 4 stages, tenant ID/URL display, launch button

**Order Summary Sidebar** (steps 2-4): plan, seats, OB credits, SMS pack, annual discount, subtotal, VAT, total

### 5.2 Main Workspace Shell

**Top bar:** Logo, pipeline view mode tabs (DMP/IVA/Draft/All), search, status filter, "New Case" button, "Offer Pack" button, "Solution Matrix" button, agent role indicator, theme toggle

**Left sidebar:** Case list (searchable, filterable by status)

**Main content:** 24 tabs (visibility depends on active pipeline):

| # | Tab ID | Label | Purpose |
|---|--------|-------|---------|
| 1 | dashboard | Dashboard | KPIs, collection trend chart, debt composition, upcoming distributions, recent audit, annual review tracker, financial summary |
| 2 | profile | Customer Profile | Personal/contact info, address history, household composition, SFS thresholds, property/tenure |
| 3 | intake | SFS Intake | Income/expense entry, disposable income calculation, SFS allowance thresholds |
| 4 | ledger | Creditor Ledger | Creditor list, balances, pro-rata amounts, negotiation timeline |
| 5 | forecast | Payoff Forecast | DMP projection (amortization), settlement projection (savings accumulation) |
| 6 | compare | Plan Comparison | Side-by-side DMP vs IVA vs DRO vs Settlement vs Bankruptcy comparison |
| 7 | disbursement | Disbursement | Scheduled creditor payments, distribution status tracking |
| 8 | payment_schedule | Payment Schedule | Frequency config, preferred day, installment amount, upcoming due dates, transaction ledger |
| 9 | payment_gateway | Payment Gateway | Gateway configs, tokenised payment methods, recurring schedules, transaction history |
| 10 | cashier_ops | Cashier Ops | Bank feeds, batch processing, exceptions, disbursement runs, audit trail, queue monitor |
| 11 | vulnerability | Vulnerability | 16-item checklist, score/level, benefits checks, FCA vulnerability flags |
| 12 | compliance | Compliance | FCA script attestation, objection/FAQ search, vulnerability flagging |
| 13 | nominee_proposal | Nominee Proposal | IP details, IVA proposal parameters |
| 14 | interim_order | Interim Order | DRO eligibility check (debt ≤£30k, DI ≤£75/mo, assets <£2k), moratorium |
| 15 | moratorium | Moratorium | Breathing Space / MH Crisis tracking |
| 16 | ip_nominee | IP Nominee | IP details, document checklist |
| 17 | document_checklist | Documents | Document upload, review, approval/rejection |
| 18 | creditor_voting | Creditor Voting | Votes on IVA proposal, MOC threshold (75% of claimed debt) |
| 19 | proof_of_debt | Proof of Debt | Creditor PoD submissions, admitted/rejected amounts |
| 20 | pathfinder | Pathfinder | Automated solution routing engine |
| 21 | proposal_generator | Proposal Generator | IVA proposal pack generation |
| 22 | inflight | Inflight | In-flight case management |
| 23 | breathing_space | Breathing Space | Moratorium tracker |
| 24 | communications | Communications | 3-column omnichannel comms workspace |

### 5.3 Dashboard Tab

- KPI cards: total debt, monthly DI, recovery rate, active creditors
- Collection trend chart (line/bar)
- Debt composition pie chart
- Upcoming distributions list
- Recent audit activity feed
- Annual review tracker widget
- Financial summary panel

### 5.4 Customer Profile Tab

- Personal info: name, email, phones (landline/mobile/work)
- Address: street, city, postcode, time at address
- Previous addresses (accordion)
- Household: adults, children under 16, children 16-18
- SFS allowance thresholds (computed from household)
- Property: tenure type, value, outstanding mortgage, monthly rent/mortgage, landlord/lender

### 5.5 SFS Intake Tab

- Income section: add income entries (label, amount, recurring)
- Essential expenses: rent/mortgage, utilities, council tax, food, transport, etc.
- Discretionary expenses: entertainment, subscriptions, etc.
- Debt repayments: existing debt payments
- Disposable income calculation (auto)
- SFS allowance threshold comparison
- Pro-rata distribution preview

### 5.6 Creditor Ledger Tab

- Creditor table: name, debt type, account ref, balance, interest rate, min payment, pro-rata, priority, settlement offer
- Add/edit/delete creditor
- Negotiation timeline per creditor (events: offer_pack_sent, hold_placed, interest_freeze_accepted/rejected, full_offer_accepted/rejected, counter_offer_received, follow_up_call, winding_up_threat)
- Offer letter generation (full UK DMP offer letter text)

### 5.7 Payoff Forecast Tab

- DMP projection: monthly amortization chart, total interest paid, estimated completion date, monthly breakdown points
- Settlement projection: savings accumulation model, time to first settlement, projected settlement amounts
- Toggle: zero-interest vs actual interest rate projection

### 5.8 Communications Tab (3-Column Layout)

**Left column (280px):**
- Triage folders: My Assigned, Unassigned Queue, FCA Urgent/Vulnerable, Closed
- Department filters: General Inquiries, DMP Team, IVA Insolvency, Client Relations
- Search by name or case reference
- Thread list with: avatar, name, case ref, channel icon, message snippet, pipeline badge, VULN badge, topic badge, relative time, unread count

**Center column (flex-1):**
- Thread header: avatar, name, case number, message count, channel, assigned agent, action buttons (Assign to Me, Re-assign, View Full Case Record, Close)
- Conversation timeline: day-grouped messages, VoIP call bubbles, internal note "Agent Only" badges
- Composer: channel tabs (email/SMS/WhatsApp/internal note), FCA template dropdown, action cards (Open Banking consent, Payslip upload, Direct Debit instruction), subject (email), body, char counter, attachments (email), Send Message + Send & Close

**Right column (300px, collapsible):**
- Debtor snapshot: avatar, name, case ref, pipeline badge
- Contact details: email, phone, household size
- Key financial metrics: total debt, disposable income
- SFS quick-adjust calculator: income input, expense inputs (rent, utilities, council tax), recalculated DI
- Quick actions: Start VoIP Call, Issue 30-Day Breather, Schedule Review Task
- Safeguarding: vulnerability flag status

**Floating:** Unassigned message banner (bottom-right, expandable)

### 5.9 Compliance Overlay (rendered above comms)

- Script bar: auto-detected script based on case status/pipeline, manual override dropdown
- Expanded view: numbered script steps, mandatory FCA CONC disclaimers (amber, "Must Read Verbatim" badge)
- Attestation checkbox: "I confirm all mandatory disclaimers were read verbatim" → creates immutable audit record
- Objection & FAQ quick-search drawer: search 12 pre-approved responses, paste to email/WhatsApp/copy
- Vulnerability flag modal: 4 FCA categories (health/life_events/resilience/capability), 16 sub-categories, guidance notes, flag list with delete

### 5.10 Cashier Operations (6 sub-tabs)

1. **Bank Feeds:** feed list, create feed modal (name, type, sort code, account masked, import frequency), CSV import modal, transactions table with match status, auto-match button
2. **Batch Processing:** batch run list with status, create/execute/retry buttons, expandable item details
3. **Exceptions:** KPI cards, expired card remediation, failed transaction triage, suspended schedules, payment link history, payment link form modal
4. **Disbursement Runs:** run list with lifecycle status, approve/generate/submit actions, file preview (BACS/Faster Payments/SEPA/Manual), items table, create run modal with waterfall entry selection
5. **Audit Trail:** end-of-day balancing summary, ledger lock form, lock history with unlock (reason required), audit log list with action icons
6. **Queue Monitor:** background job queue dashboard

### 5.11 Debtor Self-Service Portal

1. **Overview:** fact-find progress bar (6 steps), document status summary
2. **Signposting:** assessment form (total debt, DI, creditor count, property equity) → Pathfinder result
3. **Documents:** upload form for 4 document types, uploaded docs list with status
4. **Advice:** 4 free advice organizations with phone numbers

### 5.12 New Case Modal

- Case number (auto-generated)
- Debtor name (required)
- Debtor reference
- Notes

### 5.13 Pipeline Switcher Modal

- Target pipeline selection (DMP/IVA/DRO/Settlement)
- Reason dropdown
- Data carryover checklist
- Pipeline-specific tabs preview

### 5.14 Solution Suitability Matrix Modal

- 5 solution cards: DMP, DRO, IVA, Settlement, Bankruptcy
- Each card: verdict badge (eligible/likely/marginal/unsuitable), percentage score, reasons list, blockers list
- Suitability bar visualization

### 5.15 Offer Pack Drawer

- Creditor selection
- Offer terms
- SFS summary inclusion
- Generated offer letter text
- Download/print

---

## PART 6 — Database Schema

### 6.1 Table Inventory (44 tables total)

The existing implementation has 44 tables across 14 migrations. Below is the complete inventory grouped by domain. The standalone should use the same schema but with `dv_` prefix instead of `debt_` / `debtverge_` to avoid collisions with the existing app.

**Core Case Tables (5):**
- `debt_cases` → `dv_cases` — master case record
- `debt_creditors` → `dv_creditors` — creditor ledger
- `debt_sfs_entries` → `dv_sfs_entries` — SFS line items
- `debt_distributions` → `dv_distributions` — scheduled creditor payments
- `debt_audit_log` → `dv_audit_log` — case audit timeline

**Payments & Negotiation (2):**
- `debt_payments` → `dv_payments` — incoming debtor payments
- `debt_negotiations` → `dv_negotiations` — per-creditor negotiation events

**Customer Profile (2):**
- `debt_customer_profiles` → `dv_customer_profiles` — customer details (1:1 with case)
- `debt_previous_addresses` → `dv_previous_addresses` — address history

**Vulnerability & Benefits (2):**
- `debt_vulnerability_assessments` → `dv_vulnerability_assessments` — 16-item checklist (1:1 with case)
- `debt_benefits_checks` → `dv_benefits_checks` — benefits entitlement checks

**Open Banking & Reviews (2):**
- `debt_bank_transactions` → `dv_bank_transactions` — auto-categorized bank transactions
- `debt_annual_reviews` → `dv_annual_reviews` — 12-month SFS review snapshots

**Tenant Provisioning (1):**
- `debtverge_tenants` → `dv_tenants` — DM firm tenant sign-up

**IVA / Insolvency (5):**
- `debt_ip_details` → `dv_ip_details` — insolvency practitioner details
- `debt_document_checklist` → `dv_document_checklist` — verification documents
- `debt_iva_proposals` → `dv_iva_proposals` — IVA protocol parameters
- `debt_creditor_votes` → `dv_creditor_votes` — proxy votes on IVA proposals
- `debt_proof_of_debt` → `dv_proof_of_debt` — creditor PoD submissions

**In-flight & Signposting (4):**
- `debt_signposting_assessments` → `dv_signposting_assessments` — lead intake routing
- `debt_iva_contributions` → `dv_iva_contributions` — monthly IVA contributions
- `debt_iva_distribution_runs` → `dv_iva_distribution_runs` — distribution calculator runs
- `debt_iva_distribution_items` → `dv_iva_distribution_items` — creditor line items in runs

**Communications (2):**
- `debtverge_communications` → `dv_communications` — omnichannel message log
- `debtverge_unassigned_messages` → `dv_unassigned_messages` — unmatched inbound buffer

**Compliance (2):**
- `debtverge_compliance_attestations` → `dv_compliance_attestations` — FCA disclaimer confirmations
- `debtverge_vulnerability_flags` → `dv_vulnerability_flags` — FCA category vulnerability markers

**Payment Schedule (1):**
- `debt_payment_transactions` → `dv_payment_transactions` — per-installment ledger

**Breathing Space (1):**
- `debt_breathing_spaces` → `dv_breathing_spaces` — statutory moratorium records

**Payment Gateway (6):**
- `payment_gateway_configs` → `dv_gateway_configs` — white-label gateway config
- `payment_methods` → `dv_payment_methods` — tokenised payment methods
- `recurring_payment_schedules` → `dv_recurring_schedules` — recurring payment scheduling
- `gateway_payment_transactions` → `dv_gateway_transactions` — gateway transaction log
- `disbursement_waterfall_entries` → `dv_waterfall_entries` — waterfall accounting ledger
- `payment_reconciliation_log` → `dv_reconciliation_log` — reconciliation tracking

**Cashier Operations (9):**
- `bank_feeds` → `dv_bank_feeds` — bank feed connections
- `bank_transactions` → `dv_cashier_transactions` — cashier bank transactions (separate from dv_bank_transactions)
- `batch_payment_runs` → `dv_batch_runs` — batch processing queues
- `batch_payment_items` → `dv_batch_items` — items within batch runs
- `cashier_audit_logs` → `dv_cashier_audit_logs` — immutable audit trail (INSERT only)
- `ledger_locks` → `dv_ledger_locks` — end-of-day balancing
- `disbursement_runs` → `dv_disbursement_runs` — creditor disbursement batches
- `disbursement_run_items` → `dv_disbursement_items` — items in disbursement runs
- `payment_link_invitations` → `dv_payment_links` — SMS/email payment links

### 6.2 Key Enums

```sql
dv_case_status: intake, sfs_pending, sfs_approved, creditor_pack_sent, payment_schedule_active, completed, closed
dv_plan_type: dmp, settlement, pending  -- NOTE: add 'iva' and 'dro' for standalone
dv_debt_type: credit_card, personal_loan, mortgage_arrears, utility_arrears, council_tax, overdraft, store_card, hire_purchase, other
dv_sfs_category: income, essential_expense, discretionary_expense, debt_repayment
dv_distribution_status: scheduled, processing, sent, failed
dv_tenure_type: owned, private_rented, social_rented, council, leased, living_with_family
dv_vulnerability_level: none, low, medium, high, critical
dv_payment_txn_status: scheduled, awaiting_clearance, cleared, missed, bounced, overdue
```

### 6.3 Entity Relationships

```
dv_cases (root)
  ├── dv_creditors (CASCADE)
  │   ├── dv_distributions (CASCADE)
  │   ├── dv_negotiations (CASCADE)
  │   ├── dv_creditor_votes (CASCADE)
  │   └── dv_proof_of_debt (SET NULL)
  ├── dv_sfs_entries (CASCADE)
  ├── dv_audit_log (CASCADE)
  ├── dv_payments (CASCADE)
  ├── dv_customer_profiles (CASCADE, UNIQUE 1:1)
  ├── dv_previous_addresses (CASCADE)
  ├── dv_vulnerability_assessments (CASCADE, UNIQUE 1:1)
  ├── dv_benefits_checks (CASCADE)
  ├── dv_bank_transactions (CASCADE)
  ├── dv_annual_reviews (CASCADE)
  ├── dv_ip_details (CASCADE)
  ├── dv_document_checklist (CASCADE)
  ├── dv_iva_proposals (CASCADE)
  │   └── dv_creditor_votes (CASCADE)
  ├── dv_proof_of_debt (CASCADE)
  ├── dv_signposting_assessments (CASCADE, nullable case_id)
  ├── dv_iva_contributions (CASCADE)
  ├── dv_iva_distribution_runs (CASCADE)
  │   └── dv_iva_distribution_items (CASCADE)
  ├── dv_communications (CASCADE)
  ├── dv_compliance_attestations (CASCADE)
  ├── dv_vulnerability_flags (CASCADE)
  ├── dv_payment_transactions (CASCADE)
  ├── dv_breathing_spaces (CASCADE)
  ├── dv_payment_methods (CASCADE)
  ├── dv_recurring_schedules (CASCADE)
  ├── dv_gateway_transactions (CASCADE)
  ├── dv_waterfall_entries (CASCADE)
  └── dv_unassigned_messages (SET NULL on matched_case_id)

dv_gateway_configs
  ├── dv_payment_methods (SET NULL)
  ├── dv_recurring_schedules (SET NULL)
  └── dv_gateway_transactions (SET NULL)

dv_recurring_schedules
  └── dv_gateway_transactions (SET NULL)

dv_gateway_transactions
  ├── dv_gateway_transactions (SET NULL, self-reference for retries)
  ├── dv_waterfall_entries (SET NULL)
  └── dv_reconciliation_log (CASCADE)

dv_bank_feeds
  └── dv_cashier_transactions (CASCADE)

dv_batch_runs
  └── dv_batch_items (CASCADE)

dv_disbursement_runs
  └── dv_disbursement_items (CASCADE)
```

### 6.4 RLS Model (Required for Standalone)

All tables must use organization-scoped RLS:

```sql
-- Pattern for tables with organization_id column:
USING (is_super_admin() OR EXISTS(
  SELECT 1 FROM organization_users ou
  WHERE ou.user_id = auth.uid()
  AND ou.organization_id = <table>.organization_id
))

-- Pattern for child tables (scoped via parent dv_cases):
USING (is_super_admin() OR EXISTS(
  SELECT 1 FROM dv_cases
  WHERE dv_cases.id = <child>.case_id
  AND dv_cases.organization_id IS NOT NULL
  AND EXISTS(
    SELECT 1 FROM organization_users ou
    WHERE ou.user_id = auth.uid()
    AND ou.organization_id = dv_cases.organization_id
  )
))
```

**Critical fix for standalone:** The `dv_unassigned_messages` table must allow agents to see truly unassigned messages (where `matched_case_id IS NULL`). The existing implementation has a bug where these are invisible. Solution: add `organization_id` to `dv_unassigned_messages` directly, or use a SECURITY DEFINER function for the unassigned query.

---

## PART 7 — API Specification

### 7.1 Edge Functions (Existing)

| Function | Actions | Purpose |
|----------|---------|---------|
| `provision-debtverge-tenant` | POST | Tenant onboarding (creates org, auth user, RBAC, licenses) |
| `payment-gateway` | tokenise, charge, refund, delete_token, verify | Payment gateway abstraction (CURRENTLY MOCK) |
| `recurring-collection` | process_due, retry_failed, detect_expired | Automated recurring payment collection |
| `batch-processing` | create, execute, retry, auto_match | Batch payment processing |
| `disbursement-run` | create, generate | Disbursement file generation |
| `queue-worker` | process | Background job queue worker (7 job types) |
| `api-inbound` | POST | Inbound email/webhook receiver (NOT DebtVerge-specific) |

### 7.2 Required Edge Functions for Standalone

1. **`dv-provision-tenant`** — tenant signup (same logic as existing)
2. **`dv-payment-gateway`** — MUST be real (Stripe/GoCardless integration, not mock)
3. **`dv-recurring-collection`** — process due, retry failed, detect expired
4. **`dv-batch-processing`** — create, execute, retry, auto-match
5. **`dv-disbursement-run`** — create, generate (with production BACS format)
6. **`dv-queue-worker`** — background job processing
7. **`dv-handover-receive`** — NEW: receive case handovers from LeadVerge
8. **`dv-handover-send`** — NEW: send case handovers to IVA Verge / Draft Verge

### 7.3 Handover API (New for Standalone)

**Receive from LeadVerge:**
```
POST /functions/v1/dv-handover-receive
Body: { handover_id, lead_snapshot, target_org_id }
Response: { accepted: true, case_id }
```

**Send to IVA/Draft Verge:**
```
POST /functions/v1/dv-handover-send
Body: { case_id, target_app, reason, data_snapshot }
Response: { handover_id, status: "pending" }
```

### 7.4 Background Job Types

| Job Type | Description |
|----------|-------------|
| `batch_collection` | Process batch payment items (chunked) |
| `disbursement_run` | Validate and process disbursement items |
| `bank_reconciliation` | Auto-match bank transactions to schedules |
| `recurring_collection` | Process due recurring payment schedules |
| `retry_failed` | Retry failed gateway transactions |
| `expired_card_check` | Detect and suspend expired card schedules |
| `ledger_posting` | Insert waterfall entries from payload |

---

## PART 8 — Permissions

### 8.1 RBAC Modules for DebtVerge Standalone

| Module | Permissions | Roles |
|--------|------------|-------|
| DEBTVERGE | view, edit, manage | Admin, Advisor |
| IVAVERGE | view, edit, manage | Admin, Advisor (IVA team) |
| COMPLIANCE | view, edit, manage | Admin, Compliance Officer |
| PAYMENTS | view, edit, manage | Admin, Cashier |
| CASES | view, edit, manage, delete | Admin, Advisor |
| COMMUNICATIONS | view, edit, manage | Admin, Advisor |
| DOCUMENTS | view, edit, manage | Admin, Advisor, Debtor (own only) |
| VULNERABILITY | view, edit, manage | Admin, Advisor, Compliance Officer |
| REPORTS | view, manage | Admin, Compliance Officer |
| TENANT_ADMIN | manage | Admin only |
| SUPER_ADMIN | (bypasses all) | Super Admin only |

### 8.2 Permission Enforcement

- Client-side: `canAccessApp()` checks both license and role permission
- Server-side: RLS policies enforce org membership + super-admin bypass
- Edge functions: use service role key (bypass RLS) but should validate org membership manually

---

## PART 9 — Compliance/Audit Architecture

### 9.1 Existing Compliance Features

**FCA Compliance Scripts (6 types):**
1. `initial_onboarding` — 5 steps, 2 disclaimers
2. `solution_selection` — 4 steps, 2 disclaimers
3. `iva_proposal_review` — 4 steps, 3 disclaimers
4. `creditor_negotiation` — 4 steps, 2 disclaimers
5. `annual_review` — 4 steps, 2 disclaimers
6. `closure` — 4 steps, 1 disclaimer

**Attestation Process:**
- Advisor reads mandatory disclaimers verbatim
- Checks "I confirm all mandatory disclaimers were read verbatim"
- Creates immutable record in `dv_compliance_attestations` with: case_id, script_type, disclaimers_text, confirmed_by, confirmed_at
- Record is INSERT-only (no UPDATE/DELETE)

**Vulnerability Flagging:**
- 4 FCA categories: health, life_events, resilience, capability
- 16 sub-categories (4 per category)
- Each flag: case_id, fca_category, sub_category, guidance_notes, flagged_by, flagged_at
- Flags are visible in comms sidebar and compliance overlay
- Immutable audit entry created on flag

**Objection/FAQ Database:**
- 12 pre-approved responses for common client objections
- Categories: IVA credit impact, home retention, interest freezing, missed payments, call recording, SFS, cancellation, fees, complaints, DRO, DMP vs IVA
- Paste-to-email, paste-to-WhatsApp, copy functionality

**Audit Milestones:**
- `dv_audit_log` table: case_id, milestone, description, actor, created_at
- Written by: case creation, status changes, pipeline switches, payment logging, SFS updates, VoIP calls, breathing space actions, thread closure, handovers
- INSERT-only by design (no UPDATE/DELETE RLS policies)

**Cashier Audit Logs:**
- `dv_cashier_audit_logs`: org_id, case_id, user_id, user_email, action_type, entity_type, entity_id, old_value (jsonb), new_value (jsonb), reason, amount_impact
- INSERT-only (no UPDATE/DELETE policies)
- Written by: bank feed operations, batch processing, disbursement runs, ledger locks/unlocks

**Compliance Portal Audit Log:**
- `storm_call_compliance_audit`: org_id, action_type, entity_type, entity_id, user_email, details (jsonb)
- Actions: recording_accessed, transcript_viewed, notes_edited, summary_approved, summary_amended, coaching_added, call_transferred, recording_downloaded

### 9.2 Missing Compliance Features (Required for Production)

1. **AML (Anti-Money Laundering) checks** — UNKNOWN: no AML-specific tables or screens found in the existing implementation. This is a regulatory gap for a debt management platform.
2. **DPA/security questions** — UNKNOWN: no DPA-specific consent records found. The customer profile has no consent fields.
3. **Data retention policies** — no retention rules or automated deletion found
4. **Immutable audit log for data changes** — `dv_audit_log` records milestones but not field-level changes. `dv_cashier_audit_logs` has old_value/new_value but only for cashier operations. A general field-level audit log is missing.
5. **Call recording storage** — VoIP call logs are stored as internal notes with `[VOIP]` prefix. No actual recording storage exists. "Play recording" button has no onClick handler.
6. **Consent management** — no explicit consent tracking for data processing, marketing, or communication preferences
7. **GDPR right to erasure** — no mechanism found for data subject erasure requests
8. **Data export** — no bulk data export for data subject access requests

### 9.3 Required Compliance Architecture for Standalone

- All `dv_audit_log` and `dv_cashier_audit_logs` tables must be INSERT-only with NO UPDATE or DELETE RLS policies
- Field-level change tracking for critical fields (status, plan_type, total_debt, monthly_disposable_income)
- Consent management table: case_id, consent_type, granted, granted_at, withdrawn_at
- AML risk assessment: case_id, risk_level, checked_by, checked_at, notes
- DPA register: case_id, dpa_completed, completed_at, completed_by
- Data retention rules with automated archival/deletion scheduling
- Call recording storage via Supabase Storage with signed URLs

---

## PART 10 — Document Architecture

### 10.1 Existing Document Features

**Document Checklist Table (`dv_document_checklist`):**
- document_type: payslip, bank_statement, id_kyc, tax_record, utility_bill, creditor_statement, other
- file_name, file_url (Supabase Storage path), file_size_bytes
- uploaded_by_role: advisor, debtor, ip, creditor
- status: pending, approved, rejected
- reviewed_by, reviewed_at, rejection_reason, notes

**Debtor Portal Document Upload:**
- 4 document types: bank statements, payslips, ID/KYC, tax records
- File name input + upload button (CURRENTLY USES prompt() — NOT PRODUCTION READY)

**Document Generation (Pure Functions):**
- IVA Proposal Document (JSON structure with SFS summary, creditor ledger, projected dividends)
- Chairs Report (aggregates voting results, PoD claims, per-creditor breakdown)
- IVA Proposal Pack (contribution table, Nominee's Report, Protocol Terms, fee schedule, creditor schedule)
- DMP Offer Letter (full text with SFS breakdown)
- All output as downloadable JSON or text

### 10.2 Required Document Architecture for Standalone

- Real file upload via Supabase Storage (not prompt()-based filename entry)
- Document preview (in-browser viewer for PDFs, images)
- Document categories with metadata
- Version history for replaced documents
- Document verification workflow (upload → pending → approved/rejected)
- Retention rules per document type
- Signed URLs for secure access
- Document audit trail (who uploaded, who reviewed, when approved/rejected)
- OCR/extraction for bank statements and payslips (FUTURE)

### 10.3 Storage Architecture

- Supabase Storage bucket: `dv-documents` (organization-scoped)
- Path structure: `{organization_id}/{case_id}/{document_type}/{filename}`
- RLS on storage: org membership check
- Signed URLs with expiry for document access

---

## PART 11 — Communication Architecture

### 11.1 Existing Communication Features

**Channels:** email, SMS, WhatsApp, internal notes

**Message Storage (`dv_communications`):**
- case_id, thread_id (UUID grouping), channel, direction (inbound/outbound)
- sender: name, email_or_phone, type (client/agent/system)
- recipient: name, email_or_phone
- agent_id, agent_name
- subject (email), body, attachments (text array)
- status: delivered, read, failed, queued
- matched_automatically

**Unassigned Messages (`dv_unassigned_messages`):**
- channel, sender info, subject, body, attachments
- matched_case_id, matched_at, matched_by
- status: unassigned, matched, ignored

**FCA Templates (6):**
1. SFS Reminder (email)
2. DMP Payment Receipt (email)
3. Meeting Call Link (SMS)
4. WhatsApp Follow-Up (whatsapp)
5. Vulnerability Welfare Check (email)
6. Annual Review Notice (email)

**Action Cards (3):**
1. Open Banking consent link
2. Payslip upload for income verification
3. Direct Debit instruction form

**VoIP Call Logging:**
- Encoded as internal notes with `[VOIP]` prefix
- JSON payload: durationSeconds, direction, outcome, phoneNumber
- Rendered as special call bubbles in timeline
- "Play recording" button is NON-FUNCTIONAL (no onClick)

### 11.2 Required Communication Architecture for Standalone

- Real email sending via Supabase Edge Function + SMTP provider
- Real SMS sending via Twilio or similar
- WhatsApp Business API integration (FUTURE)
- Real VoIP integration with call recording storage (FUTURE — StormCall)
- Thread-based conversation management
- Template management with variable substitution
- Communication audit trail (every message logged with agent, timestamp, channel)
- Unassigned message triage with proper org-scoped visibility (FIX: current bug makes unassigned messages invisible)
- Attachment upload via Supabase Storage (not prompt())
- Opt-out management (SMS STOP keyword handling)

---

## PART 12 — Integration Architecture

### 12.1 Existing Integrations

| Integration | Type | Status | Description |
|-------------|------|--------|-------------|
| LeadVerge | Internal Storm app | Mock (cross-app transfer in shared frontend) | Leads handed over to DebtVerge via shared workspace |
| IVA Verge | Internal Storm app | Mock (cross-app transfer) | Cases escalated from DebtVerge DMP to IVA |
| Draft Verge | Internal Storm app | Mock (cross-app transfer) | Cases escalated to draft IVA proposal |
| StormCall | Internal Storm app | Partial (compliance portal shares tables) | Call compliance review, VoIP integration |
| StormSign | Internal Storm app | Not integrated | Document e-signing (referenced but no integration code) |
| StormDrive | Internal Storm app | Not integrated | Document storage (separate module) |
| StormVerge Mail | Internal Storm app | Partial (api-inbound edge function) | Email ingestion |
| Qualify | Internal Storm app | Mock (cross-app transfer) | Client transfer from qualification |
| Knowledge Assistant | Internal Storm app | Partial (drawer component) | AI-powered guidance |
| Payment Gateway | External | MOCK | 5 adapter types, all return fake responses |
| Open Banking | External | Mock (CSV import only) | No real Open Banking provider integration |
| BACS | External | Simplified | Not production BACS standard |

### 12.2 Dependency Classification

**A. MUST BE INTERNAL TO DEBTVERGE:**
- Case management
- SFS construction
- Creditor ledger
- Pro-rata calculations
- Payment scheduling
- Distribution tracking
- Vulnerability assessment
- Benefits checking
- Annual reviews
- Breathing Space tracking
- IVA insolvency (IP, proposals, voting, PoD, distributions)
- Compliance scripting & attestation
- Pathfinder engine
- Solution suitability matrix
- Offer letter generation
- IVA proposal pack generation
- Audit logging
- Tenant provisioning

**B. CAN BE SHARED THROUGH PLATFORM SERVICES (but must not block standalone):**
- Authentication (Supabase Auth — already shared)
- RBAC (Role-Based Access Control)
- Organization management
- Licensing/entitlements
- Document storage (Supabase Storage)
- Background job queue

**C. SHOULD BE A SEPARATE STORM APPLICATION:**
- StormCall (call compliance, VoIP, recording)
- StormSign (document e-signing)
- StormDrive (enterprise cloud drive)
- StormVerge Mail (email ingestion/management)
- Knowledge Assistant (AI guidance)
- LeadVerge (lead generation — already standalone)
- IVA Verge (should become standalone)
- Draft Verge (should become standalone)
- Qualify (should become standalone)

**D. SHOULD BE AN EXTERNAL THIRD-PARTY INTEGRATION:**
- Stripe (payment gateway)
- GoCardless (Direct Debit/BACS)
- Open Banking provider (TrueLayer, Plaid, or similar)
- Twilio (SMS)
- SMTP provider (SendGrid, AWS SES, or similar)
- WhatsApp Business API
- BACS submission service
- Credit reference agencies (Experian, Equifax, TransUnion) — FUTURE

### 12.3 Integration Boundaries for Standalone

The standalone DebtVerge must communicate with other apps through **defined API boundaries** (edge functions), not shared database access or shared frontend:

```
LeadVerge → [handover API] → DebtVerge
DebtVerge → [handover API] → IVA Verge / Draft Verge
DebtVerge → [payment gateway API] → Stripe / GoCardless
DebtVerge → [communication API] → Twilio / SMTP
StormCall → [compliance API] → DebtVerge (call compliance data)
```

---

## PART 13 — Multi-Tenant Architecture

### 13.1 Existing Multi-Tenancy

**Organization model:**
- `organizations` table (id, name, slug, owner_id)
- `organization_users` table (organization_id, user_id, role_id, created_at)
- Each case belongs to an organization via `dv_cases.organization_id`
- Child tables inherit org membership through the parent case
- Payment gateway and cashier tables carry their own `organization_id`

**RLS enforcement:**
- All `debt_*` tables: org-scoped via `dv_cases.organization_id` + `organization_users` membership check, with `is_super_admin()` bypass
- Payment/cashier tables: org-scoped via direct `organization_id` + membership check, NO super-admin bypass
- `debtverge_tenants`: `is_super_admin() OR auth_user_id = auth.uid()`

**Tenant provisioning:**
- 5-step signup wizard creates: tenant record → auth user → organization → RBAC role → membership → profile → licenses → permissions
- Edge function `provision-debtverge-tenant` handles all provisioning

### 13.2 Known Tenant Isolation Issues

1. **Unassigned messages invisible** — `dv_unassigned_messages` with `matched_case_id IS NULL` are invisible to non-super-admin users. Fix: add `organization_id` to the table directly.
2. **Signposting assessments invisible** — `dv_signposting_assessments` with `case_id IS NULL` are invisible. Fix: add `organization_id` to the table.
3. **Inconsistent super-admin bypass** — payment gateway tables don't have `is_super_admin()` bypass while debt tables do. Super admins can't see payment configs across orgs.
4. **`organization_id` nullable on `dv_cases`** — cases without org membership become invisible to everyone except super admins.
5. **`debt_breathing_spaces.user_id`** column persists but is ignored by final RLS — dead column.

### 13.3 Required Multi-Tenant Architecture for Standalone

- Every table must have `organization_id` (not just parent-linked)
- RLS on every table: `is_super_admin() OR org membership check`
- Consistent super-admin bypass across ALL tables
- No nullable `organization_id` on any table (NOT NULL with default from auth context)
- Tenant provisioning via edge function with full setup (org, user, roles, licenses)
- Organization-scoped Supabase Storage buckets
- Organization-scoped real-time channels

---

## PART 14 — Security Requirements

### 14.1 Existing Security Model

**Authentication:**
- Supabase Auth (email/password)
- Session persistence with auto-refresh
- No MFA found
- No password reset flow in DebtVerge-specific code (relies on Supabase defaults)

**Authorization:**
- RLS on all tables (org-scoped)
- `is_super_admin()` function (SECURITY DEFINER, reads `profiles.is_super_admin`)
- Dual-gate entitlement: license + RBAC permission
- Edge functions use service role key (bypass RLS) — no per-request user auth

**Data Protection:**
- Payment methods store gateway tokens only (never raw PAN/CVC) — CORRECT
- Gateway configs store `secret_ref` (name of edge function secret) not actual API keys — CORRECT
- No field-level encryption found
- No data masking for sensitive fields (email, phone visible in plain text)

**Session Handling:**
- Supabase manages JWT sessions
- No session timeout configuration found in DebtVerge code
- No concurrent session limit found

### 14.2 Security Issues to Fix in Standalone

1. **Edge functions have no per-request auth** — all financial edge functions use service role key with no user authentication on the request itself. Must add JWT validation.
2. **Payment gateway is fully mocked** — no real gateway calls. Must implement real Stripe/GoCardless integration.
3. **No MFA** — required for FCA-regulated financial platform
4. **No audit log for data exports** — CSV export has no audit trail
5. **No rate limiting** on edge functions
6. **No input validation** on edge function payloads (beyond basic type checks)
7. **`api-inbound` endpoint is open** — accepts requests with no auth if webhook secret header is absent
8. **No CSRF protection** — relies on SameSite cookies (Supabase default)
9. **No data classification** — all data treated equally, no sensitive data handling policy
10. **No breach detection** — no alerting on suspicious access patterns

### 14.3 Prototype/Demo Logic That Should NOT Be Copied

- `payment-gateway/index.ts` — entirely mock, returns fake tokens/transaction IDs
- `IVADemoCases` — 4 hardcoded demo cases with fake client data
- `generateCaseNumber()` — returns hardcoded `DV-2026-0001` if no cases exist (year hardcoded to 2026)
- BACS file generation — explicitly "simplified", not production standard
- `prompt()` for attachment filenames — not a real file upload
- "Play recording" button — no onClick handler
- "Re-assignment panel coming soon" — placeholder toast
- Action card "[Secure Portal Link]" — placeholder text
- Debtor portal fact-find steps 0-3 hardcoded as "completed"
- `householdSize` hardcoded to 2 in comms queue building
- `debtorPhone` hardcoded to null in comms queue building
- SFS quick-adjust income default of 2150 hardcoded

---

## PART 15 — UI/UX Requirements

### 15.1 Design System

- **Font:** System font stack or Inter (clean, professional)
- **Color palette:** Slate (neutral), Blue (primary), Emerald (success/positive), Amber (warning), Rose (error/vulnerability), Violet (IVA pipeline), Teal (DMP pipeline)
- **Dark mode:** Full dark mode support (class-based)
- **Spacing:** 8px grid system
- **Border radius:** rounded-lg (8px) for inputs, rounded-xl (12px) for cards, rounded-2xl (16px) for modals
- **Shadows:** shadow-sm for cards, shadow-lg for floating elements, shadow-xl for modals
- **Transitions:** 150-200ms for hover states, 300ms for drawer/modal animations

### 15.2 Layout Patterns

- **Workspace shell:** Top bar + left sidebar (case list) + main content (24 tabs)
- **3-column comms:** Left (queue sidebar 280px) + center (thread workspace flex-1) + right (context sidebar 300px, collapsible)
- **Drawers:** Right-side slide-out (max-w-md for compliance, max-w-xl for case detail)
- **Modals:** Center-screen with backdrop blur
- **Toast notifications:** Bottom-center, auto-dismiss after 3s

### 15.3 Interaction Patterns

- Tab-based navigation with pipeline-aware visibility
- Inline status changes (dropdown directly in table rows)
- Inline agent reassignment (dropdown in table)
- Expandable accordion for previous addresses
- Progress bars for fact-find completion
- Skeleton loading states
- Empty states with iconography and guidance text
- Confirmation toasts after every successful action
- Error states with descriptive messages
- Real-time ping animation for new lead indicators

### 15.4 Responsive Design

- Desktop: Full 3-column comms layout, sidebar + content workspace
- Tablet: Collapsible right sidebar, stacked metrics
- Mobile: Bottom tab bar for compliance portal, single-column layouts, horizontal scroll for tables

### 15.5 Accessibility

- All interactive elements must be keyboard accessible
- Form labels must be associated with inputs
- Color contrast must meet WCAG AA (4.5:1 for normal text, 3:1 for large text)
- Status indicators must not rely on color alone (use icons + text)
- Screen reader friendly: aria-labels, semantic HTML

---

## PART 16 — Known Issues to Avoid

### 16.1 Bugs

| Issue | Location | Impact |
|-------|----------|--------|
| `batch-processing` advanceDate bug | `batch-processing/index.ts` | Ignores schedule's actual next_collection_date and frequency, always advances from current date by one month |
| Unassigned messages invisible | `dv_unassigned_messages` RLS | Agents cannot see the queue of messages awaiting manual matching |
| Signposting assessments invisible | `dv_signposting_assessments` RLS | Assessments done before a case exists are invisible |
| Inconsistent super-admin bypass | Payment gateway tables | Super admins can't see payment configs across orgs |
| Dead `user_id` column | `dv_breathing_spaces` | Column persists with DEFAULT auth.uid() but RLS ignores it |
| Dead `caseNumber` field | `CallSearchView` | In formValues but not included in handleSearch |
| Dead transcript search | `CallComplianceRecord` | Search input has no onChange handler |
| Dead `reviews.forEach` | `AdviserQAView` | No-op loop that can't join reviews to advisers |
| Hardcoded year | `generateCaseNumber()` | Returns `DV-2026-0001` with year 2026 hardcoded |
| `householdSize` hardcoded | `TeamInbox` | Always set to 2 regardless of actual data |
| `debtorPhone` hardcoded | `TeamInbox` | Always set to null |
| SFS income default | `DebtorContextSidebar` | Hardcoded to 2150 instead of loaded from case data |

### 16.2 Placeholder/Mock Functionality

| Feature | Status | Required Action |
|---------|--------|----------------|
| Payment gateway | Fully mock | Implement real Stripe/GoCardless |
| BACS file generation | Simplified | Implement production BACS standard |
| Call recording playback | No onClick | Integrate with StormCall or remove |
| Re-assignment panel | Toast placeholder | Implement full reassignment UI |
| Attachment upload | prompt() for filename | Use real file upload via Supabase Storage |
| Action card secure portal link | Placeholder text | Generate real secure portal links |
| Debtor portal fact-find steps | Hardcoded complete | Track actual completion state |
| IVA demo cases | 4 hardcoded mock cases | Remove or gate behind demo flag |
| Open Banking | CSV import only | Integrate real Open Banking provider |
| VoIP call logging | Encoded as internal notes | Integrate with real VoIP provider |

### 16.3 Architectural Problems

1. **Two `bank_transactions` tables** — `debt_bank_transactions` (SFS auto-categorization) and `bank_transactions` (cashier reconciliation). Consolidate or clearly separate.
2. **Two `disbursement_runs` concepts** — `debt_iva_distribution_runs` (IVA-specific) and `disbursement_runs` (cashier BACS output). Consolidate or clearly separate.
3. **No real-time subscriptions** — only one hook (`useComplianceReviews`) uses real-time. Case updates require manual refetch.
4. **No field-level audit trail** — only milestone-level audit logging for case changes.
5. **Cross-app transfers via shared frontend** — cases transfer between apps by switching frontend components, not via API. Must be replaced with handover API.
6. **`is_super_admin()` function** — SECURITY DEFINER that reads `profiles.is_super_admin`. If profiles table is compromised, all RLS is bypassed.

---

## PART 17 — Standalone Build Architecture

### 17.1 Recommended Architecture

```
┌─────────────────────────────────────────────────┐
│              DebtVerge Standalone                │
│                                                  │
│  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │  Vite +  │  │  React + │  │  Tailwind CSS │  │
│  │  TypeScript│ │  Hooks   │  │  (dark mode)  │  │
│  └──────────┘  └──────────┘  └───────────────┘  │
│                                                  │
│  ┌──────────────────────────────────────────┐   │
│  │            Supabase Backend               │   │
│  │  ┌─────────┐ ┌─────────┐ ┌────────────┐  │   │
│  │  │  Auth   │ │ Postgres│ │  Storage   │  │   │
│  │  │ (email/ │ │  (RLS,  │ │ (org-      │  │   │
│  │  │ password)│ │  org-  │ │  scoped)   │  │   │
│  │  │         │ │  scoped)│ │            │  │   │
│  │  └─────────┘ └─────────┘ └────────────┘  │   │
│  │  ┌──────────────────────────────────┐    │   │
│  │  │       Edge Functions             │    │   │
│  │  │  - provision-tenant              │    │   │
│  │  │  - payment-gateway (REAL)        │    │   │
│  │  │  - recurring-collection          │    │   │
│  │  │  - batch-processing              │    │   │
│  │  │  - disbursement-run              │    │   │
│  │  │  - queue-worker                  │    │   │
│  │  │  - handover-receive (NEW)        │    │   │
│  │  │  - handover-send (NEW)           │    │   │
│  │  └──────────────────────────────────┘    │   │
│  └──────────────────────────────────────────┘   │
│                                                  │
│  ┌──────────────────────────────────────────┐   │
│  │         External Integrations            │   │
│  │  Stripe / GoCardless / Twilio / SMTP    │   │
│  └──────────────────────────────────────────┘   │
│                                                  │
│  ┌──────────────────────────────────────────┐   │
│  │      Cross-App API Boundaries            │   │
│  │  ← LeadVerge handover API               │   │
│  │  → IVA Verge / Draft Verge handover API │   │
│  │  ← StormCall compliance API (future)    │   │
│  └──────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

### 17.2 Project Structure

```
debtverge-standalone/
├── package.json
├── vite.config.ts
├── tsconfig.json
├── tailwind.config.js
├── postcss.config.js
├── index.html
├── .env
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── index.css
│   ├── lib/
│   │   ├── supabase.ts
│   │   ├── auth.tsx
│   │   ├── types.ts
│   │   ├── format.ts
│   │   ├── case-hooks.ts          (case CRUD, creditors, SFS, distributions)
│   │   ├── case-context.tsx       (aggregated case master)
│   │   ├── payment-hooks.ts       (gateway, schedules, transactions)
│   │   ├── cashier-hooks.ts       (bank feeds, batches, disbursements)
│   │   ├── compliance-hooks.ts    (scripts, attestations, vulnerability)
│   │   ├── comms-hooks.ts         (communications, threads)
│   │   ├── insolvency-hooks.ts    (IVA, IP, votes, PoD)
│   │   ├── insolvency-docs.ts     (document generators, pathfinder)
│   │   ├── provisioning.ts        (tenant signup)
│   │   ├── gateway-adapters.ts    (payment gateway adapters)
│   │   ├── rbac-hooks.ts          (roles, permissions)
│   │   ├── entitlement-hooks.ts   (licenses, entitlements)
│   │   ├── workspace-hooks.ts     (organizations)
│   │   ├── uk-tax.ts              (tax calculations)
│   │   └── queue-hooks.ts         (background jobs)
│   ├── components/
│   │   ├── Login.tsx
│   │   ├── SignupWizard.tsx
│   │   ├── DebtVergeApp.tsx       (main workspace shell)
│   │   ├── Dashboard.tsx
│   │   ├── CustomerProfile.tsx
│   │   ├── SfsIntake.tsx
│   │   ├── CreditorLedger.tsx
│   │   ├── PayoffForecast.tsx
│   │   ├── PlanComparison.tsx
│   │   ├── Disbursement.tsx
│   │   ├── PaymentSchedule.tsx
│   │   ├── PaymentGateway.tsx
│   │   ├── CashierOps.tsx
│   │   ├── Vulnerability.tsx
│   │   ├── Compliance.tsx
│   │   ├── IVAInsolvency.tsx      (IP, proposal, voting, PoD)
│   │   ├── Pathfinder.tsx
│   │   ├── ProposalGenerator.tsx
│   │   ├── BreathingSpace.tsx
│   │   ├── DebtorPortal.tsx
│   │   ├── comms/
│   │   │   ├── TeamInbox.tsx
│   │   │   ├── ThreadQueueSidebar.tsx
│   │   │   ├── ActiveThreadWorkspace.tsx
│   │   │   ├── DebtorContextSidebar.tsx
│   │   │   ├── ComplianceOverlay.tsx
│   │   │   └── shared.ts
│   │   └── ui.tsx                 (shared UI components)
│   └── vite-env.d.ts
├── supabase/
│   ├── migrations/
│   │   ├── 001_core_schema.sql
│   │   ├── 002_payments_negotiation.sql
│   │   ├── 003_customer_profile.sql
│   │   ├── 004_vulnerability_benefits.sql
│   │   ├── 005_bank_transactions_reviews.sql
│   │   ├── 006_tenant_provisioning.sql
│   │   ├── 007_iva_insolvency.sql
│   │   ├── 008_signposting_contributions.sql
│   │   ├── 009_communications.sql
│   │   ├── 010_compliance.sql
│   │   ├── 011_payment_schedule.sql
│   │   ├── 012_breathing_space.sql
│   │   ├── 013_payment_gateway.sql
│   │   ├── 014_cashier_operations.sql
│   │   └── 015_handover_api.sql   (NEW)
│   └── functions/
│       ├── provision-tenant/
│       ├── payment-gateway/
│       ├── recurring-collection/
│       ├── batch-processing/
│       ├── disbursement-run/
│       ├── queue-worker/
│       ├── handover-receive/      (NEW)
│       └── handover-send/         (NEW)
└── README.md
```

---

## PART 18 — Build Order

### Phase 1: Foundation
1. Create Vite + React + TypeScript project
2. Set up Tailwind CSS with dark mode
3. Configure Supabase client
4. Create auth context (email/password)
5. Build login screen
6. Create core database schema (dv_cases, dv_creditors, dv_sfs_entries, dv_distributions, dv_audit_log)
7. Implement RLS policies (org-scoped)
8. Build case list + case selection

### Phase 2: Case Management Core
9. Build customer profile tab
10. Build SFS intake tab
11. Build creditor ledger tab
12. Implement pro-rata calculation engine
13. Build payoff forecast tab
14. Build plan comparison tab
15. Implement solution suitability matrix
16. Implement Pathfinder engine

### Phase 3: Payments & Distributions
17. Create payment tables (dv_payments, dv_payment_transactions)
18. Build payment logging with automatic distribution splits
19. Build payment schedule tab
20. Create payment gateway tables
21. Implement payment gateway adapter pattern (REAL Stripe integration)
22. Build recurring collection edge function
23. Build payment gateway tab

### Phase 4: Compliance & Vulnerability
24. Create vulnerability tables
25. Build vulnerability assessment tab
26. Implement FCA vulnerability flagging
27. Create compliance attestation tables
28. Build compliance scripting overlay
29. Implement objection/FAQ database
30. Build benefits checking

### Phase 5: Communications
31. Create communications tables
32. Build 3-column comms workspace
33. Implement FCA message templates
34. Build unassigned message triage
35. Implement SFS quick-adjust in context sidebar

### Phase 6: IVA / Insolvency
36. Create IVA tables (IP details, proposals, votes, PoD)
37. Build IVA insolvency tabs
38. Implement IVA proposal pack generation
39. Implement distribution run calculator
40. Build creditor voting with MOC threshold

### Phase 7: Cashier Operations
41. Create cashier tables
42. Build bank feeds management
43. Build batch processing
44. Build disbursement run lifecycle
45. Build ledger locking
46. Implement queue worker edge function

### Phase 8: Breathing Space & Annual Reviews
47. Create breathing space tables
48. Build breathing space tracker
49. Create annual review tables
50. Build annual review snapshots

### Phase 9: Tenant & Portal
51. Create tenant provisioning tables
52. Build 5-step signup wizard
53. Build provision-tenant edge function
54. Build debtor self-service portal

### Phase 10: Integrations & Handovers
55. Create handover API tables
56. Build handover-receive edge function
57. Build handover-send edge function
58. Wire LeadVerge handover receiving
59. Wire IVA Verge / Draft Verge handover sending

### Phase 11: Polish & Security
60. Implement real-time subscriptions on case changes
61. Add MFA support
62. Add audit logging for data exports
63. Implement real document upload via Supabase Storage
64. Add document preview
65. Production BACS file format
66. Edge function JWT validation
67. Rate limiting on edge functions
68. Input validation on all edge function payloads

---

## PART 19 — Acceptance Criteria

### 19.1 Core Functionality
- [ ] User can sign up as a new debt management firm via the 5-step wizard
- [ ] User can log in with email/password
- [ ] Advisor can create a new case with auto-generated case number
- [ ] Advisor can complete a full fact-find (customer profile, SFS, creditors)
- [ ] System calculates disposable income automatically from SFS entries
- [ ] System calculates pro-rata distributions across creditors
- [ ] Advisor can log a payment and system auto-splits across creditors
- [ ] Advisor can change case status with audit trail
- [ ] Advisor can switch solution pipeline with audit trail and data preservation
- [ ] Pathfinder engine recommends a solution route based on case data
- [ ] Solution suitability matrix scores all 5 solutions

### 19.2 Compliance
- [ ] Advisor must attest to FCA disclaimers before proceeding with certain actions
- [ ] Attestation records are immutable (INSERT-only)
- [ ] Vulnerability flags can be created with FCA categories
- [ ] Vulnerability flags are visible in comms sidebar
- [ ] Compliance overlay auto-detects appropriate script based on case status
- [ ] All case status changes are logged in audit trail with actor and timestamp

### 19.3 Communications
- [ ] Advisor can send email, SMS, WhatsApp, and internal notes
- [ ] FCA templates are available with variable substitution
- [ ] Unassigned inbound messages are visible to agents (FIX of existing bug)
- [ ] Advisor can assign threads to themselves
- [ ] SFS quick-adjust updates disposable income in real-time
- [ ] VoIP call logs appear in conversation timeline

### 19.4 Payments
- [ ] Payment gateway integration works with real Stripe (not mock)
- [ ] Recurring payment schedules process automatically on due date
- [ ] Failed payments are retried up to max_retries
- [ ] Expired cards are detected and schedules suspended
- [ ] Payment reconciliation shows variance
- [ ] Disbursement waterfall allocates funds in correct priority order

### 19.5 Multi-Tenancy
- [ ] Users in Organization A cannot see cases in Organization B
- [ ] Super admin can see all organizations
- [ ] Each table has organization_id and RLS enforces isolation
- [ ] Tenant provisioning creates org, user, roles, and licenses

### 19.6 Security
- [ ] All tables have RLS enabled
- [ ] All edge functions validate JWT tokens
- [ ] No raw PAN/CVC stored in database
- [ ] Audit logs are INSERT-only
- [ ] Passwords meet minimum complexity (8+ chars, uppercase, number)

### 19.7 UI/UX
- [ ] Dark mode works across all screens
- [ ] Responsive layout works on mobile, tablet, desktop
- [ ] All interactive elements are keyboard accessible
- [ ] Loading states show skeleton/placeholder
- [ ] Empty states show guidance
- [ ] Toast notifications confirm actions
- [ ] Error states show descriptive messages

---

## MASTER RECREATION PROMPT

> The following prompt can be given to Bolt to create the standalone DebtVerge application from scratch.

```
Build a standalone DebtVerge application — an enterprise debt-management platform for UK FCA-regulated debt management firms. This is a completely separate project with its own codebase, deployment, and URL. It must operate independently while having defined API boundaries for cross-app communication.

TECH STACK: Vite + React + TypeScript + Tailwind CSS (dark mode) + Supabase (auth, database, edge functions, storage). Use lucide-react for icons. Use the @/ path alias mapping to src/.

AUTHENTICATION: Supabase email/password. No social providers. Email confirmation OFF.

DATABASE: 44 tables with organization-scoped RLS on every table. Use dv_ prefix for all tables. Every table must have organization_id (NOT NULL). RLS pattern: is_super_admin() OR org membership check via organization_users table. Audit log tables must be INSERT-only (no UPDATE/DELETE policies).

The application has these major areas:

1. TENANT SIGNUP WIZARD (5 steps): Company details with FCA FRN validation → Plan tier selection (Starter £299/Professional £899/Enterprise £2499) → Add-ons (seats, Open Banking credits, SMS) → Checkout with VAT → Automated provisioning (edge function creates org, auth user, RBAC role, licenses).

2. MAIN WORKSPACE: Top bar with pipeline view modes (DMP/IVA/Draft/All), search, filters. Left sidebar with case list. Main content with 24 tabs (visibility depends on active pipeline): Dashboard, Customer Profile, SFS Intake, Creditor Ledger, Payoff Forecast, Plan Comparison, Disbursement, Payment Schedule, Payment Gateway, Cashier Ops, Vulnerability, Compliance, IVA tabs (Nominee Proposal, Interim Order, Moratorium, IP Nominee, Documents, Creditor Voting, Proof of Debt), Pathfinder, Proposal Generator, Inflight, Breathing Space, Communications.

3. CUSTOMER PROFILE: Personal info (name, email, phones), address with previous address history, household composition (adults, children), tenure type, property details. SFS allowance thresholds computed from household.

4. SFS INTAKE: Income/expense entries in 4 categories (income, essential_expense, discretionary_expense, debt_repayment). Automatic disposable income calculation. Pro-rata distribution preview.

5. CREDITOR LEDGER: Creditor list with debt types, balances, interest rates, pro-rata amounts, priority flags. Negotiation timeline per creditor. Offer letter generation (full UK DMP letter text).

6. PAYMENTS: Log monthly payments with automatic shortfall detection and automatic pro-rata split across creditors. Payment schedule configuration (weekly/fortnightly/four_weekly/monthly). Scheduled transaction generation with status tracking (scheduled/awaiting_clearance/cleared/missed/bounced/overdue).

7. PAYMENT GATEWAY: White-label adapter pattern (Stripe, GoCardless, Open Banking, Merchant Acquirer, Custom). Tokenised payment methods (never raw PAN/CVC). Recurring payment schedules with retry logic. Gateway transaction logging. Expired card detection. Reconciliation with variance calculation. MUST USE REAL Stripe integration (not mock).

8. CASHIER OPERATIONS (6 sub-tabs): Bank feeds (open_banking/csv_import/manual), Batch processing (card/direct_debit/mixed), Exceptions triage, Disbursement runs (draft→approved→generated→submitted→settled) with BACS/Faster Payments/SEPA output, Audit trail with ledger locking, Queue monitor.

9. VULNERABILITY: 16-item weighted checklist across 4 categories (Financial Capability, Health Conditions, Life Events, Resilience). Score 0-100 with level (none/low/medium/high/critical). Benefits entitlement checks (12 UK benefit types). FCA vulnerability flags (4 categories: health/life_events/resilience/capability, 16 sub-categories).

10. COMPLIANCE: 6 FCA compliance script types (initial_onboarding, solution_selection, iva_proposal_review, creditor_negotiation, annual_review, closure). Each script has 4-5 steps and 1-3 mandatory disclaimers. Advisor must attest to reading disclaimers verbatim — creates immutable audit record. Objection/FAQ database with 12 pre-approved responses. Vulnerability flagging modal with FCA categories.

11. COMMUNICATIONS (3-column layout): Left: triage folders (My Assigned, Unassigned, FCA Urgent, Closed), department filters, search, thread list. Center: conversation timeline with VoIP call bubbles, multi-channel composer (email/SMS/WhatsApp/internal notes) with FCA templates and action cards. Right: debtor snapshot, SFS quick-adjust calculator, quick actions (VoIP call, 30-day breather, schedule review), safeguarding status.

12. IVA / INSOLVENCY: IP details (nominee/supervisor), document checklist (payslip/bank_statement/id_kyc/tax_record/utility_bill/creditor_statement), IVA proposals (duration, dividend, equity treatment, protocol compliance), creditor voting (accept/reject/modify with 75% MOC threshold), proof of debt (claimed/admitted amounts), IVA contributions, distribution runs with fee deduction, IVA proposal pack generation (contribution table, Nominee's Report, Protocol Terms, fee schedule).

13. PATHFINDER ENGINE: Automated solution routing scoring IVA/DMP/DRO/Bankruptcy (0-100). Falls back to signposting if best score < 30. Returns recommended route, confidence, reasons, all scores, estimated duration and cost.

14. BREATHING SPACE: Standard (60-day) and Mental Health Crisis moratorium tracking. Account lock, eligibility checking, review tasks, AMHP evidence, nominated contact, cancellation with reason.

15. ANNUAL REVIEWS: 12-month SFS snapshots with income/housing change detection, comparison audit log, sequential review numbering.

16. DEBTOR SELF-SERVICE PORTAL: Fact-find progress, document upload, signposting self-assessment, free advice resources.

17. CROSS-APP HANDOVER API: Edge functions to receive case handovers from LeadVerge and send handovers to IVA Verge / Draft Verge. Handover records with payload snapshot, status (pending/accepted/rejected), acceptance tracking.

EDGE FUNCTIONS NEEDED:
- provision-tenant (tenant onboarding)
- payment-gateway (REAL Stripe/GoCardless — not mock)
- recurring-collection (process due, retry failed, detect expired)
- batch-processing (create, execute, retry, auto-match)
- disbursement-run (create, generate with production BACS format)
- queue-worker (7 job types: batch_collection, disbursement_run, bank_reconciliation, recurring_collection, retry_failed, expired_card_check, ledger_posting)
- handover-receive (NEW — receive from LeadVerge)
- handover-send (NEW — send to IVA/Draft Verge)

KNOWN ISSUES TO AVOID:
- Do NOT use prompt() for file uploads — use real Supabase Storage
- Do NOT mock the payment gateway — implement real Stripe integration
- Do NOT hardcode householdSize to 2 or debtorPhone to null
- Do NOT hardcode the year in case number generation — use current year
- Do NOT make unassigned messages invisible — add organization_id to the unassigned messages table
- Do NOT use simplified BACS format — implement production standard
- Do NOT create demo/seed cases in production
- All edge functions MUST validate JWT tokens (not just use service role key)
- All audit log tables MUST be INSERT-only with no UPDATE or DELETE policies
- Every table MUST have organization_id as NOT NULL
- Implement real-time subscriptions on case changes (not just manual refetch)

DESIGN:
- Professional, clean, enterprise-grade UI
- Full dark mode support
- Slate (neutral), Blue (primary), Emerald (success), Amber (warning), Rose (error/vulnerability), Violet (IVA), Teal (DMP)
- 8px spacing grid
- Rounded-lg (8px) inputs, rounded-xl (12px) cards, rounded-2xl (16px) modals
- Skeleton loading states, empty states with guidance, toast notifications
- Responsive: desktop (full 3-column), tablet (collapsible sidebar), mobile (single column)

Build in this order:
1. Foundation (project setup, auth, core schema, case list)
2. Case management (profile, SFS, creditors, pro-rata, forecast, comparison)
3. Payments (payment logging, scheduling, gateway with REAL Stripe)
4. Compliance (scripts, attestations, vulnerability, benefits)
5. Communications (3-column workspace, templates, unassigned triage)
6. IVA/Insolvency (IP, proposals, voting, PoD, distributions)
7. Cashier operations (bank feeds, batches, disbursements, ledger locks)
8. Breathing space & annual reviews
9. Tenant signup wizard & debtor portal
10. Cross-app handover API
11. Security hardening (MFA, JWT validation, rate limiting, real document upload)

Start with Phase 1: Create the Vite project, set up Supabase, build the auth flow and login screen, create the core database schema (dv_cases, dv_creditors, dv_sfs_entries, dv_distributions, dv_audit_log) with org-scoped RLS, and build the case list view.
```

---

*End of specification.*
