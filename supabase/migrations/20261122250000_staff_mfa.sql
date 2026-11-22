-- Staff MFA (TOTP). Enrolment and challenge use Supabase Auth. A firm can require MFA: until a staff member has passed the second step
-- in this session (JWT aal2), case access and every manager function refuse them at the database, not just in the screens.
CREATE TABLE IF NOT EXISTS public.dv_org_security (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  require_mfa boolean NOT NULL DEFAULT false,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.dv_org_security ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dv_org_security FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.dv_org_security TO service_role;

CREATE OR REPLACE FUNCTION public.dv_mfa_ok(org uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT NOT coalesce((SELECT s.require_mfa FROM dv_org_security s WHERE s.organization_id = org), false)
      OR coalesce(auth.jwt()->>'aal','') = 'aal2'
      OR coalesce(auth.role(),'') = 'service_role';
$$;
REVOKE ALL ON FUNCTION public.dv_mfa_ok(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dv_mfa_ok(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.dv_can_read_case(cid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM debt_cases c
    WHERE c.id = cid AND c.deleted_at IS NULL AND c.organization_id IS NOT NULL AND dv_is_org_member(c.organization_id) AND dv_mfa_ok(c.organization_id)
      AND (NOT c.is_restricted OR c.assigned_to = auth.uid() OR c.user_id = auth.uid() OR dv_is_manager(c.organization_id))
  );
$$;
CREATE OR REPLACE FUNCTION public.dv_can_edit_case(cid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM debt_cases c
    WHERE c.id = cid AND c.deleted_at IS NULL AND c.organization_id IS NOT NULL AND dv_is_org_member(c.organization_id) AND dv_mfa_ok(c.organization_id)
      AND (c.assigned_to = auth.uid() OR c.user_id = auth.uid() OR dv_is_manager(c.organization_id))
  );
$$;
CREATE OR REPLACE FUNCTION public.dv_is_manager(org uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT dv_mfa_ok(org) AND EXISTS (
    SELECT 1 FROM organization_users ou JOIN rbac_roles r ON r.id = ou.role_id
    WHERE ou.organization_id = org AND ou.user_id = auth.uid() AND r.name IN ('Admin','Team Manager','Operations Manager')
  );
$$;
CREATE OR REPLACE FUNCTION public.dv_is_org_admin(org uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT dv_mfa_ok(org) AND EXISTS (
    SELECT 1 FROM organization_users ou JOIN rbac_roles r ON r.id = ou.role_id
    WHERE ou.organization_id = org AND ou.user_id = auth.uid() AND r.name IN ('Admin','Operations Manager')
  );
$$;

CREATE OR REPLACE FUNCTION public.dv_get_security() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE o uuid := dv_my_org();
BEGIN
  IF o IS NULL THEN RETURN jsonb_build_object('require_mfa', false, 'can_manage', false); END IF;
  RETURN jsonb_build_object('require_mfa', coalesce((SELECT require_mfa FROM dv_org_security WHERE organization_id = o), false),
                            'can_manage', EXISTS (SELECT 1 FROM organization_users ou JOIN rbac_roles r ON r.id = ou.role_id WHERE ou.organization_id = o AND ou.user_id = auth.uid() AND r.name IN ('Admin','Operations Manager')));
END $$;

CREATE OR REPLACE FUNCTION public.dv_set_require_mfa(p_on boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE o uuid := dv_my_org();
BEGIN
  IF o IS NULL OR NOT dv_is_org_admin(o) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  -- you must have passed MFA yourself before you can require it of everyone, so you cannot lock the firm out with yourself
  IF p_on AND coalesce(auth.jwt()->>'aal','') <> 'aal2' THEN RAISE EXCEPTION 'turn on your own two-step sign-in first, then sign in with it again' USING ERRCODE = '22023'; END IF;
  INSERT INTO dv_org_security (organization_id, require_mfa, updated_by, updated_at) VALUES (o, p_on, auth.uid(), now())
  ON CONFLICT (organization_id) DO UPDATE SET require_mfa = EXCLUDED.require_mfa, updated_by = EXCLUDED.updated_by, updated_at = now();
END $$;

CREATE OR REPLACE FUNCTION public.dv_mfa_status() RETURNS TABLE (user_id uuid, email text, full_name text, role_name text, mfa_enrolled boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'auth' AS $$
DECLARE o uuid := dv_my_org();
BEGIN
  IF o IS NULL OR NOT dv_is_manager(o) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
    SELECT ou.user_id, p.email::text, p.full_name::text, r.name::text,
           EXISTS (SELECT 1 FROM auth.mfa_factors f WHERE f.user_id = ou.user_id AND f.status = 'verified')
      FROM organization_users ou JOIN rbac_roles r ON r.id = ou.role_id LEFT JOIN profiles p ON p.id = ou.user_id
     WHERE ou.organization_id = o ORDER BY p.full_name NULLS LAST, p.email;
END $$;

DO $$ DECLARE f text; BEGIN
  FOREACH f IN ARRAY ARRAY['dv_get_security()','dv_set_require_mfa(boolean)','dv_mfa_status()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;
