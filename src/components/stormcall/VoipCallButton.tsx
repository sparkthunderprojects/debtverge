import { useState, useMemo, useEffect } from "react";
import { PhoneCall, Search, X, Users, FileText, Phone, ChevronRight, Loader2 } from "lucide-react";
import { useStormCall } from "@/lib/stormcall-context";
import { useDebtCases } from "@/lib/debt-hooks";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import type { StormCallLaunchContext } from "@/lib/types";
import type { DebtCase } from "@/lib/types";

type SearchTab = "customers" | "leads" | "cases";

interface LeadSearchResult {
  id: string;
  prospect_name: string;
  reference: string;
  phone: string;
  email: string;
  status: string;
}

export interface VoipCallButtonProps {
  applicationSource: string;
  caseData?: DebtCase | null;
  customerName?: string | null;
  customerReference?: string | null;
  caseNumber?: string | null;
  caseId?: string | null;
  phoneNumber?: string | null;
  leadReference?: string | null;
  customerId?: string | null;
  variant?: "card" | "button" | "icon";
  label?: string;
  className?: string;
}

export function VoipCallButton({
  applicationSource, caseData, customerName, customerReference, caseNumber,
  caseId, phoneNumber, leadReference, customerId,
  variant = "button", label = "Make a VoIP Call", className = "",
}: VoipCallButtonProps) {
  const { canAccessApp } = useAuth();
  const stormCallCtx = useStormCall();
  const launchCall = stormCallCtx?.launchCall;
  const activeCall = stormCallCtx?.activeCall;
  const [showSearch, setShowSearch] = useState(false);

  const hasContext = customerName || caseData || phoneNumber;
  const isLaunching = activeCall?.status === "connecting" && activeCall?.context?.applicationSource === applicationSource;

  if (!canAccessApp("stormcall")) return null;

  const handleClick = () => {
    if (!launchCall) return;
    if (hasContext) {
      const launchCtx: StormCallLaunchContext = {
        customerName: customerName ?? caseData?.debtor_name ?? null,
        customerReference: customerReference ?? caseData?.case_number ?? null,
        caseNumber: caseNumber ?? caseData?.case_number ?? null,
        leadReference: leadReference ?? null,
        phoneNumber: phoneNumber ?? null,
        caseId: caseId ?? caseData?.id ?? null,
        customerId: customerId ?? null,
        applicationSource,
      };
      launchCall(launchCtx);
    } else {
      setShowSearch(true);
    }
  };

  if (variant === "icon") {
    return (
      <>
        <button onClick={handleClick} disabled={isLaunching}
          className={`flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 to-cyan-500 text-white shadow-sm transition-all hover:scale-105 disabled:opacity-50 ${className}`}
          title={label}>
          {isLaunching ? <Loader2 className="h-4 w-4 animate-spin" /> : <PhoneCall className="h-4 w-4" />}
        </button>
        {showSearch && <CustomerSearchModal applicationSource={applicationSource} onClose={() => setShowSearch(false)} />}
      </>
    );
  }

  if (variant === "card") {
    return (
      <>
        <button onClick={handleClick} disabled={isLaunching}
          className={`panel flex items-center gap-3 p-4 text-left transition-all hover:border-blue-300 hover:shadow-md disabled:opacity-50 ${className}`}>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 to-cyan-500 text-white shadow-sm">
            {isLaunching ? <Loader2 className="h-5 w-5 animate-spin" /> : <PhoneCall className="h-5 w-5" />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-slate-700 dark:text-slate-200">{label}</p>
            <p className="text-xs text-slate-400">{hasContext ? `Call ${customerName ?? caseData?.debtor_name ?? "customer"}` : "Search for a customer to call"}</p>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
        </button>
        {showSearch && <CustomerSearchModal applicationSource={applicationSource} onClose={() => setShowSearch(false)} />}
      </>
    );
  }

  return (
    <>
      <button onClick={handleClick} disabled={isLaunching}
        className={`btn bg-gradient-to-r from-blue-600 to-cyan-500 text-white shadow-sm transition-all hover:from-blue-700 hover:to-cyan-600 disabled:opacity-50 ${className}`}>
        {isLaunching ? <Loader2 className="h-4 w-4 animate-spin" /> : <PhoneCall className="h-4 w-4" />}
        {label}
      </button>
      {showSearch && <CustomerSearchModal applicationSource={applicationSource} onClose={() => setShowSearch(false)} />}
    </>
  );
}

function CustomerSearchModal({ applicationSource, onClose }: { applicationSource: string; onClose: () => void }) {
  const stormCallCtx = useStormCall();
  const launchCall = stormCallCtx?.launchCall;
  const { data: cases } = useDebtCases();
  const [tab, setTab] = useState<SearchTab>("customers");
  const [query, setQuery] = useState("");
  const [leads, setLeads] = useState<LeadSearchResult[]>([]);
  const [loadingLeads, setLoadingLeads] = useState(false);

  useEffect(() => {
    if (tab === "leads") loadLeads();
  }, [tab]);

  const loadLeads = async () => {
    setLoadingLeads(true);
    const { data, error } = await supabase.from("leads").select("id, prospect_name, reference, phone, email, status").limit(50);
    if (!error && data) setLeads(data as LeadSearchResult[]);
    setLoadingLeads(false);
  };

  const filteredCases = useMemo(() => {
    if (!query.trim()) return cases.slice(0, 20);
    const q = query.toLowerCase();
    return cases.filter(c => c.debtor_name.toLowerCase().includes(q) || c.case_number.toLowerCase().includes(q)).slice(0, 20);
  }, [cases, query]);

  const filteredLeads = useMemo(() => {
    if (!query.trim()) return leads.slice(0, 20);
    const q = query.toLowerCase();
    return leads.filter(l => l.prospect_name.toLowerCase().includes(q) || l.reference.toLowerCase().includes(q) || l.phone.includes(q)).slice(0, 20);
  }, [leads, query]);

  const handleSelectCase = (c: DebtCase) => {
    if (!launchCall) return;
    launchCall({
      customerName: c.debtor_name,
      customerReference: c.case_number,
      caseNumber: c.case_number,
      caseId: c.id,
      phoneNumber: null,
      customerId: null,
      leadReference: null,
      applicationSource,
    });
    onClose();
  };

  const handleSelectLead = (l: LeadSearchResult) => {
    if (!launchCall) return;
    launchCall({
      customerName: l.prospect_name,
      customerReference: l.reference,
      caseNumber: null,
      caseId: null,
      phoneNumber: l.phone,
      customerId: null,
      leadReference: l.reference,
      applicationSource,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm fade-in" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl dark:bg-slate-800 fade-in" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 p-4 dark:border-slate-700">
          <div className="flex items-center gap-2">
            <PhoneCall className="h-5 w-5 text-blue-600" />
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Start a VoIP Call</h2>
          </div>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-4">
          <div className="relative mb-3">
            <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
            <input value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Search by name, reference, or phone..."
              className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm dark:border-slate-700 dark:bg-slate-700/50" autoFocus />
          </div>

          <div className="mb-3 flex gap-1">
            {([
              { id: "customers" as const, label: "Customers", icon: Users },
              { id: "cases" as const, label: "Cases", icon: FileText },
              { id: "leads" as const, label: "Leads", icon: Phone },
            ]).map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                  tab === t.id ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300"
                }`}>
                <t.icon className="h-3.5 w-3.5" /> {t.label}
              </button>
            ))}
          </div>

          <div className="max-h-80 overflow-y-auto space-y-1.5">
            {tab === "customers" || tab === "cases" ? (
              filteredCases.length === 0 ? (
                <EmptyState text="No customers found" />
              ) : (
                filteredCases.map(c => (
                  <button key={c.id} onClick={() => handleSelectCase(c)}
                    className="flex w-full items-center gap-3 rounded-lg border border-slate-200 p-3 text-left transition-all hover:border-blue-300 hover:bg-blue-50/50 dark:border-slate-700 dark:hover:border-blue-600 dark:hover:bg-blue-500/5">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-xs font-bold text-blue-600 dark:bg-blue-500/10 dark:text-blue-400">
                      {c.debtor_name.split(" ").map(n => n[0]).slice(0, 2).join("")}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-700 dark:text-slate-200">{c.debtor_name}</p>
                      <p className="truncate text-xs text-slate-400">{c.case_number} · {c.plan_type.toUpperCase()}</p>
                    </div>
                    <PhoneCall className="h-4 w-4 shrink-0 text-blue-500" />
                  </button>
                ))
              )
            ) : (
              loadingLeads ? (
                <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-blue-500" /></div>
              ) : filteredLeads.length === 0 ? (
                <EmptyState text="No leads found" />
              ) : (
                filteredLeads.map(l => (
                  <button key={l.id} onClick={() => handleSelectLead(l)}
                    className="flex w-full items-center gap-3 rounded-lg border border-slate-200 p-3 text-left transition-all hover:border-blue-300 hover:bg-blue-50/50 dark:border-slate-700 dark:hover:border-blue-600 dark:hover:bg-blue-500/5">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-xs font-bold text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400">
                      {l.prospect_name.split(" ").map(n => n[0]).slice(0, 2).join("")}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-700 dark:text-slate-200">{l.prospect_name}</p>
                      <p className="truncate text-xs text-slate-400">{l.reference} · {l.phone}</p>
                    </div>
                    <PhoneCall className="h-4 w-4 shrink-0 text-blue-500" />
                  </button>
                ))
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-slate-400">
      <Search className="mb-2 h-8 w-8 opacity-30" />
      <p className="text-xs">{text}</p>
    </div>
  );
}
