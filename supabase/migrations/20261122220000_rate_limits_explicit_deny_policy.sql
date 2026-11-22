CREATE POLICY dv_rate_limits_no_access ON public.dv_rate_limits FOR ALL TO authenticated, anon USING (false) WITH CHECK (false);
