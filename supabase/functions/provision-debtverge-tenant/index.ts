import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface TenantSignupInput {
  company_name: string;
  fca_frn: string;
  admin_first_name: string;
  admin_last_name: string;
  admin_email: string;
  admin_mobile: string;
  plan_tier: string;
  billing_cycle: string;
  base_price_gbp: number;
  additional_seats: number;
  open_banking_credits: number;
  sms_pack_enabled: boolean;
  subtotal_gbp: number;
  vat_gbp: number;
  total_gbp: number;
  admin_password: string;
  package_slug?: string;
}

const DEFAULT_PACKAGE_SLUG = "debt_management_suite";

// Map catalog item keys to RBAC modules so the admin role gets the right permissions
const CATALOG_KEY_TO_MODULE: Record<string, string> = {
  debtverge: "DEBTVERGE",
  ivaverge: "IVAVERGE",
  leadverge: "LEADVERGE",
  qualify: "QUALIFY",
  draftverge: "DRAFTVERGE",
  stormcall: "STORMCALL",
  stormsign: "SIGN",
  stormpay: "PAY",
  compliance: "COMPLIANCE",
  knowledge: "KNOWLEDGE",
};

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(JSON.stringify({ error: "Server configuration error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let input: TenantSignupInput;
  try {
    input = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const {
    company_name,
    fca_frn,
    admin_first_name,
    admin_last_name,
    admin_email,
    admin_mobile,
    plan_tier,
    billing_cycle,
    base_price_gbp,
    additional_seats,
    open_banking_credits,
    sms_pack_enabled,
    subtotal_gbp,
    vat_gbp,
    total_gbp,
    admin_password,
    package_slug,
  } = input;

  if (!company_name || !admin_email || !admin_password || !fca_frn) {
    return new Response(JSON.stringify({ error: "Missing required fields" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const slug = slugify(company_name);

  try {
    // Step 1: Insert the tenant record (service role bypasses RLS)
    const { data: tenant, error: tenantErr } = await admin
      .from("debtverge_tenants")
      .insert({
        company_name,
        fca_frn,
        admin_first_name,
        admin_last_name,
        admin_email: admin_email.toLowerCase(),
        admin_mobile,
        plan_tier,
        billing_cycle,
        base_price_gbp,
        additional_seats,
        open_banking_credits,
        sms_pack_enabled,
        subtotal_gbp,
        vat_gbp,
        total_gbp,
        tenant_slug: slug,
        workspace_url: `/debtverge?tenant=${slug}`,
        provisioning_status: "in_progress",
        subscription_status: "trial",
      })
      .select("*")
      .single();

    if (tenantErr) throw new Error(`Failed to create tenant record: ${tenantErr.message}`);

    const tenantId = tenant.id;

    // Step 2: Create the admin auth user
    // Use a targeted profiles table lookup instead of listUsers() which fetches
    // every user in the system and causes client-side timeouts at scale.
    let existingUser: { id: string } | null = null;
    const { data: profileMatch } = await admin
      .from("profiles")
      .select("id")
      .eq("email", admin_email.toLowerCase())
      .maybeSingle();
    if (profileMatch?.id) {
      const { data: userById, error: getUserErr } = await admin.auth.admin.getUserById(profileMatch.id);
      if (!getUserErr && userById?.user) {
        existingUser = { id: userById.user.id };
      }
    }

    let authUserId: string;

    if (existingUser) {
      authUserId = existingUser.id;
      await admin.auth.admin.updateUserById(authUserId, {
        password: admin_password,
        email_confirm: true,
      });
    } else {
      const { data: newUser, error: createErr } = await admin.auth.admin.createUser({
        email: admin_email.toLowerCase(),
        password: admin_password,
        email_confirm: true,
        user_metadata: {
          full_name: `${admin_first_name} ${admin_last_name}`.trim(),
          company_name,
          source: "debtverge_signup",
        },
      });

      if (createErr) throw new Error(`Failed to create admin user: ${createErr.message}`);
      authUserId = newUser.user.id;
    }

    // Step 3: Create the organization
    const { data: org, error: orgErr } = await admin
      .from("organizations")
      .insert({
        name: company_name,
        slug,
        owner_id: authUserId,
      })
      .select("id")
      .single();

    if (orgErr) throw new Error(`Failed to create organization: ${orgErr.message}`);

    // Step 4: Create an "Admin" role for this organization
    const { data: role, error: roleErr } = await admin
      .from("rbac_roles")
      .insert({
        organization_id: org.id,
        name: "Admin",
        is_custom: false,
      })
      .select("id")
      .single();

    if (roleErr) throw new Error(`Failed to create admin role: ${roleErr.message}`);

    // Step 5: Link the admin user to the organization with the Admin role
    const { error: linkErr } = await admin.from("organization_users").insert({
      user_id: authUserId,
      organization_id: org.id,
      role_id: role.id,
    });

    if (linkErr) throw new Error(`Failed to link admin to organization: ${linkErr.message}`);

    // Step 6: Update the tenant record with auth_user_id and mark complete
    const { error: updateErr } = await admin
      .from("debtverge_tenants")
      .update({
        auth_user_id: authUserId,
        provisioning_status: "complete",
        workspace_url: `/debtverge?org=${org.id}`,
        updated_at: new Date().toISOString(),
      })
      .eq("id", tenantId);

    if (updateErr) throw new Error(`Failed to update tenant record: ${updateErr.message}`);

    // Step 7: Set the admin's profile
    await admin.from("profiles").upsert({
      id: authUserId,
      email: admin_email.toLowerCase(),
      full_name: `${admin_first_name} ${admin_last_name}`.trim(),
      role: "admin",
      status: "ACTIVE",
    });

    // Step 8: Grant licences based on the selected package (or default)
    const pkgSlug = package_slug || DEFAULT_PACKAGE_SLUG;
    const { data: pkg } = await admin
      .from("packages")
      .select("id")
      .eq("slug", pkgSlug)
      .maybeSingle();

    if (pkg) {
      // Fetch all catalog items in this package
      const { data: pkgItems } = await admin
        .from("package_items")
        .select("catalog_item_id")
        .eq("package_id", pkg.id);

      if (pkgItems && pkgItems.length > 0) {
        // Grant a licence for each item
        const licenseRows = pkgItems.map((pi: { catalog_item_id: string }) => ({
          organization_id: org.id,
          catalog_item_id: pi.catalog_item_id,
          status: "active",
          licence_source: "package",
          package_id: pkg.id,
          licence_type: billing_cycle === "annual" ? "annual" : "monthly",
        }));
        await admin.from("organization_licenses").upsert(licenseRows, {
          onConflict: "organization_id, catalog_item_id",
        });

        // Give the Admin role view+edit+manage for each licensed module
        const catalogIds = pkgItems.map((pi: { catalog_item_id: string }) => pi.catalog_item_id);
        const { data: catalogRows } = await admin
          .from("catalog_items")
          .select("key")
          .in("id", catalogIds);

        const moduleKeys = (catalogRows ?? [])
          .map((c: { key: string }) => CATALOG_KEY_TO_MODULE[c.key])
          .filter(Boolean) as string[];

        if (moduleKeys.length > 0) {
          const { data: permRows } = await admin
            .from("rbac_permissions")
            .select("id")
            .in("module", moduleKeys)
            .in("action", ["view", "edit", "manage"]);

          if (permRows && permRows.length > 0) {
            const rolePermRows = permRows.map((p: { id: string }) => ({
              role_id: role.id,
              permission_id: p.id,
            }));
            await admin.from("rbac_role_permissions").upsert(rolePermRows, {
              onConflict: "role_id, permission_id",
            });
          }
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        tenant,
        organizationId: org.id,
        authUserId,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const errMsg = (err as Error).message;

    // Mark tenant as failed if it was created
    if (slug) {
      await admin
        .from("debtverge_tenants")
        .update({ provisioning_status: "failed", updated_at: new Date().toISOString() })
        .eq("tenant_slug", slug);
    }

    return new Response(
      JSON.stringify({ error: errMsg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
