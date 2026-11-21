import { createContext, useContext, useEffect, useMemo, useState, useCallback, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { useUserEntitlements } from "./entitlement-hooks";

export type DvRole = "advisor" | "team_manager" | "operations_manager" | "admin";

function deriveDvRole(roleNames: string[], isAdminOrHigher: boolean): DvRole {
  if (roleNames.includes("Operations Manager")) return "operations_manager";
  if (roleNames.includes("Team Manager")) return "team_manager";
  if (roleNames.includes("Admin") || isAdminOrHigher) return "admin";
  return "advisor";
}

export type UserRole = "super_admin" | "admin" | "staff" | "freelancer" | "external_contractor" | "unknown";

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  loading: boolean;
  role: UserRole;
  freelancerProfileId: string | null;
  onboardingCompleted: boolean;
  isFreelancer: boolean;
  isSuperAdmin: boolean;
  isAdmin: boolean;
  isAdminOrHigher: boolean;
  isExternalContractor: boolean;
  organizationId: string | null;
  dvRole: DvRole;
  permissions: Set<string>;
  hasModuleAccess: (module: string, action?: string) => boolean;
  canAccessApp: (appKey: string) => boolean;
  subscriptionAppKeys: Set<string>;
  entitlementsLoaded: boolean;
  impersonatingFreelancerId: string | null;
  startImpersonation: (freelancerId: string) => void;
  exitImpersonation: () => void;
  signOut: () => Promise<void>;
  refreshRole: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<UserRole>("unknown");
  const [freelancerProfileId, setFreelancerProfileId] = useState<string | null>(null);
  const [onboardingCompleted, setOnboardingCompleted] = useState(false);
  const [impersonatingFreelancerId, setImpersonatingFreelancerId] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<Set<string>>(new Set());
  const [isExternalContractor, setIsExternalContractor] = useState(false);
  const [orgIds, setOrgIds] = useState<string[]>([]);
  const [roleNames, setRoleNames] = useState<string[]>([]);

  async function loadUserRole(userId: string, email?: string | null) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role, is_super_admin, status")
      .eq("id", userId)
      .maybeSingle();

    let userRole = (profile?.role as UserRole) ?? "staff";
    setRole(userRole);

    // Load RBAC permissions + external contractor check
    const { data: memberships } = await supabase
      .from("organization_users")
      .select("role_id, organization_id, role:rbac_roles(name)")
      .eq("user_id", userId);

    const roleNames = (memberships ?? []).flatMap((m) => {
      const role = m.role as unknown as { name: string } | { name: string }[] | null;
      if (Array.isArray(role)) return role.map((r) => r.name);
      return role ? [role.name] : [];
    }).filter(Boolean) as string[];
    const isContractor = roleNames.includes("External Contractor");
    setIsExternalContractor(isContractor);
    setRoleNames(roleNames);

    // Track org IDs for subscription entitlement loading
    setOrgIds((memberships ?? []).map((m) => m.organization_id).filter(Boolean) as string[]);

    // Build permission set from all role assignments
    const roleIds = (memberships ?? []).map((m) => m.role_id);
    const perms = new Set<string>();
    if (roleIds.length > 0) {
      const { data: rolePerms } = await supabase
        .from("rbac_role_permissions")
        .select("permission:rbac_permissions(module, action)")
        .in("role_id", roleIds);
      for (const rp of rolePerms ?? []) {
        const perm = rp.permission as unknown as { module: string; action: string } | { module: string; action: string }[] | null;
        const permsArr = Array.isArray(perm) ? perm : perm ? [perm] : [];
        for (const p of permsArr) perms.add(`${p.module}:${p.action}`);
      }
    }
    setPermissions(perms);

    if (userRole === "freelancer") {
      const { data: fp } = await supabase
        .from("freelancer_profiles")
        .select("id, onboarding_completed")
        .eq("user_id", userId)
        .maybeSingle();
      setFreelancerProfileId(fp?.id ?? null);
      setOnboardingCompleted(fp?.onboarding_completed ?? false);
    } else {
      setFreelancerProfileId(null);
      setOnboardingCompleted(false);
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session?.user) {
        (async () => {
          await loadUserRole(data.session.user.id, data.session.user.email);
          setLoading(false);
        })();
      } else {
        setLoading(false);
      }
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      (async () => {
        setSession(newSession);
        setImpersonatingFreelancerId(null);
        if (newSession?.user) {
          await loadUserRole(newSession.user.id, newSession.user.email);
        } else {
          setRole("unknown");
          setFreelancerProfileId(null);
          setOnboardingCompleted(false);
        }
      })();
    });

    return () => {
      sub.subscription.unsubscribe();
    };
  }, []);

  const isSuperAdmin = role === "super_admin";
  const isAdmin = role === "admin";
  const isAdminOrHigher = role === "super_admin" || role === "admin";

  const hasModuleAccess = useCallback((module: string, action: string = "view"): boolean => {
    if (isSuperAdmin) return true;
    return permissions.has(`${module}:${action}`) || permissions.has(`${module}:manage`);
  }, [permissions, isSuperAdmin]);

  // Dual-gate entitlement check: subscription + role permission
  const { canAccessApp, subscriptionAppKeys, loading: entitlementsLoading } = useUserEntitlements(
    orgIds,
    permissions,
    isSuperAdmin,
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      role,
      freelancerProfileId,
      onboardingCompleted,
      isFreelancer: role === "freelancer",
      isSuperAdmin,
      isAdmin,
      isAdminOrHigher,
      isExternalContractor,
      organizationId: orgIds[0] ?? null,
      dvRole: deriveDvRole(roleNames, isAdminOrHigher),
      permissions,
      hasModuleAccess,
      canAccessApp,
      subscriptionAppKeys,
      entitlementsLoaded: !entitlementsLoading,
      impersonatingFreelancerId,
      startImpersonation: (freelancerId: string) => setImpersonatingFreelancerId(freelancerId),
      exitImpersonation: () => setImpersonatingFreelancerId(null),
      signOut: async () => {
        await supabase.auth.signOut();
        setSession(null);
        setRole("unknown");
        setFreelancerProfileId(null);
        setOnboardingCompleted(false);
        setImpersonatingFreelancerId(null);
        setPermissions(new Set());
        setIsExternalContractor(false);
      },
      refreshRole: async () => {
        if (session?.user) await loadUserRole(session.user.id);
      },
    }),
    [session, loading, role, freelancerProfileId, onboardingCompleted, impersonatingFreelancerId, isSuperAdmin, isAdmin, isAdminOrHigher, isExternalContractor, orgIds, roleNames, permissions, hasModuleAccess, canAccessApp, subscriptionAppKeys, entitlementsLoading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
