import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
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
import { clearStepUpCache } from "../auth/stepUpCache.js";

interface AppStateValue {
  units: Unit[];
  unit: Unit | null;
  setUnitId: (id: string) => void;
  refreshUnits: () => Promise<void>;
  /** Modo Gerencial: fora das 3 unidades, configura o que vale para várias de uma vez. */
  gerencial: boolean;
  setGerencial: (value: boolean) => void;
  employee: TerminalEmployee | null;
  terminalEmployees: TerminalEmployee[];
  switchEmployee: (employeeId: string, pin: string) => Promise<void>;
  forgetEmployee: (employeeId: string) => void;
  logout: () => Promise<void>;
  /** true até a sessão salva no navegador ter sido conferida. */
  restoring: boolean;
  hasFaceEnrolled: boolean | null;
  setHasFaceEnrolled: (val: boolean) => void;
}

const AppStateContext = createContext<AppStateValue | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [units, setUnits] = useState<Unit[]>([]);
  const [unitId, setUnitId] = useState<string | null>(null);
  const [gerencial, setGerencial] = useState(false);
  const [employee, setEmployee] = useState<TerminalEmployee | null>(null);
  const [terminalEmployees, setTerminalEmployees] = useState<TerminalEmployee[]>(listTerminalEmployees());
  const [restoring, setRestoring] = useState(true);
  const [hasFaceEnrolled, setHasFaceEnrolled] = useState<boolean | null>(null);

  useEffect(() => {
    if (!employee) {
      setHasFaceEnrolled(null);
      return;
    }
    let isCancelled = false;
    Api.myFaceDescriptor(employee.id)
      .then((desc) => {
        if (isCancelled) return;
        setHasFaceEnrolled(Array.isArray(desc) && desc.length > 0);
      })
      .catch(() => {
        if (!isCancelled) setHasFaceEnrolled(false);
      });
    return () => {
      isCancelled = true;
    };
  }, [employee]);

  // As unidades só podem ser lidas com sessão (as policies de leitura são
  // `to authenticated` desde a migration 20260807000003), então a busca
  // depende do colaborador estar logado.
  // Para colaboradores com papel OPERADOR, a lista de unidades é restrita
  // exclusivamente à(s) unidade(s) alocada(s) em fa_kiosk_employee_units.
  useEffect(() => {
    if (!employee) {
      setUnits([]);
      return;
    }

    let isCancelled = false;

    async function loadUnits() {
      try {
        const allUnits = await Api.units();
        if (isCancelled) return;

        if (employee?.role === "OPERADOR") {
          const myIds: string[] = await Api.myUnitIds(employee.id).catch(() => []);
          if (isCancelled) return;
          const assigned = allUnits.filter((u) => myIds.includes(u.id));
          if (assigned.length > 0) {
            setUnits(assigned);
          } else {
            // Se for operador sem vinculo especifico gravado, limita a 1 unidade
            setUnits(allUnits.slice(0, 1));
          }
        } else {
          setUnits(allUnits);
        }
      } catch {
        if (!isCancelled) setUnits([]);
      }
    }

    void loadUnits();

    return () => {
      isCancelled = true;
    };
  }, [employee]);

  // Se o colaborador está vinculado a uma única unidade (ou é Operador),
  // pular a tela de seleção de módulo automaticamente.
  const autoSelectedForEmployeeId = useRef<string | null>(null);
  useEffect(() => {
    if (!employee || unitId) return;
    if (autoSelectedForEmployeeId.current === employee.id) return;

    if (employee.role === "OPERADOR" && units.length > 0) {
      autoSelectedForEmployeeId.current = employee.id;
      setUnitId(units[0]!.id);
      return;
    }

    Api.myUnitIds(employee.id)
      .then((ids) => {
        autoSelectedForEmployeeId.current = employee.id;
        if (ids.length === 1) setUnitId(ids[0]!);
      })
      .catch(() => {
        autoSelectedForEmployeeId.current = employee.id;
      });
  }, [employee, unitId, units]);

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

  const refreshUnits = async () => {
    if (!employee) return;
    try {
      const allUnits = await Api.units();
      if (employee.role === "OPERADOR") {
        const myIds: string[] = await Api.myUnitIds(employee.id).catch(() => []);
        const assigned = allUnits.filter((u) => myIds.includes(u.id));
        setUnits(assigned.length > 0 ? assigned : allUnits.slice(0, 1));
      } else {
        setUnits(allUnits);
      }
    } catch (err) {
      console.error("Erro ao recarregar unidades:", err);
    }
  };

  const handleSetGerencial = (val: boolean) => {
    // Operador NUNCA acessa o módulo gerencial
    if (val && employee?.role === "OPERADOR") {
      setGerencial(false);
      return;
    }
    setGerencial(val);
  };

  const value = useMemo<AppStateValue>(
    () => ({
      units,
      unit: units.find((u) => u.id === unitId) ?? null,
      setUnitId,
      refreshUnits,
      gerencial: employee?.role === "OPERADOR" ? false : gerencial,
      setGerencial: handleSetGerencial,
      employee,
      terminalEmployees,
      restoring,
      hasFaceEnrolled,
      setHasFaceEnrolled,
      switchEmployee: async (employeeId, pin) => {
        const emp = await pinLogin(employeeId, pin);
        clearStepUpCache();
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
        clearStepUpCache();
        setEmployee(null);
        setUnitId(null);
        setGerencial(false);
        autoSelectedForEmployeeId.current = null;
        setHasFaceEnrolled(null);
      },
    }),
    [units, unitId, gerencial, employee, terminalEmployees, restoring, hasFaceEnrolled],
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppStateValue {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error("useAppState precisa estar dentro de <AppStateProvider>");
  return ctx;
}
