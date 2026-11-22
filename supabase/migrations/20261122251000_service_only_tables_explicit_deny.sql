-- Service-role-only tables: say so explicitly (clients have no privileges either way).
CREATE POLICY deny_all_clients ON public.dv_org_security AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY deny_all_clients ON public.org_phone_numbers AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
