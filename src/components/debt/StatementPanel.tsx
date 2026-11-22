import { useState } from "react";
import { FileBarChart, Printer, Save } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { saveLetter, printLetter } from "../../lib/document-hooks";
import type { DebtCase } from "../../lib/types";

interface Statement {
  firm: string | null; client: string; case_number: string; from: string; to: string;
  payments: { date: string; amount: number }[]; fees: { date: string; amount: number }[];
  paid_out: { date: string; creditor: string; amount: number }[]; creditors: { name: string; reference: string | null; balance: number }[]; held_now: number;
}
const gbp = (n: number) => "£" + Number(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const d = (s: string) => new Date(s + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const sum = (xs: { amount: number }[]) => xs.reduce((t, x) => t + Number(x.amount), 0);

export function statementText(s: Statement) {
  const lines: string[] = [];
  lines.push(`${s.firm ?? "Your debt adviser"}`, `Statement for ${s.client} (${s.case_number})`, `Period: ${d(s.from)} to ${d(s.to)}`, "");
  lines.push(`PAYMENTS YOU MADE: ${gbp(sum(s.payments))}`, ...(s.payments.length ? s.payments.map((p) => `  ${d(p.date)}  ${gbp(p.amount)}`) : ["  None in this period"]), "");
  lines.push(`FEES TAKEN: ${gbp(sum(s.fees))}`, ...(s.fees.length ? s.fees.map((p) => `  ${d(p.date)}  ${gbp(p.amount)}`) : ["  None in this period"]), "");
  lines.push(`PAID TO YOUR CREDITORS: ${gbp(sum(s.paid_out))}`, ...(s.paid_out.length ? s.paid_out.map((p) => `  ${d(p.date)}  ${p.creditor}  ${gbp(p.amount)}`) : ["  None in this period"]), "");
  lines.push("WHAT YOU STILL OWE", ...(s.creditors.length ? s.creditors.map((c) => `  ${c.name}${c.reference ? " (" + c.reference + ")" : ""}  ${gbp(c.balance)}`) : ["  No creditors on file"]), `  Total  ${gbp(s.creditors.reduce((t, c) => t + Number(c.balance), 0))}`, "");
  lines.push(`HELD FOR YOU, NOT YET PAID OUT: ${gbp(s.held_now)}`, "", "If anything here looks wrong, or your circumstances have changed, please contact us.");
  return lines.join("\n");
}

export function StatementPanel({ caseId, caseData }: { caseId: string; caseData: DebtCase }) {
  const today = new Date().toISOString().slice(0, 10);
  const yearAgo = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
  const [from, setFrom] = useState(yearAgo);
  const [to, setTo] = useState(today);
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function generate() {
    setBusy(true); setMsg(null);
    const { data, error } = await supabase.rpc("dv_annual_statement", { p_case: caseId, p_from: from, p_to: to });
    setBusy(false);
    if (error) { setMsg(error.message); return; }
    setText(statementText(data as Statement));
  }
  async function save() {
    try { await saveLetter({ case_id: caseId, organization_id: caseData.organization_id, name: `Statement ${from} to ${to}`, category: "statement", template_id: null, body: text }); setMsg("Saved to this case."); }
    catch (e) { setMsg((e as Error).message); }
  }

  return (
    <div className="panel space-y-3 p-4">
      <div className="flex items-center gap-2"><FileBarChart className="h-4 w-4 text-slate-400" /><h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Client statement</h3></div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-[11px] text-slate-500">From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="input mt-0.5 block text-sm" /></label>
        <label className="text-[11px] text-slate-500">To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="input mt-0.5 block text-sm" /></label>
        <button disabled={busy} onClick={generate} className="btn btn-primary bg-emerald-600 hover:bg-emerald-700">Create statement</button>
      </div>
      {text && (
        <>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={16} className="input w-full font-mono text-xs" />
          <div className="flex gap-2">
            <button onClick={() => printLetter("Statement", text)} className="btn btn-secondary text-sm"><Printer className="h-4 w-4" /> Print / PDF</button>
            <button onClick={save} className="btn btn-secondary text-sm"><Save className="h-4 w-4" /> Save to case</button>
          </div>
        </>
      )}
      {msg && <p className="text-xs text-slate-500">{msg}</p>}
    </div>
  );
}
