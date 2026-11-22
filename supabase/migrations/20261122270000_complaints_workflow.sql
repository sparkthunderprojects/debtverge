-- Complaints workflow: spot complaints in client messages, deadlines from the day the client first complained, automatic acknowledgement,
-- routing to a handler other than the case adviser, deadline tasks, structured outcome rules, redress with maker-checker, timeline and MI.
CREATE OR REPLACE FUNCTION public.dv_add_business_days(d date, n int) RETURNS date LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $$
DECLARE r date := d;
BEGIN WHILE dv_business_days(d, r) < n LOOP r := r + 1; END LOOP; RETURN r; END $$;

ALTER TABLE public.complaints
  ADD COLUMN IF NOT EXISTS root_cause text CHECK (root_cause IN ('fee_dispute','missed_payment_handling','creditor_contact','advice_quality','communication','data_error','delay','other')),
  ADD COLUMN IF NOT EXISTS fault text CHECK (fault IN ('firm','creditor','client','third_party','none')),
  ADD COLUMN IF NOT EXISTS outcome_reasoning text,
  ADD COLUMN IF NOT EXISTS final_response_ref text,
  ADD COLUMN IF NOT EXISTS adjustments_confirmed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','high')),
  ADD COLUMN IF NOT EXISTS source_comm_id uuid,
  ADD COLUMN IF NOT EXISTS ack_outbox_id uuid;
ALTER TABLE public.complaint_events ADD COLUMN IF NOT EXISTS by_name text;

-- Messages from the client that read like a complaint are flagged so an adviser cannot miss them.
ALTER TABLE public.debtverge_communications ADD COLUMN IF NOT EXISTS possible_complaint boolean NOT NULL DEFAULT false;
CREATE OR REPLACE FUNCTION public.dv_flag_possible_complaint() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.direction = 'inbound' AND NEW.channel IN ('email','sms','whatsapp')
     AND NEW.body ~* '\m(complain\w*|unhappy|not happy|unacceptable|ombudsman|appalled|furious|disgusted|disgraceful|compensation|trading standards|legal action|solicitor|rip[- ]?off|useless|incompetent)\M' THEN
    NEW.possible_complaint := true;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_flag_possible_complaint ON public.debtverge_communications;
CREATE TRIGGER trg_flag_possible_complaint BEFORE INSERT ON public.debtverge_communications FOR EACH ROW EXECUTE FUNCTION public.dv_flag_possible_complaint();

CREATE OR REPLACE FUNCTION public.dv_dismiss_complaint_flag(p_comm uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE cid uuid;
BEGIN
  SELECT case_id INTO cid FROM debtverge_communications WHERE id = p_comm;
  IF cid IS NULL OR NOT dv_can_edit_case(cid) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  UPDATE debtverge_communications SET possible_complaint = false WHERE id = p_comm;
END $$;

DROP FUNCTION IF EXISTS public.dv_log_complaint(uuid,text,text,text,text,date,boolean);
CREATE OR REPLACE FUNCTION public.dv_log_complaint(p_case uuid, p_complainant text, p_summary text, p_category text, p_channel text, p_received date, p_vulnerable boolean, p_source_comm uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE org uuid; cid uuid; ref text; n int; v_recv date; v_adv uuid; v_handler uuid; v_ack_due date; v_final_due date; v_firm text; v_oid uuid;
        ch text; v_try text[]; v_body text; v_vuln boolean := coalesce(p_vulnerable, false); v_first text;
BEGIN
  IF p_case IS NOT NULL THEN
    SELECT organization_id, assigned_to INTO org, v_adv FROM debt_cases WHERE id = p_case;
    IF org IS NULL OR NOT dv_can_read_case(p_case) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  ELSE
    org := dv_my_org();
    IF org IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  END IF;
  IF btrim(COALESCE(p_summary,'')) = '' OR btrim(COALESCE(p_complainant,'')) = '' THEN RAISE EXCEPTION 'complainant and summary are required' USING ERRCODE = '22023'; END IF;
  IF p_source_comm IS NOT NULL THEN
    SELECT created_at::date INTO v_recv FROM debtverge_communications WHERE id = p_source_comm AND case_id = p_case AND deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'that message is not on this case' USING ERRCODE = '22023'; END IF;
  END IF;
  v_recv := coalesce(p_received, v_recv, current_date);
  IF v_recv > current_date THEN RAISE EXCEPTION 'the complaint cannot be received in the future' USING ERRCODE = '22023'; END IF;
  v_ack_due := dv_add_business_days(v_recv, 5);
  v_final_due := v_recv + 56;

  PERFORM pg_advisory_xact_lock(hashtext('complaint-ref-' || org::text));
  SELECT count(*) + 1 INTO n FROM complaints WHERE organization_id = org AND extract(year FROM received_on) = extract(year FROM v_recv);
  ref := 'C-' || extract(year FROM v_recv)::int || '-' || lpad(n::text, 4, '0');

  -- handler: the least busy manager who is not the case adviser (falls back to any manager)
  SELECT ou.user_id INTO v_handler FROM organization_users ou JOIN rbac_roles r ON r.id = ou.role_id
   WHERE ou.organization_id = org AND r.name IN ('Team Manager','Operations Manager','Admin') AND (v_adv IS NULL OR ou.user_id <> v_adv)
   ORDER BY (SELECT count(*) FROM complaints x WHERE x.assigned_to = ou.user_id AND x.status <> 'closed' AND x.deleted_at IS NULL), ou.user_id LIMIT 1;
  IF v_handler IS NULL THEN
    SELECT ou.user_id INTO v_handler FROM organization_users ou JOIN rbac_roles r ON r.id = ou.role_id
     WHERE ou.organization_id = org AND r.name IN ('Team Manager','Operations Manager','Admin') ORDER BY ou.user_id LIMIT 1;
  END IF;

  INSERT INTO complaints (organization_id, case_id, reference, complainant, received_on, channel, category, summary, vulnerable, priority, source_comm_id, assigned_to, created_by)
  VALUES (org, p_case, ref, btrim(p_complainant), v_recv, CASE WHEN p_channel IN ('phone','email','letter','portal') THEN p_channel ELSE 'other' END, COALESCE(p_category,'other'), btrim(p_summary), v_vuln,
          CASE WHEN v_vuln THEN 'high' ELSE 'normal' END, p_source_comm, v_handler, auth.uid())
  RETURNING id INTO cid;
  INSERT INTO complaint_events (complaint_id, organization_id, action, note, by_user) VALUES (cid, org, 'logged', btrim(p_summary), auth.uid());
  IF v_handler IS NOT NULL THEN INSERT INTO complaint_events (complaint_id, organization_id, action, note, by_user) VALUES (cid, org, 'assigned', 'Handler assigned automatically', auth.uid()); END IF;
  IF p_source_comm IS NOT NULL THEN UPDATE debtverge_communications SET possible_complaint = false WHERE id = p_source_comm; END IF;

  IF p_case IS NOT NULL THEN
    INSERT INTO case_tasks (case_id, organization_id, title, kind, due_date, status, assigned_to, source, auto_key, created_by) VALUES
      (p_case, org, 'Acknowledge complaint ' || ref,                  'statutory', v_ack_due,   'open', coalesce(v_handler, v_adv), 'auto', 'complaint:' || cid || ':ack', auth.uid()),
      (p_case, org, 'Investigate complaint ' || ref,                  'task',      v_recv + 14, 'open', coalesce(v_handler, v_adv), 'auto', 'complaint:' || cid || ':inv', auth.uid()),
      (p_case, org, 'Complaint ' || ref || ': 4-week check',          'review',    v_recv + 28, 'open', coalesce(v_handler, v_adv), 'auto', 'complaint:' || cid || ':w4',  auth.uid()),
      (p_case, org, 'Complaint ' || ref || ': 6-week check',          'review',    v_recv + 42, 'open', coalesce(v_handler, v_adv), 'auto', 'complaint:' || cid || ':w6',  auth.uid()),
      (p_case, org, 'Send final response for complaint ' || ref,      'statutory', v_recv + 49, 'open', coalesce(v_handler, v_adv), 'auto', 'complaint:' || cid || ':fin', auth.uid());
    INSERT INTO debt_audit_log (case_id, milestone, description) VALUES (p_case, 'Complaint logged', 'Complaint ' || ref || ' logged');

    -- automatic acknowledgement through the case conversation; the complaint is marked acknowledged when it is actually sent
    SELECT name INTO v_firm FROM organizations WHERE id = org;
    v_first := split_part(btrim(p_complainant), ' ', 1);
    v_body := 'Dear ' || v_first || E',\n\nThank you for getting in touch. We are sorry you have cause to complain and we are treating this as a formal complaint (reference ' || ref
      || E').\n\nWe will look into it and aim to send you our final response by ' || to_char(v_final_due, 'DD Mon YYYY')
      || E'. If you are unhappy with our final response, or we have not responded within 8 weeks, you may be able to refer your complaint to the Financial Ombudsman Service.\n\nIf you want to add anything, just reply to this message.\n\n'
      || coalesce(v_firm, 'Your debt adviser');
    v_try := CASE WHEN p_channel IN ('email','sms','whatsapp') THEN ARRAY[p_channel] ELSE ARRAY[]::text[] END || ARRAY['email','sms'];
    FOREACH ch IN ARRAY v_try LOOP
      BEGIN
        v_oid := dv_queue_message(p_case, ch, 'We have received your complaint (' || ref || ')', v_body, NULL, 'DebtVerge (automatic)');
        EXIT;
      EXCEPTION WHEN OTHERS THEN v_oid := NULL;
      END;
    END LOOP;
    IF v_oid IS NOT NULL THEN
      UPDATE complaints SET ack_outbox_id = v_oid WHERE id = cid;
      INSERT INTO complaint_events (complaint_id, organization_id, action, note, by_user) VALUES (cid, org, 'acknowledgement_queued', 'Acknowledgement queued to the client', auth.uid());
    ELSE
      INSERT INTO complaint_events (complaint_id, organization_id, action, note, by_user) VALUES (cid, org, 'acknowledgement_needed', 'No contact details to send an acknowledgement. Acknowledge by phone or post.', auth.uid());
    END IF;
  END IF;
  RETURN cid;
END $function$;
REVOKE ALL ON FUNCTION public.dv_log_complaint(uuid,text,text,text,text,date,boolean,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dv_log_complaint(uuid,text,text,text,text,date,boolean,uuid) TO authenticated;

-- the complaint is acknowledged when the acknowledgement really goes out
CREATE OR REPLACE FUNCTION public.dv_complaint_ack_on_send() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c complaints;
BEGIN
  SELECT * INTO c FROM complaints WHERE ack_outbox_id = NEW.id AND acknowledged_on IS NULL FOR UPDATE;
  IF c.id IS NOT NULL THEN
    UPDATE complaints SET acknowledged_on = current_date, status = CASE WHEN status = 'open' THEN 'acknowledged' ELSE status END WHERE id = c.id;
    INSERT INTO complaint_events (complaint_id, organization_id, action, note) VALUES (c.id, c.organization_id, 'acknowledged', 'Acknowledgement sent to the client');
    UPDATE case_tasks SET status = 'done', completed_at = now() WHERE auto_key = 'complaint:' || c.id || ':ack' AND status = 'open';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.dv_complaint_ack_on_send() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_complaint_ack_on_send ON public.comms_outbox;
CREATE TRIGGER trg_complaint_ack_on_send AFTER UPDATE OF status ON public.comms_outbox FOR EACH ROW WHEN (NEW.status = 'sent' AND OLD.status IS DISTINCT FROM 'sent') EXECUTE FUNCTION public.dv_complaint_ack_on_send();

DROP FUNCTION IF EXISTS public.dv_complaint_update(uuid,text,text,numeric,text,boolean);
CREATE OR REPLACE FUNCTION public.dv_complaint_update(p_id uuid, p_status text, p_outcome text DEFAULT NULL, p_note text DEFAULT NULL, p_fos boolean DEFAULT NULL,
  p_reasoning text DEFAULT NULL, p_root_cause text DEFAULT NULL, p_fault text DEFAULT NULL, p_final_ref text DEFAULT NULL, p_adjustments boolean DEFAULT NULL, p_assignee uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE c complaints; order_ text[] := ARRAY['open','acknowledged','investigating','final_response','closed']; r_old int; r_new int;
        o text; why text; rc text; f text; adj boolean;
BEGIN
  SELECT * INTO c FROM complaints WHERE id = p_id AND deleted_at IS NULL FOR UPDATE;
  IF c.id IS NULL OR NOT dv_is_manager(c.organization_id) THEN RAISE EXCEPTION 'managers only' USING ERRCODE = '42501'; END IF;
  IF c.status = 'closed' THEN RAISE EXCEPTION 'this complaint is closed' USING ERRCODE = '22023'; END IF;
  r_new := array_position(order_, p_status);
  IF r_new IS NULL THEN RAISE EXCEPTION 'unknown status' USING ERRCODE = '22023'; END IF;
  r_old := array_position(order_, c.status);
  IF r_new < r_old THEN RAISE EXCEPTION 'a complaint cannot move backwards' USING ERRCODE = '22023'; END IF;
  o := coalesce(nullif(p_outcome,''), c.outcome);
  why := coalesce(nullif(btrim(coalesce(p_reasoning,'')),''), c.outcome_reasoning);
  rc := coalesce(nullif(p_root_cause,''), c.root_cause);
  f := coalesce(nullif(p_fault,''), c.fault);
  adj := coalesce(p_adjustments, c.adjustments_confirmed);
  IF o IS NOT NULL AND o NOT IN ('upheld','partially_upheld','not_upheld') THEN RAISE EXCEPTION 'unknown outcome' USING ERRCODE = '22023'; END IF;
  IF r_new >= 4 THEN
    IF o IS NULL THEN RAISE EXCEPTION 'record the outcome before the final response' USING ERRCODE = '22023'; END IF;
    IF why IS NULL OR length(why) < 20 THEN RAISE EXCEPTION 'explain the reasoning behind the outcome (at least 20 characters)' USING ERRCODE = '22023'; END IF;
    IF rc IS NULL OR f IS NULL THEN RAISE EXCEPTION 'record the root cause and who was at fault' USING ERRCODE = '22023'; END IF;
    IF c.vulnerable AND NOT adj THEN RAISE EXCEPTION 'confirm that adjustments for a vulnerable client were considered' USING ERRCODE = '22023'; END IF;
  END IF;
  IF p_status = 'closed' AND c.status <> 'final_response' THEN RAISE EXCEPTION 'send the final response before closing' USING ERRCODE = '22023'; END IF;
  IF p_assignee IS NOT NULL AND NOT EXISTS (SELECT 1 FROM organization_users WHERE organization_id = c.organization_id AND user_id = p_assignee) THEN
    RAISE EXCEPTION 'that person is not in your firm' USING ERRCODE = '22023';
  END IF;

  UPDATE complaints SET status = p_status,
    acknowledged_on = CASE WHEN p_status = 'acknowledged' AND acknowledged_on IS NULL THEN current_date ELSE acknowledged_on END,
    final_response_on = CASE WHEN p_status = 'final_response' AND final_response_on IS NULL THEN current_date ELSE final_response_on END,
    outcome = o, outcome_reasoning = why, root_cause = rc, fault = f, adjustments_confirmed = adj,
    final_response_ref = coalesce(nullif(btrim(coalesce(p_final_ref,'')),''), final_response_ref),
    referred_to_fos = coalesce(p_fos, referred_to_fos),
    assigned_to = coalesce(p_assignee, assigned_to)
  WHERE id = p_id;

  IF p_status = 'acknowledged' OR r_new >= 3 THEN UPDATE case_tasks SET status = 'done', completed_at = now(), completed_by = auth.uid() WHERE auto_key = 'complaint:' || p_id || ':ack' AND status = 'open'; END IF;
  IF r_new >= 4 THEN UPDATE case_tasks SET status = 'cancelled' WHERE left(auto_key, length('complaint:' || p_id || ':')) = 'complaint:' || p_id || ':' AND status = 'open'; END IF;
  INSERT INTO complaint_events (complaint_id, organization_id, action, note, by_user) VALUES (p_id, c.organization_id, p_status, p_note, auth.uid());
  IF p_assignee IS NOT NULL AND p_assignee IS DISTINCT FROM c.assigned_to THEN INSERT INTO complaint_events (complaint_id, organization_id, action, note, by_user) VALUES (p_id, c.organization_id, 'reassigned', 'Handler changed', auth.uid()); END IF;
  IF p_fos IS TRUE AND NOT c.referred_to_fos THEN INSERT INTO complaint_events (complaint_id, organization_id, action, note, by_user) VALUES (p_id, c.organization_id, 'fos', 'Referred to the Financial Ombudsman Service', auth.uid()); END IF;
END $function$;
REVOKE ALL ON FUNCTION public.dv_complaint_update(uuid,text,text,text,boolean,text,text,text,text,boolean,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dv_complaint_update(uuid,text,text,text,boolean,text,text,text,text,boolean,uuid) TO authenticated;

-- Redress: one manager requests, a different manager approves, then it is recorded as paid
CREATE TABLE IF NOT EXISTS public.complaint_redress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  complaint_id uuid NOT NULL REFERENCES public.complaints(id),
  case_id uuid,
  amount numeric(12,2) NOT NULL CHECK (amount > 0 AND amount <= 100000),
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','approved','rejected','paid')),
  requested_by uuid NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid, decided_at timestamptz, paid_by uuid, paid_at timestamptz
);
CREATE INDEX IF NOT EXISTS complaint_redress_complaint_idx ON public.complaint_redress (complaint_id);
ALTER TABLE public.complaint_redress ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.complaint_redress FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.complaint_redress TO service_role;
CREATE POLICY deny_all_clients ON public.complaint_redress AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE TRIGGER trg_no_delete BEFORE DELETE ON public.complaint_redress FOR EACH ROW EXECUTE FUNCTION public.dv_no_delete();

CREATE OR REPLACE FUNCTION public.dv_request_redress(p_complaint uuid, p_amount numeric, p_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c complaints; rid uuid;
BEGIN
  SELECT * INTO c FROM complaints WHERE id = p_complaint AND deleted_at IS NULL FOR UPDATE;
  IF c.id IS NULL OR NOT dv_is_manager(c.organization_id) THEN RAISE EXCEPTION 'managers only' USING ERRCODE = '42501'; END IF;
  IF c.outcome IS NULL OR c.outcome = 'not_upheld' THEN RAISE EXCEPTION 'redress can only follow an upheld or partly upheld outcome' USING ERRCODE = '22023'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'enter an amount above zero' USING ERRCODE = '22023'; END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 5 THEN RAISE EXCEPTION 'give a reason for the redress' USING ERRCODE = '22023'; END IF;
  INSERT INTO complaint_redress (organization_id, complaint_id, case_id, amount, reason, requested_by) VALUES (c.organization_id, c.id, c.case_id, round(p_amount, 2), btrim(p_reason), auth.uid()) RETURNING id INTO rid;
  INSERT INTO complaint_events (complaint_id, organization_id, action, note, by_user) VALUES (c.id, c.organization_id, 'redress_requested', 'Redress requested', auth.uid());
  RETURN rid;
END $$;

CREATE OR REPLACE FUNCTION public.dv_decide_redress(p_id uuid, p_approve boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r complaint_redress;
BEGIN
  SELECT * INTO r FROM complaint_redress WHERE id = p_id FOR UPDATE;
  IF r.id IS NULL OR NOT dv_is_manager(r.organization_id) THEN RAISE EXCEPTION 'managers only' USING ERRCODE = '42501'; END IF;
  IF r.status <> 'requested' THEN RAISE EXCEPTION 'this redress has already been decided' USING ERRCODE = '22023'; END IF;
  IF r.requested_by = auth.uid() THEN RAISE EXCEPTION 'a different manager must approve this redress' USING ERRCODE = '42501'; END IF;
  UPDATE complaint_redress SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END, decided_by = auth.uid(), decided_at = now() WHERE id = p_id;
  UPDATE complaints SET redress_amount = (SELECT sum(amount) FROM complaint_redress WHERE complaint_id = r.complaint_id AND status IN ('approved','paid')) WHERE id = r.complaint_id;
  INSERT INTO complaint_events (complaint_id, organization_id, action, note, by_user) VALUES (r.complaint_id, r.organization_id, CASE WHEN p_approve THEN 'redress_approved' ELSE 'redress_rejected' END, NULL, auth.uid());
END $$;

CREATE OR REPLACE FUNCTION public.dv_mark_redress_paid(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r complaint_redress;
BEGIN
  SELECT * INTO r FROM complaint_redress WHERE id = p_id FOR UPDATE;
  IF r.id IS NULL OR NOT dv_is_manager(r.organization_id) THEN RAISE EXCEPTION 'managers only' USING ERRCODE = '42501'; END IF;
  IF r.status <> 'approved' THEN RAISE EXCEPTION 'only approved redress can be marked as paid' USING ERRCODE = '22023'; END IF;
  UPDATE complaint_redress SET status = 'paid', paid_by = auth.uid(), paid_at = now() WHERE id = p_id;
  INSERT INTO complaint_events (complaint_id, organization_id, action, note, by_user) VALUES (r.complaint_id, r.organization_id, 'redress_paid', NULL, auth.uid());
END $$;

-- One timeline: events, messages on the case since the complaint arrived, linked notes, and redress
CREATE OR REPLACE FUNCTION public.dv_complaint_detail(p_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c complaints;
BEGIN
  SELECT * INTO c FROM complaints WHERE id = p_id AND deleted_at IS NULL;
  IF c.id IS NULL OR NOT (dv_is_manager(c.organization_id) OR (c.case_id IS NOT NULL AND dv_can_read_case(c.case_id))) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'timeline', coalesce((SELECT jsonb_agg(s.x ORDER BY s.at) FROM (
        SELECT e.created_at AS at, jsonb_build_object('kind','event','at',e.created_at,'action',e.action,'note',e.note,'by',coalesce(p.full_name,p.email)) AS x
          FROM complaint_events e LEFT JOIN profiles p ON p.id = e.by_user WHERE e.complaint_id = p_id
        UNION ALL
        SELECT m.created_at, jsonb_build_object('kind','message','at',m.created_at,'channel',m.channel,'direction',m.direction,'body',left(m.body,600),'who',m.sender_name,'status',m.status)
          FROM debtverge_communications m WHERE c.case_id IS NOT NULL AND m.case_id = c.case_id AND m.deleted_at IS NULL AND m.created_at::date >= c.received_on AND m.channel <> 'internal_note'
        UNION ALL
        SELECT n.created_at, jsonb_build_object('kind','note','at',n.created_at,'note_kind',n.kind,'body',n.body,'by',coalesce(p2.full_name,p2.email),'withdrawn',n.withdrawn_at IS NOT NULL)
          FROM case_notes n LEFT JOIN profiles p2 ON p2.id = n.created_by WHERE n.linked_type = 'complaint' AND n.linked_id = p_id
      ) s), '[]'::jsonb),
    'redress', coalesce((SELECT jsonb_agg(jsonb_build_object('id',r.id,'amount',r.amount,'reason',r.reason,'status',r.status,'requested_by',r.requested_by,'requested_at',r.requested_at) ORDER BY r.requested_at)
                           FROM complaint_redress r WHERE r.complaint_id = p_id AND dv_is_manager(c.organization_id)), '[]'::jsonb),
    'handler_name', (SELECT coalesce(p3.full_name, p3.email) FROM profiles p3 WHERE p3.id = c.assigned_to)
  );
END $$;

-- Complaints MI for managers
CREATE OR REPLACE FUNCTION public.dv_complaints_mi(p_from date, p_to date) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE o uuid := dv_my_org(); res jsonb;
BEGIN
  IF o IS NULL OR NOT dv_is_manager(o) THEN RAISE EXCEPTION 'managers only' USING ERRCODE = '42501'; END IF;
  WITH c AS (SELECT * FROM complaints WHERE organization_id = o AND deleted_at IS NULL AND received_on BETWEEN coalesce(p_from, date '2000-01-01') AND coalesce(p_to, current_date))
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM c), 'open', (SELECT count(*) FROM c WHERE status <> 'closed'),
    'upheld', (SELECT count(*) FROM c WHERE outcome = 'upheld'), 'partially_upheld', (SELECT count(*) FROM c WHERE outcome = 'partially_upheld'), 'not_upheld', (SELECT count(*) FROM c WHERE outcome = 'not_upheld'),
    'fos', (SELECT count(*) FROM c WHERE referred_to_fos), 'vulnerable', (SELECT count(*) FROM c WHERE vulnerable),
    'redress_total', coalesce((SELECT sum(redress_amount) FROM c), 0),
    'ack_in_time', (SELECT count(*) FROM c WHERE acknowledged_on IS NOT NULL AND dv_business_days(received_on, acknowledged_on) <= 5),
    'ack_total', (SELECT count(*) FROM c WHERE acknowledged_on IS NOT NULL),
    'final_in_time', (SELECT count(*) FROM c WHERE final_response_on IS NOT NULL AND final_response_on - received_on <= 56),
    'final_total', (SELECT count(*) FROM c WHERE final_response_on IS NOT NULL),
    'avg_days_to_final', (SELECT round(avg(final_response_on - received_on)::numeric, 1) FROM c WHERE final_response_on IS NOT NULL),
    'by_category', coalesce((SELECT jsonb_agg(jsonb_build_object('key', k, 'count', n) ORDER BY n DESC) FROM (SELECT category k, count(*) n FROM c GROUP BY 1) q), '[]'::jsonb),
    'by_root_cause', coalesce((SELECT jsonb_agg(jsonb_build_object('key', k, 'count', n) ORDER BY n DESC) FROM (SELECT root_cause k, count(*) n FROM c WHERE root_cause IS NOT NULL GROUP BY 1) q), '[]'::jsonb),
    'by_fault', coalesce((SELECT jsonb_agg(jsonb_build_object('key', k, 'count', n) ORDER BY n DESC) FROM (SELECT fault k, count(*) n FROM c WHERE fault IS NOT NULL GROUP BY 1) q), '[]'::jsonb),
    'by_handler', coalesce((SELECT jsonb_agg(jsonb_build_object('key', coalesce(p.full_name, p.email, 'Unassigned'), 'count', q.n, 'open', q.o) ORDER BY q.n DESC)
                  FROM (SELECT assigned_to a, count(*) n, count(*) FILTER (WHERE status <> 'closed') o FROM c GROUP BY 1) q LEFT JOIN profiles p ON p.id = q.a), '[]'::jsonb)
  ) INTO res;
  RETURN res;
END $$;

DO $$ DECLARE f text; BEGIN
  FOREACH f IN ARRAY ARRAY['dv_dismiss_complaint_flag(uuid)','dv_request_redress(uuid,numeric,text)','dv_decide_redress(uuid,boolean)','dv_mark_redress_paid(uuid)','dv_complaint_detail(uuid)','dv_complaints_mi(date,date)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
  REVOKE ALL ON FUNCTION public.dv_add_business_days(date,int) FROM PUBLIC, anon;
  GRANT EXECUTE ON FUNCTION public.dv_add_business_days(date,int) TO authenticated;
  REVOKE ALL ON FUNCTION public.dv_flag_possible_complaint() FROM PUBLIC, anon, authenticated;
END $$;

-- Erasure: new complaint text, redress reasons and the event notes are personal data too
DO $$ DECLARE d text; d0 text;
BEGIN
  d0 := pg_get_functiondef('public.dv_erase_case(uuid,text)'::regprocedure);
  d := replace(d0, '"complaints":["complainant","summary"],', '"complaints":["complainant","summary","outcome_reasoning","final_response_ref"], "complaint_redress":["reason"],');
  IF d = d0 THEN RAISE EXCEPTION 'erase patch 1 did not apply'; END IF;
  d0 := d;
  d := replace(d0, '  UPDATE debt_cases SET debtor_name = ''[erased]'',', '  UPDATE complaint_events SET note = NULL WHERE note IS NOT NULL AND complaint_id IN (SELECT id FROM complaints WHERE case_id = p_case);' || chr(10) || '  UPDATE debt_cases SET debtor_name = ''[erased]'',');
  IF d = d0 THEN RAISE EXCEPTION 'erase patch 2 did not apply'; END IF;
  EXECUTE d;
END $$;

-- Letter templates for the complaint process (merge fields as in the other templates)
INSERT INTO public.document_templates (organization_id, name, category, audience, subject, body)
SELECT NULL, v.name, 'complaints', 'customer', v.subject, v.body FROM (VALUES
 ('Complaint: holding letter', 'Your complaint, ref {{case_number}}',
  E'Dear {{client_name}},\n\nThank you for your complaint. We are still looking into it and need a little longer than we expected. We will write to you with our final response as soon as we can, and no later than the end of the eight weeks from when you first contacted us.\n\nIf you have anything else to add, please reply to this letter.\n\nYours sincerely,\n{{adviser_name}}\n{{firm_name}}'),
 ('Complaint: 8-week letter', 'Your complaint, ref {{case_number}}: update',
  E'Dear {{client_name}},\n\nWe are writing because it has been eight weeks since you made your complaint and we are not yet able to give you our final response. We are sorry for the delay. We will write again by [date] with our response and an explanation of why it has taken longer.\n\nYou are entitled to refer your complaint to the Financial Ombudsman Service now if you wish. They are free and independent: www.financial-ombudsman.org.uk, 0800 023 4567. You have six months from the date of our final response to do so.\n\nYours sincerely,\n{{adviser_name}}\n{{firm_name}}'),
 ('Complaint: final response (upheld)', 'Our final response to your complaint, ref {{case_number}}',
  E'Dear {{client_name}},\n\nThank you for your complaint of [date]. We have looked into it carefully and we agree that we got this wrong.\n\nWhat we found: [findings]\n\nWhat we will do: [remedy, including any payment and when it will be made]\n\nWe are sorry for what happened and for the trouble it has caused you.\n\nIf you are not happy with this response you can refer your complaint to the Financial Ombudsman Service within six months of the date of this letter. They are free and independent: www.financial-ombudsman.org.uk, 0800 023 4567.\n\nYours sincerely,\n{{adviser_name}}\n{{firm_name}}'),
 ('Complaint: final response (not upheld)', 'Our final response to your complaint, ref {{case_number}}',
  E'Dear {{client_name}},\n\nThank you for your complaint of [date]. We have looked into it carefully.\n\nWhat we looked at: [evidence reviewed]\n\nOur decision: we have not upheld your complaint because [reasons].\n\nWe understand this may not be the answer you hoped for. If you are not happy with this response you can refer your complaint to the Financial Ombudsman Service within six months of the date of this letter. They are free and independent: www.financial-ombudsman.org.uk, 0800 023 4567.\n\nYours sincerely,\n{{adviser_name}}\n{{firm_name}}')
) AS v(name, subject, body)
WHERE NOT EXISTS (SELECT 1 FROM public.document_templates t WHERE t.organization_id IS NULL AND t.name = v.name);
