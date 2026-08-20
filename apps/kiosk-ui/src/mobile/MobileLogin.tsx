import { useEffect, useState } from "react";
import { Api } from "../api/client.js";
import { useAppState } from "../state/AppState.js";
import { PinPad } from "../components/PinPad.js";
import { ROLE_LABEL } from "../auth/capabilities.js";
import "./mobile.css";

/**
 * Mesma lógica de login do balcão (LoginScreen.tsx) — lista de quem já
 * logou neste terminal, PIN, "outro colaborador" para a lista completa —
 * só com a casca do modo celular em vez do card centralizado de
 * computador. É `useAppState()` direto, não uma segunda implementação:
 * login por PIN não tem nada pra divergir de valor de negócio, então
 * aqui construir nativo em vez de embrulhar é seguro.
 */
interface LoginCandidate {
  id: string;
  full_name: string;
}

type Mode = { kind: "PICK" } | { kind: "PIN"; employee: LoginCandidate } | { kind: "ALL" };

function Splash() {
  return (
    <div style={{ flex: "none", padding: "48px 24px 8px", textAlign: "center" }}>
      <img src="/favicon.png" alt="Faça Amigos" style={{ width: 64, height: 64, objectFit: "contain", marginBottom: 8 }} />
      <p style={{ margin: "0 0 4px", fontFamily: "var(--font-display)", fontSize: 22, color: "#F0196B" }}>Faça Amigos</p>
      <p style={{ margin: 0, fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-muted, #6C7682)" }}>
        Playground Inclusivo
      </p>
    </div>
  );
}

function NameRow({ name, subtitle, onPick, onForget }: { name: string; subtitle?: string; onPick: () => void; onForget?: () => void }) {
  return (
    <div className="m-card m-row" style={{ borderRadius: 20, padding: "16px 18px", justifyContent: "space-between", gap: 12 }}>
      <span className="m-tap m-grow" style={{ minHeight: 0 }} onClick={onPick}>
        <strong style={{ fontSize: 15.5 }}>{name}</strong>
        {subtitle && (
          <span style={{ display: "block", marginTop: 2, fontSize: 12.5, fontWeight: 600, color: "var(--text-muted, #6C7682)" }}>{subtitle}</span>
        )}
      </span>
      {onForget && (
        <button
          type="button"
          onClick={onForget}
          title="Esquecer este colaborador neste aparelho"
          style={{ background: "none", border: "none", font: "inherit", fontSize: 12, fontWeight: 700, color: "var(--text-muted, #6C7682)", cursor: "pointer", flex: "none" }}
        >
          remover
        </button>
      )}
    </div>
  );
}

export function MobileLogin() {
  const { terminalEmployees, switchEmployee, forgetEmployee } = useAppState();
  const [mode, setMode] = useState<Mode>(terminalEmployees.length === 0 ? { kind: "ALL" } : { kind: "PICK" });
  const [allEmployees, setAllEmployees] = useState<LoginCandidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pin, setPin] = useState("");

  useEffect(() => {
    if (mode.kind !== "ALL" || allEmployees) return;
    Api.employeesForLogin()
      .then(setAllEmployees)
      .catch((err) => {
        setAllEmployees([]);
        setError(`Não foi possível carregar a lista: ${err instanceof Error ? err.message : String(err)}`);
      });
  }, [mode.kind, allEmployees]);

  async function submitPin(candidate: LoginCandidate, pinToSubmit: string) {
    setBusy(true);
    setError(null);
    try {
      await switchEmployee(candidate.id, pinToSubmit);
    } catch (err) {
      setError(err instanceof Error ? err.message : "PIN incorreto");
    } finally {
      setBusy(false);
      setPin("");
    }
  }

  // Passo do PIN: mesmo fundo de marca do splash — a pessoa já se
  // identificou (tocou o nome), então o nome dela substitui o wordmark.
  if (mode.kind === "PIN") {
    return (
      <div className="m-shell">
        <div className="m-frame" style={{ alignItems: "center", justifyContent: "center", padding: "24px" }}>
          <p style={{ margin: "0 0 4px", fontFamily: "var(--font-display)", fontSize: 26, color: "var(--dark, #1A3F35)", textAlign: "center" }}>
            {mode.employee.full_name}
          </p>
          {error && <p style={{ margin: "0 0 8px", color: "var(--color-error-text, #E61E1E)", textAlign: "center", fontSize: 13 }}>{error}</p>}
          <div style={{ marginTop: 16 }}>
            <PinPad
              value={pin}
              onChange={setPin}
              onSubmit={(completed) => void submitPin(mode.employee, completed || pin)}
              disabled={busy}
              hasError={Boolean(error)}
            />
          </div>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setPin("");
              setMode(terminalEmployees.length === 0 ? { kind: "ALL" } : { kind: "PICK" });
            }}
            style={{ marginTop: 20, background: "none", border: "none", font: "inherit", fontSize: 13, fontWeight: 800, color: "var(--text-muted, #6C7682)", cursor: "pointer" }}
          >
            não é você? trocar
          </button>
        </div>
      </div>
    );
  }

  if (mode.kind === "ALL") {
    return (
      <div className="m-shell">
        <div className="m-frame">
          <Splash />
          <div className="m-scroll">
            <p style={{ margin: "8px 0 16px", textAlign: "center", fontFamily: "var(--font-display)", fontSize: 22, color: "var(--dark, #1A3F35)" }}>
              Selecione seu nome
            </p>
            {error && <p style={{ textAlign: "center", color: "var(--color-error-text, #E61E1E)", fontSize: 13, marginBottom: 12 }}>{error}</p>}
            {allEmployees === null && <p style={{ textAlign: "center", color: "var(--text-muted, #6C7682)" }}>Carregando…</p>}

            <div className="m-stack" style={{ gap: 10 }}>
              {allEmployees?.map((emp) => (
                <NameRow
                  key={emp.id}
                  name={emp.full_name}
                  onPick={() => {
                    setError(null);
                    setPin("");
                    setMode({ kind: "PIN", employee: emp });
                  }}
                />
              ))}
            </div>

            {terminalEmployees.length > 0 && (
              <button type="button" className="m-pill" style={{ width: "100%", marginTop: 16 }} onClick={() => setMode({ kind: "PICK" })}>
                voltar
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="m-shell">
      <div className="m-frame">
        <Splash />
        <div className="m-scroll">
          <p style={{ margin: "8px 0 16px", textAlign: "center", fontFamily: "var(--font-display)", fontSize: 22, color: "var(--dark, #1A3F35)" }}>
            Quem está operando?
          </p>

          <div className="m-stack" style={{ gap: 10 }}>
            {terminalEmployees.map((emp) => (
              <NameRow
                key={emp.id}
                name={emp.full_name}
                subtitle={ROLE_LABEL[emp.role]}
                onPick={() => {
                  setError(null);
                  setPin("");
                  setMode({ kind: "PIN", employee: emp });
                }}
                onForget={() => forgetEmployee(emp.id)}
              />
            ))}
          </div>

          <button
            type="button"
            className="m-pill"
            style={{ width: "100%", marginTop: 16 }}
            onClick={() => {
              setError(null);
              setMode({ kind: "ALL" });
            }}
          >
            outro colaborador
          </button>
        </div>
      </div>
    </div>
  );
}
