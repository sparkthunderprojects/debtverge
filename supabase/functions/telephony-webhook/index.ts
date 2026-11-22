import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Twilio voice webhook for DebtVerge Phone. Every request is checked against X-Twilio-Signature (TWILIO_AUTH_TOKEN).
// Calls run as Twilio conferences (name dv-<call id>) so hold, transfer, extra participants and recording pause all work.
// Routes (query ?a=): voice (inbound number), agent (adviser leg status), join (adviser TwiML), dial (softphone TwiML app),
// customer (outbound customer TwiML), cust (outbound customer status), confend (conference status), recording, transcript.
const SID = Deno.env.get("TWILIO_ACCOUNT_SID") ?? "";
const TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";
const BASE = Deno.env.get("TELEPHONY_WEBHOOK_URL") ?? `${Deno.env.get("SUPABASE_URL")}/functions/v1/telephony-webhook`;
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const esc = (s: string) => s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c]!));
const twiml = (inner: string) => new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`, { headers: { "Content-Type": "text/xml" } });
const say = (t: string) => `<Say voice="alice" language="en-GB">${esc(t)}</Say>`;

async function validSignature(url: string, params: Record<string, string>, signature: string) {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(TOKEN), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const expected = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)))));
  if (expected.length !== signature.length) return false;
  let d = 0; for (let i = 0; i < expected.length; i++) d |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return d === 0;
}
async function tw(method: string, path: string, form?: [string, string][]) {
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/${path}`, {
    method, headers: { Authorization: "Basic " + btoa(`${SID}:${TOKEN}`), "Content-Type": "application/x-www-form-urlencoded" }, body: form ? new URLSearchParams(form) : undefined });
  if (!r.ok) throw new Error(`twilio ${r.status}`);
  return r.status === 204 ? {} : await r.json();
}
const ingest = (event: string, payload: Record<string, unknown>) => db.rpc("dv_call_ingest", { p_event: event, p_payload: payload });
const e164 = (n: string) => { const d = n.replace(/[^\d+]/g, ""); return d.startsWith("+") ? d : d.startsWith("00") ? "+" + d.slice(2) : d.startsWith("0") ? "+44" + d.slice(1) : "+" + d; };
const q = (u: URL, k: string) => u.searchParams.get(k) ?? "";

function conferenceNoun(name: string, record: boolean, start: boolean, endOnExit: boolean) {
  const rec = record ? ` record="record-from-start" recordingStatusCallback="${esc(`${BASE}?a=recording&c=${name}`)}" recordingStatusCallbackEvent="completed"` : "";
  return `<Dial><Conference beep="false" startConferenceOnEnter="${start}" endConferenceOnExit="${endOnExit}"${rec} statusCallback="${esc(`${BASE}?a=confend&c=${name}`)}" statusCallbackEvent="end">${esc(name)}</Conference></Dial>`;
}
async function sessionOf(conf: string) {
  const id = conf.replace(/^dv-/, "");
  if (!UUID.test(id)) return null;
  const { data } = await db.from("dv_call_sessions").select("id, organization_id, provider_call_id, status, phone, caller_name").eq("id", id).maybeSingle();
  return data;
}
async function ringAgent(conf: string, targets: string[], i: number, customerSid: string, fromNumber: string) {
  if (i >= targets.length) return false;
  const s = await sessionOf(conf);   // the browser is told who is calling through custom parameters on the client address
  const who = `client:${targets[i]}?c=${encodeURIComponent(conf.replace(/^dv-/, ""))}&f=${encodeURIComponent(s?.phone ?? "")}&n=${encodeURIComponent(s?.caller_name ?? "")}`;
  const form: [string, string][] = [["To", who], ["From", fromNumber], ["Url", `${BASE}?a=join&c=${conf}`],
    ["Timeout", "20"], ["StatusCallback", `${BASE}?a=agent&c=${conf}&i=${i}&p=${encodeURIComponent(customerSid)}&f=${encodeURIComponent(fromNumber)}`], ["StatusCallbackEvent", "answered"], ["StatusCallbackEvent", "completed"]];
  await tw("POST", "Calls.json", form);
  return true;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  if (!TOKEN || !SID) return new Response("not configured", { status: 503 });
  const u = new URL(req.url); const a = q(u, "a");
  let params: Record<string, string> = {};
  try { const form = await req.formData(); form.forEach((v, k) => { if (typeof v === "string") params[k] = v; }); } catch { return new Response("bad request", { status: 400 }); }
  if (!(await validSignature(BASE + u.search, params, req.headers.get("x-twilio-signature") ?? ""))) return new Response("invalid signature", { status: 403 });
  const p = params;

  try {
    if (a === "voice") {   // inbound call to a firm number
      const { data } = await ingest("incoming", { call_sid: p.CallSid, from: p.From, to: p.To, caller_name: p.CallerName });
      if (!data || data.status !== "ok") return twiml(say("Sorry, this number is not available.") + "<Hangup/>");
      const conf = `dv-${data.call_id}`;
      const targets: string[] = data.targets ?? [];
      if (!targets.length) { await ingest("status", { call_sid: p.CallSid, status: "no-answer" }); return twiml(say("Sorry, our advisers are all busy. Please call back later.") + "<Hangup/>"); }
      const notice = data.record ? say(String(data.notice ?? "")) : "";
      await ringAgent(conf, targets, 0, p.CallSid, p.To).catch(async () => { await ingest("status", { call_sid: p.CallSid, status: "failed" }); });
      return twiml(notice + conferenceNoun(conf, !!data.record, false, true));
    }
    if (a === "join") {   // adviser leg: join the conference
      const s = await sessionOf(q(u, "c"));
      const { data: st } = s ? await db.from("dv_telephony_settings").select("record_calls").eq("organization_id", s.organization_id).maybeSingle() : { data: null };
      return twiml(conferenceNoun(q(u, "c"), st?.record_calls ?? true, true, false));
    }
    if (a === "agent") {  // adviser leg status for an inbound call
      const conf = q(u, "c"), cust = q(u, "p"), i = Number(q(u, "i")) || 0, from = q(u, "f");
      if (p.CallStatus === "in-progress") {
        const who = (p.To ?? "").replace(/^client:/, "").split("?")[0];
        await ingest("answered", { call_sid: cust, answered_by: UUID.test(who) ? who : null });
      } else if (["no-answer", "busy", "failed", "canceled"].includes(p.CallStatus)) {
        const s = await sessionOf(conf);
        if (s && s.status === "ringing") {
          const { data } = await ingest("incoming", { call_sid: cust });
          const more = await ringAgent(conf, data?.targets ?? [], i + 1, cust, from).catch(() => false);
          if (!more) {
            await tw("POST", `Calls/${cust}.json`, [["Twiml", `<Response>${say("Sorry, we could not connect you. Please call back later.")}<Hangup/></Response>`]]).catch(() => {});
            await ingest("status", { call_sid: cust, status: "no-answer" });
          }
        }
      }
      return twiml("");
    }
    if (a === "dial") {   // outbound from the softphone (TwiML app voice URL)
      const { data } = await ingest("outbound_leg", { call_sid: p.CallSid, session_id: p.SessionId });
      if (!data || data.status !== "ok") return twiml(say("This call could not be placed.") + "<Hangup/>");
      const { data: num } = await db.from("org_phone_numbers").select("e164").eq("organization_id", data.organization_id).order("created_at").limit(1).maybeSingle();
      if (!num) { await ingest("status", { call_sid: p.CallSid, status: "failed" }); return twiml(say("Your firm has no outbound number set up.") + "<Hangup/>"); }
      const conf = `dv-${data.call_id}`;
      try {
        await tw("POST", "Calls.json", [["To", e164(String(data.phone))], ["From", num.e164], ["Url", `${BASE}?a=customer&c=${conf}`], ["Timeout", "40"],
          ["StatusCallback", `${BASE}?a=cust&p=${encodeURIComponent(p.CallSid)}`], ["StatusCallbackEvent", "answered"], ["StatusCallbackEvent", "completed"]]);
      } catch { await ingest("status", { call_sid: p.CallSid, status: "failed" }); return twiml(say("The call could not be connected.") + "<Hangup/>"); }
      return twiml(conferenceNoun(conf, !!data.record, true, false));
    }
    if (a === "customer") {   // outbound customer leg answered
      const conf = q(u, "c"); const s = await sessionOf(conf);
      const { data: st } = s ? await db.from("dv_telephony_settings").select("record_calls, recording_notice_text").eq("organization_id", s.organization_id).maybeSingle() : { data: null };
      const rec = st?.record_calls ?? true;
      return twiml((rec && st?.recording_notice_text ? say(st.recording_notice_text) : "") + conferenceNoun(conf, rec, false, true));
    }
    if (a === "cust") {   // outbound customer leg status
      const adv = q(u, "p");
      if (p.CallStatus === "in-progress") await ingest("answered", { call_sid: adv });
      else if (["completed", "no-answer", "busy", "failed", "canceled"].includes(p.CallStatus)) {
        await ingest("status", { call_sid: adv, status: p.CallStatus, duration: p.CallStatus === "completed" ? undefined : "0" });
        if (p.CallStatus !== "completed") await tw("POST", `Calls/${adv}.json`, [["Status", "completed"]]).catch(() => {});
      }
      return twiml("");
    }
    if (a === "confend") {
      if (p.StatusCallbackEvent === "conference-end") {
        const s = await sessionOf(q(u, "c"));
        if (s?.provider_call_id) await ingest("status", { call_sid: s.provider_call_id, status: "completed" });
      }
      return twiml("");
    }
    if (a === "recording") {
      const s = await sessionOf(q(u, "c"));
      if (!s?.provider_call_id) return twiml("");
      if (p.RecordingStatus !== "completed") { await ingest("recording", { call_sid: s.provider_call_id, status: "failed" }); return twiml(""); }
      const audio = await fetch(`${p.RecordingUrl}.mp3`, { headers: { Authorization: "Basic " + btoa(`${SID}:${TOKEN}`) } });
      if (!audio.ok) { await ingest("recording", { call_sid: s.provider_call_id, status: "failed" }); return twiml(""); }
      const path = `${s.organization_id}/${s.id}.mp3`;
      const up = await db.storage.from("call-recordings").upload(path, await audio.arrayBuffer(), { contentType: "audio/mpeg", upsert: true });
      if (up.error) { await ingest("recording", { call_sid: s.provider_call_id, status: "failed" }); return twiml(""); }
      const { data } = await ingest("recording", { call_sid: s.provider_call_id, ref: path });
      const intel = Deno.env.get("TWILIO_INTELLIGENCE_SERVICE_SID");
      if (data?.transcribe && intel) {   // Twilio Voice Intelligence reads the recording from Twilio, so it is kept for this case
        await fetch("https://intelligence.twilio.com/v2/Transcripts", { method: "POST", headers: { Authorization: "Basic " + btoa(`${SID}:${TOKEN}`), "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ ServiceSid: intel, CustomerKey: s.id, Channel: JSON.stringify({ media_properties: { source_sid: p.RecordingSid } }) }) }).catch(() => {});
      } else if (p.RecordingSid) {
        await tw("DELETE", `Recordings/${p.RecordingSid}.json`).catch(() => {});   // the only copy is now in the private bucket
      }
      return twiml("");
    }
    if (a === "transcript") {   // Twilio Voice Intelligence "transcript available" webhook (form encoded)
      const tsid = p.TranscriptSid ?? p.transcript_sid;
      if (!tsid || !/^GT[0-9a-f]{32}$/i.test(tsid)) return twiml("");
      const auth = { Authorization: "Basic " + btoa(`${SID}:${TOKEN}`) };
      const meta = await (await fetch(`https://intelligence.twilio.com/v2/Transcripts/${tsid}`, { headers: auth })).json();
      const sents = await (await fetch(`https://intelligence.twilio.com/v2/Transcripts/${tsid}/Sentences?PageSize=1000`, { headers: auth })).json();
      const s = await sessionOf(`dv-${meta.customer_key ?? ""}`);
      const text = (sents.sentences ?? []).map((x: { media_channel: number; transcript: string }) => `${x.media_channel === 1 ? "Customer" : "Adviser"}: ${x.transcript}`).join("\n");
      if (s?.provider_call_id && text) {
        const { data } = await ingest("transcript", { call_sid: s.provider_call_id, text, language: meta.language_code ?? "en-GB" });
        if (data?.analyse) await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/call-ai-analyse`, { method: "POST", headers: { Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`, "Content-Type": "application/json" }, body: JSON.stringify({ call_id: s.id }) }).catch(() => {});
        if (p.RecordingSid) await tw("DELETE", `Recordings/${p.RecordingSid}.json`).catch(() => {});
      }
      return twiml("");
    }
    return new Response("unknown route", { status: 404 });
  } catch (_e) {
    return new Response("error", { status: 500 });   // Twilio retries where it can; the handlers are idempotent
  }
});
