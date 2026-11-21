import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const url = new URL(req.url);
    const action = url.searchParams.get("action") ?? "";
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

    // ============================================================
    // Action: create — Build a disbursement run from approved waterfall entries
    // ============================================================
    if (action === "create") {
      const { organization_id, case_id, output_format = "bacs", waterfall_entry_ids } = body;
      if (!organization_id || !waterfall_entry_ids?.length) {
        return jsonResponse({ error: "organization_id and waterfall_entry_ids required" }, 400);
      }

      // Fetch the waterfall entries
      const { data: entries, error: entriesErr } = await supabase
        .from("disbursement_waterfall_entries")
        .select("*")
        .in("id", waterfall_entry_ids);

      if (entriesErr) throw new Error(entriesErr.message);
      if (!entries?.length) return jsonResponse({ error: "No waterfall entries found" }, 404);

      const totalAmount = entries.reduce((s: number, e: Record<string, unknown>) => s + Number(e.allocated_amount), 0);
      const runDate = new Date().toISOString().split("T")[0];
      const fileRef = `DISB-${runDate.replace(/-/g, "")}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

      // Create the disbursement run
      const { data: run, error: runErr } = await supabase
        .from("disbursement_runs")
        .insert({
          organization_id,
          case_id: case_id ?? null,
          run_date: runDate,
          status: "draft",
          output_format,
          file_reference: fileRef,
          total_amount: totalAmount,
          total_items: entries.length,
        })
        .select()
        .single();

      if (runErr) throw new Error(runErr.message);

      // Create run items from waterfall entries
      const items = entries.map((e: Record<string, unknown>) => ({
        disbursement_run_id: run.id,
        waterfall_entry_id: e.id,
        payee_name: e.payee_name,
        payee_reference: e.payee_reference ?? null,
        payee_account_number: e.payee_account_number ?? null,
        payee_sort_code: e.payee_sort_code ?? null,
        category: e.category,
        amount: Number(e.allocated_amount),
        status: "pending",
      }));

      const { error: itemsErr } = await supabase.from("disbursement_run_items").insert(items);
      if (itemsErr) throw new Error(itemsErr.message);

      // Log audit
      await supabase.from("cashier_audit_logs").insert({
        organization_id,
        case_id: case_id ?? null,
        action_type: "disbursement_settle",
        entity_type: "disbursement_runs",
        entity_id: run.id,
        new_value: { total_amount: totalAmount, total_items: entries.length, file_reference: fileRef },
        amount_impact: totalAmount,
        reason: `Disbursement run created: ${entries.length} items, ${totalAmount}`,
      });

      return jsonResponse(run);
    }

    // ============================================================
    // Action: generate — Generate BACS/payment instruction file content
    // ============================================================
    if (action === "generate") {
      const { run_id } = body;
      if (!run_id) return jsonResponse({ error: "run_id required" }, 400);

      const { data: run, error: runErr } = await supabase
        .from("disbursement_runs").select("*").eq("id", run_id).maybeSingle();
      if (runErr) throw new Error(runErr.message);
      if (!run) return jsonResponse({ error: "Run not found" }, 404);
      if (run.status !== "approved") return jsonResponse({ error: "Run must be approved first" }, 400);

      const { data: items, error: itemsErr } = await supabase
        .from("disbursement_run_items").select("*").eq("disbursement_run_id", run_id);

      if (itemsErr) throw new Error(itemsErr.message);

      // Generate file content based on format
      let fileContent = "";
      const format = run.output_format;

      if (format === "bacs") {
        // BACS standard format (simplified — header, detail records, footer)
        fileContent += `HDR1A${run.file_reference}${new Date().toISOString().slice(0, 10).replace(/-/g, "")}\n`;
        for (const item of items ?? []) {
          const sortCode = (item.payee_sort_code ?? "000000").replace(/-/g, "");
          const account = (item.payee_account_number ?? "00000000").padEnd(8, " ");
          const amountStr = String(Math.round(Number(item.amount) * 100)).padStart(11, "0");
          const ref = (item.payee_reference ?? item.id.slice(0, 18)).padEnd(18, " ");
          const name = (item.payee_name ?? "").substring(0, 18).padEnd(18, " ");
          fileContent += `HDR2${sortCode}${account}${amountStr}${name}${ref}\n`;
        }
        fileContent += `EOF1A${String(items?.length ?? 0).padStart(6, "0")}${String(Math.round(Number(run.total_amount) * 100)).padStart(11, "0")}\n`;
      } else if (format === "faster_payments") {
        // Faster Payments instruction format (JSON-based)
        fileContent = JSON.stringify({
          format: "faster_payments",
          file_reference: run.file_reference,
          run_date: run.run_date,
          total_amount: Number(run.total_amount),
          total_items: items?.length ?? 0,
          payments: (items ?? []).map((i: Record<string, unknown>) => ({
            payee_name: i.payee_name,
            sort_code: i.payee_sort_code,
            account_number: i.payee_account_number,
            amount: Number(i.amount),
            reference: i.payee_reference,
            category: i.category,
          })),
        }, null, 2);
      } else if (format === "manual_instruction") {
        // Human-readable instruction sheet
        fileContent = `DISBURSEMENT INSTRUCTION SHEET\n`;
        fileContent += `Run: ${run.file_reference}\n`;
        fileContent += `Date: ${run.run_date}\n`;
        fileContent += `Format: ${format}\n`;
        fileContent += `${"=".repeat(80)}\n\n`;
        for (const item of items ?? []) {
          fileContent += `Payee: ${item.payee_name}\n`;
          fileContent += `  Reference: ${item.payee_reference ?? "—"}\n`;
          fileContent += `  Account: ${item.payee_sort_code ?? "—"} / ${item.payee_account_number ?? "—"}\n`;
          fileContent += `  Amount: £${Number(item.amount).toFixed(2)}\n`;
          fileContent += `  Category: ${item.category}\n\n`;
        }
        fileContent += `${"=".repeat(80)}\n`;
        fileContent += `Total: £${Number(run.total_amount).toFixed(2)} (${items?.length ?? 0} payments)\n`;
      } else {
        fileContent = JSON.stringify({
          format,
          file_reference: run.file_reference,
          payments: (items ?? []).map((i: Record<string, unknown>) => ({
            payee: i.payee_name, amount: Number(i.amount), reference: i.payee_reference,
          })),
        }, null, 2);
      }

      // Update run items to "included" status
      await supabase.from("disbursement_run_items").update({ status: "included" }).eq("disbursement_run_id", run_id);

      // Update run status to generated
      await supabase.from("disbursement_runs").update({
        status: "generated",
        generated_at: new Date().toISOString(),
      }).eq("id", run_id);

      // Log audit
      await supabase.from("cashier_audit_logs").insert({
        organization_id: run.organization_id,
        case_id: run.case_id,
        action_type: "disbursement_settle",
        entity_type: "disbursement_runs",
        entity_id: run_id,
        new_value: { status: "generated", file_reference: run.file_reference, format },
        amount_impact: Number(run.total_amount),
        reason: `Disbursement file generated: ${format.toUpperCase()}`,
      });

      return jsonResponse({
        fileReference: run.file_reference,
        totalAmount: Number(run.total_amount),
        totalItems: items?.length ?? 0,
        fileContent,
      });
    }

    return jsonResponse({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

function jsonResponse(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
