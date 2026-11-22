-- E-signature: the adviser sends a document for signing; the client opens a private link (no login), reads it, types their name and signs.
-- The signed text is fingerprinted (SHA-256) so later changes can be detected. This is a simple electronic signature.
CREATE TABLE IF NOT EXISTS signing_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES debt_cases(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL,
  body_hash text NOT NULL,
  token text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','signed','cancelled')),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '14 days',
  signed_at timestamptz,
  signer_name text,
  signer_agent text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE signing_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY signing_requests_read ON signing_requests FOR SELECT TO authenticated USING (dv_can_read_case(case_id));
REVOKE INSERT, UPDATE, DELETE ON signing_requests FROM authenticated, anon;
REVOKE SELECT ON signing_requests FROM anon;

CREATE OR REPLACE FUNCTION dv_create_signing_request(p_case uuid, p_title text, p_body text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE c debt_cases; tok text;
BEGIN
  SELECT * INTO c FROM debt_cases WHERE id = p_case;
  IF c.id IS NULL OR NOT dv_can_edit_case(p_case) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF btrim(COALESCE(p_title,'')) = '' OR btrim(COALESCE(p_body,'')) = '' THEN RAISE EXCEPTION 'title and text are required'; END IF;
  tok := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  INSERT INTO signing_requests (organization_id, case_id, title, body, body_hash, token)
  VALUES (c.organization_id, p_case, p_title, p_body, encode(sha256(convert_to(p_body, 'UTF8')), 'hex'), tok);
  INSERT INTO debt_audit_log (case_id, milestone, description) VALUES (p_case, 'Sent for signature', p_title);
  RETURN tok;
END $$;

CREATE OR REPLACE FUNCTION dv_cancel_signing_request(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE signing_requests SET status = 'cancelled' WHERE id = p_id AND status = 'pending' AND dv_can_edit_case(case_id);
END $$;

-- Client side (no login): what the link shows
CREATE OR REPLACE FUNCTION dv_get_signing_request(p_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE s signing_requests; firm text; client text;
BEGIN
  SELECT * INTO s FROM signing_requests WHERE token = p_token;
  IF s.id IS NULL THEN RETURN jsonb_build_object('found', false); END IF;
  SELECT name INTO firm FROM organizations WHERE id = s.organization_id;
  SELECT debtor_name INTO client FROM debt_cases WHERE id = s.case_id;
  RETURN jsonb_build_object('found', true, 'title', s.title, 'body', s.body, 'firm', firm, 'client', client,
    'status', CASE WHEN s.status = 'pending' AND s.expires_at < now() THEN 'expired' ELSE s.status END,
    'signed_at', s.signed_at, 'signer_name', s.signer_name);
END $$;

CREATE OR REPLACE FUNCTION dv_sign_request(p_token text, p_name text, p_agent text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE s signing_requests; nm text := btrim(COALESCE(p_name,''));
BEGIN
  SELECT * INTO s FROM signing_requests WHERE token = p_token FOR UPDATE;
  IF s.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'This link is not valid.'); END IF;
  IF s.status = 'signed' THEN RETURN jsonb_build_object('ok', false, 'error', 'This document has already been signed.'); END IF;
  IF s.status <> 'pending' OR s.expires_at < now() THEN RETURN jsonb_build_object('ok', false, 'error', 'This request has expired. Please ask your adviser to send a new one.'); END IF;
  IF length(nm) < 3 THEN RETURN jsonb_build_object('ok', false, 'error', 'Please type your full name to sign.'); END IF;
  UPDATE signing_requests SET status = 'signed', signed_at = now(), signer_name = left(nm, 120), signer_agent = left(COALESCE(p_agent,''), 300) WHERE id = s.id;
  INSERT INTO case_documents (case_id, organization_id, name, category, body, mime_type)
  VALUES (s.case_id, s.organization_id, 'Signed: ' || s.title, 'signed',
          s.body || E'\n\n----------------------------------------\nElectronically signed by ' || left(nm,120) || E'\nDate and time: ' || to_char(now() AT TIME ZONE 'Europe/London','DD Mon YYYY HH24:MI') || E' (UK)\nDocument fingerprint (SHA-256): ' || s.body_hash,
          'text/plain');
  INSERT INTO debt_audit_log (case_id, milestone, description) VALUES (s.case_id, 'Document signed', s.title || ' signed by ' || left(nm,120));
  RETURN jsonb_build_object('ok', true);
END $$;

REVOKE EXECUTE ON FUNCTION dv_create_signing_request(uuid,text,text), dv_cancel_signing_request(uuid), dv_get_signing_request(text), dv_sign_request(text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION dv_create_signing_request(uuid,text,text), dv_cancel_signing_request(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION dv_get_signing_request(text), dv_sign_request(text,text,text) TO anon, authenticated, service_role;

INSERT INTO document_templates (organization_id, name, category, audience, subject, body)
SELECT NULL, 'Letter of Authority', 'authority', 'customer', 'Letter of Authority for {{firm_name}}',
'LETTER OF AUTHORITY

I, {{client_name}}, authorise {{firm_name}} to act on my behalf in dealing with my creditors about my debts.

This means {{firm_name}} may:
- contact my creditors and discuss my accounts, balances and any arrangements;
- ask creditors for information about my accounts, and ask them to freeze interest and charges while a plan is put in place;
- send my creditors a proposal to repay my debts, and receive their replies.

{{firm_name}} will not agree to anything on my behalf without telling me first. I can withdraw this authority at any time by telling {{firm_name}} in writing.

I understand that {{firm_name}} will keep my information secure and only use it to help me with my debts.

Case reference: {{case_number}}
Date: {{today}}'
WHERE NOT EXISTS (SELECT 1 FROM document_templates WHERE organization_id IS NULL AND name = 'Letter of Authority');
