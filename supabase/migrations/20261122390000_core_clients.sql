/*
  A3: the shared client record and its stage history.

  One client record per person, owned by the shared core. It moves through the stages
  (lead -> qualify -> debtverge | draftverge -> ivaverge, or closed) by a recorded stage change,
  never by copying data. Apps keep their own detail in their own tables and point at the client.

  - core_clients            one row per client; current stage; firm; owner. No client access: functions only.
  - core_client_stages      append-only history of every stage change (who, why, approver).
  - core_stage_rules        which stage moves are allowed and which need a second person.
  - debt_cases.client_id    links each DebtVerge case to its client (existing cases are backfilled).
  - functions               core_client_get, core_client_list, core_client_change_stage.

  Licence checks per app are added in the licences step; this step does not gate by licence.
*/

-- ---------- tables ----------
CREATE TABLE IF NOT EXISTS public.core_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 200),
  reference text CHECK (reference IS NULL OR length(reference) <= 100),
  current_stage text NOT NULL DEFAULT 'lead'
    CHECK (current_stage IN ('lead','qualify','debtverge','draftverge','ivaverge','closed')),
  stage_entered_at timestamptz NOT NULL DEFAULT now(),
  assigned_to uuid REFERENCES auth.users(id),
  is_restricted boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  erased_at timestamptz,
  deleted_at timestamptz,
  deleted_by uuid
);
CREATE INDEX IF NOT EXISTS core_clients_org_stage_idx ON public.core_clients (organization_id, current_stage) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS core_clients_assigned_idx ON public.core_clients (assigned_to) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.core_client_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.core_clients(id),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  from_stage text CHECK (from_stage IS NULL OR from_stage IN ('lead','qualify','debtverge','draftverge','ivaverge','closed')),
  to_stage text NOT NULL CHECK (to_stage IN ('lead','qualify','debtverge','draftverge','ivaverge','closed')),
  reason text NOT NULL CHECK (length(btrim(reason)) >= 3),
  changed_by uuid REFERENCES auth.users(id),
  approved_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS core_client_stages_client_idx ON public.core_client_stages (client_id, created_at);

CREATE TABLE IF NOT EXISTS public.core_stage_rules (
  from_stage text NOT NULL CHECK (from_stage IN ('lead','qualify','debtverge','draftverge','ivaverge','closed')),
  to_stage text NOT NULL CHECK (to_stage IN ('lead','qualify','debtverge','draftverge','ivaverge','closed')),
  needs_approver boolean NOT NULL DEFAULT false,
  note text,
  PRIMARY KEY (from_stage, to_stage),
  CHECK (from_stage <> to_stage)
);

INSERT INTO public.core_stage_rules (from_stage, to_stage, needs_approver, note) VALUES
  ('lead','qualify',false,'First fact-find done; hand to qualification'),
  ('qualify','debtverge',false,'Decision: DMP'),
  ('qualify','draftverge',false,'Decision: IVA'),
  ('draftverge','ivaverge',false,'IVA arranged; hand to supervision'),
  ('debtverge','qualify',false,'Re-assess (for example a DMP client who may now need an IVA)'),
  ('draftverge','qualify',false,'Back for re-assessment'),
  ('lead','closed',false,'Not proceeding'),
  ('qualify','closed',false,'Not suitable or withdrawn'),
  ('debtverge','closed',false,'Plan ended'),
  ('draftverge','closed',false,'Not proceeding'),
  ('ivaverge','closed',false,'IVA completed, failed or terminated'),
  ('closed','qualify',true,'Reopen; needs a second person to approve')
ON CONFLICT (from_stage, to_stage) DO NOTHING;

ALTER TABLE public.debt_cases ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES public.core_clients(id);
CREATE INDEX IF NOT EXISTS debt_cases_client_idx ON public.debt_cases (client_id) WHERE client_id IS NOT NULL;

-- ---------- lock the tables down (functions only) ----------
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['core_clients','core_client_stages','core_stage_rules'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS deny_all_clients ON public.%I', t);
    EXECUTE format('CREATE POLICY deny_all_clients ON public.%I AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO service_role', t);
  END LOOP;
END $$;

-- history can never be changed or removed; clients can never be deleted
DROP TRIGGER IF EXISTS trg_immutable ON public.core_client_stages;
CREATE TRIGGER trg_immutable BEFORE UPDATE OR DELETE ON public.core_client_stages FOR EACH ROW EXECUTE FUNCTION public.dv_audit_immutable();
DROP TRIGGER IF EXISTS trg_no_delete ON public.core_clients;
CREATE TRIGGER trg_no_delete BEFORE DELETE ON public.core_clients FOR EACH ROW EXECUTE FUNCTION public.dv_no_delete();
DROP TRIGGER IF EXISTS trg_audit_row ON public.core_clients;
CREATE TRIGGER trg_audit_row AFTER INSERT OR UPDATE ON public.core_clients FOR EACH ROW EXECUTE FUNCTION public.dv_audit_row();
DROP TRIGGER IF EXISTS trg_audit_row ON public.core_stage_rules;

-- ---------- keep the client in step with DebtVerge cases ----------
-- A new case gets a client record (stage 'debtverge') unless it is given one from another stage.
CREATE OR REPLACE FUNCTION public.core_case_client_link() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE cid uuid; corg uuid;
BEGIN
  IF NEW.client_id IS NOT NULL THEN
    SELECT organization_id INTO corg FROM core_clients WHERE id = NEW.client_id;
    IF corg IS NULL OR corg IS DISTINCT FROM NEW.organization_id THEN
      RAISE EXCEPTION 'the client belongs to a different firm' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.organization_id IS NULL THEN RETURN NEW; END IF;
  INSERT INTO core_clients (organization_id, display_name, reference, current_stage, assigned_to, is_restricted, created_by)
  VALUES (NEW.organization_id, left(btrim(NEW.debtor_name), 200), NEW.debtor_reference, 'debtverge', NEW.assigned_to, NEW.is_restricted, NEW.user_id)
  RETURNING id INTO cid;
  INSERT INTO core_client_stages (client_id, organization_id, from_stage, to_stage, reason, changed_by)
  VALUES (cid, NEW.organization_id, NULL, 'debtverge', 'Case opened in DebtVerge', NEW.user_id);
  NEW.client_id := cid;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_core_case_client_link ON public.debt_cases;
CREATE TRIGGER trg_core_case_client_link BEFORE INSERT ON public.debt_cases FOR EACH ROW EXECUTE FUNCTION public.core_case_client_link();

-- the link is set once and never moved or removed
CREATE OR REPLACE FUNCTION public.core_case_client_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE corg uuid;
BEGIN
  IF OLD.client_id IS NOT NULL AND NEW.client_id IS DISTINCT FROM OLD.client_id THEN
    RAISE EXCEPTION 'a case cannot be moved to a different client' USING ERRCODE = '42501';
  END IF;
  IF NEW.client_id IS NOT NULL AND NEW.client_id IS DISTINCT FROM OLD.client_id THEN
    SELECT organization_id INTO corg FROM core_clients WHERE id = NEW.client_id;
    IF corg IS NULL OR corg IS DISTINCT FROM NEW.organization_id THEN
      RAISE EXCEPTION 'the client belongs to a different firm' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_core_case_client_guard ON public.debt_cases;
CREATE TRIGGER trg_core_case_client_guard BEFORE UPDATE OF client_id ON public.debt_cases FOR EACH ROW EXECUTE FUNCTION public.core_case_client_guard();

-- name, reference and erasure follow the case; stage, owner and restriction are managed on the client itself
CREATE OR REPLACE FUNCTION public.core_case_client_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.client_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.erased_at IS NOT NULL AND OLD.erased_at IS NULL THEN
    UPDATE core_clients SET display_name = 'Erased', reference = NULL, erased_at = NEW.erased_at, updated_at = now() WHERE id = NEW.client_id;
  ELSIF NEW.debtor_name IS DISTINCT FROM OLD.debtor_name OR NEW.debtor_reference IS DISTINCT FROM OLD.debtor_reference THEN
    UPDATE core_clients SET display_name = left(btrim(NEW.debtor_name), 200), reference = NEW.debtor_reference, updated_at = now()
     WHERE id = NEW.client_id AND erased_at IS NULL;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_core_case_client_sync ON public.debt_cases;
CREATE TRIGGER trg_core_case_client_sync AFTER UPDATE ON public.debt_cases FOR EACH ROW EXECUTE FUNCTION public.core_case_client_sync();

-- ---------- bring existing cases across (one client each, stage 'debtverge') ----------
DO $$
DECLARE c record; cid uuid;
BEGIN
  FOR c IN SELECT id, organization_id, debtor_name, debtor_reference, assigned_to, is_restricted, user_id, erased_at, created_at
             FROM debt_cases WHERE client_id IS NULL AND organization_id IS NOT NULL ORDER BY created_at LOOP
    INSERT INTO core_clients (organization_id, display_name, reference, current_stage, assigned_to, is_restricted, created_by, created_at, stage_entered_at, erased_at)
    VALUES (c.organization_id, CASE WHEN c.erased_at IS NOT NULL THEN 'Erased' ELSE left(btrim(c.debtor_name), 200) END,
            CASE WHEN c.erased_at IS NOT NULL THEN NULL ELSE c.debtor_reference END,
            'debtverge', c.assigned_to, c.is_restricted, c.user_id, c.created_at, c.created_at, c.erased_at)
    RETURNING id INTO cid;
    INSERT INTO core_client_stages (client_id, organization_id, from_stage, to_stage, reason, changed_by, created_at)
    VALUES (cid, c.organization_id, NULL, 'debtverge', 'Existing DebtVerge case brought into the shared client record', c.user_id, now());
    UPDATE debt_cases SET client_id = cid WHERE id = c.id;
  END LOOP;
END $$;

-- ---------- reading ----------
-- Who may read a client: a member of the firm (MFA satisfied) and, for restricted clients, the owner, creator or a manager.
CREATE OR REPLACE FUNCTION public.core_client_can_read(p_client uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM core_clients c
    WHERE c.id = p_client AND c.deleted_at IS NULL AND dv_is_org_member(c.organization_id) AND dv_mfa_ok(c.organization_id)
      AND (NOT c.is_restricted OR c.assigned_to = auth.uid() OR c.created_by = auth.uid() OR dv_is_manager(c.organization_id))
  );
$$;

-- Who may move a client between stages: the owner, the creator or a manager.
CREATE OR REPLACE FUNCTION public.core_client_can_change(p_client uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM core_clients c
    WHERE c.id = p_client AND c.deleted_at IS NULL AND c.erased_at IS NULL AND dv_is_org_member(c.organization_id) AND dv_mfa_ok(c.organization_id)
      AND (c.assigned_to = auth.uid() OR c.created_by = auth.uid() OR dv_is_manager(c.organization_id))
  );
$$;

CREATE OR REPLACE FUNCTION public.core_client_get(p_client uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c core_clients; hist jsonb; nxt jsonb; cc boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'sign in required' USING ERRCODE = '28000'; END IF;
  IF NOT core_client_can_read(p_client) THEN RAISE EXCEPTION 'client not found' USING ERRCODE = '42501'; END IF;
  SELECT * INTO c FROM core_clients WHERE id = p_client;
  cc := core_client_can_change(p_client);
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'from_stage', h.from_stage, 'to_stage', h.to_stage, 'reason', h.reason,
           'changed_by', h.changed_by, 'approved_by', h.approved_by, 'at', h.created_at) ORDER BY h.created_at, h.id), '[]'::jsonb)
    INTO hist FROM core_client_stages h WHERE h.client_id = p_client;
  SELECT CASE WHEN cc AND c.erased_at IS NULL THEN coalesce(jsonb_agg(jsonb_build_object('to_stage', r.to_stage, 'needs_approver', r.needs_approver, 'note', r.note) ORDER BY r.to_stage), '[]'::jsonb) ELSE '[]'::jsonb END
    INTO nxt FROM core_stage_rules r WHERE r.from_stage = c.current_stage;
  RETURN jsonb_build_object(
    'client', jsonb_build_object('id', c.id, 'display_name', c.display_name, 'reference', c.reference, 'current_stage', c.current_stage,
              'stage_entered_at', c.stage_entered_at, 'assigned_to', c.assigned_to, 'is_restricted', c.is_restricted, 'created_at', c.created_at),
    'history', hist, 'next_stages', nxt, 'can_change', cc);
END $$;

CREATE OR REPLACE FUNCTION public.core_client_list(p_stage text DEFAULT NULL, p_search text DEFAULT NULL, p_limit int DEFAULT 50) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE o uuid := dv_my_org(); lim int := least(greatest(coalesce(p_limit, 50), 1), 200); q text := nullif(btrim(coalesce(p_search, '')), ''); res jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'sign in required' USING ERRCODE = '28000'; END IF;
  IF o IS NULL OR NOT dv_mfa_ok(o) THEN RETURN '[]'::jsonb; END IF;
  IF p_stage IS NOT NULL AND p_stage NOT IN ('lead','qualify','debtverge','draftverge','ivaverge','closed') THEN
    RAISE EXCEPTION 'unknown stage' USING ERRCODE = '22023';
  END IF;
  SELECT coalesce(jsonb_agg(x ORDER BY x->>'stage_entered_at' DESC), '[]'::jsonb) INTO res FROM (
    SELECT jsonb_build_object('id', c.id, 'display_name', c.display_name, 'reference', c.reference, 'current_stage', c.current_stage,
             'stage_entered_at', c.stage_entered_at, 'assigned_to', c.assigned_to) x
      FROM core_clients c
     WHERE c.organization_id = o AND c.deleted_at IS NULL
       AND (p_stage IS NULL OR c.current_stage = p_stage)
       AND (q IS NULL OR c.display_name ILIKE '%' || replace(replace(q, '%', ''), '_', '') || '%' OR c.reference ILIKE '%' || replace(replace(q, '%', ''), '_', '') || '%')
       AND (NOT c.is_restricted OR c.assigned_to = auth.uid() OR c.created_by = auth.uid() OR dv_is_manager(o))
     ORDER BY c.stage_entered_at DESC LIMIT lim
  ) s;
  RETURN res;
END $$;

-- ---------- changing stage ----------
CREATE OR REPLACE FUNCTION public.core_client_change_stage(p_client uuid, p_from text, p_to text, p_reason text, p_approver uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c core_clients; rule core_stage_rules; why text := btrim(coalesce(p_reason, ''));
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'sign in required' USING ERRCODE = '28000'; END IF;
  IF length(why) < 10 THEN RAISE EXCEPTION 'give the reason for the change (at least 10 characters)' USING ERRCODE = '22023'; END IF;
  IF length(why) > 2000 THEN RAISE EXCEPTION 'reason is too long' USING ERRCODE = '22023'; END IF;

  SELECT * INTO c FROM core_clients WHERE id = p_client FOR UPDATE;
  IF NOT FOUND OR NOT core_client_can_change(p_client) THEN RAISE EXCEPTION 'you cannot change this client' USING ERRCODE = '42501'; END IF;
  IF c.current_stage IS DISTINCT FROM p_from THEN
    RAISE EXCEPTION 'this client has already moved to %; reload and check', c.current_stage USING ERRCODE = '40001';
  END IF;

  SELECT * INTO rule FROM core_stage_rules WHERE from_stage = c.current_stage AND to_stage = p_to;
  IF NOT FOUND THEN RAISE EXCEPTION 'a client cannot move from % to %', c.current_stage, p_to USING ERRCODE = '22023'; END IF;

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

-- ---------- who can call what ----------
DO $$ DECLARE f text; BEGIN
  FOREACH f IN ARRAY ARRAY['core_client_can_read(uuid)','core_client_can_change(uuid)','core_client_get(uuid)','core_client_list(text,text,integer)','core_client_change_stage(uuid,text,text,text,uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
  -- trigger functions are never called directly
  FOREACH f IN ARRAY ARRAY['core_case_client_link()','core_case_client_guard()','core_case_client_sync()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
  END LOOP;
END $$;
