import { useState } from "react";
import { Card, Button } from "@facaamigos/ui";
import { PinPad } from "./PinPad.js";
import { listTerminalEmployees, fullLogin, quickSwitch, forgetTerminalEmployee } from "../lib/supabase/terminalAuth.js";
import type { TerminalEmployee } from "../lib/supabase/terminalAuth.js";

type Mode = { kind: "PICK" } | { kind: "PIN"; employee: TerminalEmployee } | { kind: "NEW_LOGIN" };

export interface EmployeeAuthGateProps {
  onAuthenticated: (employee: TerminalEmployee) => void;
  /** Só aceita autenticar como este colaborador específico (ex.: bater o próprio ponto). */
  restrictToEmployeeId?: string;
  /** Só aceita autenticar como um colaborador com este papel (ex.: cadastrar colaborador). */
  requireRole?: "ADMIN";
  onCancel?: () => void;
}

/**
 * Porta de autenticação embutível (dentro de um Modal/Card), separada do
 * `AppState.employee` — que é a identidade "de conveniência" usada por
 * Entrada/PDV/Caixa sem exigir login. Este gate chama `fullLogin`/
 * `quickSwitch` diretamente, sem tocar no AppState, para não trocar quem
 * está "operando o terminal" só porque alguém bateu o próprio ponto ou um
 * ADMIN entrou para cadastrar um colaborador.
 */
export function EmployeeAuthGate({ onAuthenticated, restrictToEmployeeId, requireRole, onCancel }: EmployeeAuthGateProps) {
  const cachedEmployees = listTerminalEmployees();
  const restrictedCached = restrictToEmployeeId ? cachedEmployees.find((e) => e.id === restrictToEmployeeId) : undefined;

  const [mode, setMode] = useState<Mode>(
    restrictToEmployeeId ? (restrictedCached ? { kind: "PIN", employee: restrictedCached } : { kind: "NEW_LOGIN" }) : { kind: "PICK" },
  );
  const [terminalEmployees, setTerminalEmployees] = useState(cachedEmployees);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function checkAndAccept(employee: TerminalEmployee) {
    if (restrictToEmployeeId && employee.id !== restrictToEmployeeId) {
      setError("Esta conta não corresponde ao colaborador selecionado.");
      return;
    }
    if (requireRole === "ADMIN" && employee.role !== "ADMIN") {
      setError("Esta conta não tem permissão de administrador.");
      return;
    }
    onAuthenticated(employee);
  }

  async function handleFullLogin(email: string, password: string, pin: string) {
    setBusy(true);
    setError(null);
    try {
      const employee = await fullLogin(email, password, pin);
      setTerminalEmployees(listTerminalEmployees());
      checkAndAccept(employee);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível entrar");
    } finally {
      setBusy(false);
    }
  }

  async function handleQuickSwitch(employeeId: string, pin: string) {
    setBusy(true);
    setError(null);
    try {
      const employee = await quickSwitch(employeeId, pin);
      checkAndAccept(employee);
    } catch {
      setError("PIN incorreto");
    } finally {
      setBusy(false);
    }
  }

  if (mode.kind === "NEW_LOGIN") {
    return (
      <NewEmployeeLogin
        onBack={restrictToEmployeeId ? onCancel : () => setMode({ kind: "PICK" })}
        onSubmit={handleFullLogin}
        busy={busy}
        error={error}
      />
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
                setMode({ kind: "PICK" });
              }
        }
        onSubmit={(pin) => handleQuickSwitch(mode.employee.id, pin)}
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <h2 style={{ fontFamily: "var(--font-display)", textAlign: "center", margin: 0 }}>Quem está confirmando?</h2>
      {error && <p style={{ color: "var(--color-error-text)", textAlign: "center" }}>{error}</p>}
      {terminalEmployees.map((emp) => (
        <Card key={emp.id} style={{ padding: "16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ cursor: "pointer" }} onClick={() => { setError(null); setMode({ kind: "PIN", employee: emp }); }}>
            <strong>{emp.full_name}</strong> — {emp.role}
          </span>
          <Button variant="ghost" onClick={() => { forgetTerminalEmployee(emp.id); setTerminalEmployees(listTerminalEmployees()); }}>
            remover
          </Button>
        </Card>
      ))}
      <Button variant="secondary" onClick={() => setMode({ kind: "NEW_LOGIN" })}>
        entrar com e-mail e senha
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
  employee: TerminalEmployee;
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
        onSubmit={() => {
          onSubmit(pin);
          setPin("");
        }}
        disabled={busy}
      />
      {onBack && (
        <Button variant="ghost" onClick={onBack}>
          não é você? trocar
        </Button>
      )}
    </div>
  );
}

function NewEmployeeLogin({
  onBack,
  onSubmit,
  busy,
  error,
}: {
  onBack?: () => void;
  onSubmit: (email: string, password: string, pin: string) => void;
  busy: boolean;
  error: string | null;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <h2 style={{ fontFamily: "var(--font-display)", textAlign: "center", margin: 0 }}>Entrar</h2>
      {error && <p style={{ color: "var(--color-error-text)" }}>{error}</p>}
      <input placeholder="e-mail" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input placeholder="senha" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      <input
        placeholder="escolha um PIN de 6 dígitos para este terminal"
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
      />
      <Button variant="primary" disabled={busy || pin.length !== 6 || !email || !password} onClick={() => onSubmit(email, password, pin)}>
        Entrar
      </Button>
      {onBack && (
        <Button variant="ghost" onClick={onBack}>
          voltar
        </Button>
      )}
    </div>
  );
}
