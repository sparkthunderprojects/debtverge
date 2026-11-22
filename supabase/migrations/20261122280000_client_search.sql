-- Client search: one box finds a client by name, phone, email, date of birth, address or case number.
ALTER TABLE public.debt_customer_profiles ADD COLUMN IF NOT EXISTS date_of_birth date CHECK (date_of_birth IS NULL OR (date_of_birth > date '1900-01-01' AND date_of_birth < current_date));

CREATE OR REPLACE FUNCTION public.dv_search_clients(p_q text)
RETURNS TABLE (case_id uuid, case_number text, debtor_name text, status text, email text, phone text, date_of_birth date, address text, adviser_name text, matched_on text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE o uuid := dv_my_org(); q text := btrim(coalesce(p_q, '')); pat text; digits text; dob date := NULL; m text[];
BEGIN
  IF o IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF length(q) < 2 OR length(q) > 100 THEN RETURN; END IF;
  pat := '%' || replace(replace(replace(lower(q), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  digits := regexp_replace(q, '[^0-9]', '', 'g');
  -- dates typed as 14/03/1985, 14-03-1985, 14.3.85 or 1985-03-14
  m := regexp_match(q, '^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})$');
  IF m IS NOT NULL THEN
    BEGIN dob := make_date(CASE WHEN length(m[3]) = 2 THEN (CASE WHEN m[3]::int > extract(year FROM current_date)::int % 100 THEN 1900 ELSE 2000 END) + m[3]::int ELSE m[3]::int END, m[2]::int, m[1]::int);
    EXCEPTION WHEN OTHERS THEN dob := NULL; END;
  ELSE
    m := regexp_match(q, '^(\d{4})-(\d{1,2})-(\d{1,2})$');
    IF m IS NOT NULL THEN BEGIN dob := make_date(m[1]::int, m[2]::int, m[3]::int); EXCEPTION WHEN OTHERS THEN dob := NULL; END; END IF;
  END IF;
  -- a phone search needs at least 4 digits and mostly digits; compare without spaces, +44 or leading 0
  IF length(digits) < 4 OR length(digits) < length(regexp_replace(q, '[\s()+\-]', '', 'g')) THEN digits := NULL; END IF;
  IF digits IS NOT NULL THEN digits := regexp_replace(digits, '^(44|0)', ''); END IF;

  RETURN QUERY
  SELECT c.id, c.case_number, c.debtor_name, c.status::text, p.primary_email,
         coalesce(p.mobile_phone, p.landline_phone, p.work_phone), p.date_of_birth,
         nullif(concat_ws(', ', nullif(p.address_street, ''), nullif(p.address_city, ''), nullif(p.address_postcode, '')), ''),
         coalesce(pr.full_name, pr.email),
         CASE
           WHEN lower(c.debtor_name) LIKE pat ESCAPE '\' OR lower(coalesce(p.full_name, '')) LIKE pat ESCAPE '\' THEN 'name'
           WHEN lower(c.case_number) LIKE pat ESCAPE '\' THEN 'case number'
           WHEN lower(coalesce(p.primary_email, '')) LIKE pat ESCAPE '\' THEN 'email'
           WHEN dob IS NOT NULL AND p.date_of_birth = dob THEN 'date of birth'
           WHEN digits IS NOT NULL AND (regexp_replace(coalesce(p.mobile_phone, ''), '[^0-9]', '', 'g') LIKE '%' || digits || '%' OR regexp_replace(coalesce(p.landline_phone, ''), '[^0-9]', '', 'g') LIKE '%' || digits || '%' OR regexp_replace(coalesce(p.work_phone, ''), '[^0-9]', '', 'g') LIKE '%' || digits || '%') THEN 'phone'
           ELSE 'address'
         END
  FROM debt_cases c
  LEFT JOIN debt_customer_profiles p ON p.case_id = c.id AND p.deleted_at IS NULL
  LEFT JOIN profiles pr ON pr.id = c.assigned_to
  WHERE c.organization_id = o AND c.deleted_at IS NULL AND dv_can_read_case(c.id)
    AND (
      lower(c.debtor_name) LIKE pat ESCAPE '\' OR lower(c.case_number) LIKE pat ESCAPE '\'
      OR lower(coalesce(p.full_name, '')) LIKE pat ESCAPE '\' OR lower(coalesce(p.primary_email, '')) LIKE pat ESCAPE '\'
      OR lower(concat_ws(' ', p.address_street, p.address_city, p.address_postcode)) LIKE pat ESCAPE '\'
      OR lower(replace(coalesce(p.address_postcode, ''), ' ', '')) LIKE replace(pat, ' ', '') ESCAPE '\'
      OR (dob IS NOT NULL AND p.date_of_birth = dob)
      OR (digits IS NOT NULL AND (regexp_replace(coalesce(p.mobile_phone, ''), '[^0-9]', '', 'g') LIKE '%' || digits || '%' OR regexp_replace(coalesce(p.landline_phone, ''), '[^0-9]', '', 'g') LIKE '%' || digits || '%' OR regexp_replace(coalesce(p.work_phone, ''), '[^0-9]', '', 'g') LIKE '%' || digits || '%'))
    )
  ORDER BY (lower(c.debtor_name) LIKE lower(q) || '%') DESC, c.debtor_name
  LIMIT 15;
END $function$;
REVOKE ALL ON FUNCTION public.dv_search_clients(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dv_search_clients(text) TO authenticated;

-- date of birth is personal data: erasure clears it
DO $$ DECLARE d text; d0 text;
BEGIN
  d0 := pg_get_functiondef('public.dv_erase_case(uuid,text)'::regprocedure);
  d := replace(d0, '"debt_customer_profiles":["full_name",', '"debt_customer_profiles":["date_of_birth","full_name",');
  IF d = d0 THEN RAISE EXCEPTION 'erase patch did not apply'; END IF;
  EXECUTE d;
END $$;
