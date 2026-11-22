import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import type {
  RbacPermission, RbacRole, OrganizationUser, RbacProfile,
  AssetAccessLink, RbacModule, RbacAction, Organization, Project,
} from "./types";

// ============================================================
// Permissions (system-defined, all modules)
// ============================================================

export function usePermissions() {
  const [data, setData] = useState<RbacPermission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const { data: rows, error: err } = await supabase.from("rbac_permissions").select("*").order("module").order("action");
    if (err) { setError(err.message); setLoading(false); return; }
    setData(rows ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  return { data, loading, error, reload: load };
}

// ============================================================
// Roles (with permissions)
// ============================================================

export function useRoles(organizationId?: string) {
  const [data, setData] = useState<RbacRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    let query = supabase
      .from("rbac_roles")
      .select("*, permissions:rbac_role_permissions(permission:rbac_permissions(*))")
      .order("name");
    if (organizationId) query = query.eq("organization_id", organizationId);
    const { data: rows, error: err } = await query;
    if (err) { setError(err.message); setLoading(false); return; }
    const mapped = (rows ?? []).map((r: Record<string, unknown>) => ({
      ...r,
      id: r.id as string,
      organization_id: r.organization_id as string,
      name: r.name as string,
      is_custom: r.is_custom as boolean,
      created_at: r.created_at as string,
      permissions: ((r.permissions as Array<{ permission: RbacPermission }>) ?? []).map((p) => p.permission).filter(Boolean),
    })) as RbacRole[];
    setData(mapped);
    setLoading(false);
  }, [organizationId]);

  useEffect(() => { load(); }, [load]);
  return { data, loading, error, reload: load };
}

export async function createRole(input: { organization_id: string; name: string; is_custom?: boolean; permission_ids?: string[] }) {
  const { data: role, error } = await supabase
    .from("rbac_roles")
    .insert({ organization_id: input.organization_id, name: input.name, is_custom: input.is_custom ?? true })
    .select("*")
    .single();
  if (error) throw error;

  if (input.permission_ids && input.permission_ids.length > 0) {
    const inserts = input.permission_ids.map((pid) => ({ role_id: role.id, permission_id: pid }));
    const { error: rpErr } = await supabase.from("rbac_role_permissions").insert(inserts);
    if (rpErr) throw rpErr;
  }

  return role as RbacRole;
}

export async function updateRolePermissions(roleId: string, permissionIds: string[]) {
  // Delete existing, then re-insert
  const { error: delErr } = await supabase.from("rbac_role_permissions").delete().eq("role_id", roleId);
  if (delErr) throw delErr;

  if (permissionIds.length > 0) {
    const inserts = permissionIds.map((pid) => ({ role_id: roleId, permission_id: pid }));
    const { error: insErr } = await supabase.from("rbac_role_permissions").insert(inserts);
    if (insErr) throw insErr;
  }
}

export async function deleteRole(id: string) {
  const { error } = await supabase.from("rbac_roles").delete().eq("id", id);
  if (error) throw error;
}

// ============================================================
// Organization Users (membership + role assignment)
// ============================================================

export function useOrganizationUsers(organizationId?: string) {
  const [data, setData] = useState<OrganizationUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    let query = supabase
      .from("organization_users")
      .select("*, profile:profiles(id, email, full_name, status, is_super_admin, role), role:rbac_roles(id, name, is_custom), organization:organizations(id, name, slug)")
      .order("created_at", { ascending: false });
    if (organizationId) query = query.eq("organization_id", organizationId);
    const { data: rows, error: err } = await query;
    if (err) { setError(err.message); setLoading(false); return; }
    setData(rows ?? []);
    setLoading(false);
  }, [organizationId]);

  useEffect(() => { load(); }, [load]);
  return { data, loading, error, reload: load };
}

export async function addOrganizationUser(input: { user_id: string; organization_id: string; role_id: string }) {
  const { data, error } = await supabase
    .from("organization_users")
    .insert(input)
    .select("*, profile:profiles(id, email, full_name, status, is_super_admin, role), role:rbac_roles(id, name, is_custom), organization:organizations(id, name, slug)")
    .single();
  if (error) throw error;
  return data as OrganizationUser;
}

export async function updateOrganizationUserRole(id: string, roleId: string) {
  const { error } = await supabase.from("organization_users").update({ role_id: roleId }).eq("id", id);
  if (error) throw error;
}

export async function removeOrganizationUser(id: string) {
  const { error } = await supabase.from("organization_users").delete().eq("id", id);
  if (error) throw error;
}

// ============================================================
// Profiles (users table — for admin management)
// ============================================================

export function useProfiles() {
  const [data, setData] = useState<RbacProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const { data: rows, error: err } = await supabase
      .from("profiles")
      .select("id, email, full_name, role, is_super_admin, status, created_at")
      .order("created_at", { ascending: false });
    if (err) { setError(err.message); setLoading(false); return; }
    setData(rows ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  return { data, loading, error, reload: load };
}

export async function updateProfileStatus(id: string, status: "INVITED" | "ACTIVE" | "SUSPENDED") {
  const { error } = await supabase.from("profiles").update({ status }).eq("id", id);
  if (error) throw error;
}

export async function updateProfileSuperAdmin(id: string, isSuperAdmin: boolean) {
  const { error } = await supabase.from("profiles").update({ is_super_admin: isSuperAdmin }).eq("id", id);
  if (error) throw error;
}

// ============================================================
// Asset Access Links (external contractor sandboxing)
// ============================================================

export function useAssetAccessLinks(userId?: string) {
  const [data, setData] = useState<AssetAccessLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    let query = supabase
      .from("asset_access_links")
      .select("*, profile:profiles(id, email, full_name), project:projects(id, title)")
      .order("created_at", { ascending: false });
    if (userId) query = query.eq("user_id", userId);
    const { data: rows, error: err } = await query;
    if (err) { setError(err.message); setLoading(false); return; }
    setData(rows ?? []);
    setLoading(false);
  }, [userId]);

  useEffect(() => { load(); }, [load]);
  return { data, loading, error, reload: load };
}

export async function createAssetAccessLink(input: {
  asset_id: string;
  user_id: string;
  project_id: string;
  can_view: boolean;
  can_download: boolean;
  enforce_watermark: boolean;
  expires_at: string | null;
}) {
  const { data, error } = await supabase
    .from("asset_access_links")
    .insert(input)
    .select("*, profile:profiles(id, email, full_name), project:projects(id, title)")
    .single();
  if (error) throw error;
  return data as AssetAccessLink;
}

export async function updateAssetAccessLink(id: string, patch: Partial<AssetAccessLink>) {
  const { error } = await supabase.from("asset_access_links").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteAssetAccessLink(id: string) {
  const { error } = await supabase.from("asset_access_links").delete().eq("id", id);
  if (error) throw error;
}

// ============================================================
// Permission checking helpers
// ============================================================

export async function getUserPermissions(userId: string): Promise<Set<string>> {
  // Returns a set of "MODULE:action" strings for the user's role(s)
  const { data: memberships, error } = await supabase
    .from("organization_users")
    .select("role_id")
    .eq("user_id", userId);
  if (error || !memberships) return new Set();

  const roleIds = memberships.map((m) => m.role_id);
  if (roleIds.length === 0) return new Set();

  const { data: rolePerms, error: rpErr } = await supabase
    .from("rbac_role_permissions")
    .select("permission:rbac_permissions(module, action)")
    .in("role_id", roleIds);
  if (rpErr || !rolePerms) return new Set();

  const perms = new Set<string>();
  for (const rp of rolePerms) {
    const perm = rp.permission as unknown as { module: string; action: string } | { module: string; action: string }[] | null;
    const permsArr = Array.isArray(perm) ? perm : perm ? [perm] : [];
    for (const p of permsArr) perms.add(`${p.module}:${p.action}`);
  }
  return perms;
}

export async function isExternalContractor(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("organization_users")
    .select("role:rbac_roles(name)")
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return false;
  const role = data.role as unknown as { name: string } | { name: string }[] | null;
  const roleNames = Array.isArray(role) ? role.map((r) => r.name) : role ? [role.name] : [];
  return roleNames.includes("External Contractor");
}

export async function getAccessibleAssetIds(userId: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("asset_access_links")
    .select("asset_id")
    .eq("user_id", userId)
    .eq("can_view", true);
  if (error || !data) return new Set();
  return new Set(data.map((d) => d.asset_id));
}

// ============================================================
// Module metadata (for UI rendering)
// ============================================================

export const MODULE_LABELS: Record<RbacModule, string> = {
  VAULT: "Vault",
  PROJECTS: "Projects",
  SIGN: "Stormreef Sign",
  AGENT: "Stormreef Agent",
  SOCIAL: "Stormreef Social",
  MAIL: "Stormreef Mail",
  PAY: "Stormreef Pay",
  PULSE: "Stormreef Pulse",
  REWARDS: "Stormreef Rewards",
  TALENT: "Stormreef Talent",
  DEBTVERGE: "Debt Verge",
  DRAFTVERGE: "Draft Verge",
  IVAVERGE: "IVA Verge",
  LEADVERGE: "Lead Verge",
  STORMCALL: "Storm Call",
  COMPLIANCE: "Compliance Portal",
  KNOWLEDGE: "Knowledge Platform",
  QUALIFY: "Qualify",
  STORMVERGE: "StormVerge Mail",
  STORMTALK: "StormTalk",
  STORMTASKS: "StormTasks",
  STORMDRIVE: "StormDrive",
  STORMWORD: "StormWord",
};

export const MODULE_ORDER: RbacModule[] = ["PROJECTS", "VAULT", "TALENT", "AGENT", "SOCIAL", "MAIL", "PAY", "PULSE", "REWARDS", "SIGN", "DEBTVERGE", "DRAFTVERGE", "IVAVERGE", "LEADVERGE", "STORMCALL", "COMPLIANCE", "KNOWLEDGE", "QUALIFY", "STORMVERGE", "STORMTALK", "STORMTASKS", "STORMDRIVE", "STORMWORD"];

export function moduleToDashboardId(module: RbacModule): string {
  const map: Record<RbacModule, string> = {
    AGENT: "agent",
    SOCIAL: "social",
    MAIL: "mail",
    REWARDS: "rewards",
    PULSE: "pulse",
    PROJECTS: "projects",
    TALENT: "talent",
    PAY: "pay",
    SIGN: "sign",
    VAULT: "vault",
    DEBTVERGE: "debtverge",
    DRAFTVERGE: "draftverge",
    IVAVERGE: "ivaverge",
    LEADVERGE: "leadverge",
    STORMCALL: "stormcall",
    COMPLIANCE: "compliance",
    KNOWLEDGE: "knowledge",
    QUALIFY: "qualify",
    STORMVERGE: "stormverge",
    STORMTALK: "stormtalk",
    STORMTASKS: "stormtasks",
    STORMDRIVE: "stormdrive",
    STORMWORD: "word",
  };
  return map[module];
}

// Reverse mapping: DashboardId → RbacModule (for entitlement checks)
export function dashboardIdToModule(dashboardId: string): RbacModule | null {
  const map: Record<string, RbacModule> = {
    agent: "AGENT",
    social: "SOCIAL",
    mail: "MAIL",
    rewards: "REWARDS",
    pulse: "PULSE",
    projects: "PROJECTS",
    talent: "TALENT",
    portal: "TALENT",
    pay: "PAY",
    sign: "SIGN",
    debtverge: "DEBTVERGE",
    draftverge: "DRAFTVERGE",
    ivaverge: "IVAVERGE",
    leadverge: "LEADVERGE",
    stormcall: "STORMCALL",
    compliance: "COMPLIANCE",
    knowledge: "KNOWLEDGE",
    "knowledge-admin": "KNOWLEDGE",
    qualify: "QUALIFY",
    stormverge: "STORMVERGE",
    stormtalk: "STORMTALK",
    stormtasks: "STORMTASKS",
    stormdrive: "STORMDRIVE",
    word: "STORMWORD",
  };
  return map[dashboardId] ?? null;
}
