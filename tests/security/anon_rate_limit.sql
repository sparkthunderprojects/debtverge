-- Public functions are rate limited per caller; internal helpers are not callable by anon.
BEGIN;
SET LOCAL ROLE anon;
SELECT set_config('request.headers','{"cf-connecting-ip":"203.0.113.9"}',true);
DO $$ DECLARE i int; r jsonb; blocked boolean := false;
BEGIN
  FOR i IN 1..120 LOOP r := get_payment_link('nonexistent'); END LOOP;
  BEGIN r := get_payment_link('nonexistent'); EXCEPTION WHEN sqlstate '54000' THEN blocked := true; END;
  IF NOT blocked THEN RAISE EXCEPTION 'not rate limited at 121'; END IF;
END $$;
SELECT set_config('request.headers','{"cf-connecting-ip":"203.0.113.10"}',true);
DO $$ BEGIN PERFORM get_payment_link('nonexistent'); END $$;
DO $$ BEGIN
  BEGIN PERFORM dv_rate_check('x', 1, 60); RAISE EXCEPTION 'anon can call dv_rate_check'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT 'RATE LIMIT TESTS PASSED';
ROLLBACK;
