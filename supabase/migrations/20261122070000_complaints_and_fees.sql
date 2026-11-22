-- Complaints register (FCA DISP: acknowledge within 5 business days, final response within 8 weeks) and fee engine.

CREATE TABLE IF NOT EXISTS complaints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id uuid REFERENCES debt_cases(id) ON DELETE SET NULL,
  reference text NOT NULL,
  complainant text NOT NULL,
  received_on date NOT NULL DEFAULT current_date,
  channel text NOT NULL DEFAULT 'other' CHECK (channel IN ('phone','email','letter','portal','other')),
  category text NOT NULL DEFAULT 'other' CHECK (category IN ('service','fees','payments','creditor_handling','data','conduct','other')),
  summary text NOT NULL,
  vulnerable boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','investigating','final_response','closed')),
  acknowledged_on date,
  final_response_on date,
  outcome text CHECK (outcome IN ('upheld','partially_upheld','not_upheld')),
  redress_amount numeric(12,2),
  referred_to_fos boolean NOT NULL DEFAULT false,
  assigned_to uuid,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, reference)
);
CREATE TABLE IF NOT EXISTS complaint_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id uuid NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  action text NOT NULL,
  note text,
  by_user uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE complaints ENABLE ROW LEVEL SECURITY;
ALTER TABLE complaint_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY complaints_read ON complaints FOR SELECT TO authenticated USING (
  dv_is_manager(organization_id) OR created_by = auth.uid() OR (case_id IS NOT NULL AND dv_can_read_case(case_id)));
CREATE POLICY complaint_events_read ON complaint_events FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM complaints c WHERE c.id = complaint_id));
REVOKE INSERT, UPDATE, DELETE ON complaints, complaint_events FROM authenticated, anon;

CREATE OR REPLACE FUNCTION dv_log_complaint(p_case uuid, p_complainant text, p_summary text, p_category text, p_channel text, p_received date, p_vulnerable boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE org uuid; cid uuid; ref text; n int;
BEGIN
  IF p_case IS NOT NULL THEN
    SELECT organization_id INTO org FROM debt_cases WHERE id = p_case;
    IF org IS NULL OR NOT dv_can_read_case(p_case) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  ELSE
    org := dv_my_org();
    IF org IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  END IF;
  IF btrim(COALESCE(p_summary,'')) = '' OR btrim(COALESCE(p_complainant,'')) = '' THEN RAISE EXCEPTION 'complainant and summary are required'; END IF;
  SELECT count(*) + 1 INTO n FROM complaints WHERE organization_id = org AND extract(year FROM received_on) = extract(year FROM COALESCE(p_received, current_date));
  ref := 'C-' || extract(year FROM COALESCE(p_received, current_date))::int || '-' || lpad(n::text, 4, '0');
  INSERT INTO complaints (organization_id, case_id, reference, complainant, received_on, channel, category, summary, vulnerable)
  VALUES (org, p_case, ref, p_complainant, COALESCE(p_received, current_date), COALESCE(p_channel,'other'), COALESCE(p_category,'other'), p_summary, COALESCE(p_vulnerable,false))
  RETURNING id INTO cid;
  INSERT INTO complaint_events (complaint_id, organization_id, action, note) VALUES (cid, org, 'logged', p_summary);
  IF p_case IS NOT NULL THEN
    INSERT INTO debt_audit_log (case_id, milestone, description) VALUES (p_case, 'Complaint logged', 'Complaint ' || ref || ' logged');
  END IF;
  RETURN cid;
END $$;

-- Managers move a complaint along; each step is recorded in the event trail.
CREATE OR REPLACE FUNCTION dv_complaint_update(p_id uuid, p_status text, p_outcome text DEFAULT NULL, p_redress numeric DEFAULT NULL, p_note text DEFAULT NULL, p_fos boolean DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c complaints;
BEGIN
  SELECT * INTO c FROM complaints WHERE id = p_id;
  IF c.id IS NULL OR NOT dv_is_manager(c.organization_id) THEN RAISE EXCEPTION 'managers only' USING ERRCODE = '42501'; END IF;
  IF p_status NOT IN ('open','acknowledged','investigating','final_response','closed') THEN RAISE EXCEPTION 'unknown status'; END IF;
  IF p_status IN ('final_response','closed') AND COALESCE(p_outcome, c.outcome) IS NULL THEN RAISE EXCEPTION 'record the outcome before the final response'; END IF;
  UPDATE complaints SET status = p_status,
    acknowledged_on = CASE WHEN p_status = 'acknowledged' AND acknowledged_on IS NULL THEN current_date ELSE acknowledged_on END,
    final_response_on = CASE WHEN p_status = 'final_response' AND final_response_on IS NULL THEN current_date ELSE final_response_on END,
    outcome = COALESCE(p_outcome, outcome), redress_amount = COALESCE(p_redress, redress_amount), referred_to_fos = COALESCE(p_fos, referred_to_fos)
  WHERE id = p_id;
  INSERT INTO complaint_events (complaint_id, organization_id, action, note) VALUES (p_id, c.organization_id, p_status, p_note);
END $$;

-- ---------------- fee engine ----------------
CREATE TABLE IF NOT EXISTS fee_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('percent_of_receipt','fixed_monthly')),
  percent numeric(5,2) CHECK (percent IS NULL OR (percent >= 0 AND percent <= 100)),
  monthly_amount numeric(10,2) CHECK (monthly_amount IS NULL OR monthly_amount >= 0),
  max_per_month numeric(10,2) CHECK (max_per_month IS NULL OR max_per_month >= 0),
  active boolean NOT NULL DEFAULT true,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'percent_of_receipt' AND percent IS NOT NULL) OR (kind = 'fixed_monthly' AND monthly_amount IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS fee_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES debt_cases(id) ON DELETE CASCADE,
  rule_id uuid NOT NULL REFERENCES fee_rules(id),
  charge_key text NOT NULL,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'due' CHECK (status IN ('due','taken','waived')),
  charged_on date NOT NULL DEFAULT current_date,
  decided_by uuid,
  decided_at timestamptz,
  UNIQUE (case_id, rule_id, charge_key)
);
ALTER TABLE fee_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE fee_charges ENABLE ROW LEVEL SECURITY;
CREATE POLICY fee_rules_read ON fee_rules FOR SELECT TO authenticated USING (organization_id = dv_my_org());
CREATE POLICY fee_charges_read ON fee_charges FOR SELECT TO authenticated USING (dv_can_read_case(case_id));
REVOKE INSERT, UPDATE, DELETE ON fee_rules, fee_charges FROM authenticated, anon;

CREATE OR REPLACE FUNCTION dv_save_fee_rule(p_id uuid, p_name text, p_kind text, p_percent numeric, p_monthly numeric, p_max numeric, p_active boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE org uuid := dv_my_org(); rid uuid;
BEGIN
  IF org IS NULL OR NOT dv_is_manager(org) THEN RAISE EXCEPTION 'managers only' USING ERRCODE = '42501'; END IF;
  IF p_id IS NULL THEN
    INSERT INTO fee_rules (organization_id, name, kind, percent, monthly_amount, max_per_month, active) VALUES (org, p_name, p_kind, p_percent, p_monthly, p_max, COALESCE(p_active,true)) RETURNING id INTO rid;
  ELSE
    UPDATE fee_rules SET name = p_name, kind = p_kind, percent = p_percent, monthly_amount = p_monthly, max_per_month = p_max, active = COALESCE(p_active,true) WHERE id = p_id AND organization_id = org RETURNING id INTO rid;
    IF rid IS NULL THEN RAISE EXCEPTION 'rule not found'; END IF;
  END IF;
  RETURN rid;
END $$;

-- Work out fees due on a case from payments received. Safe to run repeatedly (each payment/month is charged once per rule).
CREATE OR REPLACE FUNCTION dv_post_fees(p_case uuid)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c debt_cases; r fee_rules; p record; n int := 0; amt numeric; used numeric; ins int;
BEGIN
  SELECT * INTO c FROM debt_cases WHERE id = p_case;
  IF c.id IS NULL OR NOT dv_can_edit_case(p_case) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  FOR r IN SELECT * FROM fee_rules WHERE organization_id = c.organization_id AND active LOOP
    IF r.kind = 'percent_of_receipt' THEN
      FOR p IN SELECT id, amount, payment_date FROM debt_payments WHERE case_id = p_case ORDER BY payment_date, created_at LOOP
        CONTINUE WHEN EXISTS (SELECT 1 FROM fee_charges WHERE case_id = p_case AND rule_id = r.id AND charge_key = 'pay-' || p.id);
        amt := round(p.amount * r.percent / 100, 2);
        IF r.max_per_month IS NOT NULL THEN
          SELECT COALESCE(sum(amount),0) INTO used FROM fee_charges WHERE case_id = p_case AND rule_id = r.id AND status <> 'waived' AND to_char(charged_on,'YYYY-MM') = to_char(p.payment_date,'YYYY-MM');
          amt := LEAST(amt, GREATEST(r.max_per_month - used, 0));
        END IF;
        amt := LEAST(amt, p.amount);
        IF amt > 0 THEN
          INSERT INTO fee_charges (organization_id, case_id, rule_id, charge_key, amount, charged_on) VALUES (c.organization_id, p_case, r.id, 'pay-' || p.id, amt, p.payment_date)
          ON CONFLICT DO NOTHING; GET DIAGNOSTICS ins = ROW_COUNT; n := n + ins;
        END IF;
      END LOOP;
    ELSE
      FOR p IN SELECT to_char(payment_date,'YYYY-MM') AS m, min(payment_date) AS d, sum(amount) AS total FROM debt_payments WHERE case_id = p_case GROUP BY 1 LOOP
        amt := LEAST(r.monthly_amount, p.total);
        IF amt > 0 THEN
          INSERT INTO fee_charges (organization_id, case_id, rule_id, charge_key, amount, charged_on) VALUES (c.organization_id, p_case, r.id, 'month-' || p.m, amt, p.d)
          ON CONFLICT DO NOTHING; GET DIAGNOSTICS ins = ROW_COUNT; n := n + ins;
        END IF;
      END LOOP;
    END IF;
  END LOOP;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION dv_decide_fee(p_charge uuid, p_take boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE f fee_charges;
BEGIN
  SELECT * INTO f FROM fee_charges WHERE id = p_charge;
  IF f.id IS NULL OR NOT dv_is_manager(f.organization_id) OR NOT dv_can_read_case(f.case_id) THEN RAISE EXCEPTION 'managers only' USING ERRCODE = '42501'; END IF;
  IF f.status <> 'due' THEN RAISE EXCEPTION 'this fee has already been decided'; END IF;
  UPDATE fee_charges SET status = CASE WHEN p_take THEN 'taken' ELSE 'waived' END, decided_by = auth.uid(), decided_at = now() WHERE id = p_charge;
  INSERT INTO debt_audit_log (case_id, milestone, description) VALUES (f.case_id, CASE WHEN p_take THEN 'Fee taken' ELSE 'Fee waived' END, format('Fee of £%s %s', to_char(f.amount,'FM999990.00'), CASE WHEN p_take THEN 'taken from client money' ELSE 'waived' END));
END $$;

-- Client money held on a case: received, less fees taken out, less creditor payouts.
CREATE OR REPLACE FUNCTION dv_case_funds_held(p_case uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN dv_can_read_case(p_case) THEN
    COALESCE((SELECT sum(amount) FROM debt_payments WHERE case_id = p_case),0)
    - COALESCE((SELECT sum(amount) FROM fee_charges WHERE case_id = p_case AND status = 'taken'),0)
    - COALESCE((SELECT sum(total_amount) FROM disbursement_runs WHERE case_id = p_case AND status <> 'failed'),0)
  END;
$$;
-- What creditors can be paid now: held money, less fees that are due but not yet decided.
CREATE OR REPLACE FUNCTION dv_case_distributable(p_case uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN dv_can_read_case(p_case) THEN
    dv_case_funds_held(p_case) - COALESCE((SELECT sum(amount) FROM fee_charges WHERE case_id = p_case AND status = 'due'),0)
  END;
$$;

DO $$
DECLARE src text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO src FROM pg_proc p WHERE p.proname = 'dv_create_distribution_run' AND p.pronamespace = 'public'::regnamespace;
  src := replace(src, 'funds := dv_case_funds_held(p_case);', 'funds := dv_case_distributable(p_case);');
  EXECUTE src;
  SELECT pg_get_functiondef(p.oid) INTO src FROM pg_proc p WHERE p.proname = 'dv_cass_position' AND p.pronamespace = 'public'::regnamespace;
  src := replace(src, '- COALESCE((SELECT sum(r.total_amount) FROM disbursement_runs r WHERE r.case_id = c.id AND r.status <> ''failed''),0) AS held',
                      '- COALESCE((SELECT sum(f.amount) FROM fee_charges f WHERE f.case_id = c.id AND f.status = ''taken''),0)' || chr(10) ||
                      '      - COALESCE((SELECT sum(r.total_amount) FROM disbursement_runs r WHERE r.case_id = c.id AND r.status <> ''failed''),0) AS held');
  EXECUTE src;
END $$;

REVOKE EXECUTE ON FUNCTION dv_log_complaint(uuid,text,text,text,text,date,boolean), dv_complaint_update(uuid,text,text,numeric,text,boolean), dv_save_fee_rule(uuid,text,text,numeric,numeric,numeric,boolean), dv_post_fees(uuid), dv_decide_fee(uuid,boolean), dv_case_funds_held(uuid), dv_case_distributable(uuid), dv_cass_position(), dv_create_distribution_run(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION dv_log_complaint(uuid,text,text,text,text,date,boolean), dv_complaint_update(uuid,text,text,numeric,text,boolean), dv_save_fee_rule(uuid,text,text,numeric,numeric,numeric,boolean), dv_post_fees(uuid), dv_decide_fee(uuid,boolean), dv_case_funds_held(uuid), dv_case_distributable(uuid), dv_cass_position(), dv_create_distribution_run(uuid) TO authenticated, service_role;
