/*
  A4 (part 2): who works a client once it changes stage.

  - Moving a client to a new stage clears its owner, so the next team can pick it up. The history keeps who moved it.
  - core_client_can_change: the owner, a manager, or (when unowned) anyone allowed to edit the app for the client's stage.
    Being the person who first created the client no longer gives power over later stages.
  - core_client_assign: a manager or the current owner hands the client to a colleague who can view that stage's app;
    anyone with edit rights on the stage can claim an unowned client for themselves. Restricted clients can only be
    assigned by a manager.
*/

CREATE OR REPLACE FUNCTION public.core_client_can_change(p_client uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM core_clients c
    LEFT JOIN core_apps a ON a.stage = c.current_stage
    WHERE c.id = p_client AND c.deleted_at IS NULL AND c.erased_at IS NULL AND dv_is_org_member(c.organization_id) AND dv_mfa_ok(c.organization_id)
      AND (c.assigned_to = auth.uid()
           OR dv_is_manager(c.organization_id)
           OR (c.assigned_to IS NULL AND NOT c.is_restricted AND a.app_id IS NOT NULL AND core_has_perm(c.organization_id, a.rbac_module, 'edit')))
  );
$$;

CREATE OR REPLACE FUNCTION public.core_client_change_stage(p_client uuid, p_from text, p_to text, p_reason text, p_approver uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c core_clients; rule core_stage_rules; why text := btrim(coalesce(p_reason, '')); tgt core_apps; src core_apps;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'sign in required' USING ERRCODE = '28000'; END IF;
  IF length(why) < 10 THEN RAISE EXCEPTION 'give the reason for the change (at least 10 characters)' USING ERRCODE = '22023'; END IF;
  IF length(why) > 2000 THEN RAISE EXCEPTION 'reason is too long' USING ERRCODE = '22023'; END IF;

  SELECT * INTO c FROM core_clients WHERE id = p_client FOR UPDATE;
  IF NOT FOUND OR NOT core_client_can_change(p_client) OR NOT core_client_can_read(p_client) THEN
    RAISE EXCEPTION 'you cannot change this client' USING ERRCODE = '42501';
  END IF;
  IF c.current_stage IS DISTINCT FROM p_from THEN
    RAISE EXCEPTION 'this client has already moved to %; reload and check', c.current_stage USING ERRCODE = '40001';
  END IF;

  SELECT * INTO rule FROM core_stage_rules WHERE from_stage = c.current_stage AND to_stage = p_to;
  IF NOT FOUND THEN RAISE EXCEPTION 'a client cannot move from % to %', c.current_stage, p_to USING ERRCODE = '22023'; END IF;

  SELECT * INTO tgt FROM core_apps WHERE stage = p_to;
  IF FOUND AND NOT dv_org_has_product(c.organization_id, tgt.product_key) THEN
    RAISE EXCEPTION 'your firm is not licensed for %', tgt.name USING ERRCODE = '42501';
  END IF;
  SELECT * INTO src FROM core_apps WHERE stage = c.current_stage;
  IF NOT FOUND THEN src := tgt; END IF;
  IF NOT (dv_is_manager(c.organization_id) OR core_has_perm(c.organization_id, src.rbac_module, 'edit')) THEN
    RAISE EXCEPTION 'you do not have permission to move clients out of %', src.name USING ERRCODE = '42501';
  END IF;

  IF rule.needs_approver THEN
    IF p_approver IS NULL THEN RAISE EXCEPTION 'this change needs a second person to approve it' USING ERRCODE = '22023'; END IF;
    IF p_approver = auth.uid() THEN RAISE EXCEPTION 'the approver must be someone other than you' USING ERRCODE = '22023'; END IF;
    IF NOT EXISTS (SELECT 1 FROM organization_users ou JOIN rbac_roles r ON r.id = ou.role_id
                    WHERE ou.organization_id = c.organization_id AND ou.user_id = p_approver AND r.name IN ('Admin','Team Manager','Operations Manager')) THEN
      RAISE EXCEPTION 'the approver must be a manager in this firm' USING ERRCODE = '22023';
    END IF;
  ELSIF p_approver IS NOT NULL THEN
    RAISE EXCEPTION 'this change does not take an approver' USING ERRCODE = '22023';
  END IF;

  UPDATE core_clients SET current_stage = p_to, stage_entered_at = now(), assigned_to = NULL, updated_at = now() WHERE id = c.id;
  INSERT INTO core_client_stages (client_id, organization_id, from_stage, to_stage, reason, changed_by, approved_by)
  VALUES (c.id, c.organization_id, c.current_stage, p_to, why, auth.uid(), p_approver);
  RETURN jsonb_build_object('client_id', c.id, 'from_stage', c.current_stage, 'to_stage', p_to);
END $$;

CREATE OR REPLACE FUNCTION public.core_client_assign(p_client uuid, p_assignee uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c core_clients; a core_apps; mgr boolean; claiming boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'sign in required' USING ERRCODE = '28000'; END IF;
  SELECT * INTO c FROM core_clients WHERE id = p_client FOR UPDATE;
  IF NOT FOUND OR c.erased_at IS NOT NULL OR c.deleted_at IS NOT NULL OR NOT core_client_can_read(p_client) THEN
    RAISE EXCEPTION 'you cannot assign this client' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO a FROM core_apps WHERE stage = c.current_stage;
  mgr := dv_is_manager(c.organization_id);
  claiming := coalesce(c.assigned_to IS NULL AND p_assignee = auth.uid() AND NOT c.is_restricted AND FOUND AND core_has_perm(c.organization_id, a.rbac_module, 'edit'), false);
  IF NOT (mgr OR coalesce(c.assigned_to = auth.uid(), false) OR claiming) THEN
    RAISE EXCEPTION 'you cannot assign this client' USING ERRCODE = '42501';
  END IF;
  IF p_assignee IS NOT NULL THEN
    IF a.app_id IS NULL THEN RAISE EXCEPTION 'a closed client cannot be assigned' USING ERRCODE = '22023'; END IF;
    IF NOT EXISTS (SELECT 1 FROM organization_users ou
                     JOIN rbac_role_permissions rp ON rp.role_id = ou.role_id
                     JOIN rbac_permissions p ON p.id = rp.permission_id
                    WHERE ou.organization_id = c.organization_id AND ou.user_id = p_assignee
                      AND p.module = a.rbac_module AND p.action IN ('view','manage')) THEN
      RAISE EXCEPTION 'that person cannot work in %', a.name USING ERRCODE = '22023';
    END IF;
  END IF;
  UPDATE core_clients SET assigned_to = p_assignee, updated_at = now() WHERE id = c.id;
  RETURN jsonb_build_object('client_id', c.id, 'assigned_to', p_assignee);
END $$;

DO $$ DECLARE f text; BEGIN
  FOREACH f IN ARRAY ARRAY['core_client_can_change(uuid)','core_client_change_stage(uuid,text,text,text,uuid)','core_client_assign(uuid,uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;
