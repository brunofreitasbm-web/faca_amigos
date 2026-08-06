import { useState } from "react";
import { Card, Button } from "@facaamigos/ui";
import { useAppState } from "../state/AppState.js";
import { PinPad } from "../components/PinPad.js";
import type { TerminalEmployee } from "../lib/supabase/terminalAuth.js";

type Mode = { kind: "PICK" } | { kind: "PIN"; employee: TerminalEmployee } | { kind: "NEW_LOGIN" };

export function LoginScreen() {
  const { terminalEmployees, switchEmployee, loginWithPassword, forgetEmployee } = useAppState();
  const [mode, setMode] = useState<Mode>({ kind: "PICK" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (mode.kind === "NEW_LOGIN") {
    return (
      <NewEmployeeLogin
        onBack={() => setMode({ kind: "PICK" })}
        onSubmit={async (email, password, pin) => {
          setBusy(true);
          setError(null);
          try {
            await loginWithPassword(email, password, pin);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Não foi possível entrar");
          } finally {
            setBusy(false);
          }
        }}
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
        onBack={() => {
          setError(null);
          setMode({ kind: "PICK" });
        }}
        onSubmit={async (pin) => {
          setBusy(true);
          setError(null);
          try {
            await switchEmployee(mode.employee.id, pin);
          } catch {
            setError("PIN incorreto");
          } finally {
            setBusy(false);
          }
        }}
      />
    );
  }

  return (
    <div style={{ maxWidth: "480px", margin: "80px auto", display: "flex", flexDirection: "column", gap: "12px" }}>
      <h1 style={{ fontFamily: "var(--font-display)", textAlign: "center" }}>Quem está operando?</h1>
      {terminalEmployees.map((emp) => (
        <Card key={emp.id} style={{ padding: "16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ cursor: "pointer" }} onClick={() => setMode({ kind: "PIN", employee: emp })}>
            <strong>{emp.full_name}</strong> — {emp.role}
          </span>
          <Button variant="ghost" onClick={() => forgetEmployee(emp.id)}>
            remover
          </Button>
        </Card>
      ))}
      <Button variant="secondary" onClick={() => setMode({ kind: "NEW_LOGIN" })}>
        entrar com e-mail e senha
      </Button>
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
  onBack: () => void;
  onSubmit: (pin: string) => void;
}) {
  const [pin, setPin] = useState("");
  return (
    <div style={{ maxWidth: "360px", margin: "80px auto", display: "flex", flexDirection: "column", gap: "16px", alignItems: "center" }}>
      <h1 style={{ fontFamily: "var(--font-display)" }}>{employee.full_name}</h1>
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
      <Button variant="ghost" onClick={onBack}>
        não é você? trocar
      </Button>
    </div>
  );
}

function NewEmployeeLogin({
  onBack,
  onSubmit,
  busy,
  error,
}: {
  onBack: () => void;
  onSubmit: (email: string, password: string, pin: string) => void;
  busy: boolean;
  error: string | null;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");

  return (
    <div style={{ maxWidth: "360px", margin: "80px auto", display: "flex", flexDirection: "column", gap: "12px" }}>
      <h1 style={{ fontFamily: "var(--font-display)", textAlign: "center" }}>Entrar</h1>
      {error && <p style={{ color: "var(--color-error-text)" }}>{error}</p>}
      <input placeholder="e-mail" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input placeholder="senha" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      <input
        placeholder="escolha um PIN de 6 dígitos para este terminal"
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
      />
      <Button variant="primary" disabled={busy || pin.length !== 6} onClick={() => onSubmit(email, password, pin)}>
        Entrar
      </Button>
      <Button variant="ghost" onClick={onBack}>
        voltar
      </Button>
    </div>
  );
}
