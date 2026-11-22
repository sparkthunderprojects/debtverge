import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";

/**
 * The shared client record. One per person; it moves through the stages by a recorded
 * stage change. Every app reads and changes it through these functions only.
 */
export type ClientStage = "lead" | "qualify" | "debtverge" | "draftverge" | "ivaverge" | "closed";

export const STAGE_LABELS: Record<ClientStage, string> = {
  lead: "Lead",
  qualify: "Qualify",
  debtverge: "DMP (DebtVerge)",
  draftverge: "IVA drafting (DraftVerge)",
  ivaverge: "IVA supervision (IVAVerge)",
  closed: "Closed",
};

export interface CoreClientSummary {
  id: string;
  display_name: string;
  reference: string | null;
  current_stage: ClientStage;
  stage_entered_at: string;
  assigned_to: string | null;
}

export interface StageHistoryEntry {
  id: string;
  from_stage: ClientStage | null;
  to_stage: ClientStage;
  reason: string;
  changed_by: string | null;
  approved_by: string | null;
  at: string;
}

export interface NextStage {
  to_stage: ClientStage;
  needs_approver: boolean;
  note: string | null;
}

export interface CoreClientDetail {
  client: CoreClientSummary & { is_restricted: boolean; created_at: string };
  history: StageHistoryEntry[];
  next_stages: NextStage[];
  can_change: boolean;
}

export async function listClients(opts: { stage?: ClientStage; search?: string; limit?: number } = {}): Promise<CoreClientSummary[]> {
  const { data, error } = await supabase.rpc("core_client_list", {
    p_stage: opts.stage ?? null,
    p_search: opts.search ?? null,
    p_limit: opts.limit ?? 50,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as CoreClientSummary[];
}

export async function getClient(clientId: string): Promise<CoreClientDetail> {
  const { data, error } = await supabase.rpc("core_client_get", { p_client: clientId });
  if (error) throw new Error(error.message);
  return data as CoreClientDetail;
}

/** `from` must be the stage the caller is looking at, so a stale screen cannot move the client twice. */
export async function changeClientStage(input: {
  clientId: string;
  from: ClientStage;
  to: ClientStage;
  reason: string;
  approverId?: string | null;
}): Promise<{ client_id: string; from_stage: ClientStage; to_stage: ClientStage }> {
  const { data, error } = await supabase.rpc("core_client_change_stage", {
    p_client: input.clientId,
    p_from: input.from,
    p_to: input.to,
    p_reason: input.reason,
    p_approver: input.approverId ?? null,
  });
  if (error) throw new Error(error.message);
  return data as { client_id: string; from_stage: ClientStage; to_stage: ClientStage };
}

export function useClient(clientId: string | null | undefined) {
  const [detail, setDetail] = useState<CoreClientDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!clientId) { setDetail(null); return; }
    setLoading(true);
    setError(null);
    try {
      setDetail(await getClient(clientId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the client");
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => { void reload(); }, [reload]);

  return { detail, loading, error, reload };
}
