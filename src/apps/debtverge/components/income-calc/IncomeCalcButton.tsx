import { Calculator } from "lucide-react";
import { useIncomeCalc, type IncomeCalcPortal } from "@/apps/debtverge/lib/income-calc-context";

interface Props {
  portal: IncomeCalcPortal;
  variant?: "button" | "icon";
  label?: string;
  className?: string;
}

export function IncomeCalcButton({ portal, variant = "button", label = "Income Calc", className = "" }: Props) {
  const { openCalc } = useIncomeCalc();

  if (variant === "icon") {
    return (
      <button
        onClick={() => openCalc(portal)}
        className={`btn btn-secondary px-2 py-1.5 text-xs ${className}`}
        title="Salary & Self-Employed Income Calculator"
      >
        <Calculator className="h-3.5 w-3.5" />
      </button>
    );
  }

  return (
    <button
      onClick={() => openCalc(portal)}
      className={`btn btn-secondary text-xs ${className}`}
      title="Salary & Self-Employed Income Calculator"
    >
      <Calculator className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
