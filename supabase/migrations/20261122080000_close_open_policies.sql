-- Firms can only read their own organisation record; legacy "true" policies no longer let anyone alter other firms' tenant/subscription/webhook data.
CREATE POLICY dv_r_sel_organizations ON organizations AS RESTRICTIVE FOR SELECT TO authenticated USING (owner_id = auth.uid() OR dv_is_org_member(id));
CREATE POLICY dv_r_upd_debtverge_tenants ON debtverge_tenants AS RESTRICTIVE FOR UPDATE TO authenticated USING (is_super_admin() OR auth_user_id = auth.uid());
CREATE POLICY dv_r_del_debtverge_tenants ON debtverge_tenants AS RESTRICTIVE FOR DELETE TO authenticated USING (is_super_admin() OR auth_user_id = auth.uid());
CREATE POLICY dv_r_sel_tenant_subscriptions ON tenant_subscriptions AS RESTRICTIVE FOR SELECT TO authenticated USING (is_super_admin() OR dv_is_org_member(organization_id));
CREATE POLICY dv_r_ins_tenant_subscriptions ON tenant_subscriptions AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (is_super_admin());
CREATE POLICY dv_r_upd_tenant_subscriptions ON tenant_subscriptions AS RESTRICTIVE FOR UPDATE TO authenticated USING (is_super_admin());
CREATE POLICY dv_r_del_tenant_subscriptions ON tenant_subscriptions AS RESTRICTIVE FOR DELETE TO authenticated USING (is_super_admin());
CREATE POLICY dv_r_ins_subscription_packages ON subscription_packages AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (is_super_admin());
CREATE POLICY dv_r_upd_subscription_packages ON subscription_packages AS RESTRICTIVE FOR UPDATE TO authenticated USING (is_super_admin());
CREATE POLICY dv_r_del_subscription_packages ON subscription_packages AS RESTRICTIVE FOR DELETE TO authenticated USING (is_super_admin());
CREATE POLICY dv_r_ins_subscription_package_apps ON subscription_package_apps AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (is_super_admin());
CREATE POLICY dv_r_upd_subscription_package_apps ON subscription_package_apps AS RESTRICTIVE FOR UPDATE TO authenticated USING (is_super_admin());
CREATE POLICY dv_r_del_subscription_package_apps ON subscription_package_apps AS RESTRICTIVE FOR DELETE TO authenticated USING (is_super_admin());
CREATE POLICY dv_r_sel_webhook_logs ON webhook_logs AS RESTRICTIVE FOR SELECT TO authenticated USING (is_super_admin());
CREATE POLICY dv_r_ins_webhook_logs ON webhook_logs AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (is_super_admin());
CREATE POLICY dv_r_upd_webhook_logs ON webhook_logs AS RESTRICTIVE FOR UPDATE TO authenticated USING (is_super_admin());
CREATE POLICY dv_r_del_webhook_logs ON webhook_logs AS RESTRICTIVE FOR DELETE TO authenticated USING (is_super_admin());
