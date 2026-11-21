import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import type {
  IPDetails, IPRoleType,
  DocumentChecklistItem, DocumentType, DocumentStatus, UploadedByRole,
  IVAProposalData, ProposalStatus,
  CreditorVote, CreditorVoteChoice,
  ProofOfDebt, ProofOfDebtStatus,
  SignpostingAssessment, SignpostingRoute,
  IVAContribution, ContributionStatus, PaymentMethod,
  IVADistributionRun, IVADistributionItem, DistributionRunStatus,
} from "./types";

// ============================================================
// IP Details
// ============================================================

export function useIPDetails(caseId: string | null) {
  const [data, setData] = useState<IPDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!caseId) { setData(null); setLoading(false); return; }
    setLoading(true);
    supabase
      .from("debt_ip_details")
      .select("*")
      .eq("case_id", caseId)
      .maybeSingle()
      .then(({ data: row, error: err }) => {
        setData((row as IPDetails | null) ?? null);
        setError(err?.message ?? null);
        setLoading(false);
      });
  }, [caseId]);

  return { data, loading, error };
}

export async function upsertIPDetails(
  caseId: string,
  patch: Partial<Omit<IPDetails, "id" | "case_id" | "created_at" | "updated_at">>,
): Promise<IPDetails> {
  const payload: Record<string, unknown> = { case_id: caseId, ...patch };
  const { data, error } = await supabase
    .from("debt_ip_details")
    .upsert(payload, { onConflict: "case_id" })
    .select("*")
    .single();
  if (error) throw error;
  return data as IPDetails;
}

// ============================================================
// Document Checklist
// ============================================================

export function useDocumentChecklist(caseId: string | null) {
  const [data, setData] = useState<DocumentChecklistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    if (!caseId) { setData([]); setLoading(false); return; }
    setLoading(true);
    supabase
      .from("debt_document_checklist")
      .select("*")
      .eq("case_id", caseId)
      .order("created_at", { ascending: false })
      .then(({ data: rows, error: err }) => {
        setData((rows as DocumentChecklistItem[] | null) ?? []);
        setError(err?.message ?? null);
        setLoading(false);
      });
  }, [caseId]);

  useEffect(() => { reload(); }, [reload]);
  return { data, loading, error, reload };
}

export async function addDocumentChecklistItem(
  caseId: string,
  input: {
    document_type: DocumentType;
    file_name: string;
    file_url?: string;
    file_size_bytes?: number;
    uploaded_by_role?: UploadedByRole;
    notes?: string;
  },
): Promise<DocumentChecklistItem> {
  const { data, error } = await supabase
    .from("debt_document_checklist")
    .insert({
      case_id: caseId,
      document_type: input.document_type,
      file_name: input.file_name,
      file_url: input.file_url ?? null,
      file_size_bytes: input.file_size_bytes ?? 0,
      uploaded_by_role: input.uploaded_by_role ?? "advisor",
      notes: input.notes ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as DocumentChecklistItem;
}

export async function updateDocumentChecklistItem(
  id: string,
  patch: Partial<{
    status: DocumentStatus;
    reviewed_by: string;
    reviewed_at: string;
    rejection_reason: string;
    notes: string;
    file_url: string;
  }>,
): Promise<DocumentChecklistItem> {
  const { data, error } = await supabase
    .from("debt_document_checklist")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data as DocumentChecklistItem;
}

export async function deleteDocumentChecklistItem(id: string): Promise<void> {
  const { error } = await supabase.from("debt_document_checklist").delete().eq("id", id);
  if (error) throw error;
}

// ============================================================
// IVA Proposals
// ============================================================

export function useIVAProposal(caseId: string | null) {
  const [data, setData] = useState<IVAProposalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!caseId) { setData(null); setLoading(false); return; }
    setLoading(true);
    supabase
      .from("debt_iva_proposals")
      .select("*")
      .eq("case_id", caseId)
      .maybeSingle()
      .then(({ data: row, error: err }) => {
        setData((row as IVAProposalData | null) ?? null);
        setError(err?.message ?? null);
        setLoading(false);
      });
  }, [caseId]);

  return { data, loading, error };
}

export async function upsertIVAProposal(
  caseId: string,
  patch: Partial<Omit<IVAProposalData, "id" | "case_id" | "created_at" | "updated_at">>,
): Promise<IVAProposalData> {
  const payload: Record<string, unknown> = { case_id: caseId, ...patch };
  const { data, error } = await supabase
    .from("debt_iva_proposals")
    .upsert(payload, { onConflict: "case_id" })
    .select("*")
    .single();
  if (error) throw error;
  return data as IVAProposalData;
}

// ============================================================
// Creditor Votes
// ============================================================

export function useCreditorVotes(caseId: string | null) {
  const [data, setData] = useState<CreditorVote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    if (!caseId) { setData([]); setLoading(false); return; }
    setLoading(true);
    supabase
      .from("debt_creditor_votes")
      .select("*")
      .eq("case_id", caseId)
      .order("submitted_at", { ascending: false })
      .then(({ data: rows, error: err }) => {
        setData((rows as CreditorVote[] | null) ?? []);
        setError(err?.message ?? null);
        setLoading(false);
      });
  }, [caseId]);

  useEffect(() => { reload(); }, [reload]);
  return { data, loading, error, reload };
}

export async function addCreditorVote(
  caseId: string,
  input: {
    proposal_id?: string;
    creditor_id: string;
    claimed_debt_amount: number;
    vote: CreditorVoteChoice;
    modification_notes?: string;
    proxy_form_url?: string;
    submitted_by?: string;
  },
): Promise<CreditorVote> {
  const { data, error } = await supabase
    .from("debt_creditor_votes")
    .insert({
      case_id: caseId,
      proposal_id: input.proposal_id ?? null,
      creditor_id: input.creditor_id,
      claimed_debt_amount: input.claimed_debt_amount,
      vote: input.vote,
      modification_notes: input.modification_notes ?? null,
      proxy_form_url: input.proxy_form_url ?? null,
      submitted_by: input.submitted_by ?? null,
      submitted_at: new Date().toISOString(),
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as CreditorVote;
}

export async function updateCreditorVote(
  id: string,
  patch: Partial<{ vote: CreditorVoteChoice; modification_notes: string; claimed_debt_amount: number }>,
): Promise<CreditorVote> {
  const { data, error } = await supabase
    .from("debt_creditor_votes")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data as CreditorVote;
}

export async function deleteCreditorVote(id: string): Promise<void> {
  const { error } = await supabase.from("debt_creditor_votes").delete().eq("id", id);
  if (error) throw error;
}

// ============================================================
// Proof of Debt
// ============================================================

export function useProofOfDebt(caseId: string | null) {
  const [data, setData] = useState<ProofOfDebt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    if (!caseId) { setData([]); setLoading(false); return; }
    setLoading(true);
    supabase
      .from("debt_proof_of_debt")
      .select("*")
      .eq("case_id", caseId)
      .order("created_at", { ascending: false })
      .then(({ data: rows, error: err }) => {
        setData((rows as ProofOfDebt[] | null) ?? []);
        setError(err?.message ?? null);
        setLoading(false);
      });
  }, [caseId]);

  useEffect(() => { reload(); }, [reload]);
  return { data, loading, error, reload };
}

export async function addProofOfDebt(
  caseId: string,
  input: {
    creditor_id?: string;
    creditor_name: string;
    creditor_reference?: string;
    claimed_amount: number;
    pod_form_url?: string;
    supporting_documents_url?: string[];
    notes?: string;
  },
): Promise<ProofOfDebt> {
  const { data, error } = await supabase
    .from("debt_proof_of_debt")
    .insert({
      case_id: caseId,
      creditor_id: input.creditor_id ?? null,
      creditor_name: input.creditor_name,
      creditor_reference: input.creditor_reference ?? null,
      claimed_amount: input.claimed_amount,
      pod_form_url: input.pod_form_url ?? null,
      supporting_documents_url: input.supporting_documents_url ?? [],
      notes: input.notes ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as ProofOfDebt;
}

export async function updateProofOfDebt(
  id: string,
  patch: Partial<{
    status: ProofOfDebtStatus;
    admitted_amount: number;
    reviewed_by: string;
    reviewed_at: string;
    rejection_reason: string;
    notes: string;
  }>,
): Promise<ProofOfDebt> {
  const { data, error } = await supabase
    .from("debt_proof_of_debt")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data as ProofOfDebt;
}

export async function deleteProofOfDebt(id: string): Promise<void> {
  const { error } = await supabase.from("debt_proof_of_debt").delete().eq("id", id);
  if (error) throw error;
}

// ============================================================
// Batch load helpers (for context provider)
// ============================================================

export async function loadAllInsolvencyData(caseId: string) {
  const [ipRes, docRes, proposalRes, votesRes, podRes] = await Promise.all([
    supabase.from("debt_ip_details").select("*").eq("case_id", caseId).maybeSingle(),
    supabase.from("debt_document_checklist").select("*").eq("case_id", caseId).order("created_at", { ascending: false }),
    supabase.from("debt_iva_proposals").select("*").eq("case_id", caseId).maybeSingle(),
    supabase.from("debt_creditor_votes").select("*").eq("case_id", caseId).order("submitted_at", { ascending: false }),
    supabase.from("debt_proof_of_debt").select("*").eq("case_id", caseId).order("created_at", { ascending: false }),
  ]);
  return {
    ipDetails: (ipRes.data as IPDetails | null) ?? null,
    documentChecklist: (docRes.data as DocumentChecklistItem[] | null) ?? [],
    ivaProposalData: (proposalRes.data as IVAProposalData | null) ?? null,
    creditorVotes: (votesRes.data as CreditorVote[] | null) ?? [],
    proofOfDebt: (podRes.data as ProofOfDebt[] | null) ?? [],
  };
}

// ============================================================
// Signposting Assessments
// ============================================================

export function useSignpostingAssessment(caseId: string | null) {
  const [data, setData] = useState<SignpostingAssessment | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!caseId) { setData(null); setLoading(false); return; }
    setLoading(true);
    supabase
      .from("debt_signposting_assessments")
      .select("*")
      .eq("case_id", caseId)
      .maybeSingle()
      .then(({ data: row, error: err }) => {
        setData((row as SignpostingAssessment | null) ?? null);
        setError(err?.message ?? null);
        setLoading(false);
      });
  }, [caseId]);

  return { data, loading, error };
}

export async function saveSignpostingAssessment(
  caseId: string | null,
  input: Omit<SignpostingAssessment, "id" | "case_id" | "created_at" | "updated_at"> & { case_id?: string },
): Promise<SignpostingAssessment> {
  const payload: Record<string, unknown> = {
    total_debt: input.total_debt,
    monthly_disposable_income: input.monthly_disposable_income,
    creditor_count: input.creditor_count,
    recommended_route: input.recommended_route,
    route_confidence: input.route_confidence,
    route_reasons: input.route_reasons,
    assessment_data: input.assessment_data,
  };
  const cid = caseId ?? input.case_id;
  if (cid) payload.case_id = cid;
  const { data, error } = await supabase
    .from("debt_signposting_assessments")
    .insert(payload)
    .select("*")
    .single();
  if (error) throw error;
  return data as SignpostingAssessment;
}

// ============================================================
// IVA Contributions (In-Flight Case Management)
// ============================================================

export function useIVAContributions(caseId: string | null) {
  const [data, setData] = useState<IVAContribution[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    if (!caseId) { setData([]); setLoading(false); return; }
    setLoading(true);
    supabase
      .from("debt_iva_contributions")
      .select("*")
      .eq("case_id", caseId)
      .order("contribution_date", { ascending: false })
      .then(({ data: rows, error: err }) => {
        setData((rows as IVAContribution[] | null) ?? []);
        setError(err?.message ?? null);
        setLoading(false);
      });
  }, [caseId]);

  useEffect(() => { reload(); }, [reload]);
  return { data, loading, error, reload };
}

export async function addIVAContribution(
  caseId: string,
  input: { amount: number; contribution_date: string; payment_method?: PaymentMethod; reference?: string; status?: ContributionStatus; notes?: string },
): Promise<IVAContribution> {
  const { data, error } = await supabase
    .from("debt_iva_contributions")
    .insert({
      case_id: caseId,
      amount: input.amount,
      contribution_date: input.contribution_date,
      payment_method: input.payment_method ?? null,
      reference: input.reference ?? null,
      status: input.status ?? "received",
      notes: input.notes ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as IVAContribution;
}

export async function updateIVAContribution(
  id: string,
  patch: Partial<{ amount: number; status: ContributionStatus; payment_method: PaymentMethod; reference: string; notes: string; allocated_amount: number }>,
): Promise<IVAContribution> {
  const { data, error } = await supabase
    .from("debt_iva_contributions")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data as IVAContribution;
}

export async function deleteIVAContribution(id: string): Promise<void> {
  const { error } = await supabase.from("debt_iva_contributions").delete().eq("id", id);
  if (error) throw error;
}

// ============================================================
// IVA Distribution Runs & Items
// ============================================================

export function useIVADistributionRuns(caseId: string | null) {
  const [data, setData] = useState<IVADistributionRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    if (!caseId) { setData([]); setLoading(false); return; }
    setLoading(true);
    supabase
      .from("debt_iva_distribution_runs")
      .select("*")
      .eq("case_id", caseId)
      .order("run_date", { ascending: false })
      .then(({ data: rows, error: err }) => {
        setData((rows as IVADistributionRun[] | null) ?? []);
        setError(err?.message ?? null);
        setLoading(false);
      });
  }, [caseId]);

  useEffect(() => { reload(); }, [reload]);
  return { data, loading, error, reload };
}

export function useIVADistributionItems(runId: string | null) {
  const [data, setData] = useState<IVADistributionItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!runId) { setData([]); setLoading(false); return; }
    setLoading(true);
    supabase
      .from("debt_iva_distribution_items")
      .select("*")
      .eq("run_id", runId)
      .order("distribution_amount", { ascending: false })
      .then(({ data: rows }) => {
        setData((rows as IVADistributionItem[] | null) ?? []);
        setLoading(false);
      });
  }, [runId]);

  return { data, loading };
}

export async function createDistributionRun(
  caseId: string,
  input: {
    total_collected: number;
    nominee_fee_deducted: number;
    supervisor_fee_deducted: number;
    total_disbursed: number;
    items: Array<{ creditor_id: string | null; creditor_name: string; original_debt: number; pro_rata_percent: number; distribution_amount: number }>;
    notes?: string;
  },
): Promise<IVADistributionRun> {
  const { data: runRow, error: runErr } = await supabase
    .from("debt_iva_distribution_runs")
    .insert({
      case_id: caseId,
      total_collected: input.total_collected,
      nominee_fee_deducted: input.nominee_fee_deducted,
      supervisor_fee_deducted: input.supervisor_fee_deducted,
      total_disbursed: input.total_disbursed,
      status: "calculated",
      notes: input.notes ?? null,
    })
    .select("*")
    .single();
  if (runErr) throw runErr;
  const run = runRow as IVADistributionRun;

  if (input.items.length > 0) {
    const itemPayloads = input.items.map((it) => ({
      run_id: run.id,
      case_id: caseId,
      creditor_id: it.creditor_id,
      creditor_name: it.creditor_name,
      original_debt: it.original_debt,
      pro_rata_percent: it.pro_rata_percent,
      distribution_amount: it.distribution_amount,
    }));
    const { error: itemErr } = await supabase.from("debt_iva_distribution_items").insert(itemPayloads);
    if (itemErr) throw itemErr;
  }

  return run;
}

export async function updateDistributionRunStatus(
  id: string,
  status: DistributionRunStatus,
  approvedBy?: string,
): Promise<IVADistributionRun> {
  const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
  if (status === "approved" && approvedBy) {
    patch.approved_by = approvedBy;
    patch.approved_at = new Date().toISOString();
  }
  const { data, error } = await supabase
    .from("debt_iva_distribution_runs")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data as IVADistributionRun;
}

export async function deleteDistributionRun(id: string): Promise<void> {
  const { error } = await supabase.from("debt_iva_distribution_runs").delete().eq("id", id);
  if (error) throw error;
}
