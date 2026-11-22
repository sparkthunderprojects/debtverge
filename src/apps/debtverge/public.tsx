import { ClientPortalPage } from "./components/ClientPortalPage";
import { SignPage } from "./components/SignPage";
import { DebtVergeSignupWizard } from "./components/DebtVergeSignupWizard";

/** Pages DebtVerge serves without a staff sign-in. The shell decides when to show each. */
export function PayRoute({ token }: { token: string }) {
  return <ClientPortalPage token={token} />;
}

export function SignRoute({ token }: { token: string }) {
  return <SignPage token={token} />;
}

export function SignupRoute() {
  return <DebtVergeSignupWizard onComplete={() => { window.location.href = "/"; }} />;
}
