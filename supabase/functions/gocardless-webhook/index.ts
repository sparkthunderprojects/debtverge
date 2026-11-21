import { createClient } from "npm:@supabase/supabase-js@2";

// Receives GoCardless webhooks (signature verified), records payments and mandates.
const enc = new TextEncoder();

async function validSignature(raw: string, header: string | null, secret: string): Promise<boolean> {
  if (!header) return false;
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(raw)));
  const hex = Array.from(sig).map((b) => b.toString(16).padStart(2, "0")).join("");
  if (hex.length !== header.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ header.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const secret = Deno.env.get("GOCARDLESS_WEBHOOK_SECRET");
  const accessToken = Deno.env.get("GOCARDLESS_ACCESS_TOKEN");
  if (!secret || !accessToken) return new Response("not configured", { status: 503 });

  const raw = await req.text();
  if (!(await validSignature(raw, req.headers.get("Webhook-Signature"), secret))) {
    return new Response("invalid signature", { status: 498 });
  }
  const base = Deno.env.get("GOCARDLESS_ENV") === "live" ? "https://api.gocardless.com" : "https://api-sandbox.gocardless.com";
  const gcGet = async (path: string) => {
    const res = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${accessToken}`, "GoCardless-Version": "2015-07-06" } });
    if (!res.ok) throw new Error(`GoCardless ${res.status}`);
    return res.json();
  };
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const addMonth = (iso: string) => { const d = new Date(iso); d.setMonth(d.getMonth() + 1); return d.toISOString().slice(0, 10); };

  // Record a collected payment once, advance the plan and close the link.
  async function recordSuccess(attemptId: string) {
    const { data: a } = await db.from("payment_attempts").select("*").eq("id", attemptId).single();
    if (!a || a.recorded) return;
    // claim the row so a repeated webhook cannot double-record
    const { data: claimed } = await db.from("payment_attempts").update({ recorded: true, status: "succeeded", updated_at: new Date().toISOString() })
      .eq("id", attemptId).eq("recorded", false).select("id");
    if (!claimed || claimed.length === 0) return;
    const { data: c } = await db.from("debt_cases").select("installment_amount, next_due_date").eq("id", a.case_id).single();
    const today = new Date().toISOString().slice(0, 10);
    await db.from("debt_payments").insert({
      case_id: a.case_id, amount: a.amount, payment_date: today,
      expected_amount: c?.installment_amount ?? a.amount, is_shortfall: false, shortfall_amount: 0,
      reference: `GC-${a.provider_payment_id ?? a.provider_ref ?? a.id}`,
    });
    if (c?.next_due_date && c.next_due_date <= today) {
      await db.from("debt_cases").update({ next_due_date: addMonth(c.next_due_date) }).eq("id", a.case_id);
    }
    if (a.link_id) await db.from("payment_links").update({ status: "paid", paid_at: new Date().toISOString() }).eq("id", a.link_id);
    await db.from("debt_audit_log").insert({ case_id: a.case_id, milestone: "Payment received", description: `Payment of £${Number(a.amount).toFixed(2)} received via ${a.kind === "direct_debit_collection" ? "Direct Debit" : "pay by bank"}` });
  }

  const payload = JSON.parse(raw) as { events?: { resource_type: string; action: string; links?: Record<string, string>; details?: { cause?: string; description?: string } }[] };
  for (const ev of payload.events ?? []) {
    try {
      const l = ev.links ?? {};
      if (ev.resource_type === "billing_requests" && ev.action === "fulfilled" && l.billing_request) {
        const br = (await gcGet(`/billing_requests/${l.billing_request}`)).billing_requests;
        const paymentId: string | undefined = br.links?.payment_request_payment;
        const mandateId: string | undefined = br.links?.mandate_request_mandate;
        const { data: a } = await db.from("payment_attempts").select("*").eq("provider", "gocardless").eq("provider_ref", l.billing_request).maybeSingle();
        if (a && paymentId) await db.from("payment_attempts").update({ provider_payment_id: paymentId, updated_at: new Date().toISOString() }).eq("id", a.id);
        if (a && mandateId) {
          await db.from("client_mandates").upsert({ organization_id: a.organization_id, case_id: a.case_id, provider_mandate_id: mandateId, status: "pending" }, { onConflict: "provider,provider_mandate_id" });
          await db.from("payment_attempts").update({ status: "succeeded", updated_at: new Date().toISOString() }).eq("id", a.id);
        }
      } else if (ev.resource_type === "payments" && l.payment) {
        const { data: a } = await db.from("payment_attempts").select("*").eq("provider", "gocardless").eq("provider_payment_id", l.payment).maybeSingle();
        if (!a) continue;
        if (ev.action === "confirmed" || ev.action === "paid_out") await recordSuccess(a.id);
        if (ev.action === "failed" || ev.action === "cancelled") {
          await db.from("payment_attempts").update({ status: ev.action === "failed" ? "failed" : "cancelled", failure_reason: ev.details?.description ?? ev.details?.cause ?? null, updated_at: new Date().toISOString() }).eq("id", a.id).eq("recorded", false);
        }
      } else if (ev.resource_type === "mandates" && l.mandate) {
        const status = ({ active: "active", failed: "failed", cancelled: "cancelled", expired: "expired" } as Record<string, string>)[ev.action];
        if (status) await db.from("client_mandates").update({ status, updated_at: new Date().toISOString() }).eq("provider", "gocardless").eq("provider_mandate_id", l.mandate);
      }
    } catch (e) {
      console.error("gocardless-webhook event failed", ev.resource_type, ev.action, e);
      return new Response("retry", { status: 500 }); // GoCardless will redeliver
    }
  }
  return new Response("ok", { status: 200 });
});
