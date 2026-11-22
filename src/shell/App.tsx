import { Suspense } from "react";
import { ErrorBoundary } from "@/core/ErrorBoundary";
import { Login } from "@/core/Login";
import { MfaGate } from "@/core/MfaGate";
import { Spinner } from "@/core/ui";
import { AuthProvider, useAuth } from "@/core/auth";
import { appIdFromPath, appPath, setBuiltApps, useMyApps } from "@/core/apps-hooks";
import { APPS, DEFAULT_APP, PUBLIC_ROUTES, SIGNUP_ROUTE, getApp } from "./apps";

setBuiltApps(APPS.map((a) => a.id));

function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-900">
      <Spinner className="h-7 w-7 text-emerald-600" />
    </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

function AppContent() {
  const { user, loading } = useAuth();
  const path = window.location.pathname;

  // Public routes: client payment link and e-sign page (no login)
  for (const route of PUBLIC_ROUTES) {
    const hit = route.match(path);
    if (hit?.token) {
      return (
        <ErrorBoundary>
          <Suspense fallback={<Loading />}>
            <route.Page token={hit.token} />
          </Suspense>
        </ErrorBoundary>
      );
    }
  }

  if (loading) return <Loading />;

  // Self-service tenant sign-up wizard (available signed in or out)
  if (path === SIGNUP_ROUTE.path) {
    return (
      <ErrorBoundary>
        <Suspense fallback={<Loading />}>
          <SIGNUP_ROUTE.Page />
        </Suspense>
      </ErrorBoundary>
    );
  }

  if (!user) return <Login />;

  return (
    <ErrorBoundary>
      <MfaGate>
        <AppRouter path={path} />
      </MfaGate>
    </ErrorBoundary>
  );
}

function Notice({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  const { signOut } = useAuth();
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6 dark:bg-slate-900">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-100">{title}</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{children}</p>
        <div className="mt-4 flex gap-2">
          {action}
          <button onClick={() => void signOut()} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700">
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

/** Works out which app to show from the address and what the firm has licensed to this person. */
function AppRouter({ path }: { path: string }) {
  const { data, available, loading, error, reload } = useMyApps();

  if (loading) return <Loading />;

  if (error) {
    return (
      <Notice title="Could not load your apps" action={
        <button onClick={() => void reload()} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700">Try again</button>
      }>
        {error}
      </Notice>
    );
  }

  // Someone who belongs to no firm yet keeps the default app so they can finish setting up.
  if (!data?.organization_id) return <Show app={DEFAULT_APP} />;

  if (available.length === 0) {
    return (
      <Notice title="No apps available">
        Your firm has not given you access to any apps yet. Ask your administrator.
      </Notice>
    );
  }

  const wanted = appIdFromPath(path);
  if (wanted) {
    const allowed = available.find((a) => a.app_id === wanted);
    const app = allowed ? getApp(allowed.app_id) : undefined;
    if (!app) {
      return (
        <Notice title="Not part of your licence" action={
          <a href={appPath(available[0].app_id)} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700">
            Open {available[0].name}
          </a>
        }>
          That app is not available to you. Your firm may not have it, or your role may not include it.
        </Notice>
      );
    }
    return <Show app={app} />;
  }

  const first = getApp(available[0].app_id) ?? DEFAULT_APP;
  return <Show app={first} />;
}

function Show({ app }: { app: typeof DEFAULT_APP }) {
  const Active = app.Root;
  return (
    <Suspense fallback={<Loading />}>
      <Active />
    </Suspense>
  );
}

export default App;
