import { useState } from "react";
import { Loader2, UserPlus, X } from "lucide-react";
import { useAuth } from "@/core/auth";
import { useHomeData } from "@/apps/debtverge/lib/home-hooks";
import { useTeam, assignCase, setMemberRole, setMemberManager, createInvite, cancelInvite, memberLabel, type Member } from "@/apps/debtverge/lib/team-hooks";
import type { DebtCase } from "@/core/types";

/** Case header control: shows who owns the case; managers can reassign it. */
export function AssigneeControl({ caseData, onChanged }: { caseData: DebtCase; onChanged: () => void }) {
  const { dvRole } = useAuth();
  const { members } = useTeam();
  const [busy, setBusy] = useState(false);
  const isManager = dvRole !== "advisor";
  const current = members.find((m) => m.user_id === caseData.assigned_to);
  if (!isManager) return null;

  const change = async (v: string) => {
    setBusy(true);
    try { await assignCase(caseData.id, v || null); onChanged(); } catch (e) { alert(e instanceof Error ? e.message : "Could not reassign"); }
    finally { setBusy(false); }
  };
  return (
    <label className="flex items-center gap-1 text-[10px] text-slate-400" title="Assigned advisor">
      Owner
      <select disabled={busy} value={caseData.assigned_to ?? ""} onChange={(e) => change(e.target.value)} className="max-w-[9rem] rounded-md border border-slate-200 bg-transparent px-1 py-0.5 text-[11px] font-semibold text-slate-700 dark:border-slate-600 dark:text-slate-200">
        <option value="">Unassigned</option>
        {members.map((m) => <option key={m.user_id} value={m.user_id}>{memberLabel(m)}</option>)}
      </select>
      {!current && caseData.assigned_to && <span className="text-amber-500">?</span>}
    </label>
  );
}

export function TeamScreen({ onOpenCase }: { onOpenCase: (id: string) => void }) {
  const { dvRole, user } = useAuth();
  const { members, invites, roles, loading, error, reload } = useTeam();
  const { data, reload: reloadCases } = useHomeData();
  const canAdmin = dvRole === "admin" || dvRole === "operations_manager";
  const [email, setEmail] = useState("");
  const [roleId, setRoleId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const run = async (key: string, fn: () => Promise<unknown>, okText?: string) => {
    setBusy(key); setMsg(null);
    try { await fn(); if (okText) setMsg({ ok: true, text: okText }); await reload(); reloadCases(); }
    catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "Something went wrong" }); }
    finally { setBusy(null); }
  };

  const open = data.cases.filter((c) => c.status !== "completed" && c.status !== "closed");
  const managers = members.filter((m) => m.role_name && m.role_name !== "Advisor");

  if (loading) return <div className="flex justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-emerald-600" /></div>;
  if (error) return <div className="panel m-1 p-6 text-sm text-slate-500">The team screen is for managers and admins.</div>;

  return (
    <div className="space-y-4 p-1">
      <div>
        <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Team</h2>
        <p className="text-xs text-slate-400">People, roles, reporting lines and who owns which case</p>
      </div>
      {msg && <div className={`rounded-lg px-3 py-2 text-xs ${msg.ok ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>{msg.text}</div>}

      <div className="panel overflow-hidden">
        <div className="px-4 py-3"><h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">People</h3></div>
        <table className="w-full text-sm">
          <thead><tr className="border-y border-slate-100 text-left text-[11px] uppercase tracking-wide text-slate-400 dark:border-slate-700">
            <th className="px-4 py-2">Name</th><th className="px-2 py-2">Role</th><th className="px-2 py-2">Reports to</th><th className="px-2 py-2 text-right">Open cases</th>
          </tr></thead>
          <tbody>
            {members.map((m: Member) => (
              <tr key={m.user_id} className="border-b border-slate-50 dark:border-slate-700/50">
                <td className="px-4 py-2.5"><p className="font-semibold text-slate-800 dark:text-slate-100">{memberLabel(m)}</p>{m.full_name && <p className="text-[11px] text-slate-400">{m.email}</p>}</td>
                <td className="px-2 py-2.5">
                  {canAdmin && m.user_id !== user?.id ? (
                    <select disabled={busy === m.user_id} value={m.role_id ?? ""} onChange={(e) => run(m.user_id, () => setMemberRole(m.user_id, e.target.value))} className="input py-1 text-xs">
                      {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  ) : <span className="text-xs text-slate-600 dark:text-slate-300">{m.role_name}</span>}
                </td>
                <td className="px-2 py-2.5">
                  <select disabled={busy === "mgr" + m.user_id} value={m.manager_id ?? ""} onChange={(e) => run("mgr" + m.user_id, () => setMemberManager(m.user_id, e.target.value || null))} className="input py-1 text-xs">
                    <option value="">No one</option>
                    {managers.filter((x) => x.user_id !== m.user_id).map((x) => <option key={x.user_id} value={x.user_id}>{memberLabel(x)}</option>)}
                  </select>
                </td>
                <td className="px-2 py-2.5 text-right font-semibold">{m.open_cases}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canAdmin && (
        <div className="panel p-4">
          <h3 className="mb-1 text-sm font-bold text-slate-800 dark:text-slate-100">Invite someone</h3>
          <p className="mb-3 text-xs text-slate-400">They create an account on the sign-in page with this email and are added to your firm automatically with the role you pick.</p>
          <div className="flex flex-wrap gap-2">
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@yourfirm.co.uk" className="input min-w-0 flex-1 text-sm" />
            <select value={roleId} onChange={(e) => setRoleId(e.target.value)} className="input w-48 text-sm">
              <option value="">Choose role</option>
              {roles.filter((r) => r.name !== "Admin").map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            <button disabled={!email || !roleId || busy === "invite"} onClick={() => run("invite", async () => { const r = await createInvite(email, roleId); setEmail(""); setMsg({ ok: true, text: r === "added" ? "Added to your firm." : "Invite saved. They'll be added when they sign up with this email." }); })} className="btn btn-primary bg-emerald-600 text-sm hover:bg-emerald-700">
              <UserPlus className="h-4 w-4" /> Invite
            </button>
          </div>
          {invites.length > 0 && (
            <div className="mt-3 space-y-1">
              {invites.map((i) => (
                <div key={i.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-1.5 text-xs dark:bg-slate-800">
                  <span>{i.email} · {roles.find((r) => r.id === i.role_id)?.name} · waiting for sign-up</span>
                  <button onClick={() => run(i.id, () => cancelInvite(i.id))} className="btn btn-ghost p-1" title="Cancel invite"><X className="h-3.5 w-3.5" /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="panel overflow-hidden">
        <div className="px-4 py-3"><h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Case ownership</h3></div>
        <div className="max-h-96 overflow-y-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-y border-slate-100 text-left text-[11px] uppercase tracking-wide text-slate-400 dark:border-slate-700"><th className="px-4 py-2">Case</th><th className="px-2 py-2">Owner</th></tr></thead>
            <tbody>
              {open.map((c) => (
                <tr key={c.id} className="border-b border-slate-50 dark:border-slate-700/50">
                  <td className="px-4 py-2"><button onClick={() => onOpenCase(c.id)} className="text-left"><span className="font-semibold text-slate-800 hover:underline dark:text-slate-100">{c.debtor_name}</span> <span className="text-[11px] text-slate-400">{c.case_number}</span></button></td>
                  <td className="px-2 py-2">
                    <select disabled={busy === c.id} value={c.assigned_to ?? ""} onChange={(e) => run(c.id, () => assignCase(c.id, e.target.value || null))} className="input py-1 text-xs">
                      <option value="">Unassigned</option>
                      {members.map((m) => <option key={m.user_id} value={m.user_id}>{memberLabel(m)}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
