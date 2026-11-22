import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  addCallNote, callControl, fetchCallDetail, fetchPendingCalls, fetchPresence, fetchUnmatched, getCallToken, setPresence, startCall,
  type CallDetail, type PendingCall, type Presence, type UnmatchedCall,
} from "./call-hooks";

/* The browser softphone. Twilio's Voice SDK carries the audio; everything that matters for the record (who, when, what was agreed,
   recording state) is written by the database and the carrier webhook, never trusted from this screen. */

type VoiceCall = {
  parameters: Record<string, string>; customParameters: Map<string, string>;
  accept: () => void; reject: () => void; disconnect: () => void; mute: (m: boolean) => void; isMuted: () => boolean;
  on: (ev: string, fn: (...a: unknown[]) => void) => void; sendDigits: (d: string) => void;
};
type VoiceDevice = {
  register: () => Promise<void>; unregister: () => Promise<void>; destroy: () => void; updateToken: (t: string) => void;
  connect: (o: { params: Record<string, string> }) => Promise<VoiceCall>; on: (ev: string, fn: (...a: unknown[]) => void) => void;
};

export type Phase = "off" | "connecting" | "ready" | "unavailable" | "error";
export interface Live {
  callId: string; direction: "inbound" | "outbound"; phone: string; name: string | null; caseId: string | null;
  stage: "ringing" | "connected" | "ended"; muted: boolean; onHold: boolean; recording: "recording" | "paused" | "none"; connectedAt: number | null; endedAt: number | null; notice: string | null;
}
export interface Incoming { callId: string; phone: string; name: string | null }

interface Ctx {
  enabled: boolean; phase: Phase; message: string | null; presence: string; open: boolean; setOpen: (o: boolean) => void;
  live: Live | null; incoming: Incoming | null; detail: CallDetail | null; busy: boolean; error: string | null;
  pending: PendingCall[]; unmatched: UnmatchedCall[]; team: Presence[];
  dial: (caseId: string, phone: string) => Promise<void>; answer: () => void; decline: () => void; hangup: () => void;
  toggleMute: () => void; toggleHold: () => Promise<void>; pauseRecording: (reason: string) => Promise<void>; resumeRecording: () => Promise<void>;
  transfer: (kind: string, target: { user?: string; phone?: string }) => Promise<void>;
  addParticipant: (p: { name: string; role: string; type: string; user?: string; phone?: string }) => Promise<void>; removeParticipant: (id: string) => Promise<void>;
  note: (text: string, tag: string, followUp: boolean, due: string | null) => Promise<void>;
  sendDigits: (d: string) => void; setStatus: (s: string) => Promise<void>; refresh: () => Promise<void>; clearLive: () => void; reloadDetail: () => Promise<void>;
}
const SoftphoneContext = createContext<Ctx | null>(null);
export const useSoftphone = () => { const c = useContext(SoftphoneContext); if (!c) throw new Error("Softphone is not mounted"); return c; };

export function SoftphoneProvider({ enabled, userId, children }: { enabled: boolean; userId: string | null; children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>("off");
  const [message, setMessage] = useState<string | null>(null);
  const [presence, setPresenceState] = useState("offline");
  const [open, setOpen] = useState(false);
  const [live, setLive] = useState<Live | null>(null);
  const [incoming, setIncoming] = useState<Incoming | null>(null);
  const [detail, setDetail] = useState<CallDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingCall[]>([]);
  const [unmatched, setUnmatched] = useState<UnmatchedCall[]>([]);
  const [team, setTeam] = useState<Presence[]>([]);
  const device = useRef<VoiceDevice | null>(null);
  const call = useRef<VoiceCall | null>(null);
  const ring = useRef<VoiceCall | null>(null);
  const liveRef = useRef<Live | null>(null);
  liveRef.current = live;

  const refresh = useCallback(async () => {
    if (!enabled) return;
    const [p, u, t] = await Promise.allSettled([fetchPendingCalls(), fetchUnmatched(), fetchPresence()]);
    if (p.status === "fulfilled") setPending(p.value);
    if (u.status === "fulfilled") setUnmatched(u.value);
    if (t.status === "fulfilled") { setTeam(t.value); const me = t.value.find((x) => x.user_id === userId); if (me) setPresenceState(me.status); }
  }, [enabled, userId]);

  const reloadDetail = useCallback(async () => {
    const l = liveRef.current; if (!l) return;
    try { setDetail(await fetchCallDetail(l.callId)); } catch { /* the call may not be readable yet; the next change reloads it */ }
  }, []);

  const watch = useCallback((c: VoiceCall, base: Omit<Live, "stage" | "muted" | "onHold" | "connectedAt" | "endedAt">, stage: Live["stage"]) => {
    call.current = c;
    setLive({ ...base, stage, muted: false, onHold: false, connectedAt: stage === "connected" ? Date.now() : null, endedAt: null });
    const ended = () => { call.current = null; setLive((l) => (l ? { ...l, stage: "ended", endedAt: Date.now(), muted: false } : l)); void refresh(); };
    c.on("accept", () => setLive((l) => (l ? { ...l, stage: "connected", connectedAt: Date.now() } : l)));
    c.on("disconnect", ended); c.on("cancel", ended); c.on("reject", ended);
    c.on("error", (e: unknown) => { setError((e as Error)?.message ?? "The call had a problem."); ended(); });
    setOpen(true);
  }, [refresh]);

  /* device lifecycle */
  useEffect(() => {
    if (!enabled || !userId) { setPhase("off"); return; }
    let dead = false; let dev: VoiceDevice | null = null; let timer: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      setPhase("connecting");
      let token: string;
      try { token = (await getCallToken()).token; } catch (e) {
        if (dead) return; const m = (e as Error).message;
        setPhase(/not configured|not available/i.test(m) ? "unavailable" : "error"); setMessage(m); void refresh(); return;
      }
      const { Device } = await import("@twilio/voice-sdk");
      if (dead) return;
      dev = new Device(token, { codecPreferences: ["opus", "pcmu"] as never, closeProtection: true, logLevel: 1 }) as unknown as VoiceDevice;
      device.current = dev;
      dev.on("registered", () => { setPhase("ready"); setMessage(null); });
      dev.on("error", (e: unknown) => { setPhase("error"); setMessage((e as Error)?.message ?? "The phone lost its connection."); });
      dev.on("tokenWillExpire", async () => { try { dev?.updateToken((await getCallToken()).token); } catch { /* the next expiry retries */ } });
      dev.on("incoming", (raw: unknown) => {
        const c = raw as VoiceCall; const id = c.customParameters.get("c") ?? "";
        if (!id || liveRef.current) { c.reject(); return; }   // busy, or not a call we know about
        ring.current = c;
        setIncoming({ callId: id, phone: c.customParameters.get("f") ?? "", name: c.customParameters.get("n") || null });
        setOpen(true);
        const clear = () => { if (ring.current === c) { ring.current = null; setIncoming(null); void refresh(); } };
        c.on("cancel", clear); c.on("reject", clear); c.on("disconnect", clear);
      });
      try { await dev.register(); } catch (e) { if (!dead) { setPhase("error"); setMessage((e as Error).message); } }
      void refresh();
      timer = setInterval(() => void refresh(), 30000) as unknown as ReturnType<typeof setTimeout>;
    })();
    return () => { dead = true; if (timer) clearInterval(timer as unknown as number); try { dev?.destroy(); } catch { /* already closed */ } device.current = null; };
  }, [enabled, userId, refresh]);

  /* keep the call record in step while a call is up */
  useEffect(() => {
    if (!live) { setDetail(null); return; }
    void reloadDetail();
    const t = setInterval(() => void reloadDetail(), live.stage === "ended" ? 15000 : 6000);
    return () => clearInterval(t);
  }, [live?.callId, live?.stage, reloadDetail]);   // eslint-disable-line react-hooks/exhaustive-deps

  const guard = async (f: () => Promise<void>) => { setBusy(true); setError(null); try { await f(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };

  const dial = (caseId: string, phone: string) => guard(async () => {
    if (!device.current || phase !== "ready") throw new Error("The phone is not connected yet.");
    if (liveRef.current && liveRef.current.stage !== "ended") throw new Error("You are already on a call.");
    const s = await startCall(caseId, phone);
    const c = await device.current.connect({ params: { SessionId: s.call_id } });
    setPresenceState("busy");
    watch(c, { callId: s.call_id, direction: "outbound", phone: s.phone, name: null, caseId, recording: s.record ? "recording" : "none", notice: s.notice }, "ringing");
  });
  const answer = () => {
    const c = ring.current, inc = incoming; if (!c || !inc) return;
    c.accept(); ring.current = null; setIncoming(null); setPresenceState("busy");
    watch(c, { callId: inc.callId, direction: "inbound", phone: inc.phone, name: inc.name, caseId: null, recording: "recording", notice: null }, "connected");
    void fetchCallDetail(inc.callId).then((d) => {
      setLive((l) => (l ? { ...l, caseId: d.call.case_id, name: l.name ?? d.call.caller_name, recording: d.call.recording_status === "paused" ? "paused" : d.call.recording_status === "none" ? "none" : "recording" } : l));
    }).catch(() => undefined);
  };
  const decline = () => { ring.current?.reject(); ring.current = null; setIncoming(null); };
  const hangup = () => { call.current?.disconnect(); };
  const toggleMute = () => { const c = call.current; if (!c) return; const m = !c.isMuted(); c.mute(m); setLive((l) => (l ? { ...l, muted: m } : l)); };
  const toggleHold = () => guard(async () => {
    const l = liveRef.current; if (!l) return;
    await callControl(l.callId, l.onHold ? "resume" : "hold");
    setLive((x) => (x ? { ...x, onHold: !x.onHold } : x)); await reloadDetail();
  });
  const pauseRecording = (reason: string) => guard(async () => { const l = liveRef.current; if (!l) return; await callControl(l.callId, "pause_recording", { reason }); setLive((x) => (x ? { ...x, recording: "paused" } : x)); await reloadDetail(); });
  const resumeRecording = () => guard(async () => { const l = liveRef.current; if (!l) return; await callControl(l.callId, "resume_recording"); setLive((x) => (x ? { ...x, recording: "recording" } : x)); await reloadDetail(); });
  const transfer = (kind: string, t: { user?: string; phone?: string }) => guard(async () => {
    const l = liveRef.current; if (!l) return;
    await callControl(l.callId, "transfer", { kind, target_user: t.user, target: t.phone });
    await reloadDetail();
  });
  const addParticipant = (p: { name: string; role: string; type: string; user?: string; phone?: string }) => guard(async () => {
    const l = liveRef.current; if (!l) return;
    await callControl(l.callId, "participant_add", { name: p.name, role: p.role, type: p.type, target_user: p.user, target: p.phone }); await reloadDetail();
  });
  const removeParticipant = (id: string) => guard(async () => { const l = liveRef.current; if (!l) return; await callControl(l.callId, "participant_remove", { participant_id: id }); await reloadDetail(); });
  const note = (text: string, tag: string, followUp: boolean, due: string | null) => guard(async () => { const l = liveRef.current; if (!l) return; await addCallNote(l.callId, text, tag, followUp, due); await reloadDetail(); });
  const setStatus = (s: string) => guard(async () => { await setPresence(s); setPresenceState(s); await refresh(); });
  const clearLive = () => { setLive(null); setDetail(null); setPresenceState((p) => (p === "busy" ? "available" : p)); void setPresence("available").catch(() => undefined); void refresh(); };

  const value = useMemo<Ctx>(() => ({
    enabled, phase, message, presence, open, setOpen, live, incoming, detail, busy, error, pending, unmatched, team,
    dial, answer, decline, hangup, toggleMute, toggleHold, pauseRecording, resumeRecording, transfer, addParticipant, removeParticipant, note,
    sendDigits: (d: string) => call.current?.sendDigits(d), setStatus, refresh, clearLive, reloadDetail,
  }), [enabled, phase, message, presence, open, live, incoming, detail, busy, error, pending, unmatched, team]);   // eslint-disable-line react-hooks/exhaustive-deps
  return <SoftphoneContext.Provider value={value}>{children}</SoftphoneContext.Provider>;
}

/** Optional access for components that may render before (or without) the phone, such as the case calls tab. */
export const useSoftphoneOptional = () => useContext(SoftphoneContext);
