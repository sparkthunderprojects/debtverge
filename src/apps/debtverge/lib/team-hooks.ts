import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/core/supabase";

export interface Member {
  user_id: string;
  email: string | null;
  full_name: string | null;
  role_id: string | null;
  role_name: string | null;
  manager_id: string | null;
  open_cases: number;
}
export interface Invite { id: string; email: string; role_id: string; status: string; created_at: string }
export interface RoleOption { id: string; name: string }

export const memberLabel = (m: Pick<Member, "full_name" | "email">) => m.full_name || m.email || "Unnamed";

export function useTeam() {
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [m, i, r] = await Promise.all([
      supabase.rpc("list_org_members"),
      supabase.from("organization_invites").select("*").eq("status", "pending").order("created_at", { ascending: false }),
      supabase.from("rbac_roles").select("id,name").in("name", ["Advisor", "Team Manager", "Operations Manager", "Admin"]).order("name"),
    ]);
    setError(m.error?.message ?? null);
    setMembers(((m.data ?? []) as Member[]).map((x) => ({ ...x, open_cases: Number(x.open_cases) })));
    setInvites((i.data ?? []) as Invite[]);
    setRoles((r.data ?? []) as RoleOption[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  return { members, invites, roles, loading, error, reload: load };
}

async function call(fn: string, args: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
}
export const assignCase = (caseId: string, userId: string | null) => call("assign_case", { p_case: caseId, p_user: userId });
export const setMemberRole = (userId: string, roleId: string) => call("set_member_role", { p_user: userId, p_role: roleId });
export const setMemberManager = (userId: string, managerId: string | null) => call("set_member_manager", { p_user: userId, p_manager: managerId });
export const createInvite = (email: string, roleId: string) => call("create_invite", { p_email: email, p_role: roleId }) as Promise<"added" | "invited">;
export const cancelInvite = (id: string) => call("cancel_invite", { p_id: id });
