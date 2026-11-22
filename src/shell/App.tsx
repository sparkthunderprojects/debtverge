import { Suspense } from "react";
import { ErrorBoundary } from "@/core/ErrorBoundary";
import { Login } from "@/core/Login";
import { MfaGate } from "@/core/MfaGate";
import { Spinner } from "@/core/ui";
import { AuthProvider, useAuth } from "@/core/auth";
import { DEFAULT_APP, PUBLIC_ROUTES, SIGNUP_ROUTE } from "./apps";

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

  const Active = DEFAULT_APP.Root;
  return (
    <ErrorBoundary>
      <MfaGate>
        <Suspense fallback={<Loading />}>
          <Active />
        </Suspense>
      </MfaGate>
    </ErrorBoundary>
  );
}

export default App;
