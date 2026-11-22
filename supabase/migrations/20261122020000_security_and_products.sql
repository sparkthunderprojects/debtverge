/*
  Security hardening + product licensing.

  1. Legacy policies let ANY member of a firm update/delete ANY case row, and even edit or delete audit history.
     Permissive policies are OR-ed, so the narrower dv_* rules were being bypassed. Rather than drop the old
     policies, RESTRICTIVE policies are added: every write must also pass the strict rule.
  2. Products (DMP Advisor, Insolvency Advisor) are licensed per firm and enforced in the database.
  3. Restricted cases (staff, family, high-profile) readable only by owner/assigned adviser/managers; every case
     view is written to an append-only access log.
  4. Audit tables become append-only for all signed-in users.
*/

-- ---------- products and licences ----------
CREATE TABLE IF NOT EXISTS dv_products (
  key text PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  display_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true
);
INSERT INTO dv_products (key, name, description, display_order) VALUES
  ('dmp_advisor', 'DMP Advisor', 'Debt management plans: budgeting, creditor offers, payments and distributions', 10),
  ('insolvency_advisor', 'Insolvency Advisor', 'IVA, DRO and formal insolvency: proposals, creditor voting and supervision', 20)
ON CONFLICT (key) DO NOTHING;
ALTER TABLE dv_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dv_products_read" ON dv_products FOR SELECT TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS dv_org_products (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_key text NOT NULL REFERENCES dv_products(key),
  enabled boolean NOT NULL DEFAULT true,
  starts_on date NOT NULL DEFAULT current_date,
  ends_on date,
  PRIMARY KEY (organization_id, product_key)
);
ALTER TABLE dv_org_products ENABLE ROW LEVEL SECURITY;
-- members can see their own firm's licences; nobody but the platform (service role) can change them
CREATE POLICY "dv_org_products_read" ON dv_org_products FOR SELECT TO authenticated USING (dv_is_org_member(organization_id));

CREATE OR REPLACE FUNCTION dv_org_has_product(org uuid, p text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM dv_org_products o WHERE o.organization_id = org AND o.product_key = p AND o.enabled
                 AND o.starts_on <= current_date AND (o.ends_on IS NULL OR o.ends_on >= current_date));
$$;

CREATE OR REPLACE FUNCTION dv_case_product(plan text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE WHEN plan IN ('iva','dro','bankruptcy') THEN 'insolvency_advisor' ELSE 'dmp_advisor' END;
$$;

CREATE OR REPLACE FUNCTION my_products() RETURNS TABLE (product_key text, name text, description text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.key, p.name, p.description FROM dv_products p
  WHERE p.is_active AND dv_org_has_product(dv_my_org(), p.key) ORDER BY p.display_order;
$$;
GRANT EXECUTE ON FUNCTION my_products() TO authenticated;

-- every existing firm keeps its current access
INSERT INTO dv_org_products (organization_id, product_key)
SELECT o.id, p.key FROM organizations o CROSS JOIN dv_products p ON CONFLICT DO NOTHING;

-- ---------- restricted cases + access log ----------
ALTER TABLE debt_cases ADD COLUMN IF NOT EXISTS is_restricted boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION dv_can_read_case(cid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM debt_cases c
    WHERE c.id = cid AND c.organization_id IS NOT NULL AND dv_is_org_member(c.organization_id)
      AND (NOT c.is_restricted OR c.assigned_to = auth.uid() OR c.user_id = auth.uid() OR dv_is_manager(c.organization_id))
  );
$$;

CREATE TABLE IF NOT EXISTS case_access_log (
  id bigserial PRIMARY KEY,
  case_id uuid NOT NULL REFERENCES debt_cases(id) ON DELETE CASCADE,
  organization_id uuid,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  action text NOT NULL DEFAULT 'view',
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_case_access_log_case ON case_access_log (case_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_case_access_log_user ON case_access_log (user_id, at DESC);
ALTER TABLE case_access_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dv_case_access_log_read" ON case_access_log FOR SELECT TO authenticated
  USING (organization_id IS NOT NULL AND dv_is_manager(organization_id));

CREATE OR REPLACE FUNCTION log_case_view(p_case uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE org uuid;
BEGIN
  IF NOT dv_can_read_case(p_case) THEN RETURN; END IF;
  SELECT organization_id INTO org FROM debt_cases WHERE id = p_case;
  -- one entry per user per case per 10 minutes
  IF NOT EXISTS (SELECT 1 FROM case_access_log WHERE case_id = p_case AND user_id = auth.uid() AND action = 'view' AND at > now() - interval '10 minutes') THEN
    INSERT INTO case_access_log (case_id, organization_id, user_id, action) VALUES (p_case, org, auth.uid(), 'view');
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION log_case_view(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION set_case_restricted(p_case uuid, p_restricted boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE org uuid;
BEGIN
  SELECT organization_id INTO org FROM debt_cases WHERE id = p_case;
  IF org IS NULL OR NOT dv_is_manager(org) THEN RAISE EXCEPTION 'only a manager can change case restrictions'; END IF;
  UPDATE debt_cases SET is_restricted = p_restricted, updated_at = now() WHERE id = p_case;
  INSERT INTO debt_audit_log (case_id, milestone, description)
  VALUES (p_case, CASE WHEN p_restricted THEN 'Case restricted' ELSE 'Case restriction removed' END, 'Changed by a manager');
END $$;
GRANT EXECUTE ON FUNCTION set_case_restricted(uuid, boolean) TO authenticated;

-- ---------- restrictive policies ----------
-- debt_cases itself
CREATE POLICY "dv_r_sel_debt_cases" ON debt_cases AS RESTRICTIVE FOR SELECT TO authenticated
  USING (dv_can_read_case(id) AND dv_org_has_product(organization_id, dv_case_product(plan_type::text)));
CREATE POLICY "dv_r_ins_debt_cases" ON debt_cases AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (organization_id IS NOT NULL AND dv_is_org_member(organization_id) AND dv_org_has_product(organization_id, dv_case_product(plan_type::text)));
CREATE POLICY "dv_r_upd_debt_cases" ON debt_cases AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (dv_can_edit_case(id)) WITH CHECK (dv_can_edit_case(id) AND dv_org_has_product(organization_id, dv_case_product(plan_type::text)));
CREATE POLICY "dv_r_del_debt_cases" ON debt_cases AS RESTRICTIVE FOR DELETE TO authenticated
  USING (organization_id IS NOT NULL AND dv_is_manager(organization_id));

-- every table that hangs off a case (case_id NOT NULL)
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.table_name FROM information_schema.columns c
    JOIN pg_class k ON k.relname = c.table_name AND k.relnamespace = 'public'::regnamespace AND k.relkind = 'r' AND k.relrowsecurity
    WHERE c.table_schema = 'public' AND c.column_name = 'case_id' AND c.is_nullable = 'NO'
      AND c.table_name NOT IN ('debt_cases','case_access_log','portal_change_requests','payment_links')
  LOOP
    EXECUTE format('CREATE POLICY %I ON %I AS RESTRICTIVE FOR SELECT TO authenticated USING (dv_can_read_case(case_id))', 'dv_r_sel_'||t, t);
    EXECUTE format('CREATE POLICY %I ON %I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (dv_can_edit_case(case_id))', 'dv_r_ins_'||t, t);
    EXECUTE format('CREATE POLICY %I ON %I AS RESTRICTIVE FOR UPDATE TO authenticated USING (dv_can_edit_case(case_id)) WITH CHECK (dv_can_edit_case(case_id))', 'dv_r_upd_'||t, t);
    EXECUTE format('CREATE POLICY %I ON %I AS RESTRICTIVE FOR DELETE TO authenticated USING (dv_can_edit_case(case_id))', 'dv_r_del_'||t, t);
  END LOOP;
END $$;

-- insolvency-only tables also require the Insolvency Advisor licence
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['debt_iva_proposals','debt_iva_contributions','debt_iva_distribution_runs','debt_iva_distribution_items','debt_ip_details','debt_creditor_votes','debt_proof_of_debt']
  LOOP
    EXECUTE format($f$CREATE POLICY %I ON %I AS RESTRICTIVE FOR ALL TO authenticated
      USING (EXISTS (SELECT 1 FROM debt_cases c WHERE c.id = case_id AND dv_org_has_product(c.organization_id, 'insolvency_advisor')))
      WITH CHECK (EXISTS (SELECT 1 FROM debt_cases c WHERE c.id = case_id AND dv_org_has_product(c.organization_id, 'insolvency_advisor')))$f$, 'dv_r_lic_'||t, t);
  END LOOP;
END $$;

-- client change requests: approval only through decide_change_request(); payment links editable only by the case team
CREATE POLICY "dv_r_upd_portal_change_requests" ON portal_change_requests AS RESTRICTIVE FOR UPDATE TO authenticated USING (false);
CREATE POLICY "dv_r_del_portal_change_requests" ON portal_change_requests AS RESTRICTIVE FOR DELETE TO authenticated USING (false);
CREATE POLICY "dv_r_sel_portal_change_requests" ON portal_change_requests AS RESTRICTIVE FOR SELECT TO authenticated USING (dv_can_read_case(case_id));
CREATE POLICY "dv_r_ins_payment_links" ON payment_links AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (dv_can_edit_case(case_id));
CREATE POLICY "dv_r_upd_payment_links" ON payment_links AS RESTRICTIVE FOR UPDATE TO authenticated USING (dv_can_edit_case(case_id)) WITH CHECK (dv_can_edit_case(case_id));
CREATE POLICY "dv_r_del_payment_links" ON payment_links AS RESTRICTIVE FOR DELETE TO authenticated USING (dv_can_edit_case(case_id));
CREATE POLICY "dv_r_sel_payment_links" ON payment_links AS RESTRICTIVE FOR SELECT TO authenticated USING (dv_can_read_case(case_id));

-- money-movement tables: managers (Operations Manager, Team Manager, Admin) only
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['disbursement_runs','batch_payment_runs','bank_transactions']
  LOOP
    EXECUTE format('CREATE POLICY %I ON %I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (organization_id IS NOT NULL AND dv_is_manager(organization_id))', 'dv_r_ins_'||t, t);
    EXECUTE format('CREATE POLICY %I ON %I AS RESTRICTIVE FOR UPDATE TO authenticated USING (organization_id IS NOT NULL AND dv_is_manager(organization_id)) WITH CHECK (organization_id IS NOT NULL AND dv_is_manager(organization_id))', 'dv_r_upd_'||t, t);
    EXECUTE format('CREATE POLICY %I ON %I AS RESTRICTIVE FOR DELETE TO authenticated USING (organization_id IS NOT NULL AND dv_is_manager(organization_id))', 'dv_r_del_'||t, t);
  END LOOP;
END $$;

-- ---------- append-only audit tables ----------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['debt_audit_log','cashier_audit_logs','payment_reconciliation_log','case_access_log']
  LOOP
    EXECUTE format('CREATE POLICY %I ON %I AS RESTRICTIVE FOR UPDATE TO authenticated USING (false)', 'dv_r_noupd_'||t, t);
    EXECUTE format('CREATE POLICY %I ON %I AS RESTRICTIVE FOR DELETE TO authenticated USING (false)', 'dv_r_nodel_'||t, t);
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON %I FROM authenticated, anon', t);
  END LOOP;
END $$;
