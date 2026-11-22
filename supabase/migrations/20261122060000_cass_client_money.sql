-- CASS 11 style client-money controls: what each firm holds per case, how long, why it is retained, and daily reconciliation.
CREATE TABLE IF NOT EXISTS cass_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES debt_cases(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (reason IN ('awaiting_creditor_details','creditor_dispute','client_request','payment_returned','fees_being_agreed','other')),
  note text,
  review_date date NOT NULL,
  set_by uuid DEFAULT auth.uid(),
  set_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS cass_holds_one_active ON cass_holds (case_id) WHERE released_at IS NULL;

CREATE TABLE IF NOT EXISTS cass_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  recon_date date NOT NULL DEFAULT current_date,
  bank_balance numeric(14,2) NOT NULL,
  ledger_total numeric(14,2) NOT NULL,
  difference numeric(14,2) GENERATED ALWAYS AS (bank_balance - ledger_total) STORED,
  note text,
  done_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE cass_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE cass_reconciliations ENABLE ROW LEVEL SECURITY;
CREATE POLICY cass_holds_read ON cass_holds FOR SELECT TO authenticated USING (dv_can_read_case(case_id));
CREATE POLICY cass_recon_read ON cass_reconciliations FOR SELECT TO authenticated USING (dv_is_manager(organization_id));
-- reconciliations are a permanent record: no edits or deletes from clients (writes only via function)
REVOKE UPDATE, DELETE, INSERT ON cass_holds, cass_reconciliations FROM authenticated, anon;

-- Whole weekdays after d1 up to and including d2 (bank holidays are not excluded: errs on the side of flagging early).
CREATE OR REPLACE FUNCTION dv_business_days(d1 date, d2 date)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT count(*)::int FROM generate_series(d1 + 1, d2, interval '1 day') g WHERE extract(isodow FROM g) < 6;
$$;

-- Money held per case (received minus paid out), age of the oldest money still held, and whether it breaches the 5 business day rule.
CREATE OR REPLACE FUNCTION dv_cass_position()
RETURNS TABLE (case_id uuid, case_number text, debtor_name text, assigned_to uuid, held numeric, oldest_receipt date, business_days int,
               hold_reason text, hold_review date, breach boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE org uuid := dv_my_org();
BEGIN
  IF org IS NULL OR NOT dv_is_manager(org) THEN RAISE EXCEPTION 'managers only' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  WITH h AS (
    SELECT c.id, c.case_number, c.debtor_name, c.assigned_to,
      COALESCE((SELECT sum(p.amount) FROM debt_payments p WHERE p.case_id = c.id),0)
      - COALESCE((SELECT sum(r.total_amount) FROM disbursement_runs r WHERE r.case_id = c.id AND r.status <> 'failed'),0) AS held
    FROM debt_cases c WHERE c.organization_id = org
  ), rec AS (
    SELECT h.id, p.payment_date, p.amount,
           sum(p.amount) OVER (PARTITION BY h.id ORDER BY p.payment_date DESC, p.created_at DESC) AS run_total
    FROM h JOIN debt_payments p ON p.case_id = h.id WHERE h.held > 0.004
  ), oldest AS (
    SELECT rec.id, min(rec.payment_date) AS d FROM rec JOIN h ON h.id = rec.id WHERE rec.run_total - rec.amount < h.held GROUP BY rec.id
  )
  SELECT h.id, h.case_number, h.debtor_name, h.assigned_to, h.held, o.d,
         CASE WHEN o.d IS NULL THEN 0 ELSE dv_business_days(o.d, current_date) END,
         k.reason, k.review_date,
         (o.d IS NOT NULL AND dv_business_days(o.d, current_date) > 5 AND k.id IS NULL)
  FROM h LEFT JOIN oldest o ON o.id = h.id
         LEFT JOIN cass_holds k ON k.case_id = h.id AND k.released_at IS NULL
  WHERE h.held > 0.004
  ORDER BY 10 DESC, 7 DESC NULLS LAST;
END $$;

CREATE OR REPLACE FUNCTION dv_cass_set_hold(p_case uuid, p_reason text, p_note text, p_review date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c debt_cases;
BEGIN
  SELECT * INTO c FROM debt_cases WHERE id = p_case;
  IF c.id IS NULL OR c.organization_id IS NULL OR NOT dv_is_manager(c.organization_id) OR NOT dv_can_read_case(p_case) THEN RAISE EXCEPTION 'managers only' USING ERRCODE = '42501'; END IF;
  IF p_review IS NULL OR p_review > current_date + 30 THEN RAISE EXCEPTION 'a retained-funds reason needs a review date within 30 days'; END IF;
  UPDATE cass_holds SET released_at = now() WHERE case_id = p_case AND released_at IS NULL;
  INSERT INTO cass_holds (organization_id, case_id, reason, note, review_date) VALUES (c.organization_id, p_case, p_reason, p_note, p_review);
  INSERT INTO debt_audit_log (case_id, milestone, description) VALUES (p_case, 'Client money retained', format('Funds retained: %s (review %s)', replace(p_reason,'_',' '), p_review));
END $$;

CREATE OR REPLACE FUNCTION dv_cass_release_hold(p_case uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c debt_cases;
BEGIN
  SELECT * INTO c FROM debt_cases WHERE id = p_case;
  IF c.id IS NULL OR c.organization_id IS NULL OR NOT dv_is_manager(c.organization_id) OR NOT dv_can_read_case(p_case) THEN RAISE EXCEPTION 'managers only' USING ERRCODE = '42501'; END IF;
  UPDATE cass_holds SET released_at = now() WHERE case_id = p_case AND released_at IS NULL;
  INSERT INTO debt_audit_log (case_id, milestone, description) VALUES (p_case, 'Client money hold released', 'Retained-funds hold released');
END $$;

-- Daily reconciliation: manager enters the client bank account balance; the system records it against the ledger total.
CREATE OR REPLACE FUNCTION dv_cass_reconcile(p_bank_balance numeric, p_note text DEFAULT NULL)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE org uuid := dv_my_org(); led numeric; diff numeric;
BEGIN
  IF org IS NULL OR NOT dv_is_manager(org) THEN RAISE EXCEPTION 'managers only' USING ERRCODE = '42501'; END IF;
  SELECT COALESCE(sum(held),0) INTO led FROM dv_cass_position();
  INSERT INTO cass_reconciliations (organization_id, bank_balance, ledger_total, note) VALUES (org, round(p_bank_balance,2), round(led,2), p_note);
  diff := round(p_bank_balance,2) - round(led,2);
  RETURN diff;
END $$;

REVOKE EXECUTE ON FUNCTION dv_business_days(date,date), dv_cass_position(), dv_cass_set_hold(uuid,text,text,date), dv_cass_release_hold(uuid), dv_cass_reconcile(numeric,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION dv_business_days(date,date), dv_cass_position(), dv_cass_set_hold(uuid,text,text,date), dv_cass_release_hold(uuid), dv_cass_reconcile(numeric,text) TO authenticated, service_role;
