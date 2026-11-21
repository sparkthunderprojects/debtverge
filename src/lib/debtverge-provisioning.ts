import { useState, useCallback, useEffect } from "react";
import { supabase } from "./supabase";
import type {
  DebtVergeTenant,
  DebtVergePlanTier,
  DebtVergeBillingCycle,
  DebtVergeProvisioningStatus,
} from "./types";

// ============================================================
// Plan Tier Definitions
// ============================================================

export interface PlanTierMeta {
  id: DebtVergePlanTier;
  label: string;
  monthlyPrice: number;
  tagline: string;
  features: string[];
  maxCases: string;
  seats: number;
  highlight?: boolean;
}

export const PLAN_TIERS: PlanTierMeta[] = [
  {
    id: "starter",
    label: "Starter",
    monthlyPrice: 299,
    tagline: "For boutique DM firms getting started",
    maxCases: "Up to 100 active cases",
    seats: 2,
    features: [
      "Up to 100 active cases",
      "2 advisor seats included",
      "Core SFS intake & pro-rata tools",
      "Creditor ledger & offer pack generation",
      "Compliance audit log",
      "Email support",
    ],
  },
  {
    id: "professional",
    label: "Professional",
    monthlyPrice: 899,
    tagline: "For growing firms needing automation",
    maxCases: "Up to 1,000 active cases",
    seats: 10,
    highlight: true,
    features: [
      "Up to 1,000 active cases",
      "10 advisor seats included",
      "Open Banking transaction parsing",
      "Bacs payout disbursement engine",
      "Automated annual SFS review workflow",
      "Vulnerability & benefits checker",
      "Priority email & chat support",
    ],
  },
  {
    id: "enterprise",
    label: "Enterprise",
    monthlyPrice: 2499,
    tagline: "For high-volume firms with dedicated compliance",
    maxCases: "Unlimited cases",
    seats: 999,
    features: [
      "Unlimited active cases",
      "Dedicated compliance & audit tools",
      "Advanced RBAC & role isolation",
      "Multi-tenant workspace management",
      "Custom SFS rule engine",
      "Dedicated account manager",
      "24/7 priority phone support",
      "SLA & uptime guarantees",
    ],
  },
];

// ============================================================
// Add-On Pricing Constants
// ============================================================

export const ADDON_PRICING = {
  additionalSeatPerMonth: 45,
  openBankingCreditPackUnit: 0.5,
  openBankingCreditPackSize: 100,
  smsPackPerMonth: 25,
  vatRate: 0.2,
  annualDiscountRate: 0.15,
} as const;

// ============================================================
// Validation Helpers
// ============================================================

export function validateFcaFrn(frn: string): { valid: boolean; message: string | null } {
  const trimmed = frn.trim();
  if (!trimmed) return { valid: false, message: "FCA FRN is required" };
  if (!/^\d{6,7}$/.test(trimmed)) return { valid: false, message: "FRN must be 6-7 digits" };
  return { valid: true, message: null };
}

export function validateCorporateEmail(email: string): { valid: boolean; message: string | null } {
  const trimmed = email.trim().toLowerCase();
  if (!trimmed) return { valid: false, message: "Work email is required" };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return { valid: false, message: "Enter a valid email address" };
  const domain = trimmed.split("@")[1] ?? "";
  const freeProviders = ["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "live.com", "icloud.com", "aol.com"];
  if (freeProviders.includes(domain)) return { valid: false, message: "Please use a corporate/work email address" };
  return { valid: true, message: null };
}

export function validateUkMobile(mobile: string): { valid: boolean; message: string | null } {
  const trimmed = mobile.trim().replace(/\s/g, "");
  if (!trimmed) return { valid: false, message: "Mobile number is required" };
  const normalized = trimmed.replace(/^44/, "0").replace(/^\+44/, "0");
  if (!/^07\d{9}$/.test(normalized)) return { valid: false, message: "Enter a valid UK mobile (e.g. 07123 456789)" };
  return { valid: true, message: null };
}

export function validatePassword(password: string): { valid: boolean; message: string | null } {
  if (!password) return { valid: false, message: "Password is required" };
  if (password.length < 8) return { valid: false, message: "Password must be at least 8 characters" };
  if (!/[A-Z]/.test(password)) return { valid: false, message: "Include at least one uppercase letter" };
  if (!/[0-9]/.test(password)) return { valid: false, message: "Include at least one number" };
  return { valid: true, message: null };
}

export function slugifyCompanyName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

// ============================================================
// Pricing Calculator
// ============================================================

export interface PricingInput {
  planTier: DebtVergePlanTier;
  billingCycle: DebtVergeBillingCycle;
  additionalSeats: number;
  openBankingCredits: number;
  smsPackEnabled: boolean;
}

export interface PricingResult {
  basePrice: number;
  seatsCost: number;
  openBankingCost: number;
  smsCost: number;
  preDiscountTotal: number;
  annualDiscount: number;
  subtotal: number;
  vat: number;
  total: number;
  effectiveMonthly: number;
}

export function calculatePricing(input: PricingInput): PricingResult {
  const tier = PLAN_TIERS.find((t) => t.id === input.planTier);
  const basePrice = tier?.monthlyPrice ?? 299;
  const seatsCost = input.additionalSeats * ADDON_PRICING.additionalSeatPerMonth;
  const openBankingCost = input.openBankingCredits * ADDON_PRICING.openBankingCreditPackUnit;
  const smsCost = input.smsPackEnabled ? ADDON_PRICING.smsPackPerMonth : 0;
  const preDiscountTotal = basePrice + seatsCost + openBankingCost + smsCost;

  let annualDiscount = 0;
  let subtotal = preDiscountTotal;
  if (input.billingCycle === "annual") {
    annualDiscount = preDiscountTotal * ADDON_PRICING.annualDiscountRate;
    subtotal = preDiscountTotal - annualDiscount;
  }

  const vat = subtotal * ADDON_PRICING.vatRate;
  const total = subtotal + vat;
  const effectiveMonthly = input.billingCycle === "annual" ? subtotal / 12 : subtotal;

  return { basePrice, seatsCost, openBankingCost, smsCost, preDiscountTotal, annualDiscount, subtotal, vat, total, effectiveMonthly };
}

// ============================================================
// Tenant CRUD Hooks
// ============================================================

export interface TenantSignupInput {
  company_name: string;
  fca_frn: string;
  admin_first_name: string;
  admin_last_name: string;
  admin_email: string;
  admin_mobile: string;
  plan_tier: DebtVergePlanTier;
  billing_cycle: DebtVergeBillingCycle;
  base_price_gbp: number;
  additional_seats: number;
  open_banking_credits: number;
  sms_pack_enabled: boolean;
  subtotal_gbp: number;
  vat_gbp: number;
  total_gbp: number;
}

export async function createDebtVergeTenant(_input: TenantSignupInput): Promise<DebtVergeTenant> {
  // Tenant row is now created server-side by the provision-debtverge-tenant
  // edge function (service role bypasses RLS). This stub exists only to
  // preserve the type contract for the wizard — it returns a placeholder
  // that gets replaced by the real row after the edge function responds.
  throw new Error("createDebtVergeTenant is deprecated — use runProvisioningSequence with full context");
}

export async function updateTenantProvisioningStatus(
  tenantId: string,
  status: DebtVergeProvisioningStatus,
  extras?: Partial<DebtVergeTenant>,
): Promise<void> {
  const { error } = await supabase
    .from("debtverge_tenants")
    .update({ provisioning_status: status, updated_at: new Date().toISOString(), ...extras })
    .eq("id", tenantId);
  if (error) throw error;
}

export function useDebtVergeTenants() {
  const [data, setData] = useState<DebtVergeTenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data: rows, error: err } = await supabase
      .from("debtverge_tenants")
      .select("*")
      .order("created_at", { ascending: false });
    if (err) { setError(err.message); setLoading(false); return; }
    setData(rows as DebtVergeTenant[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  return { data, loading, error, reload: load };
}

// ============================================================
// Provisioning Simulation
// ============================================================

export interface ProvisioningStage {
  id: number;
  label: string;
  description: string;
  durationMs: number;
}

export const PROVISIONING_STAGES: ProvisioningStage[] = [
  { id: 1, label: "Creating organization & admin account", description: "Provisioning isolated tenant environment with RBAC", durationMs: 600 },
  { id: 2, label: "Initializing SFS engine & fee rules", description: "Loading Standard Financial Statement templates and FCA compliance rules", durationMs: 600 },
  { id: 3, label: "Generating administrator credentials", description: "Creating admin account with organization membership", durationMs: 600 },
  { id: 4, label: "Provisioning workspace complete", description: "Your DebtVerge tenant is ready to launch", durationMs: 400 },
];

export interface ProvisioningContext extends TenantSignupInput {
  adminPassword: string;
  packageSlug?: string;
}

export async function runProvisioningSequence(
  ctx: ProvisioningContext,
  onStageChange: (stageIndex: number) => void,
): Promise<DebtVergeTenant> {
  onStageChange(0);
  await new Promise((resolve) => setTimeout(resolve, PROVISIONING_STAGES[0].durationMs));

  onStageChange(1);
  await new Promise((resolve) => setTimeout(resolve, PROVISIONING_STAGES[1].durationMs));

  onStageChange(2);
  const { data, error } = await supabase.functions.invoke<{
    tenant: DebtVergeTenant;
    organizationId: string;
    authUserId: string;
  }>("provision-debtverge-tenant", {
    body: {
      company_name: ctx.company_name,
      fca_frn: ctx.fca_frn,
      admin_first_name: ctx.admin_first_name,
      admin_last_name: ctx.admin_last_name,
      admin_email: ctx.admin_email,
      admin_mobile: ctx.admin_mobile,
      plan_tier: ctx.plan_tier,
      billing_cycle: ctx.billing_cycle,
      base_price_gbp: ctx.base_price_gbp,
      additional_seats: ctx.additional_seats,
      open_banking_credits: ctx.open_banking_credits,
      sms_pack_enabled: ctx.sms_pack_enabled,
      subtotal_gbp: ctx.subtotal_gbp,
      vat_gbp: ctx.vat_gbp,
      total_gbp: ctx.total_gbp,
      admin_password: ctx.adminPassword,
      package_slug: ctx.packageSlug,
    },
  });

  if (error || !data?.tenant) {
    // Fallback: the edge function may have succeeded server-side even if the
    // client timed out or got a network error. Check the tenant table before
    // showing a failure — look up by company name + admin email.
    const { data: fallbackTenant } = await supabase
      .from("debtverge_tenants")
      .select("*")
      .eq("company_name", ctx.company_name)
      .ilike("admin_email", ctx.admin_email)
      .eq("provisioning_status", "complete")
      .maybeSingle();
    if (fallbackTenant) {
      return fallbackTenant as DebtVergeTenant;
    }
    const msg = error?.message || "No tenant returned from provisioning";
    throw new Error(`Provisioning failed: ${msg}`);
  }

  onStageChange(3);
  await new Promise((resolve) => setTimeout(resolve, PROVISIONING_STAGES[3].durationMs));

  onStageChange(PROVISIONING_STAGES.length);
  return data.tenant;
}


