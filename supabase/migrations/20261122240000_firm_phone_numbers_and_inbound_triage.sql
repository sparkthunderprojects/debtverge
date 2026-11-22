-- Each firm has its own number(s). The number a message arrives on decides the firm, so matching only searches that firm's cases,
-- and unmatched messages are parked for that firm's managers to triage.
CREATE TABLE IF NOT EXISTS public.org_phone_numbers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  e164 text NOT NULL UNIQUE CHECK (e164 ~ '^\+[1-9][0-9]{7,14}$'),
  label text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.org_phone_numbers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.org_phone_numbers FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.org_phone_numbers TO service_role;

ALTER TABLE public.debtverge_unassigned_messages ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.debtverge_unassigned_messages ADD COLUMN IF NOT EXISTS to_number text;
ALTER TABLE public.debtverge_unassigned_messages ADD COLUMN IF NOT EXISTS ignore_reason text;
-- Clients go through the triage functions only.
DROP POLICY IF EXISTS select_org_debtverge_unassigned_messages ON public.debtverge_unassigned_messages;
DROP POLICY IF EXISTS update_org_debtverge_unassigned_messages ON public.debtverge_unassigned_messages;
DROP POLICY IF EXISTS delete_org_debtverge_unassigned_messages ON public.debtverge_unassigned_messages;
CREATE POLICY select_super_admin_unassigned ON public.debtverge_unassigned_messages FOR SELECT TO authenticated USING (is_super_admin());
REVOKE INSERT, UPDATE, DELETE ON public.debtverge_unassigned_messages FROM anon, authenticated;

DROP FUNCTION IF EXISTS public.dv_record_inbound(text,text,text,text,text);
CREATE OR REPLACE FUNCTION public.dv_record_inbound(p_channel text, p_from text, p_name text, p_body text, p_provider_id text, p_to text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE d text; v_case uuid; n int; v_name text; v_thread uuid; v_org uuid; v_to text;
BEGIN
  IF p_channel NOT IN ('sms','whatsapp') THEN RAISE EXCEPTION 'unsupported channel' USING ERRCODE='22023'; END IF;
  IF p_provider_id IS NOT NULL AND (EXISTS (SELECT 1 FROM debtverge_communications WHERE provider_id = p_provider_id)
        OR EXISTS (SELECT 1 FROM debtverge_unassigned_messages WHERE provider_id = p_provider_id)) THEN
    RETURN jsonb_build_object('status','duplicate');
  END IF;
  v_to := '+' || regexp_replace(coalesce(p_to,''), '\D', '', 'g');
  SELECT organization_id INTO v_org FROM org_phone_numbers WHERE e164 = v_to;
  d := right(regexp_replace(coalesce(p_from,''), '\D', '', 'g'), 10);
  n := 0;
  IF v_org IS NOT NULL AND length(d) >= 9 THEN
    SELECT count(DISTINCT p.case_id), min(p.case_id::text)::uuid INTO n, v_case
      FROM debt_customer_profiles p JOIN debt_cases c ON c.id = p.case_id AND c.deleted_at IS NULL AND c.organization_id = v_org
     WHERE right(regexp_replace(coalesce(p.mobile_phone,''), '\D','','g'), 10) = d
        OR right(regexp_replace(coalesce(p.landline_phone,''), '\D','','g'), 10) = d
        OR right(regexp_replace(coalesce(p.work_phone,''), '\D','','g'), 10) = d;
  END IF;
  IF n = 1 THEN
    SELECT debtor_name INTO v_name FROM debt_cases WHERE id = v_case;
    v_thread := coalesce((SELECT thread_id FROM debtverge_communications WHERE case_id = v_case AND deleted_at IS NULL AND thread_id IS NOT NULL ORDER BY created_at DESC LIMIT 1), md5(v_case::text)::uuid);
    INSERT INTO debtverge_communications (case_id, thread_id, channel, direction, sender_name, sender_email_or_phone, sender_type, recipient_name, body, status, matched_automatically, provider_id)
    VALUES (v_case, v_thread, p_channel, 'inbound', coalesce(nullif(p_name,''), v_name, ''), left(p_from, 60), 'client', 'DebtVerge Team', left(p_body, 5000), 'delivered', true, p_provider_id);
    RETURN jsonb_build_object('status','matched');
  END IF;
  INSERT INTO debtverge_unassigned_messages (channel, sender_name, sender_email_or_phone, body, provider_id, organization_id, to_number)
  VALUES (p_channel, coalesce(nullif(p_name,''), ''), left(p_from, 60), left(p_body, 5000), p_provider_id, v_org, nullif(v_to,'+'));
  RETURN jsonb_build_object('status', CASE WHEN v_org IS NULL THEN 'unknown_number' WHEN n > 1 THEN 'ambiguous' ELSE 'unassigned' END);
END $function$;
REVOKE ALL ON FUNCTION public.dv_record_inbound(text,text,text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dv_record_inbound(text,text,text,text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.dv_list_unassigned()
RETURNS TABLE (id uuid, channel text, sender_name text, sender_email_or_phone text, body text, received_at timestamptz, to_number text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE o uuid := dv_my_org();
BEGIN
  IF o IS NULL OR NOT dv_is_manager(o) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT m.id, m.channel, m.sender_name, m.sender_email_or_phone, m.body, coalesce(m.received_at, m.created_at), m.to_number
    FROM debtverge_unassigned_messages m WHERE m.organization_id = o AND m.status = 'unassigned' ORDER BY coalesce(m.received_at, m.created_at) DESC LIMIT 200;
END $function$;

CREATE OR REPLACE FUNCTION public.dv_assign_unassigned(p_msg uuid, p_case uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE o uuid := dv_my_org(); m debtverge_unassigned_messages; v_name text; v_thread uuid;
BEGIN
  IF o IS NULL OR NOT dv_is_manager(o) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE='42501'; END IF;
  SELECT * INTO m FROM debtverge_unassigned_messages WHERE id = p_msg AND organization_id = o AND status = 'unassigned' FOR UPDATE;
  IF m.id IS NULL THEN RAISE EXCEPTION 'message not found or already handled' USING ERRCODE='22023'; END IF;
  SELECT debtor_name INTO v_name FROM debt_cases WHERE id = p_case AND organization_id = o AND deleted_at IS NULL;
  IF v_name IS NULL THEN RAISE EXCEPTION 'case not found' USING ERRCODE='22023'; END IF;
  v_thread := coalesce((SELECT thread_id FROM debtverge_communications WHERE case_id = p_case AND deleted_at IS NULL AND thread_id IS NOT NULL ORDER BY created_at DESC LIMIT 1), md5(p_case::text)::uuid);
  INSERT INTO debtverge_communications (case_id, thread_id, channel, direction, sender_name, sender_email_or_phone, sender_type, recipient_name, body, status, matched_automatically, provider_id, created_at)
  VALUES (p_case, v_thread, m.channel, 'inbound', coalesce(nullif(m.sender_name,''), v_name), m.sender_email_or_phone, 'client', 'DebtVerge Team', m.body, 'delivered', false, m.provider_id, coalesce(m.received_at, m.created_at));
  UPDATE debtverge_unassigned_messages SET status='matched', matched_case_id = p_case, matched_at = now(), matched_by = auth.uid()::text, updated_at = now() WHERE id = p_msg;
END $function$;

CREATE OR REPLACE FUNCTION public.dv_dismiss_unassigned(p_msg uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE o uuid := dv_my_org();
BEGIN
  IF o IS NULL OR NOT dv_is_manager(o) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE='42501'; END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 3 THEN RAISE EXCEPTION 'give a short reason (wrong number, spam...)' USING ERRCODE='22023'; END IF;
  UPDATE debtverge_unassigned_messages SET status='ignored', ignore_reason = left(btrim(p_reason),200), matched_at = now(), matched_by = auth.uid()::text, updated_at = now()
   WHERE id = p_msg AND organization_id = o AND status = 'unassigned';
  IF NOT FOUND THEN RAISE EXCEPTION 'message not found or already handled' USING ERRCODE='22023'; END IF;
END $function$;

CREATE OR REPLACE FUNCTION public.dv_list_org_numbers() RETURNS TABLE (id uuid, e164 text, label text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE o uuid := dv_my_org();
BEGIN
  IF o IS NULL OR NOT dv_is_manager(o) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT n.id, n.e164, n.label FROM org_phone_numbers n WHERE n.organization_id = o ORDER BY n.created_at;
END $function$;

CREATE OR REPLACE FUNCTION public.dv_add_org_number(p_e164 text, p_label text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE o uuid := dv_my_org(); nid uuid;
BEGIN
  IF o IS NULL OR NOT dv_is_org_admin(o) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE='42501'; END IF;
  BEGIN
    INSERT INTO org_phone_numbers (organization_id, e164, label) VALUES (o, btrim(p_e164), left(nullif(btrim(coalesce(p_label,'')),''), 60)) RETURNING id INTO nid;
  EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'that number is already registered' USING ERRCODE='23505';
            WHEN check_violation THEN RAISE EXCEPTION 'use international format, e.g. +447700900123' USING ERRCODE='22023'; END;
  RETURN nid;
END $function$;

CREATE OR REPLACE FUNCTION public.dv_remove_org_number(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE o uuid := dv_my_org();
BEGIN
  IF o IS NULL OR NOT dv_is_org_admin(o) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE='42501'; END IF;
  DELETE FROM org_phone_numbers WHERE id = p_id AND organization_id = o;
END $function$;

DO $$ DECLARE f text; BEGIN
  FOREACH f IN ARRAY ARRAY['dv_list_unassigned()','dv_assign_unassigned(uuid,uuid)','dv_dismiss_unassigned(uuid,text)','dv_list_org_numbers()','dv_add_org_number(text,text)','dv_remove_org_number(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;
