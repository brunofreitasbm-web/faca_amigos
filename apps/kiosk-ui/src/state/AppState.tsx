import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Api } from "../api/client.js";
import type { Employee, Unit } from "../api/client.js";

interface AppStateValue {
  units: Unit[];
  unit: Unit | null;
  setUnitId: (id: string) => void;
  employee: Employee | null;
  login: (employeeId: string, pin: string) => Promise<void>;
  logout: () => void;
}

const AppStateContext = createContext<AppStateValue | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [units, setUnits] = useState<Unit[]>([]);
  const [unitId, setUnitId] = useState<string | null>(null);
  const [employee, setEmployee] = useState<Employee | null>(null);

  useEffect(() => {
    Api.units().then((list) => {
      setUnits(list);
      if (list.length > 0) setUnitId((current) => current ?? list[0]!.id);
    });
  }, []);

  // Tela de login omitida por enquanto (pedido explícito) — entra
  // direto com o primeiro colaborador cadastrado, sem PIN. `login`/
  // `logout` continuam existindo abaixo para quando a tela voltar.
  useEffect(() => {
    Api.employees().then((list) => {
      if (list.length > 0) setEmployee((current) => current ?? list[0]!);
    });
  }, []);

  const value = useMemo<AppStateValue>(
    () => ({
      units,
      unit: units.find((u) => u.id === unitId) ?? null,
      setUnitId,
      employee,
      login: async (employeeId, pin) => {
        const { employee: emp } = await Api.loginPin(employeeId, pin);
        setEmployee(emp);
      },
      logout: () => setEmployee(null),
    }),
    [units, unitId, employee],
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppStateValue {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error("useAppState precisa estar dentro de <AppStateProvider>");
  return ctx;
}
