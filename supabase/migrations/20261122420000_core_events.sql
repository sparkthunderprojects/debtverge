/*
  A5: events between apps (an outbox).

  An app announces that something happened ("qualification decided", "call completed"); the apps that care
  pick it up later. Apps never call each other and never read each other's tables.

  - core_event_types        the events that exist, which app may raise them, and which apps receive them.
  - core_events             append-only log of every event raised (who, firm, client, a small payload).
  - core_event_deliveries   one row per receiving app per event. Status: pending -> claimed -> delivered
                            (or dead after 5 failed attempts). A claim is a lease; if the receiver never
                            confirms, the lease expires and the delivery is offered again.
  - client.stage_changed    raised by the database itself whenever a client's stage history gets a new row.
  - functions               core_event_raise, core_event_claim, core_event_ack, core_event_fail, core_event_log.

  Rules: deliveries go only to apps the firm is licensed for; a receiver sees only events for clients its user
  may read; the same dedupe key never raises an event twice; the log can never be changed or deleted.
*/

-- ---------- tables ----------
CREATE TABLE IF NOT EXISTS public.core_event_types (
  event_type text PRIMARY KEY CHECK (event_type ~ '^[a-z_]+(\.[a-z_]+)+$'),
  source_app text REFERENCES public.core_apps(app_id),
  core_only boolean NOT NULL DEFAULT false,
  consumer_apps text[] NOT NULL DEFAULT '{}',
  description text NOT NULL,
  CHECK (core_only OR source_app IS NOT NULL)
);
INSERT INTO public.core_event_types (event_type, source_app, core_only, consumer_apps, description) VALUES
  ('client.stage_changed', NULL, true, '{}', 'A client moved stage. Raised by the system; goes to the app being left and the app being entered.'),
  ('qualification.decided', 'qualifyverge', false, '{debtverge,draftverge}', 'Qualify recorded its decision (DMP, IVA or other) with reasons.'),
  ('call.completed', 'stormcall', false, '{compliance}', 'A call ended and its record is ready for review.')
ON CONFLICT (event_type) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.core_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  event_type text NOT NULL REFERENCES public.core_event_types(event_type),
  client_id uuid REFERENCES public.core_clients(id),
  source_app text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(payload) = 'object' AND length(payload::text) <= 8000),
  dedupe_key text CHECK (dedupe_key IS NULL OR length(dedupe_key) <= 200),
  raised_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS core_events_dedupe_idx ON public.core_events (organization_id, event_type, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS core_events_client_idx ON public.core_events (client_id, created_at);

CREATE TABLE IF NOT EXISTS public.core_event_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.core_events(id),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  app_id text NOT NULL REFERENCES public.core_apps(app_id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','claimed','delivered','dead')),
  attempts int NOT NULL DEFAULT 0,
  claimed_by uuid REFERENCES auth.users(id),
  claimed_until timestamptz,
  delivered_at timestamptz,
  last_error text CHECK (last_error IS NULL OR length(last_error) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, app_id)
);
CREATE INDEX IF NOT EXISTS core_event_deliveries_queue_idx ON public.core_event_deliveries (organization_id, app_id, status, created_at);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['core_event_types','core_events','core_event_deliveries'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS deny_all_clients ON public.%I', t);
    EXECUTE format('CREATE POLICY deny_all_clients ON public.%I AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO service_role', t);
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS trg_immutable ON public.core_events;
CREATE TRIGGER trg_immutable BEFORE UPDATE OR DELETE ON public.core_events FOR EACH ROW EXECUTE FUNCTION public.dv_audit_immutable();
DROP TRIGGER IF EXISTS trg_no_delete ON public.core_event_deliveries;
CREATE TRIGGER trg_no_delete BEFORE DELETE ON public.core_event_deliveries FOR EACH ROW EXECUTE FUNCTION public.dv_no_delete();

-- ---------- internal: write an event and its deliveries (not callable by clients) ----------
CREATE OR REPLACE FUNCTION public.core_event_emit(p_org uuid, p_type text, p_client uuid, p_payload jsonb, p_dedupe text, p_source text, p_targets text[], p_by uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE eid uuid; n int := 0;
BEGIN
  INSERT INTO core_events (organization_id, event_type, client_id, source_app, payload, dedupe_key, raised_by)
  VALUES (p_org, p_type, p_client, p_source, coalesce(p_payload, '{}'::jsonb), p_dedupe, p_by)
  ON CONFLICT (organization_id, event_type, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
  RETURNING id INTO eid;
  IF eid IS NULL THEN
    SELECT id INTO eid FROM core_events WHERE organization_id = p_org AND event_type = p_type AND dedupe_key = p_dedupe;
    RETURN jsonb_build_object('event_id', eid, 'duplicate', true, 'deliveries', 0);
  END IF;
  INSERT INTO core_event_deliveries (event_id, organization_id, app_id)
  SELECT eid, p_org, a.app_id FROM core_apps a
   WHERE a.app_id = ANY (coalesce(p_targets, '{}')) AND dv_org_has_product(p_org, a.product_key);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('event_id', eid, 'duplicate', false, 'deliveries', n);
END $$;

-- every stage change announces itself to the app being left and the app being entered
CREATE OR REPLACE FUNCTION public.core_stage_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE targets text[];
BEGIN
  SELECT coalesce(array_agg(app_id), '{}') INTO targets FROM core_apps WHERE stage IN (NEW.from_stage, NEW.to_stage);
  PERFORM core_event_emit(NEW.organization_id, 'client.stage_changed', NEW.client_id,
    jsonb_build_object('from_stage', NEW.from_stage, 'to_stage', NEW.to_stage, 'history_id', NEW.id, 'changed_by', NEW.changed_by),
    'stage:' || NEW.id, 'core', targets, NEW.changed_by);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_stage_event ON public.core_client_stages;
CREATE TRIGGER trg_stage_event AFTER INSERT ON public.core_client_stages FOR EACH ROW EXECUTE FUNCTION public.core_stage_event();

-- ---------- raise ----------
CREATE OR REPLACE FUNCTION public.core_event_raise(p_type text, p_client uuid DEFAULT NULL, p_payload jsonb DEFAULT '{}'::jsonb, p_dedupe text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE o uuid := dv_my_org(); t core_event_types; a core_apps; key text := nullif(btrim(coalesce(p_dedupe, '')), ''); corg uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'sign in required' USING ERRCODE = '28000'; END IF;
  IF o IS NULL OR NOT dv_mfa_ok(o) THEN RAISE EXCEPTION 'you cannot raise events' USING ERRCODE = '42501'; END IF;
  SELECT * INTO t FROM core_event_types WHERE event_type = p_type;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown event type' USING ERRCODE = '22023'; END IF;
  IF t.core_only THEN RAISE EXCEPTION 'this event is raised by the system only' USING ERRCODE = '42501'; END IF;
  SELECT * INTO a FROM core_apps WHERE app_id = t.source_app;
  IF NOT dv_org_has_product(o, a.product_key) THEN RAISE EXCEPTION 'your firm is not licensed for %', a.name USING ERRCODE = '42501'; END IF;
  IF NOT (dv_is_manager(o) OR core_has_perm(o, a.rbac_module, 'edit')) THEN
    RAISE EXCEPTION 'you do not have permission to raise this event' USING ERRCODE = '42501';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' OR length(p_payload::text) > 8000 THEN
    RAISE EXCEPTION 'the payload must be a small object' USING ERRCODE = '22023';
  END IF;
  IF key IS NOT NULL AND length(key) > 200 THEN RAISE EXCEPTION 'dedupe key is too long' USING ERRCODE = '22023'; END IF;
  IF p_client IS NOT NULL THEN
    SELECT organization_id INTO corg FROM core_clients WHERE id = p_client;
    IF corg IS DISTINCT FROM o OR NOT core_client_can_read(p_client) THEN RAISE EXCEPTION 'client not found' USING ERRCODE = '42501'; END IF;
  END IF;
  RETURN core_event_emit(o, p_type, p_client, p_payload, key, t.source_app, t.consumer_apps, auth.uid());
END $$;

-- ---------- receive ----------
-- Take up to p_limit waiting events for an app. Each is leased to the caller for p_lease_seconds; confirm with
-- core_event_ack, or give back with core_event_fail. An unconfirmed lease expires and the event is offered again.
CREATE OR REPLACE FUNCTION public.core_event_claim(p_app text, p_limit int DEFAULT 20, p_lease_seconds int DEFAULT 300) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE o uuid := dv_my_org(); a core_apps; lim int := least(greatest(coalesce(p_limit, 20), 1), 100);
        lease int := least(greatest(coalesce(p_lease_seconds, 300), 30), 3600); res jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'sign in required' USING ERRCODE = '28000'; END IF;
  SELECT * INTO a FROM core_apps WHERE app_id = p_app;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown app' USING ERRCODE = '22023'; END IF;
  IF o IS NULL OR NOT dv_mfa_ok(o) OR NOT dv_org_has_product(o, a.product_key) OR NOT core_has_perm(o, a.rbac_module, 'view') THEN
    RAISE EXCEPTION 'you cannot receive events for %', a.name USING ERRCODE = '42501';
  END IF;

  UPDATE core_event_deliveries SET status = 'dead', last_error = coalesce(last_error, 'lease expired too many times')
   WHERE organization_id = o AND app_id = p_app AND status = 'claimed' AND claimed_until < now() AND attempts >= 5;

  WITH picked AS (
    SELECT d.id FROM core_event_deliveries d JOIN core_events e ON e.id = d.event_id
     WHERE d.organization_id = o AND d.app_id = p_app
       AND (d.status = 'pending' OR (d.status = 'claimed' AND d.claimed_until < now()))
       AND (e.client_id IS NULL OR core_client_can_read(e.client_id))
     ORDER BY d.created_at, d.id
     LIMIT lim FOR UPDATE OF d SKIP LOCKED
  ), upd AS (
    UPDATE core_event_deliveries d
       SET status = 'claimed', attempts = d.attempts + 1, claimed_by = auth.uid(), claimed_until = now() + make_interval(secs => lease)
      FROM picked WHERE d.id = picked.id
    RETURNING d.*
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('delivery_id', u.id, 'event_id', e.id, 'event_type', e.event_type, 'client_id', e.client_id,
           'source_app', e.source_app, 'payload', e.payload, 'created_at', e.created_at, 'attempts', u.attempts) ORDER BY e.created_at, u.id), '[]'::jsonb)
    INTO res FROM upd u JOIN core_events e ON e.id = u.event_id;
  RETURN res;
END $$;

CREATE OR REPLACE FUNCTION public.core_event_ack(p_delivery uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE d core_event_deliveries;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'sign in required' USING ERRCODE = '28000'; END IF;
  SELECT * INTO d FROM core_event_deliveries WHERE id = p_delivery FOR UPDATE;
  IF NOT FOUND OR d.organization_id IS DISTINCT FROM dv_my_org() OR d.claimed_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'delivery not found' USING ERRCODE = '42501';
  END IF;
  IF d.status = 'delivered' THEN RETURN; END IF;
  IF d.status <> 'claimed' THEN RAISE EXCEPTION 'delivery is not claimed' USING ERRCODE = '42501'; END IF;
  UPDATE core_event_deliveries SET status = 'delivered', delivered_at = now(), claimed_until = NULL, last_error = NULL WHERE id = d.id;
END $$;

CREATE OR REPLACE FUNCTION public.core_event_fail(p_delivery uuid, p_error text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE d core_event_deliveries;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'sign in required' USING ERRCODE = '28000'; END IF;
  SELECT * INTO d FROM core_event_deliveries WHERE id = p_delivery FOR UPDATE;
  IF NOT FOUND OR d.organization_id IS DISTINCT FROM dv_my_org() OR d.claimed_by IS DISTINCT FROM auth.uid() OR d.status <> 'claimed' THEN
    RAISE EXCEPTION 'delivery not found' USING ERRCODE = '42501';
  END IF;
  UPDATE core_event_deliveries
     SET status = CASE WHEN d.attempts >= 5 THEN 'dead' ELSE 'pending' END,
         claimed_by = NULL, claimed_until = NULL, last_error = left(coalesce(nullif(btrim(p_error), ''), 'failed'), 500)
   WHERE id = d.id;
END $$;

-- ---------- the log (managers) ----------
CREATE OR REPLACE FUNCTION public.core_event_log(p_client uuid DEFAULT NULL, p_limit int DEFAULT 50) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE o uuid := dv_my_org(); lim int := least(greatest(coalesce(p_limit, 50), 1), 200); res jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'sign in required' USING ERRCODE = '28000'; END IF;
  IF o IS NULL OR NOT dv_mfa_ok(o) OR NOT dv_is_manager(o) THEN RAISE EXCEPTION 'managers only' USING ERRCODE = '42501'; END IF;
  SELECT coalesce(jsonb_agg(x ORDER BY x->>'created_at' DESC), '[]'::jsonb) INTO res FROM (
    SELECT jsonb_build_object('event_id', e.id, 'event_type', e.event_type, 'client_id', e.client_id, 'source_app', e.source_app,
             'payload', e.payload, 'created_at', e.created_at,
             'deliveries', coalesce((SELECT jsonb_agg(jsonb_build_object('app_id', d.app_id, 'status', d.status, 'attempts', d.attempts,
                                      'delivered_at', d.delivered_at, 'last_error', d.last_error) ORDER BY d.app_id)
                                       FROM core_event_deliveries d WHERE d.event_id = e.id), '[]'::jsonb)) x
      FROM core_events e
     WHERE e.organization_id = o AND (p_client IS NULL OR e.client_id = p_client)
     ORDER BY e.created_at DESC LIMIT lim
  ) s;
  RETURN res;
END $$;

-- ---------- who can call what ----------
DO $$ DECLARE f text; BEGIN
  FOREACH f IN ARRAY ARRAY['core_event_raise(text,uuid,jsonb,text)','core_event_claim(text,integer,integer)','core_event_ack(uuid)','core_event_fail(uuid,text)','core_event_log(uuid,integer)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
  -- internal only
  REVOKE ALL ON FUNCTION public.core_event_emit(uuid,text,uuid,jsonb,text,text,text[],uuid) FROM PUBLIC, anon, authenticated;
  REVOKE ALL ON FUNCTION public.core_stage_event() FROM PUBLIC, anon, authenticated;
END $$;
