/*
  Team management: members, roles, reporting lines, case assignment, invites.
  Everything is scoped to the caller's own organisation and checked inside the functions.
*/
CREATE TABLE IF NOT EXISTS organization_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email text NOT NULL,
  role_id uuid NOT NULL REFERENCES rbac_roles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','claimed','cancelled')),
  invited_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_org_invites_pending ON organization_invites (organization_id, lower(email)) WHERE status = 'pending';
ALTER TABLE organization_invites ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION dv_my_org() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT organization_id FROM organization_users WHERE user_id = auth.uid() ORDER BY created_at LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION dv_is_org_admin(org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM organization_users ou JOIN rbac_roles r ON r.id = ou.role_id
    WHERE ou.organization_id = org AND ou.user_id = auth.uid() AND r.name IN ('Admin','Operations Manager')
  );
$$;

CREATE POLICY "select_org_invites" ON organization_invites FOR SELECT TO authenticated
  USING (dv_is_manager(organization_id));

CREATE OR REPLACE FUNCTION list_org_members() RETURNS TABLE (user_id uuid, email text, full_name text, role_id uuid, role_name text, manager_id uuid, open_cases bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT ou.user_id, p.email, p.full_name, ou.role_id, r.name, ou.manager_id,
         (SELECT count(*) FROM debt_cases c WHERE c.organization_id = ou.organization_id AND c.assigned_to = ou.user_id AND c.status NOT IN ('completed','closed'))
  FROM organization_users ou
  LEFT JOIN profiles p ON p.id = ou.user_id
  LEFT JOIN rbac_roles r ON r.id = ou.role_id
  WHERE ou.organization_id = dv_my_org() AND dv_is_manager(ou.organization_id)
  ORDER BY r.name, p.full_name;
$$;
GRANT EXECUTE ON FUNCTION list_org_members() TO authenticated;

CREATE OR REPLACE FUNCTION set_member_role(p_user uuid, p_role uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE org uuid := dv_my_org();
BEGIN
  IF org IS NULL OR NOT dv_is_org_admin(org) THEN RAISE EXCEPTION 'not permitted'; END IF;
  IF NOT EXISTS (SELECT 1 FROM rbac_roles WHERE id = p_role AND organization_id = org) THEN RAISE EXCEPTION 'unknown role'; END IF;
  IF p_user = auth.uid() THEN RAISE EXCEPTION 'you cannot change your own role'; END IF;
  UPDATE organization_users SET role_id = p_role WHERE user_id = p_user AND organization_id = org;
END $$;
GRANT EXECUTE ON FUNCTION set_member_role(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION set_member_manager(p_user uuid, p_manager uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE org uuid := dv_my_org();
BEGIN
  IF org IS NULL OR NOT dv_is_manager(org) THEN RAISE EXCEPTION 'not permitted'; END IF;
  IF p_manager IS NOT NULL AND NOT EXISTS (SELECT 1 FROM organization_users WHERE user_id = p_manager AND organization_id = org) THEN RAISE EXCEPTION 'manager is not in this organisation'; END IF;
  UPDATE organization_users SET manager_id = p_manager WHERE user_id = p_user AND organization_id = org;
END $$;
GRANT EXECUTE ON FUNCTION set_member_manager(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION assign_case(p_case uuid, p_user uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE org uuid; cur uuid := auth.uid(); owner uuid; asg uuid;
BEGIN
  SELECT organization_id, user_id, assigned_to INTO org, owner, asg FROM debt_cases WHERE id = p_case;
  IF org IS NULL OR NOT dv_is_org_member(org) THEN RAISE EXCEPTION 'case not found'; END IF;
  IF NOT (dv_is_manager(org) OR asg = cur) THEN RAISE EXCEPTION 'only a manager or the current owner can reassign'; END IF;
  IF p_user IS NOT NULL AND NOT EXISTS (SELECT 1 FROM organization_users WHERE user_id = p_user AND organization_id = org) THEN RAISE EXCEPTION 'assignee is not in this organisation'; END IF;
  UPDATE debt_cases SET assigned_to = p_user, updated_at = now() WHERE id = p_case;
  INSERT INTO debt_audit_log (case_id, milestone, description) VALUES (p_case, 'Case reassigned', 'Assigned to ' || coalesce((SELECT coalesce(full_name, email) FROM profiles WHERE id = p_user), 'nobody'));
END $$;
GRANT EXECUTE ON FUNCTION assign_case(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION create_invite(p_email text, p_role uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE org uuid := dv_my_org(); uid uuid; em text := lower(trim(p_email));
BEGIN
  IF org IS NULL OR NOT dv_is_org_admin(org) THEN RAISE EXCEPTION 'not permitted'; END IF;
  IF em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'enter a valid email'; END IF;
  IF NOT EXISTS (SELECT 1 FROM rbac_roles WHERE id = p_role AND organization_id = org) THEN RAISE EXCEPTION 'unknown role'; END IF;
  SELECT id INTO uid FROM profiles WHERE lower(email) = em;
  IF uid IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM organization_users WHERE user_id = uid AND organization_id = org) THEN RAISE EXCEPTION 'already a member'; END IF;
    INSERT INTO organization_users (user_id, organization_id, role_id) VALUES (uid, org, p_role);
    RETURN 'added';
  END IF;
  INSERT INTO organization_invites (organization_id, email, role_id) VALUES (org, em, p_role);
  RETURN 'invited';
END $$;
GRANT EXECUTE ON FUNCTION create_invite(text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION claim_org_invites() RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE em text := lower(coalesce(auth.jwt() ->> 'email', '')); inv record; n int := 0;
BEGIN
  IF auth.uid() IS NULL OR em = '' THEN RETURN 0; END IF;
  FOR inv IN SELECT * FROM organization_invites WHERE status = 'pending' AND lower(email) = em LOOP
    IF NOT EXISTS (SELECT 1 FROM organization_users WHERE user_id = auth.uid() AND organization_id = inv.organization_id) THEN
      INSERT INTO organization_users (user_id, organization_id, role_id) VALUES (auth.uid(), inv.organization_id, inv.role_id);
    END IF;
    UPDATE organization_invites SET status = 'claimed' WHERE id = inv.id;
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;
GRANT EXECUTE ON FUNCTION claim_org_invites() TO authenticated;

CREATE OR REPLACE FUNCTION cancel_invite(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE organization_invites SET status = 'cancelled' WHERE id = p_id AND organization_id = dv_my_org() AND dv_is_org_admin(organization_id);
END $$;
GRANT EXECUTE ON FUNCTION cancel_invite(uuid) TO authenticated;
