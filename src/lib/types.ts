// ============================================================
// Debt Verge Types
// ============================================================

export type DebtCaseStatus = "intake" | "sfs_pending" | "sfs_approved" | "creditor_pack_sent" | "payment_schedule_active" | "completed" | "closed";
export type DebtPlanType = "dmp" | "iva" | "dro" | "settlement" | "pending";
export type DebtType = "credit_card" | "personal_loan" | "mortgage_arrears" | "utility_arrears" | "council_tax" | "overdraft" | "store_card" | "hire_purchase" | "other";
export type DebtSfsCategory = "income" | "essential_expense" | "discretionary_expense" | "debt_repayment";
export type DebtDistributionStatus = "scheduled" | "processing" | "sent" | "failed";

// Customer profile tenure types
export type DebtTenureType = "owned" | "private_rented" | "social_rented" | "council" | "leased" | "living_with_family";

// Vulnerability screening
export type DebtVulnerabilityLevel = "none" | "low" | "medium" | "high" | "critical";

// Negotiation event types for the disbursement & negotiation timeline
export type DebtNegotiationEventType =
  | "offer_pack_sent"
  | "hold_placed"
  | "interest_freeze_accepted"
  | "interest_freeze_rejected"
  | "full_offer_accepted"
  | "full_offer_rejected"
  | "counter_offer_received"
  | "follow_up_call"
  | "winding_up_threat"
  | "agreement_reached";

export interface DebtPayment {
  id: string;
  case_id: string;
  amount: number;
  payment_date: string;
  expected_amount: number;
  is_shortfall: boolean;
  shortfall_amount: number;
  reference: string | null;
  created_at: string;
}

// ============================================================
// Client Payment Schedule & Transaction Ledger
// ============================================================

export type PaymentFrequency = "weekly" | "fortnightly" | "four_weekly" | "monthly" | "specific_date";

export type PaymentScheduleDay = number | "last_working_day" | "monday";

export interface PaymentSchedule {
  frequency: PaymentFrequency;
  preferredPaymentDay: PaymentScheduleDay;
  installmentAmount: number;
  nextDueDate: string;
}

export type PaymentTransactionStatus =
  | "scheduled"
  | "awaiting_clearance"
  | "cleared"
  | "missed"
  | "bounced"
  | "overdue";

export interface PaymentTransaction {
  id: string;
  dueDate: string;
  amountDue: number;
  amountPaid: number;
  status: PaymentTransactionStatus;
  failureReason?: string;
  clearedDate?: string;
}

export interface DebtNegotiationEvent {
  id: string;
  case_id: string;
  creditor_id: string;
  event_type: DebtNegotiationEventType;
  event_label: string;
  notes: string | null;
  actor: string | null;
  created_at: string;
}

export interface DebtCase {
  id: string;
  user_id: string;
  case_number: string;
  debtor_name: string;
  debtor_reference: string | null;
  status: DebtCaseStatus;
  plan_type: DebtPlanType;
  monthly_disposable_income: number;
  total_debt: number;
  recovery_rate_target: number;
  next_distribution_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  creditors?: DebtCreditor[];
  audit_log?: DebtAuditEntry[];
  payment_frequency?: PaymentFrequency | null;
  preferred_payment_day?: string | null;
  installment_amount?: number | null;
  next_due_date?: string | null;
  assigned_to?: string | null;
  organization_id?: string | null;
}

export interface DebtCreditor {
  id: string;
  case_id: string;
  creditor_name: string;
  debt_type: DebtType;
  account_reference: string | null;
  current_balance: number;
  interest_rate: number;
  minimum_payment: number | null;
  pro_rata_amount: number;
  is_priority: boolean;
  settlement_offer: number | null;
  created_at: string;
}

export interface DebtSfsEntry {
  id: string;
  case_id: string;
  category: DebtSfsCategory;
  label: string;
  amount: number;
  is_recurring: boolean;
  created_at: string;
}

export interface DebtDistribution {
  id: string;
  case_id: string;
  creditor_id: string;
  distribution_date: string;
  amount: number;
  status: DebtDistributionStatus;
  reference: string | null;
  created_at: string;
}

export interface DebtAuditEntry {
  id: string;
  case_id: string;
  milestone: string;
  description: string | null;
  actor: string | null;
  created_at: string;
  action?: "insert" | "update" | "void" | "delete" | null;
  table_name?: string | null;
  old_value?: Record<string, unknown> | null;
  new_value?: Record<string, unknown> | null;
}

export interface DebtCustomerProfile {
  id: string;
  case_id: string;
  full_name: string | null;
  primary_email: string | null;
  landline_phone: string | null;
  mobile_phone: string | null;
  work_phone: string | null;
  address_street: string | null;
  address_city: string | null;
  address_postcode: string | null;
  time_at_address_years: number;
  time_at_address_months: number;
  household_adults: number;
  household_children_under_16: number;
  household_children_16_to_18: number;
  tenure_type: DebtTenureType | null;
  property_value: number | null;
  outstanding_mortgage_or_rent: number | null;
  monthly_rent_or_mortgage: number | null;
  landlord_lender_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface DebtPreviousAddress {
  id: string;
  case_id: string;
  address_line: string;
  time_at_address: string | null;
  created_at: string;
}

export interface DebtVulnerabilityAssessment {
  id: string;
  case_id: string;
  fc_low_literacy: boolean;
  fc_no_bank_account: boolean;
  fc_recent_benefit_change: boolean;
  fc_income_drop: boolean;
  hc_mental_health: boolean;
  hc_physical_disability: boolean;
  hc_long_term_illness: boolean;
  hc_cognitive_impairment: boolean;
  le_recent_bereavement: boolean;
  le_relationship_breakdown: boolean;
  le_job_loss: boolean;
  le_pregnancy_new_child: boolean;
  rs_no_support_network: boolean;
  rs_language_barrier: boolean;
  rs_digital_exclusion: boolean;
  rs_housing_insecurity: boolean;
  vulnerability_score: number;
  vulnerability_level: DebtVulnerabilityLevel;
  preferred_comm_channel: string;
  priority_flag: boolean;
  notes: string | null;
  assessed_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface DebtBenefitsCheck {
  id: string;
  case_id: string;
  benefit_type: string;
  label: string;
  eligible: boolean;
  estimated_monthly: number;
  confirmed: boolean;
  notes: string | null;
  created_at: string;
}

// ============================================================
// Breathing Space & Mental Health Crisis Moratorium
// ============================================================

export type BreathingSpaceType = "standard" | "mental_health_crisis";
export type BreathingSpaceStatus = "active" | "expired" | "cancelled";

export interface BreathingSpaceReviewTask {
  id: string;
  label: string;
  triggerDay: number;
  completed: boolean;
  completedAt: string | null;
}

export interface BreathingSpaceEligibilityChecks {
  noActiveInLast12Months: boolean;
  residentEnglandWales: boolean;
  noActiveIvaDro: boolean;
  checkedAt: string;
}

export interface BreathingSpace {
  id: string;
  case_id: string;
  user_id: string;
  moratorium_type: BreathingSpaceType;
  status: BreathingSpaceStatus;
  start_date: string;
  standard_end_date: string | null;
  treatment_end_date: string | null;
  post_treatment_exit_date: string | null;
  amhp_evidence_file_name: string | null;
  amhp_evidence_url: string | null;
  nominated_contact_name: string | null;
  nominated_contact_phone: string | null;
  nominated_contact_email: string | null;
  nominated_contact_relationship: string | null;
  included_creditor_ids: string[];
  eligibility_checks: BreathingSpaceEligibilityChecks;
  review_tasks: BreathingSpaceReviewTask[];
  account_lock_active: boolean;
  cancelled_reason: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DebtBankTransaction {
  id: string;
  case_id: string;
  transaction_date: string;
  description: string;
  amount: number;
  merchant_hint: string | null;
  auto_category: DebtSfsCategory;
  auto_label: string;
  manual_category: DebtSfsCategory | null;
  manual_label: string | null;
  confidence: string;
  imported_to_sfs: boolean;
  sfs_entry_id: string | null;
  created_at: string;
}

export type DebtAnnualReviewStatus = "pending" | "in_progress" | "completed" | "overdue";

export interface DebtAnnualReview {
  id: string;
  case_id: string;
  review_number: number;
  review_date: string;
  review_due_date: string;
  status: DebtAnnualReviewStatus;
  snapshot_income: number;
  snapshot_essential_expenses: number;
  snapshot_discretionary_expenses: number;
  snapshot_disposable_income: number;
  snapshot_total_debt: number;
  snapshot_property_value: number | null;
  snapshot_tenure_type: string | null;
  previous_review_id: string | null;
  income_change: number;
  housing_change: boolean;
  audit_log: Record<string, unknown>;
  completed_at: string | null;
  created_at: string;
}

// ============================================================
// Debt Verge Tenant Sign-Up & Provisioning
// ============================================================

export type DebtVergePlanTier = "starter" | "professional" | "enterprise";
export type DebtVergeBillingCycle = "monthly" | "annual";
export type DebtVergeSubscriptionStatus = "trial" | "active" | "suspended" | "cancelled";
export type DebtVergeProvisioningStatus = "pending" | "in_progress" | "complete" | "failed";

export interface DebtVergeTenant {
  id: string;
  company_name: string;
  fca_frn: string;
  admin_first_name: string;
  admin_last_name: string;
  admin_email: string;
  admin_mobile: string;
  auth_user_id: string | null;
  plan_tier: DebtVergePlanTier;
  billing_cycle: DebtVergeBillingCycle;
  base_price_gbp: number;
  additional_seats: number;
  open_banking_credits: number;
  sms_pack_enabled: boolean;
  subtotal_gbp: number;
  vat_gbp: number;
  total_gbp: number;
  subscription_status: DebtVergeSubscriptionStatus;
  provisioning_status: DebtVergeProvisioningStatus;
  tenant_slug: string | null;
  workspace_url: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================
// Organization / Brand Types
// ============================================================

export interface Organization {
  id: string;
  name: string;
  created_at?: string;
  updated_at?: string;
}

export interface Brand {
  id: string;
  name: string;
  brand_color: string;
  return_address: string | null;
  currency: string;
  created_at?: string;
  updated_at?: string;
}

// ============================================================
// Order / Fulfillment Types
// ============================================================

export type OrderStatus = "paid" | "processing" | "on-hold" | "refunded" | "cancelled" | "failed";

export type FulfillmentStatus = "unfulfilled" | "packed" | "shipped" | "delivered";

export type BrandApiStatus = "active" | "pending" | "error";

export interface Order {
  id: string;
  woo_order_id: string | null;
  brand_id: string | null;
  customer_email: string | null;
  payment_method: string | null;
  order_date: string | null;
  items_count: number | null;
  total_amount: string | number;
  currency: string | null;
  status: OrderStatus;
  fulfillment_status: FulfillmentStatus | null;
  fraud_flag: boolean | null;
  fraud_reason: string | null;
  priority: number | null;
  tracking_number: string | null;
  tracking_carrier: string | null;
  shipping_address: Record<string, unknown> | null;
  billing_address: Record<string, unknown> | null;
  created_at?: string;
  updated_at?: string;
}

// ============================================================
// Channel / Helpdesk Types
// ============================================================

export type ChannelKind = "woocommerce" | "wholesale" | "marketplace" | "pos" | "live_chat" | "email" | "web_form" | "social_dm";

export type ChannelStatus = "active" | "syncing" | "error" | "inactive";

export type ChannelDirection = "bidirectional" | "inbound" | "outbound";

export type ChannelType = "sales" | "support";

export interface Channel {
  id: string;
  name: string;
  brand_id: string | null;
  kind: ChannelKind;
  channel_type: ChannelType;
  platform: string | null;
  status: ChannelStatus;
  direction: ChannelDirection;
  config: Record<string, unknown> | null;
  assigned_team: string | null;
  last_synced_at: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface ChannelWithBrand extends Channel {
  brand?: Brand | null;
}

export type TicketStatus = "new" | "open" | "pending_customer" | "on_hold" | "solved" | "spam";

export type TicketPriority = "urgent" | "high" | "medium" | "low";

export type AgentRole = "admin" | "supervisor" | "agent";

export type AgentStatus = "online" | "offline" | "away";

export type TicketSenderType = "agent" | "system" | "customer";

export interface CustomStatus {
  id: string;
  name: string;
  color: string;
}

export interface Ticket {
  id: string;
  subject: string;
  customer_email: string | null;
  channel_id: string | null;
  brand_id: string | null;
  priority: TicketPriority;
  status: TicketStatus;
  custom_status_id: string | null;
  created_at: string;
  updated_at: string;
  group_id: string | null;
  assigned_agent_id: string | null;
  sla_deadline: string | null;
  tags: string[] | null;
  customer_metadata: Record<string, unknown> | null;
}

export interface TicketWithBrand extends Ticket {
  channel?: Channel | null;
  brand?: Brand | null;
  custom_status?: CustomStatus | null;
}

export interface TicketMessage {
  id: string;
  ticket_id: string;
  message: string;
  sender_type: TicketSenderType;
  sender_email: string | null;
  is_internal: boolean | null;
  created_at: string;
  delivery_status: string | null;
}

export interface CannedReply {
  id: string;
  title: string;
  body: string;
  category: string | null;
}

// ============================================================
// Agent / Desk Admin Types
// ============================================================

export interface AgentGroup {
  id: string;
  name: string;
  color: string;
  description: string | null;
  member_emails: string[];
}

export interface AgentProfile {
  email: string;
  display_name: string;
  role: AgentRole;
  max_concurrent: number;
  group_id: string | null;
  working_hours: Record<string, { start: string; end: string } | null> | null;
  status: AgentStatus;
  notification_settings: { sound: boolean; browser: boolean; email: boolean } | null;
}

export interface AgentProfileWithGroup extends AgentProfile {
  id: string;
  last_seen_at: string | null;
  group?: AgentGroup | null;
}

export interface SlaRule {
  id: string;
  name: string;
  priority: TicketPriority;
  first_response_mins: number;
  resolution_mins: number;
}

export interface EscalationRule {
  id: string;
  team_id: string;
  unassigned_minutes: number;
  escalate_to: TicketPriority;
  notify_lead: boolean;
  active: boolean;
}

export interface EscalationRuleWithGroup extends EscalationRule {
  team?: AgentGroup | null;
}

// ============================================================
// Sign / E-Document Types
// ============================================================

export type DocumentStatus = "draft" | "sent" | "viewed" | "signed" | "rejected" | "expired";

export type FieldTypeEnum = "signature" | "initials" | "date_signed" | "text_input" | "checkbox" | "dropdown" | "radio" | "full_name" | "email" | "company" | "title";

export type RoutingMode = "any_order" | "sequential";

export type DocumentSignerStatus = "pending" | "viewed" | "signed" | "rejected";

export interface SignableBrandSettings {
  id: string;
  organization_id: string;
  company_name: string;
  brand_logo_url: string | null;
  primary_color: string;
  accent_color: string;
  email_footer_text: string | null;
  redirect_success_url: string | null;
}

export interface DocumentSigner {
  id: string;
  document_id: string;
  role_name: string;
  signer_name: string;
  signer_email: string;
  signing_order: number;
  status: DocumentSignerStatus;
  signed_at: string | null;
}

export interface DocumentField {
  id: string;
  document_id: string;
  field_type: FieldTypeEnum;
  role_name: string;
  signer_id: string | null;
  x_position: number;
  y_position: number;
  width: number;
  height: number;
  label: string | null;
  is_required: boolean;
  page_number: number;
  validation_rule: string | null;
  options: string[] | null;
}

export interface DocumentFieldWithSigner extends DocumentField {
  signer?: DocumentSigner | null;
  field_value: string | null;
  completed_at: string | null;
}

export interface EDocument {
  id: string;
  organization_id: string;
  title: string;
  document_pdf_url: string | null;
  status: DocumentStatus;
  routing_mode: RoutingMode | null;
  reminder_interval_days: number | null;
  expires_at: string | null;
  completed_at: string | null;
  document_checksum: string | null;
  created_at: string;
  updated_at: string;
}

export interface EDocumentWithRelations extends EDocument {
  organization?: Organization | null;
  signers?: DocumentSigner[] | null;
}

export interface DocumentAuditEvent {
  id: string;
  document_id: string;
  event_type: string;
  description: string;
  signer_id: string | null;
  ip_address: string | null;
  checksum: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface DocumentAuditEventWithRelations extends DocumentAuditEvent {
  document?: EDocument | null;
  signer?: DocumentSigner | null;
}

export interface DocumentTemplateField {
  id: string;
  template_id: string;
  role_name: string;
  field_type: FieldTypeEnum;
  page_number: number;
  x_position: number;
  y_position: number;
  width: number | null;
  height: number | null;
  label: string | null;
  is_required: boolean;
  validation_rule: string | null;
}

export interface DocumentTemplate {
  id: string;
  organization_id: string;
  title: string;
  description: string | null;
  template_pdf_url: string | null;
  default_signers: { role_name: string }[];
  created_at: string;
  updated_at: string;
}

export interface DocumentTemplateWithFields extends DocumentTemplate {
  organization?: Organization | null;
  fields?: DocumentTemplateField[] | null;
}

// ============================================================
// Freelancer / Contract / Invoice Types
// ============================================================

export type ContractStatus = "draft" | "pending_signature" | "active" | "completed" | "terminated";

export type InvoiceStatus = "draft" | "submitted" | "under_review" | "approved" | "paid" | "rejected";

export type ContractMilestoneStatus = "pending" | "in_progress" | "submitted_for_review" | "approved" | "paid";

export type PaymentMethodType = "stripe_direct" | "paypal" | "bank_transfer_wire" | "wise";

export type PaymentMethodVerificationStatus = "verified" | "pending" | "failed";

export type FreelancerStatus = "pending_verification" | "vetted" | "active" | "suspended";

export interface FreelancerProfile {
  id: string;
  headline: string | null;
  status: FreelancerStatus;
  skills: string[] | null;
  hourly_rate: number | null;
  portfolio_url: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface Contract {
  id: string;
  organization_id: string;
  freelancer_id: string | null;
  contract_title: string;
  total_value: number;
  terms_body: string | null;
  status: ContractStatus;
  signed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContractWithRelations extends Contract {
  organization?: Organization | null;
  freelancer?: FreelancerProfile | null;
}

export interface ContractMilestone {
  id: string;
  contract_id: string;
  title: string;
  amount: number;
  status: ContractMilestoneStatus;
  due_date: string | null;
  deliverable_link: string | null;
  description: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContractMilestoneWithContract extends ContractMilestone {
  contract?: ContractWithRelations | null;
}

export interface Invoice {
  id: string;
  invoice_number: string;
  freelancer_id: string;
  organization_id: string;
  contract_id: string | null;
  payment_method_id: string | null;
  subtotal: number;
  tax_amount: number;
  total_amount: number;
  status: InvoiceStatus;
  notes: string | null;
  submitted_at: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface InvoiceWithRelations extends Invoice {
  freelancer?: FreelancerProfile | null;
  organization?: Organization | null;
  contract?: ContractWithRelations | null;
  payment_method?: FreelancerPaymentMethod | null;
}

export interface InvoiceLineItem {
  id: string;
  invoice_id: string;
  milestone_id: string | null;
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
  created_at: string;
}

export interface FreelancerPaymentMethod {
  id: string;
  freelancer_id: string;
  type: PaymentMethodType;
  account_holder_name: string;
  account_identifier: string;
  is_default: boolean;
  swift_bic: string | null;
  billing_address: string | null;
  verification_status: PaymentMethodVerificationStatus | null;
  created_at: string;
}

// ============================================================
// Talent / Job Posting Types
// ============================================================

export interface JobPosting {
  id: string;
  organization_id: string;
  title: string;
  description: string;
  category: string;
  required_skills: string[];
  budget_range: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface JobPostingWithOrg extends JobPosting {
  organization?: Organization | null;
}

// ============================================================
// Project / Task Types
// ============================================================

export type ProjectStatus = "planning" | "active" | "on_hold" | "completed" | "archived";

export type TaskStatus = "backlog" | "todo" | "in_progress" | "in_review" | "done";

export type TaskPriority = "low" | "medium" | "high" | "urgent";

export interface Project {
  id: string;
  title: string;
  organization_id: string;
  status: ProjectStatus;
  created_at?: string;
  updated_at?: string;
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  estimated_hours: number | null;
  actual_hours: number | null;
  due_date: string | null;
  assignee_id: string | null;
  project_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskWithProject extends Task {
  project?: { id: string; title: string } | null;
}

// ============================================================
// Social Media Types
// ============================================================

export type SocialPlatform = "instagram" | "facebook" | "twitter" | "linkedin" | "tiktok" | "youtube" | "pinterest";

export type SocialPostStatus = "draft" | "pending_approval" | "scheduled" | "published" | "failed";

export type SocialAspectRatio = "square_1_1" | "portrait_9_16" | "landscape_16_9" | "portrait_4_5" | "landscape_4_5";

export type SocialMediaType = "image" | "video";

export type SocialConnectionStatus = "connected" | "expired" | "disconnected";

export type SocialCampaignStatus = "draft" | "active" | "paused" | "completed" | "archived";

export type SocialListeningStatus = "active" | "paused";

// ============================================================
// Email Marketing Types
// ============================================================

export type EmailCampaignStatus = "draft" | "scheduled" | "sending" | "sent" | "paused";

export type EmailSubscriberStatus = "subscribed" | "unsubscribed" | "bounced" | "complained";

export type EmailTemplateCategory = "newsletter" | "promotional" | "transactional" | "abandoned_cart";

export type EmailActivityEvent = "sent" | "delivered" | "opened" | "clicked" | "bounced" | "unsubscribed" | "complained";

export type AutomationStepType = "trigger" | "delay" | "action";

export type AutomationStatus = "active" | "paused" | "draft";

// ============================================================
// StormVerge Mail Types
// ============================================================

export type GmailCategory = "primary" | "promotions" | "social" | "updates" | "forums";

export type SvMessageStatus = "unread" | "read";

export type SvMessageDirection = "inbound" | "outbound" | "draft";

export interface SvMessageAttachment {
  id: string;
  file_url: string;
  file_name: string;
  file_size_bytes: number;
}

export interface SvMessage {
  id: string;
  thread_id: string;
  subject: string | null;
  from_address: string;
  from_name: string | null;
  to_addresses: string[];
  cc_addresses: string[] | null;
  body_text: string;
  body_html: string | null;
  sent_at: string;
  status: SvMessageStatus;
  direction: SvMessageDirection | null;
  attachments: SvMessageAttachment[] | null;
}

export interface SvLabel {
  id: string;
  name: string;
  color: string;
  children: SvLabel[] | null;
}

export interface SvThread {
  id: string;
  mailbox_id: string;
  subject: string;
  snippet: string | null;
  is_starred: boolean;
  is_archived: boolean;
  is_trashed: boolean;
  is_important: boolean;
  has_attachments: boolean;
  last_message_at: string;
  snoozed_until: string | null;
  category: GmailCategory | null;
  unread_count: number | null;
  messages: SvMessage[] | null;
  labels: SvLabel[] | null;
}

export interface SvMailbox {
  id: string;
  display_name: string;
  email_address: string;
  is_active: boolean;
  signature_html: string | null;
  user_id?: string;
}

export interface SvAlias {
  id: string;
  mailbox_id: string;
  display_name: string;
  alias_email: string;
  is_default: boolean;
  signature_html: string | null;
}

export interface SvSmtpSettings {
  id: string;
  mailbox_id: string;
  smtp_host: string;
  smtp_port: number;
  smtp_username: string;
  smtp_password_encrypted: string | null;
  webhook_secret: string;
  is_active: boolean;
}

// ============================================================
// Analytics / Pulse Types
// ============================================================

export type AnalyticsEventType = "pageview" | "click" | "custom_event" | "conversion" | "outbound_link";

// ============================================================
// Knowledge Base Types
// ============================================================

export type KbArticleStatus = "draft" | "published" | "archived";

export type KbVisibility = "internal" | "public";

export interface KbCategory {
  id: string;
  name: string;
  created_at?: string;
  updated_at?: string;
}

export interface KbArticle {
  id: string;
  title: string;
  slug: string | null;
  summary: string | null;
  content: string | null;
  tags: string[] | null;
  status: KbArticleStatus;
  category_id: string | null;
  visibility: KbVisibility;
  views: number;
  language: string;
  access_roles: string[] | null;
  author_email: string | null;
  updated_at: string;
  created_at?: string;
}

export interface KbArticleWithCategory extends KbArticle {
  category?: KbCategory | null;
}

// ============================================================
// Promotion Types
// ============================================================

export type DiscountType = "percent" | "fixed_cart" | "fixed_product";

export type PromotionStatus = "draft" | "active" | "paused" | "expired";

export type PromotionPushStatus = "pushed" | "failed" | "pending";

export interface Promotion {
  id: string;
  code: string;
  description: string | null;
  discount_type: DiscountType;
  discount_value: number;
  target_brand_ids: string[];
  status: PromotionStatus;
  push_status: Record<string, { status: PromotionPushStatus }> | null;
  created_at?: string;
  updated_at?: string;
}

// ============================================================
// Inventory Types
// ============================================================

export interface Product {
  id: string;
  name: string;
  sku: string | null;
  brand_id: string | null;
  stock_quantity: number;
  low_stock_threshold: number;
  price: string | number;
  created_at?: string;
  updated_at?: string;
}

export interface ProductWithBrand extends Product {
  brand?: Brand | null;
}

export type InventoryLogSource = "webhook" | "manual";

export interface InventoryLog {
  id: string;
  product_id: string;
  delta: number;
  previous_stock: number;
  new_stock: number;
  source: InventoryLogSource;
  operator_email: string | null;
  created_at: string;
}

export interface InventoryLogWithDetails extends InventoryLog {
  product?: Product | null;
  brand?: Brand | null;
}

// ============================================================
// Webhook / Automation Types
// ============================================================

export interface WebhookLog {
  id: string;
  topic: string;
  status_code: number;
  processed: boolean;
  signature_valid: boolean;
  processing_ms: number;
  payload: Record<string, unknown> | null;
  error: string | null;
  brand_id: string | null;
  created_at: string;
}

export interface WebhookLogWithBrand extends WebhookLog {
  brand?: Brand | null;
}

export type TriggerType = "revenue_drop" | "high_value_order" | "fraud_flag" | "low_stock" | "new_order";

export type ActionType = "slack" | "discord" | "email" | "fraud_review" | "auto_fulfill";

export type AutomationAlertSeverity = "critical" | "warning" | "info";

export type AutomationAlertDeliveryStatus = "sent" | "failed" | "pending";

export interface AutomationRule {
  id: string;
  name: string;
  enabled: boolean;
  trigger_type: TriggerType;
  trigger_config: Record<string, unknown> | null;
  action_type: ActionType;
  action_config: Record<string, unknown> | null;
  fire_count: number;
  last_fired_at: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface AutomationAlert {
  id: string;
  severity: AutomationAlertSeverity;
  message: string;
  destination: string;
  delivery_status: AutomationAlertDeliveryStatus;
  created_at: string;
}

// ============================================================
// RBAC / Admin Types
// ============================================================

export type UserStatus = "INVITED" | "ACTIVE" | "SUSPENDED";

export type RbacPermissionAction = "view" | "edit" | "manage";

export type RbacModule =
  | "dashboard"
  | "orders"
  | "fulfillment"
  | "inventory"
  | "channels"
  | "promotions"
  | "helpdesk"
  | "knowledge_base"
  | "mail"
  | "social"
  | "sign"
  | "pay"
  | "freelancer"
  | "talent"
  | "analytics"
  | "automation"
  | "webhooks"
  | "settings"
  | "admin"
  | "agents"
  | "brands"
  | "projects"
  | "tasks"
  | "workspace"
  | "pulse"
  | "DEBTVERGE"
  | "DRAFTVERGE"
  | "IVAVERGE"
  | "LEADVERGE"
  | "STORMCALL"
  | "COMPLIANCE"
  | "KNOWLEDGE"
  | "QUALIFY"
  | "STORMVERGE"
  | "STORMTALK"
  | "STORMTASKS"
  | "STORMDRIVE"
  | "STORMWORD";

export interface RbacPermission {
  id: string;
  module: RbacModule;
  action: RbacPermissionAction;
}

export interface RbacRole {
  id: string;
  organization_id: string;
  name: string;
  is_custom: boolean;
  permissions: RbacPermission[];
}

export interface RbacProfile {
  id: string;
  email: string;
  full_name: string | null;
  is_super_admin: boolean;
  status: UserStatus;
  role: string;
  created_at?: string;
  updated_at?: string;
}

export interface OrganizationUser {
  id: string;
  user_id: string;
  organization_id: string;
  role_id: string | null;
  organization?: Organization | null;
  role?: RbacRole | null;
}

export interface AssetAccessLink {
  id: string;
  asset_id: string;
  profile?: RbacProfile | null;
  project?: Project | null;
  can_view: boolean;
  can_download: boolean;
  enforce_watermark: boolean;
  expires_at: string | null;
}

// ============================================================
// Subscription / Entitlement Types
// ============================================================

export type SubscriptionStatus = "active" | "suspended" | "cancelled" | "expired";

export interface SubscriptionPackage {
  id: string;
  name: string;
  slug: string;
  description: string;
  tier_level: number;
  monthly_price_pence: number;
  is_active: boolean;
  app_keys?: string[];
  created_at?: string;
  updated_at?: string;
}

export interface TenantSubscription {
  id: string;
  organization_id: string;
  package_id: string;
  status: SubscriptionStatus;
  started_at: string;
  expires_at: string | null;
  package?: SubscriptionPackage | null;
  organization?: Organization | null;
  created_at?: string;
  updated_at?: string;
}

// ============================================================
// Licensing Model (replaces subscription-per-org)
// ============================================================

export type CatalogProductType = "application" | "service" | "module";

export interface CatalogItem {
  id: string;
  key: string;
  name: string;
  product_type: CatalogProductType;
  category: string | null;
  icon: string | null;
  description: string | null;
  is_addon: boolean;
  is_active: boolean;
  display_order: number;
  created_at?: string;
  updated_at?: string;
}

export interface LicensePackage {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  monthly_price_pence: number;
  created_at?: string;
  updated_at?: string;
}

export type LicenseStatus = "active" | "suspended" | "cancelled";
export type LicenseSource = "package" | "direct" | "trial" | "complimentary";

export interface OrganizationLicense {
  id: string;
  organization_id: string;
  catalog_item_id: string;
  status: LicenseStatus;
  licence_source: LicenseSource;
  package_id: string | null;
  licence_type: string | null;
  started_at: string;
  ends_at: string | null;
  created_at?: string;
  updated_at?: string;
  catalog_item?: CatalogItem | null;
  package?: LicensePackage | null;
}

export interface EntitlementCheckResult {
  granted: boolean;
  subscriptionUnlocked: boolean;
  rolePermitted: boolean;
  reason: string;
}

// ============================================================
// Copilot Types
// ============================================================

export type ChatMessageRole = "user" | "assistant";

export interface ChatMessage {
  id?: string;
  role: ChatMessageRole;
  content: string;
  timestamp: number;
}

// ============================================================
// Constants
// ============================================================

export const STATUS_OPTIONS: OrderStatus[] = [
  "paid",
  "processing",
  "on-hold",
  "refunded",
  "cancelled",
  "failed",
];

export const BRAND_COLORS: string[] = [
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#eab308",
  "#84cc16",
  "#22c55e",
  "#10b981",
  "#14b8a6",
  "#06b6d4",
  "#0ea5e9",
  "#3b82f6",
  "#6366f1",
  "#8b5cf6",
  "#a855f7",
  "#d946ef",
  "#ec4899",
  "#f43f5e",
  "#64748b",
];

// ============================================================
// Debt Verge Multi-Solution Pipeline Architecture
// ============================================================

export type DebtSolutionPipeline = "DMP" | "IVA" | "DRO" | "Settlement";

export type PipelineStageStatus = "not_started" | "in_progress" | "completed" | "blocked";

export interface PipelineStageEntry {
  stageId: string;
  stageLabel: string;
  status: PipelineStageStatus;
  enteredAt: string;
  completedAt: string | null;
  notes: string | null;
}

export type SuitabilityVerdict = "eligible" | "likely" | "marginal" | "unsuitable";

export interface SolutionSuitabilityScore {
  pipeline: DebtSolutionPipeline;
  percentage: number;
  verdict: SuitabilityVerdict;
  reasons: string[];
  blockers: string[];
}

export interface SolutionState {
  currentPipeline: DebtSolutionPipeline;
  pipelineStatus: PipelineStageStatus;
  stageHistory: PipelineStageEntry[];
  pipelineSwitchCount: number;
  lastSwitchedAt: string | null;
  nomineeAssigned: string | null;
  interimOrderGranted: boolean;
  moratoriumEndDate: string | null;
  suitabilityScores: SolutionSuitabilityScore[];
  lastSuitabilityEvalAt: string | null;
}

export interface FinancialStatement {
  entries: DebtSfsEntry[];
  totalIncome: number;
  totalEssentialExpenses: number;
  totalDiscretionaryExpenses: number;
  totalDebtRepayments: number;
  disposableIncome: number;
  lastRecalculatedAt: string | null;
}

export interface CreditorsAndDebts {
  creditors: DebtCreditor[];
  totalDebt: number;
  totalMonthlyMinimums: number;
  averageApr: number;
  creditorCount: number;
}

export interface HouseholdMember {
  id: string;
  name: string;
  relationship: string;
  age: number | null;
  incomeContribution: number;
  isDependent: boolean;
}

export interface OpenBankingSummary {
  transactions: DebtBankTransaction[];
  importedToSfsCount: number;
  totalImportedCount: number;
  lastImportDate: string | null;
  autoCategorizedCount: number;
  confidenceAverage: number;
}

export interface AssetInfo {
  propertyValue: number;
  outstandingMortgage: number;
  vehicleValue: number;
  otherAssetsValue: number;
  assetEquity: number;
}

export interface CustomerProfileMaster {
  fullName: string;
  dateOfBirth: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  niNumber: string | null;
  residencyStatus: DebtTenureType | null;
  currentAddress: string | null;
  addressHistory: DebtPreviousAddress[];
  householdComposition: HouseholdMember[];
  employmentStatus: string | null;
  maritalStatus: string | null;
  vulnerabilities: DebtVulnerabilityAssessment | null;
  assets: AssetInfo | null;
  openBankingData: OpenBankingSummary | null;
}

export interface DebtVergeCaseMaster {
  caseId: string;
  caseNumber: string;
  debtorName: string;
  debtorReference: string | null;
  status: DebtCaseStatus;
  notes: string;
  createdAt: string;
  updatedAt: string;

  customerProfile: CustomerProfileMaster;
  financialStatement: FinancialStatement;
  creditorsAndDebts: CreditorsAndDebts;
  solutionState: SolutionState;

  ipDetails: IPDetails | null;
  documentChecklist: DocumentChecklistItem[];
  ivaProposalData: IVAProposalData | null;
  creditorVotes: CreditorVote[];
  proofOfDebt: ProofOfDebt[];
}

export interface PipelineTransitionAuditDetail {
  fromPipeline: DebtSolutionPipeline;
  toPipeline: DebtSolutionPipeline;
  reason: string;
  dataPreserved: {
    creditorCount: number;
    totalDebt: number;
    sfsEntriesCount: number;
    disposableIncome: number;
    householdMembersCount: number;
  };
  suitabilitySnapshot: SolutionSuitabilityScore[];
  switchedAt: string;
  switchedBy: string | null;
}

// ============================================================
// Insolv Engine — IVA / Insolvency Data Models
// ============================================================

export type IPRoleType = "nominee" | "supervisor" | "joint";

export interface IPDetails {
  id: string;
  case_id: string;
  practitioner_name: string;
  registration_number: string | null;
  firm_name: string | null;
  firm_address: string | null;
  firm_phone: string | null;
  firm_email: string | null;
  role_type: IPRoleType;
  nominee_fee_percent: number;
  supervisor_fee_percent: number;
  fixed_fee_amount: number;
  fee_notes: string | null;
  appointed_at: string;
  created_at: string;
  updated_at: string;
}

export type DocumentType =
  | "payslip" | "bank_statement" | "id_kyc" | "tax_record"
  | "utility_bill" | "creditor_statement" | "other";

export type DocumentStatus = "pending" | "approved" | "rejected";

export type UploadedByRole = "advisor" | "debtor" | "ip" | "creditor";

export interface DocumentChecklistItem {
  id: string;
  case_id: string;
  document_type: DocumentType;
  file_name: string;
  file_url: string | null;
  file_size_bytes: number;
  uploaded_by_role: UploadedByRole;
  status: DocumentStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type ProposalStatus = "draft" | "circulated" | "approved" | "rejected" | "varied";

export interface IVAProposalData {
  id: string;
  case_id: string;
  proposed_duration_months: number;
  total_estimated_dividend: number;
  estimated_dividend_percent: number;
  equity_treatment_terms: string | null;
  equity_release_month: number | null;
  protocol_compliant: boolean;
  proposal_status: ProposalStatus;
  creditor_meeting_date: string | null;
  dividend_calculation_notes: string | null;
  created_at: string;
  updated_at: string;
}

export type CreditorVoteChoice = "accept" | "reject" | "modify";

export interface CreditorVote {
  id: string;
  case_id: string;
  proposal_id: string | null;
  creditor_id: string;
  claimed_debt_amount: number;
  vote: CreditorVoteChoice;
  modification_notes: string | null;
  proxy_form_url: string | null;
  submitted_by: string | null;
  submitted_at: string;
  created_at: string;
  updated_at: string;
}

export type ProofOfDebtStatus =
  | "submitted" | "under_review" | "admitted" | "rejected" | "partially_admitted";

export interface ProofOfDebt {
  id: string;
  case_id: string;
  creditor_id: string | null;
  creditor_name: string;
  creditor_reference: string | null;
  claimed_amount: number;
  admitted_amount: number;
  pod_form_url: string | null;
  supporting_documents_url: string[];
  status: ProofOfDebtStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================
// Portal Role Types
// ============================================================

export type DebtVergePortalRole = "advisor_ip" | "debtor" | "creditor";

// ============================================================
// Workspace Agent Roles & View Modes (DMP vs IVA)
// ============================================================

export type DebtVergeAgentRole = "dmp_agent" | "draft_agent" | "iva_agent" | "admin_supervisor";

export type WorkspaceViewMode = "dmp" | "draft" | "iva" | "all";

export type IVACaseStatus =
  | "proposal_draft"
  | "meeting_called"
  | "active_supervision"
  | "breach_notice"
  | "completed";

export const IVA_STATUS_META: Record<IVACaseStatus, { label: string; color: string; description: string }> = {
  proposal_draft:       { label: "Proposal Draft",          color: "bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300",         description: "Nominee drafting IVA proposal" },
  meeting_called:       { label: "Meeting of Creditors Called", color: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300", description: "Creditor meeting scheduled" },
  active_supervision:   { label: "Active Supervision",       color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300", description: "IVA approved — under IP supervision" },
  breach_notice:        { label: "Breach Notice",            color: "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300",           description: "Debtor in breach of IVA terms" },
  completed:            { label: "Completed",                color: "bg-teal-100 text-teal-700 dark:bg-teal-500/20 dark:text-teal-300",           description: "IVA completed — dividend distributed" },
};

export const AGENT_ROLE_META: Record<DebtVergeAgentRole, { label: string; description: string; defaultView: WorkspaceViewMode }> = {
  dmp_agent:         { label: "DMP Agent",          description: "Manage DMP cases, pro-rata ledgers, payment schedules",          defaultView: "dmp" },
  draft_agent:       { label: "IVA Drafter",        description: "Draft IVA proposals, MOC notices, creditor voting, chairman reports", defaultView: "draft" },
  iva_agent:         { label: "IVA Agent",          description: "Manage IVA cases, creditor voting, proposals, supervision",     defaultView: "iva" },
  admin_supervisor:  { label: "Admin / Supervisor", description: "Full access — toggle between DMP, Draft, IVA, and all cases",    defaultView: "all" },
};

export const WORKSPACE_VIEW_META: Record<WorkspaceViewMode, { label: string; color: string }> = {
  dmp:   { label: "DMP Advisor",    color: "bg-emerald-600" },
  draft: { label: "Draft View",  color: "bg-blue-600" },
  iva:   { label: "Insolvency Advisor",    color: "bg-violet-600" },
  all:   { label: "All Cases",   color: "bg-slate-600" },
};

// ============================================================
// Document Generator Output Structures
// ============================================================

export interface IVAProposalDocumentJSON {
  proposalId: string;
  caseNumber: string;
  debtorName: string;
  generatedAt: string;
  ipDetails: {
    practitionerName: string;
    registrationNumber: string | null;
    firmName: string | null;
    roleType: IPRoleType;
    nomineeFeePercent: number;
    supervisorFeePercent: number;
  } | null;
  proposal: {
    proposedDurationMonths: number;
    totalEstimatedDividend: number;
    estimatedDividendPercent: number;
    equityTreatmentTerms: string | null;
    protocolCompliant: boolean;
    proposalStatus: ProposalStatus;
    creditorMeetingDate: string | null;
  } | null;
  sfsSummary: {
    totalIncome: number;
    totalEssentialExpenses: number;
    totalDiscretionaryExpenses: number;
    totalDebtRepayments: number;
    disposableIncome: number;
    entryCount: number;
  };
  creditorLedger: Array<{
    creditorName: string;
    balance: number;
    minimumPayment: number;
    apr: number;
  }>;
  totalUnsecuredDebt: number;
  totalMonthlyMinimums: number;
  projectedDividendPerCreditor: Array<{
    creditorName: string;
    balance: number;
    projectedDividend: number;
  }>;
}

export interface ChairsReportJSON {
  reportId: string;
  caseNumber: string;
  debtorName: string;
  generatedAt: string;
  ipDetails: {
    practitionerName: string;
    firmName: string | null;
  } | null;
  meetingDate: string | null;
  totalClaimsSubmitted: number;
  totalClaimsAdmitted: number;
  totalClaimsRejected: number;
  votingResults: {
    accept: { count: number; value: number };
    reject: { count: number; value: number };
    modify: { count: number; value: number };
  };
  dividendSummary: {
    totalDebt: number;
    totalEstimatedDividend: number;
    dividendPercent: number;
  };
  creditorBreakdown: Array<{
    creditorName: string;
    claimedAmount: number;
    admittedAmount: number;
    vote: CreditorVoteChoice;
    modificationNotes: string | null;
  }>;
  proposalOutcome: ProposalStatus;
}

// ============================================================
// Insolv Engine — In-Flight Case Management & Signposting
// ============================================================

export type SignpostingRoute = "iva" | "dmp" | "dro" | "bankruptcy" | "signposting";

export interface SignpostingAssessment {
  id: string;
  case_id: string | null;
  total_debt: number;
  monthly_disposable_income: number;
  creditor_count: number;
  recommended_route: SignpostingRoute;
  route_confidence: number;
  route_reasons: string[];
  assessment_data: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export type ContributionStatus = "expected" | "received" | "missed" | "late" | "partial";
export type PaymentMethod = "bacs" | "standing_order" | "card" | "cash" | "other";

export interface IVAContribution {
  id: string;
  case_id: string;
  amount: number;
  contribution_date: string;
  payment_method: PaymentMethod | null;
  reference: string | null;
  status: ContributionStatus;
  allocated_amount: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type DistributionRunStatus = "calculated" | "approved" | "executed" | "reversed";

export interface IVADistributionRun {
  id: string;
  case_id: string;
  run_date: string;
  total_collected: number;
  nominee_fee_deducted: number;
  supervisor_fee_deducted: number;
  total_disbursed: number;
  status: DistributionRunStatus;
  approved_by: string | null;
  approved_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface IVADistributionItem {
  id: string;
  run_id: string;
  case_id: string;
  creditor_id: string | null;
  creditor_name: string;
  original_debt: number;
  pro_rata_percent: number;
  distribution_amount: number;
  created_at: string;
}

// ============================================================
// IVA Protocol Proposal Pack — Document Structures
// ============================================================

export interface ContributionTableEntry {
  month: number;
  date: string;
  baseContribution: number;
  additionalContributions: number;
  totalContribution: number;
  cumulativeTotal: number;
}

export interface ContributionTableSection {
  monthlyContribution: number;
  durationMonths: number;
  totalContributions: number;
  entries: ContributionTableEntry[];
}

export interface NomineesReportSection {
  caseNumber: string;
  debtorName: string;
  ipName: string;
  firmName: string | null;
  registrationNumber: string | null;
  reportDate: string;
  sfsSummary: {
    totalIncome: number;
    totalEssentialExpenses: number;
    totalDiscretionaryExpenses: number;
    disposableIncome: number;
  };
  totalUnsecuredDebt: number;
  creditorCount: number;
  assetSummary: {
    hasProperty: boolean;
    estimatedEquity: number;
    equityTreatment: string | null;
  };
  suitabilityAssessment: string;
  proposalRecommendation: string;
  riskFactors: string[];
}

export interface ProtocolTermsSection {
  protocolVersion: string;
  terms: Array<{ clause: string; text: string }>;
}

export interface IVAProposalPack {
  packId: string;
  caseNumber: string;
  debtorName: string;
  generatedAt: string;
  contributionTable: ContributionTableSection;
  nomineesReport: NomineesReportSection;
  protocolTerms: ProtocolTermsSection;
  sfsBudgetSummary: {
    totalIncome: number;
    totalEssentialExpenses: number;
    totalDiscretionaryExpenses: number;
    disposableIncome: number;
    surplusShortfall: number;
  };
  creditorSchedule: Array<{
    creditorName: string;
    balance: number;
    apr: number;
    projectedDividend: number;
  }>;
  feeSchedule: {
    nomineeFeePercent: number;
    supervisorFeePercent: number;
    fixedFeeAmount: number;
    estimatedNomineeFee: number;
    estimatedSupervisorFee: number;
  };
  totalEstimatedDividend: number;
  estimatedDividendPercent: number;
}

// ============================================================
// Unified Omnichannel Communications Architecture
// ============================================================

export type CommsChannel = "email" | "sms" | "whatsapp" | "internal_note";
export type CommsDirection = "inbound" | "outbound";
export type CommsSenderType = "client" | "agent" | "system";
export type CommsStatus = "delivered" | "read" | "failed" | "queued";
export type UnassignedMessageStatus = "unassigned" | "matched" | "ignored";

export interface CommsParty {
  name: string;
  emailOrPhone: string;
  type?: CommsSenderType;
}

export interface CommsContent {
  subject?: string;
  body: string;
  attachments?: string[];
}

export interface DebtVergeCommunication {
  id: string;
  caseId: string;
  threadId: string;
  channel: CommsChannel;
  direction: CommsDirection;
  sender: CommsParty;
  recipient: CommsParty;
  agentId: string | null;
  agentName: string | null;
  content: CommsContent;
  status: CommsStatus;
  matchedAutomatically: boolean;
  timestamp: string;
  createdAt: string;
  updatedAt: string;
}

export interface UnassignedMessage {
  id: string;
  channel: CommsChannel;
  senderName: string;
  senderEmailOrPhone: string;
  subject: string | null;
  body: string;
  attachments: string[];
  receivedAt: string;
  matchedCaseId: string | null;
  matchedAt: string | null;
  matchedBy: string | null;
  status: UnassignedMessageStatus;
  createdAt: string;
  updatedAt: string;
}

export interface SendMessagePayload {
  caseId: string;
  threadId?: string;
  channel: CommsChannel;
  direction: CommsDirection;
  sender: CommsParty;
  recipient: CommsParty;
  agentId?: string;
  agentName?: string;
  content: CommsContent;
  status?: CommsStatus;
}

// ============================================================
// Payment Gateway & Disbursement Engine Types
// ============================================================

export type GatewayType = "stripe" | "gocardless" | "open_banking" | "merchant_acquirer" | "custom";

export type GatewayPaymentType = "card" | "bacs" | "open_banking";

export type GatewayTransactionStatus =
  | "pending"
  | "succeeded"
  | "failed"
  | "refunded"
  | "partially_refunded"
  | "retrying";

export type RecurringScheduleStatus = "active" | "paused" | "completed" | "cancelled" | "suspended";

export type DisbursementCategory =
  | "nominee_fee"
  | "supervisor_fee"
  | "nominee_cost"
  | "third_party_disbursement"
  | "creditor_dividend"
  | "reserve";

export type DisbursementStatus = "scheduled" | "processing" | "settled" | "failed" | "reversed";

export type ReconciliationStatus = "matched" | "unmatched" | "shortfall" | "overage" | "failed" | "retrying";

export interface PaymentGatewayConfig {
  id: string;
  organization_id: string;
  gateway_type: GatewayType;
  display_name: string;
  merchant_id: string | null;
  secret_ref: string;
  webhook_secret_ref: string | null;
  is_active: boolean;
  test_mode: boolean;
  supported_features: string[];
  created_at: string;
  updated_at: string;
}

export interface TokenisedPaymentMethod {
  id: string;
  organization_id: string;
  case_id: string | null;
  gateway_config_id: string | null;
  gateway_token: string;
  payment_type: GatewayPaymentType;
  card_brand: string | null;
  last4: string | null;
  expiry_month: number | null;
  expiry_year: number | null;
  cardholder_name: string | null;
  is_default: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface RecurringPaymentSchedule {
  id: string;
  organization_id: string;
  case_id: string;
  payment_method_id: string | null;
  gateway_config_id: string | null;
  frequency: PaymentFrequency;
  installment_amount: number;
  preferred_payment_day: string | null;
  start_date: string;
  end_date: string | null;
  next_collection_date: string;
  retry_count: number;
  max_retries: number;
  status: RecurringScheduleStatus;
  linked_plan_type: "dmp" | "iva" | "sfs" | "settlement" | null;
  created_at: string;
  updated_at: string;
}

export interface GatewayPaymentTransaction {
  id: string;
  organization_id: string;
  case_id: string | null;
  schedule_id: string | null;
  payment_method_id: string | null;
  gateway_config_id: string | null;
  gateway_transaction_id: string | null;
  amount: number;
  currency: string;
  status: GatewayTransactionStatus;
  failure_reason: string | null;
  gateway_response: Record<string, unknown> | null;
  attempted_at: string;
  settled_at: string | null;
  retry_of: string | null;
  created_at: string;
  updated_at: string;
}

export interface DisbursementWaterfallEntry {
  id: string;
  organization_id: string;
  case_id: string | null;
  source_transaction_id: string | null;
  waterfall_order: number;
  category: DisbursementCategory;
  payee_name: string;
  payee_reference: string | null;
  allocated_amount: number;
  status: DisbursementStatus;
  scheduled_date: string | null;
  settled_date: string | null;
  creditor_id: string | null;
  distribution_run_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface PaymentReconciliationLog {
  id: string;
  organization_id: string;
  case_id: string | null;
  transaction_id: string;
  reconciliation_date: string;
  status: ReconciliationStatus;
  expected_amount: number;
  actual_amount: number;
  variance: number;
  failure_code: string | null;
  retry_scheduled: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export const GATEWAY_TYPE_META: Record<GatewayType, { label: string; color: string }> = {
  stripe: { label: "Stripe", color: "bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300" },
  gocardless: { label: "GoCardless", color: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300" },
  open_banking: { label: "Open Banking", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300" },
  merchant_acquirer: { label: "Merchant Acquirer", color: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300" },
  custom: { label: "Custom Gateway", color: "bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300" },
};

export const GATEWAY_TX_STATUS_META: Record<GatewayTransactionStatus, { label: string; color: string }> = {
  pending: { label: "Pending", color: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300" },
  succeeded: { label: "Succeeded", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300" },
  failed: { label: "Failed", color: "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300" },
  refunded: { label: "Refunded", color: "bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300" },
  partially_refunded: { label: "Partially Refunded", color: "bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300" },
  retrying: { label: "Retrying", color: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300" },
};

export const SCHEDULE_STATUS_META: Record<RecurringScheduleStatus, { label: string; color: string }> = {
  active: { label: "Active", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300" },
  paused: { label: "Paused", color: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300" },
  completed: { label: "Completed", color: "bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300" },
  cancelled: { label: "Cancelled", color: "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300" },
  suspended: { label: "Suspended", color: "bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300" },
};

export const DISBURSEMENT_CATEGORY_META: Record<DisbursementCategory, { label: string; color: string }> = {
  nominee_fee: { label: "Nominee Fee", color: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300" },
  supervisor_fee: { label: "Supervisor Fee", color: "bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300" },
  nominee_cost: { label: "Nominee Cost", color: "bg-teal-100 text-teal-700 dark:bg-teal-500/20 dark:text-teal-300" },
  third_party_disbursement: { label: "Third-Party Disbursement", color: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300" },
  creditor_dividend: { label: "Creditor Dividend", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300" },
  reserve: { label: "Reserve", color: "bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300" },
};

export const DISBURSEMENT_STATUS_META: Record<DisbursementStatus, { label: string; color: string }> = {
  scheduled: { label: "Scheduled", color: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300" },
  processing: { label: "Processing", color: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300" },
  settled: { label: "Settled", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300" },
  failed: { label: "Failed", color: "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300" },
  reversed: { label: "Reversed", color: "bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300" },
};

export const RECONCILIATION_STATUS_META: Record<ReconciliationStatus, { label: string; color: string }> = {
  matched: { label: "Matched", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300" },
  unmatched: { label: "Unmatched", color: "bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300" },
  shortfall: { label: "Shortfall", color: "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300" },
  overage: { label: "Overage", color: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300" },
  failed: { label: "Failed", color: "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300" },
  retrying: { label: "Retrying", color: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300" },
};

// ============================================================
// Cashier Operations Types
// ============================================================

export type BankFeedType = "open_banking" | "csv_import" | "manual";
export type BankFeedFrequency = "daily" | "weekly" | "manual";
export type BankTxnMatchStatus = "unmatched" | "matched" | "auto_matched" | "ignored";
export type BankTxnMatchConfidence = "high" | "medium" | "low" | "manual";
export type BankTxnDirection = "credit" | "debit";

export interface BankFeed {
  id: string;
  organization_id: string;
  feed_name: string;
  feed_type: BankFeedType;
  account_number_masked: string | null;
  sort_code: string | null;
  bank_reference: string | null;
  import_frequency: BankFeedFrequency;
  last_import_at: string | null;
  last_import_count: number;
  is_active: boolean;
  created_at: string;
}

export interface BankTransaction {
  id: string;
  organization_id: string;
  bank_feed_id: string | null;
  case_id: string | null;
  transaction_date: string;
  amount: number;
  direction: BankTxnDirection;
  reference: string | null;
  description: string | null;
  counterparty_name: string | null;
  counterparty_account: string | null;
  match_status: BankTxnMatchStatus;
  matched_transaction_id: string | null;
  matched_schedule_id: string | null;
  matched_case_id: string | null;
  match_confidence: BankTxnMatchConfidence | null;
  match_notes: string | null;
  imported_at: string;
  created_at: string;
}

export type BatchRunStatus = "pending" | "processing" | "completed" | "failed" | "partial";
export type BatchRunType = "card_collection" | "direct_debit" | "mixed";
export type BatchItemStatus = "pending" | "processing" | "succeeded" | "failed" | "retrying";

export interface BatchPaymentRun {
  id: string;
  organization_id: string;
  batch_type: BatchRunType;
  batch_date: string;
  status: BatchRunStatus;
  total_items: number;
  succeeded_count: number;
  failed_count: number;
  total_amount: number;
  succeeded_amount: number;
  failed_amount: number;
  initiated_by: string | null;
  initiated_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface BatchPaymentItem {
  id: string;
  batch_run_id: string;
  schedule_id: string | null;
  case_id: string | null;
  payment_method_id: string | null;
  gateway_config_id: string | null;
  amount: number;
  status: BatchItemStatus;
  gateway_transaction_id: string | null;
  failure_reason: string | null;
  processed_at: string | null;
  created_at: string;
}

export type AuditActionType =
  | "manual_adjustment" | "refund" | "fee_override" | "ledger_lock" | "ledger_unlock"
  | "disbursement_settle" | "disbursement_fail" | "batch_execute" | "batch_retry"
  | "bank_match" | "bank_ignore" | "payment_link_sent" | "schedule_resume" | "schedule_suspend";

export interface CashierAuditLog {
  id: string;
  organization_id: string;
  case_id: string | null;
  user_id: string | null;
  user_email: string | null;
  action_type: AuditActionType;
  entity_type: string | null;
  entity_id: string | null;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  reason: string | null;
  amount_impact: number | null;
  created_at: string;
}

export type LedgerLockType = "end_of_day" | "period" | "month_end";
export type LedgerLockStatus = "locked" | "unlocked";

export interface LedgerLock {
  id: string;
  organization_id: string;
  lock_date: string;
  lock_type: LedgerLockType;
  status: LedgerLockStatus;
  total_collected: number;
  total_disbursed: number;
  variance: number;
  locked_by: string | null;
  locked_by_email: string | null;
  locked_at: string | null;
  unlocked_by: string | null;
  unlocked_at: string | null;
  unlock_reason: string | null;
  created_at: string;
}

export type DisbursementRunStatus = "draft" | "approved" | "generated" | "submitted" | "settled" | "failed";
export type DisbursementOutputFormat = "bacs" | "sepa" | "faster_payments" | "manual_instruction";
export type DisbursementRunItemStatus = "pending" | "included" | "submitted" | "settled" | "failed";

export interface DisbursementRun {
  id: string;
  organization_id: string;
  case_id: string | null;
  run_date: string;
  status: DisbursementRunStatus;
  output_format: DisbursementOutputFormat;
  file_reference: string | null;
  total_amount: number;
  total_items: number;
  approved_by: string | null;
  approved_at: string | null;
  generated_at: string | null;
  submitted_at: string | null;
  settled_at: string | null;
  created_at: string;
}

export interface DisbursementRunItem {
  id: string;
  disbursement_run_id: string;
  waterfall_entry_id: string | null;
  payee_name: string;
  payee_reference: string | null;
  payee_account_number: string | null;
  payee_sort_code: string | null;
  category: DisbursementCategory;
  amount: number;
  status: DisbursementRunItemStatus;
  bacs_reference: string | null;
  created_at: string;
}

export type PaymentLinkStatus = "sent" | "opened" | "paid" | "expired" | "failed";
export type PaymentLinkChannel = "sms" | "email";

export interface PaymentLinkInvitation {
  id: string;
  organization_id: string;
  case_id: string | null;
  schedule_id: string | null;
  failed_transaction_id: string | null;
  debtor_name: string | null;
  debtor_contact: string | null;
  contact_channel: PaymentLinkChannel;
  amount_requested: number;
  link_token: string;
  status: PaymentLinkStatus;
  sent_at: string;
  paid_at: string | null;
  expires_at: string;
  created_at: string;
}

export const BANK_FEED_TYPE_META: Record<BankFeedType, { label: string; color: string }> = {
  open_banking: { label: "Open Banking", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300" },
  csv_import: { label: "CSV Import", color: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300" },
  manual: { label: "Manual", color: "bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300" },
};

export const BANK_TXN_MATCH_META: Record<BankTxnMatchStatus, { label: string; color: string }> = {
  unmatched: { label: "Unmatched", color: "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300" },
  matched: { label: "Matched", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300" },
  auto_matched: { label: "Auto-Matched", color: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300" },
  ignored: { label: "Ignored", color: "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400" },
};

export const BATCH_RUN_STATUS_META: Record<BatchRunStatus, { label: string; color: string }> = {
  pending: { label: "Pending", color: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300" },
  processing: { label: "Processing", color: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300" },
  completed: { label: "Completed", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300" },
  failed: { label: "Failed", color: "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300" },
  partial: { label: "Partial", color: "bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300" },
};

export const BATCH_ITEM_STATUS_META: Record<BatchItemStatus, { label: string; color: string }> = {
  pending: { label: "Pending", color: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300" },
  processing: { label: "Processing", color: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300" },
  succeeded: { label: "Succeeded", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300" },
  failed: { label: "Failed", color: "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300" },
  retrying: { label: "Retrying", color: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300" },
};

export const AUDIT_ACTION_META: Record<AuditActionType, { label: string; color: string }> = {
  manual_adjustment: { label: "Manual Adjustment", color: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300" },
  refund: { label: "Refund", color: "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300" },
  fee_override: { label: "Fee Override", color: "bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300" },
  ledger_lock: { label: "Ledger Lock", color: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300" },
  ledger_unlock: { label: "Ledger Unlock", color: "bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300" },
  disbursement_settle: { label: "Disbursement Settled", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300" },
  disbursement_fail: { label: "Disbursement Failed", color: "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300" },
  batch_execute: { label: "Batch Execute", color: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300" },
  batch_retry: { label: "Batch Retry", color: "bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300" },
  bank_match: { label: "Bank Match", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300" },
  bank_ignore: { label: "Bank Ignore", color: "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400" },
  payment_link_sent: { label: "Payment Link Sent", color: "bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300" },
  schedule_resume: { label: "Schedule Resume", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300" },
  schedule_suspend: { label: "Schedule Suspend", color: "bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300" },
};

export const DISB_RUN_STATUS_META: Record<DisbursementRunStatus, { label: string; color: string }> = {
  draft: { label: "Draft", color: "bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300" },
  approved: { label: "Approved", color: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300" },
  generated: { label: "Generated", color: "bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300" },
  submitted: { label: "Submitted", color: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300" },
  settled: { label: "Settled", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300" },
  failed: { label: "Failed", color: "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300" },
};

export const DISB_OUTPUT_FORMAT_META: Record<DisbursementOutputFormat, { label: string; color: string }> = {
  bacs: { label: "BACS", color: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300" },
  sepa: { label: "SEPA", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300" },
  faster_payments: { label: "Faster Payments", color: "bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300" },
  manual_instruction: { label: "Manual Instruction", color: "bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300" },
};

export const PAYMENT_LINK_STATUS_META: Record<PaymentLinkStatus, { label: string; color: string }> = {
  sent: { label: "Sent", color: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300" },
  opened: { label: "Opened", color: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300" },
  paid: { label: "Paid", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300" },
  expired: { label: "Expired", color: "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400" },
  failed: { label: "Failed", color: "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300" },
};

// ============================================================
// Background Job Queue Types
// ============================================================

export type BackgroundJobType =
  | "batch_collection" | "disbursement_run" | "bank_reconciliation"
  | "ledger_posting" | "recurring_collection" | "retry_failed" | "expired_card_check";

export type BackgroundJobStatus =
  | "queued" | "claimed" | "processing" | "completed" | "failed" | "throttled";

export type BackgroundJobEventType =
  | "enqueued" | "claimed" | "chunk_started" | "chunk_completed"
  | "item_succeeded" | "item_failed" | "throttled" | "retried"
  | "completed" | "failed" | "stale_detected";

export interface BackgroundJob {
  id: string;
  organization_id: string;
  job_type: BackgroundJobType;
  priority: number;
  status: BackgroundJobStatus;
  payload: Record<string, unknown>;
  total_items: number;
  processed_items: number;
  succeeded_items: number;
  failed_items: number;
  throttled_items: number;
  chunk_size: number;
  max_retries: number;
  retry_count: number;
  rate_limit_ms: number;
  claimed_by: string | null;
  claimed_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  last_progress_at: string | null;
  created_by: string | null;
  created_at: string;
}

export interface BackgroundJobEvent {
  id: string;
  job_id: string;
  event_type: BackgroundJobEventType;
  message: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export const JOB_TYPE_META: Record<BackgroundJobType, { label: string; color: string; icon: string }> = {
  batch_collection: { label: "Batch Collection", color: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300", icon: "layers" },
  disbursement_run: { label: "Disbursement Run", color: "bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300", icon: "arrow-right-left" },
  bank_reconciliation: { label: "Bank Reconciliation", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300", icon: "building" },
  ledger_posting: { label: "Ledger Posting", color: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300", icon: "book" },
  recurring_collection: { label: "Recurring Collection", color: "bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300", icon: "repeat" },
  retry_failed: { label: "Retry Failed", color: "bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300", icon: "rotate-cw" },
  expired_card_check: { label: "Expired Card Check", color: "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300", icon: "credit-card" },
};

export const JOB_STATUS_META: Record<BackgroundJobStatus, { label: string; color: string }> = {
  queued: { label: "Queued", color: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300" },
  claimed: { label: "Claimed", color: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300" },
  processing: { label: "Processing", color: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300" },
  completed: { label: "Completed", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300" },
  failed: { label: "Failed", color: "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300" },
  throttled: { label: "Throttled", color: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300" },
};

export const JOB_EVENT_META: Record<BackgroundJobEventType, { label: string; color: string }> = {
  enqueued: { label: "Enqueued", color: "text-slate-500" },
  claimed: { label: "Claimed", color: "text-indigo-600 dark:text-indigo-400" },
  chunk_started: { label: "Chunk Started", color: "text-blue-600 dark:text-blue-400" },
  chunk_completed: { label: "Chunk Completed", color: "text-blue-600 dark:text-blue-400" },
  item_succeeded: { label: "Item Succeeded", color: "text-emerald-600 dark:text-emerald-400" },
  item_failed: { label: "Item Failed", color: "text-rose-600 dark:text-rose-400" },
  throttled: { label: "Throttled", color: "text-amber-600 dark:text-amber-400" },
  retried: { label: "Retried", color: "text-orange-600 dark:text-orange-400" },
  completed: { label: "Completed", color: "text-emerald-600 dark:text-emerald-400" },
  failed: { label: "Failed", color: "text-rose-600 dark:text-rose-400" },
  stale_detected: { label: "Stale Detected", color: "text-amber-600 dark:text-amber-400" },
};

// ============================================================
// Storm Call Types
// ============================================================

export type AdviserRole = "adviser" | "senior_adviser" | "team_leader" | "manager" | "compliance_officer" | "administrator";
export type AdviserAvailability = "available" | "busy" | "on_call" | "break" | "offline";
export type TelephonyProviderType = "storm_call" | "external_voip" | "sip" | "cloud";
export type CallDirection = "inbound" | "outbound";
export type CallStatus = "ringing" | "answered" | "on_hold" | "muted" | "transferred" | "completed" | "missed" | "failed";
export type CustomerSentiment = "positive" | "neutral" | "negative" | "distressed";
export type SummaryReviewStatus = "pending" | "reviewed" | "approved" | "amended";
export type TranscriptSource = "ai" | "manual" | "provider";
export type ComplianceAuditAction =
  | "recording_accessed" | "transcript_viewed" | "notes_edited" | "summary_approved"
  | "summary_amended" | "coaching_added" | "call_transferred" | "recording_downloaded";
export type TimelineEventType =
  | "call" | "recording" | "transcript" | "ai_summary" | "adviser_note" | "email"
  | "document" | "task" | "compliance_event" | "callback_scheduled";
export type CallbackStatus = "pending" | "in_progress" | "completed" | "cancelled" | "missed";

export interface StormCallAdviserProfile {
  id: string;
  user_id: string;
  organization_id: string;
  adviser_id: string;
  team: string | null;
  department: string | null;
  role: AdviserRole;
  permissions: Record<string, unknown>;
  availability_status: AdviserAvailability;
  phone_extension: string | null;
  voip_user_id: string | null;
  assigned_case_ids: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface StormCallTelephonyProvider {
  id: string;
  organization_id: string;
  provider_name: string;
  provider_type: TelephonyProviderType;
  api_endpoint: string | null;
  webhook_url: string | null;
  is_active: boolean;
  config: Record<string, unknown>;
  created_at: string;
}

export interface StormCallSession {
  id: string;
  organization_id: string;
  call_direction: CallDirection;
  call_status: CallStatus;
  caller_phone: string | null;
  caller_name: string | null;
  callee_phone: string | null;
  callee_name: string | null;
  adviser_id: string | null;
  adviser_profile_id: string | null;
  case_id: string | null;
  customer_id: string | null;
  customer_identified: boolean;
  provider_id: string | null;
  provider_call_id: string | null;
  started_at: string;
  answered_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  is_on_hold: boolean;
  is_muted: boolean;
  transfer_target: string | null;
  transfer_status: string | null;
  call_notes: string | null;
  recording_url: string | null;
  recording_id: string | null;
  transcript_id: string | null;
  summary_id: string | null;
  compliance_score_id: string | null;
  follow_up_task_created: boolean;
  created_at: string;
}

export interface StormCallTranscript {
  id: string;
  session_id: string;
  organization_id: string;
  transcript_text: string | null;
  transcript_segments: Array<{ speaker: string; text: string; timestamp: number }> | null;
  language: string;
  confidence_score: number | null;
  generated_by: TranscriptSource;
  created_at: string;
}

export interface StormCallAISummary {
  id: string;
  session_id: string;
  organization_id: string;
  summary_text: string | null;
  key_points: string[];
  customer_concerns: string[];
  adviser_actions: string[];
  promises_made: Array<{ description: string; amount?: number; due_date?: string }>;
  follow_up_required: string[];
  compliance_risks: string[];
  customer_sentiment: CustomerSentiment | null;
  sentiment_score: number | null;
  actions_required: string[];
  review_status: SummaryReviewStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  coaching_notes: string | null;
  approved_by: string | null;
  approved_at: string | null;
  amended_text: string | null;
  created_at: string;
}

export interface StormCallComplianceScore {
  id: string;
  session_id: string;
  organization_id: string;
  total_score: number;
  required_disclosures_completed: boolean;
  affordability_discussed: boolean;
  vulnerability_identified: boolean;
  correct_advice_process_followed: boolean;
  disclosure_score: number;
  affordability_score: number;
  vulnerability_score: number;
  advice_score: number;
  compliance_checks: Record<string, boolean>;
  risk_flags: string[];
  created_at: string;
}

export interface StormCallComplianceAudit {
  id: string;
  organization_id: string;
  session_id: string | null;
  user_id: string | null;
  user_email: string | null;
  action_type: ComplianceAuditAction;
  entity_type: string | null;
  entity_id: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

export interface StormCallTimelineEvent {
  id: string;
  organization_id: string;
  customer_id: string | null;
  case_id: string | null;
  event_type: TimelineEventType;
  event_title: string | null;
  event_description: string | null;
  session_id: string | null;
  adviser_id: string | null;
  adviser_name: string | null;
  metadata: Record<string, unknown>;
  event_timestamp: string;
  created_at: string;
}

export interface StormCallCallback {
  id: string;
  organization_id: string;
  customer_id: string | null;
  case_id: string | null;
  adviser_id: string | null;
  phone_number: string;
  customer_name: string | null;
  scheduled_at: string;
  completed_at: string | null;
  status: CallbackStatus;
  priority: number;
  notes: string | null;
  session_id: string | null;
  created_at: string;
}

export const ADVISER_ROLE_META: Record<AdviserRole, { label: string; color: string }> = {
  adviser: { label: "Adviser", color: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300" },
  senior_adviser: { label: "Senior Adviser", color: "bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300" },
  team_leader: { label: "Team Leader", color: "bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300" },
  manager: { label: "Manager", color: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300" },
  compliance_officer: { label: "Compliance Officer", color: "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300" },
  administrator: { label: "Administrator", color: "bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300" },
};

export const ADVISER_AVAILABILITY_META: Record<AdviserAvailability, { label: string; color: string; dot: string }> = {
  available: { label: "Available", color: "text-emerald-600", dot: "bg-emerald-500" },
  busy: { label: "Busy", color: "text-amber-600", dot: "bg-amber-500" },
  on_call: { label: "On Call", color: "text-blue-600", dot: "bg-blue-500" },
  break: { label: "On Break", color: "text-orange-600", dot: "bg-orange-500" },
  offline: { label: "Offline", color: "text-slate-400", dot: "bg-slate-400" },
};

export const CALL_DIRECTION_META: Record<CallDirection, { label: string; color: string; icon: string }> = {
  inbound: { label: "Inbound", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300", icon: "phone-incoming" },
  outbound: { label: "Outbound", color: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300", icon: "phone-outgoing" },
};

export const CALL_STATUS_META: Record<CallStatus, { label: string; color: string }> = {
  ringing: { label: "Ringing", color: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300" },
  answered: { label: "Answered", color: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300" },
  on_hold: { label: "On Hold", color: "bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300" },
  muted: { label: "Muted", color: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300" },
  transferred: { label: "Transferred", color: "bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300" },
  completed: { label: "Completed", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300" },
  missed: { label: "Missed", color: "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300" },
  failed: { label: "Failed", color: "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300" },
};

export const SENTIMENT_META: Record<CustomerSentiment, { label: string; color: string; emoji: string }> = {
  positive: { label: "Positive", color: "text-emerald-600 dark:text-emerald-400", emoji: "😊" },
  neutral: { label: "Neutral", color: "text-slate-500 dark:text-slate-400", emoji: "😐" },
  negative: { label: "Negative", color: "text-amber-600 dark:text-amber-400", emoji: "😕" },
  distressed: { label: "Distressed", color: "text-rose-600 dark:text-rose-400", emoji: "😟" },
};

export const SUMMARY_REVIEW_META: Record<SummaryReviewStatus, { label: string; color: string }> = {
  pending: { label: "Pending Review", color: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300" },
  reviewed: { label: "Reviewed", color: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300" },
  approved: { label: "Approved", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300" },
  amended: { label: "Amended", color: "bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300" },
};

export const TIMELINE_EVENT_META: Record<TimelineEventType, { label: string; color: string }> = {
  call: { label: "Call", color: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300" },
  recording: { label: "Recording", color: "bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300" },
  transcript: { label: "Transcript", color: "bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300" },
  ai_summary: { label: "AI Summary", color: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300" },
  adviser_note: { label: "Adviser Note", color: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300" },
  email: { label: "Email", color: "bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300" },
  document: { label: "Document", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300" },
  task: { label: "Task", color: "bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300" },
  compliance_event: { label: "Compliance Event", color: "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300" },
  callback_scheduled: { label: "Callback Scheduled", color: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300" },
};

export const CALLBACK_STATUS_META: Record<CallbackStatus, { label: string; color: string }> = {
  pending: { label: "Pending", color: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300" },
  in_progress: { label: "In Progress", color: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300" },
  completed: { label: "Completed", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300" },
  cancelled: { label: "Cancelled", color: "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400" },
  missed: { label: "Missed", color: "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300" },
};

export type NoteTag = "customer_request" | "compliance_point" | "vulnerability_indicator" | "adviser_action" | "general";
export type ConferenceParticipantType = "adviser" | "supervisor" | "specialist" | "external";

export interface StormCallNote {
  id: string;
  session_id: string;
  organization_id: string;
  note_text: string;
  note_tag: NoteTag;
  is_follow_up: boolean;
  is_completed: boolean;
  follow_up_due_date: string | null;
  created_at: string;
  created_by: string | null;
}

export interface StormCallConferenceParticipant {
  id: string;
  session_id: string;
  organization_id: string;
  participant_name: string;
  participant_role: string | null;
  participant_type: ConferenceParticipantType;
  joined_at: string;
  left_at: string | null;
  is_active: boolean;
}

export interface StormCallRecordingEvent {
  id: string;
  session_id: string;
  organization_id: string;
  event_type: "paused" | "resumed";
  event_timestamp: string;
  reason: string | null;
  user_id: string | null;
  user_email: string | null;
  duration_seconds: number | null;
}

export interface StormCallLaunchContext {
  customerName: string | null;
  customerReference: string | null;
  caseNumber: string | null;
  leadReference: string | null;
  phoneNumber: string | null;
  caseId: string | null;
  customerId: string | null;
  applicationSource: string;
}

export const NOTE_TAG_META: Record<NoteTag, { label: string; color: string; icon: string }> = {
  customer_request: { label: "Customer Request", color: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300", icon: "user" },
  compliance_point: { label: "Compliance Point", color: "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300", icon: "shield" },
  vulnerability_indicator: { label: "Vulnerability Indicator", color: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300", icon: "alert-triangle" },
  adviser_action: { label: "Adviser Action", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300", icon: "check-circle" },
  general: { label: "General", color: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300", icon: "sticky-note" },
};

export const CONFERENCE_PARTICIPANT_TYPE_META: Record<ConferenceParticipantType, { label: string; color: string }> = {
  adviser: { label: "Adviser", color: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300" },
  supervisor: { label: "Supervisor", color: "bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300" },
  specialist: { label: "Specialist", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300" },
  external: { label: "External", color: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300" },
};

export const COMPLIANCE_AUDIT_META: Record<ComplianceAuditAction, { label: string; color: string }> = {
  recording_accessed: { label: "Recording Accessed", color: "bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300" },
  transcript_viewed: { label: "Transcript Viewed", color: "bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300" },
  notes_edited: { label: "Notes Edited", color: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300" },
  summary_approved: { label: "Summary Approved", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300" },
  summary_amended: { label: "Summary Amended", color: "bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300" },
  coaching_added: { label: "Coaching Added", color: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300" },
  call_transferred: { label: "Call Transferred", color: "bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300" },
  recording_downloaded: { label: "Recording Downloaded", color: "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300" },
};

// ============================================================
// Storm Call Compliance Portal Types
// ============================================================

export type ComplianceReviewStatus =
  | "assigned" | "in_review" | "pending_approval" | "approved"
  | "rejected" | "escalated" | "completed";

export type CompliancePriority = "low" | "normal" | "high" | "critical";

export type ComplianceReviewOutcome =
  | "compliant" | "minor_issues" | "major_issues" | "non_compliant" | "pending";

export type AssignmentStatus = "active" | "reassigned" | "completed" | "declined";

export type QAPeriodType = "daily" | "weekly" | "monthly";

export type ImprovementTrend = "improving" | "stable" | "declining";

export type CoachingActionType =
  | "feedback" | "training" | "coaching_session" | "corrective_action" | "improvement_plan";

export type CoachingActionStatus = "open" | "in_progress" | "completed" | "overdue" | "cancelled";

export type WorkflowStepType =
  | "review_created" | "review_assigned" | "review_started" | "review_completed"
  | "review_approved" | "review_rejected" | "review_escalated"
  | "coaching_assigned" | "coaching_completed" | "corrective_action_added"
  | "reviewer_changed" | "due_date_extended";

export type ComplianceRiskType =
  | "compliance_breach" | "complaint_risk" | "vulnerability_concern"
  | "affordability_issue" | "disclosure_missing" | "advice_quality"
  | "recording_gap" | "mis_selling" | "data_protection";

export type RiskSeverity = "low" | "medium" | "high" | "critical";

export type ComplianceReportType =
  | "compliance_summary" | "adviser_performance" | "risk_analysis"
  | "audit_trail" | "complaint_trends" | "regulatory_return";

export interface ComplianceIssue {
  category: string;
  severity: RiskSeverity;
  description: string;
}

export interface CorrectiveAction {
  action: string;
  due_date: string | null;
  assigned_to: string | null;
  status: "open" | "in_progress" | "completed";
}

export interface StormCallComplianceReview {
  id: string;
  organization_id: string;
  session_id: string;
  review_status: ComplianceReviewStatus;
  priority: CompliancePriority;
  assigned_to: string | null;
  assigned_by: string;
  assigned_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  compliance_score: number | null;
  review_outcome: ComplianceReviewOutcome | null;
  issues_identified: ComplianceIssue[];
  corrective_actions: CorrectiveAction[];
  reviewer_notes: string | null;
  is_escalated: boolean;
  escalation_reason: string | null;
  escalated_to: string | null;
  escalated_at: string | null;
  coaching_assigned: boolean;
  coaching_action_id: string | null;
  due_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface StormCallReviewAssignment {
  id: string;
  organization_id: string;
  review_id: string;
  assigned_to: string;
  assigned_by: string;
  assignment_status: AssignmentStatus;
  assigned_at: string;
  completed_at: string | null;
  decline_reason: string | null;
  created_at: string;
}

export interface StormCallAdviserQAScore {
  id: string;
  organization_id: string;
  adviser_id: string;
  adviser_name: string | null;
  team: string | null;
  period_type: QAPeriodType;
  period_start: string;
  period_end: string;
  total_calls: number;
  reviewed_calls: number;
  average_score: number;
  compliance_score_avg: number;
  quality_score_avg: number;
  compliant_calls: number;
  minor_issues_calls: number;
  major_issues_calls: number;
  non_compliant_calls: number;
  common_issues: { category: string; count: number }[];
  improvement_trend: ImprovementTrend | null;
  previous_period_score: number | null;
  created_at: string;
  updated_at: string;
}

export interface StormCallCoachingAction {
  id: string;
  organization_id: string;
  adviser_id: string;
  adviser_name: string | null;
  review_id: string | null;
  session_id: string | null;
  action_type: CoachingActionType;
  title: string;
  description: string | null;
  status: CoachingActionStatus;
  priority: CompliancePriority;
  assigned_by: string;
  assigned_to: string | null;
  due_date: string | null;
  completed_at: string | null;
  completion_notes: string | null;
  feedback_text: string | null;
  manager_rating: number | null;
  created_at: string;
  updated_at: string;
}

export interface StormCallWorkflowStep {
  id: string;
  organization_id: string;
  review_id: string;
  step_type: WorkflowStepType;
  performed_by: string;
  performed_by_name: string | null;
  from_status: string | null;
  to_status: string | null;
  notes: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface StormCallComplianceRiskIndicator {
  id: string;
  organization_id: string;
  session_id: string;
  review_id: string | null;
  risk_type: ComplianceRiskType;
  severity: RiskSeverity;
  description: string;
  auto_detected: boolean;
  detected_by: string | null;
  is_resolved: boolean;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_notes: string | null;
  created_at: string;
}

export interface StormCallComplianceReport {
  id: string;
  organization_id: string;
  report_type: ComplianceReportType;
  title: string;
  description: string | null;
  date_from: string;
  date_to: string;
  filters: Record<string, unknown>;
  summary_stats: Record<string, unknown>;
  report_data: Record<string, unknown>;
  generated_by: string;
  generated_by_name: string | null;
  status: "generating" | "generated" | "failed" | "archived";
  created_at: string;
}

export const COMPLIANCE_REVIEW_STATUS_META: Record<ComplianceReviewStatus, { label: string; color: string; dot: string }> = {
  assigned: { label: "Assigned", color: "bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300", dot: "bg-blue-500" },
  in_review: { label: "In Review", color: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300", dot: "bg-amber-500" },
  pending_approval: { label: "Pending Approval", color: "bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300", dot: "bg-violet-500" },
  approved: { label: "Approved", color: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300", dot: "bg-emerald-500" },
  rejected: { label: "Rejected", color: "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300", dot: "bg-rose-500" },
  escalated: { label: "Escalated", color: "bg-orange-50 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300", dot: "bg-orange-500" },
  completed: { label: "Completed", color: "bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300", dot: "bg-teal-500" },
};

export const COMPLIANCE_PRIORITY_META: Record<CompliancePriority, { label: string; color: string }> = {
  low: { label: "Low", color: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300" },
  normal: { label: "Normal", color: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300" },
  high: { label: "High", color: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300" },
  critical: { label: "Critical", color: "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300" },
};

export const REVIEW_OUTCOME_META: Record<ComplianceReviewOutcome, { label: string; color: string }> = {
  compliant: { label: "Compliant", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300" },
  minor_issues: { label: "Minor Issues", color: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300" },
  major_issues: { label: "Major Issues", color: "bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300" },
  non_compliant: { label: "Non-Compliant", color: "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300" },
  pending: { label: "Pending", color: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300" },
};

export const COACHING_ACTION_TYPE_META: Record<CoachingActionType, { label: string }> = {
  feedback: { label: "Feedback" },
  training: { label: "Training" },
  coaching_session: { label: "Coaching Session" },
  corrective_action: { label: "Corrective Action" },
  improvement_plan: { label: "Improvement Plan" },
};

export const COACHING_STATUS_META: Record<CoachingActionStatus, { label: string; color: string }> = {
  open: { label: "Open", color: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300" },
  in_progress: { label: "In Progress", color: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300" },
  completed: { label: "Completed", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300" },
  overdue: { label: "Overdue", color: "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300" },
  cancelled: { label: "Cancelled", color: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300" },
};

export const RISK_TYPE_META: Record<ComplianceRiskType, { label: string; color: string }> = {
  compliance_breach: { label: "Compliance Breach", color: "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300" },
  complaint_risk: { label: "Complaint Risk", color: "bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300" },
  vulnerability_concern: { label: "Vulnerability Concern", color: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300" },
  affordability_issue: { label: "Affordability Issue", color: "bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-300" },
  disclosure_missing: { label: "Disclosure Missing", color: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300" },
  advice_quality: { label: "Advice Quality", color: "bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300" },
  recording_gap: { label: "Recording Gap", color: "bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300" },
  mis_selling: { label: "Mis-Selling", color: "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300" },
  data_protection: { label: "Data Protection", color: "bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300" },
};

export const RISK_SEVERITY_META: Record<RiskSeverity, { label: string; color: string }> = {
  low: { label: "Low", color: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300" },
  medium: { label: "Medium", color: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300" },
  high: { label: "High", color: "bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300" },
  critical: { label: "Critical", color: "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300" },
};

export const WORKFLOW_STEP_META: Record<WorkflowStepType, { label: string }> = {
  review_created: { label: "Review Created" },
  review_assigned: { label: "Review Assigned" },
  review_started: { label: "Review Started" },
  review_completed: { label: "Review Completed" },
  review_approved: { label: "Review Approved" },
  review_rejected: { label: "Review Rejected" },
  review_escalated: { label: "Review Escalated" },
  coaching_assigned: { label: "Coaching Assigned" },
  coaching_completed: { label: "Coaching Completed" },
  corrective_action_added: { label: "Corrective Action Added" },
  reviewer_changed: { label: "Reviewer Changed" },
  due_date_extended: { label: "Due Date Extended" },
};

export const COMPLIANCE_REPORT_TYPE_META: Record<ComplianceReportType, { label: string }> = {
  compliance_summary: { label: "Compliance Summary" },
  adviser_performance: { label: "Adviser Performance" },
  risk_analysis: { label: "Risk Analysis" },
  audit_trail: { label: "Audit Trail" },
  complaint_trends: { label: "Complaint Trends" },
  regulatory_return: { label: "Regulatory Return" },
};

export const COMPLIANCE_PORTAL_ROLE_META: Record<string, { label: string; description: string }> = {
  platform_owner: { label: "Platform Owner", description: "Unrestricted access to all compliance features and data" },
  super_administrator: { label: "Super Administrator", description: "Full system access, manage all users and configurations" },
  administrator: { label: "Administrator", description: "Manage compliance workflows, assign reviews, generate reports" },
  compliance_officer: { label: "Compliance Officer", description: "Conduct reviews, approve AI summaries, escalate issues" },
  manager: { label: "Manager", description: "View team performance, assign coaching, track improvements" },
  team_leader: { label: "Team Leader", description: "Monitor team compliance, assign reviews, add feedback" },
  qa_reviewer: { label: "QA Reviewer", description: "Review calls, score compliance, identify issues" },
};
