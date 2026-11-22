import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";

/**
 * Which apps this person can open. The database decides (licence for the firm, plus the
 * person's role permissions); the screen only shows what comes back. Apps that are licensed
 * but not built into this version are left out by the shell via `setBuiltApps`.
 */
export interface MyApp {
  app_id: string;
  name: string;
  stage: string | null;
  can_edit: boolean;
  can_manage: boolean;
}

export interface MyApps {
  organization_id: string | null;
  apps: MyApp[];
}

let builtApps: string[] = [];

/** Called once by the shell with the ids of the apps that exist in this build. */
export function setBuiltApps(ids: string[]) {
  builtApps = ids;
}

export function isBuilt(appId: string): boolean {
  return builtApps.includes(appId);
}

export async function fetchMyApps(): Promise<MyApps> {
  const { data, error } = await supabase.rpc("core_my_apps");
  if (error) throw new Error(error.message);
  const d = (data ?? {}) as Partial<MyApps>;
  return { organization_id: d.organization_id ?? null, apps: d.apps ?? [] };
}

export function useMyApps() {
  const [data, setData] = useState<MyApps | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchMyApps());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your apps");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const available = (data?.apps ?? []).filter((a) => isBuilt(a.app_id));
  return { data, available, loading, error, reload };
}

export function appPath(appId: string): string {
  return `/app/${appId}`;
}

export function appIdFromPath(path: string): string | null {
  const m = path.match(/^\/app\/([a-z0-9_-]+)\/?$/i);
  return m ? m[1].toLowerCase() : null;
}
