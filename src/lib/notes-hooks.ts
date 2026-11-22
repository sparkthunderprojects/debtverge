import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";

export type NoteKind = "general" | "call" | "meeting" | "creditor" | "vulnerability" | "agreement" | "complaint" | "internal";
export const NOTE_KINDS: { key: NoteKind; label: string }[] = [
  { key: "general", label: "General" }, { key: "call", label: "Call" }, { key: "meeting", label: "Meeting" }, { key: "creditor", label: "Creditor" },
  { key: "vulnerability", label: "Vulnerability" }, { key: "agreement", label: "Agreement" }, { key: "complaint", label: "Complaint" }, { key: "internal", label: "Internal" },
];
export type LinkType = "creditor" | "payment" | "complaint" | "document";

export interface CaseNote {
  id: string; kind: NoteKind; body: string; pinned: boolean; direction: "inbound" | "outbound" | null; contact_name: string | null; outcome: string | null;
  follow_up_on: string | null; follow_up_done: boolean | null; linked_type: LinkType | null; linked_id: string | null; client_visible: boolean; version: number;
  author_name: string | null; created_at: string; edited_at: string | null; withdrawn_at: string | null; withdraw_reason: string | null;
}
export interface NoteSearchHit { id: string; case_id: string; case_number: string; debtor_name: string; kind: NoteKind; body: string; author_name: string | null; created_at: string; withdrawn_at: string | null }
export interface NoteVersion { version: number; body: string; edited_at: string; edited_by_name: string | null }

export const QUICK_PHRASES: Record<NoteKind, string[]> = {
  general: ["Client updated us on their circumstances.", "Reviewed the file; no action needed."],
  call: ["Spoke to client. Confirmed identity. ", "Left voicemail asking client to call back.", "No answer. Will try again."],
  meeting: ["Met client to review budget and priorities.", "Client brought documents: "],
  creditor: ["Spoke to creditor. Reference: ", "Creditor agreed to freeze interest and charges.", "Creditor has not yet replied to our proposal."],
  vulnerability: ["Client disclosed a change in circumstances affecting their ability to manage. Adjustments agreed: ", "Checked in with client on wellbeing."],
  agreement: ["Client agreed to the proposed payment plan.", "Client agreed to send documents by: "],
  complaint: ["Client expressed dissatisfaction. Passed to the complaint handler.", "Update given to client on the complaint."],
  internal: ["Handover note: ", "Waiting on manager decision."],
};

export function useCaseNotes(caseId: string | null, kind: NoteKind | "all", q: string) {
  const [notes, setNotes] = useState<CaseNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    if (!caseId) { setNotes([]); setLoading(false); return; }
    const { data, error: e } = await supabase.rpc("dv_list_notes", { p_case: caseId, p_kind: kind === "all" ? null : kind, p_q: q.trim() || null });
    setError(e?.message ?? null);
    setNotes((data ?? []) as CaseNote[]);
    setLoading(false);
  }, [caseId, kind, q]);
  useEffect(() => { reload(); }, [reload]);
  return { notes, loading, error, reload };
}

export async function searchNotes(q: string, kind: NoteKind | "all"): Promise<NoteSearchHit[]> {
  const { data, error } = await supabase.rpc("dv_search_notes", { p_q: q, p_kind: kind === "all" ? null : kind });
  if (error) throw new Error(error.message);
  return (data ?? []) as NoteSearchHit[];
}

export interface NewNote {
  caseId: string; kind: NoteKind; body: string; pinned?: boolean; direction?: "inbound" | "outbound" | null; contact?: string | null; outcome?: string | null;
  followUp?: string | null; linkType?: LinkType | null; linkId?: string | null; clientVisible?: boolean;
}
export async function addNote(n: NewNote) {
  const { error } = await supabase.rpc("dv_add_note", {
    p_case: n.caseId, p_kind: n.kind, p_body: n.body, p_pinned: n.pinned ?? false, p_direction: n.direction ?? null, p_contact: n.contact ?? null, p_outcome: n.outcome ?? null,
    p_follow_up: n.followUp ?? null, p_link_type: n.linkType ?? null, p_link_id: n.linkId ?? null, p_client_visible: n.clientVisible ?? false,
  });
  if (error) throw new Error(error.message);
}
export async function editNote(id: string, body: string) {
  const { error } = await supabase.rpc("dv_edit_note", { p_id: id, p_body: body });
  if (error) throw new Error(error.message);
}
export async function withdrawNote(id: string, reason: string) {
  const { error } = await supabase.rpc("dv_withdraw_note", { p_id: id, p_reason: reason });
  if (error) throw new Error(error.message);
}
export async function pinNote(id: string, pinned: boolean) {
  const { error } = await supabase.rpc("dv_pin_note", { p_id: id, p_pinned: pinned });
  if (error) throw new Error(error.message);
}
export async function noteHistory(id: string): Promise<NoteVersion[]> {
  const { data, error } = await supabase.rpc("dv_note_history", { p_id: id });
  if (error) throw new Error(error.message);
  return (data ?? []) as NoteVersion[];
}
