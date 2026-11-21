import { createContext, useContext, type ReactNode } from "react";
import { useStormCallEcosystem, type StormCallEcosystemApi } from "@/lib/stormcall-ecosystem-hooks";
import type { StormCallLaunchContext } from "@/lib/types";

const StormCallContext = createContext<StormCallEcosystemApi | null>(null);

export function StormCallProvider({ children }: { children: ReactNode }) {
  const api = useStormCallEcosystem();
  return <StormCallContext.Provider value={api}>{children}</StormCallContext.Provider>;
}

export function useStormCall(): StormCallEcosystemApi | null {
  return useContext(StormCallContext);
}

export type { StormCallLaunchContext };
