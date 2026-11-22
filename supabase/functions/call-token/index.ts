import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Issues a short-lived Twilio Voice access token to a signed-in adviser whose firm has the Phone add-on.
// The token identity is the adviser's user id, which is how inbound calls are routed to them.
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const b64u = (b: Uint8Array | string) => btoa(typeof b === "string" ? b : String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const SID = Deno.env.get("TWILIO_ACCOUNT_SID"), KEY = Deno.env.get("TWILIO_API_KEY_SID"), SECRET = Deno.env.get("TWILIO_API_KEY_SECRET"), APP = Deno.env.get("TWILIO_TWIML_APP_SID");
  if (!SID || !KEY || !SECRET || !APP) return json({ error: "Phone is not configured for this deployment yet." }, 503);
  const auth = req.headers.get("Authorization") ?? "";
  const user = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const { data: u } = await user.auth.getUser();
  if (!u?.user) return json({ error: "Sign in first." }, 401);
  const { data: ok, error } = await user.rpc("dv_call_token_check");
  if (error || !ok) return json({ error: "Phone is not available for your account." }, 403);
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: "HS256", typ: "JWT", cty: "twilio-fpa;v=1" }));
  const body = b64u(JSON.stringify({ jti: `${KEY}-${now}`, iss: KEY, sub: SID, nbf: now, exp: now + 3600,
    grants: { identity: u.user.id, voice: { incoming: { allow: true }, outgoing: { application_sid: APP } } } }));
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = b64u(new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${head}.${body}`))));
  return json({ token: `${head}.${body}.${sig}`, identity: u.user.id, expires_in: 3600 });
});
