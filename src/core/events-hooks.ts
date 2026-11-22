import { supabase } from "./supabase";
import type { ClientStage } from "./client-hooks";

/**
 * Events between apps. An app announces something with `raiseEvent`; the apps that care pick it up with
 * `claimEvents`, handle it, then `ackEvent` (or `failEvent` to try again later). Apps never call each other.
 *
 * A claimed event is leased to the caller for a short time. If it is never confirmed the lease runs out and
 * the event is offered again, so a receiver must be safe to run twice for the same event (use `event_id`).
 */
export type EventType = "client.stage_changed" | "qualification.decided" | "call.completed";

export interface ReceivedEvent {
  delivery_id: string;
  event_id: string;
  event_type: EventType;
  client_id: string | null;
  source_app: string;
  payload: Record<string, unknown>;
  created_at: string;
  attempts: number;
}

export interface StageChangedPayload {
  from_stage: ClientStage | null;
  to_stage: ClientStage;
  history_id: string;
  changed_by: string | null;
}

export interface RaiseResult {
  event_id: string;
  duplicate: boolean;
  deliveries: number;
}

export interface EventLogEntry {
  event_id: string;
  event_type: EventType;
  client_id: string | null;
  source_app: string;
  payload: Record<string, unknown>;
  created_at: string;
  deliveries: { app_id: string; status: "pending" | "claimed" | "delivered" | "dead"; attempts: number; delivered_at: string | null; last_error: string | null }[];
}

/** `dedupeKey` makes a repeat call harmless: the same key never raises a second event. */
export async function raiseEvent(input: {
  type: Exclude<EventType, "client.stage_changed">;
  clientId?: string | null;
  payload?: Record<string, unknown>;
  dedupeKey?: string | null;
}): Promise<RaiseResult> {
  const { data, error } = await supabase.rpc("core_event_raise", {
    p_type: input.type,
    p_client: input.clientId ?? null,
    p_payload: input.payload ?? {},
    p_dedupe: input.dedupeKey ?? null,
  });
  if (error) throw new Error(error.message);
  return data as RaiseResult;
}

export async function claimEvents(appId: string, opts: { limit?: number; leaseSeconds?: number } = {}): Promise<ReceivedEvent[]> {
  const { data, error } = await supabase.rpc("core_event_claim", {
    p_app: appId,
    p_limit: opts.limit ?? 20,
    p_lease_seconds: opts.leaseSeconds ?? 300,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as ReceivedEvent[];
}

export async function ackEvent(deliveryId: string): Promise<void> {
  const { error } = await supabase.rpc("core_event_ack", { p_delivery: deliveryId });
  if (error) throw new Error(error.message);
}

export async function failEvent(deliveryId: string, message?: string): Promise<void> {
  const { error } = await supabase.rpc("core_event_fail", { p_delivery: deliveryId, p_error: message ?? null });
  if (error) throw new Error(error.message);
}

/** Managers only. */
export async function listEventLog(opts: { clientId?: string | null; limit?: number } = {}): Promise<EventLogEntry[]> {
  const { data, error } = await supabase.rpc("core_event_log", { p_client: opts.clientId ?? null, p_limit: opts.limit ?? 50 });
  if (error) throw new Error(error.message);
  return (data ?? []) as EventLogEntry[];
}
