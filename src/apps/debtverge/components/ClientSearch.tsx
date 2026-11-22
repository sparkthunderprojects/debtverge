import { useEffect, useRef, useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import { supabase } from "@/core/supabase";

export interface ClientHit {
  case_id: string; case_number: string; debtor_name: string; status: string; email: string | null; phone: string | null;
  date_of_birth: string | null; address: string | null; adviser_name: string | null; matched_on: string;
}
const dobText = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const initials = (n: string) => n.split(" ").filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase();

/** Search every client you are allowed to see by name, phone, email, date of birth, address or case number. Press / or Ctrl+K to jump to it. */
export function ClientSearch({ onOpenCase }: { onOpenCase: (caseId: string) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<ClientHit[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [searched, setSearched] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    const t = q.trim();
    if (t.length < 2) { setHits([]); setSearched(""); setErr(null); setBusy(false); return; }
    setBusy(true);
    const id = ++seq.current;
    const h = setTimeout(async () => {
      const { data, error } = await supabase.rpc("dv_search_clients", { p_q: t });
      if (id !== seq.current) return;
      setBusy(false); setSearched(t);
      if (error) { setErr("Search is unavailable right now."); setHits([]); return; }
      setErr(null); setHits((data ?? []) as ClientHit[]); setActive(0);
    }, 250);
    return () => clearTimeout(h);
  }, [q]);

  useEffect(() => {
    const down = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => {
      const typing = /input|textarea|select/i.test((e.target as HTMLElement)?.tagName ?? "") || (e.target as HTMLElement)?.isContentEditable;
      if ((e.key === "k" && (e.ctrlKey || e.metaKey)) || (e.key === "/" && !typing)) { e.preventDefault(); input.current?.focus(); setOpen(true); }
    };
    document.addEventListener("mousedown", down); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); };
  }, []);

  function pick(h: ClientHit) { setOpen(false); setQ(""); setHits([]); input.current?.blur(); onOpenCase(h.case_id); }
  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") { setOpen(false); input.current?.blur(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, hits.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter" && hits[active]) { e.preventDefault(); pick(hits[active]); }
  }

  return (
    <div ref={box} className="relative mx-2 w-full max-w-xl flex-1">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input
        ref={input} value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={onKey}
        placeholder="Search clients by name, phone, email, date of birth or address" aria-label="Search clients" autoComplete="off" spellCheck={false}
        className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-16 text-sm text-slate-800 placeholder:text-slate-400 focus:border-emerald-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:bg-slate-800"
      />
      <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
        {q && <button onClick={() => { setQ(""); input.current?.focus(); }} aria-label="Clear search" className="rounded p-0.5 text-slate-400 hover:text-slate-700"><X className="h-3.5 w-3.5" /></button>}
        {!q && <kbd className="hidden rounded border border-slate-200 px-1.5 text-[10px] font-semibold text-slate-400 sm:block dark:border-slate-600">/</kbd>}
      </div>
      {open && q.trim().length >= 2 && (
        <div className="absolute left-0 right-0 top-11 z-[70] max-h-[28rem] overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-2xl dark:border-slate-700 dark:bg-slate-800">
          {err && <p className="px-3 py-3 text-xs text-rose-600">{err}</p>}
          {!err && !busy && searched === q.trim() && hits.length === 0 && <p className="px-3 py-3 text-sm text-slate-500">No clients match "{q.trim()}". Try a surname, phone number, postcode or date of birth like 14/03/1985.</p>}
          {hits.map((h, i) => (
            <button key={h.case_id} onClick={() => pick(h)} onMouseEnter={() => setActive(i)}
              className={`flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left ${i === active ? "bg-emerald-50 dark:bg-emerald-500/10" : ""}`}>
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[11px] font-bold text-slate-600 dark:bg-slate-700 dark:text-slate-200">{initials(h.debtor_name)}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2"><span className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{h.debtor_name}</span><span className="shrink-0 text-[11px] text-slate-400">{h.case_number}</span>
                  <span className="ml-auto shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500 dark:bg-slate-700 dark:text-slate-300">matched {h.matched_on}</span></span>
                <span className="mt-0.5 block truncate text-xs text-slate-500 dark:text-slate-400">
                  {[h.phone, h.email, h.date_of_birth ? "born " + dobText(h.date_of_birth) : null].filter(Boolean).join(" · ") || "No contact details yet"}
                </span>
                {h.address && <span className="block truncate text-[11px] text-slate-400">{h.address}</span>}
              </span>
            </button>
          ))}
          {hits.length === 15 && <p className="px-3 py-1.5 text-[11px] text-slate-400">Showing the first 15. Keep typing to narrow it down.</p>}
        </div>
      )}
    </div>
  );
}
