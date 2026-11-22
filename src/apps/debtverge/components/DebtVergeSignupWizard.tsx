import { useState, useMemo, useEffect, useCallback } from "react";
import {
  Building2, User, Mail, Lock, Phone, Scale, Check, CheckCircle2, X,
  AlertCircle, CreditCard, Calendar, Shield, ShieldCheck, Sparkles,
  ArrowRight, ArrowLeft, Loader2, Rocket, Server, Key, Database,
  Users, MessageSquare, Banknote, Zap, Percent, Crown, ChevronRight,
  CircleDot, CreditCard as CardIcon, Wallet, BadgeCheck,
  Cpu, Network, Terminal,
} from "lucide-react";
import { useTheme } from "@/core/theme";
import { formatCurrency } from "@/core/format";
import {
  PLAN_TIERS, ADDON_PRICING, PROVISIONING_STAGES,
  validateFcaFrn, validateCorporateEmail, validateUkMobile, validatePassword,
  calculatePricing,
  runProvisioningSequence, type TenantSignupInput,
} from "@/apps/debtverge/lib/debtverge-provisioning";
import type { DebtVergePlanTier, DebtVergeBillingCycle, DebtVergeTenant } from "@/core/types";

type Step = 1 | 2 | 3 | 4 | 5;

const STEP_META: { id: Step; label: string; shortLabel: string; icon: React.ReactNode }[] = [
  { id: 1, label: "Company & Account", shortLabel: "Account", icon: <Building2 className="h-4 w-4" /> },
  { id: 2, label: "Plan & Tier", shortLabel: "Plan", icon: <Scale className="h-4 w-4" /> },
  { id: 3, label: "Add-Ons & Seats", shortLabel: "Add-Ons", icon: <Sparkles className="h-4 w-4" /> },
  { id: 4, label: "Checkout", shortLabel: "Checkout", icon: <CreditCard className="h-4 w-4" /> },
  { id: 5, label: "Provisioning", shortLabel: "Launch", icon: <Rocket className="h-4 w-4" /> },
];

interface Props {
  onComplete?: () => void;
}

export function DebtVergeSignupWizard({ onComplete }: Props) {
  const { theme } = useTheme();
  const [step, setStep] = useState<Step>(1);

  // Step 1 state
  const [companyName, setCompanyName] = useState("");
  const [fcaFrn, setFcaFrn] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [mobile, setMobile] = useState("");
  const [password, setPassword] = useState("");

  // Step 2 state
  const [planTier, setPlanTier] = useState<DebtVergePlanTier>("professional");
  const [billingCycle, setBillingCycle] = useState<DebtVergeBillingCycle>("monthly");

  // Step 3 state
  const [additionalSeats, setAdditionalSeats] = useState(0);
  const [openBankingCredits, setOpenBankingCredits] = useState(0);
  const [smsPackEnabled, setSmsPackEnabled] = useState(false);

  // Step 4 state
  const [cardName, setCardName] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [cardExpiry, setCardExpiry] = useState("");
  const [cardCvc, setCardCvc] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"card" | "direct_debit">("card");
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Step 5 state
  const [provisioningStage, setProvisioningStage] = useState(0);
  const [provisioningDone, setProvisioningDone] = useState(false);
  const [createdTenant, setCreatedTenant] = useState<DebtVergeTenant | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Validation state
  const frnCheck = useMemo(() => validateFcaFrn(fcaFrn), [fcaFrn]);
  const emailCheck = useMemo(() => validateCorporateEmail(email), [email]);
  const mobileCheck = useMemo(() => validateUkMobile(mobile), [mobile]);
  const passwordCheck = useMemo(() => validatePassword(password), [password]);

  const step1Valid = companyName.trim().length >= 2 && firstName.trim().length >= 1 && lastName.trim().length >= 1
    && frnCheck.valid && emailCheck.valid && mobileCheck.valid && passwordCheck.valid;

  const pricing = useMemo(
    () => calculatePricing({ planTier, billingCycle, additionalSeats, openBankingCredits, smsPackEnabled }),
    [planTier, billingCycle, additionalSeats, openBankingCredits, smsPackEnabled],
  );

  const selectedTier = PLAN_TIERS.find((t) => t.id === planTier)!;
  const dark = theme === "dark";

  const goNext = useCallback(() => setStep((s) => (s < 5 ? ((s + 1) as Step) : s)), []);
  const goBack = useCallback(() => setStep((s) => (s > 1 ? ((s - 1) as Step) : s)), []);

  // Format card number with spaces
  function formatCardNumber(value: string): string {
    const digits = value.replace(/\D/g, "").slice(0, 16);
    return digits.replace(/(.{4})/g, "$1 ").trim();
  }

  function formatExpiry(value: string): string {
    const digits = value.replace(/\D/g, "").slice(0, 4);
    if (digits.length >= 3) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
    return digits;
  }

  async function handleCheckoutSubmit() {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const tier = PLAN_TIERS.find((t) => t.id === planTier)!;
      const signupInput: TenantSignupInput = {
        company_name: companyName.trim(),
        fca_frn: fcaFrn.trim(),
        admin_first_name: firstName.trim(),
        admin_last_name: lastName.trim(),
        admin_email: email.trim().toLowerCase(),
        admin_mobile: mobile.trim(),
        plan_tier: planTier,
        billing_cycle: billingCycle,
        base_price_gbp: tier.monthlyPrice,
        additional_seats: additionalSeats,
        open_banking_credits: openBankingCredits,
        sms_pack_enabled: smsPackEnabled,
        subtotal_gbp: pricing.subtotal,
        vat_gbp: pricing.vat,
        total_gbp: pricing.total,
      };

      setStep(5);

      runProvisioningSequence(
        {
          ...signupInput,
          adminPassword: password,
          packageSlug:
            signupInput.plan_tier === "enterprise" ? "full_debt_iva_suite"
            : signupInput.plan_tier === "professional" ? "iva_suite"
            : "debt_management_suite",
        },
        (stage) => setProvisioningStage(stage),
      )
        .then((tenant) => {
          setCreatedTenant(tenant);
          setProvisioningDone(true);
        })
        .catch((e) => setSubmitError((e as Error).message));
    } catch (e) {
      setSubmitError((e as Error).message);
      setSubmitting(false);
    }
  }

  function handleLaunch() {
    if (onComplete) {
      onComplete();
    } else {
      window.location.href = createdTenant?.workspace_url ?? "/debtverge";
    }
  }

  return (
    <div className={`min-h-screen w-full ${dark ? "bg-slate-950" : "bg-slate-50"}`}>
      {/* Top Bar */}
      <div className={`sticky top-0 z-40 border-b backdrop-blur-md ${dark ? "border-slate-800 bg-slate-900/90" : "border-slate-200 bg-white/90"}`}>
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-slate-700 to-slate-900 text-white shadow-lg">
              <Scale className="h-5 w-5" />
            </div>
            <div>
              <span className={`text-sm font-bold ${dark ? "text-slate-100" : "text-slate-900"}`}>Debt Verge</span>
              <span className={`ml-2 text-xs ${dark ? "text-slate-400" : "text-slate-500"}`}>Self-Service Sign-Up</span>
            </div>
          </div>
          <div className={`text-xs ${dark ? "text-slate-400" : "text-slate-500"}`}>
            Step {step} of 5
          </div>
        </div>
      </div>

      {/* Progress Bar */}
      <div className={`mx-auto max-w-6xl px-4 pt-6 sm:px-6`}>
        <div className="flex items-center justify-between">
          {STEP_META.map((s, i) => (
            <div key={s.id} className="flex flex-1 items-center last:flex-none">
              <div className="flex flex-col items-center gap-1.5">
                <div
                  className={`flex h-9 w-9 items-center justify-center rounded-full border-2 transition-all duration-300 ${
                    step > s.id
                      ? "border-emerald-500 bg-emerald-500 text-white"
                      : step === s.id
                        ? "border-blue-500 bg-blue-500 text-white shadow-lg shadow-blue-500/30 scale-110"
                        : dark
                          ? "border-slate-700 bg-slate-800 text-slate-500"
                          : "border-slate-200 bg-white text-slate-400"
                  }`}
                >
                  {step > s.id ? <Check className="h-4 w-4" /> : s.icon}
                </div>
                <span className={`hidden text-[10px] font-medium sm:block ${
                  step >= s.id ? (dark ? "text-slate-200" : "text-slate-700") : (dark ? "text-slate-500" : "text-slate-400")
                }`}>{s.shortLabel}</span>
              </div>
              {i < STEP_META.length - 1 && (
                <div className={`mx-1 h-0.5 flex-1 rounded-full transition-all duration-500 sm:mx-2 ${
                  step > s.id ? "bg-emerald-500" : dark ? "bg-slate-700" : "bg-slate-200"
                }`} />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Main Content */}
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {submitError && step !== 5 && (
          <div className={`mb-4 flex items-center gap-2 rounded-xl px-4 py-3 text-sm ${
            dark ? "bg-rose-500/10 text-rose-300" : "bg-rose-50 text-rose-700"
          }`}>
            <AlertCircle className="h-4 w-4 shrink-0" /> {submitError}
          </div>
        )}

        <div className={`grid gap-6 ${step >= 2 && step <= 4 ? "lg:grid-cols-[1fr_340px]" : ""}`}>
          {/* Step Content */}
          <div className="min-w-0">
            {step === 1 && (
              <Step1CompanyAccount
                dark={dark}
                companyName={companyName} setCompanyName={setCompanyName}
                fcaFrn={fcaFrn} setFcaFrn={setFcaFrn} frnCheck={frnCheck}
                firstName={firstName} setFirstName={setFirstName}
                lastName={lastName} setLastName={setLastName}
                email={email} setEmail={setEmail} emailCheck={emailCheck}
                mobile={mobile} setMobile={setMobile} mobileCheck={mobileCheck}
                password={password} setPassword={setPassword} passwordCheck={passwordCheck}
              />
            )}
            {step === 2 && (
              <Step2PlanTier
                dark={dark}
                planTier={planTier} setPlanTier={setPlanTier}
                billingCycle={billingCycle} setBillingCycle={setBillingCycle}
                pricing={pricing}
              />
            )}
            {step === 3 && (
              <Step3AddOns
                dark={dark}
                additionalSeats={additionalSeats} setAdditionalSeats={setAdditionalSeats}
                openBankingCredits={openBankingCredits} setOpenBankingCredits={setOpenBankingCredits}
                smsPackEnabled={smsPackEnabled} setSmsPackEnabled={setSmsPackEnabled}
                pricing={pricing}
              />
            )}
            {step === 4 && (
              <Step4Checkout
                dark={dark}
                pricing={pricing}
                paymentMethod={paymentMethod} setPaymentMethod={setPaymentMethod}
                cardName={cardName} setCardName={setCardName}
                cardNumber={cardNumber} setCardNumber={(v) => setCardNumber(formatCardNumber(v))}
                cardExpiry={cardExpiry} setCardExpiry={(v) => setCardExpiry(formatExpiry(v))}
                cardCvc={cardCvc} setCardCvc={(v) => setCardCvc(v.replace(/\D/g, "").slice(0, 4))}
                submitting={submitting}
              />
            )}
            {step === 5 && (
              <Step5Provisioning
                dark={dark}
                companyName={companyName}
                provisioningStage={provisioningStage}
                provisioningDone={provisioningDone}
                createdTenant={createdTenant}
                onLaunch={handleLaunch}
                submitError={submitError}
              />
            )}
          </div>

          {/* Order Summary Sidebar (steps 2-4) */}
          {step >= 2 && step <= 4 && (
            <OrderSummarySidebar
              dark={dark}
              planTier={planTier}
              billingCycle={billingCycle}
              additionalSeats={additionalSeats}
              openBankingCredits={openBankingCredits}
              smsPackEnabled={smsPackEnabled}
              pricing={pricing}
            />
          )}
        </div>

        {/* Navigation Buttons */}
        {step < 5 && (
          <div className="mt-6 flex items-center justify-between gap-3">
            <button
              onClick={goBack}
              disabled={step === 1}
              className={`btn btn-secondary text-sm disabled:opacity-40 ${step === 1 ? "pointer-events-none" : ""}`}
            >
              <ArrowLeft className="h-4 w-4" /> Back
            </button>
            {step === 4 ? (
              <button
                onClick={handleCheckoutSubmit}
                disabled={submitting}
                className="btn btn-primary bg-emerald-600 text-sm hover:bg-emerald-700"
              >
                {submitting ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Processing Payment...</>
                ) : (
                  <><ShieldCheck className="h-4 w-4" /> Subscribe & Provision — {formatCurrency(pricing.total, "GBP")}</>
                )}
              </button>
            ) : (
              <button
                onClick={goNext}
                disabled={step === 1 && !step1Valid}
                className="btn btn-primary text-sm disabled:opacity-40"
              >
                Continue <ArrowRight className="h-4 w-4" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Step 1: Company & Account Details
// ============================================================

interface Step1Props {
  dark: boolean;
  companyName: string; setCompanyName: (v: string) => void;
  fcaFrn: string; setFcaFrn: (v: string) => void; frnCheck: { valid: boolean; message: string | null };
  firstName: string; setFirstName: (v: string) => void;
  lastName: string; setLastName: (v: string) => void;
  email: string; setEmail: (v: string) => void; emailCheck: { valid: boolean; message: string | null };
  mobile: string; setMobile: (v: string) => void; mobileCheck: { valid: boolean; message: string | null };
  password: string; setPassword: (v: string) => void; passwordCheck: { valid: boolean; message: string | null };
}

function Step1CompanyAccount(props: Step1Props) {
  const { dark } = props;
  return (
    <div className={`panel p-6 fade-in ${dark ? "bg-slate-900 border-slate-800" : ""}`}>
      <div className="mb-5">
        <h2 className={`text-lg font-bold ${dark ? "text-slate-100" : "text-slate-900"}`}>Company & Administrator Details</h2>
        <p className={`mt-1 text-sm ${dark ? "text-slate-400" : "text-slate-500"}`}>Tell us about your debt management firm. We'll use this to configure your isolated tenant workspace.</p>
      </div>

      <div className="space-y-4">
        {/* Company Name */}
        <div>
          <label className={`label ${dark ? "text-slate-300" : ""}`}>Company Name</label>
          <div className="relative mt-1">
            <Building2 className={`pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 ${dark ? "text-slate-500" : "text-slate-400"}`} />
            <input
              value={props.companyName}
              onChange={(e) => props.setCompanyName(e.target.value)}
              placeholder="e.g. Apex Debt Solutions Ltd"
              className={`input pl-10 ${dark ? "bg-slate-800 border-slate-700 text-slate-100" : ""}`}
            />
          </div>
        </div>

        {/* FCA FRN */}
        <div>
          <label className={`label ${dark ? "text-slate-300" : ""}`}>FCA Firm Reference Number (FRN)</label>
          <div className="relative mt-1">
            <BadgeCheck className={`pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 ${props.fcaFrn ? (props.frnCheck.valid ? "text-emerald-500" : "text-rose-500") : (dark ? "text-slate-500" : "text-slate-400")}`} />
            <input
              value={props.fcaFrn}
              onChange={(e) => props.setFcaFrn(e.target.value.replace(/[^\d]/g, "").slice(0, 7))}
              placeholder="e.g. 648753"
              inputMode="numeric"
              className={`input pl-10 ${dark ? "bg-slate-800 border-slate-700 text-slate-100" : ""} ${
                props.fcaFrn && !props.frnCheck.valid ? "border-rose-400 dark:border-rose-500" : ""
              } ${props.fcaFrn && props.frnCheck.valid ? "border-emerald-400 dark:border-emerald-500" : ""}`}
            />
          </div>
          {props.fcaFrn && props.frnCheck.message && (
            <p className="mt-1 flex items-center gap-1 text-xs text-rose-500"><AlertCircle className="h-3 w-3" /> {props.frnCheck.message}</p>
          )}
          {props.fcaFrn && props.frnCheck.valid && (
            <p className="mt-1 flex items-center gap-1 text-xs text-emerald-600"><CheckCircle2 className="h-3 w-3" /> Valid FRN format</p>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {/* First Name */}
          <div>
            <label className={`label ${dark ? "text-slate-300" : ""}`}>Admin First Name</label>
            <div className="relative mt-1">
              <User className={`pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 ${dark ? "text-slate-500" : "text-slate-400"}`} />
              <input value={props.firstName} onChange={(e) => props.setFirstName(e.target.value)} placeholder="Jane" className={`input pl-10 ${dark ? "bg-slate-800 border-slate-700 text-slate-100" : ""}`} />
            </div>
          </div>
          {/* Last Name */}
          <div>
            <label className={`label ${dark ? "text-slate-300" : ""}`}>Admin Last Name</label>
            <div className="relative mt-1">
              <User className={`pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 ${dark ? "text-slate-500" : "text-slate-400"}`} />
              <input value={props.lastName} onChange={(e) => props.setLastName(e.target.value)} placeholder="Smith" className={`input pl-10 ${dark ? "bg-slate-800 border-slate-700 text-slate-100" : ""}`} />
            </div>
          </div>
        </div>

        {/* Work Email */}
        <div>
          <label className={`label ${dark ? "text-slate-300" : ""}`}>Work Email Address</label>
          <div className="relative mt-1">
            <Mail className={`pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 ${props.email ? (props.emailCheck.valid ? "text-emerald-500" : "text-rose-500") : (dark ? "text-slate-500" : "text-slate-400")}`} />
            <input
              value={props.email}
              onChange={(e) => props.setEmail(e.target.value)}
              placeholder="jane@apexdebtsolutions.co.uk"
              type="email"
              className={`input pl-10 ${dark ? "bg-slate-800 border-slate-700 text-slate-100" : ""} ${
                props.email && !props.emailCheck.valid ? "border-rose-400 dark:border-rose-500" : ""
              } ${props.email && props.emailCheck.valid ? "border-emerald-400 dark:border-emerald-500" : ""}`}
            />
          </div>
          {props.email && props.emailCheck.message && (
            <p className="mt-1 flex items-center gap-1 text-xs text-rose-500"><AlertCircle className="h-3 w-3" /> {props.emailCheck.message}</p>
          )}
          {props.email && props.emailCheck.valid && (
            <p className="mt-1 flex items-center gap-1 text-xs text-emerald-600"><CheckCircle2 className="h-3 w-3" /> Corporate email verified</p>
          )}
        </div>

        {/* Mobile */}
        <div>
          <label className={`label ${dark ? "text-slate-300" : ""}`}>Mobile Number</label>
          <div className="relative mt-1">
            <Phone className={`pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 ${props.mobile ? (props.mobileCheck.valid ? "text-emerald-500" : "text-rose-500") : (dark ? "text-slate-500" : "text-slate-400")}`} />
            <input
              value={props.mobile}
              onChange={(e) => props.setMobile(e.target.value)}
              placeholder="07123 456789"
              inputMode="tel"
              className={`input pl-10 ${dark ? "bg-slate-800 border-slate-700 text-slate-100" : ""} ${
                props.mobile && !props.mobileCheck.valid ? "border-rose-400 dark:border-rose-500" : ""
              } ${props.mobile && props.mobileCheck.valid ? "border-emerald-400 dark:border-emerald-500" : ""}`}
            />
          </div>
          {props.mobile && props.mobileCheck.message && (
            <p className="mt-1 flex items-center gap-1 text-xs text-rose-500"><AlertCircle className="h-3 w-3" /> {props.mobileCheck.message}</p>
          )}
        </div>

        {/* Password */}
        <div>
          <label className={`label ${dark ? "text-slate-300" : ""}`}>Create Password</label>
          <div className="relative mt-1">
            <Lock className={`pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 ${props.password ? (props.passwordCheck.valid ? "text-emerald-500" : "text-amber-500") : (dark ? "text-slate-500" : "text-slate-400")}`} />
            <input
              value={props.password}
              onChange={(e) => props.setPassword(e.target.value)}
              placeholder="Min. 8 characters, 1 uppercase, 1 number"
              type="password"
              className={`input pl-10 ${dark ? "bg-slate-800 border-slate-700 text-slate-100" : ""} ${
                props.password && !props.passwordCheck.valid ? "border-amber-400 dark:border-amber-500" : ""
              } ${props.password && props.passwordCheck.valid ? "border-emerald-400 dark:border-emerald-500" : ""}`}
            />
          </div>
          {props.password && props.passwordCheck.message && (
            <p className="mt-1 flex items-center gap-1 text-xs text-amber-500"><AlertCircle className="h-3 w-3" /> {props.passwordCheck.message}</p>
          )}
          {props.password && props.passwordCheck.valid && (
            <p className="mt-1 flex items-center gap-1 text-xs text-emerald-600"><CheckCircle2 className="h-3 w-3" /> Strong password</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Step 2: Plan & Tier Selection
// ============================================================

interface Step2Props {
  dark: boolean;
  planTier: DebtVergePlanTier; setPlanTier: (v: DebtVergePlanTier) => void;
  billingCycle: DebtVergeBillingCycle; setBillingCycle: (v: DebtVergeBillingCycle) => void;
  pricing: { effectiveMonthly: number; annualDiscount: number };
}

function Step2PlanTier({ dark, planTier, setPlanTier, billingCycle, setBillingCycle, pricing }: Step2Props) {
  return (
    <div className="fade-in space-y-5">
      <div className={`panel p-6 ${dark ? "bg-slate-900 border-slate-800" : ""}`}>
        <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className={`text-lg font-bold ${dark ? "text-slate-100" : "text-slate-900"}`}>Choose Your Plan</h2>
            <p className={`mt-1 text-sm ${dark ? "text-slate-400" : "text-slate-500"}`}>Select the tier that matches your firm's case volume and team size.</p>
          </div>
          {/* Billing Cycle Toggle */}
          <div className={`flex items-center gap-1 rounded-xl border p-1 ${dark ? "border-slate-700 bg-slate-800" : "border-slate-200 bg-slate-100"}`}>
            <button
              onClick={() => setBillingCycle("monthly")}
              className={`rounded-lg px-4 py-2 text-xs font-medium transition-all ${
                billingCycle === "monthly"
                  ? "bg-blue-600 text-white shadow-sm"
                  : dark ? "text-slate-400 hover:text-slate-200" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setBillingCycle("annual")}
              className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-medium transition-all ${
                billingCycle === "annual"
                  ? "bg-blue-600 text-white shadow-sm"
                  : dark ? "text-slate-400 hover:text-slate-200" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              Annual <span className="rounded-full bg-emerald-500 px-1.5 py-0.5 text-[9px] font-bold text-white">-15%</span>
            </button>
          </div>
        </div>
      </div>

      {/* Tier Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        {PLAN_TIERS.map((tier) => {
          const isSelected = planTier === tier.id;
          const displayPrice = billingCycle === "annual"
            ? tier.monthlyPrice * 12 * (1 - ADDON_PRICING.annualDiscountRate)
            : tier.monthlyPrice;
          return (
            <button
              key={tier.id}
              onClick={() => setPlanTier(tier.id)}
              className={`group relative flex flex-col rounded-2xl border-2 p-5 text-left transition-all duration-300 ${
                isSelected
                  ? "border-blue-500 bg-blue-50 shadow-lg shadow-blue-500/10 dark:border-blue-400 dark:bg-blue-500/5"
                  : dark
                    ? "border-slate-800 bg-slate-900 hover:border-slate-600"
                    : "border-slate-200 bg-white hover:border-slate-300"
              } ${tier.highlight && !isSelected ? "ring-1 ring-blue-200 dark:ring-blue-500/20" : ""}`}
            >
              {tier.highlight && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-blue-600 px-3 py-1 text-[10px] font-bold text-white shadow-md">
                  MOST POPULAR
                </span>
              )}
              {isSelected && (
                <span className="absolute right-4 top-4 flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-white">
                  <Check className="h-3.5 w-3.5" />
                </span>
              )}
              <div className="mb-3">
                <h3 className={`text-base font-bold ${dark ? "text-slate-100" : "text-slate-900"}`}>{tier.label}</h3>
                <p className={`text-xs ${dark ? "text-slate-400" : "text-slate-500"}`}>{tier.tagline}</p>
              </div>
              <div className="mb-4">
                <div className="flex items-baseline gap-1">
                  <span className={`text-2xl font-bold ${dark ? "text-slate-100" : "text-slate-900"}`}>{formatCurrency(displayPrice, "GBP")}</span>
                  <span className={`text-xs ${dark ? "text-slate-400" : "text-slate-500"}`}>{billingCycle === "annual" ? "/yr" : "/mo"}</span>
                </div>
                {billingCycle === "annual" && (
                  <p className="mt-0.5 text-[10px] text-emerald-600 dark:text-emerald-400">
                    {formatCurrency(tier.monthlyPrice * 12 - displayPrice, "GBP")} saved per year
                  </p>
                )}
              </div>
              <div className={`mb-3 rounded-lg px-3 py-2 text-xs font-medium ${dark ? "bg-slate-800 text-slate-300" : "bg-slate-50 text-slate-600"}`}>
                {tier.maxCases}
              </div>
              <ul className="space-y-2">
                {tier.features.map((f) => (
                  <li key={f} className={`flex items-start gap-2 text-xs ${dark ? "text-slate-300" : "text-slate-600"}`}>
                    <CheckCircle2 className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${isSelected ? "text-blue-500" : "text-emerald-500"}`} />
                    {f}
                  </li>
                ))}
              </ul>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// Step 3: Add-Ons & Seat Calculator
// ============================================================

interface Step3Props {
  dark: boolean;
  additionalSeats: number; setAdditionalSeats: (v: number) => void;
  openBankingCredits: number; setOpenBankingCredits: (v: number) => void;
  smsPackEnabled: boolean; setSmsPackEnabled: (v: boolean) => void;
  pricing: { seatsCost: number; openBankingCost: number; smsCost: number };
}

function Step3AddOns(props: Step3Props) {
  const { dark, additionalSeats, setAdditionalSeats, openBankingCredits, setOpenBankingCredits, smsPackEnabled, setSmsPackEnabled, pricing } = props;
  return (
    <div className="fade-in space-y-4">
      <div className={`panel p-6 ${dark ? "bg-slate-900 border-slate-800" : ""}`}>
        <h2 className={`text-lg font-bold ${dark ? "text-slate-100" : "text-slate-900"}`}>Add-Ons & Seat Calculator</h2>
        <p className={`mt-1 text-sm ${dark ? "text-slate-400" : "text-slate-500"}`}>Customize your subscription with additional usage capabilities. All add-ons are billed alongside your plan.</p>
      </div>

      {/* Additional Advisor Seats */}
      <div className={`panel p-5 ${dark ? "bg-slate-900 border-slate-800" : ""}`}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${dark ? "bg-blue-500/10" : "bg-blue-50"}`}>
              <Users className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h3 className={`text-sm font-bold ${dark ? "text-slate-100" : "text-slate-900"}`}>Additional Advisor Seats</h3>
              <p className={`text-xs ${dark ? "text-slate-400" : "text-slate-500"}`}>+{formatCurrency(ADDON_PRICING.additionalSeatPerMonth, "GBP")}/seat/month</p>
            </div>
          </div>
          <div className={`text-right ${dark ? "text-slate-100" : "text-slate-900"}`}>
            <span className="text-lg font-bold">{additionalSeats}</span>
            <span className={`ml-1 text-xs ${dark ? "text-slate-400" : "text-slate-500"}`}>seats</span>
            {additionalSeats > 0 && (
              <p className="text-xs text-blue-600 dark:text-blue-400">+{formatCurrency(pricing.seatsCost, "GBP")}/mo</p>
            )}
          </div>
        </div>
        <div className="mt-4">
          <input
            type="range"
            min={0}
            max={50}
            value={additionalSeats}
            onChange={(e) => setAdditionalSeats(parseInt(e.target.value))}
            className="w-full accent-blue-600"
          />
          <div className={`mt-1 flex justify-between text-[10px] ${dark ? "text-slate-500" : "text-slate-400"}`}>
            <span>0 seats</span><span>25 seats</span><span>50 seats</span>
          </div>
        </div>
      </div>

      {/* Open Banking API Fetch Credits */}
      <div className={`panel p-5 ${dark ? "bg-slate-900 border-slate-800" : ""}`}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${dark ? "bg-indigo-500/10" : "bg-indigo-50"}`}>
              <Network className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
            </div>
            <div>
              <h3 className={`text-sm font-bold ${dark ? "text-slate-100" : "text-slate-900"}`}>Open Banking API Fetch Credits</h3>
              <p className={`text-xs ${dark ? "text-slate-400" : "text-slate-500"}`}>
                {formatCurrency(ADDON_PRICING.openBankingCreditPackUnit, "GBP")}/fetch · Bulk packs of {ADDON_PRICING.openBankingCreditPackSize}
              </p>
            </div>
          </div>
          <div className={`text-right ${dark ? "text-slate-100" : "text-slate-900"}`}>
            <span className="text-lg font-bold">{openBankingCredits * ADDON_PRICING.openBankingCreditPackSize}</span>
            <span className={`ml-1 text-xs ${dark ? "text-slate-400" : "text-slate-500"}`}>fetches</span>
            {openBankingCredits > 0 && (
              <p className="text-xs text-indigo-600 dark:text-indigo-400">+{formatCurrency(pricing.openBankingCost, "GBP")}/mo</p>
            )}
          </div>
        </div>
        <div className="mt-4">
          <input
            type="range"
            min={0}
            max={20}
            value={openBankingCredits}
            onChange={(e) => setOpenBankingCredits(parseInt(e.target.value))}
            className="w-full accent-indigo-600"
          />
          <div className={`mt-1 flex justify-between text-[10px] ${dark ? "text-slate-500" : "text-slate-400"}`}>
            <span>0 packs</span><span>10 packs</span><span>20 packs ({openBankingCredits * ADDON_PRICING.openBankingCreditPackSize} fetches)</span>
          </div>
        </div>
      </div>

      {/* SMS/WhatsApp Messaging Pack */}
      <div className={`panel p-5 ${dark ? "bg-slate-900 border-slate-800" : ""}`}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${dark ? "bg-emerald-500/10" : "bg-emerald-50"}`}>
              <MessageSquare className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <h3 className={`text-sm font-bold ${dark ? "text-slate-100" : "text-slate-900"}`}>Automated SMS / WhatsApp Messaging</h3>
              <p className={`text-xs ${dark ? "text-slate-400" : "text-slate-500"}`}>+{formatCurrency(ADDON_PRICING.smsPackPerMonth, "GBP")}/month — unlimited automated client messaging</p>
            </div>
          </div>
          <ToggleSwitch checked={smsPackEnabled} onChange={setSmsPackEnabled} dark={dark} />
        </div>
        {smsPackEnabled && (
          <div className={`mt-3 flex items-center gap-2 rounded-lg px-3 py-2 text-xs ${dark ? "bg-emerald-500/10 text-emerald-300" : "bg-emerald-50 text-emerald-700"} fade-in`}>
            <CheckCircle2 className="h-3.5 w-3.5" /> Messaging pack activated — +{formatCurrency(ADDON_PRICING.smsPackPerMonth, "GBP")}/mo
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Toggle Switch
// ============================================================

function ToggleSwitch({ checked, onChange, dark }: { checked: boolean; onChange: (v: boolean) => void; dark: boolean }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition-all duration-200 ${
        checked ? "bg-emerald-500" : dark ? "bg-slate-700" : "bg-slate-300"
      }`}
      role="switch"
      aria-checked={checked}
    >
      <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow-md transition-all duration-200 ${
        checked ? "left-6" : "left-1"
      }`} />
    </button>
  );
}

// ============================================================
// Step 4: Stripe Checkout (Mockup)
// ============================================================

interface Step4Props {
  dark: boolean;
  pricing: { total: number; subtotal: number; vat: number };
  paymentMethod: "card" | "direct_debit"; setPaymentMethod: (v: "card" | "direct_debit") => void;
  cardName: string; setCardName: (v: string) => void;
  cardNumber: string; setCardNumber: (v: string) => void;
  cardExpiry: string; setCardExpiry: (v: string) => void;
  cardCvc: string; setCardCvc: (v: string) => void;
  submitting: boolean;
}

function Step4Checkout(props: Step4Props) {
  const { dark, pricing, paymentMethod, setPaymentMethod, cardName, setCardName, cardNumber, setCardNumber, cardExpiry, setCardExpiry, cardCvc, setCardCvc, submitting } = props;
  return (
    <div className="fade-in space-y-4">
      <div className={`panel p-6 ${dark ? "bg-slate-900 border-slate-800" : ""}`}>
        <h2 className={`text-lg font-bold ${dark ? "text-slate-100" : "text-slate-900"}`}>Secure Checkout</h2>
        <p className={`mt-1 text-sm ${dark ? "text-slate-400" : "text-slate-500"}`}>Choose your payment method and authorize your subscription.</p>
      </div>

      {/* Payment Method Tabs */}
      <div className={`panel p-6 ${dark ? "bg-slate-900 border-slate-800" : ""}`}>
        <div className={`mb-5 flex gap-1 rounded-xl border p-1 ${dark ? "border-slate-700 bg-slate-800" : "border-slate-200 bg-slate-100"}`}>
          <button
            onClick={() => setPaymentMethod("card")}
            disabled={submitting}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-all disabled:opacity-50 ${
              paymentMethod === "card"
                ? "bg-blue-600 text-white shadow-sm"
                : dark ? "text-slate-400 hover:text-slate-200" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            <CreditCard className="h-4 w-4" /> Credit / Debit Card
          </button>
          <button
            onClick={() => setPaymentMethod("direct_debit")}
            disabled={submitting}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-all disabled:opacity-50 ${
              paymentMethod === "direct_debit"
                ? "bg-blue-600 text-white shadow-sm"
                : dark ? "text-slate-400 hover:text-slate-200" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            <Banknote className="h-4 w-4" /> Direct Debit
          </button>
        </div>

        {/* Stripe Elements Mockup - Card */}
        {paymentMethod === "card" && (
          <div className="space-y-4 fade-in">
            {/* Stripe branding bar */}
            <div className={`flex items-center justify-between rounded-lg px-3 py-2 ${dark ? "bg-slate-800" : "bg-slate-50"}`}>
              <span className={`text-xs font-medium ${dark ? "text-slate-400" : "text-slate-500"}`}>Powered by</span>
              <span className={`text-sm font-bold italic ${dark ? "text-slate-200" : "text-slate-700"}`}>stripe</span>
            </div>

            <div>
              <label className={`label ${dark ? "text-slate-300" : ""}`}>Cardholder Name</label>
              <input value={cardName} onChange={(e) => setCardName(e.target.value)} placeholder="Jane Smith" disabled={submitting} className={`input mt-1 ${dark ? "bg-slate-800 border-slate-700 text-slate-100" : ""}`} />
            </div>
            <div>
              <label className={`label ${dark ? "text-slate-300" : ""}`}>Card Number</label>
              <div className="relative mt-1">
                <CardIcon className={`pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 ${dark ? "text-slate-500" : "text-slate-400"}`} />
                <input value={cardNumber} onChange={(e) => setCardNumber(e.target.value)} placeholder="4242 4242 4242 4242" maxLength={19} disabled={submitting} className={`input pl-10 ${dark ? "bg-slate-800 border-slate-700 text-slate-100" : ""}`} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={`label ${dark ? "text-slate-300" : ""}`}>Expiry Date</label>
                <div className="relative mt-1">
                  <Calendar className={`pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 ${dark ? "text-slate-500" : "text-slate-400"}`} />
                  <input value={cardExpiry} onChange={(e) => setCardExpiry(e.target.value)} placeholder="MM/YY" maxLength={5} disabled={submitting} className={`input pl-10 ${dark ? "bg-slate-800 border-slate-700 text-slate-100" : ""}`} />
                </div>
              </div>
              <div>
                <label className={`label ${dark ? "text-slate-300" : ""}`}>CVC</label>
                <div className="relative mt-1">
                  <Lock className={`pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 ${dark ? "text-slate-500" : "text-slate-400"}`} />
                  <input value={cardCvc} onChange={(e) => setCardCvc(e.target.value)} placeholder="123" maxLength={4} inputMode="numeric" disabled={submitting} className={`input pl-10 ${dark ? "bg-slate-800 border-slate-700 text-slate-100" : ""}`} />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Direct Debit Mockup */}
        {paymentMethod === "direct_debit" && (
          <div className="space-y-4 fade-in">
            <div className={`flex items-center justify-between rounded-lg px-3 py-2 ${dark ? "bg-slate-800" : "bg-slate-50"}`}>
              <span className={`text-xs font-medium ${dark ? "text-slate-400" : "text-slate-500"}`}>Powered by</span>
              <span className={`text-sm font-bold italic ${dark ? "text-slate-200" : "text-slate-700"}`}>stripe</span>
            </div>
            <div className={`rounded-xl border border-dashed p-4 text-center ${dark ? "border-slate-700 bg-slate-800/50" : "border-slate-300 bg-slate-50"}`}>
              <Banknote className={`mx-auto mb-2 h-8 w-8 ${dark ? "text-slate-500" : "text-slate-400"}`} />
              <p className={`text-sm font-medium ${dark ? "text-slate-300" : "text-slate-700"}`}>Bacs Direct Debit Authorization</p>
              <p className={`mt-1 text-xs ${dark ? "text-slate-500" : "text-slate-400"}`}>You'll be redirected to authorize a Bacs Direct Debit mandate via your bank. Payments will be collected automatically on your billing date.</p>
            </div>
            <div>
              <label className={`label ${dark ? "text-slate-300" : ""}`}>Account Holder Name</label>
              <input placeholder="Jane Smith" disabled={submitting} className={`input mt-1 ${dark ? "bg-slate-800 border-slate-700 text-slate-100" : ""}`} />
            </div>
            <div>
              <label className={`label ${dark ? "text-slate-300" : ""}`}>Sort Code</label>
              <input placeholder="12-34-56" maxLength={8} disabled={submitting} className={`input mt-1 ${dark ? "bg-slate-800 border-slate-700 text-slate-100" : ""}`} />
            </div>
            <div>
              <label className={`label ${dark ? "text-slate-300" : ""}`}>Account Number</label>
              <input placeholder="12345678" maxLength={8} inputMode="numeric" disabled={submitting} className={`input mt-1 ${dark ? "bg-slate-800 border-slate-700 text-slate-100" : ""}`} />
            </div>
          </div>
        )}

        {/* Security Badges */}
        <div className={`mt-5 flex flex-wrap items-center justify-center gap-4 border-t pt-4 ${dark ? "border-slate-700" : "border-slate-200"}`}>
          <SecurityBadge icon={<ShieldCheck className="h-4 w-4" />} label="PCI-DSS Compliant" dark={dark} />
          <SecurityBadge icon={<Lock className="h-4 w-4" />} label="256-bit SSL Encryption" dark={dark} />
          <SecurityBadge icon={<BadgeCheck className="h-4 w-4" />} label="FCA Regulated" dark={dark} />
        </div>
      </div>
    </div>
  );
}

function SecurityBadge({ icon, label, dark }: { icon: React.ReactNode; label: string; dark: boolean }) {
  return (
    <div className={`flex items-center gap-1.5 ${dark ? "text-slate-400" : "text-slate-500"}`}>
      <span className="text-emerald-500">{icon}</span>
      <span className="text-[10px] font-medium">{label}</span>
    </div>
  );
}

// ============================================================
// Step 5: Automated Provisioning & Onboarding
// ============================================================

interface Step5Props {
  dark: boolean;
  companyName: string;
  provisioningStage: number;
  provisioningDone: boolean;
  createdTenant: DebtVergeTenant | null;
  onLaunch: () => void;
  submitError: string | null;
}

function Step5Provisioning({ dark, companyName, provisioningStage, provisioningDone, createdTenant, onLaunch, submitError }: Step5Props) {
  return (
    <div className="fade-in">
      <div className={`panel p-8 ${dark ? "bg-slate-900 border-slate-800" : ""}`}>
        {/* Header */}
        <div className="mb-6 text-center">
          <div className={`mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl ${
            provisioningDone
              ? "bg-emerald-500 text-white shadow-lg shadow-emerald-500/30"
              : "bg-blue-500 text-white shadow-lg shadow-blue-500/30"
          }`}>
            {provisioningDone ? <CheckCircle2 className="h-8 w-8" /> : <Loader2 className="h-8 w-8 animate-spin" />}
          </div>
          <h2 className={`text-xl font-bold ${dark ? "text-slate-100" : "text-slate-900"}`}>
            {provisioningDone ? "Workspace Ready!" : "Provisioning Your Workspace"}
          </h2>
          <p className={`mt-1 text-sm ${dark ? "text-slate-400" : "text-slate-500"}`}>
            {provisioningDone
              ? `${companyName} is fully set up and ready to use.`
              : `Setting up ${companyName}'s isolated tenant environment...`}
          </p>
        </div>

        {/* Provisioning Stages */}
        <div className="mx-auto max-w-md space-y-3">
          {PROVISIONING_STAGES.map((stage, i) => {
            const isComplete = provisioningStage > i;
            const isActive = provisioningStage === i;
            const isPending = provisioningStage < i;
            return (
              <div
                key={stage.id}
                className={`flex items-center gap-3 rounded-xl border p-3 transition-all duration-300 ${
                  isComplete
                    ? dark ? "border-emerald-500/30 bg-emerald-500/5" : "border-emerald-200 bg-emerald-50"
                    : isActive
                      ? dark ? "border-blue-500/30 bg-blue-500/5" : "border-blue-200 bg-blue-50"
                      : dark ? "border-slate-800 bg-slate-800/30" : "border-slate-100 bg-slate-50"
                }`}
              >
                <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all ${
                  isComplete
                    ? "bg-emerald-500 text-white"
                    : isActive
                      ? "bg-blue-500 text-white"
                      : dark ? "bg-slate-700 text-slate-500" : "bg-slate-200 text-slate-400"
                }`}>
                  {isComplete ? (
                    <Check className="h-4 w-4" />
                  ) : isActive ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CircleDot className="h-4 w-4" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-medium ${
                    isComplete ? (dark ? "text-emerald-300" : "text-emerald-700")
                      : isActive ? (dark ? "text-blue-300" : "text-blue-700")
                      : dark ? "text-slate-400" : "text-slate-500"
                  }`}>
                    {stage.label}
                    {isComplete && "..."}
                    {isActive && "..."}
                  </p>
                  <p className={`text-xs ${dark ? "text-slate-500" : "text-slate-400"}`}>{stage.description}</p>
                </div>
                {isComplete && (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                )}
              </div>
            );
          })}
        </div>

        {/* Error */}
        {submitError && (
          <div className={`mt-4 flex items-center gap-2 rounded-xl px-4 py-3 text-sm ${dark ? "bg-rose-500/10 text-rose-300" : "bg-rose-50 text-rose-700"}`}>
            <AlertCircle className="h-4 w-4 shrink-0" /> {submitError}
          </div>
        )}

        {/* Success CTA */}
        {provisioningDone && createdTenant && (
          <div className="mt-6 fade-in space-y-4">
            <div className={`rounded-xl border p-4 ${dark ? "border-slate-700 bg-slate-800/50" : "border-slate-200 bg-slate-50"}`}>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className={`text-[10px] uppercase ${dark ? "text-slate-500" : "text-slate-400"}`}>Tenant ID</p>
                  <p className={`font-mono text-xs font-medium ${dark ? "text-slate-300" : "text-slate-700"}`}>{createdTenant.tenant_slug ?? createdTenant.id.slice(0, 8)}</p>
                </div>
                <div>
                  <p className={`text-[10px] uppercase ${dark ? "text-slate-500" : "text-slate-400"}`}>Workspace URL</p>
                  <p className={`font-mono text-xs font-medium ${dark ? "text-slate-300" : "text-slate-700"}`}>{createdTenant.workspace_url}</p>
                </div>
              </div>
            </div>
            <button
              onClick={onLaunch}
              className="btn btn-primary w-full bg-emerald-600 py-3 text-base hover:bg-emerald-700"
            >
              <Rocket className="h-5 w-5" /> Launch DebtVerge Admin Dashboard
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Order Summary Sidebar
// ============================================================

interface OrderSummaryProps {
  dark: boolean;
  planTier: DebtVergePlanTier;
  billingCycle: DebtVergeBillingCycle;
  additionalSeats: number;
  openBankingCredits: number;
  smsPackEnabled: boolean;
  pricing: {
    basePrice: number; seatsCost: number; openBankingCost: number; smsCost: number;
    annualDiscount: number; subtotal: number; vat: number; total: number; effectiveMonthly: number;
  };
}

function OrderSummarySidebar({ dark, planTier, billingCycle, additionalSeats, openBankingCredits, smsPackEnabled, pricing }: OrderSummaryProps) {
  const tier = PLAN_TIERS.find((t) => t.id === planTier)!;
  return (
    <div className={`sticky top-24 self-start rounded-2xl border p-5 ${dark ? "border-slate-800 bg-slate-900" : "border-slate-200 bg-white"} shadow-sm`}>
      <h3 className={`mb-4 flex items-center gap-2 text-sm font-bold ${dark ? "text-slate-100" : "text-slate-900"}`}>
        <Wallet className="h-4 w-4 text-blue-500" /> Order Summary
      </h3>

      <div className="space-y-2.5 text-xs">
        {/* Plan */}
        <div className="flex items-center justify-between">
          <div>
            <span className={`font-medium ${dark ? "text-slate-200" : "text-slate-700"}`}>{tier.label} Plan</span>
            <p className={`text-[10px] ${dark ? "text-slate-500" : "text-slate-400"}`}>{billingCycle === "annual" ? "Annual billing" : "Monthly billing"}</p>
          </div>
          <span className={`font-medium ${dark ? "text-slate-200" : "text-slate-700"}`}>
            {formatCurrency(billingCycle === "annual" ? pricing.basePrice * 12 * (1 - ADDON_PRICING.annualDiscountRate) : pricing.basePrice, "GBP")}
            <span className={`ml-0.5 ${dark ? "text-slate-500" : "text-slate-400"}`}>/{billingCycle === "annual" ? "yr" : "mo"}</span>
          </span>
        </div>

        {/* Additional Seats */}
        {additionalSeats > 0 && (
          <div className="flex items-center justify-between">
            <span className={dark ? "text-slate-300" : "text-slate-600"}>+{additionalSeats} advisor seat{additionalSeats > 1 ? "s" : ""}</span>
            <span className={dark ? "text-slate-200" : "text-slate-700"}>+{formatCurrency(pricing.seatsCost, "GBP")}/mo</span>
          </div>
        )}

        {/* Open Banking Credits */}
        {openBankingCredits > 0 && (
          <div className="flex items-center justify-between">
            <span className={dark ? "text-slate-300" : "text-slate-600"}>+{openBankingCredits * ADDON_PRICING.openBankingCreditPackSize} OB fetches</span>
            <span className={dark ? "text-slate-200" : "text-slate-700"}>+{formatCurrency(pricing.openBankingCost, "GBP")}/mo</span>
          </div>
        )}

        {/* SMS Pack */}
        {smsPackEnabled && (
          <div className="flex items-center justify-between">
            <span className={dark ? "text-slate-300" : "text-slate-600"}>+ SMS/WhatsApp Pack</span>
            <span className={dark ? "text-slate-200" : "text-slate-700"}>+{formatCurrency(pricing.smsCost, "GBP")}/mo</span>
          </div>
        )}

        {/* Annual Discount */}
        {pricing.annualDiscount > 0 && (
          <div className="flex items-center justify-between text-emerald-600 dark:text-emerald-400">
            <span className="flex items-center gap-1"><Percent className="h-3 w-3" /> Annual discount (15%)</span>
            <span>-{formatCurrency(pricing.annualDiscount, "GBP")}/mo</span>
          </div>
        )}

        {/* Divider */}
        <div className={`my-2 border-t ${dark ? "border-slate-800" : "border-slate-100"}`} />

        {/* Subtotal */}
        <div className="flex items-center justify-between">
          <span className={dark ? "text-slate-400" : "text-slate-500"}>Subtotal</span>
          <span className={`font-medium ${dark ? "text-slate-200" : "text-slate-700"}`}>{formatCurrency(pricing.subtotal, "GBP")}</span>
        </div>

        {/* VAT */}
        <div className="flex items-center justify-between">
          <span className={dark ? "text-slate-400" : "text-slate-500"}>VAT (20%)</span>
          <span className={`font-medium ${dark ? "text-slate-200" : "text-slate-700"}`}>{formatCurrency(pricing.vat, "GBP")}</span>
        </div>

        {/* Total */}
        <div className={`mt-2 flex items-center justify-between rounded-lg px-3 py-2.5 ${dark ? "bg-slate-800" : "bg-slate-50"}`}>
          <span className={`text-sm font-bold ${dark ? "text-slate-100" : "text-slate-900"}`}>Total Due Today</span>
          <span className="text-sm font-bold text-blue-600 dark:text-blue-400">{formatCurrency(pricing.total, "GBP")}</span>
        </div>

        {/* Effective Monthly */}
        {billingCycle === "annual" && (
          <p className={`pt-1 text-center text-[10px] ${dark ? "text-slate-500" : "text-slate-400"}`}>
            Equivalent to {formatCurrency(pricing.effectiveMonthly, "GBP")}/month
          </p>
        )}
      </div>

      {/* Trust Badge */}
      <div className={`mt-4 flex items-center justify-center gap-2 border-t pt-3 ${dark ? "border-slate-800" : "border-slate-100"}`}>
        <Shield className="h-3.5 w-3.5 text-emerald-500" />
        <span className={`text-[10px] font-medium ${dark ? "text-slate-400" : "text-slate-500"}`}>Secure checkout · Cancel anytime</span>
      </div>
    </div>
  );
}
