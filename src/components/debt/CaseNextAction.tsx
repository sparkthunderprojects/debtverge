import { useEffect, useState } from "react";
import { AlertTriangle, CalendarClock, CheckCircle2, ClipboardList, Link2, ShieldAlert, UserCog, FileText } from "lucide-react";
import type { DebtCase } from "@/lib/types";
import { supabase } from "@/lib/supabase";
import { daysUntil } from "@/lib/home-hooks";

type Tone = "rose" | "amber" | "blue" | "emerald";
interface Action { tone: Tone; icon: React.ReactNode; title: string; detail: string; buttons: { label: string; onClick: () => void; primary?: boolean }[] }

const TONE: Record<Tone, string> = {
  rose: "border-rose-300 bg-rose-50 dark:border-rose-500/40 dark:bg-rose-500/10",
  amber: "border-amber-300 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-500/10",
  blue: "border-blue-300 bg-blue-50 dark:border-blue-500/40 dark:bg-blue-500/10",
  emerald: "border-emerald-300 bg-emerald-50 dark:border-emerald-500/40 dark:bg-emerald-500/10",
};
const ICON_TONE: Record<Tone, string> = { rose: "text-rose-600", amber: "text-amber-600", blue: "text-blue-600", emerald: "text-emerald-600" };

/** One clear "what should I do next" banner at the top of a case. */
export function CaseNextAction({ caseData, onSendLink, onGoTab }: { caseData: DebtCase; onSendLink: () => void; onGoTab: (tab: string) => void }) {
  const [vulnHigh, setVulnHigh] = useState(false);
  const [pendingChanges, setPendingChanges] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [v, c] = await Promise.all([
        supabase.from("debt_vulnerability_assessments").select("vulnerability_level").eq("case_id", caseData.id).in("vulnerability_level", ["high", "critical"]).limit(1),
        supabase.from("portal_change_requests").select("id", { count: "exact", head: true }).eq("case_id", caseData.id).eq("status", "pending"),
      ]);
      if (!alive) return;
      setVulnHigh((v.data ?? []).length > 0);
      setPendingChanges(c.count ?? 0);
    })();
    return () => { alive = false; };
  }, [caseData.id]);

  const days = daysUntil(caseData.next_due_date);
  const active = caseData.status === "payment_schedule_active";
  let a: Action | null = null;

  if (active && days !== null && days < 0) {
    a = { tone: "rose", icon: <AlertTriangle className="h-5 w-5" />, title: `Payment ${-days} day${-days === 1 ? "" : "s"} overdue`,
      detail: "Contact the client. If they can pay now, send a link so they don't need to log in.",
      buttons: [{ label: "Send payment link", onClick: onSendLink, primary: true }, { label: "Payments", onClick: () => onGoTab("payment_schedule") }] };
  } else if (pendingChanges > 0) {
    a = { tone: "amber", icon: <UserCog className="h-5 w-5" />, title: `${pendingChanges} change request${pendingChanges === 1 ? "" : "s"} from the client`,
      detail: "Submitted from their payment page. A team manager approves these.", buttons: [{ label: "View profile", onClick: () => onGoTab("profile"), primary: true }] };
  } else if (caseData.status === "intake") {
    a = { tone: "blue", icon: <ClipboardList className="h-5 w-5" />, title: "Complete the client profile",
      detail: "Add contact, address and household details, then move on to the budget.", buttons: [{ label: "Open profile", onClick: () => onGoTab("profile"), primary: true }] };
  } else if (caseData.status === "sfs_pending") {
    a = { tone: "blue", icon: <FileText className="h-5 w-5" />, title: "Budget needs sign-off",
      detail: "Review income and expenses with the client, then approve the budget.", buttons: [{ label: "Open budget", onClick: () => onGoTab("intake"), primary: true }] };
  } else if (active && days !== null && days <= 3) {
    a = { tone: "amber", icon: <CalendarClock className="h-5 w-5" />, title: days === 0 ? "Payment due today" : `Payment due in ${days} day${days === 1 ? "" : "s"}`,
      detail: "A quick reminder now makes a missed payment less likely.", buttons: [{ label: "Send payment link", onClick: onSendLink, primary: true }] };
  }

  if (!a && !vulnHigh) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-2.5 text-sm text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
        <CheckCircle2 className="h-4 w-4" /> Nothing needs doing on this case right now.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {a && (
        <div className={`flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 ${TONE[a.tone]}`}>
          <span className={ICON_TONE[a.tone]}>{a.icon}</span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{a.title}</p>
            <p className="text-xs text-slate-600 dark:text-slate-300">{a.detail}</p>
          </div>
          <div className="flex gap-2">
            {a.buttons.map((b) => (
              <button key={b.label} onClick={b.onClick} className={b.primary ? "btn btn-primary bg-emerald-600 px-3 py-1.5 text-xs hover:bg-emerald-700" : "btn btn-secondary px-3 py-1.5 text-xs"}>
                {b.primary && b.label.includes("link") && <Link2 className="h-3.5 w-3.5" />}{b.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {vulnHigh && (
        <div className="flex items-center gap-3 rounded-xl border border-rose-300 bg-rose-50 px-4 py-2.5 dark:border-rose-500/40 dark:bg-rose-500/10">
          <ShieldAlert className="h-5 w-5 text-rose-600" />
          <p className="flex-1 text-sm font-semibold text-rose-800 dark:text-rose-200">High vulnerability flagged. Follow the vulnerable customer process.</p>
          <button onClick={() => onGoTab("vulnerability")} className="btn btn-secondary px-3 py-1.5 text-xs">View assessment</button>
        </div>
      )}
    </div>
  );
}
