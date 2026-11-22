-- Right to erasure: scrub the call notes, transcripts, callbacks, review text and risk text for an erased client.
DO $$
DECLARE d text; n text;
BEGIN
  d := pg_get_functiondef('public.dv_erase_case(uuid,text)'::regprocedure);
  IF position('dv_call_transcripts' in d) > 0 THEN RETURN; END IF;
  n := replace(d, '"dv_call_sessions":["phone","summary"], "dv_call_ai_drafts":["body","final_body"]',
    '"dv_call_sessions":["phone","summary","caller_name"], "dv_call_ai_drafts":["body","final_body","payload"], "dv_call_notes":["note_text"], "dv_call_transcripts":["body"], "dv_call_callbacks":["phone","customer_name","notes"], "dv_call_reviews":["comments","decision_note","escalation_reason"], "dv_call_risk_indicators":["description","resolution_note"]');
  IF n = d THEN RAISE EXCEPTION 'plan text not found'; END IF;
  d := n;
  n := replace(d, E'  UPDATE complaint_events SET note = NULL WHERE note IS NOT NULL',
    E'  UPDATE dv_call_reviews SET issues = ''[]''::jsonb, corrective_actions = ''[]''::jsonb WHERE case_id = p_case;\n  UPDATE complaint_events SET note = NULL WHERE note IS NOT NULL');
  IF n = d THEN RAISE EXCEPTION 'anchor not found'; END IF;
  EXECUTE n;
END $$;
