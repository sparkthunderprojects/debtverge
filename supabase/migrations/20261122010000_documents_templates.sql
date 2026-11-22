/*
  Letter/document templates (with merge fields) and per-case documents (generated letters + uploaded files).
  System templates have organization_id NULL and are readable by everyone; firms add their own.
*/
CREATE TABLE IF NOT EXISTS document_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'general',
  audience text NOT NULL DEFAULT 'customer' CHECK (audience IN ('customer','creditor')),
  subject text NOT NULL DEFAULT '',
  body text NOT NULL,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE document_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dv_select_document_templates" ON document_templates FOR SELECT TO authenticated
  USING (organization_id IS NULL OR dv_is_org_member(organization_id));
CREATE POLICY "dv_manage_document_templates" ON document_templates FOR ALL TO authenticated
  USING (organization_id IS NOT NULL AND dv_is_manager(organization_id))
  WITH CHECK (organization_id IS NOT NULL AND dv_is_manager(organization_id));

CREATE TABLE IF NOT EXISTS case_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES debt_cases(id) ON DELETE CASCADE,
  organization_id uuid,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'general',
  template_id uuid REFERENCES document_templates(id) ON DELETE SET NULL,
  body text,
  storage_path text,
  mime_type text,
  size_bytes bigint,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_case_documents_case ON case_documents (case_id, created_at DESC);
ALTER TABLE case_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dv_org_select_case_documents" ON case_documents FOR SELECT TO authenticated USING (dv_can_read_case(case_id));
CREATE POLICY "dv_org_write_case_documents" ON case_documents FOR ALL TO authenticated
  USING (dv_can_edit_case(case_id)) WITH CHECK (dv_can_edit_case(case_id));

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('case-documents', 'case-documents', false, 20971520)
ON CONFLICT (id) DO NOTHING;

-- first path segment of every object is the case id
CREATE POLICY "dv_case_documents_read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'case-documents' AND dv_can_read_case(split_part(name, '/', 1)::uuid));
CREATE POLICY "dv_case_documents_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'case-documents' AND dv_can_edit_case(split_part(name, '/', 1)::uuid));
CREATE POLICY "dv_case_documents_update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'case-documents' AND dv_can_edit_case(split_part(name, '/', 1)::uuid));
CREATE POLICY "dv_case_documents_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'case-documents' AND dv_can_edit_case(split_part(name, '/', 1)::uuid));

INSERT INTO document_templates (organization_id, name, category, audience, subject, body) VALUES
(NULL, 'Welcome and plan confirmation', 'onboarding', 'customer', 'Your debt management plan with {{firm_name}}',
'Dear {{client_name}},

Thank you for choosing {{firm_name}}. This letter confirms your debt management plan.

Your reference: {{case_number}}
Your monthly payment: {{monthly_payment}}
Total debts included: {{total_debt}}
Your first payment is due: {{next_due_date}}

We will share your payment between your creditors fairly, in proportion to what you owe each of them, and keep you updated. If your circumstances change, or you have difficulty making a payment, please contact us straight away so we can help.

Yours sincerely,
{{adviser_name}}
{{firm_name}}'),
(NULL, 'Creditor offer (fair share)', 'creditor', 'creditor', 'Debt management plan proposal: {{client_name}}, ref {{creditor_reference}}',
'Dear {{creditor_name}},

Re: {{client_name}}
Your reference: {{creditor_reference}}
Our reference: {{case_number}}

We act for the above customer, who is in financial difficulty. We enclose a copy of their income and expenditure.

The customer can afford {{monthly_payment}} a month towards all their creditors. Your fair share of this is {{creditor_offer}} a month, based on a balance of {{creditor_balance}}.

We ask that you accept this offer in full and final settlement over time, freeze interest and charges, and stop collection activity while payments are maintained. Please confirm in writing within 14 days.

Yours faithfully,
{{adviser_name}}
{{firm_name}}'),
(NULL, 'Letter of authority', 'creditor', 'creditor', 'Letter of authority: {{client_name}}, ref {{creditor_reference}}',
'Dear {{creditor_name}},

I, {{client_name}}, authorise {{firm_name}} to act on my behalf and to discuss and agree arrangements for my account with you (reference {{creditor_reference}}). Please send all correspondence about this account to {{firm_name}}.

Signed: ______________________   Date: {{today}}'),
(NULL, 'Missed payment reminder', 'collections', 'customer', 'We have not received your payment',
'Dear {{client_name}},

We have not received your payment of {{monthly_payment}} that was due on {{next_due_date}}.

If something has changed, please get in touch as soon as you can. We are here to help and there is no judgement. If you can pay now, call us and we will take it over the phone or send you a secure payment link.

Your plan stays on track when payments are made on time, and it protects you from creditor pressure.

Kind regards,
{{adviser_name}}
{{firm_name}}'),
(NULL, 'Annual review notice', 'review', 'customer', 'Your annual plan review',
'Dear {{client_name}},

It is time for your yearly review. We will check your income and spending, and make sure your plan is still right for you. Please have your latest payslips and bank statements ready, and call us to book a time.

Kind regards,
{{adviser_name}}
{{firm_name}}'),
(NULL, 'Creditor chase', 'creditor', 'creditor', 'Chasing your response: {{client_name}}, ref {{creditor_reference}}',
'Dear {{creditor_name}},

We wrote to you on behalf of {{client_name}} (your reference {{creditor_reference}}) and have not had a reply. Please confirm whether you accept the proposal of {{creditor_offer}} a month and freeze interest and charges. We will continue to pay while we wait.

Yours faithfully,
{{adviser_name}}
{{firm_name}}');
