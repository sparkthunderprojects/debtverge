import { useMemo, useRef, useState } from "react";
import { FileText, Paperclip, Printer, Save, Trash2, Download, Copy, BookmarkPlus } from "lucide-react";
import { useAuth } from "../../lib/auth";
import { useDebtCreditors } from "../../lib/debt-hooks";
import { MERGE_FIELDS, mergeValues, renderTemplate, useTemplates, useCaseDocuments, saveLetter, uploadCaseFile, openCaseFile, deleteCaseDocument, saveAsTemplate, printLetter, useFirmName } from "../../lib/document-hooks";
import { supabase } from "../../lib/supabase";
import type { DebtCase } from "../../lib/types";
import { StatementPanel } from "./StatementPanel";

export function DocumentsTab({ caseId, caseData }: { caseId: string | null; caseData: DebtCase | null }) {
  const { user, dvRole } = useAuth();
  const { templates } = useTemplates();
  const { docs, reload } = useCaseDocuments(caseId);
  const { data: creditors } = useDebtCreditors(caseId);
  const [tplId, setTplId] = useState("");
  const [creditorId, setCreditorId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const tpl = templates.find((t) => t.id === tplId) ?? null;
  const creditor = creditors.find((c) => c.id === creditorId) ?? null;
  const adviser = (user?.user_metadata?.full_name as string) || user?.email || "Your adviser";
  const firm = useFirmName();
  const values = useMemo(() => (caseData ? mergeValues(caseData, creditor, { firm, adviser }) : {}), [caseData, creditor, adviser, firm]);

  if (!caseId || !caseData) return <div className="flex h-full items-center justify-center text-sm text-slate-400">Select a case to see its documents</div>;

  function pick(id: string) {
    setTplId(id); setMsg(null); setErr(null);
    const t = templates.find((x) => x.id === id);
    if (t) { setSubject(t.subject); setBody(t.body); if (t.audience === "customer") setCreditorId(""); }
  }
  const outSubject = renderTemplate(subject, values);
  const outBody = renderTemplate(body, values);
  const unfilled = Array.from(new Set((outBody + outSubject).match(/\{\{\w+\}\}/g) ?? []));
  const needsCreditor = tpl?.audience === "creditor" && !creditor;

  async function run(fn: () => Promise<void>, ok: string) {
    setErr(null); setMsg(null);
    try { await fn(); setMsg(ok); await reload(); } catch (e) { setErr((e as Error).message); }
  }

  const save = () => run(() => saveLetter({ case_id: caseId!, organization_id: caseData!.organization_id, name: outSubject || tpl?.name || "Letter", category: tpl?.category ?? "general", template_id: tpl?.id ?? null, body: outBody }), "Saved to this case.");
  const isManager = dvRole === "team_manager" || dvRole === "operations_manager" || dvRole === "admin";

  return (
    <div className="space-y-4">
      {err && <div className="rounded-xl bg-rose-50 px-4 py-2 text-sm text-rose-700 dark:bg-rose-500/20 dark:text-rose-300">{err}</div>}
      {msg && <div className="rounded-xl bg-emerald-50 px-4 py-2 text-sm text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">{msg}</div>}

      <StatementPanel caseId={caseId!} caseData={caseData!} />
      <div className="panel space-y-3 p-4">
        <div className="flex items-center gap-2"><FileText className="h-4 w-4 text-slate-400" /><h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Write a letter</h3></div>
        <div className="grid gap-2 sm:grid-cols-2">
          <select value={tplId} onChange={(e) => pick(e.target.value)} className="input text-sm">
            <option value="">Choose a template…</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}{t.organization_id ? " (yours)" : ""}</option>)}
          </select>
          {tpl?.audience === "creditor" && (
            <select value={creditorId} onChange={(e) => setCreditorId(e.target.value)} className="input text-sm">
              <option value="">Choose a creditor…</option>
              {creditors.map((c) => <option key={c.id} value={c.id}>{c.creditor_name}</option>)}
            </select>
          )}
        </div>
        {tpl && (
          <>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} className="input text-sm" placeholder="Subject" />
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={12} className="input font-mono text-xs" />
            <div className="rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800/60">
              <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">Preview</p>
              <p className="whitespace-pre-wrap text-slate-700 dark:text-slate-200"><span className="font-semibold">{outSubject}</span>{"\n\n"}{outBody}</p>
            </div>
            {(needsCreditor || unfilled.length > 0) && (
              <p className="text-xs text-amber-600">{needsCreditor ? "Choose a creditor to fill in its details." : `Still to fill in: ${unfilled.join(", ")}`}</p>
            )}
            <div className="flex flex-wrap gap-2">
              <button onClick={save} disabled={needsCreditor} className="btn btn-primary text-sm disabled:opacity-40"><Save className="h-4 w-4" /> Save to case</button>
              <button onClick={() => printLetter(outSubject, outBody)} className="btn btn-secondary text-sm"><Printer className="h-4 w-4" /> Print / PDF</button>
              <button onClick={() => navigator.clipboard.writeText(outBody).then(() => setMsg("Copied."))} className="btn btn-secondary text-sm"><Copy className="h-4 w-4" /> Copy</button>
              {isManager && caseData.organization_id && (
                <button onClick={() => run(async () => { const { data: o } = await supabase.rpc("dv_my_org"); await saveAsTemplate((o as string) ?? caseData.organization_id!, { name: (tpl.name + " (edited)").slice(0, 80), category: tpl.category, audience: tpl.audience, subject, body }); }, "Saved as a firm template.")} className="btn btn-secondary text-sm"><BookmarkPlus className="h-4 w-4" /> Save as firm template</button>
              )}
            </div>
            <p className="text-[11px] text-slate-400">Fields you can use: {MERGE_FIELDS.map((f) => `{{${f}}}`).join("  ")}</p>
          </>
        )}
      </div>

      <div className="panel space-y-2 p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Case documents <span className="text-xs font-normal text-slate-400">({docs.length})</span></h3>
          <button onClick={() => fileRef.current?.click()} className="btn btn-secondary text-xs"><Paperclip className="h-3.5 w-3.5" /> Upload file</button>
          <input ref={fileRef} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) run(() => uploadCaseFile(caseId!, caseData!.organization_id, f, "uploaded"), "Uploaded."); e.target.value = ""; }} />
        </div>
        {docs.length === 0 ? <p className="py-2 text-xs text-slate-400">No documents yet. Saved letters and uploaded files appear here.</p> : docs.map((d) => (
          <div key={d.id} className="group flex items-center gap-3 rounded-lg border border-slate-100 p-2.5 dark:border-slate-700/50">
            <FileText className="h-4 w-4 flex-none text-slate-400" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{d.name}</p>
              <p className="text-[11px] text-slate-400">{new Date(d.created_at).toLocaleDateString("en-GB")} · {d.storage_path ? "file" : "letter"}</p>
            </div>
            {d.storage_path
              ? <button onClick={() => run(() => openCaseFile(d.storage_path!), "")} className="rounded p-1.5 text-slate-400 hover:text-emerald-600" title="Open"><Download className="h-4 w-4" /></button>
              : <button onClick={() => printLetter(d.name, d.body ?? "")} className="rounded p-1.5 text-slate-400 hover:text-emerald-600" title="Print"><Printer className="h-4 w-4" /></button>}
            <button onClick={() => run(() => deleteCaseDocument(d), "Deleted.")} className="rounded p-1.5 text-slate-300 hover:text-rose-500" title="Delete"><Trash2 className="h-4 w-4" /></button>
          </div>
        ))}
      </div>
    </div>
  );
}
