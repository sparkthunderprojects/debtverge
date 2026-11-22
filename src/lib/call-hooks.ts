import { supabase } from "./supabase";

/* ---------- labels ---------- */
export const OUTCOME_LABEL: Record<string, string> = {
  spoke_to_client: "Spoke to the client", spoke_to_third_party: "Spoke to someone else", no_answer: "No answer", voicemail_left: "Left a voicemail",
  wrong_number: "Wrong number", call_back_requested: "Call back requested", payment_promised: "Payment promised", other: "Other", pending: "Awaiting wrap-up",
};
export const CALL_STATUS_LABEL: Record<string, string> = {
  ringing: "Ringing", answered: "Connected", on_hold: "On hold", transferred: "Transferred", completed: "Completed", missed: "Missed", voicemail: "Voicemail", failed: "Failed",
};
export const CHECKLIST: { key: string; label: string; hint?: string }[] = [
  { key: "recording_notice", label: "Told the client the call may be recorded" },
  { key: "identity_checked", label: "Checked who they were speaking to" },
  { key: "affordability_discussed", label: "Talked through what the client can afford" },
  { key: "vulnerability_considered", label: "Asked about and considered vulnerability" },
  { key: "options_explained", label: "Explained the options clearly" },
  { key: "fees_explained", label: "Explained any fees and charges" },
  { key: "no_pressure", label: "No pressure on the client" },
  { key: "accurate_information", label: "Information given was accurate" },
  { key: "next_steps_agreed", label: "Next steps agreed" },
];
/** The AI draft names its suggestions with its own keys; this maps them to our checklist so it can only ever suggest. */
export const AI_CHECK_MAP: Record<string, string> = {
  recording_notice_given: "recording_notice", identity_checked: "identity_checked", fees_explained: "fees_explained", options_explained: "options_explained",
  vulnerability_considered: "vulnerability_considered", next_steps_agreed: "next_steps_agreed",
};
export const REVIEW_OUTCOME_LABEL: Record<string, string> = { compliant: "Compliant", minor_issues: "Minor issues", major_issues: "Major issues", non_compliant: "Non-compliant" };
export const REVIEW_STATUS_LABEL: Record<string, string> = {
  none: "Not reviewed", assigned: "Assigned", in_review: "In review", pending_approval: "Awaiting approval", approved: "Approved", rejected: "Sent back", escalated: "Escalated",
};
export const PRIORITY_LABEL: Record<string, string> = { low: "Low", normal: "Normal", high: "High", critical: "Critical" };
export const RISK_TYPES: Record<string, string> = {
  vulnerability: "Vulnerability", complaint: "Possible complaint", mis_selling: "Mis-selling", missing_notice: "Missing recording notice", pressure: "Pressure on the client",
  inaccurate_information: "Inaccurate information", data_protection: "Data protection", other: "Other",
};
export const NOTE_TAGS: Record<string, string> = { general: "General", financial: "Financial", vulnerability: "Vulnerability", complaint: "Complaint", promise: "Promise to the client", follow_up: "Follow-up" };
export const COACHING_TYPES: Record<string, string> = { feedback: "Feedback", training: "Training", shadowing: "Shadowing", script_review: "Script review", performance_plan: "Performance plan", other: "Other" };

/* ---------- types ---------- */
export interface CallRow {
  id: string; direction: "inbound" | "outbound"; status: string; phone: string | null; started_at: string; duration_seconds: number; outcome: string; summary: string | null;
  adviser_name: string | null; recording_status: string; recording_notice_given: boolean | null; vulnerability_flag: boolean; possible_complaint: boolean; source: string;
  draft_count: number; reviewed: boolean; has_recording: boolean; has_transcript: boolean;
}
export interface AiDraft { id: string; kind: "transcript" | "summary" | "analysis"; body: string; payload: string | null; model: string; model_version: string | null; confidence: number | null; status: "draft" | "approved" | "amended" | "rejected"; final_body: string | null; decided_at: string | null }
export interface Participant { id: string; name: string; role: string | null; type: string; joined_at: string; left_at: string | null }
export interface CallNote { id: string; text: string; tag: string; follow_up: boolean; due: string | null; completed: boolean; at: string; by: string | null }
export interface ReviewStep { step: string; detail: unknown; at: string; by: string | null }
export interface ReviewFull {
  id: string; status: string; priority: string; reviewer_id: string | null; reviewer: string | null; due_date: string | null; outcome: string | null; score: number | null;
  checklist: Record<string, string> | null; issues: { severity: string; text: string }[] | null; corrective_actions: { text: string }[] | null; comments: string | null; decision_note: string | null;
  is_escalated: boolean; escalation_reason: string | null; mine: boolean; submitted_at: string | null; approved_at: string | null;
  steps: ReviewStep[]; assignments: { to: string | null; status: string; assigned_at: string; reason: string | null }[];
}
export interface ReviewForAdviser { status: string; outcome: string | null; score: number | null; issues: { severity: string; text: string }[] | null; corrective_actions: { text: string }[] | null }
export interface RiskRow { id: string; type: string; severity: string; description: string; status: string; raised_at: string }
export interface CallDetail {
  call: Record<string, unknown> & {
    id: string; case_id: string | null; organization_id: string; direction: "inbound" | "outbound"; status: string; phone: string | null; started_at: string; duration_seconds: number; outcome: string; summary: string | null;
    adviser_id: string | null; recording_status: string; recording_notice_given: boolean | null; vulnerability_flag: boolean; possible_complaint: boolean; caller_name: string | null; transfer_kind: string | null; transfer_target: string | null;
  };
  has_recording: boolean; has_transcript: boolean; can_hear: boolean; can_download: boolean; can_read_transcript: boolean; is_compliance_manager: boolean;
  events: { event: string; detail: Record<string, unknown>; at: string; by: string | null }[];
  drafts: AiDraft[]; participants: Participant[]; notes: CallNote[];
  recording_events: { event: string; reason: string | null; at: string; seconds: number | null }[];
  callbacks: { id: string; scheduled_at: string; status: string; priority: number }[];
  risks: RiskRow[]; review: (ReviewFull | ReviewForAdviser) | null;
}
export interface PendingCall { id: string; case_id: string; case_number: string; debtor_name: string; direction: string; status: string; phone: string | null; started_at: string; duration_seconds: number }
export interface UnmatchedCall { id: string; direction: string; status: string; phone: string | null; to_number: string | null; started_at: string; duration_seconds: number; outcome: string }
export interface Presence { user_id: string; name: string; role_name: string; status: string; extension: string | null }
export interface Callback { id: string; case_id: string; case_number: string; customer_name: string | null; phone: string; scheduled_at: string; status: string; priority: number; notes: string | null; adviser_name: string | null }
export interface TimelineItem { kind: string; title: string; body: string; at: string; who: string | null; call_id: string | null }
export interface TelephonySettings {
  record_calls: boolean; recording_notice_text: string; retention_years: number; transcription_enabled: boolean; ai_analysis_enabled: boolean; require_second_approver: boolean;
  provider: string | null; can_edit: boolean; numbers: { e164: string; label: string | null }[];
}
export interface QueueRow {
  review_id: string; call_id: string; case_id: string | null; case_number: string | null; adviser_name: string | null; reviewer_id: string | null; reviewer_name: string | null; status: string; priority: string;
  due_date: string | null; overdue: boolean; outcome: string | null; score: number | null; is_escalated: boolean; escalated_to_name: string | null; call_started_at: string; direction: string; duration_seconds: number; mine: boolean | null;
}
export interface UnreviewedRow { call_id: string; case_id: string | null; case_number: string | null; adviser_name: string | null; started_at: string; direction: string; duration_seconds: number; outcome: string; reasons: string[] }
export interface Dashboard {
  days: number; calls: number; recorded: number; reviewed: number; avg_score: number | null; outcomes: Record<string, number>; awaiting_reviewer: number; in_progress: number; pending_approval: number;
  overdue: number; escalated: number; flagged_unreviewed: number; no_notice: number; recording_gaps: number; coaching_open: number; coaching_overdue: number; open_risks: number;
  recent: { call_id: string; started_at: string; direction: string; outcome: string; adviser: string | null; review_status: string | null; review_outcome: string | null }[];
  attention: { kind: string; call_id: string; review_id: string | null; label: string; at: string }[];
}
export interface SearchRow {
  call_id: string; case_id: string | null; case_number: string | null; started_at: string; direction: string; phone: string | null; duration_seconds: number; outcome: string; summary: string; adviser: string | null;
  vulnerability_flag: boolean; possible_complaint: boolean; recording_notice_given: boolean | null; has_recording: boolean; review_status: string | null; review_outcome: string | null; score: number | null;
}
export interface SearchFilters { from?: string; to?: string; adviser?: string; direction?: string; outcome?: string; review_status?: string; phone?: string; q?: string; flagged?: boolean; no_notice?: boolean }
export interface AdviserQa {
  advisers: { adviser_id: string; name: string | null; calls: number; reviewed: number; avg_score: number | null; previous_avg_score: number | null; compliant: number; minor_issues: number; major_issues: number; non_compliant: number; coaching_open: number }[];
  common_failures: { item: string; count: number }[];
}
export interface RiskListRow { id: string; call_id: string; case_id: string | null; case_number: string | null; risk_type: string; severity: string; description: string; status: string; raised_at: string; raised_by_name: string | null; resolved_at: string | null; resolution_note: string | null }
export interface CoachingRow {
  id: string; adviser_id?: string; adviser_name?: string; action_type: string; title: string; description: string | null; status: string; priority: string; due_date: string | null; overdue: boolean;
  assigned_by_name?: string | null; review_id?: string | null; call_id: string | null; completed_at?: string | null; completion_notes?: string | null; feedback_text: string | null; manager_rating: number | null;
}
export interface AuditRow { at: string; user_id: string | null; user_name: string | null; action: string; call_id: string; detail: Record<string, unknown> | null }
export interface Report { title: string; from: string; to: string; columns: string[]; rows: (string | number | null)[][]; generated_at: string }

/* ---------- plumbing ---------- */
async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}
async function fn<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let msg = error.message;
    try { const ctx = (error as { context?: Response }).context; if (ctx) msg = (await ctx.json()).error ?? msg; } catch { /* keep default */ }
    throw new Error(msg);
  }
  return data as T;
}

/* ---------- live calls ---------- */
export const startCall = (caseId: string, phone: string) => rpc<{ call_id: string; record: boolean; notice: string | null; phone: string }>("dv_call_start", { p_case: caseId, p_phone: phone });
export const getCallToken = () => fn<{ token: string; identity: string; expires_in: number }>("call-token", {});
export type LiveAction = "hold" | "resume" | "pause_recording" | "resume_recording" | "transfer" | "participant_add" | "participant_remove";
export const callControl = (callId: string, action: LiveAction, extra: Record<string, unknown> = {}) => fn<{ ok: true }>("call-control", { call_id: callId, action, ...extra });
export const addCallNote = (callId: string, text: string, tag = "general", followUp = false, due: string | null = null) => rpc<string>("dv_call_note_add", { p_call: callId, p_text: text, p_tag: tag, p_follow_up: followUp, p_due: due });
export const completeCallNote = (noteId: string) => rpc<void>("dv_call_note_complete", { p_note: noteId });
export const finishCall = (callId: string, o: { outcome: string; summary: string; noticeGiven: boolean | null; vulnerability: boolean; possibleComplaint: boolean; followUp: string | null }) =>
  rpc<void>("dv_call_finish", { p_call: callId, p_outcome: o.outcome, p_summary: o.summary, p_notice: o.noticeGiven, p_vulnerability: o.vulnerability, p_possible_complaint: o.possibleComplaint, p_follow_up: o.followUp });
export const fetchPendingCalls = () => rpc<PendingCall[]>("dv_my_calls_pending");
export const fetchUnmatched = () => rpc<UnmatchedCall[]>("dv_call_unmatched");
export const attachCallToCase = (callId: string, caseId: string) => rpc<void>("dv_call_attach_case", { p_call: callId, p_case: caseId });
export const dismissCall = (callId: string, reason: string) => rpc<void>("dv_call_dismiss", { p_call: callId, p_reason: reason });
export const setPresence = (status: string, extension?: string) => rpc<void>("dv_presence_set", { p_status: status, p_extension: extension ?? null });
export const fetchPresence = () => rpc<Presence[]>("dv_team_presence");
export const scheduleCallback = (caseId: string, phone: string, at: string, priority: number, notes: string, callId?: string) =>
  rpc<string>("dv_call_callback_schedule", { p_case: caseId, p_phone: phone, p_at: at, p_priority: priority, p_notes: notes || null, p_call: callId ?? null });
export const fetchCallbacks = (caseId?: string) => rpc<Callback[]>("dv_call_callbacks", { p_case: caseId ?? null });
export const updateCallback = (id: string, status: string) => rpc<void>("dv_call_callback_update", { p_id: id, p_status: status });
export const fetchCallTimeline = (caseId: string) => rpc<TimelineItem[]>("dv_call_timeline", { p_case: caseId });
export const fetchTelephony = () => rpc<TelephonySettings>("dv_telephony_get");
export const saveTelephony = (s: Omit<TelephonySettings, "provider" | "can_edit" | "numbers">) =>
  rpc<void>("dv_telephony_set", { p_record: s.record_calls, p_notice: s.recording_notice_text, p_years: s.retention_years, p_transcription: s.transcription_enabled, p_ai: s.ai_analysis_enabled, p_second_approver: s.require_second_approver });

/* ---------- call records ---------- */
export const fetchCalls = (caseId: string) => rpc<CallRow[]>("dv_call_list", { p_case: caseId });
export const fetchCallDetail = (callId: string) => rpc<CallDetail>("dv_call_detail", { p_call: callId });
export const fetchTranscript = (callId: string) => rpc<{ body: string; language: string | null; confidence: number | null } | null>("dv_call_transcript", { p_call: callId });
export const recordingLink = (callId: string, download = false) => fn<{ url: string; expires_in: number }>("call-recording-link", { call_id: callId, download });
export const analyseCall = (callId: string) => fn<{ status: string; drafts?: string[] }>("call-ai-analyse", { call_id: callId });
export const decideDraft = (draftId: string, decision: "approve" | "amend" | "reject", finalBody?: string) => rpc<void>("dv_call_ai_decide", { p_draft: draftId, p_decision: decision, p_final_body: finalBody ?? null });
export interface LogCallInput { caseId: string; direction: "inbound" | "outbound"; phone: string; startedAt: string; durationSeconds: number; outcome: string; summary: string; noticeGiven: boolean | null; vulnerability: boolean; possibleComplaint: boolean; followUp: string | null }
export const logCall = (i: LogCallInput) => rpc<string>("dv_call_log", {
  p_case: i.caseId, p_direction: i.direction, p_phone: i.phone || null, p_started_at: i.startedAt, p_duration_seconds: i.durationSeconds, p_outcome: i.outcome, p_summary: i.summary || null,
  p_notice_given: i.noticeGiven, p_vulnerability: i.vulnerability, p_possible_complaint: i.possibleComplaint, p_follow_up: i.followUp || null,
});

/* ---------- compliance ---------- */
export const fetchDashboard = (days = 30) => rpc<Dashboard>("dv_compliance_dashboard", { p_days: days });
export const fetchQueue = (filter: string) => rpc<QueueRow[]>("dv_compliance_queue", { p_filter: filter });
export const fetchUnreviewed = (limit = 50) => rpc<UnreviewedRow[]>("dv_compliance_unreviewed", { p_limit: limit });
export const searchCalls = (filters: SearchFilters, limit = 50, offset = 0) => rpc<{ total: number; rows: SearchRow[] }>("dv_compliance_search", { p_filters: filters, p_limit: limit, p_offset: offset });
export const fetchAdviserQa = (days = 30, adviser?: string) => rpc<AdviserQa>("dv_compliance_adviser_qa", { p_days: days, p_adviser: adviser ?? null });
export const assignReview = (callId: string, reviewer: string | null, priority: string, due: string | null) => rpc<string>("dv_compliance_assign", { p_call: callId, p_reviewer: reviewer, p_priority: priority, p_due: due });
export const claimReview = (id: string) => rpc<void>("dv_compliance_claim", { p_review: id });
export const startReview = (id: string) => rpc<void>("dv_compliance_start", { p_review: id });
export const submitReview = (id: string, outcome: string, checklist: Record<string, string>, issues: { severity: string; text: string }[], actions: { text: string }[], comments: string) =>
  rpc<number>("dv_compliance_submit", { p_review: id, p_outcome: outcome, p_checklist: checklist, p_issues: issues, p_actions: actions, p_comments: comments || null });
export const decideReview = (id: string, decision: "approve" | "reject", note: string) => rpc<void>("dv_compliance_decide", { p_review: id, p_decision: decision, p_note: note || null });
export const escalateReview = (id: string, to: string | null, reason: string) => rpc<void>("dv_compliance_escalate", { p_review: id, p_to: to, p_reason: reason });
export const reassignReview = (id: string, reviewer: string, reason: string) => rpc<void>("dv_compliance_reassign", { p_review: id, p_reviewer: reviewer, p_reason: reason });
export const declineReview = (id: string, reason: string) => rpc<void>("dv_compliance_decline", { p_review: id, p_reason: reason });
export const extendReview = (id: string, due: string, reason: string) => rpc<void>("dv_compliance_extend", { p_review: id, p_due: due, p_reason: reason });
export const raiseRisk = (callId: string, type: string, severity: string, description: string) => rpc<string>("dv_call_risk_raise", { p_call: callId, p_type: type, p_severity: severity, p_description: description });
export const resolveRisk = (id: string, note: string) => rpc<void>("dv_call_risk_resolve", { p_risk: id, p_note: note });
export const fetchRisks = (status: string) => rpc<RiskListRow[]>("dv_compliance_risks", { p_status: status });
export const assignCoaching = (a: { adviser: string; type: string; title: string; description: string; priority: string; due: string | null; review?: string; call?: string }) =>
  rpc<string>("dv_coaching_assign", { p_adviser: a.adviser, p_type: a.type, p_title: a.title, p_description: a.description || null, p_priority: a.priority, p_due: a.due, p_review: a.review ?? null, p_call: a.call ?? null });
export const fetchCoachingList = (scope: string, adviser?: string) => rpc<CoachingRow[]>("dv_coaching_list", { p_scope: scope, p_adviser: adviser ?? null });
export const updateCoaching = (id: string, status: string, notes: string) => rpc<void>("dv_coaching_update", { p_id: id, p_status: status, p_notes: notes || null });
export const reviewCoaching = (id: string, rating: number, feedback: string) => rpc<void>("dv_coaching_review", { p_id: id, p_rating: rating, p_feedback: feedback || null });
export const cancelCoaching = (id: string, reason: string) => rpc<void>("dv_coaching_cancel", { p_id: id, p_reason: reason });
export const fetchMyCoaching = () => rpc<CoachingRow[]>("dv_my_coaching");
export const fetchAudit = (o: { limit?: number; action?: string; from?: string; to?: string; user?: string } = {}) =>
  rpc<AuditRow[]>("dv_compliance_audit", { p_limit: o.limit ?? 200, p_action: o.action ?? null, p_from: o.from ?? null, p_to: o.to ?? null, p_user: o.user ?? null });
export const fetchReport = (type: string, from: string, to: string) => rpc<Report>("dv_compliance_report", { p_type: type, p_from: from, p_to: to });

/* ---------- helpers ---------- */
export const fmtWhen = (s: string) => new Date(s).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
export const fmtDate = (s: string) => new Date(s).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
export const fmtDuration = (s: number) => (s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${s % 60 ? ` ${s % 60}s` : ""}`);
export const fmtClock = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
export const csvOf = (columns: string[], rows: (string | number | null)[][]) => {
  const cell = (v: string | number | null) => { let t = v == null ? "" : String(v); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return `"${t.replace(/"/g, '""')}"`; };   // stops spreadsheet formula injection
  return [columns, ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
};
export const downloadText = (name: string, text: string, type = "text/csv") => {
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

export interface Person { user_id: string; name: string; role_name: string; is_manager: boolean }
export const fetchPeople = () => rpc<Person[]>("dv_compliance_people");
