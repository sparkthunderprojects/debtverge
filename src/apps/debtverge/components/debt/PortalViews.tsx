import { useState, useMemo } from "react";
import {
  Building, Scale, FileSignature, Vote, Download, Upload,
  CheckCircle2, Clock, AlertCircle, FileText, ChevronRight,
  TrendingUp, Users, Gavel, PieChart, ArrowRight, BarChart3,
  Calendar, Percent, Smartphone,
} from "lucide-react";
import { formatCurrency, formatDateShort } from "@/core/format";
import {
  useProofOfDebt, useCreditorVotes, useIVAProposal,
  addProofOfDebt, addCreditorVote,
} from "@/apps/debtverge/lib/insolvency-hooks";
import {
  generateChairsReport, downloadDocumentJSON,
} from "@/apps/debtverge/lib/insolvency-docs";
import { useDebtVergeCase } from "@/apps/debtverge/lib/debtverge-case-context";
import { useDebtCreditors } from "@/apps/debtverge/lib/debt-hooks";
import type { DebtCase, DebtVergePortalRole, ChairsReportJSON, CreditorVoteChoice } from "@/core/types";

// Re-export the enhanced debtor self-service portal
export { DebtorSelfServiceView } from "./DebtorSelfServicePortal";

// ============================================================
// Portal Role Metadata
// ============================================================

export const PORTAL_ROLE_META: Record<DebtVergePortalRole, {
  label: string;
  description: string;
  icon: React.ReactNode;
}> = {
  advisor_ip: {
    label: "Advisor / IP",
    description: "Full case administration & proposal generation",
    icon: <Scale className="h-4 w-4" />,
  },
  debtor: {
    label: "Debtor Self-Service",
    description: "Upload documents & track fact-find",
    icon: <Smartphone className="h-4 w-4" />,
  },
  creditor: {
    label: "Creditor Portal",
    description: "Inspect proposals, submit PoD & vote",
    icon: <Building className="h-4 w-4" />,
  },
};

// ============================================================
// Enhanced Creditor Portal View (Module 4)
// ============================================================

const VOTE_COLORS: Record<CreditorVoteChoice, string> = {
  accept: "emerald",
  reject: "rose",
  modify: "amber",
};

export function CreditorPortalView({ caseId, caseData }: { caseId: string; caseData: DebtCase }) {
  const { activeCase } = useDebtVergeCase();
  const { data: proposal } = useIVAProposal(caseId);
  const { data: proofs, reload: reloadPod } = useProofOfDebt(caseId);
  const { data: votes, reload: reloadVotes } = useCreditorVotes(caseId);
  const { data: creditors } = useDebtCreditors(caseId);
  const [activeSection, setActiveSection] = useState<"proposal" | "pod" | "voting" | "chairs_report">("proposal");
  const [showPodForm, setShowPodForm] = useState(false);
  const [showVoteForm, setShowVoteForm] = useState(false);
  const [podForm, setPodForm] = useState({ creditor_name: "", creditor_reference: "", claimed_amount: 0 });
  const [voteForm, setVoteForm] = useState({ creditor_id: "", vote: "accept" as CreditorVoteChoice, notes: "" });

  const chairsReport = useMemo<ChairsReportJSON | null>(() => {
    if (!activeCase) return null;
    return generateChairsReport(activeCase, null, proposal ?? null, votes, proofs);
  }, [activeCase, proposal, votes, proofs]);

  const handleSubmitPod = async () => {
    if (!podForm.creditor_name) return;
    await addProofOfDebt(caseId, podForm);
    setPodForm({ creditor_name: "", creditor_reference: "", claimed_amount: 0 });
    setShowPodForm(false);
    reloadPod();
  };

  const handleSubmitVote = async () => {
    if (!voteForm.creditor_id) return;
    const creditor = creditors.find((c) => c.id === voteForm.creditor_id);
    await addCreditorVote(caseId, {
      creditor_id: voteForm.creditor_id,
      claimed_debt_amount: creditor?.balance ?? 0,
      vote: voteForm.vote,
      modification_notes: voteForm.notes || null,
      submitted_by: "Creditor Portal",
    });
    setVoteForm({ creditor_id: "", vote: "accept", notes: "" });
    setShowVoteForm(false);
    reloadVotes();
  };

  const handleDownloadChairsReport = () => {
    if (!chairsReport) return;
    downloadDocumentJSON(chairsReport, `chairs-report-${caseData.case_number}.json`);
  };

  const totalClaims = proofs.reduce((s, p) => s + p.claimed_amount, 0);
  const totalAdmitted = proofs.reduce((s, p) => s + p.admitted_amount, 0);
  const voteStats = {
    accept: { count: votes.filter((v) => v.vote === "accept").length, value: votes.filter((v) => v.vote === "accept").reduce((s, v) => s + v.claimed_debt_amount, 0) },
    reject: { count: votes.filter((v) => v.vote === "reject").length, value: votes.filter((v) => v.vote === "reject").reduce((s, v) => s + v.claimed_debt_amount, 0) },
    modify: { count: votes.filter((v) => v.vote === "modify").length, value: votes.filter((v) => v.vote === "modify").reduce((s, v) => s + v.claimed_debt_amount, 0) },
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      {/* Header */}
      <div className="panel p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 dark:bg-emerald-500/10">
            <Building className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="flex-1">
            <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">Creditor Portal — Secure Dashboard</h2>
            <p className="text-xs text-slate-400">Case {caseData.case_number} · Debtor: {caseData.debtor_name}</p>
          </div>
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-[10px] font-bold text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">AUTHENTICATED</span>
        </div>
        {/* Section nav */}
        <div className="mt-4 flex gap-1.5 overflow-x-auto">
          {([
            { id: "proposal", label: "Proposal", icon: Scale },
            { id: "pod", label: "Proof of Debt", icon: FileSignature },
            { id: "voting", label: "Voting", icon: Vote },
            { id: "chairs_report", label: "Chair's Report", icon: Gavel },
          ] as const).map((s) => {
            const Icon = s.icon;
            return (
              <button key={s.id} onClick={() => setActiveSection(s.id)} className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-all ${activeSection === s.id ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"}`}>
                <Icon className="h-3.5 w-3.5" /> {s.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Proposal Inspection */}
      {activeSection === "proposal" && (
        <div className="panel p-5">
          <div className="mb-3 flex items-center gap-2">
            <Scale className="h-4 w-4 text-violet-500" />
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">IVA Proposal Details</h3>
          </div>
          {proposal ? (
            <>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700"><p className="text-[10px] font-bold uppercase text-slate-400">Duration</p><p className="text-lg font-bold text-slate-700 dark:text-slate-300">{proposal.proposed_duration_months} mo</p></div>
                <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700"><p className="text-[10px] font-bold uppercase text-slate-400">Est. Dividend</p><p className="text-lg font-bold text-slate-700 dark:text-slate-300">{formatCurrency(proposal.total_estimated_dividend)}</p></div>
                <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700"><p className="text-[10px] font-bold uppercase text-slate-400">Pence in £</p><p className="text-lg font-bold text-slate-700 dark:text-slate-300">{proposal.estimated_dividend_percent}p</p></div>
                <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700"><p className="text-[10px] font-bold uppercase text-slate-400">Meeting Date</p><p className="text-sm font-bold text-slate-700 dark:text-slate-300">{proposal.creditor_meeting_date ? formatDateShort(proposal.creditor_meeting_date) : "TBC"}</p></div>
              </div>
              <div className="mt-3 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                <p className="text-[10px] font-bold uppercase text-slate-400">Equity Treatment</p>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{proposal.equity_treatment_terms ?? "Not specified"}</p>
              </div>
              <div className="mt-3">
                <span className={`rounded-full px-3 py-1 text-[10px] font-bold ${proposal.protocol_compliant ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300" : "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300"}`}>
                  {proposal.protocol_compliant ? "IVA PROTOCOL COMPLIANT" : "NON-STANDARD PROPOSAL"}
                </span>
              </div>
            </>
          ) : (
            <div className="py-6 text-center"><Scale className="mx-auto mb-2 h-8 w-8 text-slate-300 dark:text-slate-600" /><p className="text-xs text-slate-400">No IVA proposal has been circulated yet</p></div>
          )}
        </div>
      )}

      {/* Proof of Debt */}
      {activeSection === "pod" && (
        <div className="panel p-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2"><FileSignature className="h-4 w-4 text-blue-500" /><h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Proof of Debt (PoD)</h3></div>
            <button onClick={() => setShowPodForm(!showPodForm)} className="btn btn-secondary text-xs"><Upload className="h-3.5 w-3.5" /> Submit PoD</button>
          </div>
          {showPodForm && (
            <div className="mb-4 space-y-3 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <input className="input" placeholder="Creditor name" value={podForm.creditor_name} onChange={(e) => setPodForm({ ...podForm, creditor_name: e.target.value })} />
                <input className="input" placeholder="Your reference / account no." value={podForm.creditor_reference} onChange={(e) => setPodForm({ ...podForm, creditor_reference: e.target.value })} />
              </div>
              <input type="number" className="input" placeholder="Claimed amount (£)" value={podForm.claimed_amount || ""} onChange={(e) => setPodForm({ ...podForm, claimed_amount: parseFloat(e.target.value) || 0 })} />
              <button onClick={handleSubmitPod} className="btn btn-primary bg-blue-600 text-xs hover:bg-blue-700"><FileSignature className="h-3.5 w-3.5" /> Submit Proof of Debt</button>
            </div>
          )}
          {proofs.length > 0 ? (
            <div className="space-y-2">
              {proofs.map((pod) => (
                <div key={pod.id} className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                  <FileSignature className="h-5 w-5 shrink-0 text-slate-400" />
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-slate-700 dark:text-slate-300">{pod.creditor_name}</p><p className="text-[10px] text-slate-400">Claimed: {formatCurrency(pod.claimed_amount)} · Admitted: {formatCurrency(pod.admitted_amount)}</p></div>
                  <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${pod.status === "admitted" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300" : pod.status === "rejected" ? "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300" : "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300"}`}>{pod.status.replace(/_/g, " ").toUpperCase()}</span>
                </div>
              ))}
              <div className="mt-2 grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/50"><p className="text-xs text-slate-500">Total claimed: <strong className="text-slate-700 dark:text-slate-300">{formatCurrency(totalClaims)}</strong></p></div>
                <div className="rounded-lg bg-emerald-50 p-3 dark:bg-emerald-500/10"><p className="text-xs text-emerald-600 dark:text-emerald-400">Total admitted: <strong>{formatCurrency(totalAdmitted)}</strong></p></div>
              </div>
            </div>
          ) : <p className="py-4 text-center text-xs text-slate-400">No Proof of Debt submissions yet</p>}
        </div>
      )}

      {/* Proxy Voting */}
      {activeSection === "voting" && (
        <div className="panel p-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2"><Vote className="h-4 w-4 text-blue-500" /><h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Interactive Proxy Voting</h3></div>
            <button onClick={() => setShowVoteForm(!showVoteForm)} className="btn btn-secondary text-xs"><Vote className="h-3.5 w-3.5" /> Cast Vote</button>
          </div>
          {showVoteForm && (
            <div className="mb-4 space-y-3 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
              <select className="input" value={voteForm.creditor_id} onChange={(e) => setVoteForm({ ...voteForm, creditor_id: e.target.value })}>
                <option value="">Select your creditor account...</option>
                {creditors.map((c) => <option key={c.id} value={c.id}>{c.name} — {formatCurrency(c.balance)}</option>)}
              </select>
              <select className="input" value={voteForm.vote} onChange={(e) => setVoteForm({ ...voteForm, vote: e.target.value as CreditorVoteChoice })}>
                <option value="accept">Accept Proposal</option>
                <option value="reject">Reject Proposal</option>
                <option value="modify">Accept with Modifications</option>
              </select>
              {voteForm.vote === "modify" && <textarea className="input" rows={2} placeholder="Describe your modifications..." value={voteForm.notes} onChange={(e) => setVoteForm({ ...voteForm, notes: e.target.value })} />}
              <button onClick={handleSubmitVote} className="btn btn-primary bg-blue-600 text-xs hover:bg-blue-700"><Vote className="h-3.5 w-3.5" /> Submit Vote</button>
            </div>
          )}
          {votes.length > 0 ? (
            <div className="space-y-3">
              {/* Vote summary */}
              <div className="grid grid-cols-3 gap-3">
                {(["accept", "reject", "modify"] as CreditorVoteChoice[]).map((vt) => {
                  const stat = voteStats[vt];
                  const color = VOTE_COLORS[vt];
                  return (
                    <div key={vt} className={`rounded-xl border p-3 text-center border-${color}-200 bg-${color}-50 dark:border-${color}-500/30 dark:bg-${color}-500/10`}>
                      <p className={`text-[10px] font-bold uppercase text-${color}-600 dark:text-${color}-400`}>{vt}</p>
                      <p className="text-lg font-bold text-slate-700 dark:text-slate-300">{stat.count}</p>
                      <p className={`text-[10px] text-${color}-600 dark:text-${color}-400`}>{formatCurrency(stat.value)}</p>
                    </div>
                  );
                })}
              </div>
              {/* Vote list */}
              <div className="space-y-2">
                {votes.map((vote) => {
                  const creditor = creditors.find((c) => c.id === vote.creditor_id);
                  return (
                    <div key={vote.id} className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                      <Vote className="h-4 w-4 shrink-0 text-slate-400" />
                      <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-slate-700 dark:text-slate-300">{creditor?.name ?? "Unknown"}</p><p className="text-[10px] text-slate-400">{formatCurrency(vote.claimed_debt_amount)}</p></div>
                      <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${vote.vote === "accept" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300" : vote.vote === "reject" ? "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300" : "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300"}`}>{vote.vote.toUpperCase()}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : <p className="py-4 text-center text-xs text-slate-400">No votes cast yet</p>}
        </div>
      )}

      {/* Chair's Report Dashboard */}
      {activeSection === "chairs_report" && (
        <div className="space-y-4">
          {chairsReport ? (
            <>
              {/* Summary cards */}
              <div className="panel p-5">
                <div className="mb-4 flex items-center justify-between">
                  <div className="flex items-center gap-2"><Gavel className="h-4 w-4 text-violet-500" /><h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Chair's Report — Meeting of Creditors</h3></div>
                  <button onClick={handleDownloadChairsReport} className="btn btn-primary bg-violet-600 text-xs hover:bg-violet-700"><Download className="h-3.5 w-3.5" /> Download</button>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700"><p className="text-[10px] font-bold uppercase text-slate-400">Claims Submitted</p><p className="text-lg font-bold text-blue-600 dark:text-blue-400">{chairsReport.totalClaimsSubmitted}</p></div>
                  <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700"><p className="text-[10px] font-bold uppercase text-slate-400">Claims Admitted</p><p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{chairsReport.totalClaimsAdmitted}</p></div>
                  <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700"><p className="text-[10px] font-bold uppercase text-slate-400">Claims Rejected</p><p className="text-lg font-bold text-rose-600 dark:text-rose-400">{chairsReport.totalClaimsRejected}</p></div>
                  <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700"><p className="text-[10px] font-bold uppercase text-slate-400">Outcome</p><p className="text-sm font-bold text-slate-700 dark:text-slate-300">{chairsReport.proposalOutcome.toUpperCase()}</p></div>
                </div>
              </div>

              {/* Voting Results */}
              <div className="panel p-5">
                <div className="mb-3 flex items-center gap-2"><BarChart3 className="h-4 w-4 text-blue-500" /><h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Voting Results</h3></div>
                <div className="grid grid-cols-3 gap-3">
                  {(["accept", "reject", "modify"] as CreditorVoteChoice[]).map((vt) => {
                    const stat = chairsReport.votingResults[vt];
                    const color = VOTE_COLORS[vt];
                    return (
                      <div key={vt} className={`rounded-xl border p-4 border-${color}-200 bg-${color}-50 dark:border-${color}-500/30 dark:bg-${color}-500/10`}>
                        <p className={`text-[10px] font-bold uppercase text-${color}-600 dark:text-${color}-400`}>{vt}</p>
                        <p className="text-2xl font-bold text-slate-700 dark:text-slate-300">{stat.count}</p>
                        <p className={`text-xs text-${color}-600 dark:text-${color}-400`}>{formatCurrency(stat.value)}</p>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Dividend Summary */}
              <div className="panel p-5">
                <div className="mb-3 flex items-center gap-2"><PieChart className="h-4 w-4 text-violet-500" /><h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Dividend Summary</h3></div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700"><p className="text-[10px] font-bold uppercase text-slate-400">Total Debt</p><p className="text-lg font-bold text-slate-700 dark:text-slate-300">{formatCurrency(chairsReport.dividendSummary.totalDebt)}</p></div>
                  <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700"><p className="text-[10px] font-bold uppercase text-slate-400">Est. Dividend</p><p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(chairsReport.dividendSummary.totalEstimatedDividend)}</p></div>
                  <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700"><p className="text-[10px] font-bold uppercase text-slate-400">Dividend %</p><p className="text-lg font-bold text-violet-600 dark:text-violet-400">{chairsReport.dividendSummary.dividendPercent}p</p></div>
                </div>
              </div>

              {/* Creditor Breakdown Table */}
              {chairsReport.creditorBreakdown.length > 0 && (
                <div className="panel p-5">
                  <div className="mb-3 flex items-center gap-2"><Users className="h-4 w-4 text-blue-500" /><h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Creditor Breakdown</h3></div>
                  <div className="overflow-auto rounded-xl border border-slate-200 dark:border-slate-700">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 dark:bg-slate-800">
                        <tr>
                          <th className="px-3 py-2 text-left font-bold text-slate-600 dark:text-slate-400">Creditor</th>
                          <th className="px-3 py-2 text-right font-bold text-slate-600 dark:text-slate-400">Claimed</th>
                          <th className="px-3 py-2 text-right font-bold text-slate-600 dark:text-slate-400">Admitted</th>
                          <th className="px-3 py-2 text-center font-bold text-slate-600 dark:text-slate-400">Vote</th>
                        </tr>
                      </thead>
                      <tbody>
                        {chairsReport.creditorBreakdown.map((c, i) => (
                          <tr key={i} className="border-t border-slate-100 dark:border-slate-700/50">
                            <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{c.creditorName}</td>
                            <td className="px-3 py-2 text-right text-slate-500">{formatCurrency(c.claimedAmount)}</td>
                            <td className="px-3 py-2 text-right text-emerald-600 dark:text-emerald-400">{formatCurrency(c.admittedAmount)}</td>
                            <td className="px-3 py-2 text-center"><span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${c.vote === "accept" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300" : c.vote === "reject" ? "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300" : "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300"}`}>{c.vote.toUpperCase()}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Meeting info */}
              {chairsReport.meetingDate && (
                <div className="panel p-4">
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <Calendar className="h-4 w-4 text-slate-400" />
                    Meeting of Creditors held on {formatDateShort(chairsReport.meetingDate)}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="panel p-8 text-center">
              <Gavel className="mx-auto mb-3 h-10 w-10 text-slate-300 dark:text-slate-600" />
              <p className="text-sm text-slate-500">Chair's Report will be available after the Meeting of Creditors</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
