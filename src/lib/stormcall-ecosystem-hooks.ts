import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { useOrganizations } from "@/lib/workspace-hooks";
import { endCall, holdCall, muteCall, transferCall, updateCallNotes, logComplianceAudit, addTimelineEvent } from "@/lib/stormcall-hooks";
import type { StormCallLaunchContext, StormCallNote, StormCallConferenceParticipant, StormCallRecordingEvent, NoteTag, ConferenceParticipantType } from "@/lib/types";

export interface ActiveCallState {
  sessionId: string | null;
  status: "idle" | "ringing" | "connecting" | "answered" | "on_hold" | "muted" | "completed" | "failed";
  context: StormCallLaunchContext | null;
  isRecordingPaused: boolean;
  isOnHold: boolean;
  isMuted: boolean;
  isConference: boolean;
  callStartTime: string | null;
  answeredAt: string | null;
  recordingPausedAt: string | null;
}

const IDLE_STATE: ActiveCallState = {
  sessionId: null,
  status: "idle",
  context: null,
  isRecordingPaused: false,
  isOnHold: false,
  isMuted: false,
  isConference: false,
  callStartTime: null,
  answeredAt: null,
  recordingPausedAt: null,
};

export function useStormCallEcosystem() {
  const { user } = useAuth();
  const { data: orgs } = useOrganizations();
  const orgId = orgs[0]?.id ?? null;

  const [activeCall, setActiveCall] = useState<ActiveCallState>(IDLE_STATE);
  const [notes, setNotes] = useState<StormCallNote[]>([]);
  const [conferenceParticipants, setConferenceParticipants] = useState<StormCallConferenceParticipant[]>([]);
  const [recordingEvents, setRecordingEvents] = useState<StormCallRecordingEvent[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeCall.answeredAt) { setCallDuration(0); setRecordingDuration(0); return; }
    const tick = () => {
      const seconds = Math.floor((Date.now() - new Date(activeCall.answeredAt!).getTime()) / 1000);
      setCallDuration(seconds);
      if (!activeCall.isRecordingPaused) setRecordingDuration(seconds);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [activeCall.answeredAt, activeCall.isRecordingPaused]);

  const launchCall = useCallback(async (context: StormCallLaunchContext) => {
    if (!orgId) { setActionError("No organization found"); return; }
    setActionError(null);
    setDrawerOpen(true);
    setActiveCall({
      sessionId: null,
      status: "connecting",
      context,
      isRecordingPaused: false,
      isOnHold: false,
      isMuted: false,
      isConference: false,
      callStartTime: new Date().toISOString(),
      answeredAt: null,
      recordingPausedAt: null,
    });

    try {
      const { data, error } = await supabase.from("storm_call_sessions").insert({
        organization_id: orgId,
        adviser_id: user?.id ?? null,
        adviser_profile_id: user?.id ?? null,
        call_direction: "outbound",
        call_status: "ringing",
        callee_name: context.customerName ?? null,
        callee_phone: context.phoneNumber ?? null,
        case_id: context.caseId ?? null,
        customer_identified: !!context.customerId,
        application_source: context.applicationSource,
        customer_reference: context.customerReference,
        lead_reference: context.leadReference,
      }).select().single();
      if (error) throw new Error(error.message);

      setActiveCall(prev => ({
        ...prev,
        sessionId: data.id,
        status: "ringing",
      }));
    } catch (e) {
      setActionError((e as Error).message);
      setActiveCall(prev => ({ ...prev, status: "failed" }));
    }
  }, [orgId, user?.id]);

  const answerCall = useCallback(async () => {
    if (!activeCall.sessionId) return;
    try {
      const { error } = await supabase.from("storm_call_sessions")
        .update({ call_status: "answered", answered_at: new Date().toISOString() })
        .eq("id", activeCall.sessionId);
      if (error) throw error;
      setActiveCall(prev => ({ ...prev, status: "answered", answeredAt: new Date().toISOString() }));
    } catch (e) { setActionError((e as Error).message); }
  }, [activeCall.sessionId]);

  const toggleHold = useCallback(async () => {
    if (!activeCall.sessionId) return;
    const newOnHold = !activeCall.isOnHold;
    try {
      await holdCall(activeCall.sessionId, newOnHold);
      setActiveCall(prev => ({ ...prev, isOnHold: newOnHold, status: newOnHold ? "on_hold" : "answered" }));
    } catch (e) { setActionError((e as Error).message); }
  }, [activeCall.sessionId, activeCall.isOnHold]);

  const toggleMute = useCallback(async () => {
    if (!activeCall.sessionId) return;
    const newMuted = !activeCall.isMuted;
    try {
      await muteCall(activeCall.sessionId, newMuted);
      setActiveCall(prev => ({ ...prev, isMuted: newMuted, status: newMuted ? "muted" : "answered" }));
    } catch (e) { setActionError((e as Error).message); }
  }, [activeCall.sessionId, activeCall.isMuted]);

  const pauseRecording = useCallback(async (reason: string) => {
    if (!activeCall.sessionId || !orgId) return;
    const now = new Date().toISOString();
    try {
      const { error } = await supabase.from("storm_call_sessions")
        .update({ is_recording_paused: true, recording_paused_at: now, recording_pause_reason: reason })
        .eq("id", activeCall.sessionId);
      if (error) throw error;

      await supabase.from("storm_call_recording_events").insert({
        session_id: activeCall.sessionId,
        organization_id: orgId,
        event_type: "paused",
        event_timestamp: now,
        reason,
        user_id: user?.id ?? null,
        user_email: user?.email ?? null,
      });

      if (orgId) {
        await logComplianceAudit(orgId, {
          action: "recording_paused" as never,
          details: `Recording paused: ${reason}`,
          session_id: activeCall.sessionId,
        } as never);
      }

      setActiveCall(prev => ({ ...prev, isRecordingPaused: true, recordingPausedAt: now }));
      setRecordingEvents(prev => [...prev, {
        id: crypto.randomUUID(),
        session_id: activeCall.sessionId!,
        organization_id: orgId,
        event_type: "paused",
        event_timestamp: now,
        reason,
        user_id: user?.id ?? null,
        user_email: user?.email ?? null,
        duration_seconds: null,
      }]);
    } catch (e) { setActionError((e as Error).message); }
  }, [activeCall.sessionId, orgId, user?.id, user?.email]);

  const resumeRecording = useCallback(async () => {
    if (!activeCall.sessionId || !orgId || !activeCall.recordingPausedAt) return;
    const now = new Date().toISOString();
    const pauseDuration = Math.floor((new Date(now).getTime() - new Date(activeCall.recordingPausedAt).getTime()) / 1000);
    try {
      const { error } = await supabase.from("storm_call_sessions")
        .update({ is_recording_paused: false, recording_resumed_at: now, recording_pause_reason: null })
        .eq("id", activeCall.sessionId);
      if (error) throw error;

      await supabase.from("storm_call_recording_events").insert({
        session_id: activeCall.sessionId,
        organization_id: orgId,
        event_type: "resumed",
        event_timestamp: now,
        reason: "Recording resumed",
        user_id: user?.id ?? null,
        user_email: user?.email ?? null,
        duration_seconds: pauseDuration,
      });

      setActiveCall(prev => ({ ...prev, isRecordingPaused: false, recordingPausedAt: null }));
      setRecordingEvents(prev => [...prev, {
        id: crypto.randomUUID(),
        session_id: activeCall.sessionId!,
        organization_id: orgId,
        event_type: "resumed",
        event_timestamp: now,
        reason: "Recording resumed",
        user_id: user?.id ?? null,
        user_email: user?.email ?? null,
        duration_seconds: pauseDuration,
      }]);
    } catch (e) { setActionError((e as Error).message); }
  }, [activeCall.sessionId, orgId, activeCall.recordingPausedAt, user?.id, user?.email]);

  const handleTransfer = useCallback(async (target: string, transferType: "warm" | "cold") => {
    if (!activeCall.sessionId) return;
    try {
      await transferCall(activeCall.sessionId, target);
      setActiveCall(prev => ({ ...prev, status: "completed" }));
    } catch (e) { setActionError((e as Error).message); }
  }, [activeCall.sessionId]);

  const addConferenceParticipant = useCallback(async (name: string, role: string, type: ConferenceParticipantType) => {
    if (!activeCall.sessionId || !orgId) return;
    try {
      const { data, error } = await supabase.from("storm_call_conference_participants").insert({
        session_id: activeCall.sessionId,
        organization_id: orgId,
        participant_name: name,
        participant_role: role,
        participant_type: type,
        is_active: true,
      }).select().single();
      if (error) throw error;

      const { error: sessionError } = await supabase.from("storm_call_sessions")
        .update({ is_conference: true })
        .eq("id", activeCall.sessionId);
      if (sessionError) throw sessionError;

      setConferenceParticipants(prev => [...prev, data as StormCallConferenceParticipant]);
      setActiveCall(prev => ({ ...prev, isConference: true }));
    } catch (e) { setActionError((e as Error).message); }
  }, [activeCall.sessionId, orgId]);

  const removeConferenceParticipant = useCallback(async (participantId: string) => {
    try {
      const { error } = await supabase.from("storm_call_conference_participants")
        .update({ is_active: false, left_at: new Date().toISOString() })
        .eq("id", participantId);
      if (error) throw error;
      setConferenceParticipants(prev => prev.map(p => p.id === participantId ? { ...p, is_active: false, left_at: new Date().toISOString() } : p));
    } catch (e) { setActionError((e as Error).message); }
  }, []);

  const addNote = useCallback(async (text: string, tag: NoteTag, isFollowUp: boolean, dueDate?: string) => {
    if (!activeCall.sessionId || !orgId) return;
    try {
      const { data, error } = await supabase.from("storm_call_call_notes").insert({
        session_id: activeCall.sessionId,
        organization_id: orgId,
        note_text: text,
        note_tag: tag,
        is_follow_up: isFollowUp,
        follow_up_due_date: dueDate ?? null,
        created_by: user?.id ?? null,
      }).select().single();
      if (error) throw error;
      setNotes(prev => [...prev, data as StormCallNote]);
    } catch (e) { setActionError((e as Error).message); }
  }, [activeCall.sessionId, orgId, user?.id]);

  const completeNote = useCallback(async (noteId: string) => {
    try {
      const { error } = await supabase.from("storm_call_call_notes")
        .update({ is_completed: true }).eq("id", noteId);
      if (error) throw error;
      setNotes(prev => prev.map(n => n.id === noteId ? { ...n, is_completed: true } : n));
    } catch (e) { setActionError((e as Error).message); }
  }, []);

  const handleEndCall = useCallback(async () => {
    if (!activeCall.sessionId) return;
    try {
      if (activeCall.context?.noteText) {
        await updateCallNotes(activeCall.sessionId, activeCall.context.noteText);
      }
      await endCall(activeCall.sessionId);
      setActiveCall(prev => ({ ...prev, status: "completed" }));
    } catch (e) { setActionError((e as Error).message); }
  }, [activeCall.sessionId, activeCall.context?.noteText]);

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    if (activeCall.status === "completed" || activeCall.status === "failed") {
      setActiveCall(IDLE_STATE);
      setNotes([]);
      setConferenceParticipants([]);
      setRecordingEvents([]);
      setCallDuration(0);
      setRecordingDuration(0);
    }
  }, [activeCall.status]);

  const loadNotes = useCallback(async (sessionId: string) => {
    const { data, error } = await supabase.from("storm_call_call_notes")
      .select("*").eq("session_id", sessionId).order("created_at", { ascending: true });
    if (!error && data) setNotes(data as StormCallNote[]);
  }, []);

  const loadParticipants = useCallback(async (sessionId: string) => {
    const { data, error } = await supabase.from("storm_call_conference_participants")
      .select("*").eq("session_id", sessionId).order("joined_at", { ascending: true });
    if (!error && data) setConferenceParticipants(data as StormCallConferenceParticipant[]);
  }, []);

  return {
    activeCall,
    notes,
    conferenceParticipants,
    recordingEvents,
    drawerOpen,
    callDuration,
    recordingDuration,
    actionError,
    orgId,
    launchCall,
    answerCall,
    toggleHold,
    toggleMute,
    pauseRecording,
    resumeRecording,
    handleTransfer,
    addConferenceParticipant,
    removeConferenceParticipant,
    addNote,
    completeNote,
    handleEndCall,
    closeDrawer,
    setDrawerOpen,
    loadNotes,
    loadParticipants,
  };
}

export type StormCallEcosystemApi = ReturnType<typeof useStormCallEcosystem>;
