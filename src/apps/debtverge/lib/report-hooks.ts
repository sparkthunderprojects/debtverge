import { supabase } from "@/core/supabase";

export type ReportKind = "cases_by_status" | "caseload_by_advisor" | "missed_payments" | "overdue_tasks" | "complaints" | "fees";
export const REPORTS: { kind: ReportKind; label: string; dated: boolean; help: string }[] = [
  { kind: "cases_by_status", label: "Cases by status", dated: false, help: "Case count and total debt by status and plan type." },
  { kind: "caseload_by_advisor", label: "Caseload by advisor", dated: false, help: "Cases and total debt per advisor." },
  { kind: "missed_payments", label: "Missed payments", dated: true, help: "Shortfall payments in the date range." },
  { kind: "overdue_tasks", label: "Overdue tasks", dated: false, help: "Open tasks past their due date." },
  { kind: "complaints", label: "Complaints", dated: true, help: "Complaints received in the date range, with outcome and redress." },
  { kind: "fees", label: "Fees charged", dated: true, help: "Fee charges in the date range." },
];

export type ReportRow = Record<string, string | number | boolean | null>;

export async function runReport(kind: ReportKind, from?: string, to?: string): Promise<ReportRow[]> {
  const { data, error } = await supabase.rpc("dv_run_report", { p_kind: kind, p_from: from || null, p_to: to || null });
  if (error) throw new Error(error.message);
  return (data ?? []) as ReportRow[];
}

/** CSV cell: quoted, and neutralised against spreadsheet formula injection (cells starting = + - @ tab CR). */
const cell = (v: unknown) => {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
};
export function toCsv(rows: ReportRow[]): string {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  return [cols.map(cell).join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\r\n");
}
export function downloadCsv(rows: ReportRow[], filename: string) {
  const url = URL.createObjectURL(new Blob(["﻿" + toCsv(rows)], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
