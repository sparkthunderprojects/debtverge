import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Drafts a call summary and a compliance analysis from the real transcript using a real model.
// Output is stored only as DRAFTS for a person to approve, edit or reject. Without ANTHROPIC_API_KEY nothing is produced.
// Callable by the service role (after a transcript arrives) or by a signed-in manager asking for an analysis.
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MODEL = Deno.env.get("CALL_AI_MODEL") ?? "claude-sonnet-5-5";

const SYSTEM = `You help a UK debt advice firm grade a recorded call. You are given only the call transcript. A human reviewer will listen to the call later and confirm or change every answer you give, so be accurate and show your evidence.
Rules: use only what the transcript says; never invent facts, amounts or names; if the transcript does not show something, answer "unclear". Do not give legal or financial advice.
Grade each checklist item "yes", "no", "na" (does not apply to this call) or "unclear", with a short evidence note quoting under 20 words copied exactly from the transcript where you can.
Reply with JSON only: {"summary": string (4-8 plain sentences: why the customer called, what was discussed, what was agreed, what happens next),
"analysis": {"topics": string[], "customer_sentiment": "positive"|"neutral"|"negative"|"mixed",
"checklist_suggestions": [{"item": one of "recording_notice"|"identity_checked"|"affordability_discussed"|"vulnerability_considered"|"options_explained"|"fees_explained"|"no_pressure"|"accurate_information"|"next_steps_agreed", "suggested": "yes"|"no"|"na"|"unclear", "evidence": string}] (include all nine items),
"suggested_outcome": "compliant"|"minor_issues"|"major_issues"|"non_compliant", "outcome_reason": string,
"vulnerability_indicators": [{"quote": string (under 20 words, copied exactly), "note": string}], "possible_complaint": boolean, "possible_complaint_note": string|null, "follow_ups": string[]}, "confidence": number between 0 and 1}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ status: "not_configured", error: "AI analysis is not configured for this deployment." }, 503);
  const b = await req.json().catch(() => ({}));
  if (!UUID.test(String(b.call_id ?? ""))) return json({ error: "Missing call." }, 400);
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer /, "");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, service);
  if (bearer !== service) {   // a person: must be allowed to see this call's compliance record
    const user = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: `Bearer ${bearer}` } } });
    const { data: d, error } = await user.rpc("dv_call_detail", { p_call: b.call_id });
    if (error || !d?.is_compliance_manager) return json({ error: "Not allowed." }, 403);
  }
  const { data: ctx } = await admin.rpc("dv_call_ai_context", { p_call: b.call_id });
  if (!ctx?.transcript) return json({ status: "skipped", error: "There is no transcript to analyse, or AI analysis is switched off." }, 409);

  const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 3000, system: SYSTEM, messages: [{ role: "user", content: `Call direction: ${ctx.direction}\n\nTranscript:\n${String(ctx.transcript).slice(0, 120000)}` }] }) });
  if (!r.ok) return json({ error: "The model did not respond." }, 502);
  const out = await r.json();
  const text: string = out.content?.find((c: { type: string }) => c.type === "text")?.text ?? "";
  let parsed: { summary?: string; analysis?: unknown; confidence?: number };
  try { parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)); } catch { return json({ error: "The model reply could not be read." }, 502); }
  if (!parsed.summary || !parsed.analysis) return json({ error: "The model reply was incomplete." }, 502);
  const model = out.model ?? MODEL;
  const conf = typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : null;
  const made: string[] = [];
  for (const [kind, body, payload] of [["summary", parsed.summary, null], ["analysis", "Compliance analysis draft", JSON.stringify(parsed.analysis)]] as const) {
    const { error } = await admin.rpc("dv_call_ai_store", { p_call: b.call_id, p_kind: kind, p_body: body, p_payload: payload, p_model: model, p_version: out.id ?? "unknown", p_confidence: conf });
    if (!error) made.push(kind);
  }
  return json({ status: "ok", drafts: made });
});
