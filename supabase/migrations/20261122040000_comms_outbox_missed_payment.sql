-- Outbound email/SMS queue + missed-payment chaser. Sending is done by the send-comms edge function (provider secrets).
CREATE TABLE IF NOT EXISTS comms_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES debt_cases(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('email','sms')),
  to_address text NOT NULL,
  subject text,
  body text NOT NULL,
  trigger text NOT NULL DEFAULT 'manual' CHECK (trigger IN ('manual','missed_payment','reminder')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed','cancelled')),
  attempts int NOT NULL DEFAULT 0,
  error text,
  provider_id text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX IF NOT EXISTS comms_outbox_queue_idx ON comms_outbox (status, created_at) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS comms_outbox_case_idx ON comms_outbox (case_id, created_at DESC);
ALTER TABLE comms_outbox ENABLE ROW LEVEL SECURITY;

CREATE POLICY comms_outbox_read ON comms_outbox FOR SELECT TO authenticated USING (dv_can_read_case(case_id));
-- No direct insert/update/delete from clients: all writes go through the functions below or the service role.

CREATE OR REPLACE FUNCTION dv_queue_message(p_case uuid, p_channel text, p_subject text, p_body text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c debt_cases; addr text; oid uuid;
BEGIN
  SELECT * INTO c FROM debt_cases WHERE id = p_case;
  IF c.id IS NULL OR NOT dv_can_edit_case(p_case) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF p_channel = 'sms' THEN SELECT mobile_phone INTO addr FROM debt_customer_profiles WHERE case_id = p_case;
  ELSE SELECT primary_email INTO addr FROM debt_customer_profiles WHERE case_id = p_case; END IF;
  IF addr IS NULL OR btrim(addr) = '' THEN RAISE EXCEPTION 'no % contact on this case', p_channel; END IF;
  INSERT INTO comms_outbox (organization_id, case_id, channel, to_address, subject, body, trigger)
  VALUES (c.organization_id, p_case, p_channel, addr, p_subject, p_body, 'manual') RETURNING id INTO oid;
  RETURN oid;
END $$;

CREATE OR REPLACE FUNCTION dv_cancel_message(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE comms_outbox SET status = 'cancelled'
  WHERE id = p_id AND status = 'queued' AND dv_can_edit_case(case_id);
END $$;

-- Daily chaser: active plans overdue by 1+ days get a fresh no-login pay link and a message (SMS if mobile, else email).
-- No contact details -> a diary task for the adviser instead. At most one chaser per case every 3 days.
CREATE OR REPLACE FUNCTION dv_queue_missed_payment_chasers(p_base_url text DEFAULT 'https://sparkthunderprojects-1dvy.bolt.host')
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; tok text; n int := 0; ch text; addr text; firm text; first_name text; amt numeric; msg text;
BEGIN
  FOR r IN
    SELECT c.*, p.mobile_phone, p.primary_email FROM debt_cases c
    LEFT JOIN debt_customer_profiles p ON p.case_id = c.id
    WHERE c.status = 'payment_schedule_active' AND c.next_due_date < current_date AND COALESCE(c.installment_amount,0) > 0
      AND NOT EXISTS (SELECT 1 FROM comms_outbox o WHERE o.case_id = c.id AND o.trigger = 'missed_payment' AND o.created_at > now() - interval '3 days')
  LOOP
    IF COALESCE(btrim(r.mobile_phone),'') <> '' THEN ch := 'sms'; addr := r.mobile_phone;
    ELSIF COALESCE(btrim(r.primary_email),'') <> '' THEN ch := 'email'; addr := r.primary_email;
    ELSE
      INSERT INTO case_tasks (case_id, organization_id, title, kind, due_date, assigned_to, source, auto_key)
      SELECT r.id, r.organization_id, 'Payment missed and no contact details held: call client', 'call', current_date, r.assigned_to, 'auto', 'missed-nocontact-'||current_date
      WHERE NOT EXISTS (SELECT 1 FROM case_tasks WHERE case_id = r.id AND auto_key = 'missed-nocontact-'||current_date);
      CONTINUE;
    END IF;
    amt := r.installment_amount;
    tok := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
    INSERT INTO payment_links (case_id, organization_id, token, amount, reason, expires_at, channel)
    VALUES (r.id, r.organization_id, tok, amt, 'Missed payment', now() + interval '14 days', ch);
    SELECT name INTO firm FROM organizations WHERE id = r.organization_id;
    first_name := split_part(COALESCE(r.debtor_name,''), ' ', 1);
    msg := format('Hello %s, we have not received your payment of £%s that was due on %s. If you are struggling, please get in touch and we will help. You can pay securely here: %s/pay/%s - %s',
                  first_name, to_char(amt,'FM999990.00'), to_char(r.next_due_date,'DD Mon'), p_base_url, tok, COALESCE(firm,'Your debt adviser'));
    INSERT INTO comms_outbox (organization_id, case_id, channel, to_address, subject, body, trigger, created_by)
    VALUES (r.organization_id, r.id, ch, addr, CASE WHEN ch='email' THEN 'We have not received your payment' END, msg, 'missed_payment', NULL);
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;

REVOKE EXECUTE ON FUNCTION dv_queue_message(uuid,text,text,text), dv_cancel_message(uuid), dv_queue_missed_payment_chasers(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION dv_queue_message(uuid,text,text,text), dv_cancel_message(uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION dv_queue_missed_payment_chasers(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION dv_queue_missed_payment_chasers(text) TO service_role;
