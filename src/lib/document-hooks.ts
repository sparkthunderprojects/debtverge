import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import type { DebtCase, DebtCreditor } from "./types";

export interface DocTemplate { id: string; organization_id: string | null; name: string; category: string; audience: "customer" | "creditor"; subject: string; body: string }
export interface CaseDocument { id: string; case_id: string; name: string; category: string; body: string | null; storage_path: string | null; mime_type: string | null; size_bytes: number | null; created_at: string }

export const MERGE_FIELDS = ["client_name", "case_number", "firm_name", "adviser_name", "today", "total_debt", "monthly_payment", "next_due_date", "creditor_name", "creditor_reference", "creditor_balance", "creditor_offer"] as const;

const gbp = (n: number | null | undefined) => `£${Number(n ?? 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dateGB = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "to be confirmed");

export function mergeValues(c: DebtCase, creditor: DebtCreditor | null, ctx: { firm: string; adviser: string }): Record<string, string> {
  return {
    client_name: c.debtor_name, case_number: c.case_number, firm_name: ctx.firm, adviser_name: ctx.adviser,
    today: dateGB(new Date().toISOString()), total_debt: gbp(c.total_debt), monthly_payment: gbp(c.installment_amount ?? c.monthly_disposable_income),
    next_due_date: dateGB(c.next_due_date), creditor_name: creditor?.creditor_name ?? "{{creditor_name}}",
    creditor_reference: creditor?.account_reference ?? "{{creditor_reference}}", creditor_balance: creditor ? gbp(creditor.current_balance) : "{{creditor_balance}}",
    creditor_offer: creditor ? gbp(creditor.settlement_offer ?? creditor.pro_rata_amount) : "{{creditor_offer}}",
  };
}

export const renderTemplate = (text: string, values: Record<string, string>) => text.replace(/\{\{(\w+)\}\}/g, (m, k) => values[k] ?? m);

export function useTemplates() {
  const [templates, setTemplates] = useState<DocTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    const { data } = await supabase.from("document_templates").select("*").order("name");
    setTemplates((data ?? []) as DocTemplate[]); setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  return { templates, loading, reload: load };
}

export function useCaseDocuments(caseId: string | null) {
  const [docs, setDocs] = useState<CaseDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    if (!caseId) { setDocs([]); setLoading(false); return; }
    const { data } = await supabase.from("case_documents").select("*").eq("case_id", caseId).order("created_at", { ascending: false });
    setDocs((data ?? []) as CaseDocument[]); setLoading(false);
  }, [caseId]);
  useEffect(() => { load(); }, [load]);
  return { docs, loading, reload: load };
}

export async function saveLetter(input: { case_id: string; organization_id?: string | null; name: string; category: string; template_id: string | null; body: string }) {
  const { error } = await supabase.from("case_documents").insert({ ...input, mime_type: "text/plain" });
  if (error) throw new Error(error.message);
}

export async function uploadCaseFile(caseId: string, organizationId: string | null | undefined, file: File, category: string) {
  const safe = file.name.replace(/[^\w.\- ]+/g, "_");
  const path = `${caseId}/${Date.now()}-${safe}`;
  const up = await supabase.storage.from("case-documents").upload(path, file, { contentType: file.type || undefined });
  if (up.error) throw new Error(up.error.message);
  const { error } = await supabase.from("case_documents").insert({ case_id: caseId, organization_id: organizationId ?? null, name: file.name, category, storage_path: path, mime_type: file.type, size_bytes: file.size });
  if (error) throw new Error(error.message);
}

export async function openCaseFile(path: string) {
  const { data, error } = await supabase.storage.from("case-documents").createSignedUrl(path, 120);
  if (error || !data) throw new Error(error?.message ?? "Could not open file");
  window.open(data.signedUrl, "_blank", "noopener");
}

export async function deleteCaseDocument(doc: CaseDocument) {
  if (doc.storage_path) await supabase.storage.from("case-documents").remove([doc.storage_path]);
  const { error } = await supabase.from("case_documents").delete().eq("id", doc.id);
  if (error) throw new Error(error.message);
}

export async function saveAsTemplate(org: string, t: { name: string; category: string; audience: "customer" | "creditor"; subject: string; body: string }) {
  const { error } = await supabase.from("document_templates").insert({ organization_id: org, ...t });
  if (error) throw new Error(error.message);
}

export function printLetter(subject: string, body: string) {
  const w = window.open("", "_blank");
  if (!w) return;
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  w.document.write(`<html><head><title>${esc(subject)}</title><style>body{font:14px/1.6 Arial,sans-serif;max-width:700px;margin:48px auto;white-space:pre-wrap}</style></head><body>${esc(body)}</body></html>`);
  w.document.close(); w.focus(); w.print();
}
