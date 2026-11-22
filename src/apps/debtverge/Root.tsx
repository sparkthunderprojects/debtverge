import { DebtVerge } from "./components/DebtVerge";
import { IncomeCalcProvider, useIncomeCalc } from "./lib/income-calc-context";
import { SalaryIncomeCalculator } from "./components/income-calc/SalaryIncomeCalculator";
import { useTheme } from "@/core/theme";

/**
 * The signed-in DebtVerge app. The shell mounts this only after sign-in and the
 * MFA check, and only loads it when it is needed.
 */
export default function DebtVergeRoot() {
  const { theme } = useTheme();
  return (
    <IncomeCalcProvider>
      <div className={`h-screen w-screen overflow-hidden ${theme === "dark" ? "bg-slate-900" : "bg-slate-50"}`}>
        <DebtVerge />
      </div>
      <GlobalIncomeCalcModal />
    </IncomeCalcProvider>
  );
}

function GlobalIncomeCalcModal() {
  const { triggeredFrom, isOpen } = useIncomeCalc();
  if (!triggeredFrom || !isOpen) return null;
  return <SalaryIncomeCalculator portal={triggeredFrom} />;
}
