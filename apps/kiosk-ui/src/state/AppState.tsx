import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Api } from "../api/client.js";
import type { Unit } from "../api/client.js";
import {
  listTerminalEmployees,
  pinLogin,
  forgetTerminalEmployee,
  type TerminalEmployee,
} from "../lib/supabase/terminalAuth.js";

interface AppStateValue {
  units: Unit[];
  unit: Unit | null;
  setUnitId: (id: string) => void;
  employee: TerminalEmployee | null;
  terminalEmployees: TerminalEmployee[];
  switchEmployee: (employeeId: string, pin: string) => Promise<void>;
  forgetEmployee: (employeeId: string) => void;
  logout: () => void;
}

const AppStateContext = createContext<AppStateValue | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [units, setUnits] = useState<Unit[]>([]);
  const [unitId, setUnitId] = useState<string | null>(null);
  const [employee, setEmployee] = useState<TerminalEmployee | null>(null);
  const [terminalEmployees, setTerminalEmployees] = useState<TerminalEmployee[]>(listTerminalEmployees());

  useEffect(() => {
    Api.units().then((list) => {
      setUnits(list);
    });
  }, []);

  // Login temporariamente oculto a pedido do dono (mesmo padrão já usado no
  // backoffice antes de haver contas reais) — entra direto com o primeiro
  // colaborador cadastrado, sem exigir PIN. `switchEmployee` continua
  // existindo abaixo para quando o login voltar.
  useEffect(() => {
    Api.employees().then((list) => {
      if (list.length > 0) setEmployee((current) => current ?? { id: list[0]!.id, full_name: list[0]!.full_name, role: list[0]!.role });
    });
  }, []);

  const value = useMemo<AppStateValue>(
    () => ({
      units,
      unit: units.find((u) => u.id === unitId) ?? null,
      setUnitId,
      employee,
      terminalEmployees,
      switchEmployee: async (employeeId, pin) => {
        const emp = await pinLogin(employeeId, pin);
        setTerminalEmployees(listTerminalEmployees());
        setEmployee(emp);
      },
      forgetEmployee: (employeeId) => {
        forgetTerminalEmployee(employeeId);
        setTerminalEmployees(listTerminalEmployees());
      },
      logout: () => setEmployee(null),
    }),
    [units, unitId, employee, terminalEmployees],
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppStateValue {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error("useAppState precisa estar dentro de <AppStateProvider>");
  return ctx;
}
