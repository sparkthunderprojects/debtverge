import { lazy, type ComponentType, type LazyExoticComponent } from "react";

/**
 * The list of apps in this build. Each app is loaded only when it is shown, so
 * adding an app does not make the others heavier. An app is never imported
 * directly by another app; the shell is the only place that knows them all.
 */
export interface AppDef {
  id: string;
  name: string;
  Root: LazyExoticComponent<ComponentType>;
}

export const APPS: AppDef[] = [
  {
    id: "debtverge",
    name: "DebtVerge",
    Root: lazy(() => import("@/apps/debtverge/Root")),
  },
];

/** Pages that work without a staff sign-in. `match` returns the route's parameter, or null. */
export interface PublicRoute {
  id: string;
  match: (path: string) => { token?: string } | null;
  Page: LazyExoticComponent<ComponentType<{ token: string }>>;
}

const tokenMatch = (re: RegExp) => (path: string) => {
  const m = path.match(re);
  return m ? { token: m[1] } : null;
};

export const PUBLIC_ROUTES: PublicRoute[] = [
  {
    id: "debtverge-pay",
    match: tokenMatch(/^\/pay\/([A-Za-z0-9]+)\/?$/),
    Page: lazy(() => import("@/apps/debtverge/public").then((m) => ({ default: m.PayRoute }))),
  },
  {
    id: "debtverge-sign",
    match: tokenMatch(/^\/sign\/([A-Za-z0-9]+)\/?$/),
    Page: lazy(() => import("@/apps/debtverge/public").then((m) => ({ default: m.SignRoute }))),
  },
];

/** Sign-up is shown to anyone, signed in or not, but only once the session check has finished. */
export const SIGNUP_ROUTE = {
  path: "/debtverge/signup",
  Page: lazy(() => import("@/apps/debtverge/public").then((m) => ({ default: m.SignupRoute }))),
};

/** The app shown at the root. With one app this is simply DebtVerge; the switcher comes later. */
export const DEFAULT_APP = APPS[0];
