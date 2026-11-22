REVOKE EXECUTE ON FUNCTION claim_next_background_job(text, text[]), update_job_progress(uuid, integer, integer, integer, integer, text, text), requeue_stale_jobs(integer),
  seed_debtverge_roles(uuid), handle_new_user(), handle_new_user_profile(), dv_case_status_tasks(), dv_case_owner_tasks(), upsert_knowledge_gap(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_next_background_job(text, text[]), update_job_progress(uuid, integer, integer, integer, integer, text, text), requeue_stale_jobs(integer),
  seed_debtverge_roles(uuid), upsert_knowledge_gap(text, text) TO service_role;
ALTER FUNCTION update_debt_cases_updated_at() SET search_path = public;
ALTER FUNCTION update_updated_at_column() SET search_path = public;
ALTER FUNCTION finance_knowledge_fts_update() SET search_path = public;
ALTER FUNCTION claim_next_background_job(text, text[]) SET search_path = public;
ALTER FUNCTION update_job_progress(uuid, integer, integer, integer, integer, text, text) SET search_path = public;
ALTER FUNCTION requeue_stale_jobs(integer) SET search_path = public;
ALTER FUNCTION dv_business_days(date, date) SET search_path = public;
ALTER FUNCTION dv_audit_immutable() SET search_path = '';
REVOKE EXECUTE ON FUNCTION finance_knowledge_fts_update(), update_debt_cases_updated_at(), update_updated_at_column() FROM PUBLIC, anon, authenticated;
