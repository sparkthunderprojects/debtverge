/*
  Client portal access, no-login payment links and change requests.
  Clients reach their page through a single-use-style random token (not a password).
  Public access goes only through SECURITY DEFINER functions that expose a narrow,
  non-sensitive view of the case. Tables themselves are staff-only (org members).
*/
CREATE TABLE IF NOT EXISTS payment_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES debt_cases(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  reason text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paid','expired','cancelled')),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '14 days',
  channel text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_viewed_at timestamptz,
  paid_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_payment_links_case ON payment_links (case_id, status);
ALTER TABLE payment_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "select_org_payment_links" ON payment_links FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = payment_links.organization_id AND ou.user_id = auth.uid()));
CREATE POLICY "insert_org_payment_links" ON payment_links FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = payment_links.organization_id AND ou.user_id = auth.uid()));
CREATE POLICY "update_org_payment_links" ON payment_links FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = payment_links.organization_id AND ou.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = payment_links.organization_id AND ou.user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS portal_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES debt_cases(id) ON DELETE CASCADE,
  request_type text NOT NULL CHECK (request_type IN ('contact','care','note')),
  field text,
  old_value text,
  new_value text,
  note text,
  flags_vulnerability boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid,
  decided_at timestamptz,
  decision_note text
);
CREATE INDEX IF NOT EXISTS idx_change_requests_org ON portal_change_requests (organization_id, status);
ALTER TABLE portal_change_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "select_org_change_requests" ON portal_change_requests FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = portal_change_requests.organization_id AND ou.user_id = auth.uid()));
CREATE POLICY "update_org_change_requests" ON portal_change_requests FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = portal_change_requests.organization_id AND ou.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = portal_change_requests.organization_id AND ou.user_id = auth.uid()));

-- Public: narrow view of what a client sees from their link. Marks the link viewed.
CREATE OR REPLACE FUNCTION get_payment_link(p_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l payment_links; c debt_cases; org_name text; paid numeric; st text;
BEGIN
  SELECT * INTO l FROM payment_links WHERE token = p_token;
  IF NOT FOUND THEN RETURN jsonb_build_object('found', false); END IF;
  SELECT * INTO c FROM debt_cases WHERE id = l.case_id;
  SELECT name INTO org_name FROM organizations WHERE id = l.organization_id;
  SELECT COALESCE(sum(amount),0) INTO paid FROM debt_payments WHERE case_id = l.case_id;
  st := l.status;
  IF st = 'active' AND l.expires_at < now() THEN st := 'expired'; END IF;
  UPDATE payment_links SET last_viewed_at = now() WHERE id = l.id;
  RETURN jsonb_build_object(
    'found', true, 'status', st, 'amount', l.amount, 'reason', l.reason,
    'expires_at', l.expires_at, 'firm', org_name,
    'first_name', split_part(c.debtor_name, ' ', 1),
    'reference', c.case_number,
    'total_debt', c.total_debt, 'paid_to_date', paid,
    'remaining', GREATEST(c.total_debt - paid, 0),
    'monthly_payment', c.installment_amount, 'next_due', c.next_due_date,
    'status_label', c.status
  );
END $$;
GRANT EXECUTE ON FUNCTION get_payment_link(text) TO anon, authenticated;

-- Public: client submits a change; always lands in the adviser queue, never applied directly.
CREATE OR REPLACE FUNCTION submit_change_request(p_token text, p_type text, p_field text, p_value text, p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l payment_links; flag boolean; oldv text;
BEGIN
  SELECT * INTO l FROM payment_links WHERE token = p_token AND status IN ('active','paid');
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'invalid link'); END IF;
  IF p_type NOT IN ('contact','care','note') THEN RETURN jsonb_build_object('ok', false, 'error', 'invalid type'); END IF;
  IF p_type = 'contact' AND p_field NOT IN ('primary_email','mobile_phone','landline_phone','address_street','address_city','address_postcode') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid field');
  END IF;
  IF length(coalesce(p_value,'')) > 500 OR length(coalesce(p_note,'')) > 2000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'too long');
  END IF;
  flag := (coalesce(p_value,'') || ' ' || coalesce(p_note,'')) ~* '(health|ill|disab|depress|anxiety|bereave|passed away|died|job loss|redundan|lost my job|abus|pregnan|can''t cope|cannot cope|struggl|hospital|carer)';
  IF p_type = 'contact' THEN
    EXECUTE format('SELECT %I::text FROM debt_customer_profiles WHERE case_id = $1', p_field) INTO oldv USING l.case_id;
  END IF;
  INSERT INTO portal_change_requests (organization_id, case_id, request_type, field, old_value, new_value, note, flags_vulnerability)
  VALUES (l.organization_id, l.case_id, p_type, p_field, oldv, p_value, p_note, flag);
  RETURN jsonb_build_object('ok', true);
END $$;
GRANT EXECUTE ON FUNCTION submit_change_request(text, text, text, text, text) TO anon, authenticated;

-- Staff: approve or reject; approving a contact change applies it to the customer profile.
CREATE OR REPLACE FUNCTION decide_change_request(p_id uuid, p_approve boolean, p_note text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r portal_change_requests;
BEGIN
  SELECT * INTO r FROM portal_change_requests WHERE id = p_id AND status = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'request not found or already decided'; END IF;
  IF NOT EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = r.organization_id AND ou.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'not permitted';
  END IF;
  IF p_approve AND r.request_type = 'contact' THEN
    EXECUTE format('UPDATE debt_customer_profiles SET %I = $1, updated_at = now() WHERE case_id = $2', r.field) USING r.new_value, r.case_id;
  END IF;
  UPDATE portal_change_requests SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
    decided_by = auth.uid(), decided_at = now(), decision_note = p_note WHERE id = p_id;
END $$;
GRANT EXECUTE ON FUNCTION decide_change_request(uuid, boolean, text) TO authenticated;
