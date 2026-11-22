-- Money ledgers and compliance records are never deleted or voided: they are corrected by an audited status change (cancel, waive, release).
CREATE OR REPLACE FUNCTION dv_no_delete() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN RAISE EXCEPTION 'this record cannot be deleted; cancel or reverse it instead' USING ERRCODE = '42501'; END $$;
REVOKE EXECUTE ON FUNCTION dv_no_delete() FROM PUBLIC, anon, authenticated;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['disbursement_runs','disbursement_run_items','fee_charges','cass_holds','signing_requests','complaints','fee_rules','cass_reconciliations','complaint_events'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_soft_delete ON %I', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_no_delete ON %I', t);
    EXECUTE format('CREATE TRIGGER trg_no_delete BEFORE DELETE ON %I FOR EACH ROW EXECUTE FUNCTION dv_no_delete()', t);
  END LOOP;
END $$;
