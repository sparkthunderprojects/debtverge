import { useEffect, useState } from "react";
import { AlertTriangle, Banknote, CalendarClock, CheckCircle2, Link2, Loader2, Receipt } from "lucide-react";
import { formatCurrency } from "@/core/format";
import { fetchPaymentSuite, fetchPaymentSuiteOps, type PaymentSuite, type PaymentSuiteOps, type SuiteCaseRef } from "@/apps/debtverge/lib/book-hooks";

const gbp = (n: number) => formatCurrency(n, "GBP");
const dt = (s: string) => new Date(s.length > 10 ? s : s + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
type TabKey = "overdue" | "upcoming" | "receipts" | "links" | "payouts" | "recon" | "money" | "fees";

function Kpi({ label, value, sub, tone, icon }: { label: string; value: string; sub?: string; tone?: "bad" | "good"; icon: React.ReactNode }) {
  return (
    <div className="panel p-3">
      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">{icon}{label}</div>
      <p className={`mt-1 text-xl font-bold tabular-nums ${tone === "bad" ? "text-rose-600" : tone === "good" ? "text-emerald-600" : "text-slate-800 dark:text-slate-100"}`}>{value}</p>
      {sub && <p className="text-[11px] text-slate-400">{sub}</p>}
    </div>
  );
}

/** The firm's money in one place: what is late, what is coming, what came in, and what links are out. Each row opens the client's payment page. */
export function PaymentSuiteScreen({ onOpenCase }: { onOpenCase: (id: string, tab?: string) => void }) {
  const [s, setS] = useState<PaymentSuite | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ops, setOps] = useState<PaymentSuiteOps | null>(null);
  const [tab, setTab] = useState<TabKey>("overdue");
  useEffect(() => {
    fetchPaymentSuite().then(setS).catch((e) => setErr((e as Error).message));
    fetchPaymentSuiteOps().then(setOps).catch(() => setOps(null));
  }, []);
  if (err) return <p className="text-sm text-rose-600">{err}</p>;
  if (!s) return <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-emerald-600" /></div>;
  const k = s.kpis;
  const open = (r: SuiteCaseRef, t = "payment_schedule") => () => onOpenCase(r.case_id, t);
  const tabs: { key: TabKey; label: string; n: number }[] = [
    { key: "overdue", label: "Overdue", n: s.overdue.length }, { key: "upcoming", label: "Coming up", n: s.upcoming.length },
    { key: "receipts", label: "Received", n: s.receipts.length }, { key: "links", label: "Payment links", n: s.links.length },
    ...(ops ? [{ key: "payouts" as TabKey, label: "Creditor payouts", n: ops.payouts.runs.length }] : []),
    ...(ops?.reconciliation ? [{ key: "recon" as TabKey, label: "Bank reconciliation", n: ops.reconciliation.unmatched.length }, { key: "money" as TabKey, label: "Client money", n: ops.client_money?.history.length ?? 0 }, { key: "fees" as TabKey, label: "Fees", n: ops.fees?.by_status.length ?? 0 }] : []),
  ];
  const isOps = tab === "payouts" || tab === "recon" || tab === "money" || tab === "fees";
  const pill = (v: string) => <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300">{v.replace(/_/g, " ")}</span>;
  const Row = ({ r, children, tabTo }: { r: SuiteCaseRef; children: React.ReactNode; tabTo?: string }) => (
    <tr onClick={open(r, tabTo)} className="cursor-pointer border-b border-slate-50 hover:bg-emerald-50/50 dark:border-slate-800 dark:hover:bg-emerald-500/5">
      <td className="px-3 py-2"><p className="font-semibold text-slate-800 dark:text-slate-100">{r.debtor_name}</p><p className="text-[11px] text-slate-400">{r.case_number}</p></td>{children}
    </tr>
  );
  const Empty = ({ text }: { text: string }) => <tr><td colSpan={5} className="py-10 text-center text-sm text-slate-400">{text}</td></tr>;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2"><Banknote className="h-5 w-5 text-emerald-600" /><h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">Payment Suite</h2></div>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Kpi label="Overdue" value={gbp(k.overdue_amount)} sub={`${k.overdue_count} payment${k.overdue_count === 1 ? "" : "s"} · ${k.overdue_clients} client${k.overdue_clients === 1 ? "" : "s"}`} tone={k.overdue_count > 0 ? "bad" : "good"} icon={<AlertTriangle className="h-3.5 w-3.5" />} />
        <Kpi label="Due today" value={gbp(k.due_today_amount)} sub={`${k.due_today_count} payment${k.due_today_count === 1 ? "" : "s"}`} icon={<CalendarClock className="h-3.5 w-3.5" />} />
        <Kpi label="Due in 7 days" value={gbp(k.next7_amount)} sub={`${k.next7_count} payment${k.next7_count === 1 ? "" : "s"}`} icon={<CalendarClock className="h-3.5 w-3.5" />} />
        <Kpi label="Received, 90 days" value={gbp(k.received_90d)} sub={`${k.received_90d_count} payments${k.shortfalls_90d ? ` · ${k.shortfalls_90d} short` : ""}`} tone="good" icon={<CheckCircle2 className="h-3.5 w-3.5" />} />
      </div>
      <div className="flex flex-wrap gap-1">
        {tabs.map((t) => <button key={t.key} onClick={() => setTab(t.key)} className={`rounded-full px-3 py-1 text-xs font-semibold ${tab === t.key ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300"}`}>{t.label} ({t.n})</button>)}
        <span className="ml-auto flex items-center gap-1 text-[11px] text-slate-400"><Link2 className="h-3 w-3" />{k.links_open_count} open link{k.links_open_count === 1 ? "" : "s"} worth {gbp(k.links_open_amount)}</span>
      </div>
      {!isOps && <div className="panel overflow-x-auto p-0">
        <table className="w-full min-w-[40rem] text-sm">
          <thead className="border-b border-slate-100 bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:bg-slate-800/60">
            <tr>
              <th className="px-3 py-2 text-left">Client</th>
              {tab === "overdue" && <><th className="px-3 py-2 text-left">Due</th><th className="px-3 py-2 text-left">Late by</th><th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2 text-left">Adviser</th></>}
              {tab === "upcoming" && <><th className="px-3 py-2 text-left">Due</th><th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2 text-left">Adviser</th><th /></>}
              {tab === "receipts" && <><th className="px-3 py-2 text-left">Received</th><th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2 text-left">Reference</th><th /></>}
              {tab === "links" && <><th className="px-3 py-2 text-left">Sent</th><th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2 text-left">Status</th><th className="px-3 py-2 text-left">Reason</th></>}
            </tr>
          </thead>
          <tbody>
            {tab === "overdue" && (s.overdue.length === 0 ? <Empty text="Nothing is overdue." /> : s.overdue.map((r, i) => (
              <Row key={r.case_id + i} r={r}><td className="px-3 py-2">{dt(r.due_date)}</td><td className="px-3 py-2 font-semibold text-rose-600">{r.days} day{r.days === 1 ? "" : "s"}</td><td className="px-3 py-2 text-right tabular-nums">{gbp(r.amount)}</td><td className="px-3 py-2 text-slate-500">{r.adviser ?? "Unassigned"}</td></Row>
            )))}
            {tab === "upcoming" && (s.upcoming.length === 0 ? <Empty text="No payments due in the next 30 days." /> : s.upcoming.map((r, i) => (
              <Row key={r.case_id + i} r={r}><td className="px-3 py-2">{dt(r.due_date)}</td><td className="px-3 py-2 text-right tabular-nums">{gbp(r.amount)}</td><td className="px-3 py-2 text-slate-500">{r.adviser ?? "Unassigned"}</td><td /></Row>
            )))}
            {tab === "receipts" && (s.receipts.length === 0 ? <Empty text="Nothing received in the last 90 days." /> : s.receipts.map((r, i) => (
              <Row key={r.case_id + i} r={r} tabTo="ledger"><td className="px-3 py-2">{dt(r.date)}</td><td className="px-3 py-2 text-right tabular-nums">{gbp(r.amount)}{r.shortfall && <span className="ml-1 text-[11px] font-semibold text-amber-600">short{r.shortfall_amount ? ` ${gbp(r.shortfall_amount)}` : ""}</span>}</td><td className="px-3 py-2 text-slate-500">{r.reference ?? "-"}</td><td /></Row>
            )))}
            {tab === "links" && (s.links.length === 0 ? <Empty text="No payment links sent." /> : s.links.map((r) => (
              <Row key={r.id} r={r} tabTo="payment_gateway"><td className="px-3 py-2">{dt(r.created_at)}</td><td className="px-3 py-2 text-right tabular-nums">{gbp(r.amount)}</td><td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${r.paid_at ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{r.paid_at ? "Paid " + dt(r.paid_at) : r.status}</span></td><td className="px-3 py-2 text-slate-500"><Receipt className="mr-1 inline h-3 w-3" />{r.reason ?? "-"}</td></Row>
            )))}
          </tbody>
        </table>
      </div>}
      {tab === "payouts" && ops && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <Kpi label="Awaiting approval" value={gbp(ops.payouts.awaiting_amount)} sub={`${ops.payouts.awaiting_count} run${ops.payouts.awaiting_count === 1 ? "" : "s"}`} tone={ops.payouts.awaiting_count > 0 ? "bad" : "good"} icon={<AlertTriangle className="h-3.5 w-3.5" />} />
            <Kpi label="Approved, not paid" value={gbp(ops.payouts.approved_amount)} sub={`${ops.payouts.approved_count} run${ops.payouts.approved_count === 1 ? "" : "s"}`} icon={<CalendarClock className="h-3.5 w-3.5" />} />
            <Kpi label="Paid out, 30 days" value={gbp(ops.payouts.settled_30d_amount)} tone="good" icon={<CheckCircle2 className="h-3.5 w-3.5" />} />
            <Kpi label="Failed" value={String(ops.payouts.failed_count)} tone={ops.payouts.failed_count > 0 ? "bad" : "good"} icon={<AlertTriangle className="h-3.5 w-3.5" />} />
          </div>
          <div className="panel overflow-x-auto p-0">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="border-b border-slate-100 bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-slate-400 dark:border-slate-700 dark:bg-slate-800/50"><tr><th className="px-3 py-2 text-left">Client</th><th className="px-3 py-2 text-left">Run date</th><th className="px-3 py-2 text-right">Total</th><th className="px-3 py-2 text-right">Creditors</th><th className="px-3 py-2 text-left">Status</th></tr></thead>
              <tbody>
                {ops.payouts.runs.length === 0 ? <Empty text="No creditor payouts have been prepared." /> : ops.payouts.runs.map((r) => (
                  <Row key={r.id} r={r} tabTo="disbursement"><td className="px-3 py-2">{dt(r.run_date)}</td><td className="px-3 py-2 text-right tabular-nums">{gbp(r.total_amount)}</td><td className="px-3 py-2 text-right tabular-nums">{r.total_items}</td><td className="px-3 py-2">{pill(r.status)}{r.status === "draft" && r.created_by_me && <span className="ml-1 text-[11px] text-slate-400">needs a different approver</span>}</td></Row>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {tab === "recon" && ops?.reconciliation && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {ops.reconciliation.by_status.map((b) => <div key={b.status} className="panel px-3 py-2 text-xs"><p className="font-bold uppercase tracking-wide text-slate-400">{b.status.replace(/_/g, " ")}</p><p className="font-semibold tabular-nums text-slate-800 dark:text-slate-100">{b.count} · {gbp(b.amount)}</p></div>)}
            {ops.reconciliation.by_status.length === 0 && <p className="text-sm text-slate-400">No bank transactions imported yet.</p>}
          </div>
          <div className="panel overflow-x-auto p-0">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="border-b border-slate-100 bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-slate-400 dark:border-slate-700 dark:bg-slate-800/50"><tr><th className="px-3 py-2 text-left">Date</th><th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2 text-left">Counterparty</th><th className="px-3 py-2 text-left">Reference</th><th className="px-3 py-2 text-left">Status</th></tr></thead>
              <tbody>
                {ops.reconciliation.unmatched.length === 0 ? <Empty text="Every bank transaction is matched." /> : ops.reconciliation.unmatched.map((t) => (
                  <tr key={t.id} className="border-b border-slate-50 dark:border-slate-800"><td className="px-3 py-2">{dt(t.date)}</td><td className="px-3 py-2 text-right tabular-nums">{t.direction === "debit" ? "-" : ""}{gbp(Math.abs(t.amount))}</td><td className="px-3 py-2">{t.counterparty ?? "-"}</td><td className="px-3 py-2 text-slate-500">{t.reference ?? "-"}</td><td className="px-3 py-2">{pill(t.status)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          {ops.reconciliation.feeds.length > 0 && <p className="text-[11px] text-slate-400">Bank feeds: {ops.reconciliation.feeds.map((f) => `${f.name}${f.active ? "" : " (off)"}${f.last_import_at ? ", last import " + dt(f.last_import_at) : ", never imported"}`).join(" · ")}</p>}
        </div>
      )}
      {tab === "money" && ops?.client_money && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <Kpi label="Bank balance" value={ops.client_money.last ? gbp(ops.client_money.last.bank_balance) : "-"} sub={ops.client_money.last ? "Reconciled " + dt(ops.client_money.last.date) : "Never reconciled"} icon={<Banknote className="h-3.5 w-3.5" />} />
            <Kpi label="Client ledger" value={ops.client_money.last ? gbp(ops.client_money.last.ledger_total) : "-"} icon={<Receipt className="h-3.5 w-3.5" />} />
            <Kpi label="Difference" value={ops.client_money.last ? gbp(ops.client_money.last.difference) : "-"} tone={ops.client_money.last && Math.abs(ops.client_money.last.difference) >= 0.01 ? "bad" : "good"} icon={<AlertTriangle className="h-3.5 w-3.5" />} />
            <Kpi label="Open holds" value={String(ops.client_money.open_holds)} icon={<AlertTriangle className="h-3.5 w-3.5" />} />
          </div>
          <div className="panel overflow-x-auto p-0">
            <table className="w-full min-w-[32rem] text-sm">
              <thead className="border-b border-slate-100 bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-slate-400 dark:border-slate-700 dark:bg-slate-800/50"><tr><th className="px-3 py-2 text-left">Date</th><th className="px-3 py-2 text-right">Bank</th><th className="px-3 py-2 text-right">Ledger</th><th className="px-3 py-2 text-right">Difference</th></tr></thead>
              <tbody>
                {ops.client_money.history.length === 0 ? <Empty text="No client money reconciliations yet." /> : ops.client_money.history.map((h, i) => (
                  <tr key={i} className="border-b border-slate-50 dark:border-slate-800"><td className="px-3 py-2">{dt(h.date)}</td><td className="px-3 py-2 text-right tabular-nums">{gbp(h.bank_balance)}</td><td className="px-3 py-2 text-right tabular-nums">{gbp(h.ledger_total)}</td><td className={`px-3 py-2 text-right tabular-nums font-semibold ${Math.abs(h.difference) >= 0.01 ? "text-rose-600" : "text-emerald-600"}`}>{gbp(h.difference)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {tab === "fees" && ops?.fees && (
        <div className="flex flex-wrap gap-2">
          {ops.fees.by_status.length === 0 ? <p className="text-sm text-slate-400">No fees charged in the last 90 days.</p> : ops.fees.by_status.map((b) => <div key={b.status} className="panel px-3 py-2 text-xs"><p className="font-bold uppercase tracking-wide text-slate-400">{b.status.replace(/_/g, " ")}</p><p className="font-semibold tabular-nums text-slate-800 dark:text-slate-100">{b.count} · {gbp(b.amount)}</p></div>)}
        </div>
      )}
      <p className="text-[11px] text-slate-400">Click a client row to open their page. Creditor payouts are prepared and approved on each client's payments tab.</p>
    </div>
  );
}
