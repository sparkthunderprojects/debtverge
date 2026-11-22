-- Customer notes: typed, pinnable, linked to a creditor/payment/complaint/document, searchable, with edit history and withdraw-with-reason (never deleted).
CREATE TABLE IF NOT EXISTS public.case_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES public.debt_cases(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'general' CHECK (kind IN ('general','call','meeting','creditor','vulnerability','agreement','complaint','internal')),
  body text NOT NULL CHECK (length(btrim(body)) > 0 AND length(body) <= 5000),
  pinned boolean NOT NULL DEFAULT false,
  direction text CHECK (direction IN ('inbound','outbound')),
  contact_name text CHECK (length(contact_name) <= 120),
  outcome text CHECK (length(outcome) <= 200),
  follow_up_on date,
  follow_up_task_id uuid,
  linked_type text CHECK (linked_type IN ('creditor','payment','complaint','document')),
  linked_id uuid,
  client_visible boolean NOT NULL DEFAULT false,
  version int NOT NULL DEFAULT 1,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_by uuid,
  edited_at timestamptz,
  withdrawn_at timestamptz,
  withdrawn_by uuid,
  withdraw_reason text,
  search tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce(body,'') || ' ' || coalesce(contact_name,'') || ' ' || coalesce(outcome,''))) STORED,
  CHECK ((linked_type IS NULL) = (linked_id IS NULL))
);
CREATE INDEX IF NOT EXISTS case_notes_case_idx ON public.case_notes (case_id, pinned DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS case_notes_org_idx ON public.case_notes (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS case_notes_search_idx ON public.case_notes USING gin (search);
CREATE INDEX IF NOT EXISTS case_notes_link_idx ON public.case_notes (linked_type, linked_id) WHERE linked_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.case_note_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id uuid NOT NULL REFERENCES public.case_notes(id) ON DELETE CASCADE,
  case_id uuid NOT NULL,
  version int NOT NULL,
  body text NOT NULL,
  edited_by uuid,
  edited_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS case_note_versions_note_idx ON public.case_note_versions (note_id, version);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['case_notes','case_note_versions'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO service_role', t);
    EXECUTE format('CREATE POLICY deny_all_clients ON public.%I AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)', t);
  END LOOP;
END $$;
CREATE TRIGGER trg_no_delete BEFORE DELETE ON public.case_notes FOR EACH ROW EXECUTE FUNCTION public.dv_no_delete();

CREATE OR REPLACE FUNCTION public.dv_add_note(p_case uuid, p_kind text, p_body text, p_pinned boolean DEFAULT false, p_direction text DEFAULT NULL,
  p_contact text DEFAULT NULL, p_outcome text DEFAULT NULL, p_follow_up date DEFAULT NULL, p_link_type text DEFAULT NULL, p_link_id uuid DEFAULT NULL,
  p_client_visible boolean DEFAULT false) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE c debt_cases; nid uuid; tid uuid; ok boolean := true;
BEGIN
  SELECT * INTO c FROM debt_cases WHERE id = p_case AND deleted_at IS NULL;
  IF c.id IS NULL OR NOT dv_can_edit_case(p_case) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF p_body IS NULL OR btrim(p_body) = '' THEN RAISE EXCEPTION 'write something in the note' USING ERRCODE = '22023'; END IF;
  IF (p_link_type IS NULL) <> (p_link_id IS NULL) THEN RAISE EXCEPTION 'choose what the note is linked to' USING ERRCODE = '22023'; END IF;
  IF p_link_type IS NOT NULL THEN
    ok := CASE p_link_type
      WHEN 'creditor'  THEN EXISTS (SELECT 1 FROM debt_creditors WHERE id = p_link_id AND case_id = p_case)
      WHEN 'payment'   THEN EXISTS (SELECT 1 FROM debt_payments WHERE id = p_link_id AND case_id = p_case)
      WHEN 'complaint' THEN EXISTS (SELECT 1 FROM complaints WHERE id = p_link_id AND case_id = p_case)
      WHEN 'document'  THEN EXISTS (SELECT 1 FROM case_documents WHERE id = p_link_id AND case_id = p_case)
      ELSE false END;
    IF NOT ok THEN RAISE EXCEPTION 'that item is not on this case' USING ERRCODE = '22023'; END IF;
  END IF;
  INSERT INTO case_notes (organization_id, case_id, kind, body, pinned, direction, contact_name, outcome, follow_up_on, linked_type, linked_id, client_visible, created_by)
  VALUES (c.organization_id, p_case, coalesce(nullif(p_kind,''),'general'), btrim(p_body), coalesce(p_pinned,false), nullif(p_direction,''), left(nullif(btrim(coalesce(p_contact,'')),''),120),
          left(nullif(btrim(coalesce(p_outcome,'')),''),200), p_follow_up, p_link_type, p_link_id, coalesce(p_client_visible,false), auth.uid())
  RETURNING id INTO nid;
  IF p_follow_up IS NOT NULL THEN
    INSERT INTO case_tasks (case_id, organization_id, title, kind, due_date, status, assigned_to, source, created_by)
    VALUES (p_case, c.organization_id, left('Follow up: ' || btrim(p_body), 100), 'call', p_follow_up, 'open', coalesce(c.assigned_to, auth.uid()), 'manual', auth.uid())
    RETURNING id INTO tid;
    UPDATE case_notes SET follow_up_task_id = tid WHERE id = nid;
  END IF;
  RETURN nid;
END $function$;

CREATE OR REPLACE FUNCTION public.dv_edit_note(p_id uuid, p_body text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE n case_notes;
BEGIN
  SELECT * INTO n FROM case_notes WHERE id = p_id FOR UPDATE;
  IF n.id IS NULL OR NOT dv_can_edit_case(n.case_id) OR NOT (n.created_by = auth.uid() OR dv_is_manager(n.organization_id)) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF n.withdrawn_at IS NOT NULL THEN RAISE EXCEPTION 'a withdrawn note cannot be edited' USING ERRCODE = '22023'; END IF;
  IF p_body IS NULL OR btrim(p_body) = '' OR length(p_body) > 5000 THEN RAISE EXCEPTION 'write something in the note (up to 5000 characters)' USING ERRCODE = '22023'; END IF;
  IF btrim(p_body) = n.body THEN RETURN; END IF;
  INSERT INTO case_note_versions (note_id, case_id, version, body, edited_by, edited_at) VALUES (n.id, n.case_id, n.version, n.body, coalesce(n.edited_by, n.created_by), coalesce(n.edited_at, n.created_at));
  UPDATE case_notes SET body = btrim(p_body), version = version + 1, edited_by = auth.uid(), edited_at = now() WHERE id = p_id;
END $function$;

CREATE OR REPLACE FUNCTION public.dv_withdraw_note(p_id uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE n case_notes;
BEGIN
  SELECT * INTO n FROM case_notes WHERE id = p_id FOR UPDATE;
  IF n.id IS NULL OR NOT dv_can_edit_case(n.case_id) OR NOT (n.created_by = auth.uid() OR dv_is_manager(n.organization_id)) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF n.withdrawn_at IS NOT NULL THEN RAISE EXCEPTION 'already withdrawn' USING ERRCODE = '22023'; END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 5 THEN RAISE EXCEPTION 'give a reason for withdrawing the note' USING ERRCODE = '22023'; END IF;
  UPDATE case_notes SET withdrawn_at = now(), withdrawn_by = auth.uid(), withdraw_reason = left(btrim(p_reason), 300), pinned = false WHERE id = p_id;
  IF n.follow_up_task_id IS NOT NULL THEN UPDATE case_tasks SET status = 'cancelled' WHERE id = n.follow_up_task_id AND status = 'open'; END IF;
END $function$;

CREATE OR REPLACE FUNCTION public.dv_pin_note(p_id uuid, p_pinned boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE n case_notes;
BEGIN
  SELECT * INTO n FROM case_notes WHERE id = p_id;
  IF n.id IS NULL OR NOT dv_can_edit_case(n.case_id) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF n.withdrawn_at IS NOT NULL THEN RAISE EXCEPTION 'a withdrawn note cannot be pinned' USING ERRCODE = '22023'; END IF;
  UPDATE case_notes SET pinned = coalesce(p_pinned, false) WHERE id = p_id;
END $function$;

CREATE OR REPLACE FUNCTION public.dv_list_notes(p_case uuid, p_kind text DEFAULT NULL, p_q text DEFAULT NULL)
RETURNS TABLE (id uuid, kind text, body text, pinned boolean, direction text, contact_name text, outcome text, follow_up_on date, follow_up_done boolean,
  linked_type text, linked_id uuid, client_visible boolean, version int, author_name text, created_at timestamptz, edited_at timestamptz, withdrawn_at timestamptz, withdraw_reason text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
BEGIN
  IF NOT dv_can_read_case(p_case) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
    SELECT n.id, n.kind, n.body, n.pinned, n.direction, n.contact_name, n.outcome, n.follow_up_on,
           (t.status IS NOT NULL AND t.status <> 'open'), n.linked_type, n.linked_id, n.client_visible, n.version,
           coalesce(p.full_name, p.email)::text, n.created_at, n.edited_at, n.withdrawn_at, n.withdraw_reason
      FROM case_notes n LEFT JOIN profiles p ON p.id = n.created_by LEFT JOIN case_tasks t ON t.id = n.follow_up_task_id
     WHERE n.case_id = p_case AND (p_kind IS NULL OR p_kind = '' OR n.kind = p_kind)
       AND (p_q IS NULL OR btrim(p_q) = '' OR n.search @@ websearch_to_tsquery('english', p_q) OR strpos(lower(n.body), lower(btrim(p_q))) > 0)
     ORDER BY (n.withdrawn_at IS NULL) DESC, n.pinned DESC, n.created_at DESC LIMIT 300;
END $function$;

CREATE OR REPLACE FUNCTION public.dv_search_notes(p_q text, p_kind text DEFAULT NULL)
RETURNS TABLE (id uuid, case_id uuid, case_number text, debtor_name text, kind text, body text, author_name text, created_at timestamptz, withdrawn_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE o uuid := dv_my_org();
BEGIN
  IF o IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF p_q IS NULL OR length(btrim(p_q)) < 2 THEN RAISE EXCEPTION 'type at least 2 characters to search' USING ERRCODE = '22023'; END IF;
  RETURN QUERY
    SELECT n.id, n.case_id, c.case_number::text, c.debtor_name::text, n.kind, n.body, coalesce(p.full_name, p.email)::text, n.created_at, n.withdrawn_at
      FROM case_notes n JOIN debt_cases c ON c.id = n.case_id AND c.deleted_at IS NULL LEFT JOIN profiles p ON p.id = n.created_by
     WHERE n.organization_id = o AND (p_kind IS NULL OR p_kind = '' OR n.kind = p_kind)
       AND (n.search @@ websearch_to_tsquery('english', p_q) OR strpos(lower(n.body), lower(btrim(p_q))) > 0)
       AND dv_can_read_case(n.case_id)
     ORDER BY n.created_at DESC LIMIT 100;
END $function$;

CREATE OR REPLACE FUNCTION public.dv_note_history(p_id uuid) RETURNS TABLE (version int, body text, edited_at timestamptz, edited_by_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE cid uuid;
BEGIN
  SELECT n.case_id INTO cid FROM case_notes n WHERE n.id = p_id;
  IF cid IS NULL OR NOT dv_can_read_case(cid) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  RETURN QUERY SELECT v.version, v.body, v.edited_at, coalesce(p.full_name, p.email)::text FROM case_note_versions v LEFT JOIN profiles p ON p.id = v.edited_by WHERE v.note_id = p_id ORDER BY v.version DESC;
END $function$;

DO $$ DECLARE f text; BEGIN
  FOREACH f IN ARRAY ARRAY['dv_add_note(uuid,text,text,boolean,text,text,text,date,text,uuid,boolean)','dv_edit_note(uuid,text)','dv_withdraw_note(uuid,text)','dv_pin_note(uuid,boolean)',
                           'dv_list_notes(uuid,text,text)','dv_search_notes(text,text)','dv_note_history(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;

-- Erasure: notes and their earlier versions are personal data too.
DO $$ DECLARE d text; d0 text;
BEGIN
  d0 := pg_get_functiondef('public.dv_erase_case(uuid,text)'::regprocedure);
  d := replace(d0, '"complaints":["complainant","summary"],', '"complaints":["complainant","summary"], "case_notes":["body","contact_name","outcome","withdraw_reason"], "case_note_versions":["body"],');
  IF d = d0 THEN RAISE EXCEPTION 'erase patch did not apply'; END IF;
  EXECUTE d;
END $$;
