import { useEffect, useState } from "react";
import { Card, Button, HelpText } from "@facaamigos/ui";
import { PinPad } from "./PinPad.js";
import { Api } from "../api/client.js";
import { listTerminalEmployees, pinLogin, forgetTerminalEmployee } from "../lib/supabase/terminalAuth.js";
import type { TerminalEmployee } from "../lib/supabase/terminalAuth.js";
import { ROLE_LABEL, type Capability } from "../auth/capabilities.js";

/** Só id + nome — o papel não é exposto antes do login. Ver LoginScreen. */
interface LoginCandidate {
  id: string;
  full_name: string;
}

type Mode = { kind: "PICK" } | { kind: "PIN"; employee: LoginCandidate } | { kind: "ALL" };

export interface EmployeeAuthGateProps {
  onAuthenticated: (employee: TerminalEmployee) => void;
  /** Só aceita autenticar como este colaborador específico (ex.: bater o próprio ponto). */
  restrictToEmployeeId?: string;
  /**
   * Só aceita quem tiver esta capacidade. A conferência é feita relendo
   * `fa_kiosk_my_capabilities` DEPOIS do login — ou seja, contra a sessão
   * recém-emitida, no servidor, e não contra o papel que o cliente afirma
   * ter. Continua sendo uma checagem de UI (a ação em si é protegida pela
   * RPC correspondente), mas pelo menos não é auto-declarada.
   */
  requireCapability?: Capability;
  onCancel?: () => void;
}

/**
 * Porta de autenticação embutível (dentro de um Modal/Card), para reconfirmar
 * identidade numa ação sensível mesmo com alguém já logado. Login aqui é
 * sempre PIN: escolhe o colaborador (nos atalhos deste terminal ou na lista
 * completa) e digita o PIN de 6 dígitos — nunca e-mail, nunca senha.
 */
export function EmployeeAuthGate({
  onAuthenticated,
  restrictToEmployeeId,
  requireCapability,
  onCancel,
}: EmployeeAuthGateProps) {
  const cachedEmployees = listTerminalEmployees();
  const restrictedCached = restrictToEmployeeId ? cachedEmployees.find((e) => e.id === restrictToEmployeeId) : undefined;

  const [mode, setMode] = useState<Mode>(
    restrictToEmployeeId
      ? restrictedCached
        ? { kind: "PIN", employee: restrictedCached }
        : { kind: "ALL" }
      : cachedEmployees.length === 0
        ? { kind: "ALL" }
        : { kind: "PICK" },
  );
  const [terminalEmployees, setTerminalEmployees] = useState(cachedEmployees);
  const [allEmployees, setAllEmployees] = useState<LoginCandidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (mode.kind !== "ALL" || allEmployees) return;
    Api.employeesForLogin()
      .then(setAllEmployees)
      .catch((err) => {
        console.error("[auth-gate] falha ao carregar lista de colaboradores:", err);
        setAllEmployees([]);
        setError(`Não foi possível carregar a lista: ${err instanceof Error ? err.message : String(err)}`);
      });
  }, [mode.kind, allEmployees]);

  async function checkAndAccept(employee: TerminalEmployee) {
    if (restrictToEmployeeId && employee.id !== restrictToEmployeeId) {
      setError("Esta conta não corresponde ao colaborador selecionado.");
      return;
    }
    if (requireCapability) {
      const caps = await Api.myCapabilities().catch(() => []);
      if (!caps.some((c) => c.capability === requireCapability)) {
        setError("Esta conta não tem permissão para esta ação.");
        return;
      }
    }
    onAuthenticated(employee);
  }

  async function handlePinLogin(employeeId: string, pin: string) {
    setBusy(true);
    setError(null);
    try {
      const employee = await pinLogin(employeeId, pin);
      setTerminalEmployees(listTerminalEmployees());
      await checkAndAccept(employee);
    } catch (err) {
      setError(err instanceof Error ? err.message : "PIN incorreto");
    } finally {
      setBusy(false);
    }
  }

  function openAllEmployees() {
    setError(null);
    setMode({ kind: "ALL" });
  }

  if (mode.kind === "ALL") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <h2 style={{ fontFamily: "var(--font-display)", textAlign: "center", margin: 0 }}>Selecione seu nome</h2>
        {error && <p style={{ color: "var(--color-error-text)", textAlign: "center" }}>{error}</p>}
        {allEmployees === null && <p style={{ textAlign: "center", color: "var(--text-muted)" }}>Carregando…</p>}
        {allEmployees?.map((emp) => (
          <Card key={emp.id} style={{ padding: "16px", cursor: "pointer" }} onClick={() => { setError(null); setMode({ kind: "PIN", employee: emp }); }}>
            <strong>{emp.full_name}</strong>
          </Card>
        ))}
        {(restrictToEmployeeId || terminalEmployees.length > 0) && (
          <Button variant="ghost" onClick={restrictToEmployeeId ? onCancel : () => setMode({ kind: "PICK" })}>
            voltar
          </Button>
        )}
      </div>
    );
  }

  if (mode.kind === "PIN") {
    return (
      <PinEntry
        employee={mode.employee}
        busy={busy}
        error={error}
        onBack={
          restrictToEmployeeId
            ? onCancel
            : () => {
                setError(null);
                setMode(terminalEmployees.length === 0 ? { kind: "ALL" } : { kind: "PICK" });
              }
        }
        onSubmit={(pin) => void handlePinLogin(mode.employee.id, pin)}
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <h2 style={{ fontFamily: "var(--font-display)", textAlign: "center", margin: 0 }}>Quem está confirmando?</h2>
      <HelpText>Por segurança, esta ação exige confirmar sua identidade de novo com o PIN.</HelpText>
      {error && <p style={{ color: "var(--color-error-text)", textAlign: "center" }}>{error}</p>}
      {terminalEmployees.map((emp) => (
        <Card key={emp.id} style={{ padding: "16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ cursor: "pointer" }} onClick={() => { setError(null); setMode({ kind: "PIN", employee: emp }); }}>
            <strong>{emp.full_name}</strong> — {ROLE_LABEL[emp.role]}
          </span>
          <Button variant="ghost" onClick={() => { forgetTerminalEmployee(emp.id); setTerminalEmployees(listTerminalEmployees()); }}>
            remover
          </Button>
        </Card>
      ))}
      <Button variant="secondary" onClick={openAllEmployees}>
        outro colaborador
      </Button>
      {onCancel && (
        <Button variant="ghost" onClick={onCancel}>
          cancelar
        </Button>
      )}
    </div>
  );
}

function PinEntry({
  employee,
  busy,
  error,
  onBack,
  onSubmit,
}: {
  employee: LoginCandidate;
  busy: boolean;
  error: string | null;
  onBack?: () => void;
  onSubmit: (pin: string) => void;
}) {
  const [pin, setPin] = useState("");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px", alignItems: "center" }}>
      <h2 style={{ fontFamily: "var(--font-display)", margin: 0 }}>{employee.full_name}</h2>
      {error && <p style={{ color: "var(--color-error-text)" }}>{error}</p>}
      <PinPad
        value={pin}
        onChange={setPin}
        onSubmit={(completedPin) => {
          const pinToSubmit = completedPin || pin;
          if (pinToSubmit.length === 6) {
            onSubmit(pinToSubmit);
            setPin("");
          }
        }}
        disabled={busy}
        hasError={Boolean(error)}
      />
      {onBack && (
        <Button variant="ghost" onClick={onBack}>
          não é você? trocar
        </Button>
      )}
    </div>
  );
}
