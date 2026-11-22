/*
  A4: licences and roles per app.

  - core_apps            the seven apps: which licence (product) each needs, which role permission module
                         gates it, and which client stage it owns. Closed to direct access.
  - dv_products          four new products: leadverge, qualifyverge, draftverge, ivaverge
                         (existing keys stay: dmp_advisor = DebtVerge, voip = Storm Call, compliance = Compliance).
                         Nothing is granted to any firm by this migration.
  - core_has_perm        does the signed-in user hold <MODULE>:<action> in this firm.
  - core_my_apps         the apps the signed-in user can open: firm licensed + role permits + MFA satisfied.
  - core_set_org_app     grant or end a firm's licence for an app (platform super admin or service role only).
  - core_client_*        client reads and stage changes now respect the licence and the role.
  - roles                Lead Handler, Qualifier, Drafter and IVA Supervisor added; managers and Admin get the new apps.
*/

-- ---------- products ----------
INSERT INTO public.dv_products (key, name, description, is_active, display_order) VALUES
  ('leadverge','LeadVerge','First fact-find: lead queue, activities and hand-over to Qualify',true,50),
  ('qualifyverge','QualifyVerge','Assessment: income and expenditure, SFS, checks, and the DMP or IVA decision',true,60),
  ('draftverge','DraftVerge','IVA drafting: documents, proposal pack and the creditors'' meeting',true,70),
  ('ivaverge','IVAVerge','IVA supervision: contributions, dividends, reviews and creditor portal',true,80)
ON CONFLICT (key) DO NOTHING;

-- ---------- the app registry ----------
CREATE TABLE IF NOT EXISTS public.core_apps (
  app_id text PRIMARY KEY CHECK (app_id ~ '^[a-z]{2,30}$'),
  name text NOT NULL,
  product_key text NOT NULL REFERENCES public.dv_products(key),
  rbac_module text NOT NULL,
  stage text UNIQUE CHECK (stage IS NULL OR stage IN ('lead','qualify','debtverge','draftverge','ivaverge')),
  display_order int NOT NULL
);
INSERT INTO public.core_apps (app_id, name, product_key, rbac_module, stage, display_order) VALUES
  ('leadverge','LeadVerge','leadverge','LEADVERGE','lead',10),
  ('qualifyverge','QualifyVerge','qualifyverge','QUALIFY','qualify',20),
  ('debtverge','DebtVerge','dmp_advisor','DEBTVERGE','debtverge',30),
  ('draftverge','DraftVerge','draftverge','DRAFTVERGE','draftverge',40),
  ('ivaverge','IVAVerge','ivaverge','IVAVERGE','ivaverge',50),
  ('stormcall','Storm Call','voip','STORMCALL',NULL,60),
  ('compliance','Compliance','compliance','COMPLIANCE',NULL,70)
ON CONFLICT (app_id) DO NOTHING;

ALTER TABLE public.core_apps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_all_clients ON public.core_apps;
CREATE POLICY deny_all_clients ON public.core_apps AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
REVOKE ALL ON public.core_apps FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.core_apps TO service_role;

-- licences are changed only through core_set_org_app
ALTER TABLE public.dv_org_products ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON public.dv_org_products FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_audit_row ON public.dv_org_products;
CREATE TRIGGER trg_audit_row AFTER INSERT OR UPDATE ON public.dv_org_products FOR EACH ROW EXECUTE FUNCTION public.dv_audit_row();

-- ---------- permissions and apps ----------
CREATE OR REPLACE FUNCTION public.core_has_perm(p_org uuid, p_module text, p_action text DEFAULT 'view') RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT is_super_admin() OR EXISTS (
    SELECT 1 FROM organization_users ou
      JOIN rbac_role_permissions rp ON rp.role_id = ou.role_id
      JOIN rbac_permissions p ON p.id = rp.permission_id
     WHERE ou.organization_id = p_org AND ou.user_id = auth.uid()
       AND p.module = p_module AND p.action IN (p_action, 'manage'));
$$;

-- stages the signed-in user may see in this firm: the app is licensed and the role allows viewing it ('closed' if any)
CREATE OR REPLACE FUNCTION public.core_allowed_stages(p_org uuid) RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE WHEN count(*) = 0 THEN ARRAY[]::text[] ELSE array_agg(stage) || ARRAY['closed'] END
    FROM core_apps a
   WHERE a.stage IS NOT NULL AND dv_org_has_product(p_org, a.product_key) AND core_has_perm(p_org, a.rbac_module, 'view');
$$;

CREATE OR REPLACE FUNCTION public.core_my_apps() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE o uuid := dv_my_org(); res jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'sign in required' USING ERRCODE = '28000'; END IF;
  IF o IS NULL THEN RETURN jsonb_build_object('organization_id', NULL, 'apps', '[]'::jsonb); END IF;
  IF NOT dv_mfa_ok(o) THEN RETURN jsonb_build_object('organization_id', o, 'apps', '[]'::jsonb); END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('app_id', a.app_id, 'name', a.name, 'stage', a.stage,
           'can_edit', core_has_perm(o, a.rbac_module, 'edit'), 'can_manage', core_has_perm(o, a.rbac_module, 'manage')) ORDER BY a.display_order), '[]'::jsonb)
    INTO res
    FROM core_apps a
   WHERE dv_org_has_product(o, a.product_key) AND core_has_perm(o, a.rbac_module, 'view');
  RETURN jsonb_build_object('organization_id', o, 'apps', res);
END $$;

-- Grant or end a firm's licence for an app. Platform super admin or service role only.
CREATE OR REPLACE FUNCTION public.core_set_org_app(p_org uuid, p_app text, p_enabled boolean, p_starts date DEFAULT current_date, p_ends date DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE pk text;
BEGIN
  IF NOT (is_super_admin() OR coalesce(auth.role(), '') = 'service_role') THEN
    RAISE EXCEPTION 'only the platform administrator can change licences' USING ERRCODE = '42501';
  END IF;
  SELECT product_key INTO pk FROM core_apps WHERE app_id = p_app;
  IF pk IS NULL THEN RAISE EXCEPTION 'unknown app' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = p_org) THEN RAISE EXCEPTION 'unknown firm' USING ERRCODE = '22023'; END IF;
  IF p_ends IS NOT NULL AND p_ends < coalesce(p_starts, current_date) THEN RAISE EXCEPTION 'the end date is before the start date' USING ERRCODE = '22023'; END IF;
  INSERT INTO dv_org_products (organization_id, product_key, enabled, starts_on, ends_on)
  VALUES (p_org, pk, p_enabled, coalesce(p_starts, current_date), p_ends)
  ON CONFLICT (organization_id, product_key) DO UPDATE SET enabled = EXCLUDED.enabled, starts_on = EXCLUDED.starts_on, ends_on = EXCLUDED.ends_on;
END $$;

-- ---------- clients respect licence and role ----------
CREATE OR REPLACE FUNCTION public.core_client_can_read(p_client uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM core_clients c
    WHERE c.id = p_client AND c.deleted_at IS NULL AND dv_is_org_member(c.organization_id) AND dv_mfa_ok(c.organization_id)
      AND c.current_stage = ANY (core_allowed_stages(c.organization_id))
      AND (NOT c.is_restricted OR c.assigned_to = auth.uid() OR c.created_by = auth.uid() OR dv_is_manager(c.organization_id))
  );
$$;

CREATE OR REPLACE FUNCTION public.core_client_list(p_stage text DEFAULT NULL, p_search text DEFAULT NULL, p_limit int DEFAULT 50) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE o uuid := dv_my_org(); lim int := least(greatest(coalesce(p_limit, 50), 1), 200); q text := nullif(btrim(coalesce(p_search, '')), ''); res jsonb; allowed text[];
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'sign in required' USING ERRCODE = '28000'; END IF;
  IF o IS NULL OR NOT dv_mfa_ok(o) THEN RETURN '[]'::jsonb; END IF;
  IF p_stage IS NOT NULL AND p_stage NOT IN ('lead','qualify','debtverge','draftverge','ivaverge','closed') THEN
    RAISE EXCEPTION 'unknown stage' USING ERRCODE = '22023';
  END IF;
  allowed := core_allowed_stages(o);
  SELECT coalesce(jsonb_agg(x ORDER BY x->>'stage_entered_at' DESC), '[]'::jsonb) INTO res FROM (
    SELECT jsonb_build_object('id', c.id, 'display_name', c.display_name, 'reference', c.reference, 'current_stage', c.current_stage,
             'stage_entered_at', c.stage_entered_at, 'assigned_to', c.assigned_to) x
      FROM core_clients c
     WHERE c.organization_id = o AND c.deleted_at IS NULL
       AND c.current_stage = ANY (allowed)
       AND (p_stage IS NULL OR c.current_stage = p_stage)
       AND (q IS NULL OR c.display_name ILIKE '%' || replace(replace(q, '%', ''), '_', '') || '%' OR c.reference ILIKE '%' || replace(replace(q, '%', ''), '_', '') || '%')
       AND (NOT c.is_restricted OR c.assigned_to = auth.uid() OR c.created_by = auth.uid() OR dv_is_manager(o))
     ORDER BY c.stage_entered_at DESC LIMIT lim
  ) s;
  RETURN res;
END $$;

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

  -- the firm must be licensed for the app the client is going to
  SELECT * INTO tgt FROM core_apps WHERE stage = p_to;
  IF FOUND AND NOT dv_org_has_product(c.organization_id, tgt.product_key) THEN
    RAISE EXCEPTION 'your firm is not licensed for %', tgt.name USING ERRCODE = '42501';
  END IF;
  -- the person must be allowed to work in the app the client is leaving (or the one it is going to, when reopening)
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

  UPDATE core_clients SET current_stage = p_to, stage_entered_at = now(), updated_at = now() WHERE id = c.id;
  INSERT INTO core_client_stages (client_id, organization_id, from_stage, to_stage, reason, changed_by, approved_by)
  VALUES (c.id, c.organization_id, c.current_stage, p_to, why, auth.uid(), p_approver);
  RETURN jsonb_build_object('client_id', c.id, 'from_stage', c.current_stage, 'to_stage', p_to);
END $$;

-- next_stages shown to the person are limited to the moves they could actually make
CREATE OR REPLACE FUNCTION public.core_client_get(p_client uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c core_clients; hist jsonb; nxt jsonb; cc boolean; src core_apps;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'sign in required' USING ERRCODE = '28000'; END IF;
  IF NOT core_client_can_read(p_client) THEN RAISE EXCEPTION 'client not found' USING ERRCODE = '42501'; END IF;
  SELECT * INTO c FROM core_clients WHERE id = p_client;
  SELECT * INTO src FROM core_apps WHERE stage = c.current_stage;
  cc := core_client_can_change(p_client) AND c.erased_at IS NULL
        AND (dv_is_manager(c.organization_id) OR (FOUND AND core_has_perm(c.organization_id, src.rbac_module, 'edit')));
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'from_stage', h.from_stage, 'to_stage', h.to_stage, 'reason', h.reason,
           'changed_by', h.changed_by, 'approved_by', h.approved_by, 'at', h.created_at) ORDER BY h.created_at, h.id), '[]'::jsonb)
    INTO hist FROM core_client_stages h WHERE h.client_id = p_client;
  SELECT CASE WHEN cc THEN coalesce(jsonb_agg(jsonb_build_object('to_stage', r.to_stage, 'needs_approver', r.needs_approver, 'note', r.note) ORDER BY r.to_stage), '[]'::jsonb) ELSE '[]'::jsonb END
    INTO nxt FROM core_stage_rules r
    LEFT JOIN core_apps t ON t.stage = r.to_stage
   WHERE r.from_stage = c.current_stage AND (t.app_id IS NULL OR dv_org_has_product(c.organization_id, t.product_key));
  RETURN jsonb_build_object(
    'client', jsonb_build_object('id', c.id, 'display_name', c.display_name, 'reference', c.reference, 'current_stage', c.current_stage,
              'stage_entered_at', c.stage_entered_at, 'assigned_to', c.assigned_to, 'is_restricted', c.is_restricted, 'created_at', c.created_at),
    'history', hist, 'next_stages', nxt, 'can_change', cc);
END $$;

-- ---------- roles ----------
CREATE OR REPLACE FUNCTION public.seed_debtverge_roles(org uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE spec record; rid uuid;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('Advisor', ARRAY['DEBTVERGE:view','DEBTVERGE:edit','PAY:view','COMPLIANCE:view','STORMCALL:view','STORMCALL:edit','MAIL:view','MAIL:edit','KNOWLEDGE:view']),
      ('Team Manager', ARRAY['DEBTVERGE:view','DEBTVERGE:edit','DEBTVERGE:manage','PAY:view','COMPLIANCE:view','COMPLIANCE:edit','STORMCALL:view','STORMCALL:edit','MAIL:view','MAIL:edit','AGENT:view','AGENT:edit','KNOWLEDGE:view',
        'LEADVERGE:view','LEADVERGE:edit','LEADVERGE:manage','QUALIFY:view','QUALIFY:edit','QUALIFY:manage','DRAFTVERGE:view','DRAFTVERGE:edit','DRAFTVERGE:manage','IVAVERGE:view','IVAVERGE:edit','IVAVERGE:manage']),
      ('Operations Manager', ARRAY['DEBTVERGE:view','DEBTVERGE:edit','DEBTVERGE:manage','PAY:view','PAY:edit','PAY:manage','COMPLIANCE:view','COMPLIANCE:edit','COMPLIANCE:manage','STORMCALL:view','MAIL:view','AGENT:view','AGENT:edit','AGENT:manage','KNOWLEDGE:view','KNOWLEDGE:edit',
        'LEADVERGE:view','LEADVERGE:edit','LEADVERGE:manage','QUALIFY:view','QUALIFY:edit','QUALIFY:manage','DRAFTVERGE:view','DRAFTVERGE:edit','DRAFTVERGE:manage','IVAVERGE:view','IVAVERGE:edit','IVAVERGE:manage']),
      ('Lead Handler', ARRAY['LEADVERGE:view','LEADVERGE:edit','STORMCALL:view','STORMCALL:edit','MAIL:view','MAIL:edit','KNOWLEDGE:view']),
      ('Qualifier', ARRAY['QUALIFY:view','QUALIFY:edit','STORMCALL:view','STORMCALL:edit','COMPLIANCE:view','MAIL:view','MAIL:edit','KNOWLEDGE:view']),
      ('Drafter', ARRAY['DRAFTVERGE:view','DRAFTVERGE:edit','QUALIFY:view','MAIL:view','MAIL:edit','KNOWLEDGE:view']),
      ('IVA Supervisor', ARRAY['IVAVERGE:view','IVAVERGE:edit','IVAVERGE:manage','DRAFTVERGE:view','STORMCALL:view','STORMCALL:edit','COMPLIANCE:view','MAIL:view','MAIL:edit','KNOWLEDGE:view'])
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
END $function$;

-- existing firms: the new roles, and the new apps for every Admin role
DO $$
DECLARE o record;
BEGIN
  FOR o IN SELECT id FROM organizations LOOP
    PERFORM public.seed_debtverge_roles(o.id);
  END LOOP;
  INSERT INTO rbac_role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM rbac_roles r JOIN rbac_permissions p ON p.module IN ('DRAFTVERGE','IVAVERGE','STORMCALL','COMPLIANCE')
   WHERE r.name = 'Admin'
     AND NOT EXISTS (SELECT 1 FROM rbac_role_permissions x WHERE x.role_id = r.id AND x.permission_id = p.id);
END $$;

-- ---------- who can call what ----------
DO $$ DECLARE f text; BEGIN
  FOREACH f IN ARRAY ARRAY['core_has_perm(uuid,text,text)','core_allowed_stages(uuid)','core_my_apps()','core_set_org_app(uuid,text,boolean,date,date)',
                           'core_client_can_read(uuid)','core_client_list(text,text,integer)','core_client_change_stage(uuid,text,text,text,uuid)','core_client_get(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
  GRANT EXECUTE ON FUNCTION public.core_set_org_app(uuid,text,boolean,date,date) TO service_role;
END $$;
