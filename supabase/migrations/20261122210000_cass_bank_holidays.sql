-- CASS 5-business-day rule now excludes England & Wales bank holidays (table covers 2025-2028; later dates count weekdays only).
CREATE TABLE IF NOT EXISTS public.dv_bank_holidays (day date PRIMARY KEY, name text NOT NULL);
ALTER TABLE public.dv_bank_holidays ENABLE ROW LEVEL SECURITY;
CREATE POLICY dv_bank_holidays_read ON public.dv_bank_holidays FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.dv_bank_holidays FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.dv_bank_holidays TO authenticated;
INSERT INTO public.dv_bank_holidays (day, name) VALUES
 ('2025-08-25','Summer bank holiday'),('2025-12-25','Christmas Day'),('2025-12-26','Boxing Day'),
 ('2026-01-01','New Year''s Day'),('2026-04-03','Good Friday'),('2026-04-06','Easter Monday'),('2026-05-04','Early May bank holiday'),('2026-05-25','Spring bank holiday'),('2026-08-31','Summer bank holiday'),('2026-12-25','Christmas Day'),('2026-12-28','Boxing Day (substitute)'),
 ('2027-01-01','New Year''s Day'),('2027-03-26','Good Friday'),('2027-03-29','Easter Monday'),('2027-05-03','Early May bank holiday'),('2027-05-31','Spring bank holiday'),('2027-08-30','Summer bank holiday'),('2027-12-27','Christmas Day (substitute)'),('2027-12-28','Boxing Day (substitute)'),
 ('2028-01-03','New Year''s Day (substitute)'),('2028-04-14','Good Friday'),('2028-04-17','Easter Monday'),('2028-05-01','Early May bank holiday'),('2028-05-29','Spring bank holiday'),('2028-08-28','Summer bank holiday'),('2028-12-25','Christmas Day'),('2028-12-26','Boxing Day')
ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION public.dv_business_days(d1 date, d2 date)
RETURNS int LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT count(*)::int FROM generate_series(d1 + 1, d2, interval '1 day') g
  WHERE extract(isodow FROM g) < 6 AND NOT EXISTS (SELECT 1 FROM dv_bank_holidays h WHERE h.day = g::date);
$$;
