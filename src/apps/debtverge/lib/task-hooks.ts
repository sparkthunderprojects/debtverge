import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/core/supabase";

export type TaskKind = "task" | "call" | "statutory" | "review" | "note";
export interface CaseTask {
  id: string;
  case_id: string;
  title: string;
  notes: string | null;
  kind: TaskKind;
  due_date: string | null;
  status: "open" | "done" | "cancelled";
  assigned_to: string | null;
  source: "manual" | "auto";
  completed_at: string | null;
  created_at: string;
}

export const TASK_KIND_LABEL: Record<TaskKind, string> = {
  task: "Task", call: "Call", statutory: "Required", review: "Review", note: "Note",
};

export function useCaseTasks(caseId: string | null) {
  const [tasks, setTasks] = useState<CaseTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!caseId) { setTasks([]); setLoading(false); return; }
    setLoading(true);
    const { data, error: e } = await supabase.from("case_tasks").select("*").eq("case_id", caseId).order("due_date", { ascending: true, nullsFirst: false });
    if (e) setError(e.message); else { setError(null); setTasks((data ?? []) as CaseTask[]); }
    setLoading(false);
  }, [caseId]);

  useEffect(() => { load(); }, [load]);
  return { tasks, loading, error, reload: load };
}

export async function createTask(input: { case_id: string; title: string; kind: TaskKind; due_date: string | null; notes?: string; assigned_to?: string | null; organization_id?: string | null }) {
  const { error } = await supabase.from("case_tasks").insert({ ...input, source: "manual" });
  if (error) throw new Error(error.message);
}

export async function setTaskStatus(id: string, status: "open" | "done" | "cancelled", userId: string | null) {
  const { error } = await supabase.from("case_tasks").update({
    status,
    completed_at: status === "done" ? new Date().toISOString() : null,
    completed_by: status === "done" ? userId : null,
  }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function snoozeTask(id: string, days: number) {
  const d = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  const { error } = await supabase.from("case_tasks").update({ due_date: d }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function logDiaryNote(caseId: string, title: string, kind: TaskKind, userId: string | null, organizationId?: string | null) {
  const { error } = await supabase.from("case_tasks").insert({
    case_id: caseId, title, kind, status: "done", source: "manual",
    completed_at: new Date().toISOString(), completed_by: userId, organization_id: organizationId ?? null,
  });
  if (error) throw new Error(error.message);
}
