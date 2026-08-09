import { useEffect, useRef, useState } from "react";
import { money } from "@facaamigos/domain";
import type { SessionTiming } from "@facaamigos/domain";
import { Button, Card, BrandLockup, HelpText } from "@facaamigos/ui";
import { useAcompanhar } from "../api/useAcompanhar.js";
import { formatElapsed } from "../format.js";
import { logAcompanharEvento } from "../api/acompanhar.js";
import {
  statusHeadline,
  renewalIntro,
  renewalHighlightAnchor,
  RENEWAL_OPTIONS,
  OVERAGE_RATE_CENTS_PER_MINUTE,
} from "./acompanhar/copy.js";

/**
 * Painel público do responsável — aberto sem login pelo QR mostrado no
 * check-in (ver EntradaScreen). Fora do fluxo de autenticação (mesmo
 * espírito de OnboardingInviteScreen): vive num branch de App.tsx que
 * roda antes de qualquer checagem de sessão salva.
 */
export function AcompanharScreen({ code }: { code: string }) {
  const { status, sessao, timing, errorMessage } = useAcompanhar(code);
  const [lembreteAtivo, setLembreteAtivo] = useState(false);
  const [lembreteErro, setLembreteErro] = useState<string | null>(null);
  const [renovacaoPedida, setRenovacaoPedida] = useState<number | null>(null);
  const qrAbertoLogged = useRef(false);
  const reminderTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (qrAbertoLogged.current || status !== "ready" || !sessao) return;
    if (sessao.status === "ATIVA" || sessao.status === "PAUSADA") {
      qrAbertoLogged.current = true;
      logAcompanharEvento(code, "QR_ABERTO").catch(() => {});
    }
  }, [status, sessao, code]);

  // Reagenda o alerta de 5 minutos sempre que a sessão é recarregada (ex:
  // troca de plano muda o teto) — nunca pede permissão sozinho, só quando
  // o responsável toca no botão.
  useEffect(() => {
    if (!lembreteAtivo || !timing || timing.phase === "EXCEDENTE") return;
    const msAteVermelho = timing.durationMs - timing.elapsedMs - 5 * 60_000;
    if (reminderTimeoutRef.current) window.clearTimeout(reminderTimeoutRef.current);
    if (msAteVermelho <= 0) return; // já está no aviso ou depois dele
    reminderTimeoutRef.current = window.setTimeout(() => {
      try {
        if (Notification.permission === "granted") {
          new Notification("Faça Amigos — faltam 5 minutinhos", {
            body: "Dá uma olhadinha no painel para ver as opções de continuar brincando.",
          });
        }
      } catch {
        // Notification pode não existir (Safari antigo) — o banner na
        // própria página, abaixo, já cobre esse caso.
      }
    }, msAteVermelho);
    return () => {
      if (reminderTimeoutRef.current) window.clearTimeout(reminderTimeoutRef.current);
    };
  }, [lembreteAtivo, timing]);

  async function ativarLembrete() {
    setLembreteErro(null);
    try {
      if (!("Notification" in window)) {
        setLembreteErro("Este navegador não avisa automaticamente — deixe a página aberta para acompanhar por aqui.");
        setLembreteAtivo(true);
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setLembreteErro("Sem permissão de notificação — deixe a página aberta para acompanhar por aqui.");
      }
      setLembreteAtivo(true);
      await logAcompanharEvento(code, "LEMBRETE_ATIVADO").catch(() => {});
    } catch {
      setLembreteErro("Não deu para ativar o lembrete agora — deixe a página aberta para acompanhar por aqui.");
    }
  }

  async function pedirRenovacao(minutes: number) {
    setRenovacaoPedida(minutes);
    try {
      await logAcompanharEvento(code, "RENOVACAO_SOLICITADA", { minutes, requestedAtMs: Date.now() });
    } catch {
      setRenovacaoPedida(null);
    }
  }

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

      {status === "loading" && <HelpText>Carregando o acompanhamento…</HelpText>}

      {status === "error" && (
        <Card style={{ maxWidth: 420, width: "100%" }}>
          <p style={{ margin: 0 }}>{errorMessage ?? "Não foi possível carregar o acompanhamento agora."}</p>
        </Card>
      )}

      {status === "ready" && sessao?.status === "NAO_ENCONTRADO" && (
        <Card style={{ maxWidth: 420, width: "100%" }}>
          <p style={{ margin: 0 }}>Não encontramos essa sessão. Se o QR é de hoje, chame um educador no balcão para conferir.</p>
        </Card>
      )}

      {status === "ready" && sessao?.status === "NAO_SUPORTADO" && (
        <Card style={{ maxWidth: 420, width: "100%" }} title={sessao.childFirstName}>
          <p style={{ margin: 0 }}>
            Este tipo de entrada (banco de horas) ainda não tem acompanhamento pelo celular — a equipe no balcão tem
            todas as informações sobre o tempo disponível.
          </p>
        </Card>
      )}

      {status === "ready" && sessao?.status === "FINALIZADA" && (
        <Card style={{ maxWidth: 420, width: "100%" }} title={sessao.childFirstName}>
          <p style={{ margin: 0 }}>A visita já foi encerrada. Até a próxima! 💛</p>
        </Card>
      )}

      {status === "ready" && sessao && (sessao.status === "ATIVA" || sessao.status === "PAUSADA") && timing && (
        <AcompanharConteudo
          childFirstName={sessao.childFirstName}
          sensoryTags={sessao.sensoryTags}
          timing={timing}
          isPausada={sessao.status === "PAUSADA"}
          lembreteAtivo={lembreteAtivo}
          lembreteErro={lembreteErro}
          onAtivarLembrete={ativarLembrete}
          renovacaoPedida={renovacaoPedida}
          onPedirRenovacao={pedirRenovacao}
        />
      )}
    </div>
  );
}

const PHASE_COLOR: Record<string, string> = {
  VERDE: "var(--color-teal)",
  AMARELO: "var(--color-amber)",
  VERMELHO: "var(--color-orange)",
  EXCEDENTE: "var(--color-orange)",
};

function AcompanharConteudo({
  childFirstName,
  sensoryTags,
  timing,
  isPausada,
  lembreteAtivo,
  lembreteErro,
  onAtivarLembrete,
  renovacaoPedida,
  onPedirRenovacao,
}: {
  childFirstName: string;
  sensoryTags: string[];
  timing: SessionTiming;
  isPausada: boolean;
  lembreteAtivo: boolean;
  lembreteErro: string | null;
  onAtivarLembrete: () => void;
  renovacaoPedida: number | null;
  onPedirRenovacao: (minutes: number) => void;
}) {
  const phase = isPausada ? "PAUSADA" : timing.phase;
  const color = isPausada ? "var(--color-teal)" : PHASE_COLOR[timing.phase];
  const showRenewal = !isPausada && (timing.phase === "VERMELHO" || timing.phase === "EXCEDENTE");
  const planDurationMinutes = Math.round(timing.durationMs / 60_000);

  return (
    <div style={{ width: "100%", maxWidth: 420, display: "flex", flexDirection: "column", gap: "16px" }}>
      <Card style={{ textAlign: "center", border: `2px solid ${color}` }}>
        <p style={{ margin: "0 0 8px", fontSize: "15px", color: "var(--text-muted)" }}>{statusHeadline(childFirstName, phase, sensoryTags)}</p>
        <div style={{ fontFamily: "var(--font-display)", fontSize: "48px", color, lineHeight: 1 }}>
          {formatElapsed(timing.elapsedMs)}
        </div>
        <p style={{ margin: "12px 0 0", fontSize: "14px", color: "var(--text-muted)" }}>
          {timing.overMinutes > 0
            ? `${Math.round(timing.durationMs / 60_000)} min inclusos no pacote — ${money(timing.overCents)} adicionais até agora`
            : `${Math.round(timing.durationMs / 60_000)} min inclusos no pacote — ${money(0)} adicionais`}
        </p>
      </Card>

      {!isPausada && !lembreteAtivo && timing.phase !== "EXCEDENTE" && (
        <Button variant="secondary" onClick={onAtivarLembrete}>
          🔔 Avisar quando faltarem 5 minutos
        </Button>
      )}
      {lembreteAtivo && <HelpText>Lembrete ativado — deixe esta página aberta para receber o aviso.</HelpText>}
      {lembreteErro && <HelpText>{lembreteErro}</HelpText>}

      {showRenewal && (
        <Card>
          <p style={{ margin: "0 0 16px", fontSize: "15px" }}>{renewalIntro(planDurationMinutes, childFirstName)}</p>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {RENEWAL_OPTIONS.map((opt) => (
              <div key={opt.minutes}>
                <Button
                  variant={opt.highlight ? "primary" : "secondary"}
                  fullWidth
                  disabled={renovacaoPedida !== null}
                  onClick={() => onPedirRenovacao(opt.minutes)}
                >
                  {renovacaoPedida === opt.minutes ? "Avisamos a recepção! 💛" : `+${opt.minutes} min — ${money(opt.cents)}`}
                  {opt.highlight ? " · recomendado" : ""}
                </Button>
                {opt.highlight && (
                  <p style={{ margin: "6px 4px 0", fontSize: "12px", color: "var(--text-muted)" }}>
                    {renewalHighlightAnchor(planDurationMinutes)}
                  </p>
                )}
              </div>
            ))}
          </div>
          <p style={{ margin: "16px 0 0", fontSize: "12px", color: "var(--text-muted)" }}>
            Sem pressa: no balcão, o minuto avulso sai a {money(OVERAGE_RATE_CENTS_PER_MINUTE)} — renovar agora garante o
            valor combinado. O pagamento é confirmado na recepção, sem cobrança automática pelo celular.
          </p>
        </Card>
      )}
    </div>
  );
}
