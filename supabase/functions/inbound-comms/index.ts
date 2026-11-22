import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Twilio webhook for inbound SMS and WhatsApp. Point the Twilio number's "A message comes in" URL at
// <project url>/functions/v1/inbound-comms (set INBOUND_COMMS_URL if you front it with another address).
// Every request is checked against Twilio's X-Twilio-Signature using TWILIO_AUTH_TOKEN; anything unsigned is rejected.
const xml = (s = 200) => new Response("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response/>", { status: s, headers: { "Content-Type": "text/xml" } });

async function validSignature(url: string, params: Record<string, string>, signature: string, token: string) {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(token), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
  const expected = btoa(String.fromCharCode(...mac));
  if (expected.length !== signature.length) return false;
  let d = 0;
  for (let i = 0; i < expected.length; i++) d |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return d === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const token = Deno.env.get("TWILIO_AUTH_TOKEN");
  if (!token) return new Response("not configured", { status: 503 });

  const form = await req.formData();
  const params: Record<string, string> = {};
  form.forEach((v, k) => { if (typeof v === "string") params[k] = v; });
  const url = Deno.env.get("INBOUND_COMMS_URL") ?? `${Deno.env.get("SUPABASE_URL")}/functions/v1/inbound-comms`;
  if (!(await validSignature(url, params, req.headers.get("x-twilio-signature") ?? "", token))) return new Response("invalid signature", { status: 403 });

  const from = params.From ?? "";
  const channel = from.startsWith("whatsapp:") ? "whatsapp" : "sms";
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { error } = await db.rpc("dv_record_inbound", {
    p_channel: channel, p_from: from.replace(/^whatsapp:/, ""), p_name: params.ProfileName ?? "", p_body: params.Body ?? "", p_provider_id: params.MessageSid ?? null, p_to: (params.To ?? "").replace(/^whatsapp:/, ""),
  });
  if (error) return new Response("error", { status: 500 });   // Twilio retries; the provider id makes retries safe
  return xml();
});
