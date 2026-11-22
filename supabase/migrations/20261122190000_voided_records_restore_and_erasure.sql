-- Restore voided cases and GDPR-style erasure of personal data.
-- Erasure anonymises personal fields, keeps financial records, creditor data, document hashes and the audit trail,
-- and writes an immutable erasure_log row. Admin / Operations Manager only; refused while client money, open complaints or open payouts exist.
ALTER TABLE public.debt_cases ADD COLUMN IF NOT EXISTS erased_at timestamptz;

CREATE TABLE IF NOT EXISTS public.erasure_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  case_id uuid NOT NULL,
  case_number text,
  reason text NOT NULL,
  fields_erased int NOT NULL DEFAULT 0,
  erased_by uuid NOT NULL,
  erased_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.erasure_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY erasure_log_read ON public.erasure_log FOR SELECT TO authenticated USING (dv_is_org_admin(organization_id));
REVOKE ALL ON public.erasure_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.erasure_log TO authenticated;
CREATE TRIGGER erasure_log_immutable BEFORE UPDATE OR DELETE ON public.erasure_log FOR EACH ROW EXECUTE FUNCTION dv_audit_immutable();
CREATE TRIGGER erasure_log_no_truncate BEFORE TRUNCATE ON public.erasure_log FOR EACH STATEMENT EXECUTE FUNCTION dv_audit_immutable();

-- Row audit is skipped only while an erasure runs (so personal data is not copied into the audit log); a summary row is written instead.
-- Patch applied to dv_audit_row(): first statement of the body is
--   IF current_setting('dv.erasing', true) = 'on' THEN RETURN COALESCE(NEW, OLD); END IF;
DO $m$ DECLARE d text; BEGIN
  d := pg_get_functiondef('public.dv_audit_row()'::regprocedure);
  d := replace(d, E'BEGIN\n  IF TG_OP = ''DELETE''', E'BEGIN\n  IF current_setting(''dv.erasing'', true) = ''on'' THEN RETURN COALESCE(NEW, OLD); END IF;\n  IF TG_OP = ''DELETE''');
  EXECUTE d;
END $m$;

-- dv_list_voided_cases(), dv_restore_case(uuid), dv_erase_case(uuid, text): see the live definitions (pg_get_functiondef).
-- Summary of rules enforced inside them:
--  * list/restore: manager or above, own firm; restricted cases need an admin; erased cases cannot be restored.
--  * erase: Admin/Operations Manager only; case must be voided first; reason of 10+ characters; refused if funds held <> 0,
--    an open complaint exists, or a draft/approved payout exists; sets dv.erasing for the transaction; anonymises columns listed
--    in the plan in the function body; logs to erasure_log and debt_audit_log.
