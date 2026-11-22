import { useEffect, useRef, useState } from "react";
import { ChevronDown, LayoutGrid } from "lucide-react";
import { appPath, useMyApps } from "./apps-hooks";

/** Lets a person move between the apps their firm has licensed to them. Hidden when there is only one. */
export function AppSwitcher({ currentAppId, dark }: { currentAppId: string; dark?: boolean }) {
  const { available } = useMyApps();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  if (available.length < 2) return null;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Switch app"
        title="Switch app"
        className={`flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-semibold transition-colors ${dark ? "text-slate-200 hover:bg-slate-800" : "text-slate-700 hover:bg-slate-100"}`}
      >
        <LayoutGrid className="h-4 w-4" />
        <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <div className={`absolute left-0 top-9 z-[70] w-52 rounded-lg border p-1 shadow-lg ${dark ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white"}`}>
          {available.map((a) => (
            <a
              key={a.app_id}
              href={appPath(a.app_id)}
              className={`block rounded-md px-3 py-2 text-sm ${a.app_id === currentAppId ? "bg-emerald-600 text-white" : dark ? "text-slate-200 hover:bg-slate-800" : "text-slate-700 hover:bg-slate-100"}`}
            >
              {a.name}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
