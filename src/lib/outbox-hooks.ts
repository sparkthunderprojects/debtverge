import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";

export interface OutboxMessage {
  id: string;
  case_id: string;
  channel: "email" | "sms";
  to_address: string;
  subject: string | null;
  body: string;
  trigger: "manual" | "missed_payment" | "reminder";
  status: "queued" | "sent" | "failed" | "cancelled";
  attempts: number;
  error: string | null;
  created_at: string;
  sent_at: string | null;
}

export const TRIGGER_LABEL: Record<OutboxMessage["trigger"], string> = { manual: "Sent by adviser", missed_payment: "Missed-payment chaser", reminder: "Reminder" };

export function useOutbox(caseId: string | null) {
  const [messages, setMessages] = useState<OutboxMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    if (!caseId) { setMessages([]); setLoading(false); return; }
    const { data, error: e } = await supabase.from("comms_outbox").select("*").eq("case_id", caseId).order("created_at", { ascending: false }).limit(50);
    setError(e?.message ?? null);
    setMessages((data ?? []) as OutboxMessage[]);
    setLoading(false);
  }, [caseId]);
  useEffect(() => { setLoading(true); reload(); }, [reload]);
  return { messages, loading, error, reload };
}

export async function queueMessage(caseId: string, channel: "email" | "sms", subject: string, body: string) {
  const { error } = await supabase.rpc("dv_queue_message", { p_case: caseId, p_channel: channel, p_subject: channel === "email" ? subject : null, p_body: body });
  if (error) throw new Error(error.message);
}

export async function cancelMessage(id: string) {
  const { error } = await supabase.rpc("dv_cancel_message", { p_id: id });
  if (error) throw new Error(error.message);
}
