import { supabase } from "./supabase";

export const OUTCOME_LABEL: Record<string, string> = {
  spoke_to_client: "Spoke to the client", spoke_to_third_party: "Spoke to someone else", no_answer: "No answer", voicemail_left: "Left a voicemail",
  wrong_number: "Wrong number", call_back_requested: "Call back requested", payment_promised: "Payment promised", other: "Other",
};
export const CHECKLIST: { key: string; label: string }[] = [
  { key: "recording_notice", label: "Told the client the call may be recorded" },
  { key: "identity_checked", label: "Checked who they were speaking to" },
  { key: "affordability_discussed", label: "Talked through what the client can afford" },
  { key: "vulnerability_considered", label: "Asked about and considered vulnerability" },
  { key: "options_explained", label: "Explained the options clearly" },
  { key: "no_pressure", label: "No pressure on the client" },
  { key: "accurate_information", label: "Information given was accurate" },
  { key: "next_steps_agreed", label: "Next steps agreed" },
];
export const REVIEW_OUTCOME_LABEL: Record<string, string> = { pass: "Pass", pass_with_feedback: "Pass with feedback", fail: "Fail", escalated: "Escalated" };

export interface CallRow {
  id: string; direction: "inbound" | "outbound"; status: string; phone: string | null; started_at: string; duration_seconds: number; outcome: string; summary: string | null;
  adviser_name: string | null; recording_status: string; recording_notice_given: boolean | null; vulnerability_flag: boolean; possible_complaint: boolean; source: string; draft_count: number; reviewed: boolean;
}
export interface AiDraft { id: string; kind: "transcript" | "summary"; body: string; model: string; model_version: string | null; confidence: number | null; status: "draft" | "approved" | "amended" | "rejected"; final_body: string | null; decided_at: string | null }
export interface CallDetail {
  call: CallRow & { case_id: string; adviser_id: string | null };
  events: { event: string; detail: Record<string, unknown>; at: string; by: string | null }[];
  drafts: AiDraft[];
  review: null | { id?: string; status: string; outcome: string | null; checklist?: Record<string, string>; comments?: string | null; coaching_action: string | null; coaching_due: string | null; due_date?: string; mine?: boolean };
}
export interface QueueRow {
  id: string; case_id: string; case_number: string; debtor_name: string; direction: string; started_at: string; duration_seconds: number; outcome: string; adviser_id: string | null; adviser_name: string | null;
  flags: string[]; review_id: string | null; review_status: string | null; review_outcome: string | null; reviewer_name: string | null; due_date: string | null; mine: boolean | null;
}
export interface ComplianceDashboard {
  calls_30d: number; reviewed_30d: number; open_reviews: number; overdue_reviews: number; passed: number; failed: number; flagged_unreviewed: number; no_notice: number; coaching_open: number;
  by_adviser: { adviser_id: string | null; name: string | null; calls: number; reviewed: number; passed: number; failed: number }[];
}
export interface CoachingRow { review_id: string; call_id: string; case_id: string; case_number: string; debtor_name: string; outcome: string; coaching_action: string; coaching_due: string | null; done: boolean }
export interface AuditRow { at: string; action: string; user_name: string | null; call_id: string; case_number: string; debtor_name: string }

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export const fetchCalls = (caseId: string) => rpc<CallRow[]>("dv_call_list", { p_case: caseId });
export const fetchCallDetail = (callId: string) => rpc<CallDetail>("dv_call_detail", { p_call: callId });
export interface LogCallInput {
  caseId: string; direction: "inbound" | "outbound"; phone: string; startedAt: string; durationSeconds: number; outcome: string; summary: string;
  noticeGiven: boolean | null; vulnerability: boolean; possibleComplaint: boolean; followUp: string | null;
}
export const logCall = (i: LogCallInput) => rpc<string>("dv_call_log", {
  p_case: i.caseId, p_direction: i.direction, p_phone: i.phone || null, p_started_at: i.startedAt, p_duration_seconds: i.durationSeconds, p_outcome: i.outcome, p_summary: i.summary || null,
  p_notice_given: i.noticeGiven, p_vulnerability: i.vulnerability, p_possible_complaint: i.possibleComplaint, p_follow_up: i.followUp || null,
});
export const decideDraft = (draftId: string, decision: "approve" | "amend" | "reject", finalBody?: string) => rpc<void>("dv_call_ai_decide", { p_draft: draftId, p_decision: decision, p_final_body: finalBody ?? null });

export const fetchQueue = (filter: string) => rpc<QueueRow[]>("dv_compliance_queue", { p_filter: filter });
export const fetchDashboard = () => rpc<ComplianceDashboard>("dv_compliance_dashboard");
export const takeReview = (callId: string, due?: string) => rpc<string>("dv_compliance_take_review", { p_call: callId, p_due: due || null });
export const completeReview = (reviewId: string, outcome: string, checklist: Record<string, string>, comments: string, coaching: string, coachingDue: string) =>
  rpc<void>("dv_compliance_complete", { p_review: reviewId, p_outcome: outcome, p_checklist: checklist, p_comments: comments || null, p_coaching: coaching || null, p_coaching_due: coachingDue || null });
export const fetchCoaching = () => rpc<CoachingRow[]>("dv_my_coaching");
export const markCoachingDone = (reviewId: string) => rpc<void>("dv_coaching_done", { p_review: reviewId });
export const fetchAudit = () => rpc<AuditRow[]>("dv_compliance_audit", { p_limit: 200 });
