import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Login } from "@/components/Login";
import { DebtVerge } from "@/components/DebtVerge";
import { ClientPortalPage } from "@/components/ClientPortalPage";
import { SignPage } from "@/components/SignPage";
import { MfaGate } from "@/components/MfaGate";
import { DebtVergeSignupWizard } from "@/components/DebtVergeSignupWizard";
import { Spinner } from "@/components/ui";
import { AuthProvider, useAuth } from "@/lib/auth";
import { StormCallProvider } from "@/lib/stormcall-context";
import { IncomeCalcProvider, useIncomeCalc } from "@/lib/income-calc-context";
import { SalaryIncomeCalculator } from "@/components/income-calc/SalaryIncomeCalculator";
import { useTheme } from "@/lib/theme";

const SIGNUP_PATH = "/debtverge/signup";

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

function AppContent() {
  const { user, loading } = useAuth();
  const { theme } = useTheme();

  // Public route: client payment link / portal page (no login)
  const payMatch = window.location.pathname.match(/^\/pay\/([A-Za-z0-9]+)\/?$/);
  if (payMatch) {
    return <ErrorBoundary><ClientPortalPage token={payMatch[1]} /></ErrorBoundary>;
  }

  const signMatch = window.location.pathname.match(/^\/sign\/([A-Za-z0-9]+)\/?$/);
  if (signMatch) {
    return <ErrorBoundary><SignPage token={signMatch[1]} /></ErrorBoundary>;
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-900">
        <Spinner className="h-7 w-7 text-emerald-600" />
      </div>
    );
  }

  // Public route: self-service tenant sign-up wizard (available signed in or out)
  if (window.location.pathname === SIGNUP_PATH) {
    return (
      <ErrorBoundary>
        <DebtVergeSignupWizard onComplete={() => { window.location.href = "/"; }} />
      </ErrorBoundary>
    );
  }

  if (!user) return <Login />;

  return (
    <ErrorBoundary>
      <StormCallProvider>
        <IncomeCalcProvider>
          <MfaGate>
            <div className={`h-screen w-screen overflow-hidden ${theme === "dark" ? "bg-slate-900" : "bg-slate-50"}`}>
              <DebtVerge />
            </div>
            <GlobalIncomeCalcModal />
          </MfaGate>
        </IncomeCalcProvider>
      </StormCallProvider>
    </ErrorBoundary>
  );
}

function GlobalIncomeCalcModal() {
  const { triggeredFrom, isOpen } = useIncomeCalc();
  if (!triggeredFrom || !isOpen) return null;
  return <SalaryIncomeCalculator portal={triggeredFrom} />;
}

export default App;
