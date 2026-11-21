// ============================================================
// UK Tax & NI Calculation Engine (2024/25)
// ============================================================

export type InputMode = "gross" | "net";
export type PayFrequency = "monthly" | "annual";
export type StudentLoanPlan = "none" | "plan1" | "plan2" | "plan4" | "plan5" | "postgrad";

export interface TaxBand {
  label: string;
  rate: number;
  taxableInThisBand: number;
  taxInThisBand: number;
}

export interface StudentLoanCalc {
  plan: StudentLoanPlan;
  annualThreshold: number;
  rate: number;
  annualRepayment: number;
  monthlyRepayment: number;
}

export interface UkTaxBreakdown {
  grossAnnual: number;
  netAnnual: number;
  netMonthly: number;
  incomeTax: number;
  nationalInsurance: number;
  pensionAnnual: number;
  pensionMonthly: number;
  studentLoan: StudentLoanCalc | null;
  totalDeductions: number;
  takeHomePct: number;
  bands: TaxBand[];
}

// 2024/25 thresholds
const PERSONAL_ALLOWANCE = 12570;
const PA_TAPER_THRESHOLD = 100000;
const BASIC_RATE_THRESHOLD = 50270;
const HIGHER_RATE_THRESHOLD = 125140;
const BASIC_RATE = 0.2;
const HIGHER_RATE = 0.4;
const ADDITIONAL_RATE = 0.45;

// NI (Class 1, employee) 2024/25 — 8% between PT and UEL
const NI_PRIMARY_THRESHOLD = 1258 * 12; // £12,570/yr
const NI_UPPER_EARNINGS_LIMIT = 50270;
const NI_MAIN_RATE = 0.08;
const NI_ADDITIONAL_RATE = 0.02;

// Student Loan thresholds (2024/25, annual)
const SL_THRESHOLDS: Record<Exclude<StudentLoanPlan, "none">, number> = {
  plan1: 24990,
  plan2: 27295,
  plan4: 32397,
  plan5: 25000,
  postgrad: 21000,
};

const SL_RATES: Record<Exclude<StudentLoanPlan, "none">, number> = {
  plan1: 0.09,
  plan2: 0.09,
  plan4: 0.09,
  plan5: 0.09,
  postgrad: 0.06,
};

// Self-employed NI (Class 4) 2024/25
const CLASS4_LOWER_LIMIT = 12570;
const CLASS4_UPPER_LIMIT = 50270;
const CLASS4_MAIN_RATE = 0.06;
const CLASS4_ADDITIONAL_RATE = 0.02;

// ── Income Tax ──────────────────────────────────────────────
function calculateIncomeTax(grossAnnual: number): { tax: number; bands: TaxBand[] } {
  const bands: TaxBand[] = [];
  let allowance = PERSONAL_ALLOWANCE;
  if (grossAnnual > PA_TAPER_THRESHOLD) {
    const reduction = Math.floor((grossAnnual - PA_TAPER_THRESHOLD) / 2);
    allowance = Math.max(0, PERSONAL_ALLOWANCE - reduction);
  }

  const taxFree = Math.min(grossAnnual, allowance);
  bands.push({ label: "Personal Allowance", rate: 0, taxableInThisBand: taxFree, taxInThisBand: 0 });

  if (grossAnnual <= allowance) return { tax: 0, bands };

  const basicLimit = Math.min(BASIC_RATE_THRESHOLD, grossAnnual) - allowance;
  const basicTaxable = Math.max(0, basicLimit);
  const basicTax = basicTaxable * BASIC_RATE;
  bands.push({ label: "Basic Rate (20%)", rate: BASIC_RATE, taxableInThisBand: basicTaxable, taxInThisBand: basicTax });

  let higherTax = 0;
  if (grossAnnual > BASIC_RATE_THRESHOLD) {
    const higherTaxable = Math.min(HIGHER_RATE_THRESHOLD, grossAnnual) - BASIC_RATE_THRESHOLD;
    higherTax = higherTaxable * HIGHER_RATE;
    bands.push({ label: "Higher Rate (40%)", rate: HIGHER_RATE, taxableInThisBand: higherTaxable, taxInThisBand: higherTax });
  }

  let additionalTax = 0;
  if (grossAnnual > HIGHER_RATE_THRESHOLD) {
    const additionalTaxable = grossAnnual - HIGHER_RATE_THRESHOLD;
    additionalTax = additionalTaxable * ADDITIONAL_RATE;
    bands.push({ label: "Additional Rate (45%)", rate: ADDITIONAL_RATE, taxableInThisBand: additionalTaxable, taxInThisBand: additionalTax });
  }

  return { tax: basicTax + higherTax + additionalTax, bands };
}

// ── National Insurance (Class 1 employee) ───────────────────
function calculateNI(grossAnnual: number): { ni: number; bands: TaxBand[] } {
  const bands: TaxBand[] = [];
  const belowPT = Math.min(grossAnnual, NI_PRIMARY_THRESHOLD);
  bands.push({ label: "Below Primary Threshold", rate: 0, taxableInThisBand: belowPT, taxInThisBand: 0 });

  if (grossAnnual <= NI_PRIMARY_THRESHOLD) return { ni: 0, bands };

  const mainTaxable = Math.min(NI_UPPER_EARNINGS_LIMIT, grossAnnual) - NI_PRIMARY_THRESHOLD;
  const mainNI = Math.max(0, mainTaxable) * NI_MAIN_RATE;
  bands.push({ label: "NI Main Rate (8%)", rate: NI_MAIN_RATE, taxableInThisBand: Math.max(0, mainTaxable), taxInThisBand: mainNI });

  let addNI = 0;
  if (grossAnnual > NI_UPPER_EARNINGS_LIMIT) {
    const addTaxable = grossAnnual - NI_UPPER_EARNINGS_LIMIT;
    addNI = addTaxable * NI_ADDITIONAL_RATE;
    bands.push({ label: "NI Additional Rate (2%)", rate: NI_ADDITIONAL_RATE, taxableInThisBand: addTaxable, taxInThisBand: addNI });
  }

  return { ni: mainNI + addNI, bands };
}

// ── Student Loan Repayment ──────────────────────────────────
export function calculateStudentLoan(annualIncome: number, plan: StudentLoanPlan): StudentLoanCalc | null {
  if (plan === "none") return null;
  const threshold = SL_THRESHOLDS[plan];
  const rate = SL_RATES[plan];
  const aboveThreshold = Math.max(0, annualIncome - threshold);
  const annualRepayment = aboveThreshold * rate;
  return {
    plan,
    annualThreshold: threshold,
    rate,
    annualRepayment,
    monthlyRepayment: annualRepayment / 12,
  };
}

// ── Self-employed NI (Class 4) ──────────────────────────────
export function calculateSelfEmployedNI(profitAnnual: number): {
  ni: number;
  bands: TaxBand[];
} {
  const bands: TaxBand[] = [];
  const below = Math.min(profitAnnual, CLASS4_LOWER_LIMIT);
  bands.push({ label: "Below Lower Limit", rate: 0, taxableInThisBand: below, taxInThisBand: 0 });

  if (profitAnnual <= CLASS4_LOWER_LIMIT) return { ni: 0, bands };

  const mainTaxable = Math.min(CLASS4_UPPER_LIMIT, profitAnnual) - CLASS4_LOWER_LIMIT;
  const mainNI = Math.max(0, mainTaxable) * CLASS4_MAIN_RATE;
  bands.push({ label: "Class 4 Main (6%)", rate: CLASS4_MAIN_RATE, taxableInThisBand: Math.max(0, mainTaxable), taxInThisBand: mainNI });

  let addNI = 0;
  if (profitAnnual > CLASS4_UPPER_LIMIT) {
    const addTaxable = profitAnnual - CLASS4_UPPER_LIMIT;
    addNI = addTaxable * CLASS4_ADDITIONAL_RATE;
    bands.push({ label: "Class 4 Additional (2%)", rate: CLASS4_ADDITIONAL_RATE, taxableInThisBand: addTaxable, taxInThisBand: addNI });
  }

  return { ni: mainNI + addNI, bands };
}

// ── Pension (percentage of gross, relief at source) ─────────
function calculatePension(grossAnnual: number, pensionPct: number): number {
  if (pensionPct <= 0) return 0;
  return grossAnnual * (pensionPct / 100);
}

// ── Main calculation from gross ─────────────────────────────
interface CalcOptions {
  pensionPct?: number;
  studentLoanPlan?: StudentLoanPlan;
  isSelfEmployed?: boolean;
}

function calculateFromGross(grossAnnual: number, opts: CalcOptions = {}): UkTaxBreakdown {
  const { tax, bands: taxBands } = calculateIncomeTax(grossAnnual);

  let ni: number;
  let niBands: TaxBand[];
  if (opts.isSelfEmployed) {
    const seNI = calculateSelfEmployedNI(grossAnnual);
    ni = seNI.ni;
    niBands = seNI.bands;
  } else {
    const niResult = calculateNI(grossAnnual);
    ni = niResult.ni;
    niBands = niResult.bands;
  }

  const pensionAnnual = calculatePension(grossAnnual, opts.pensionPct ?? 0);
  const studentLoan = calculateStudentLoan(grossAnnual, opts.studentLoanPlan ?? "none");

  const totalDeductions = tax + ni + pensionAnnual + (studentLoan?.annualRepayment ?? 0);
  const netAnnual = grossAnnual - totalDeductions;

  return {
    grossAnnual,
    netAnnual,
    netMonthly: netAnnual / 12,
    incomeTax: tax,
    nationalInsurance: ni,
    pensionAnnual,
    pensionMonthly: pensionAnnual / 12,
    studentLoan,
    totalDeductions,
    takeHomePct: grossAnnual > 0 ? (netAnnual / grossAnnual) * 100 : 0,
    bands: [...taxBands, ...niBands],
  };
}

// Reverse-calculate gross from net target (iterative)
function calculateFromNet(netAnnualTarget: number, opts: CalcOptions = {}): UkTaxBreakdown {
  if (netAnnualTarget <= 0) return calculateFromGross(0, opts);
  let grossEstimate = netAnnualTarget / 0.75;
  let iterations = 0;
  while (iterations < 50) {
    const breakdown = calculateFromGross(grossEstimate, opts);
    const diff = breakdown.netAnnual - netAnnualTarget;
    if (Math.abs(diff) < 0.5) return breakdown;
    grossEstimate -= diff * 0.8;
    if (grossEstimate < 0) grossEstimate = 0;
    iterations++;
  }
  return calculateFromGross(grossEstimate, opts);
}

export function calculateUkTax(
  amount: number,
  mode: InputMode,
  frequency: PayFrequency,
  opts: CalcOptions = {},
): UkTaxBreakdown {
  const annualAmount = frequency === "monthly" ? amount * 12 : amount;
  if (mode === "gross") return calculateFromGross(annualAmount, opts);
  return calculateFromNet(annualAmount, opts);
}

// ── Overtime / Shift Engine ─────────────────────────────────
export interface OvertimeInput {
  hourlyRate: number;
  standardHoursPerWeek: number;
  timeAndThirdHours: number;  // 1.33x
  timeAndHalfHours: number;   // 1.5x
  doubleTimeHours: number;    // 2.0x
}

export interface OvertimeResult {
  standardPay: number;
  overtimePay: number;
  grossAnnual: number;
  grossMonthly: number;
  breakdown: { label: string; hours: number; rate: number; multiplier: number; annualPay: number }[];
}

export function calculateOvertimeGross(input: OvertimeInput): OvertimeResult {
  const weeksPerYear = 52;
  const standardPay = input.hourlyRate * input.standardHoursPerWeek * weeksPerYear;

  const ot133 = input.hourlyRate * 1.33 * input.timeAndThirdHours * weeksPerYear;
  const ot150 = input.hourlyRate * 1.5 * input.timeAndHalfHours * weeksPerYear;
  const ot200 = input.hourlyRate * 2.0 * input.doubleTimeHours * weeksPerYear;
  const overtimePay = ot133 + ot150 + ot200;

  const grossAnnual = standardPay + overtimePay;

  return {
    standardPay,
    overtimePay,
    grossAnnual,
    grossMonthly: grossAnnual / 12,
    breakdown: [
      { label: "Standard Hours", hours: input.standardHoursPerWeek, rate: input.hourlyRate, multiplier: 1.0, annualPay: standardPay },
      ...(input.timeAndThirdHours > 0 ? [{ label: "Time & a Third (1.33x)", hours: input.timeAndThirdHours, rate: input.hourlyRate * 1.33, multiplier: 1.33, annualPay: ot133 }] : []),
      ...(input.timeAndHalfHours > 0 ? [{ label: "Time & a Half (1.5x)", hours: input.timeAndHalfHours, rate: input.hourlyRate * 1.5, multiplier: 1.5, annualPay: ot150 }] : []),
      ...(input.doubleTimeHours > 0 ? [{ label: "Double Time (2.0x)", hours: input.doubleTimeHours, rate: input.hourlyRate * 2.0, multiplier: 2.0, annualPay: ot200 }] : []),
    ],
  };
}

export const STUDENT_LOAN_PLAN_LABELS: Record<StudentLoanPlan, string> = {
  none: "No Student Loan",
  plan1: "Plan 1 (pre-2012, Scotland/NI)",
  plan2: "Plan 2 (post-2012 England)",
  plan4: "Plan 4 (Scotland only)",
  plan5: "Plan 5 (from Aug 2023)",
  postgrad: "Postgraduate Loan",
};
