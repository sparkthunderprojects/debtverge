import {
  createContext, useContext, useState, useCallback, type ReactNode,
} from "react";
import type { StudentLoanPlan } from "./uk-tax";

export type IncomeCalcPortal = "DebtVerge" | "IVAVerge" | "DraftVerge" | "Qualify" | "LeadVerge";

export type InputMode = "gross" | "net";
export type PayFrequency = "monthly" | "annual";
export type SalaryInputMode = "annual" | "hourly";

export interface IncomeCalcState {
  amount: string;
  mode: InputMode;
  frequency: PayFrequency;
  isSelfEmployed: boolean;
  salaryInputMode: SalaryInputMode;
  pensionPct: string;
  studentLoanPlan: StudentLoanPlan;
  // Hourly / overtime fields
  hourlyRate: string;
  standardHoursPerWeek: string;
  timeAndThirdHours: string;
  timeAndHalfHours: string;
  doubleTimeHours: string;
  // Self-employed net profit mode
  selfEmployedNetProfitMode: boolean;
  lastUpdatedBy: IncomeCalcPortal | null;
  lastUpdatedAt: string | null;
}

interface IncomeCalcContextValue {
  state: IncomeCalcState;
  isOpen: boolean;
  openCalc: (portal: IncomeCalcPortal) => void;
  closeCalc: () => void;
  updateState: (patch: Partial<IncomeCalcState>, portal: IncomeCalcPortal) => void;
  triggeredFrom: IncomeCalcPortal | null;
}

const DEFAULT_STATE: IncomeCalcState = {
  amount: "",
  mode: "gross",
  frequency: "annual",
  isSelfEmployed: false,
  salaryInputMode: "annual",
  pensionPct: "0",
  studentLoanPlan: "none",
  hourlyRate: "",
  standardHoursPerWeek: "",
  timeAndThirdHours: "",
  timeAndHalfHours: "",
  doubleTimeHours: "",
  selfEmployedNetProfitMode: false,
  lastUpdatedBy: null,
  lastUpdatedAt: null,
};

const IncomeCalcContext = createContext<IncomeCalcContextValue | undefined>(undefined);

export function IncomeCalcProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<IncomeCalcState>(DEFAULT_STATE);
  const [isOpen, setIsOpen] = useState(false);
  const [triggeredFrom, setTriggeredFrom] = useState<IncomeCalcPortal | null>(null);

  const openCalc = useCallback((portal: IncomeCalcPortal) => {
    setTriggeredFrom(portal);
    setIsOpen(true);
  }, []);

  const closeCalc = useCallback(() => {
    setIsOpen(false);
  }, []);

  const updateState = useCallback((patch: Partial<IncomeCalcState>, portal: IncomeCalcPortal) => {
    setState((prev) => ({
      ...prev,
      ...patch,
      lastUpdatedBy: portal,
      lastUpdatedAt: new Date().toISOString(),
    }));
  }, []);

  return (
    <IncomeCalcContext.Provider value={{ state, isOpen, openCalc, closeCalc, updateState, triggeredFrom }}>
      {children}
    </IncomeCalcContext.Provider>
  );
}

export function useIncomeCalc(): IncomeCalcContextValue {
  const ctx = useContext(IncomeCalcContext);
  if (!ctx) throw new Error("useIncomeCalc must be used within IncomeCalcProvider");
  return ctx;
}
