import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Playback/download of a call recording. The database decides (and logs) who may listen; only then is a 5-minute signed link made.
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const body = await req.json().catch(() => ({}));
  if (!UUID.test(String(body.call_id ?? ""))) return json({ error: "Missing call." }, 400);
  const user = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const { data: u } = await user.auth.getUser();
  if (!u?.user) return json({ error: "Sign in first." }, 401);
  const download = body.download === true;
  const { error } = await user.rpc("dv_call_recording_check", { p_call: body.call_id, p_download: download });
  if (error) return json({ error: error.message }, error.code === "42501" ? 403 : 400);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: ref } = await admin.rpc("dv_call_recording_ref", { p_call: body.call_id });
  if (!ref) return json({ error: "There is no recording for this call." }, 404);
  const { data, error: e2 } = await admin.storage.from("call-recordings").createSignedUrl(ref as string, 300, download ? { download: `call-${String(body.call_id).slice(0, 8)}.mp3` } : undefined);
  if (e2 || !data) return json({ error: "The recording could not be opened." }, 502);
  return json({ url: data.signedUrl, expires_in: 300 });
});
