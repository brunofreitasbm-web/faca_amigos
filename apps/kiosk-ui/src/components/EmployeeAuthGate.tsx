import { useState } from "react";
import { Card, Button, HelpText } from "@facaamigos/ui";
import { PinPad } from "./PinPad.js";
import { Api } from "../api/client.js";
import { listTerminalEmployees, pinLogin, forgetTerminalEmployee } from "../lib/supabase/terminalAuth.js";
import type { TerminalEmployee } from "../lib/supabase/terminalAuth.js";

type Mode = { kind: "PICK" } | { kind: "PIN"; employee: TerminalEmployee } | { kind: "ALL" };

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
 * Entrada/PDV/Caixa sem exigir login. Login aqui é sempre PIN: escolhe o
 * colaborador (nos atalhos deste terminal ou na lista completa) e digita
 * o PIN de 6 dígitos — nunca e-mail, nunca senha.
 */
export function EmployeeAuthGate({ onAuthenticated, restrictToEmployeeId, requireRole, onCancel }: EmployeeAuthGateProps) {
  const cachedEmployees = listTerminalEmployees();
  const restrictedCached = restrictToEmployeeId ? cachedEmployees.find((e) => e.id === restrictToEmployeeId) : undefined;

  const [mode, setMode] = useState<Mode>(
    restrictToEmployeeId ? (restrictedCached ? { kind: "PIN", employee: restrictedCached } : { kind: "ALL" }) : { kind: "PICK" },
  );
  const [terminalEmployees, setTerminalEmployees] = useState(cachedEmployees);
  const [allEmployees, setAllEmployees] = useState<TerminalEmployee[] | null>(null);
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

  async function handlePinLogin(employeeId: string, pin: string) {
    setBusy(true);
    setError(null);
    try {
      const employee = await pinLogin(employeeId, pin);
      setTerminalEmployees(listTerminalEmployees());
      checkAndAccept(employee);
    } catch {
      setError("PIN incorreto");
    } finally {
      setBusy(false);
    }
  }

  function openAllEmployees() {
    setError(null);
    setMode({ kind: "ALL" });
    if (!allEmployees) {
      Api.employees().then((list) => setAllEmployees(list.map((e) => ({ id: e.id, full_name: e.full_name, role: e.role }))));
    }
  }

  if (mode.kind === "ALL") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <h2 style={{ fontFamily: "var(--font-display)", textAlign: "center", margin: 0 }}>Selecione seu nome</h2>
        {error && <p style={{ color: "var(--color-error-text)", textAlign: "center" }}>{error}</p>}
        {allEmployees === null && <p style={{ textAlign: "center", color: "var(--text-muted)" }}>Carregando…</p>}
        {allEmployees?.map((emp) => (
          <Card key={emp.id} style={{ padding: "16px", cursor: "pointer" }} onClick={() => { setError(null); setMode({ kind: "PIN", employee: emp }); }}>
            <strong>{emp.full_name}</strong> — {emp.role}
          </Card>
        ))}
        <Button variant="ghost" onClick={restrictToEmployeeId ? onCancel : () => setMode({ kind: "PICK" })}>
          voltar
        </Button>
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
                setMode({ kind: "PICK" });
              }
        }
        onSubmit={(pin) => handlePinLogin(mode.employee.id, pin)}
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <h2 style={{ fontFamily: "var(--font-display)", textAlign: "center", margin: 0 }}>Quem está confirmando?</h2>
      <HelpText>Por segurança, esta ação exige confirmar sua identidade de novo com PIN ou e-mail e senha.</HelpText>
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
