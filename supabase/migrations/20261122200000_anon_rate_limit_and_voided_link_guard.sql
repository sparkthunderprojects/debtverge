-- Rate limiting for the public (no-login) functions, per caller address (120 calls / minute / function), and
-- payment links stop resolving once their case is voided. Replay-safe: patches the existing function bodies.
CREATE TABLE IF NOT EXISTS public.dv_rate_limits (
  bucket text NOT NULL, window_start timestamptz NOT NULL, hits int NOT NULL DEFAULT 1,
  PRIMARY KEY (bucket, window_start)
);
ALTER TABLE public.dv_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dv_rate_limits FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.dv_rate_check(p_fn text, p_max int, p_window_seconds int DEFAULT 60)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE h jsonb; ip text; w timestamptz; n int;
BEGIN
  BEGIN h := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'); EXCEPTION WHEN others THEN h := '{}'; END;
  ip := coalesce(nullif(btrim(h->>'cf-connecting-ip'), ''), nullif(btrim(split_part(coalesce(h->>'x-forwarded-for',''), ',', 1)), ''), 'unknown');
  w := to_timestamp(floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds);
  INSERT INTO dv_rate_limits (bucket, window_start) VALUES (left(p_fn || '|' || ip, 200), w)
    ON CONFLICT (bucket, window_start) DO UPDATE SET hits = dv_rate_limits.hits + 1 RETURNING hits INTO n;
  IF n > p_max THEN RAISE EXCEPTION 'Too many requests. Please wait a minute and try again.' USING ERRCODE = '54000'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.dv_rate_check(text,int,int) FROM PUBLIC, anon, authenticated;

SELECT cron.schedule('dv-rate-limit-cleanup', '*/30 * * * *', $c$DELETE FROM public.dv_rate_limits WHERE window_start < now() - interval '1 hour'$c$);

DO $m$
DECLARE f text; d text; nl text := chr(10);
BEGIN
  FOREACH f IN ARRAY ARRAY['get_payment_link(text)','get_link_payment_state(text)','submit_change_request(text,text,text,text,text)','dv_get_signing_request(text)','dv_sign_request(text,text,text)'] LOOP
    d := pg_get_functiondef(('public.' || f)::regprocedure);
    IF d LIKE '%dv_rate_check%' THEN CONTINUE; END IF;
    d := regexp_replace(d, 'BEGIN' || nl, 'BEGIN' || nl || '  PERFORM dv_rate_check(''' || split_part(f,'(',1) || ''', 120, 60);' || nl);
    IF d NOT LIKE '%dv_rate_check%' THEN RAISE EXCEPTION 'patch failed for %', f; END IF;
    IF f = 'get_payment_link(text)' THEN
      d := replace(d, 'SELECT * INTO c FROM debt_cases WHERE id = l.case_id;', 'SELECT * INTO c FROM debt_cases WHERE id = l.case_id AND deleted_at IS NULL;' || nl || '  IF NOT FOUND THEN RETURN jsonb_build_object(''found'', false); END IF;');
    END IF;
    EXECUTE d;
  END LOOP;
END $m$;
