import { useState } from "react";
import { Card, Button, HelpText } from "@facaamigos/ui";
import { useAppState } from "../state/AppState.js";
import { Api } from "../api/client.js";
import { PinPad } from "../components/PinPad.js";
import { ROLE_LABEL } from "../auth/capabilities.js";

/**
 * Quem aparece na tela de login. Só id + nome: o PAPEL não é mostrado aqui
 * de propósito — antes a lista entregava quem era o Owner, o que dava a um
 * ataque de força bruta o alvo certo de graça. Depois do login o papel volta
 * a aparecer no cabeçalho, para o colaborador reconhecer a própria conta.
 */
interface LoginCandidate {
  id: string;
  full_name: string;
}

type Mode = { kind: "PICK" } | { kind: "PIN"; employee: LoginCandidate } | { kind: "ALL" };

export function LoginScreen() {
  const { terminalEmployees, switchEmployee, forgetEmployee } = useAppState();
  const [mode, setMode] = useState<Mode>({ kind: "PICK" });
  const [allEmployees, setAllEmployees] = useState<LoginCandidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function openAllEmployees() {
    setError(null);
    setMode({ kind: "ALL" });
    if (!allEmployees) {
      Api.employeesForLogin()
        .then(setAllEmployees)
        .catch(() => {
          setAllEmployees([]);
          setError("Não foi possível carregar a lista. Verifique a conexão.");
        });
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
            <strong>{emp.full_name}</strong>
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
          } catch (err) {
            setError(err instanceof Error ? err.message : "PIN incorreto");
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
      <HelpText>Toque no seu nome para confirmar com o PIN deste terminal. Se ainda não apareceu na lista, toque em "outro colaborador".</HelpText>
      {terminalEmployees.map((emp) => (
        <Card key={emp.id} style={{ padding: "16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ cursor: "pointer" }} onClick={() => setMode({ kind: "PIN", employee: emp })}>
            <strong>{emp.full_name}</strong> — {ROLE_LABEL[emp.role]}
          </span>
          <Button variant="ghost" title="Esquecer este colaborador neste terminal (ele precisará ser selecionado de novo na lista completa)" onClick={() => forgetEmployee(emp.id)}>
            remover
          </Button>
        </Card>
      ))}
      <Button variant="secondary" title="Ver a lista completa de colaboradores, caso o seu nome não apareça acima" onClick={openAllEmployees}>
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
  employee: LoginCandidate;
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
      <Button variant="ghost" onClick={onBack}>
        não é você? trocar
      </Button>
    </div>
  );
}
