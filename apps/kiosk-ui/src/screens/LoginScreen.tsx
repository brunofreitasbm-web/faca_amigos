import { useState } from "react";
import { Card, Button } from "@facaamigos/ui";
import { useAppState } from "../state/AppState.js";
import { Api } from "../api/client.js";
import { PinPad } from "../components/PinPad.js";
import type { TerminalEmployee } from "../lib/supabase/terminalAuth.js";

type Mode = { kind: "PICK" } | { kind: "PIN"; employee: TerminalEmployee } | { kind: "ALL" };

export function LoginScreen() {
  const { terminalEmployees, switchEmployee, forgetEmployee } = useAppState();
  const [mode, setMode] = useState<Mode>({ kind: "PICK" });
  const [allEmployees, setAllEmployees] = useState<TerminalEmployee[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function openAllEmployees() {
    setError(null);
    setMode({ kind: "ALL" });
    if (!allEmployees) {
      Api.employees().then((list) => setAllEmployees(list.map((e) => ({ id: e.id, full_name: e.full_name, role: e.role }))));
    }
  }

  if (mode.kind === "ALL") {
    return (
      <div style={{ maxWidth: "480px", margin: "80px auto", display: "flex", flexDirection: "column", gap: "12px" }}>
        <h1 style={{ fontFamily: "var(--font-display)", textAlign: "center" }}>Selecione seu nome</h1>
        {error && <p style={{ color: "var(--color-error-text)", textAlign: "center" }}>{error}</p>}
        {allEmployees === null && <p style={{ textAlign: "center", color: "var(--text-muted)" }}>Carregando…</p>}
        {allEmployees?.map((emp) => (
          <Card key={emp.id} style={{ padding: "16px", cursor: "pointer" }} onClick={() => { setError(null); setMode({ kind: "PIN", employee: emp }); }}>
            <strong>{emp.full_name}</strong> — {emp.role}
          </Card>
        ))}
        <Button variant="ghost" onClick={() => setMode({ kind: "PICK" })}>
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
      <Button variant="secondary" onClick={openAllEmployees}>
        outro colaborador
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
