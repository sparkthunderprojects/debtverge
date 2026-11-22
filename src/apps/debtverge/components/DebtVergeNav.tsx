import { useRef, useState, useEffect } from "react";
import { Banknote, Bell, ClipboardCheck, ChevronDown, LogOut, Landmark, Moon, Sun, Users } from "lucide-react";
import { useAuth } from "@/core/auth";
import { useTheme } from "@/core/theme";
import { supabase } from "@/core/supabase";
import { ClientSearch } from "@/apps/debtverge/components/ClientSearch";

export interface DebtVergeNavProps {
  appName: string;
  onOpenCase?: (caseId: string) => void;
  screen?: "clients" | "payments" | "compliance" | null;
  onOpenScreen?: (screen: "clients" | "payments" | "compliance") => void;
  showCompliance?: boolean;
}

export function DebtVergeNav({ appName, showCompliance, onOpenCase, screen, onOpenScreen }: DebtVergeNavProps) {
  const { user, signOut } = useAuth();
  const { theme, toggle } = useTheme();
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [notifCount, setNotifCount] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const dark = theme === "dark";

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setNotifOpen(false);
        setProfileOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("read", false)
      .limit(1)
      .then(({ count }) => setNotifCount(count ?? 0), () => setNotifCount(0));
  }, []);

  const greeting = user?.email?.split("@")[0] ?? "User";
  const iconBtn = `flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
    dark ? "text-slate-300 hover:bg-slate-800" : "text-slate-600 hover:bg-slate-100"
  }`;

  return (
    <div
      ref={ref}
      className={`sticky top-0 z-[60] flex h-12 shrink-0 items-center justify-between border-b px-3 backdrop-blur-md sm:px-4 ${
        dark ? "border-slate-700 bg-slate-900/95" : "border-slate-200 bg-white/95"
      }`}
    >
      <div className="flex shrink-0 items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-600 to-teal-500 text-white shadow-sm">
          <Landmark className="h-3.5 w-3.5" />
        </div>
        <span className={`text-sm font-bold tracking-tight ${dark ? "text-slate-100" : "text-slate-800"}`}>
          {appName}
        </span>
      </div>

      {onOpenCase && <ClientSearch onOpenCase={onOpenCase} />}

      {onOpenScreen && (
        <div className="flex shrink-0 items-center gap-1">
          {([["clients", "Clients", Users], ["payments", "Payment Suite", Banknote], ...(showCompliance ? [["compliance", "Call compliance", ClipboardCheck] as const] : [])] as const).map(([key, label, Icon]) => (
            <button key={key} onClick={() => onOpenScreen(key)} title={label} aria-label={label}
              className={`flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold transition-colors ${screen === key ? "bg-emerald-600 text-white" : dark ? "text-slate-200 hover:bg-slate-800" : "text-slate-700 hover:bg-slate-100"}`}>
              <Icon className="h-4 w-4" /><span className="hidden lg:inline">{label}</span>
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-1">
        <button onClick={toggle} className={iconBtn} title="Toggle theme" aria-label="Toggle theme">
          {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>

        <div className="relative">
          <button
            onClick={() => { setNotifOpen((o) => !o); setProfileOpen(false); }}
            className={`relative ${iconBtn}`}
            title="Notifications"
            aria-label="Notifications"
          >
            <Bell className="h-4 w-4" />
            {notifCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
                {notifCount > 9 ? "9+" : notifCount}
              </span>
            )}
          </button>
          {notifOpen && (
            <div className={`absolute right-0 top-10 z-50 w-72 rounded-2xl border p-4 shadow-2xl ${dark ? "border-slate-700 bg-slate-800" : "border-slate-200 bg-white"}`}>
              <p className={`mb-2 text-sm font-semibold ${dark ? "text-slate-100" : "text-slate-900"}`}>Notifications</p>
              <p className={`text-xs ${dark ? "text-slate-400" : "text-slate-500"}`}>
                {notifCount === 0 ? "You're all caught up." : `You have ${notifCount} unread notification${notifCount > 1 ? "s" : ""}.`}
              </p>
            </div>
          )}
        </div>

        <div className="relative">
          <button
            onClick={() => { setProfileOpen((o) => !o); setNotifOpen(false); }}
            className={`flex items-center gap-1.5 rounded-lg px-2 py-1 transition-colors ${dark ? "hover:bg-slate-800" : "hover:bg-slate-100"}`}
          >
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-emerald-600 to-teal-500 text-xs font-bold text-white">
              {greeting.slice(0, 2).toUpperCase()}
            </div>
            <span className={`hidden text-xs font-semibold sm:inline ${dark ? "text-slate-200" : "text-slate-700"}`}>{greeting}</span>
            <ChevronDown className="h-3 w-3 text-slate-400" />
          </button>
          {profileOpen && (
            <div className={`absolute right-0 top-10 z-50 w-56 rounded-2xl border p-2 shadow-2xl ${dark ? "border-slate-700 bg-slate-800" : "border-slate-200 bg-white"}`}>
              <div className={`mb-2 rounded-lg px-3 py-2 ${dark ? "bg-slate-700/50" : "bg-slate-50"}`}>
                <p className={`text-xs font-semibold ${dark ? "text-slate-100" : "text-slate-900"}`}>{`Welcome, ${greeting}`}</p>
                <p className={`truncate text-[10px] ${dark ? "text-slate-400" : "text-slate-500"}`}>{user?.email ?? ""}</p>
              </div>
              <button
                onClick={() => signOut()}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-red-500 transition-colors hover:bg-red-50 dark:hover:bg-red-900/20"
              >
                <LogOut className="h-3.5 w-3.5" /> Sign Out
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
