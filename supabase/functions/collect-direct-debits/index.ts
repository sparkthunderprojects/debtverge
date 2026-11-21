import { createClient } from "npm:@supabase/supabase-js@2";

// Collects the monthly plan payment by Direct Debit for active cases that are due and have an active mandate.
// Intended to run once a day from a scheduled task, or be called by an ops manager. Requires the service role key as bearer.
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (req.headers.get("Authorization") !== `Bearer ${serviceKey}`) return json({ error: "unauthorised" }, 401);
  const accessToken = Deno.env.get("GOCARDLESS_ACCESS_TOKEN");
  if (!accessToken) return json({ error: "not_configured" }, 503);
  const base = Deno.env.get("GOCARDLESS_ENV") === "live" ? "https://api.gocardless.com" : "https://api-sandbox.gocardless.com";
  const db = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

  const today = new Date().toISOString().slice(0, 10);
  const { data: cases } = await db.from("debt_cases").select("id, organization_id, installment_amount, next_due_date, case_number")
    .eq("status", "payment_schedule_active").lte("next_due_date", today).gt("installment_amount", 0);

  const results: { case: string; outcome: string }[] = [];
  for (const c of cases ?? []) {
    const { data: m } = await db.from("client_mandates").select("provider_mandate_id").eq("case_id", c.id).eq("status", "active").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!m) { results.push({ case: c.case_number, outcome: "no active mandate" }); continue; }
    // one collection per case per due date
    const { data: existing } = await db.from("payment_attempts").select("id").eq("case_id", c.id).eq("kind", "direct_debit_collection").gte("created_at", `${c.next_due_date}T00:00:00Z`).limit(1);
    if (existing && existing.length) { results.push({ case: c.case_number, outcome: "already requested" }); continue; }
    try {
      const res = await fetch(`${base}/payments`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "GoCardless-Version": "2015-07-06", "Content-Type": "application/json", "Idempotency-Key": `dd-${c.id}-${c.next_due_date}` },
        body: JSON.stringify({ payments: { amount: Math.round(Number(c.installment_amount) * 100), currency: "GBP", reference: c.case_number, links: { mandate: m.provider_mandate_id }, metadata: { case_id: c.id } } }),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out?.error?.message ?? `GoCardless ${res.status}`);
      await db.from("payment_attempts").insert({
        organization_id: c.organization_id, case_id: c.id, kind: "direct_debit_collection",
        provider_ref: out.payments.id, provider_payment_id: out.payments.id, amount: c.installment_amount,
      });
      results.push({ case: c.case_number, outcome: "requested" });
    } catch (e) {
      results.push({ case: c.case_number, outcome: `error: ${e instanceof Error ? e.message : "unknown"}` });
    }
  }
  return json({ processed: results.length, results });
});
