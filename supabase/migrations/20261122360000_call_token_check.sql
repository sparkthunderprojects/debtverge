-- Phone access check used by the softphone token function: signed-in member of a firm that holds the Phone licence.
CREATE OR REPLACE FUNCTION public.dv_call_token_check() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM organization_users ou WHERE ou.user_id = auth.uid() AND dv_org_has_product(ou.organization_id, 'voip'));
$$;
REVOKE ALL ON FUNCTION public.dv_call_token_check() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dv_call_token_check() TO authenticated;
