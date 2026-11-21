import { useState, useEffect } from "react";
import {
  Scale, FileCheck, Vote, FileSignature, Upload, CheckCircle2, XCircle,
  Clock, User, Building, Phone, Mail, BadgeCheck, FileText, Download,
  AlertCircle, ChevronRight, Plus, Trash2, Shield,
} from "lucide-react";
import { formatCurrency, formatDateShort } from "@/lib/format";
import {
  useIPDetails, useDocumentChecklist, useIVAProposal, useCreditorVotes, useProofOfDebt,
  upsertIPDetails, addDocumentChecklistItem, updateDocumentChecklistItem, deleteDocumentChecklistItem,
  upsertIVAProposal, addCreditorVote, updateCreditorVote, deleteCreditorVote,
  addProofOfDebt, updateProofOfDebt, deleteProofOfDebt,
} from "@/lib/insolvency-hooks";
import {
  generateIVAProposalDocument, generateChairsReport, downloadDocumentJSON, proposalAuditSummary,
} from "@/lib/insolvency-docs";
import { useDebtVergeCase } from "@/lib/debtverge-case-context";
import { useDebtCreditors } from "@/lib/debt-hooks";
import { addAuditMilestone } from "@/lib/debt-hooks";
import type {
  IPDetails, IPRoleType, DocumentType, DocumentStatus, DocumentChecklistItem,
  IVAProposalData, ProposalStatus, CreditorVote, CreditorVoteChoice, ProofOfDebt,
  ProofOfDebtStatus,
} from "@/lib/types";

// ============================================================
// IP & Nominee Tab
// ============================================================

export function IPNomineeTab({ caseId }: { caseId: string }) {
  const { data: ipDetails } = useIPDetails(caseId);
  const [form, setForm] = useState({
    practitioner_name: "", registration_number: "", firm_name: "",
    firm_address: "", firm_phone: "", firm_email: "",
    role_type: "nominee" as IPRoleType,
    nominee_fee_percent: 0, supervisor_fee_percent: 0, fixed_fee_amount: 0, fee_notes: "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (ipDetails) {
      setForm({
        practitioner_name: ipDetails.practitioner_name,
        registration_number: ipDetails.registration_number ?? "",
        firm_name: ipDetails.firm_name ?? "",
        firm_address: ipDetails.firm_address ?? "",
        firm_phone: ipDetails.firm_phone ?? "",
        firm_email: ipDetails.firm_email ?? "",
        role_type: ipDetails.role_type,
        nominee_fee_percent: ipDetails.nominee_fee_percent,
        supervisor_fee_percent: ipDetails.supervisor_fee_percent,
        fixed_fee_amount: ipDetails.fixed_fee_amount,
        fee_notes: ipDetails.fee_notes ?? "",
      });
    }
  }, [ipDetails]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await upsertIPDetails(caseId, form);
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-6 p-1">
      <div className="panel p-6">
        <div className="mb-4 flex items-center gap-2">
          <User className="h-5 w-5 text-blue-500" />
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Insolvency Practitioner Details</h3>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">Practitioner Name *</label>
            <input className="input" value={form.practitioner_name} onChange={(e) => setForm({ ...form, practitioner_name: e.target.value })} placeholder="e.g., Jane Smith" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">Registration Number (FCA/IP)</label>
            <input className="input" value={form.registration_number} onChange={(e) => setForm({ ...form, registration_number: e.target.value })} placeholder="e.g., 1234567" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">Role Type</label>
            <select className="input" value={form.role_type} onChange={(e) => setForm({ ...form, role_type: e.target.value as IPRoleType })}>
              <option value="nominee">Nominee</option>
              <option value="supervisor">Supervisor</option>
              <option value="joint">Joint Nominee & Supervisor</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">Firm Name</label>
            <input className="input" value={form.firm_name} onChange={(e) => setForm({ ...form, firm_name: e.target.value })} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">Firm Phone</label>
            <input className="input" value={form.firm_phone} onChange={(e) => setForm({ ...form, firm_phone: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">Firm Address</label>
            <input className="input" value={form.firm_address} onChange={(e) => setForm({ ...form, firm_address: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">Firm Email</label>
            <input className="input" value={form.firm_email} onChange={(e) => setForm({ ...form, firm_email: e.target.value })} />
          </div>
        </div>
      </div>

      <div className="panel p-6">
        <div className="mb-4 flex items-center gap-2">
          <Scale className="h-5 w-5 text-violet-500" />
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Fee Structure</h3>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">Nominee Fee (%)</label>
            <input type="number" step="0.5" className="input" value={form.nominee_fee_percent} onChange={(e) => setForm({ ...form, nominee_fee_percent: parseFloat(e.target.value) || 0 })} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">Supervisor Fee (%)</label>
            <input type="number" step="0.5" className="input" value={form.supervisor_fee_percent} onChange={(e) => setForm({ ...form, supervisor_fee_percent: parseFloat(e.target.value) || 0 })} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">Fixed Fee Amount (£)</label>
            <input type="number" className="input" value={form.fixed_fee_amount} onChange={(e) => setForm({ ...form, fixed_fee_amount: parseFloat(e.target.value) || 0 })} />
          </div>
        </div>
        <div className="mt-4">
          <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">Fee Notes</label>
          <textarea className="input" rows={2} value={form.fee_notes} onChange={(e) => setForm({ ...form, fee_notes: e.target.value })} />
        </div>
      </div>

      <button onClick={handleSave} disabled={saving || !form.practitioner_name} className="btn btn-primary w-full bg-blue-600 py-3 text-sm hover:bg-blue-700 disabled:opacity-50">
        <BadgeCheck className="h-4 w-4" /> {saving ? "Saving..." : "Save IP Details"}
      </button>
    </div>
  );
}

// ============================================================
// Document Checklist Tab
// ============================================================

const DOC_TYPE_LABELS: Record<DocumentType, string> = {
  payslip: "Payslip", bank_statement: "Bank Statement", id_kyc: "ID / KYC Proof",
  tax_record: "Tax Record", utility_bill: "Utility Bill",
  creditor_statement: "Creditor Statement", other: "Other",
};

const STATUS_STYLES: Record<DocumentStatus, { icon: typeof Clock; color: string; bg: string }> = {
  pending: { icon: Clock, color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-500/10" },
  approved: { icon: CheckCircle2, color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-500/10" },
  rejected: { icon: XCircle, color: "text-rose-600 dark:text-rose-400", bg: "bg-rose-50 dark:bg-rose-500/10" },
};

export function DocumentChecklistTab({ caseId }: { caseId: string }) {
  const { data: docs, reload } = useDocumentChecklist(caseId);
  const [showAdd, setShowAdd] = useState(false);
  const [newDoc, setNewDoc] = useState<{ document_type: DocumentType; file_name: string; notes: string }>({
    document_type: "payslip", file_name: "", notes: "",
  });

  const handleAdd = async () => {
    if (!newDoc.file_name) return;
    await addDocumentChecklistItem(caseId, newDoc);
    setNewDoc({ document_type: "payslip", file_name: "", notes: "" });
    setShowAdd(false);
    reload();
  };

  const handleStatusChange = async (id: string, status: DocumentStatus) => {
    await updateDocumentChecklistItem(id, {
      status,
      reviewed_by: "Advisor",
      reviewed_at: new Date().toISOString(),
    });
    reload();
  };

  const pendingCount = docs.filter((d) => d.status === "pending").length;

  return (
    <div className="space-y-4 p-1">
      <div className="panel p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileCheck className="h-5 w-5 text-blue-500" />
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Verification Document Checklist</h3>
            {pendingCount > 0 && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
                {pendingCount} pending review
              </span>
            )}
          </div>
          <button onClick={() => setShowAdd(!showAdd)} className="btn btn-secondary text-xs">
            <Plus className="h-3.5 w-3.5" /> Add Document
          </button>
        </div>

        {showAdd && (
          <div className="mb-4 flex flex-col gap-3 rounded-xl border border-slate-200 p-4 dark:border-slate-700 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium text-slate-500">Document Type</label>
              <select className="input" value={newDoc.document_type} onChange={(e) => setNewDoc({ ...newDoc, document_type: e.target.value as DocumentType })}>
                {Object.entries(DOC_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium text-slate-500">File Name</label>
              <input className="input" value={newDoc.file_name} onChange={(e) => setNewDoc({ ...newDoc, file_name: e.target.value })} placeholder="e.g., payslip_march_2026.pdf" />
            </div>
            <button onClick={handleAdd} className="btn btn-primary bg-blue-600 text-xs hover:bg-blue-700">
              <Upload className="h-3.5 w-3.5" /> Upload
            </button>
          </div>
        )}

        {docs.length === 0 ? (
          <div className="py-8 text-center">
            <FileText className="mx-auto mb-2 h-8 w-8 text-slate-300 dark:text-slate-600" />
            <p className="text-xs text-slate-400">No verification documents uploaded yet</p>
          </div>
        ) : (
          <div className="space-y-2">
            {docs.map((doc) => {
              const st = STATUS_STYLES[doc.status];
              const StatusIcon = st.icon;
              return (
                <div key={doc.id} className={`flex items-center gap-3 rounded-xl border p-3 ${st.bg} border-slate-200 dark:border-slate-700`}>
                  <FileText className="h-5 w-5 shrink-0 text-slate-400" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-700 dark:text-slate-300">{doc.file_name}</p>
                    <p className="text-[10px] text-slate-400">
                      {DOC_TYPE_LABELS[doc.document_type]} · uploaded by {doc.uploaded_by_role} · {formatDateShort(doc.created_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${st.color}`}>
                      <StatusIcon className="h-3 w-3" /> {doc.status.toUpperCase()}
                    </span>
                    {doc.status === "pending" && (
                      <div className="flex gap-1">
                        <button onClick={() => handleStatusChange(doc.id, "approved")} className="rounded-lg p-1.5 text-emerald-600 hover:bg-emerald-100 dark:hover:bg-emerald-500/20" title="Approve">
                          <CheckCircle2 className="h-4 w-4" />
                        </button>
                        <button onClick={() => handleStatusChange(doc.id, "rejected")} className="rounded-lg p-1.5 text-rose-600 hover:bg-rose-100 dark:hover:bg-rose-500/20" title="Reject">
                          <XCircle className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                    <button onClick={async () => { await deleteDocumentChecklistItem(doc.id); reload(); }} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" title="Delete">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Creditor Voting Tab (IVA Protocol — Nominee Proposal Draft + Voting Ledger)
// ============================================================

export function CreditorVotingTab({ caseId }: { caseId: string }) {
  const { activeCase } = useDebtVergeCase();
  const { data: proposal } = useIVAProposal(caseId);
  const { data: votes, reload } = useCreditorVotes(caseId);
  const { data: creditors } = useDebtCreditors(caseId);
  const [savingProposal, setSavingProposal] = useState(false);
  const [proposalForm, setProposalForm] = useState({
    proposed_duration_months: 60,
    total_estimated_dividend: 0,
    estimated_dividend_percent: 0,
    equity_treatment_terms: "",
    equity_release_month: 48,
    protocol_compliant: false,
    proposal_status: "draft" as ProposalStatus,
    creditor_meeting_date: "",
    dividend_calculation_notes: "",
  });

  useEffect(() => {
    if (proposal) {
      setProposalForm({
        proposed_duration_months: proposal.proposed_duration_months,
        total_estimated_dividend: proposal.total_estimated_dividend,
        estimated_dividend_percent: proposal.estimated_dividend_percent,
        equity_treatment_terms: proposal.equity_treatment_terms ?? "",
        equity_release_month: proposal.equity_release_month ?? 48,
        protocol_compliant: proposal.protocol_compliant,
        proposal_status: proposal.proposal_status,
        creditor_meeting_date: proposal.creditor_meeting_date ?? "",
        dividend_calculation_notes: proposal.dividend_calculation_notes ?? "",
      });
    }
  }, [proposal]);

  const handleSaveProposal = async () => {
    setSavingProposal(true);
    try {
      await upsertIVAProposal(caseId, {
        ...proposalForm,
        creditor_meeting_date: proposalForm.creditor_meeting_date || null,
        equity_release_month: proposalForm.equity_release_month || null,
      });
      if (caseId) {
        await addAuditMilestone({
          case_id: caseId,
          milestone: "IVA Proposal Updated",
          description: proposalAuditSummary(proposal?.proposal_status ?? null, proposalForm.proposal_status, proposal),
        });
      }
    } finally { setSavingProposal(false); }
  };

  const handleExportProposal = () => {
    if (!activeCase) return;
    const doc = generateIVAProposalDocument(activeCase, proposal ?? null, proposal ?? null);
    downloadDocumentJSON(doc, `iva-proposal-${activeCase.caseNumber}.json`);
  };

  const handleExportChairsReport = () => {
    if (!activeCase) return;
    const doc = generateChairsReport(activeCase, null, proposal ?? null, votes, []);
    downloadDocumentJSON(doc, `chairs-report-${activeCase.caseNumber}.json`);
  };

  const handleAddVote = async (creditorId: string) => {
    const creditor = creditors.find((c) => c.id === creditorId);
    if (!creditor) return;
    await addCreditorVote(caseId, {
      creditor_id: creditorId,
      claimed_debt_amount: creditor.balance,
      vote: "accept",
      submitted_by: "Advisor (proxy)",
    });
    reload();
  };

  const voteStats = {
    accept: votes.filter((v) => v.vote === "accept"),
    reject: votes.filter((v) => v.vote === "reject"),
    modify: votes.filter((v) => v.vote === "modify"),
  };

  return (
    <div className="space-y-6 p-1">
      {/* Nominee Proposal Draft */}
      <div className="panel p-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Scale className="h-5 w-5 text-violet-500" />
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">IVA Protocol Proposal Draft</h3>
          </div>
          <div className="flex gap-2">
            <button onClick={handleExportProposal} className="btn btn-secondary text-xs">
              <Download className="h-3.5 w-3.5" /> Export Proposal JSON
            </button>
            <button onClick={handleExportChairsReport} className="btn btn-secondary text-xs">
              <Download className="h-3.5 w-3.5" /> Chair's Report
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Proposed Duration (months)</label>
            <select className="input" value={proposalForm.proposed_duration_months} onChange={(e) => setProposalForm({ ...proposalForm, proposed_duration_months: parseInt(e.target.value) })}>
              <option value={36}>36</option>
              <option value={48}>48</option>
              <option value={60}>60</option>
              <option value={72}>72</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Total Estimated Dividend (£)</label>
            <input type="number" className="input" value={proposalForm.total_estimated_dividend} onChange={(e) => setProposalForm({ ...proposalForm, total_estimated_dividend: parseFloat(e.target.value) || 0 })} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Estimated Dividend (p in £)</label>
            <input type="number" step="0.5" className="input" value={proposalForm.estimated_dividend_percent} onChange={(e) => setProposalForm({ ...proposalForm, estimated_dividend_percent: parseFloat(e.target.value) || 0 })} />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium text-slate-500">Equity Treatment Terms</label>
            <input className="input" value={proposalForm.equity_treatment_terms} onChange={(e) => setProposalForm({ ...proposalForm, equity_treatment_terms: e.target.value })} placeholder="e.g., Equity deferred to month 48 with remortgage release up to 85% LTV" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Equity Release Month</label>
            <input type="number" className="input" value={proposalForm.equity_release_month ?? 0} onChange={(e) => setProposalForm({ ...proposalForm, equity_release_month: parseInt(e.target.value) || 0 })} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Creditor Meeting Date</label>
            <input type="date" className="input" value={proposalForm.creditor_meeting_date ? proposalForm.creditor_meeting_date.split("T")[0] : ""} onChange={(e) => setProposalForm({ ...proposalForm, creditor_meeting_date: e.target.value })} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Proposal Status</label>
            <select className="input" value={proposalForm.proposal_status} onChange={(e) => setProposalForm({ ...proposalForm, proposal_status: e.target.value as ProposalStatus })}>
              <option value="draft">Draft</option>
              <option value="circulated">Circulated</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="varied">Varied</option>
            </select>
          </div>
          <div className="flex items-end">
            <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-400">
              <input type="checkbox" checked={proposalForm.protocol_compliant} onChange={(e) => setProposalForm({ ...proposalForm, protocol_compliant: e.target.checked })} className="h-4 w-4 rounded border-slate-300" />
              IVA Protocol Compliant
            </label>
          </div>
        </div>
        <button onClick={handleSaveProposal} disabled={savingProposal} className="btn btn-primary mt-4 w-full bg-violet-600 py-2.5 text-sm hover:bg-violet-700 disabled:opacity-50">
          <Scale className="h-4 w-4" /> {savingProposal ? "Saving..." : "Save IVA Proposal"}
        </button>
      </div>

      {/* Creditor Voting Ledger */}
      <div className="panel p-6">
        <div className="mb-4 flex items-center gap-2">
          <Vote className="h-5 w-5 text-blue-500" />
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Creditor Voting Ledger</h3>
        </div>

        {/* Vote Summary */}
        {votes.length > 0 && (
          <>
          <div className="mb-4 grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-500/30 dark:bg-emerald-500/10">
              <p className="text-[10px] font-bold uppercase text-emerald-600 dark:text-emerald-400">Accept</p>
              <p className="text-lg font-bold text-emerald-700 dark:text-emerald-300">{voteStats.accept.length}</p>
              <p className="text-[10px] text-emerald-600 dark:text-emerald-400">{formatCurrency(voteStats.accept.reduce((s, v) => s + v.claimed_debt_amount, 0))}</p>
            </div>
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 dark:border-rose-500/30 dark:bg-rose-500/10">
              <p className="text-[10px] font-bold uppercase text-rose-600 dark:text-rose-400">Reject</p>
              <p className="text-lg font-bold text-rose-700 dark:text-rose-300">{voteStats.reject.length}</p>
              <p className="text-[10px] text-rose-600 dark:text-rose-400">{formatCurrency(voteStats.reject.reduce((s, v) => s + v.claimed_debt_amount, 0))}</p>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
              <p className="text-[10px] font-bold uppercase text-amber-600 dark:text-amber-400">Modify</p>
              <p className="text-lg font-bold text-amber-700 dark:text-amber-300">{voteStats.modify.length}</p>
              <p className="text-[10px] text-amber-600 dark:text-amber-400">{formatCurrency(voteStats.modify.reduce((s, v) => s + v.claimed_debt_amount, 0))}</p>
            </div>
          </div>

          {/* 75% Approval Threshold Tracker */}
          {(() => {
            const totalClaimed = votes.reduce((s, v) => s + v.claimed_debt_amount, 0);
            const acceptValue = voteStats.accept.reduce((s, v) => s + v.claimed_debt_amount, 0);
            const approvalPct = totalClaimed > 0 ? (acceptValue / totalClaimed) * 100 : 0;
            const thresholdMet = approvalPct >= 75;
            return (
              <div className={`mb-4 rounded-xl border p-4 ${thresholdMet ? "border-emerald-300 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10" : "border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50"}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Scale className={`h-4 w-4 ${thresholdMet ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400"}`} />
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-200">75% Creditor Approval Threshold</span>
                  </div>
                  <span className={`text-sm font-bold ${thresholdMet ? "text-emerald-600 dark:text-emerald-400" : "text-slate-500"}`}>
                    {approvalPct.toFixed(1)}%
                  </span>
                </div>
                <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${thresholdMet ? "bg-emerald-500" : "bg-violet-500"}`}
                    style={{ width: `${Math.min(100, approvalPct)}%` }}
                  />
                </div>
                <div className="mt-1.5 flex items-center justify-between text-[10px] text-slate-400">
                  <span>Accept: {formatCurrency(acceptValue)} of {formatCurrency(totalClaimed)} claimed</span>
                  <span className={`font-bold ${thresholdMet ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400"}`}>
                    {thresholdMet ? "Threshold met — IVA can be approved" : `${(75 - approvalPct).toFixed(1)}% below threshold`}
                  </span>
                </div>
                {/* Threshold line indicator at 75% */}
                <div className="relative mt-1">
                  <div className="absolute -top-3 left-[75%] h-3 w-0.5 bg-slate-400" />
                </div>
              </div>
            );
          })()}
          </>
        )}

        {/* Add vote from creditor list */}
        {creditors.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {creditors.filter((c) => !votes.some((v) => v.creditor_id === c.id)).map((c) => (
              <button key={c.id} onClick={() => handleAddVote(c.id)} className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] text-slate-600 hover:border-blue-300 hover:bg-blue-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-blue-500/10">
                <Plus className="h-3 w-3" /> {c.name}
              </button>
            ))}
          </div>
        )}

        {votes.length === 0 ? (
          <div className="py-6 text-center">
            <Vote className="mx-auto mb-2 h-8 w-8 text-slate-300 dark:text-slate-600" />
            <p className="text-xs text-slate-400">No proxy votes recorded yet. Add creditors above to begin voting.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {votes.map((vote) => {
              const creditor = creditors.find((c) => c.id === vote.creditor_id);
              return (
                <div key={vote.id} className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-700 dark:text-slate-300">{creditor?.name ?? "Unknown Creditor"}</p>
                    <p className="text-[10px] text-slate-400">Claimed: {formatCurrency(vote.claimed_debt_amount)} · {vote.submitted_by ?? "N/A"}</p>
                    {vote.modification_notes && <p className="mt-0.5 text-[10px] text-amber-600">Mod: {vote.modification_notes}</p>}
                  </div>
                  <select
                    value={vote.vote}
                    onChange={async (e) => { await updateCreditorVote(vote.id, { vote: e.target.value as CreditorVoteChoice }); reload(); }}
                    className="input w-28 text-xs"
                  >
                    <option value="accept">Accept</option>
                    <option value="reject">Reject</option>
                    <option value="modify">Modify</option>
                  </select>
                  <button onClick={async () => { await deleteCreditorVote(vote.id); reload(); }} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Proof of Debt Tab
// ============================================================

const POD_STATUS_STYLES: Record<ProofOfDebtStatus, string> = {
  submitted: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300",
  under_review: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
  admitted: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
  rejected: "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300",
  partially_admitted: "bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300",
};

export function ProofOfDebtTab({ caseId }: { caseId: string }) {
  const { data: proofs, reload } = useProofOfDebt(caseId);
  const [showAdd, setShowAdd] = useState(false);
  const [newPod, setNewPod] = useState({
    creditor_name: "", creditor_reference: "", claimed_amount: 0, notes: "",
  });

  const handleAdd = async () => {
    if (!newPod.creditor_name) return;
    await addProofOfDebt(caseId, newPod);
    setNewPod({ creditor_name: "", creditor_reference: "", claimed_amount: 0, notes: "" });
    setShowAdd(false);
    reload();
  };

  const totalClaimed = proofs.reduce((s, p) => s + p.claimed_amount, 0);
  const totalAdmitted = proofs.reduce((s, p) => s + p.admitted_amount, 0);

  return (
    <div className="space-y-4 p-1">
      <div className="panel p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileSignature className="h-5 w-5 text-blue-500" />
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Proof of Debt Submissions</h3>
          </div>
          <button onClick={() => setShowAdd(!showAdd)} className="btn btn-secondary text-xs">
            <Plus className="h-3.5 w-3.5" /> Add PoD
          </button>
        </div>

        {proofs.length > 0 && (
          <div className="mb-4 grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
              <p className="text-[10px] font-bold uppercase text-slate-400">Total Claimed</p>
              <p className="text-lg font-bold text-slate-700 dark:text-slate-300">{formatCurrency(totalClaimed)}</p>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-500/30 dark:bg-emerald-500/10">
              <p className="text-[10px] font-bold uppercase text-emerald-600 dark:text-emerald-400">Total Admitted</p>
              <p className="text-lg font-bold text-emerald-700 dark:text-emerald-300">{formatCurrency(totalAdmitted)}</p>
            </div>
          </div>
        )}

        {showAdd && (
          <div className="mb-4 space-y-3 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <input className="input" placeholder="Creditor name" value={newPod.creditor_name} onChange={(e) => setNewPod({ ...newPod, creditor_name: e.target.value })} />
              <input className="input" placeholder="Creditor reference" value={newPod.creditor_reference} onChange={(e) => setNewPod({ ...newPod, creditor_reference: e.target.value })} />
            </div>
            <input type="number" className="input" placeholder="Claimed amount (£)" value={newPod.claimed_amount || ""} onChange={(e) => setNewPod({ ...newPod, claimed_amount: parseFloat(e.target.value) || 0 })} />
            <textarea className="input" rows={2} placeholder="Notes" value={newPod.notes} onChange={(e) => setNewPod({ ...newPod, notes: e.target.value })} />
            <button onClick={handleAdd} className="btn btn-primary bg-blue-600 text-xs hover:bg-blue-700">
              <FileSignature className="h-3.5 w-3.5" /> Submit PoD
            </button>
          </div>
        )}

        {proofs.length === 0 ? (
          <div className="py-6 text-center">
            <FileSignature className="mx-auto mb-2 h-8 w-8 text-slate-300 dark:text-slate-600" />
            <p className="text-xs text-slate-400">No Proof of Debt submissions yet</p>
          </div>
        ) : (
          <div className="space-y-2">
            {proofs.map((pod) => (
              <div key={pod.id} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-700 dark:text-slate-300">{pod.creditor_name}</p>
                    <p className="text-[10px] text-slate-400">
                      Ref: {pod.creditor_reference ?? "N/A"} · Submitted {formatDateShort(pod.created_at)}
                    </p>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${POD_STATUS_STYLES[pod.status]}`}>
                    {pod.status.replace(/_/g, " ").toUpperCase()}
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-4 text-xs">
                  <span className="text-slate-500">Claimed: <strong className="text-slate-700 dark:text-slate-300">{formatCurrency(pod.claimed_amount)}</strong></span>
                  <span className="text-slate-500">Admitted: <strong className="text-emerald-600 dark:text-emerald-400">{formatCurrency(pod.admitted_amount)}</strong></span>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <select
                    value={pod.status}
                    onChange={async (e) => { await updateProofOfDebt(pod.id, { status: e.target.value as ProofOfDebtStatus, reviewed_by: "IP", reviewed_at: new Date().toISOString() }); reload(); }}
                    className="input w-40 text-xs"
                  >
                    <option value="submitted">Submitted</option>
                    <option value="under_review">Under Review</option>
                    <option value="admitted">Admitted</option>
                    <option value="partially_admitted">Partially Admitted</option>
                    <option value="rejected">Rejected</option>
                  </select>
                  <input
                    type="number"
                    placeholder="Admitted £"
                    className="input w-28 text-xs"
                    value={pod.admitted_amount || ""}
                    onChange={async (e) => { await updateProofOfDebt(pod.id, { admitted_amount: parseFloat(e.target.value) || 0 }); reload(); }}
                  />
                  <button onClick={async () => { await deleteProofOfDebt(pod.id); reload(); }} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
