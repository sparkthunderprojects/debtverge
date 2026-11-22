DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['brands','contracts','finance_knowledge_categories','inventory_logs','job_postings','milestone_payments','orders','products','projects','tasks'] LOOP
    IF to_regclass('public.'||t) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS dv_r_superadmin_only ON %I', t);
      EXECUTE format('CREATE POLICY dv_r_superadmin_only ON %I AS RESTRICTIVE FOR ALL TO authenticated USING (is_super_admin()) WITH CHECK (is_super_admin())', t);
    END IF;
  END LOOP;
END $$;
DROP POLICY IF EXISTS dv_r_kb_ins ON finance_knowledge_articles;
DROP POLICY IF EXISTS dv_r_kb_upd ON finance_knowledge_articles;
DROP POLICY IF EXISTS dv_r_kb_del ON finance_knowledge_articles;
CREATE POLICY dv_r_kb_ins ON finance_knowledge_articles AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (is_super_admin());
CREATE POLICY dv_r_kb_upd ON finance_knowledge_articles AS RESTRICTIVE FOR UPDATE TO authenticated USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY dv_r_kb_del ON finance_knowledge_articles AS RESTRICTIVE FOR DELETE TO authenticated USING (is_super_admin());
DROP POLICY IF EXISTS dv_r_fp_sel ON freelancer_profiles;
CREATE POLICY dv_r_fp_sel ON freelancer_profiles AS RESTRICTIVE FOR SELECT TO authenticated USING (is_super_admin() OR user_id = auth.uid());
DROP POLICY IF EXISTS dv_r_roles_sel ON rbac_roles;
CREATE POLICY dv_r_roles_sel ON rbac_roles AS RESTRICTIVE FOR SELECT TO authenticated USING (is_super_admin() OR organization_id IS NULL OR dv_is_org_member(organization_id));
DROP POLICY IF EXISTS dv_r_roleperm_sel ON rbac_role_permissions;
CREATE POLICY dv_r_roleperm_sel ON rbac_role_permissions AS RESTRICTIVE FOR SELECT TO authenticated
  USING (is_super_admin() OR EXISTS (SELECT 1 FROM rbac_roles r WHERE r.id = role_id AND (r.organization_id IS NULL OR dv_is_org_member(r.organization_id))));
DO $$ DECLARE t record; BEGIN
  FOR t IN SELECT c.relname FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p','v','m') LOOP
    EXECUTE format('REVOKE ALL ON %I FROM anon', t.relname);
  END LOOP;
END $$;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
