import { supabase } from "./supabase";

export interface BulkRow { case_number: string; match: string; balance?: string; offer?: string; rate?: string }
export interface PreviewRow {
  idx: number; case_number: string; match_key: string; creditor_name: string | null;
  status: "will_update" | "unchanged" | "invalid" | "nothing_to_update" | "case_not_found" | "ambiguous_case" | "creditor_not_found" | "ambiguous_creditor";
  old_balance: number | null; new_balance: number | null; old_offer: number | null; new_offer: number | null; old_rate: number | null; new_rate: number | null;
}
export const STATUS_TEXT: Record<PreviewRow["status"], string> = {
  will_update: "Will update", unchanged: "No change", invalid: "Invalid value", nothing_to_update: "No values supplied",
  case_not_found: "Case not found", ambiguous_case: "Case number matches more than one case",
  creditor_not_found: "Creditor not found on case", ambiguous_creditor: "Matches more than one creditor",
};
export const MAX_ROWS = 2000;

/** Minimal RFC-4180 CSV parser (quoted fields, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cur = ""; let q = false;
  const t = text.replace(/^﻿/, "");
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) { if (ch === '"') { if (t[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cur); cur = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && t[i + 1] === "\n") i++; row.push(cur); cur = ""; if (row.some((c) => c.trim() !== "")) rows.push(row); row = []; }
    else cur += ch;
  }
  row.push(cur); if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

/** Header names accepted (case-insensitive). Money values: digits and one decimal point only; £ and thousands commas are stripped. */
const ALIAS: Record<string, keyof BulkRow> = {
  case_number: "case_number", case: "case_number", "case number": "case_number",
  match: "match", account_reference: "match", "account reference": "match", account: "match", creditor: "match", creditor_name: "match", reference: "match",
  balance: "balance", current_balance: "balance", offer: "offer", settlement_offer: "offer", rate: "rate", interest_rate: "rate",
};
const clean = (v: string) => v.trim().replace(/^[£$]/, "").replace(/,/g, "").replace(/%$/, "");

export function csvToRows(text: string): { rows: BulkRow[]; error?: string } {
  const grid = parseCsv(text);
  if (grid.length < 2) return { rows: [], error: "The file needs a header row and at least one data row." };
  const cols = grid[0].map((h) => ALIAS[h.trim().toLowerCase()]);
  if (!cols.includes("case_number") || !cols.includes("match")) return { rows: [], error: "Headers must include case_number and account_reference (or creditor_name)." };
  if (!cols.some((c) => c === "balance" || c === "offer" || c === "rate")) return { rows: [], error: "Include at least one of: balance, offer, rate." };
  if (grid.length - 1 > MAX_ROWS) return { rows: [], error: `Maximum ${MAX_ROWS} rows per upload.` };
  const rows = grid.slice(1).map((r) => {
    const o: BulkRow = { case_number: "", match: "" };
    cols.forEach((c, i) => { if (c && r[i] !== undefined) (o[c] as string) = c === "case_number" || c === "match" ? r[i].trim() : clean(r[i]); });
    return o;
  });
  return { rows };
}

export async function previewBulk(rows: BulkRow[]): Promise<PreviewRow[]> {
  const { data, error } = await supabase.rpc("dv_bulk_creditor_preview", { p_rows: rows });
  if (error) throw new Error(error.message);
  return (data ?? []) as PreviewRow[];
}
export async function applyBulk(rows: BulkRow[]): Promise<{ updated: number; skipped: number }> {
  const { data, error } = await supabase.rpc("dv_bulk_creditor_apply", { p_rows: rows });
  if (error) throw new Error(error.message);
  return data as { updated: number; skipped: number };
}
