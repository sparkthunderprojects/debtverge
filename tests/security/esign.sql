-- E-sign: anon can only use token-based RPCs; cannot read signing_requests directly.
BEGIN;
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM 1 FROM signing_requests LIMIT 1; RAISE EXCEPTION 'FAIL: anon read signing_requests';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM dv_create_signing_request(gen_random_uuid(),'x','y'); RAISE EXCEPTION 'FAIL: anon create';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF (dv_get_signing_request('nonexistent')->>'found')::boolean THEN RAISE EXCEPTION 'FAIL: bogus token found'; END IF;
  RAISE NOTICE 'ESIGN TESTS PASSED';
END $$;
ROLLBACK;
-- (also see audit_softdelete.sql and audit_checklist.sql)
