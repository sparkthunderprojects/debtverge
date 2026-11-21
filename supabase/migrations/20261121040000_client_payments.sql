/*
  Client payments (GoCardless: pay by bank and Direct Debit).
  payment_attempts: one row per attempt to take money, created by the client-payment-session function.
  client_mandates: Direct Debit mandates set up by clients.
  Both are written only by edge functions (service role); staff can read them.
*/
CREATE TABLE IF NOT EXISTS payment_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES debt_cases(id) ON DELETE CASCADE,
  link_id uuid REFERENCES payment_links(id) ON DELETE SET NULL,
  provider text NOT NULL DEFAULT 'gocardless',
  kind text NOT NULL CHECK (kind IN ('bank_pay','direct_debit_setup','direct_debit_collection')),
  provider_ref text,
  provider_payment_id text,
  amount numeric(12,2),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','succeeded','failed','cancelled')),
  failure_reason text,
  recorded boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_attempts_ref ON payment_attempts (provider, provider_ref) WHERE provider_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payment_attempts_payment ON payment_attempts (provider_payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_case ON payment_attempts (case_id, created_at DESC);
ALTER TABLE payment_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "select_org_payment_attempts" ON payment_attempts FOR SELECT TO authenticated
  USING (dv_is_org_member(organization_id));

CREATE TABLE IF NOT EXISTS client_mandates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES debt_cases(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'gocardless',
  provider_mandate_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','failed','cancelled','expired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_mandate_id)
);
CREATE INDEX IF NOT EXISTS idx_client_mandates_case ON client_mandates (case_id, status);
ALTER TABLE client_mandates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "select_org_client_mandates" ON client_mandates FOR SELECT TO authenticated
  USING (dv_is_org_member(organization_id));

-- Public: whether this link's firm has online payments switched on is decided by the function; this reports a client's mandate state.
CREATE OR REPLACE FUNCTION get_link_payment_state(p_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l payment_links; m text; a text;
BEGIN
  SELECT * INTO l FROM payment_links WHERE token = p_token;
  IF NOT FOUND THEN RETURN jsonb_build_object('found', false); END IF;
  SELECT status INTO m FROM client_mandates WHERE case_id = l.case_id ORDER BY created_at DESC LIMIT 1;
  SELECT status INTO a FROM payment_attempts WHERE link_id = l.id ORDER BY created_at DESC LIMIT 1;
  RETURN jsonb_build_object('found', true, 'mandate', m, 'last_attempt', a);
END $$;
GRANT EXECUTE ON FUNCTION get_link_payment_state(text) TO anon, authenticated;
