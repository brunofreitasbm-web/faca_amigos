import { useEffect, useState } from "react";
import { Button, Card, BrandLockup, HelpText } from "@facaamigos/ui";
import { fetchNpsWeb, submitNpsWeb, type NpsWebInfo } from "../api/nps.js";
import { npsBand } from "../lib/nps.js";

/**
 * Pesquisa de NPS por clique — aberta sem login pelo link do WhatsApp
 * (?nps=<token>). Três notas (recomendação 0-10, equipe 1-5, espaço 1-5) e
 * um texto aberto opcional; o pai só clica. Vive num branch de App.tsx antes
 * da checagem de sessão, como AcompanharScreen.
 */
type Load = { status: "loading" } | { status: "error" } | { status: "ready"; info: NpsWebInfo };

const BAND_COLOR = { DETRACTOR: "#ef4444", PASSIVE: "#f59e0b", PROMOTER: "#10b981" } as const;

export function NpsScreen({ token }: { token: string }) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [score, setScore] = useState<number | null>(null);
  const [team, setTeam] = useState<number | null>(null);
  const [space, setSpace] = useState<number | null>(null);
  const [feedback, setFeedback] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchNpsWeb(token)
      .then((info) => alive && setLoad({ status: "ready", info }))
      .catch(() => alive && setLoad({ status: "error" }));
    return () => {
      alive = false;
    };
  }, [token]);

  const ready = score !== null && team !== null && space !== null;

  async function send() {
    if (!ready || sending) return;
    setSending(true);
    setSendError(null);
    try {
      await submitNpsWeb(token, { score, scoreTeam: team, scoreSpace: space, feedback });
      setDone(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("ALREADY_ANSWERED")) setDone(true);
      else if (msg.includes("EXPIRED")) setLoad({ status: "ready", info: { state: "EXPIRED", brand: "FaçaAmigos" } });
      else setSendError("Não conseguimos enviar agora. Tente de novo em instantes.");
    } finally {
      setSending(false);
    }
  }

  const info = load.status === "ready" ? load.info : null;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(180deg, #FFF7FA 0%, #FFFFFF 40%)",
        padding: "24px 16px 48px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "20px",
      }}
    >
      <BrandLockup />

      {load.status === "loading" && <HelpText>Carregando…</HelpText>}
      {load.status === "error" && (
        <Card style={{ maxWidth: 420, width: "100%" }}>
          <p style={{ margin: 0 }}>Não foi possível abrir a pesquisa agora. Tente novamente em instantes.</p>
        </Card>
      )}
      {info?.state === "NOT_FOUND" && (
        <Card style={{ maxWidth: 420, width: "100%" }}>
          <p style={{ margin: 0 }}>Não encontramos essa pesquisa. Confira se o link está completo.</p>
        </Card>
      )}
      {info?.state === "EXPIRED" && (
        <Card style={{ maxWidth: 420, width: "100%" }}>
          <p style={{ margin: 0 }}>Essa pesquisa já encerrou. Obrigado pelo carinho! 💛</p>
        </Card>
      )}
      {(info?.state === "ALREADY_ANSWERED" || done) && (
        <Card style={{ maxWidth: 420, width: "100%" }}>
          <p style={{ margin: 0 }}>
            {done ? "Muito obrigado pelo seu retorno! Ele ajuda a melhorar cada visita. 💛" : "Você já respondeu essa pesquisa. Obrigado! 💛"}
          </p>
        </Card>
      )}

      {info?.state === "OPEN" && !done && (
        <div style={{ maxWidth: 420, width: "100%", display: "flex", flexDirection: "column", gap: 16 }}>
          <h1 style={{ margin: 0, fontSize: 22, fontFamily: "var(--font-display)", color: "var(--color-dark, #1A3F35)" }}>
            {info.firstName ? `Oi, ${info.firstName}! ` : "Oi! "}Como foi a visita?
          </h1>

          <Card>
            <Question>De 0 a 10, quanto você recomendaria o {info.brand} a um amigo?</Question>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 8 }}>
              {Array.from({ length: 11 }, (_, n) => (
                <Choice key={n} label={String(n)} selected={score === n} color={BAND_COLOR[npsBand(n)]} onClick={() => setScore(n)} />
              ))}
            </div>
            <Ends left="Nada provável" right="Muito provável" />
          </Card>

          <Card>
            <Question>Como foi o cuidado e o atendimento da nossa equipe?</Question>
            <FiveScale value={team} onChange={setTeam} />
          </Card>

          <Card>
            <Question>E o espaço: estrutura, limpeza e segurança?</Question>
            <FiveScale value={space} onChange={setSpace} />
          </Card>

          <Card>
            <Question>Quer deixar uma sugestão ou elogio? (opcional)</Question>
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value.slice(0, 1000))}
              rows={4}
              placeholder="Conte o que gostou ou o que podemos melhorar"
              style={{ width: "100%", boxSizing: "border-box", borderRadius: 12, border: "1px solid #e2e8f0", padding: 12, font: "inherit", fontSize: 16 }}
            />
          </Card>

          {sendError && <p style={{ margin: 0, color: "#b91c1c" }}>{sendError}</p>}
          <Button onClick={send} disabled={!ready || sending}>
            {sending ? "Enviando…" : "Enviar"}
          </Button>
          {!ready && <HelpText style={{ textAlign: "center" }}>Marque as três notas para enviar.</HelpText>}
        </div>
      )}
    </div>
  );
}

function Question({ children }: { children: React.ReactNode }) {
  return <p style={{ margin: "0 0 12px", fontWeight: 600, fontSize: 16 }}>{children}</p>;
}

function Ends({ left, right }: { left: string; right: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 12, color: "#64748b" }}>
      <span>{left}</span>
      <span>{right}</span>
    </div>
  );
}

function FiveScale({ value, onChange }: { value: number | null; onChange: (n: number) => void }) {
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8 }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Choice key={n} label={String(n)} selected={value === n} color="#F0196B" onClick={() => onChange(n)} />
        ))}
      </div>
      <Ends left="Ruim" right="Excelente" />
    </>
  );
}

function Choice({ label, selected, color, onClick }: { label: string; selected: boolean; color: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      style={{
        minHeight: 48,
        borderRadius: 12,
        border: `2px solid ${selected ? color : "#e2e8f0"}`,
        background: selected ? color : "#fff",
        color: selected ? "#fff" : "#0f172a",
        fontSize: 18,
        fontWeight: 700,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}
