import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import type {
  StormCallAdviserProfile, StormCallTelephonyProvider, StormCallSession,
  StormCallTranscript, StormCallAISummary, StormCallComplianceScore,
  StormCallComplianceAudit, StormCallTimelineEvent, StormCallCallback,
  AdviserRole, AdviserAvailability, CallDirection, CallStatus,
  ComplianceAuditAction, TimelineEventType, CallbackStatus,
} from "@/lib/types";

// ============================================================
// Adviser Profile
// ============================================================

export function useAdviserProfile() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<StormCallAdviserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user?.id) { setProfile(null); setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from("storm_call_adviser_profiles")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) setError(error.message);
    else setProfile(data as StormCallAdviserProfile | null);
    setLoading(false);
  }, [user?.id]);

  useEffect(() => { load(); }, [load]);
  return { profile, loading, error, reload: load };
}

export function useAdviserProfiles(orgId: string | null) {
  const [data, setData] = useState<StormCallAdviserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orgId) { setData([]); setLoading(false); return; }
    setLoading(true);
    supabase.from("storm_call_adviser_profiles").select("*").eq("organization_id", orgId).eq("is_active", true).order("adviser_id")
      .then(({ data, error }) => {
        if (error) setError(error.message); else setData(data as StormCallAdviserProfile[]);
        setLoading(false);
      });
  }, [orgId]);

  return { data, loading, error };
}

export async function createAdviserProfile(orgId: string, userId: string, profile: {
  adviser_id: string; team?: string; department?: string; role: AdviserRole;
  phone_extension?: string; voip_user_id?: string;
}): Promise<StormCallAdviserProfile> {
  const { data, error } = await supabase.from("storm_call_adviser_profiles").insert({
    organization_id: orgId, user_id: userId, ...profile,
  }).select().single();
  if (error) throw new Error(error.message);
  return data as StormCallAdviserProfile;
}

export async function updateAdviserAvailability(profileId: string, status: AdviserAvailability): Promise<void> {
  const { error } = await supabase.from("storm_call_adviser_profiles").update({
    availability_status: status, updated_at: new Date().toISOString(),
  }).eq("id", profileId);
  if (error) throw new Error(error.message);
}

// ============================================================
// Telephony Providers
// ============================================================

export function useTelephonyProviders(orgId: string | null) {
  const [data, setData] = useState<StormCallTelephonyProvider[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orgId) { setData([]); setLoading(false); return; }
    setLoading(true);
    supabase.from("storm_call_telephony_providers").select("*").eq("organization_id", orgId).order("created_at")
      .then(({ data, error }) => {
        if (!error && data) setData(data as StormCallTelephonyProvider[]);
        setLoading(false);
      });
  }, [orgId]);

  return { data, loading };
}

export async function createTelephonyProvider(orgId: string, provider: {
  provider_name: string; provider_type: string; api_endpoint?: string; webhook_url?: string; config?: Record<string, unknown>;
}): Promise<StormCallTelephonyProvider> {
  const { data, error } = await supabase.from("storm_call_telephony_providers").insert({
    organization_id: orgId, ...provider,
  }).select().single();
  if (error) throw new Error(error.message);
  return data as StormCallTelephonyProvider;
}

// ============================================================
// Call Sessions
// ============================================================

export function useCallSessions(orgId: string | null, adviserId?: string | null) {
  const [data, setData] = useState<StormCallSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    if (!orgId) { setData([]); setLoading(false); return; }
    setLoading(true);
    let q = supabase.from("storm_call_sessions").select("*").eq("organization_id", orgId).order("created_at", { ascending: false }).limit(100);
    if (adviserId) q = q.eq("adviser_id", adviserId);
    q.then(({ data, error }) => {
      if (error) setError(error.message); else setData(data as StormCallSession[]);
      setLoading(false);
    });

    const channel = supabase
      .channel("sc_sessions_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "storm_call_sessions", filter: `organization_id=eq.${orgId}` },
        () => {
          let q2 = supabase.from("storm_call_sessions").select("*").eq("organization_id", orgId).order("created_at", { ascending: false }).limit(100);
          if (adviserId) q2 = q2.eq("adviser_id", adviserId);
          q2.then(({ data }) => { if (data) setData(data as StormCallSession[]); });
        })
      .subscribe();
    channelRef.current = channel;

    return () => { supabase.removeChannel(channel); channelRef.current = null; };
  }, [orgId, adviserId]);

  return { data, loading, error };
}

export function useActiveCall(orgId: string | null, adviserId: string | null) {
  const [activeCall, setActiveCall] = useState<StormCallSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orgId || !adviserId) { setActiveCall(null); setLoading(false); return; }
    setLoading(true);
    supabase.from("storm_call_sessions").select("*").eq("organization_id", orgId).eq("adviser_id", adviserId)
      .in("call_status", ["ringing", "answered", "on_hold", "muted"]).order("created_at", { ascending: false }).limit(1).maybeSingle()
      .then(({ data }) => {
        setActiveCall(data as StormCallSession | null);
        setLoading(false);
      });

    const channel = supabase
      .channel("sc_active_call")
      .on("postgres_changes", { event: "*", schema: "public", table: "storm_call_sessions", filter: `adviser_id=eq.${adviserId}` },
        () => {
          supabase.from("storm_call_sessions").select("*").eq("organization_id", orgId).eq("adviser_id", adviserId)
            .in("call_status", ["ringing", "answered", "on_hold", "muted"]).order("created_at", { ascending: false }).limit(1).maybeSingle()
            .then(({ data }) => setActiveCall(data as StormCallSession | null));
        })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [orgId, adviserId]);

  return { activeCall, loading };
}

export async function startOutboundCall(orgId: string, adviserId: string, profileId: string, callData: {
  callee_phone: string; callee_name?: string; case_id?: string; customer_id?: string;
  provider_id?: string;
}): Promise<StormCallSession> {
  const { data, error } = await supabase.from("storm_call_sessions").insert({
    organization_id: orgId,
    adviser_id: adviserId,
    adviser_profile_id: profileId,
    call_direction: "outbound" as CallDirection,
    call_status: "ringing" as CallStatus,
    caller_phone: null,
    callee_phone: callData.callee_phone,
    callee_name: callData.callee_name ?? null,
    case_id: callData.case_id ?? null,
    customer_id: callData.customer_id ?? null,
    customer_identified: !!callData.customer_id,
    provider_id: callData.provider_id ?? null,
  }).select().single();
  if (error) throw new Error(error.message);

  // Add timeline event
  await addTimelineEvent(orgId, {
    customer_id: callData.customer_id,
    case_id: callData.case_id,
    event_type: "call",
    event_title: `Outbound call to ${callData.callee_name ?? callData.callee_phone}`,
    event_description: `Call initiated by adviser`,
    session_id: data.id,
    adviser_id: adviserId,
    metadata: { direction: "outbound", phone: callData.callee_phone },
  });

  return data as StormCallSession;
}

export async function answerCall(sessionId: string): Promise<void> {
  const { error } = await supabase.from("storm_call_sessions").update({
    call_status: "answered", answered_at: new Date().toISOString(),
  }).eq("id", sessionId);
  if (error) throw new Error(error.message);
}

export async function endCall(sessionId: string): Promise<void> {
  const now = new Date().toISOString();
  const { data: session } = await supabase.from("storm_call_sessions").select("answered_at").eq("id", sessionId).maybeSingle();
  let duration = 0;
  if (session?.answered_at) {
    duration = Math.round((Date.parse(now) - Date.parse(session.answered_at)) / 1000);
  }
  const { error } = await supabase.from("storm_call_sessions").update({
    call_status: "completed", ended_at: now, duration_seconds: duration,
  }).eq("id", sessionId);
  if (error) throw new Error(error.message);

  // Trigger AI processing via edge function
  await triggerAICallProcessing(sessionId).catch(() => {});
}

export async function holdCall(sessionId: string, onHold: boolean): Promise<void> {
  const { error } = await supabase.from("storm_call_sessions").update({
    call_status: onHold ? "on_hold" : "answered", is_on_hold: onHold,
  }).eq("id", sessionId);
  if (error) throw new Error(error.message);
}

export async function muteCall(sessionId: string, isMuted: boolean): Promise<void> {
  const { error } = await supabase.from("storm_call_sessions").update({
    call_status: isMuted ? "muted" : "answered", is_muted: isMuted,
  }).eq("id", sessionId);
  if (error) throw new Error(error.message);
}

export async function transferCall(sessionId: string, target: string): Promise<void> {
  const { error } = await supabase.from("storm_call_sessions").update({
    call_status: "transferred", transfer_target: target, transfer_status: "initiated",
  }).eq("id", sessionId);
  if (error) throw new Error(error.message);
}

export async function updateCallNotes(sessionId: string, notes: string): Promise<void> {
  const { error } = await supabase.from("storm_call_sessions").update({ call_notes: notes }).eq("id", sessionId);
  if (error) throw new Error(error.message);
}

// ============================================================
// Transcripts
// ============================================================

export function useTranscript(sessionId: string | null) {
  const [data, setData] = useState<StormCallTranscript | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!sessionId) { setData(null); setLoading(false); return; }
    setLoading(true);
    supabase.from("storm_call_transcripts").select("*").eq("session_id", sessionId).maybeSingle()
      .then(({ data, error }) => {
        if (!error && data) setData(data as StormCallTranscript);
        setLoading(false);
      });
  }, [sessionId]);

  return { data, loading };
}

// ============================================================
// AI Summaries
// ============================================================

export function useAISummary(sessionId: string | null) {
  const [data, setData] = useState<StormCallAISummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!sessionId) { setData(null); setLoading(false); return; }
    setLoading(true);
    supabase.from("storm_call_ai_summaries").select("*").eq("session_id", sessionId).maybeSingle()
      .then(({ data, error }) => {
        if (!error && data) setData(data as StormCallAISummary);
        setLoading(false);
      });
  }, [sessionId]);

  return { data, loading };
}

export function useAISummmaries(orgId: string | null, statusFilter?: string) {
  const [data, setData] = useState<StormCallAISummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orgId) { setData([]); setLoading(false); return; }
    setLoading(true);
    let q = supabase.from("storm_call_ai_summaries").select("*").eq("organization_id", orgId).order("created_at", { ascending: false }).limit(50);
    if (statusFilter) q = q.eq("review_status", statusFilter);
    q.then(({ data, error }) => {
      if (!error && data) setData(data as StormCallAISummary[]);
      setLoading(false);
    });
  }, [orgId, statusFilter]);

  return { data, loading };
}

export async function approveAISummary(summaryId: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from("storm_call_ai_summaries").update({
    review_status: "approved", approved_by: user?.id ?? null, approved_at: new Date().toISOString(),
  }).eq("id", summaryId);
  if (error) throw new Error(error.message);
}

export async function amendAISummary(summaryId: string, amendedText: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from("storm_call_ai_summaries").update({
    review_status: "amended", amended_text: amendedText, reviewed_by: user?.id ?? null, reviewed_at: new Date().toISOString(),
  }).eq("id", summaryId);
  if (error) throw new Error(error.message);
}

export async function addCoachingNotes(summaryId: string, notes: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from("storm_call_ai_summaries").update({
    coaching_notes: notes, reviewed_by: user?.id ?? null, reviewed_at: new Date().toISOString(),
    review_status: "reviewed",
  }).eq("id", summaryId);
  if (error) throw new Error(error.message);
}

// ============================================================
// Compliance Scores
// ============================================================

export function useComplianceScore(sessionId: string | null) {
  const [data, setData] = useState<StormCallComplianceScore | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!sessionId) { setData(null); setLoading(false); return; }
    setLoading(true);
    supabase.from("storm_call_compliance_scores").select("*").eq("session_id", sessionId).maybeSingle()
      .then(({ data, error }) => {
        if (!error && data) setData(data as StormCallComplianceScore);
        setLoading(false);
      });
  }, [sessionId]);

  return { data, loading };
}

export function useComplianceScores(orgId: string | null) {
  const [data, setData] = useState<StormCallComplianceScore[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orgId) { setData([]); setLoading(false); return; }
    setLoading(true);
    supabase.from("storm_call_compliance_scores").select("*").eq("organization_id", orgId).order("created_at", { ascending: false }).limit(50)
      .then(({ data, error }) => {
        if (!error && data) setData(data as StormCallComplianceScore[]);
        setLoading(false);
      });
  }, [orgId]);

  return { data, loading };
}

// ============================================================
// Compliance Audit
// ============================================================

export function useComplianceAudit(orgId: string | null, sessionId?: string | null) {
  const [data, setData] = useState<StormCallComplianceAudit[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orgId) { setData([]); setLoading(false); return; }
    setLoading(true);
    let q = supabase.from("storm_call_compliance_audit").select("*").eq("organization_id", orgId).order("created_at", { ascending: false }).limit(100);
    if (sessionId) q = q.eq("session_id", sessionId);
    q.then(({ data, error }) => {
      if (!error && data) setData(data as StormCallComplianceAudit[]);
      setLoading(false);
    });
  }, [orgId, sessionId]);

  return { data, loading };
}

export async function logComplianceAudit(orgId: string, entry: {
  session_id?: string; action_type: ComplianceAuditAction;
  entity_type?: string; entity_id?: string; details?: Record<string, unknown>;
}): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from("storm_call_compliance_audit").insert({
    organization_id: orgId,
    user_id: user?.id ?? null,
    user_email: user?.email ?? null,
    ...entry,
  });
  if (error) throw new Error(error.message);
}

// ============================================================
// Timeline Events
// ============================================================

export function useTimelineEvents(orgId: string | null, customerId?: string | null) {
  const [data, setData] = useState<StormCallTimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orgId || !customerId) { setData([]); setLoading(false); return; }
    setLoading(true);
    supabase.from("storm_call_timeline_events").select("*").eq("organization_id", orgId).eq("customer_id", customerId).order("event_timestamp", { ascending: false }).limit(50)
      .then(({ data, error }) => {
        if (!error && data) setData(data as StormCallTimelineEvent[]);
        setLoading(false);
      });
  }, [orgId, customerId]);

  return { data, loading };
}

export async function addTimelineEvent(orgId: string, event: {
  customer_id?: string | null; case_id?: string | null; event_type: TimelineEventType;
  event_title?: string; event_description?: string; session_id?: string;
  adviser_id?: string; adviser_name?: string; metadata?: Record<string, unknown>;
}): Promise<void> {
  const { error } = await supabase.from("storm_call_timeline_events").insert({
    organization_id: orgId,
    event_timestamp: new Date().toISOString(),
    ...event,
  });
  if (error) throw new Error(error.message);
}

// ============================================================
// Callbacks
// ============================================================

export function useCallbacks(orgId: string | null, adviserId?: string | null) {
  const [data, setData] = useState<StormCallCallback[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orgId) { setData([]); setLoading(false); return; }
    setLoading(true);
    let q = supabase.from("storm_call_callbacks").select("*").eq("organization_id", orgId).order("scheduled_at", { ascending: true });
    if (adviserId) q = q.eq("adviser_id", adviserId);
    q.then(({ data, error }) => {
      if (!error && data) setData(data as StormCallCallback[]);
      setLoading(false);
    });
  }, [orgId, adviserId]);

  return { data, loading };
}

export async function scheduleCallback(orgId: string, callback: {
  customer_id?: string; case_id?: string; adviser_id: string;
  phone_number: string; customer_name?: string; scheduled_at: string;
  priority?: number; notes?: string;
}): Promise<StormCallCallback> {
  const { data, error } = await supabase.from("storm_call_callbacks").insert({
    organization_id: orgId, ...callback,
  }).select().single();
  if (error) throw new Error(error.message);

  await addTimelineEvent(orgId, {
    customer_id: callback.customer_id,
    case_id: callback.case_id,
    event_type: "callback_scheduled",
    event_title: `Callback scheduled for ${callback.customer_name ?? callback.phone_number}`,
    event_description: callback.notes ?? undefined,
    adviser_id: callback.adviser_id,
    metadata: { scheduled_at: callback.scheduled_at, phone: callback.phone_number },
  });

  return data as StormCallCallback;
}

export async function completeCallback(callbackId: string, sessionId?: string): Promise<void> {
  const { error } = await supabase.from("storm_call_callbacks").update({
    status: "completed" as CallbackStatus, completed_at: new Date().toISOString(), session_id: sessionId ?? null,
  }).eq("id", callbackId);
  if (error) throw new Error(error.message);
}

// ============================================================
// AI Processing Trigger
// ============================================================

async function triggerAICallProcessing(sessionId: string): Promise<void> {
  const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/storm-call-ai`;
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ session_id: sessionId }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `AI processing failed (${response.status})`);
  }
}

// ============================================================
// Dashboard Stats
// ============================================================

export function useAdviserStats(orgId: string | null, adviserId: string | null) {
  const { data: sessions } = useCallSessions(orgId, adviserId);
  const { data: callbacks } = useCallbacks(orgId, adviserId);

  return {
    todaysCalls: sessions.filter((s) => s.started_at.startsWith(new Date().toISOString().split("T")[0])),
    pendingCallbacks: callbacks.filter((c) => c.status === "pending"),
    completedCalls: sessions.filter((s) => s.call_status === "completed"),
    missedCalls: sessions.filter((s) => s.call_status === "missed" || s.call_status === "failed"),
    totalCalls: sessions.length,
    totalDuration: sessions.reduce((s, c) => s + (c.duration_seconds ?? 0), 0),
  };
}
