import type {
  DebtVergeCaseMaster, IPDetails, IVAProposalData,
  CreditorVote, ProofOfDebt,
  IVAProposalDocumentJSON, ChairsReportJSON,
  CreditorVoteChoice,
  IVAProposalPack, ContributionTableEntry, NomineesReportSection, ProtocolTermsSection,
  SignpostingRoute,
} from "@/core/types";

// ============================================================
// Document Generator & Audit Pipeline Hooks
// ============================================================

/**
 * Transforms the active SFS budget and creditor ledger into a standardized
 * JSON structure for IVA Protocol document exports.
 */
export function generateIVAProposalDocument(
  caseMaster: DebtVergeCaseMaster,
  ipDetails: IPDetails | null,
  proposal: IVAProposalData | null,
): IVAProposalDocumentJSON {
  const fs = caseMaster.financialStatement;
  const cad = caseMaster.creditorsAndDebts;
  const totalDebt = cad.totalDebt;
  const dividendPercent = proposal?.estimated_dividend_percent ?? 0;

  const projectedDividendPerCreditor = cad.creditors.map((c) => ({
    creditorName: c.name,
    balance: c.balance,
    projectedDividend: Math.round((c.balance * dividendPercent) / 100 * 100) / 100,
  }));

  return {
    proposalId: proposal?.id ?? "draft",
    caseNumber: caseMaster.caseNumber,
    debtorName: caseMaster.debtorName,
    generatedAt: new Date().toISOString(),
    ipDetails: ipDetails
      ? {
          practitionerName: ipDetails.practitioner_name,
          registrationNumber: ipDetails.registration_number,
          firmName: ipDetails.firm_name,
          roleType: ipDetails.role_type,
          nomineeFeePercent: ipDetails.nominee_fee_percent,
          supervisorFeePercent: ipDetails.supervisor_fee_percent,
        }
      : null,
    proposal: proposal
      ? {
          proposedDurationMonths: proposal.proposed_duration_months,
          totalEstimatedDividend: proposal.total_estimated_dividend,
          estimatedDividendPercent: proposal.estimated_dividend_percent,
          equityTreatmentTerms: proposal.equity_treatment_terms,
          protocolCompliant: proposal.protocol_compliant,
          proposalStatus: proposal.proposal_status,
          creditorMeetingDate: proposal.creditor_meeting_date,
        }
      : null,
    sfsSummary: {
      totalIncome: fs.totalIncome,
      totalEssentialExpenses: fs.totalEssentialExpenses,
      totalDiscretionaryExpenses: fs.totalDiscretionaryExpenses,
      totalDebtRepayments: fs.totalDebtRepayments,
      disposableIncome: fs.disposableIncome,
      entryCount: fs.entries.length,
    },
    creditorLedger: cad.creditors.map((c) => ({
      creditorName: c.name,
      balance: c.balance,
      minimumPayment: c.minimum_payment,
      apr: c.apr,
    })),
    totalUnsecuredDebt: totalDebt,
    totalMonthlyMinimums: cad.totalMonthlyMinimums,
    projectedDividendPerCreditor,
  };
}

/**
 * Generates a Chair's Report summary from creditor votes, PoD submissions,
 * and proposal data.
 */
export function generateChairsReport(
  caseMaster: DebtVergeCaseMaster,
  ipDetails: IPDetails | null,
  proposal: IVAProposalData | null,
  votes: CreditorVote[],
  proofsOfDebt: ProofOfDebt[],
): ChairsReportJSON {
  const cad = caseMaster.creditorsAndDebts;
  const creditorNameMap = new Map(cad.creditors.map((c) => [c.id, c.name]));

  // Aggregate voting results
  const votingResults = {
    accept: { count: 0, value: 0 },
    reject: { count: 0, value: 0 },
    modify: { count: 0, value: 0 },
  };
  for (const v of votes) {
    const key = v.vote as CreditorVoteChoice;
    votingResults[key].count += 1;
    votingResults[key].value += v.claimed_debt_amount;
  }

  // Aggregate PoD claims
  const submitted = proofsOfDebt.filter((p) => p.status !== "rejected");
  const admitted = proofsOfDebt.filter((p) => p.status === "admitted" || p.status === "partially_admitted");
  const rejected = proofsOfDebt.filter((p) => p.status === "rejected");

  // Creditor breakdown — merge votes with PoD data
  const creditorBreakdown = votes.map((v) => {
    const pod = proofsOfDebt.find((p) => p.creditor_id === v.creditor_id);
    return {
      creditorName: creditorNameMap.get(v.creditor_id) ?? "Unknown",
      claimedAmount: v.claimed_debt_amount,
      admittedAmount: pod?.admitted_amount ?? 0,
      vote: v.vote,
      modificationNotes: v.modification_notes,
    };
  });

  return {
    reportId: `CR-${caseMaster.caseNumber}-${Date.now()}`,
    caseNumber: caseMaster.caseNumber,
    debtorName: caseMaster.debtorName,
    generatedAt: new Date().toISOString(),
    ipDetails: ipDetails
      ? { practitionerName: ipDetails.practitioner_name, firmName: ipDetails.firm_name }
      : null,
    meetingDate: proposal?.creditor_meeting_date ?? null,
    totalClaimsSubmitted: submitted.length,
    totalClaimsAdmitted: admitted.length,
    totalClaimsRejected: rejected.length,
    votingResults,
    dividendSummary: {
      totalDebt: cad.totalDebt,
      totalEstimatedDividend: proposal?.total_estimated_dividend ?? 0,
      dividendPercent: proposal?.estimated_dividend_percent ?? 0,
    },
    creditorBreakdown,
    proposalOutcome: proposal?.proposal_status ?? "draft",
  };
}

/**
 * Triggers a browser download of a JSON document structure.
 */
export function downloadDocumentJSON(doc: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Generates a human-readable summary string for audit log entries
 * when IVA proposal status changes.
 */
export function proposalAuditSummary(
  oldStatus: string | null,
  newStatus: string,
  proposal: IVAProposalData | null,
): string {
  const duration = proposal?.proposed_duration_months ?? 0;
  const dividend = proposal?.total_estimated_dividend ?? 0;
  const pct = proposal?.estimated_dividend_percent ?? 0;
  return `IVA Proposal status changed${oldStatus ? ` from ${oldStatus}` : ""} to ${newStatus}. Duration: ${duration} months. Estimated dividend: £${dividend.toLocaleString()} (${pct}p in £).`;
}

// ============================================================
// IVA Protocol Proposal Pack Builder
// ============================================================

/**
 * Builds a complete IVA Protocol Proposal Pack from the active case data,
 * including contribution tables, Nominee's Report, and standard Protocol Terms.
 */
export function generateIVAProposalPack(
  caseMaster: DebtVergeCaseMaster,
  ipDetails: IPDetails | null,
  proposal: IVAProposalData | null,
): IVAProposalPack {
  const fs = caseMaster.financialStatement;
  const cad = caseMaster.creditorsAndDebts;
  const monthlyContribution = Math.max(0, fs.disposableIncome);
  const duration = proposal?.proposed_duration_months ?? 60;
  const dividendPercent = proposal?.estimated_dividend_percent ?? 0;

  // Build contribution table entries
  const entries: ContributionTableEntry[] = [];
  let cumulative = 0;
  const baseDate = new Date();
  for (let m = 1; m <= duration; m++) {
    const d = new Date(baseDate.getFullYear(), baseDate.getMonth() + m, 1);
    const total = monthlyContribution;
    cumulative += total;
    entries.push({
      month: m,
      date: d.toISOString().split("T")[0],
      baseContribution: monthlyContribution,
      additionalContributions: 0,
      totalContribution: total,
      cumulativeTotal: cumulative,
    });
  }

  // Build Nominee's Report
  const profile = caseMaster.customerProfile;
  const hasProperty = (profile as unknown as { assets?: { hasProperty?: boolean } })?.assets?.hasProperty ?? false;
  const estimatedEquity = (profile as unknown as { assets?: { assetEquity?: number } })?.assets?.assetEquity ?? 0;
  const nomineeReport: NomineesReportSection = {
    caseNumber: caseMaster.caseNumber,
    debtorName: caseMaster.debtorName,
    ipName: ipDetails?.practitioner_name ?? "To be appointed",
    firmName: ipDetails?.firm_name ?? null,
    registrationNumber: ipDetails?.registration_number ?? null,
    reportDate: new Date().toISOString(),
    sfsSummary: {
      totalIncome: fs.totalIncome,
      totalEssentialExpenses: fs.totalEssentialExpenses,
      totalDiscretionaryExpenses: fs.totalDiscretionaryExpenses,
      disposableIncome: fs.disposableIncome,
    },
    totalUnsecuredDebt: cad.totalDebt,
    creditorCount: cad.creditorCount,
    assetSummary: {
      hasProperty,
      estimatedEquity,
      equityTreatment: proposal?.equity_treatment_terms ?? null,
    },
    suitabilityAssessment: `Based on total unsecured debt of £${cad.totalDebt.toLocaleString()}, disposable income of £${fs.disposableIncome.toLocaleString()}/month, and ${cad.creditorCount} creditors, an IVA is the recommended solution route.`,
    proposalRecommendation: `I recommend a ${duration}-month IVA with a monthly contribution of £${monthlyContribution.toLocaleString()}, offering an estimated dividend of ${dividendPercent}p in the £ to creditors.`,
    riskFactors: [
      ...(fs.disposableIncome < 100 ? ["Disposable income is below £100/month — contribution sustainability risk"] : []),
      ...(hasProperty && estimatedEquity > 5000 ? ["Property equity requires remortgage review at month " + (proposal?.equity_release_month ?? 48)] : []),
      ...(cad.creditorCount > 5 ? ["High creditor count may increase proxy vote coordination complexity"] : []),
    ],
  };

  // Standard IVA Protocol Terms (UK IVA Protocol 2021+ version)
  const protocolTerms: ProtocolTermsSection = {
    protocolVersion: "UK IVA Protocol 2021",
    terms: [
      { clause: "1.1", text: "The debtor agrees to make monthly contributions as set out in the Proposal for the duration of the Arrangement." },
      { clause: "1.2", text: "Contributions shall be reviewed annually and adjusted in line with changes to the debtor's income and expenditure." },
      { clause: "2.1", text: "The Nominee's fee and Supervisor's fee shall be drawn from realisations as specified in the Proposal." },
      { clause: "2.2", text: "The Supervisor's fee is charged as a percentage of realisations plus a fixed element as agreed at the Meeting of Creditors." },
      { clause: "3.1", text: "The debtor must notify the Supervisor of any change in circumstances within 21 days." },
      { clause: "3.2", text: "The debtor must not obtain further credit exceeding £500 without the Supervisor's prior written consent." },
      { clause: "4.1", text: "A Meeting of Creditors shall be convened in accordance with the Insolvency Act 1986 and the IVA Protocol." },
      { clause: "4.2", text: "Creditors may vote in person, by proxy, or electronically via the Creditor Portal." },
      { clause: "5.1", text: "Where the debtor owns property with equity, a valuation and equity review shall be conducted by the specified month." },
      { clause: "5.2", text: "The debtor shall use best endeavours to release equity by remortgage up to 85% Loan-to-Value." },
      { clause: "6.1", text: "The Supervisor shall distribute funds to creditors at least annually in accordance with the agreed dividend schedule." },
      { clause: "6.2", text: "The Supervisor shall provide an annual report to creditors detailing receipts, payments, and distributions." },
      { clause: "7.1", text: "The Arrangement shall terminate upon completion of all obligations, breach, or by order of the Court." },
    ],
  };

  // Fee schedule
  const nomineeFeePct = ipDetails?.nominee_fee_percent ?? 0;
  const supervisorFeePct = ipDetails?.supervisor_fee_percent ?? 0;
  const fixedFee = ipDetails?.fixed_fee_amount ?? 0;
  const totalRealisations = monthlyContribution * duration;
  const estimatedNomineeFee = Math.round((totalRealisations * nomineeFeePct) / 100 * 100) / 100;
  const estimatedSupervisorFee = Math.round((totalRealisations * supervisorFeePct) / 100 * 100) / 100;

  // Creditor schedule with projected dividends
  const creditorSchedule = cad.creditors.map((c) => ({
    creditorName: c.name,
    balance: c.balance,
    apr: c.apr,
    projectedDividend: Math.round((c.balance * dividendPercent) / 100 * 100) / 100,
  }));

  return {
    packId: `IVA-PP-${caseMaster.caseNumber}-${Date.now()}`,
    caseNumber: caseMaster.caseNumber,
    debtorName: caseMaster.debtorName,
    generatedAt: new Date().toISOString(),
    contributionTable: {
      monthlyContribution,
      durationMonths: duration,
      totalContributions: cumulative,
      entries,
    },
    nomineesReport: nomineeReport,
    protocolTerms: protocolTerms,
    sfsBudgetSummary: {
      totalIncome: fs.totalIncome,
      totalEssentialExpenses: fs.totalEssentialExpenses,
      totalDiscretionaryExpenses: fs.totalDiscretionaryExpenses,
      disposableIncome: fs.disposableIncome,
      surplusShortfall: fs.disposableIncome - monthlyContribution,
    },
    creditorSchedule,
    feeSchedule: {
      nomineeFeePercent: nomineeFeePct,
      supervisorFeePercent: supervisorFeePct,
      fixedFeeAmount: fixedFee,
      estimatedNomineeFee,
      estimatedSupervisorFee,
    },
    totalEstimatedDividend: proposal?.total_estimated_dividend ?? 0,
    estimatedDividendPercent: dividendPercent,
  };
}

/**
 * Downloads a complete proposal pack as JSON.
 */
export function downloadProposalPack(pack: IVAProposalPack): void {
  downloadDocumentJSON(pack, `iva-proposal-pack-${pack.caseNumber}.json`);
}

// ============================================================
// Pathfinder / Signposting Decision Engine
// ============================================================

export interface PathfinderResult {
  recommendedRoute: SignpostingRoute;
  confidence: number;
  reasons: string[];
  allRoutes: Array<{
    route: SignpostingRoute;
    score: number;
    verdict: "recommended" | "viable" | "not_suitable";
  }>;
  estimatedTimeMonths: number;
  estimatedTotalCost: number;
}

const ROUTE_LABELS: Record<SignpostingRoute, string> = {
  iva: "IVA", dmp: "DMP", dro: "DRO", bankruptcy: "Bankruptcy", signposting: "Signposting",
};

/**
 * Automated decisioning engine that evaluates the debtor's profile and
 * recommends the optimal debt solution route (IVA vs DMP vs DRO vs Bankruptcy),
 * calculating time and cost estimates for the IP firm.
 */
export function runPathfinderEngine(input: {
  totalDebt: number;
  disposableIncome: number;
  creditorCount: number;
  assetEquity: number;
  hasProperty: boolean;
}): PathfinderResult {
  const { totalDebt, disposableIncome, creditorCount, assetEquity } = input;
  const routes: PathfinderResult["allRoutes"] = [];
  const reasons: string[] = [];

  // IVA scoring (suitable: debt £5k–£100k, DI >£50/mo, or has property equity)
  let ivaScore = 0;
  if (totalDebt >= 5000 && totalDebt <= 100000) ivaScore += 40;
  else if (totalDebt > 100000) ivaScore += 20;
  if (disposableIncome >= 100) ivaScore += 30;
  else if (disposableIncome >= 50) ivaScore += 15;
  if (assetEquity > 0 && input.hasProperty) ivaScore += 20;
  if (creditorCount >= 2) ivaScore += 10;
  routes.push({ route: "iva", score: Math.min(ivaScore, 100), verdict: ivaScore >= 60 ? "recommended" : ivaScore >= 40 ? "viable" : "not_suitable" });

  // DMP scoring (suitable: any debt level, DI >£0, flexible duration)
  let dmpScore = 0;
  if (totalDebt >= 1000) dmpScore += 25;
  if (disposableIncome > 0) dmpScore += 35;
  if (creditorCount >= 1) dmpScore += 10;
  if (disposableIncome < 100) dmpScore += 15;
  if (!input.hasProperty) dmpScore += 15;
  routes.push({ route: "dmp", score: Math.min(dmpScore, 100), verdict: dmpScore >= 60 ? "recommended" : dmpScore >= 40 ? "viable" : "not_suitable" });

  // DRO scoring (suitable: debt <£30k, DI <£75/mo, no assets >£2k, no property)
  let droScore = 0;
  if (totalDebt > 0 && totalDebt <= 30000) droScore += 40;
  else if (totalDebt > 30000) droScore = 0;
  if (disposableIncome < 75) droScore += 35;
  else if (disposableIncome >= 75) droScore = Math.min(droScore, 20);
  if (!input.hasProperty && assetEquity < 2000) droScore += 20;
  else if (input.hasProperty || assetEquity >= 2000) droScore = 0;
  routes.push({ route: "dro", score: Math.min(droScore, 100), verdict: droScore >= 60 ? "recommended" : droScore >= 40 ? "viable" : "not_suitable" });

  // Bankruptcy scoring (suitable: high debt, low/no DI, no assets)
  let bkScore = 0;
  if (totalDebt > 30000) bkScore += 40;
  if (disposableIncome < 50) bkScore += 30;
  if (!input.hasProperty && assetEquity < 1000) bkScore += 20;
  if (totalDebt > 0 && disposableIncome <= 0) bkScore += 15;
  routes.push({ route: "bankruptcy", score: Math.min(bkScore, 100), verdict: bkScore >= 60 ? "recommended" : bkScore >= 40 ? "viable" : "not_suitable" });

  // Sort by score descending
  routes.sort((a, b) => b.score - a.score);
  const best = routes[0];

  // Build reasons
  if (best.route === "iva") {
    reasons.push(`Total unsecured debt of £${totalDebt.toLocaleString()} falls within IVA range`);
    if (disposableIncome >= 100) reasons.push(`Disposable income of £${disposableIncome.toLocaleString()}/month supports sustainable IVA contributions`);
    if (assetEquity > 0 && input.hasProperty) reasons.push(`Property equity of £${assetEquity.toLocaleString()} can be addressed via equity clause`);
  } else if (best.route === "dmp") {
    reasons.push(`Flexible DMP suits debt of £${totalDebt.toLocaleString()} with disposable income of £${disposableIncome.toLocaleString()}/month`);
    reasons.push(`No legal protection needed — informal arrangement provides flexibility`);
  } else if (best.route === "dro") {
    reasons.push(`Debt below £30,000 with low disposable income qualifies for Debt Relief Order`);
    reasons.push(`No property or significant assets — meets DRO eligibility criteria`);
  } else if (best.route === "bankruptcy") {
    reasons.push(`High debt level of £${totalDebt.toLocaleString()} with limited repayment capacity indicates bankruptcy`);
    if (!input.hasProperty) reasons.push(`No property assets to protect — bankruptcy provides clean discharge`);
  }

  // If all scores are low, recommend signposting
  if (best.score < 30) {
    reasons.push(`Profile does not strongly match any formal solution — signposting to free debt advice recommended`);
  }

  // Time & cost estimates
  const timeEstimates: Record<SignpostingRoute, number> = {
    iva: best.route === "iva" ? 60 : 60,
    dmp: Math.ceil(totalDebt / Math.max(disposableIncome, 1)),
    dro: 12,
    bankruptcy: 12,
    signposting: 0,
  };
  const costEstimates: Record<SignpostingRoute, number> = {
    iva: disposableIncome * 60,
    dmp: totalDebt,
    dro: 90,
    bankruptcy: 680,
    signposting: 0,
  };

  return {
    recommendedRoute: best.score >= 30 ? best.route : "signposting",
    confidence: best.score,
    reasons,
    allRoutes: routes.map((r) => ({ ...r, verdict: r.score === best.score && best.score >= 60 ? "recommended" : r.verdict })),
    estimatedTimeMonths: timeEstimates[best.score >= 30 ? best.route : "signposting"],
    estimatedTotalCost: costEstimates[best.score >= 30 ? best.route : "signposting"],
  };
}

/**
 * Distribution calculator: splits collected funds across creditor dividend
 * schedules, deducting IP fees (Nominee & Supervisor fees) before disbursement.
 */
export function calculateDistribution(input: {
  totalCollected: number;
  creditors: Array<{ id: string; name: string; balance: number }>;
  nomineeFeePercent: number;
  supervisorFeePercent: number;
  fixedFeeAmount: number;
}): {
  nomineeFee: number;
  supervisorFee: number;
  totalFees: number;
  netDistributable: number;
  items: Array<{ creditor_id: string; creditor_name: string; original_debt: number; pro_rata_percent: number; distribution_amount: number }>;
  totalDisbursed: number;
} {
  const { totalCollected, creditors, nomineeFeePercent, supervisorFeePercent, fixedFeeAmount } = input;

  const nomineeFee = Math.round((totalCollected * nomineeFeePercent) / 100 * 100) / 100;
  const supervisorFee = Math.round((totalCollected * supervisorFeePercent) / 100 * 100) / 100;
  const totalFees = Math.round((nomineeFee + supervisorFee + fixedFeeAmount) * 100) / 100;
  const netDistributable = Math.round((totalCollected - totalFees) * 100) / 100;

  const totalDebt = creditors.reduce((s, c) => s + c.balance, 0);

  const items = creditors.map((c) => {
    const proRata = totalDebt > 0 ? (c.balance / totalDebt) * 100 : 0;
    const distAmount = Math.round((netDistributable * proRata) / 100 * 100) / 100;
    return {
      creditor_id: c.id,
      creditor_name: c.name,
      original_debt: c.balance,
      pro_rata_percent: Math.round(proRata * 100) / 100,
      distribution_amount: Math.max(0, distAmount),
    };
  });

  const totalDisbursed = Math.round(items.reduce((s, i) => s + i.distribution_amount, 0) * 100) / 100;

  return { nomineeFee, supervisorFee, totalFees, netDistributable, items, totalDisbursed };
}

export { ROUTE_LABELS };
