import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Api } from "../api/client.js";
import type { Unit } from "../api/client.js";
import { supabase } from "../lib/supabase/client.js";
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
  logout: () => Promise<void>;
  /** true até a sessão salva no navegador ter sido conferida. */
  restoring: boolean;
}

const AppStateContext = createContext<AppStateValue | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [units, setUnits] = useState<Unit[]>([]);
  const [unitId, setUnitId] = useState<string | null>(null);
  const [employee, setEmployee] = useState<TerminalEmployee | null>(null);
  const [terminalEmployees, setTerminalEmployees] = useState<TerminalEmployee[]>(listTerminalEmployees());
  const [restoring, setRestoring] = useState(true);

  // As unidades só podem ser lidas com sessão (as policies de leitura são
  // `to authenticated` desde a migration 20260807000003), então a busca
  // depende do colaborador estar logado.
  useEffect(() => {
    if (!employee) {
      setUnits([]);
      return;
    }
    Api.units().then(setUnits).catch(() => setUnits([]));
  }, [employee]);

  // Restaura a sessão do Supabase Auth que o navegador já tinha (o terminal
  // do balcão não deve pedir PIN a cada refresh da página) e reflete
  // logout/expiração vindos de qualquer lugar.
  //
  // O login automático "entra com o primeiro colaborador da lista, sem PIN"
  // que existia aqui foi REMOVIDO: sem sessão real não há `auth.uid()`, e
  // sem `auth.uid()` nenhuma policy de RLS e nenhuma checagem de capacidade
  // no servidor é exercida — o RBAC inteiro seria decorativo.
  useEffect(() => {
    let cancelled = false;

    async function resolveEmployeeFromSession() {
      const { data } = await supabase().auth.getSession();
      if (cancelled) return;
      if (!data.session) {
        setEmployee(null);
        setRestoring(false);
        return;
      }
      try {
        const me = await Api.currentEmployee();
        if (!cancelled) setEmployee(me);
      } catch {
        if (!cancelled) setEmployee(null);
      } finally {
        if (!cancelled) setRestoring(false);
      }
    }

    void resolveEmployeeFromSession();

    const { data: subscription } = supabase().auth.onAuthStateChange((_event, session) => {
      if (!session) setEmployee(null);
    });

    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AppStateValue>(
    () => ({
      units,
      unit: units.find((u) => u.id === unitId) ?? null,
      setUnitId,
      employee,
      terminalEmployees,
      restoring,
      switchEmployee: async (employeeId, pin) => {
        const emp = await pinLogin(employeeId, pin);
        setTerminalEmployees(listTerminalEmployees());
        setEmployee(emp);
      },
      forgetEmployee: (employeeId) => {
        forgetTerminalEmployee(employeeId);
        setTerminalEmployees(listTerminalEmployees());
      },
      logout: async () => {
        // Encerra a sessão de verdade, não só o estado do React: deixar o
        // token válido no navegador depois de "sair" mantém o acesso do
        // colaborador anterior a um passo de distância.
        await supabase().auth.signOut();
        setEmployee(null);
        setUnitId(null);
      },
    }),
    [units, unitId, employee, terminalEmployees, restoring],
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppStateValue {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error("useAppState precisa estar dentro de <AppStateProvider>");
  return ctx;
}
