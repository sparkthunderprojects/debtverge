import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Sends queued rows from comms_outbox: email via Resend, SMS and WhatsApp via Twilio.
// The conversation timeline is kept in step by a database trigger, so this function only updates the outbox row.
// Auth: header x-comms-secret must equal COMMS_CRON_SECRET (called by the scheduler). No provider secret => rows stay queued.
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** E.164 for Twilio. UK numbers written 07... or 44... become +44... */
function toE164(raw: string) {
  const s = raw.replace(/[^\d+]/g, "");
  if (s.startsWith("+")) return s;
  if (s.startsWith("00")) return "+" + s.slice(2);
  if (s.startsWith("0")) return "+44" + s.slice(1);
  return "+" + s;
}

Deno.serve(async (req) => {
  const secret = Deno.env.get("COMMS_CRON_SECRET") ?? "";
  const given = req.headers.get("x-comms-secret") ?? "";
  if (!secret || !safeEqual(secret, given)) return json({ error: "unauthorised" }, 401);

  const resendKey = Deno.env.get("RESEND_API_KEY");
  const emailFrom = Deno.env.get("EMAIL_FROM");
  const twSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const twToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  const twFrom = Deno.env.get("TWILIO_FROM");
  const twWaFrom = Deno.env.get("TWILIO_WHATSAPP_FROM") ?? twFrom;
  const emailReady = !!(resendKey && emailFrom);
  const smsReady = !!(twSid && twToken && twFrom);
  const waReady = !!(twSid && twToken && twWaFrom);
  if (!emailReady && !smsReady && !waReady) return json({ sent: 0, note: "no provider configured; messages stay queued" });

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const channels = [emailReady ? "email" : null, smsReady ? "sms" : null, waReady ? "whatsapp" : null].filter(Boolean) as string[];
  const { data: rows, error } = await db.from("comms_outbox").select("*").eq("status", "queued").in("channel", channels).order("created_at").limit(50);
  if (error) return json({ error: error.message }, 500);

  let sent = 0, failed = 0;
  for (const m of rows ?? []) {
    // claim the row so a parallel run cannot send it twice
    const { data: claimed } = await db.from("comms_outbox").update({ attempts: m.attempts + 1 }).eq("id", m.id).eq("status", "queued").eq("attempts", m.attempts).select("id");
    if (!claimed?.length) continue;
    try {
      let providerId = "";
      if (m.channel === "email") {
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from: emailFrom, to: [m.to_address], subject: m.subject ?? "Message from your debt adviser", text: m.body }),
        });
        const b = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(b?.message ?? `email provider ${r.status}`);
        providerId = b.id ?? "";
      } else {
        const wa = m.channel === "whatsapp";
        const to = toE164(m.to_address);
        const from = toE164(wa ? twWaFrom! : twFrom!);
        const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twSid}/Messages.json`, {
          method: "POST",
          headers: { Authorization: "Basic " + btoa(`${twSid}:${twToken}`), "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ To: wa ? `whatsapp:${to}` : to, From: wa ? `whatsapp:${from}` : from, Body: m.body }),
        });
        const b = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(b?.message ?? `${m.channel} provider ${r.status}`);
        providerId = b.sid ?? "";
      }
      await db.from("comms_outbox").update({ status: "sent", sent_at: new Date().toISOString(), provider_id: providerId, error: null }).eq("id", m.id);
      sent++;
    } catch (e) {
      const final = m.attempts + 1 >= 5;
      await db.from("comms_outbox").update({ status: final ? "failed" : "queued", error: String((e as Error).message).slice(0, 300) }).eq("id", m.id);
      failed++;
    }
  }
  return json({ sent, failed });
});
