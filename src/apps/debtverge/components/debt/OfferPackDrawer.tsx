import { useState, useMemo } from "react";
import { jsPDF } from "jspdf";
import { X, FileDown, Mail, Printer, Check, Landmark } from "lucide-react";
import {
  useDebtCreditors, useDebtSfsEntries,
  calculateProRataSimple, generateOfferLetterText,
} from "@/apps/debtverge/lib/debt-hooks";
import { formatCurrency } from "@/core/format";
import type { DebtCase, DebtCreditor } from "@/core/types";

interface Props {
  caseData: DebtCase;
  onClose: () => void;
}

export function OfferPackDrawer({ caseData, onClose }: Props) {
  const { data: creditors, loading } = useDebtCreditors(caseData.id);
  const { data: sfsEntries } = useDebtSfsEntries(caseData.id);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [previewId, setPreviewId] = useState<string | null>(null);

  const proRataResults = useMemo(
    () => calculateProRataSimple(caseData.monthly_disposable_income, creditors),
    [caseData.monthly_disposable_income, creditors],
  );

  const previewCreditor =
    creditors.find((c) => c.id === previewId) ??
    creditors.find((c) => selectedIds.includes(c.id)) ??
    null;

  const previewProRata = proRataResults.find((p) => p.id === previewCreditor?.id);

  const previewLetter = useMemo(() => {
    if (!previewCreditor) return "";
    return generateOfferLetterText(
      caseData, previewCreditor, sfsEntries, previewProRata?.pro_rata_amount ?? 0,
    );
  }, [caseData, previewCreditor, sfsEntries, previewProRata]);

  function toggleCreditor(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
    setPreviewId(id);
  }

  function selectAll() {
    setSelectedIds(creditors.map((c) => c.id));
  }

  function deselectAll() {
    setSelectedIds([]);
  }

  function exportSinglePdf(creditor: DebtCreditor) {
    const proRata = proRataResults.find((p) => p.id === creditor.id);
    const text = generateOfferLetterText(
      caseData, creditor, sfsEntries, proRata?.pro_rata_amount ?? 0,
    );
    const doc = new jsPDF();
    const lines = doc.splitTextToSize(text, 180);
    doc.text(lines, 10, 10);
    doc.save(
      `DMP_Proposal_${creditor.creditor_name.replace(/\s+/g, "_")}_${caseData.case_number}.pdf`,
    );
  }

  function exportAllPdfs() {
    const selected = creditors.filter((c) => selectedIds.includes(c.id));
    if (selected.length === 0) return;
    const doc = new jsPDF();
    selected.forEach((creditor, idx) => {
      if (idx > 0) doc.addPage();
      const proRata = proRataResults.find((p) => p.id === creditor.id);
      const text = generateOfferLetterText(
        caseData, creditor, sfsEntries, proRata?.pro_rata_amount ?? 0,
      );
      const lines = doc.splitTextToSize(text, 180);
      doc.text(lines, 10, 10);
    });
    doc.save(`DMP_Proposal_Pack_${caseData.case_number}.pdf`);
  }

  function printLetter() {
    if (!previewCreditor) return;
    const proRata = proRataResults.find((p) => p.id === previewCreditor.id);
    const text = generateOfferLetterText(
      caseData, previewCreditor, sfsEntries, proRata?.pro_rata_amount ?? 0,
    );
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(
      `<pre style="font-family:'Courier New',monospace;font-size:12px;padding:40px;white-space:pre-wrap;">${
        text.replace(/</g, "&lt;")
      }</pre>`,
    );
    win.document.close();
    win.print();
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-4xl flex-col bg-white shadow-2xl dark:bg-slate-900">
        {/* Header */}
        <div className="flex shrink-0 items-center gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-700">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-500/10">
            <Mail className="h-5 w-5 text-emerald-600" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">
              Creditor Offer Pack Generator
            </h3>
            <p className="text-xs text-slate-400">
              {caseData.case_number} — {caseData.debtor_name}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex min-h-0 flex-1">
          {/* Creditor Selection */}
          <div className="flex w-60 shrink-0 flex-col border-r border-slate-200 dark:border-slate-700">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-700/50">
              <span className="text-xs font-bold uppercase tracking-wide text-slate-400">
                Creditors ({creditors.length})
              </span>
              <div className="flex gap-1">
                <button onClick={selectAll} className="text-[10px] text-emerald-600 hover:underline">
                  All
                </button>
                <span className="text-slate-300">·</span>
                <button onClick={deselectAll} className="text-[10px] text-slate-400 hover:underline">
                  None
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2">
              {loading ? (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="skeleton h-14 rounded-lg" />
                  ))}
                </div>
              ) : creditors.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-slate-400">
                  <Landmark className="mb-2 h-7 w-7 opacity-30" />
                  <p className="text-xs">No creditors on this case</p>
                </div>
              ) : (
                creditors.map((c) => {
                  const proRata = proRataResults.find((p) => p.id === c.id);
                  const isSelected = selectedIds.includes(c.id);
                  const isPreview = previewId === c.id;
                  return (
                    <button
                      key={c.id}
                      onClick={() => toggleCreditor(c.id)}
                      className={`w-full rounded-xl border p-2.5 text-left transition-all ${
                        isPreview
                          ? "border-emerald-500/50 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10"
                          : "border-slate-200 hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border-2 ${
                            isSelected
                              ? "border-emerald-600 bg-emerald-600"
                              : "border-slate-300 dark:border-slate-600"
                          }`}
                        >
                          {isSelected && <Check className="h-3 w-3 text-white" />}
                        </div>
                        <p className="truncate text-xs font-medium text-slate-700 dark:text-slate-200">
                          {c.creditor_name}
                        </p>
                      </div>
                      <div className="mt-1 flex items-center justify-between pl-6">
                        <span className="text-[10px] text-slate-400">
                          {formatCurrency(c.current_balance, "GBP", { compact: true })}
                        </span>
                        <span className="text-[10px] font-semibold text-emerald-600">
                          {formatCurrency(proRata?.pro_rata_amount ?? 0)}/mo
                        </span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Letter Preview */}
          <div className="flex min-w-0 flex-1 flex-col">
            {previewCreditor ? (
              <>
                <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-700/50">
                  <div>
                    <p className="text-xs font-bold text-slate-700 dark:text-slate-200">
                      Preview: {previewCreditor.creditor_name}
                    </p>
                    <p className="text-[10px] text-slate-400">
                      DMP Proposal Letter with SFS Breakdown
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={printLetter} className="btn btn-secondary text-xs">
                      <Printer className="h-3.5 w-3.5" /> Print
                    </button>
                    <button
                      onClick={() => exportSinglePdf(previewCreditor)}
                      className="btn btn-secondary text-xs"
                    >
                      <FileDown className="h-3.5 w-3.5" /> Export PDF
                    </button>
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-auto bg-slate-50 p-6 dark:bg-slate-800/30">
                  <div className="mx-auto max-w-2xl rounded-lg bg-white p-8 shadow-sm dark:bg-slate-800">
                    <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-slate-700 dark:text-slate-300">
                      {previewLetter}
                    </pre>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center text-slate-400">
                <div className="text-center">
                  <Mail className="mx-auto mb-3 h-10 w-10 opacity-30" />
                  <p className="text-sm">Select a creditor to preview the offer letter</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-between border-t border-slate-200 px-5 py-3 dark:border-slate-700">
          <span className="text-xs text-slate-400">
            {selectedIds.length > 0
              ? `${selectedIds.length} creditor${selectedIds.length > 1 ? "s" : ""} selected`
              : "Select creditors to export"}
          </span>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn btn-secondary text-sm">
              Close
            </button>
            <button
              onClick={exportAllPdfs}
              disabled={selectedIds.length === 0}
              className="btn btn-primary bg-emerald-600 text-sm hover:bg-emerald-700 disabled:opacity-40"
            >
              <FileDown className="h-4 w-4" /> Export{" "}
              {selectedIds.length > 0 ? `${selectedIds.length} ` : ""}Offer Pack
              {selectedIds.length > 1 ? "s" : ""}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
