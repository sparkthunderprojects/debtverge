/*
  DMP roles and case access
  Roles: Advisor, Team Manager, Operations Manager (alongside the existing Admin).
  Access model:
    - Every member of an organisation can search and read all of its cases and correspond on them.
    - Editing a case is limited to its assigned advisor, its creator, and managers/admins.
  Policies are additive (permissive), so the original owner-only policies keep working.
*/
ALTER TABLE debt_cases ADD COLUMN IF NOT EXISTS assigned_to uuid;
ALTER TABLE organization_users ADD COLUMN IF NOT EXISTS manager_id uuid;
CREATE INDEX IF NOT EXISTS idx_debt_cases_assigned ON debt_cases (organization_id, assigned_to);

CREATE OR REPLACE FUNCTION dv_is_org_member(org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM organization_users ou WHERE ou.organization_id = org AND ou.user_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION dv_is_manager(org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM organization_users ou JOIN rbac_roles r ON r.id = ou.role_id
    WHERE ou.organization_id = org AND ou.user_id = auth.uid()
      AND r.name IN ('Admin','Team Manager','Operations Manager')
  );
$$;

CREATE OR REPLACE FUNCTION dv_can_read_case(cid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM debt_cases c WHERE c.id = cid AND c.organization_id IS NOT NULL AND dv_is_org_member(c.organization_id));
$$;

CREATE OR REPLACE FUNCTION dv_can_edit_case(cid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM debt_cases c
    WHERE c.id = cid AND c.organization_id IS NOT NULL AND dv_is_org_member(c.organization_id)
      AND (c.assigned_to = auth.uid() OR c.user_id = auth.uid() OR dv_is_manager(c.organization_id))
  );
$$;

-- debt_cases itself
CREATE POLICY "dv_org_select_debt_cases" ON debt_cases FOR SELECT TO authenticated
  USING (organization_id IS NOT NULL AND dv_is_org_member(organization_id));
CREATE POLICY "dv_org_insert_debt_cases" ON debt_cases FOR INSERT TO authenticated
  WITH CHECK (organization_id IS NOT NULL AND dv_is_org_member(organization_id));
CREATE POLICY "dv_org_update_debt_cases" ON debt_cases FOR UPDATE TO authenticated
  USING (organization_id IS NOT NULL AND dv_is_org_member(organization_id) AND (assigned_to = auth.uid() OR user_id = auth.uid() OR dv_is_manager(organization_id)))
  WITH CHECK (organization_id IS NOT NULL AND dv_is_org_member(organization_id));
CREATE POLICY "dv_org_delete_debt_cases" ON debt_cases FOR DELETE TO authenticated
  USING (organization_id IS NOT NULL AND dv_is_manager(organization_id));

-- every child table that hangs off a case
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.table_name FROM information_schema.columns c
    JOIN pg_class k ON k.relname = c.table_name AND k.relnamespace = 'public'::regnamespace AND k.relrowsecurity
    WHERE c.table_schema = 'public' AND c.column_name = 'case_id' AND c.table_name <> 'debt_cases'
      AND c.table_name NOT IN ('payment_links','portal_change_requests','case_handovers')
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname='dv_org_select_'||t) THEN
      EXECUTE format('CREATE POLICY %I ON %I FOR SELECT TO authenticated USING (dv_can_read_case(case_id))', 'dv_org_select_'||t, t);
      EXECUTE format('CREATE POLICY %I ON %I FOR ALL TO authenticated USING (dv_can_edit_case(case_id)) WITH CHECK (dv_can_edit_case(case_id))', 'dv_org_write_'||t, t);
    END IF;
  END LOOP;
END $$;

-- standard DMP roles for an organisation
CREATE OR REPLACE FUNCTION seed_debtverge_roles(org uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE spec record; rid uuid;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('Advisor', ARRAY['DEBTVERGE:view','DEBTVERGE:edit','PAY:view','COMPLIANCE:view','STORMCALL:view','STORMCALL:edit','MAIL:view','MAIL:edit','KNOWLEDGE:view']),
      ('Team Manager', ARRAY['DEBTVERGE:view','DEBTVERGE:edit','DEBTVERGE:manage','PAY:view','COMPLIANCE:view','COMPLIANCE:edit','STORMCALL:view','STORMCALL:edit','MAIL:view','MAIL:edit','AGENT:view','AGENT:edit','KNOWLEDGE:view']),
      ('Operations Manager', ARRAY['DEBTVERGE:view','DEBTVERGE:edit','DEBTVERGE:manage','PAY:view','PAY:edit','PAY:manage','COMPLIANCE:view','COMPLIANCE:edit','COMPLIANCE:manage','STORMCALL:view','MAIL:view','AGENT:view','AGENT:edit','AGENT:manage','KNOWLEDGE:view','KNOWLEDGE:edit'])
    ) AS v(name, perms)
  LOOP
    SELECT id INTO rid FROM rbac_roles WHERE organization_id = org AND name = spec.name;
    IF rid IS NULL THEN
      INSERT INTO rbac_roles (organization_id, name, is_custom) VALUES (org, spec.name, false) RETURNING id INTO rid;
    END IF;
    INSERT INTO rbac_role_permissions (role_id, permission_id)
    SELECT rid, p.id FROM rbac_permissions p WHERE (p.module || ':' || p.action) = ANY (spec.perms)
      AND NOT EXISTS (SELECT 1 FROM rbac_role_permissions x WHERE x.role_id = rid AND x.permission_id = p.id);
  END LOOP;
END $$;
