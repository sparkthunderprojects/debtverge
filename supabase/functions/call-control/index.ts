import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Live call control for the softphone. Order matters: the database call (permissions, state, audit trail) runs first as the signed-in user;
// the carrier action follows. Mute is handled in the browser by the Voice SDK.
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SID = Deno.env.get("TWILIO_ACCOUNT_SID") ?? "", TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";
const e164 = (n: string) => { const d = n.replace(/[^\d+]/g, ""); return d.startsWith("+") ? d : d.startsWith("00") ? "+" + d.slice(2) : d.startsWith("0") ? "+44" + d.slice(1) : "+" + d; };
const isNumber = (s: string) => /^\+?[\d ()-]{7,20}$/.test(s);

async function tw(method: string, path: string, form?: [string, string][]) {
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/${path}`, { method, headers: { Authorization: "Basic " + btoa(`${SID}:${TOKEN}`), "Content-Type": "application/x-www-form-urlencoded" }, body: form ? new URLSearchParams(form) : undefined });
  if (!r.ok) throw new Error(`carrier ${r.status}`);
  return r.status === 204 ? {} : await r.json();
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (!SID || !TOKEN) return json({ error: "Phone is not configured for this deployment yet." }, 503);
  const b = await req.json().catch(() => ({}));
  const call = String(b.call_id ?? ""), action = String(b.action ?? "");
  if (!UUID.test(call)) return json({ error: "Missing call." }, 400);
  const user = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const { data: u } = await user.auth.getUser();
  if (!u?.user) return json({ error: "Sign in first." }, 401);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const fail = (e: { message: string; code?: string } | null) => json({ error: e?.message ?? "Not allowed." }, e?.code === "42501" ? 403 : 400);

  // validate what the carrier needs before touching any state
  let target = "", targetUser: string | null = null;
  if (action === "transfer" || action === "participant_add") {
    targetUser = UUID.test(String(b.target_user ?? "")) ? String(b.target_user) : null;
    target = String(b.target ?? b.phone ?? "").trim();
    if (!targetUser && !isNumber(target)) return json({ error: "Choose a colleague or enter a phone number." }, 400);
  }

  let state; let pid = "";
  switch (action) {
    case "hold": case "resume": ({ error: state } = await user.rpc("dv_call_state", { p_call: call, p_event: action })); break;
    case "pause_recording": ({ error: state } = await user.rpc("dv_call_recording_event", { p_call: call, p_event: "paused", p_reason: b.reason ?? null })); break;
    case "resume_recording": ({ error: state } = await user.rpc("dv_call_recording_event", { p_call: call, p_event: "resumed" })); break;
    case "transfer": ({ error: state } = await user.rpc("dv_call_transfer", { p_call: call, p_kind: b.kind, p_target: target || null, p_target_user: targetUser })); break;
    case "participant_add": { const r = await user.rpc("dv_call_participant_add", { p_call: call, p_name: b.name ?? target, p_role: b.role ?? null, p_type: b.type, p_user: targetUser }); state = r.error; pid = String(r.data ?? ""); break; }
    case "participant_remove": ({ error: state } = await user.rpc("dv_call_participant_remove", { p_participant: b.participant_id })); break;
    default: return json({ error: "Unknown action." }, 400);
  }
  if (state) return fail(state);

  const { data: s } = await admin.from("dv_call_sessions").select("id, organization_id, direction").eq("id", call).maybeSingle();
  if (!s) return json({ error: "Call not found." }, 404);
  const conf = `dv-${call}`;
  try {
    const list = await tw("GET", `Conferences.json?FriendlyName=${conf}&Status=in-progress`);
    const cs = list.conferences?.[0]?.sid as string | undefined;
    if (!cs) return json({ error: "The call is not connected at the carrier." }, 409);
    const parts = (await tw("GET", `Conferences/${cs}/Participants.json`)).participants as { call_sid: string }[];
    // classify legs: browser legs have a client: address, the customer is the other one
    let customer = "", mine = "";
    for (const p of parts) {
      const c = await tw("GET", `Calls/${p.call_sid}.json`);
      const addrs = [String(c.from ?? ""), String(c.to ?? "")];
      if (addrs.some((a) => a === `client:${u.user.id}`)) mine = p.call_sid;
      else if (!addrs.some((a) => a.startsWith("client:")) && !customer) customer = p.call_sid;
    }
    if (action === "hold" || action === "resume") {
      if (customer) await tw("POST", `Conferences/${cs}/Participants/${customer}.json`, [["Hold", action === "hold" ? "true" : "false"]]);
    } else if (action === "pause_recording" || action === "resume_recording") {
      const recs = (await tw("GET", `Conferences/${cs}/Recordings.json`)).recordings as { sid: string; status: string }[];
      const active = recs.find((r) => r.status === (action === "pause_recording" ? "in-progress" : "paused"));
      if (active) await tw("POST", `Conferences/${cs}/Recordings/${active.sid}.json`, [["Status", action === "pause_recording" ? "paused" : "in-progress"]]);
      else return json({ error: "The carrier has no active recording to change." }, 409);
    } else if (action === "transfer" || action === "participant_add") {
      const { data: num } = await admin.from("org_phone_numbers").select("e164").eq("organization_id", s.organization_id).order("created_at").limit(1).maybeSingle();
      if (!num) return json({ error: "Your firm has no outbound number set up." }, 409);
      const label = action === "transfer" ? "transfer" : `p-${pid}`;
      const added = await tw("POST", `Conferences/${cs}/Participants.json`, [["From", num.e164], ["To", targetUser ? `client:${targetUser}` : e164(target)], ["Label", label], ["Timeout", "25"], ["EarlyMedia", "false"], ["EndConferenceOnExit", "false"]]);
      if (action === "transfer") {
        // wait for the other side to answer before reporting the transfer (and, for a cold transfer, before leaving)
        let ok = false;
        for (let i = 0; i < 14 && !ok; i++) {
          await sleep(2000);
          const st = (await tw("GET", `Calls/${added.call_sid}.json`)).status as string;
          if (st === "in-progress") ok = true; else if (["busy", "failed", "no-answer", "canceled", "completed"].includes(st)) break;
        }
        if (ok && b.kind !== "warm" && mine) await tw("POST", `Calls/${mine}.json`, [["Status", "completed"]]);
        const { error } = await user.rpc("dv_call_transfer_result", { p_call: call, p_status: ok ? "completed" : "failed" });
        if (error) return fail(error);
        if (!ok) { await tw("POST", `Calls/${added.call_sid}.json`, [["Status", "canceled"]]).catch(() => {}); return json({ error: "The transfer was not answered." }, 409); }
      }
    } else if (action === "participant_remove") {
      // best effort: removes the leg added with this participant's label
      await tw("DELETE", `Conferences/${cs}/Participants/p-${String(b.participant_id ?? "")}.json`).catch(() => {});
    }
  } catch {
    return json({ error: "The carrier did not accept that. The call record has been updated; check the call." }, 502);
  }
  return json({ ok: true });
});
