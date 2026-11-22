-- WhatsApp in the conversation, 24-hour customer-service window enforced, and inbound SMS/WhatsApp matched to cases.
ALTER TABLE public.comms_outbox DROP CONSTRAINT IF EXISTS comms_outbox_channel_check;
ALTER TABLE public.comms_outbox ADD CONSTRAINT comms_outbox_channel_check CHECK (channel IN ('email','sms','whatsapp'));
ALTER TABLE public.debtverge_communications ADD COLUMN IF NOT EXISTS provider_id text;
CREATE UNIQUE INDEX IF NOT EXISTS debtverge_comms_provider_id_uq ON public.debtverge_communications (provider_id) WHERE provider_id IS NOT NULL;
ALTER TABLE public.debtverge_unassigned_messages ADD COLUMN IF NOT EXISTS provider_id text;
CREATE UNIQUE INDEX IF NOT EXISTS debtverge_unassigned_provider_id_uq ON public.debtverge_unassigned_messages (provider_id) WHERE provider_id IS NOT NULL;
-- Clients never create inbound messages; only the inbound webhook (service role) does.
DROP POLICY IF EXISTS insert_org_debtverge_unassigned_messages ON public.debtverge_unassigned_messages;

DROP FUNCTION IF EXISTS public.dv_queue_message(uuid, text, text, text);
DROP FUNCTION IF EXISTS public.dv_queue_message(uuid, text, text, text, uuid, text);
CREATE OR REPLACE FUNCTION public.dv_queue_message(p_case uuid, p_channel text, p_subject text, p_body text, p_thread uuid DEFAULT NULL, p_agent text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE c debt_cases; addr text; oid uuid; v_thread uuid;
BEGIN
  SELECT * INTO c FROM debt_cases WHERE id = p_case AND deleted_at IS NULL;
  IF c.id IS NULL OR NOT dv_can_edit_case(p_case) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF p_channel NOT IN ('email','sms','whatsapp') THEN RAISE EXCEPTION 'unsupported channel' USING ERRCODE = '22023'; END IF;
  IF p_body IS NULL OR btrim(p_body) = '' THEN RAISE EXCEPTION 'message is empty' USING ERRCODE = '22023'; END IF;
  IF p_channel = 'whatsapp' AND NOT EXISTS (
       SELECT 1 FROM debtverge_communications WHERE case_id = p_case AND channel = 'whatsapp' AND direction = 'inbound'
         AND deleted_at IS NULL AND created_at > now() - interval '24 hours') THEN
    RAISE EXCEPTION 'WhatsApp can only be used within 24 hours of the customer''s last WhatsApp message. Use SMS or email to start the conversation.' USING ERRCODE = '22023';
  END IF;
  IF p_thread IS NOT NULL THEN
    SELECT thread_id INTO v_thread FROM debtverge_communications WHERE case_id = p_case AND thread_id = p_thread LIMIT 1;
  END IF;
  IF p_channel IN ('sms','whatsapp') THEN SELECT mobile_phone INTO addr FROM debt_customer_profiles WHERE case_id = p_case;
  ELSE SELECT primary_email INTO addr FROM debt_customer_profiles WHERE case_id = p_case; END IF;
  IF addr IS NULL OR btrim(addr) = '' THEN RAISE EXCEPTION 'no % contact on this case', p_channel; END IF;
  INSERT INTO comms_outbox (organization_id, case_id, channel, to_address, subject, body, trigger, thread_id, agent_name)
  VALUES (c.organization_id, p_case, p_channel, addr, CASE WHEN p_channel = 'email' THEN p_subject END, p_body, 'manual', v_thread, left(p_agent, 120)) RETURNING id INTO oid;
  RETURN oid;
END $function$;
REVOKE ALL ON FUNCTION public.dv_queue_message(uuid,text,text,text,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dv_queue_message(uuid,text,text,text,uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.dv_record_inbound(p_channel text, p_from text, p_name text, p_body text, p_provider_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE d text; v_case uuid; n int; v_name text; v_thread uuid;
BEGIN
  IF p_channel NOT IN ('sms','whatsapp') THEN RAISE EXCEPTION 'unsupported channel' USING ERRCODE='22023'; END IF;
  IF p_provider_id IS NOT NULL AND (EXISTS (SELECT 1 FROM debtverge_communications WHERE provider_id = p_provider_id)
        OR EXISTS (SELECT 1 FROM debtverge_unassigned_messages WHERE provider_id = p_provider_id)) THEN
    RETURN jsonb_build_object('status','duplicate');
  END IF;
  d := right(regexp_replace(coalesce(p_from,''), '\D', '', 'g'), 10);
  IF length(d) >= 9 THEN
    SELECT count(DISTINCT p.case_id), min(p.case_id::text)::uuid INTO n, v_case
      FROM debt_customer_profiles p JOIN debt_cases c ON c.id = p.case_id AND c.deleted_at IS NULL
     WHERE right(regexp_replace(coalesce(p.mobile_phone,''), '\D','','g'), 10) = d
        OR right(regexp_replace(coalesce(p.landline_phone,''), '\D','','g'), 10) = d
        OR right(regexp_replace(coalesce(p.work_phone,''), '\D','','g'), 10) = d;
  ELSE n := 0; END IF;
  IF n = 1 THEN
    SELECT debtor_name INTO v_name FROM debt_cases WHERE id = v_case;
    v_thread := coalesce((SELECT thread_id FROM debtverge_communications WHERE case_id = v_case AND deleted_at IS NULL AND thread_id IS NOT NULL ORDER BY created_at DESC LIMIT 1), md5(v_case::text)::uuid);
    INSERT INTO debtverge_communications (case_id, thread_id, channel, direction, sender_name, sender_email_or_phone, sender_type, recipient_name, body, status, matched_automatically, provider_id)
    VALUES (v_case, v_thread, p_channel, 'inbound', coalesce(nullif(p_name,''), v_name, ''), left(p_from, 60), 'client', 'DebtVerge Team', left(p_body, 5000), 'delivered', true, p_provider_id);
    RETURN jsonb_build_object('status','matched');
  END IF;
  INSERT INTO debtverge_unassigned_messages (channel, sender_name, sender_email_or_phone, body, provider_id)
  VALUES (p_channel, coalesce(nullif(p_name,''), ''), left(p_from, 60), left(p_body, 5000), p_provider_id);
  RETURN jsonb_build_object('status', CASE WHEN n > 1 THEN 'ambiguous' ELSE 'unassigned' END);
END $function$;
REVOKE ALL ON FUNCTION public.dv_record_inbound(text,text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dv_record_inbound(text,text,text,text,text) TO service_role;
