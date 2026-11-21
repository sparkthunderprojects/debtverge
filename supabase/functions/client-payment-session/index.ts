import { createClient } from "npm:@supabase/supabase-js@2";

// Public (no JWT): the client's payment link token is the credential.
// Creates a GoCardless billing request + hosted flow and returns the URL to send the client to.
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const accessToken = Deno.env.get("GOCARDLESS_ACCESS_TOKEN");
  if (!accessToken) return json({ error: "not_configured" }, 503);
  const base = Deno.env.get("GOCARDLESS_ENV") === "live" ? "https://api.gocardless.com" : "https://api-sandbox.gocardless.com";
  const appBase = (Deno.env.get("APP_BASE_URL") ?? "").replace(/\/$/, "");
  if (!appBase) return json({ error: "not_configured" }, 503);

  let body: { token?: string; mode?: "bank_pay" | "direct_debit" };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const token = body.token ?? "";
  const mode = body.mode === "direct_debit" ? "direct_debit" : "bank_pay";
  if (!/^[A-Za-z0-9]{20,128}$/.test(token)) return json({ error: "Invalid link" }, 400);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: link } = await db.from("payment_links").select("*").eq("token", token).maybeSingle();
  if (!link || link.status !== "active" || new Date(link.expires_at) < new Date()) {
    return json({ error: "This link is no longer active" }, 410);
  }
  const { data: c } = await db.from("debt_cases").select("case_number").eq("id", link.case_id).single();

  const gc = async (path: string, payload: unknown) => {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "GoCardless-Version": "2015-07-06", "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out?.error?.message ?? `GoCardless error ${res.status}`);
    return out;
  };

  try {
    const metadata = { link_id: link.id, case_id: link.case_id };
    const billingRequest: Record<string, unknown> = { metadata };
    if (mode === "bank_pay") {
      billingRequest.payment_request = {
        description: `Plan payment ${c?.case_number ?? ""}`.trim(),
        amount: Math.round(Number(link.amount) * 100),
        currency: "GBP",
      };
    } else {
      billingRequest.mandate_request = { scheme: "bacs" };
    }
    const br = await gc("/billing_requests", { billing_requests: billingRequest });
    const brId: string = br.billing_requests.id;

    const flow = await gc("/billing_request_flows", {
      billing_request_flows: {
        redirect_uri: `${appBase}/pay/${token}?done=${mode}`,
        exit_uri: `${appBase}/pay/${token}`,
        links: { billing_request: brId },
      },
    });

    await db.from("payment_attempts").insert({
      organization_id: link.organization_id, case_id: link.case_id, link_id: link.id,
      kind: mode === "bank_pay" ? "bank_pay" : "direct_debit_setup",
      provider_ref: brId, amount: mode === "bank_pay" ? link.amount : null,
    });
    return json({ url: flow.billing_request_flows.authorisation_url });
  } catch (e) {
    console.error("client-payment-session", e);
    return json({ error: "We couldn't start the payment. Please try again or contact your adviser." }, 502);
  }
});
