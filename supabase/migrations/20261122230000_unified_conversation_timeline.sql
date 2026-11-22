-- One conversation per case: every email / SMS / WhatsApp the system sends is mirrored into debtverge_communications,
-- and its status follows the outbox (queued -> delivered / failed; cancelled hides it).
ALTER TABLE public.comms_outbox ADD COLUMN IF NOT EXISTS thread_id uuid, ADD COLUMN IF NOT EXISTS agent_name text;
ALTER TABLE public.debtverge_communications ADD COLUMN IF NOT EXISTS outbox_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS debtverge_comms_outbox_id_uq ON public.debtverge_communications (outbox_id) WHERE outbox_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.dv_mirror_outbox() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE v_thread uuid; v_name text; v_status text;
BEGIN
  v_status := CASE NEW.status WHEN 'sent' THEN 'delivered' WHEN 'failed' THEN 'failed' ELSE 'queued' END;
  IF TG_OP = 'INSERT' THEN
    v_thread := coalesce(NEW.thread_id,
      (SELECT thread_id FROM debtverge_communications WHERE case_id = NEW.case_id AND deleted_at IS NULL AND thread_id IS NOT NULL ORDER BY created_at DESC LIMIT 1),
      md5(NEW.case_id::text)::uuid);
    SELECT debtor_name INTO v_name FROM debt_cases WHERE id = NEW.case_id;
    INSERT INTO debtverge_communications (case_id, thread_id, channel, direction, sender_name, sender_type, recipient_name, recipient_email_or_phone,
        agent_name, subject, body, status, matched_automatically, outbox_id, created_at)
    VALUES (NEW.case_id, v_thread, NEW.channel, 'outbound',
        CASE WHEN NEW.trigger = 'manual' THEN coalesce(NEW.agent_name, 'Adviser') ELSE 'DebtVerge (automatic)' END,
        CASE WHEN NEW.trigger = 'manual' THEN 'agent' ELSE 'system' END,
        coalesce(v_name, ''), NEW.to_address, NEW.agent_name, NEW.subject, NEW.body, v_status, false, NEW.id, NEW.created_at)
    ON CONFLICT (outbox_id) WHERE outbox_id IS NOT NULL DO NOTHING;
  ELSE
    IF NEW.status = 'cancelled' OR NEW.deleted_at IS NOT NULL THEN
      UPDATE debtverge_communications SET deleted_at = now() WHERE outbox_id = NEW.id AND deleted_at IS NULL;
    ELSE
      UPDATE debtverge_communications SET status = v_status, updated_at = now() WHERE outbox_id = NEW.id AND status <> v_status;
    END IF;
  END IF;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.dv_mirror_outbox() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_mirror_outbox ON public.comms_outbox;
CREATE TRIGGER trg_mirror_outbox AFTER INSERT OR UPDATE OF status, deleted_at ON public.comms_outbox FOR EACH ROW EXECUTE FUNCTION public.dv_mirror_outbox();
