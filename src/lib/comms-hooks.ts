import { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabase";
import type {
  DebtVergeCommunication,
  UnassignedMessage,
  SendMessagePayload,
  CommsChannel,
  CommsStatus,
} from "./types";

// ============================================================
// Database row shapes (snake_case → camelCase mapping)
// ============================================================

interface CommunicationRow {
  id: string;
  case_id: string;
  thread_id: string;
  channel: CommsChannel;
  direction: "inbound" | "outbound";
  sender_name: string;
  sender_email_or_phone: string;
  sender_type: "client" | "agent" | "system";
  recipient_name: string;
  recipient_email_or_phone: string;
  agent_id: string | null;
  agent_name: string | null;
  subject: string | null;
  body: string;
  attachments: string[];
  status: CommsStatus;
  matched_automatically: boolean;
  created_at: string;
  updated_at: string;
}

interface UnassignedMessageRow {
  id: string;
  channel: CommsChannel;
  sender_name: string;
  sender_email_or_phone: string;
  subject: string | null;
  body: string;
  attachments: string[];
  received_at: string;
  matched_case_id: string | null;
  matched_at: string | null;
  matched_by: string | null;
  status: "unassigned" | "matched" | "ignored";
  created_at: string;
  updated_at: string;
}

function rowToCommunication(row: CommunicationRow): DebtVergeCommunication {
  return {
    id: row.id,
    caseId: row.case_id,
    threadId: row.thread_id,
    channel: row.channel,
    direction: row.direction,
    sender: {
      name: row.sender_name,
      emailOrPhone: row.sender_email_or_phone,
      type: row.sender_type,
    },
    recipient: {
      name: row.recipient_name,
      emailOrPhone: row.recipient_email_or_phone,
    },
    agentId: row.agent_id,
    agentName: row.agent_name,
    content: {
      subject: row.subject ?? undefined,
      body: row.body,
      attachments: row.attachments ?? [],
    },
    status: row.status,
    matchedAutomatically: row.matched_automatically,
    timestamp: row.created_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToUnassigned(row: UnassignedMessageRow): UnassignedMessage {
  return {
    id: row.id,
    channel: row.channel,
    senderName: row.sender_name,
    senderEmailOrPhone: row.sender_email_or_phone,
    subject: row.subject,
    body: row.body,
    attachments: row.attachments ?? [],
    receivedAt: row.received_at,
    matchedCaseId: row.matched_case_id,
    matchedAt: row.matched_at,
    matchedBy: row.matched_by,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ============================================================
// fetchCaseCommunications — load all comms for a case
// ============================================================

export function useCaseCommunications(caseId: string | null) {
  const [data, setData] = useState<DebtVergeCommunication[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    if (!caseId) { setData([]); setLoading(false); return; }
    setLoading(true);
    supabase
      .from("debtverge_communications")
      .select("*")
      .eq("case_id", caseId)
      .order("created_at", { ascending: true })
      .then(({ data: rows, error: err }) => {
        if (err) { setError(err.message); setData([]); }
        else { setError(null); setData((rows as CommunicationRow[] | null)?.map(rowToCommunication) ?? []); }
        setLoading(false);
      });
  }, [caseId]);

  useEffect(() => { reload(); }, [reload]);

  return { data, loading, error, reload };
}

export async function fetchCaseCommunications(caseId: string): Promise<DebtVergeCommunication[]> {
  const { data, error } = await supabase
    .from("debtverge_communications")
    .select("*")
    .eq("case_id", caseId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data as CommunicationRow[] | null)?.map(rowToCommunication) ?? [];
}

// ============================================================
// sendMessage — insert an outbound (or inbound) communication
// ============================================================

export async function sendMessage(payload: SendMessagePayload): Promise<DebtVergeCommunication> {
  const insertRow: Record<string, unknown> = {
    case_id: payload.caseId,
    thread_id: payload.threadId ?? crypto.randomUUID(),
    channel: payload.channel,
    direction: payload.direction,
    sender_name: payload.sender.name,
    sender_email_or_phone: payload.sender.emailOrPhone,
    sender_type: payload.sender.type ?? "agent",
    recipient_name: payload.recipient.name,
    recipient_email_or_phone: payload.recipient.emailOrPhone,
    agent_id: payload.agentId ?? null,
    agent_name: payload.agentName ?? null,
    subject: payload.content.subject ?? null,
    body: payload.content.body,
    attachments: payload.content.attachments ?? [],
    status: payload.status ?? "queued",
    matched_automatically: true,
  };

  const { data, error } = await supabase
    .from("debtverge_communications")
    .insert(insertRow)
    .select("*")
    .single();
  if (error) throw error;
  return rowToCommunication(data as CommunicationRow);
}

// ============================================================
// assignThreadToAgent — update all messages in a thread
// ============================================================

export async function assignThreadToAgent(
  threadId: string,
  agentId: string,
  agentName: string,
): Promise<void> {
  const { error } = await supabase
    .from("debtverge_communications")
    .update({ agent_id: agentId, agent_name: agentName, updated_at: new Date().toISOString() })
    .eq("thread_id", threadId);
  if (error) throw error;
}

// ============================================================
// Unassigned Message Buffer — hooks & operations
// ============================================================

export function useUnassignedMessages() {
  const [data, setData] = useState<UnassignedMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    supabase
      .from("debtverge_unassigned_messages")
      .select("*")
      .eq("status", "unassigned")
      .order("received_at", { ascending: false })
      .then(({ data: rows, error: err }) => {
        if (err) { setError(err.message); setData([]); }
        else { setError(null); setData((rows as UnassignedMessageRow[] | null)?.map(rowToUnassigned) ?? []); }
        setLoading(false);
      });
  }, []);

  useEffect(() => { reload(); }, [reload]);

  return { data, loading, error, reload };
}

/**
 * Match an unassigned message to an existing case. This:
 * 1. Marks the unassigned message as 'matched' with the case ID and timestamp.
 * 2. Creates a communication record linked to the case.
 */
export async function matchUnassignedToCase(
  messageId: string,
  caseId: string,
  matchedBy: string,
): Promise<DebtVergeCommunication> {
  // 1. Fetch the unassigned message
  const { data: msgRow, error: fetchErr } = await supabase
    .from("debtverge_unassigned_messages")
    .select("*")
    .eq("id", messageId)
    .single();
  if (fetchErr) throw fetchErr;
  const msg = rowToUnassigned(msgRow as UnassignedMessageRow);

  // 2. Mark it as matched
  const now = new Date().toISOString();
  const { error: updateErr } = await supabase
    .from("debtverge_unassigned_messages")
    .update({
      status: "matched",
      matched_case_id: caseId,
      matched_at: now,
      matched_by: matchedBy,
      updated_at: now,
    })
    .eq("id", messageId);
  if (updateErr) throw updateErr;

  // 3. Create a communication record linked to the case
  const threadId = crypto.randomUUID();
  const { data: commRow, error: insertErr } = await supabase
    .from("debtverge_communications")
    .insert({
      case_id: caseId,
      thread_id: threadId,
      channel: msg.channel,
      direction: "inbound",
      sender_name: msg.senderName,
      sender_email_or_phone: msg.senderEmailOrPhone,
      sender_type: "client",
      recipient_name: "DebtVerge Team",
      recipient_email_or_phone: "",
      agent_id: null,
      agent_name: null,
      subject: msg.subject,
      body: msg.body,
      attachments: msg.attachments,
      status: "delivered",
      matched_automatically: false,
    })
    .select("*")
    .single();
  if (insertErr) throw insertErr;

  return rowToCommunication(commRow as CommunicationRow);
}

// ============================================================
// Utility: update communication status
// ============================================================

export async function updateCommunicationStatus(
  commId: string,
  status: CommsStatus,
): Promise<void> {
  const { error } = await supabase
    .from("debtverge_communications")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", commId);
  if (error) throw error;
}
