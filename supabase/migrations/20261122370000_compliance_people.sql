-- People a compliance manager can assign reviews, coaching and escalations to (same firm only).
CREATE OR REPLACE FUNCTION public.dv_compliance_people() RETURNS TABLE (user_id uuid, name text, role_name text, is_manager boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE o uuid := dv_compliance_gate();
BEGIN
  RETURN QUERY SELECT ou.user_id, coalesce(p.full_name, p.email)::text, r.name::text, r.name IN ('Admin','Team Manager','Operations Manager')
    FROM organization_users ou JOIN rbac_roles r ON r.id = ou.role_id LEFT JOIN profiles p ON p.id = ou.user_id
   WHERE ou.organization_id = o ORDER BY coalesce(p.full_name, p.email);
END $function$;
REVOKE ALL ON FUNCTION public.dv_compliance_people() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dv_compliance_people() TO authenticated;
-- the old no-argument dashboard overload is superseded by dv_compliance_dashboard(p_days)
DROP FUNCTION IF EXISTS public.dv_compliance_dashboard();
