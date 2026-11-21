import { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabase";
import type {
  SubscriptionPackage,
  TenantSubscription,
  CatalogItem,
  LicensePackage,
  OrganizationLicense,
  LicenseStatus,
} from "./types";
import { dashboardIdToModule } from "./rbac-hooks";

// ============================================================
// Package Catalog — read all licensing packages with their items
// ============================================================

export function useLicensePackages() {
  const [data, setData] = useState<LicensePackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data: pkgs, error: err } = await supabase
      .from("packages")
      .select("*")
      .order("monthly_price_pence");
    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }
    setData((pkgs ?? []) as LicensePackage[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, error, reload: load };
}

export function useLicensePackagesWithItems() {
  const [data, setData] = useState<(LicensePackage & { items: CatalogItem[] })[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data: pkgs, error: err } = await supabase
      .from("packages")
      .select("*")
      .order("monthly_price_pence");
    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }
    if (!pkgs || pkgs.length === 0) {
      setData([]);
      setLoading(false);
      return;
    }
    const pkgIds = pkgs.map((p) => p.id);
    const { data: joins } = await supabase
      .from("package_items")
      .select("package_id, catalog_item:catalog_items(*)")
      .in("package_id", pkgIds);
    const itemsByPkg: Record<string, CatalogItem[]> = {};
    for (const row of joins ?? []) {
      const item = row.catalog_item as unknown as CatalogItem | CatalogItem[] | null;
      const items = Array.isArray(item) ? item : item ? [item] : [];
      for (const ci of items) {
        if (!itemsByPkg[row.package_id]) itemsByPkg[row.package_id] = [];
        itemsByPkg[row.package_id].push(ci);
      }
    }
    const merged = pkgs.map((p) => ({
      ...p,
      items: (itemsByPkg[p.id] ?? []).sort((a, b) => a.display_order - b.display_order),
    }));
    setData(merged);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, error, reload: load };
}

// ============================================================
// Catalog Items — all active catalog items
// ============================================================

export function useCatalogItems() {
  const [data, setData] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data: items, error: err } = await supabase
      .from("catalog_items")
      .select("*")
      .eq("is_active", true)
      .order("display_order");
    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }
    setData((items ?? []) as CatalogItem[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, error, reload: load };
}

// ============================================================
// Organization Licenses — all licenses for all orgs (admin view)
// ============================================================

export function useAllOrganizationLicenses() {
  const [data, setData] = useState<OrganizationLicense[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data: licenses, error: err } = await supabase
      .from("organization_licenses")
      .select(`
        *,
        catalog_item:catalog_items(*),
        package:packages(*)
      `)
      .order("created_at", { ascending: false });
    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }
    setData((licenses ?? []) as unknown as OrganizationLicense[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, error, reload: load };
}

// ============================================================
// Organization Licenses for a specific org
// ============================================================

export function useOrganizationLicenses(orgId: string | null) {
  const [data, setData] = useState<OrganizationLicense[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orgId) {
      setData([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const { data: licenses, error: err } = await supabase
      .from("organization_licenses")
      .select(`
        *,
        catalog_item:catalog_items(*),
        package:packages(*)
      `)
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false });
    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }
    setData((licenses ?? []) as unknown as OrganizationLicense[]);
    setLoading(false);
  }, [orgId]);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, error, reload: load };
}

// ============================================================
// Mutations: grant / update / revoke licenses
// ============================================================

export async function grantLicense(
  orgId: string,
  catalogItemId: string,
  opts?: { source?: "package" | "direct" | "trial" | "complimentary"; packageId?: string; licenceType?: string },
): Promise<void> {
  const { error } = await supabase.from("organization_licenses").insert({
    organization_id: orgId,
    catalog_item_id: catalogItemId,
    status: "active",
    licence_source: opts?.source ?? "direct",
    package_id: opts?.packageId ?? null,
    licence_type: opts?.licenceType ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function grantPackageLicenses(orgId: string, packageId: string): Promise<void> {
  const { data: items, error: err } = await supabase
    .from("package_items")
    .select("catalog_item_id")
    .eq("package_id", packageId);
  if (err) throw new Error(err.message);
  const itemIds = (items ?? []).map((i) => i.catalog_item_id);
  if (itemIds.length === 0) return;

  for (const itemId of itemIds) {
    await supabase.from("organization_licenses").upsert(
      {
        organization_id: orgId,
        catalog_item_id: itemId,
        status: "active",
        licence_source: "package",
        package_id: packageId,
      },
      { onConflict: "organization_id, catalog_item_id" },
    );
  }
}

export async function updateLicenseStatus(licenseId: string, status: LicenseStatus): Promise<void> {
  const { error } = await supabase
    .from("organization_licenses")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", licenseId);
  if (error) throw new Error(error.message);
}

export async function revokeLicense(licenseId: string): Promise<void> {
  const { error } = await supabase
    .from("organization_licenses")
    .delete()
    .eq("id", licenseId);
  if (error) throw new Error(error.message);
}

// ============================================================
// Dual-Gate Entitlement Hook
// ============================================================

interface UseEntitlementsParams {
  subscriptionAppKeys: Set<string>;
  userPermissions: Set<string>;
  isSuperAdmin: boolean;
}

export function useEntitlements({
  subscriptionAppKeys,
  userPermissions,
  isSuperAdmin,
}: UseEntitlementsParams) {
  const canAccessApp = useCallback(
    (appKey: string): boolean => {
      if (isSuperAdmin) return true;
      const subUnlocked = subscriptionAppKeys.has(appKey);
      const module = dashboardIdToModule(appKey);
      if (!module) return true;
      const rolePermitted =
        userPermissions.has(`${module}:view`) ||
        userPermissions.has(`${module}:edit`) ||
        userPermissions.has(`${module}:manage`);
      return subUnlocked && rolePermitted;
    },
    [subscriptionAppKeys, userPermissions, isSuperAdmin],
  );

  const filterAccessibleApps = useCallback(
    <T extends { id: string }>(apps: T[]): T[] => {
      return apps.filter((app) => canAccessApp(app.id));
    },
    [canAccessApp],
  );

  return { canAccessApp, filterAccessibleApps };
}

// ============================================================
// Convenience: load entitlements for the current user's org(s)
// Reads from organization_licenses (new licensing model)
// ============================================================

export function useUserEntitlements(
  orgIds: string[],
  userPermissions: Set<string>,
  isSuperAdmin: boolean,
) {
  const [subscriptionAppKeys, setSubscriptionAppKeys] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (orgIds.length === 0) {
      setSubscriptionAppKeys(new Set());
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: licenses } = await supabase
        .from("organization_licenses")
        .select("catalog_item:catalog_items(key)")
        .in("organization_id", orgIds)
        .eq("status", "active");
      if (cancelled) return;
      const keys = new Set<string>();
      for (const row of licenses ?? []) {
        const item = row.catalog_item as unknown as { key: string } | { key: string }[] | null;
        const items = Array.isArray(item) ? item : item ? [item] : [];
        for (const ci of items) {
          if (ci?.key) keys.add(ci.key);
        }
      }
      setSubscriptionAppKeys(keys);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [orgIds.join(","), userPermissions.size]);

  const entitlements = useEntitlements({
    subscriptionAppKeys,
    userPermissions,
    isSuperAdmin,
  });

  return {
    ...entitlements,
    subscriptionAppKeys,
    loading,
  };
}

// ============================================================
// Deprecated: old subscription hooks (kept for backward compat)
// ============================================================

export function useSubscriptionPackages() {
  const [data, setData] = useState<SubscriptionPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data: pkgs, error: err } = await supabase
      .from("subscription_packages")
      .select("*")
      .eq("is_active", true)
      .order("tier_level");
    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }
    if (!pkgs || pkgs.length === 0) {
      setData([]);
      setLoading(false);
      return;
    }
    const pkgIds = pkgs.map((p) => p.id);
    const { data: appMaps } = await supabase
      .from("subscription_package_apps")
      .select("package_id, app_key")
      .in("package_id", pkgIds);
    const appMap: Record<string, string[]> = {};
    for (const row of appMaps ?? []) {
      if (!appMap[row.package_id]) appMap[row.package_id] = [];
      appMap[row.package_id].push(row.app_key);
    }
    const merged = pkgs.map((p) => ({
      ...p,
      app_keys: appMap[p.id] ?? [],
    }));
    setData(merged);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, error, reload: load };
}

export function useTenantSubscriptions() {
  const [data, setData] = useState<TenantSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data: subs, error: err } = await supabase
      .from("tenant_subscriptions")
      .select(`
        *,
        package:subscription_packages(id, name, slug, description, tier_level, monthly_price_pence, is_active),
        organization:organizations(id, name)
      `)
      .order("created_at", { ascending: false });
    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }
    setData((subs ?? []) as unknown as TenantSubscription[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, error, reload: load };
}

export async function updateTenantSubscription(
  orgId: string,
  packageId: string,
  status: "active" | "suspended" | "cancelled" | "expired" = "active",
): Promise<void> {
  const { data: existing } = await supabase
    .from("tenant_subscriptions")
    .select("id")
    .eq("organization_id", orgId)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("tenant_subscriptions")
      .update({
        package_id: packageId,
        status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase
      .from("tenant_subscriptions")
      .insert({
        organization_id: orgId,
        package_id: packageId,
        status,
      });
    if (error) throw new Error(error.message);
  }
}

export async function updateSubscriptionStatus(
  subId: string,
  status: "active" | "suspended" | "cancelled" | "expired",
): Promise<void> {
  const { error } = await supabase
    .from("tenant_subscriptions")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", subId);
  if (error) throw new Error(error.message);
}
