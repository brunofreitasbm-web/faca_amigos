import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Api } from "../api/client.js";
import type { Unit } from "../api/client.js";
import {
  listTerminalEmployees,
  fullLogin,
  quickSwitch,
  forgetTerminalEmployee,
  type TerminalEmployee,
} from "../lib/supabase/terminalAuth.js";

interface AppStateValue {
  units: Unit[];
  unit: Unit | null;
  setUnitId: (id: string) => void;
  employee: TerminalEmployee | null;
  employeeLoading: boolean;
  terminalEmployees: TerminalEmployee[];
  loginWithPassword: (email: string, password: string, pin: string) => Promise<void>;
  switchEmployee: (employeeId: string, pin: string) => Promise<void>;
  forgetEmployee: (employeeId: string) => void;
  logout: () => void;
}

const AppStateContext = createContext<AppStateValue | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [units, setUnits] = useState<Unit[]>([]);
  const [unitId, setUnitId] = useState<string | null>(null);
  const [employee, setEmployee] = useState<TerminalEmployee | null>(null);
  const [employeeLoading, setEmployeeLoading] = useState(true);
  const [terminalEmployees, setTerminalEmployees] = useState<TerminalEmployee[]>(listTerminalEmployees());

  useEffect(() => {
    Api.units().then((list) => {
      setUnits(list);
    });
  }, []);

  // Login temporariamente oculto a pedido do dono (mesmo padrão já usado no
  // backoffice antes de haver contas reais) — entra direto com o primeiro
  // colaborador cadastrado, sem exigir e-mail/senha/PIN. `loginWithPassword`/
  // `switchEmployee` continuam existindo abaixo para quando o login voltar.
  // `employeeLoading` evita que a LoginScreen pisque na tela enquanto essa
  // busca ainda está em andamento (App.tsx só decide mostrá-la depois dela).
  useEffect(() => {
    Api.employees()
      .then((list) => {
        if (list.length > 0) setEmployee((current) => current ?? { id: list[0]!.id, full_name: list[0]!.full_name, role: list[0]!.role });
      })
      .finally(() => setEmployeeLoading(false));
  }, []);

  const value = useMemo<AppStateValue>(
    () => ({
      units,
      unit: units.find((u) => u.id === unitId) ?? null,
      setUnitId,
      employee,
      employeeLoading,
      terminalEmployees,
      loginWithPassword: async (email, password, pin) => {
        const emp = await fullLogin(email, password, pin);
        setTerminalEmployees(listTerminalEmployees());
        setEmployee(emp);
      },
      switchEmployee: async (employeeId, pin) => {
        const emp = await quickSwitch(employeeId, pin);
        setEmployee(emp);
      },
      forgetEmployee: (employeeId) => {
        forgetTerminalEmployee(employeeId);
        setTerminalEmployees(listTerminalEmployees());
      },
      logout: () => setEmployee(null),
    }),
    [units, unitId, employee, employeeLoading, terminalEmployees],
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppStateValue {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error("useAppState precisa estar dentro de <AppStateProvider>");
  return ctx;
}
