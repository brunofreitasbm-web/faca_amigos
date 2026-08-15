import { useEffect, useRef, useState } from "react";
import { generateMobileAcompanharSuggestions, type MobileOffer } from "../lib/geminiAgent.js";
import { money } from "@facaamigos/domain";
import type { SessionTiming } from "@facaamigos/domain";
import { Button, Card, BrandLockup, HelpText } from "@facaamigos/ui";
import { useAcompanhar } from "../api/useAcompanhar.js";
import { formatElapsed } from "../format.js";
import { logAcompanharEvento, registrarAcompanharPush } from "../api/acompanhar.js";
import { isPushSupported, subscribeToPush, pushSubscriptionToKeys } from "../lib/push.js";
import {
  statusHeadline,
  renewalIntro,
  renewalHighlightAnchor,
  RENEWAL_OPTIONS,
  OVERAGE_RATE_CENTS_PER_MINUTE,
} from "./acompanhar/copy.js";
import {
  getCircuitoAlertConfig,
  circuitoStatusHeadline,
  circuitoRenewalIntro,
  circuitoAnchorMessage,
  type CircuitoAssetKind,
} from "./acompanhar/copyCircuito.js";

/**
 * Painel público do responsável — aberto sem login pelo QR mostrado no
 * check-in (ver EntradaScreen). Fora do fluxo de autenticação (mesmo
 * espírito de OnboardingInviteScreen): vive num branch de App.tsx que
 * roda antes de qualquer checagem de sessão salva.
 */
export function AcompanharScreen({ code }: { code: string }) {
  const { status, sessao, timing, errorMessage } = useAcompanhar(code);
  const [lembreteAtivo, setLembreteAtivo] = useState(false);
  // true quando o alerta foi delegado ao servidor (Web Push) — o
  // responsável pode fechar o app; false = fallback antigo, que só
  // funciona com a aba aberta.
  const [pushAtivo, setPushAtivo] = useState(false);
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

  const isCircuito = sessao?.status === "ATIVA" || sessao?.status === "PAUSADA" ? sessao.activity === "CARRINHO" : false;
  const circuitoAssetKind = sessao?.status === "ATIVA" || sessao?.status === "PAUSADA" ? sessao.plan.assetKind : null;
  const circuitoConfig =
    isCircuito && timing ? getCircuitoAlertConfig(circuitoAssetKind, Math.round(timing.durationMs / 60_000)) : null;

  // Reagenda o alerta sempre que a sessão é recarregada (ex: troca de plano
  // muda o teto) — nunca pede permissão sozinho, só quando o responsável
  // toca no botão. Playground avisa nos últimos 5 min; Circuito avisa no
  // minuto definido pela tabela (ver copyCircuito.ts).
  useEffect(() => {
    // Com o Web Push ativo, o alerta já foi agendado no servidor — o
    // setTimeout local viraria uma segunda notificação (e uma que só
    // dispara se a aba continuar aberta, o problema original).
    if (!lembreteAtivo || pushAtivo || !timing || timing.phase === "EXCEDENTE") return;
    const msAteAlerta = isCircuito
      ? circuitoConfig
        ? circuitoConfig.alertAtMinutes * 60_000 - timing.elapsedMs
        : null
      : timing.durationMs - timing.elapsedMs - 5 * 60_000;
    if (reminderTimeoutRef.current) window.clearTimeout(reminderTimeoutRef.current);
    if (msAteAlerta == null || msAteAlerta <= 0) return; // já está no aviso ou depois dele
    reminderTimeoutRef.current = window.setTimeout(() => {
      try {
        if (Notification.permission === "granted") {
          new Notification("Faça Amigos — falta pouco!", {
            body: "Dá uma olhadinha no painel para ver as opções de continuar aproveitando.",
          });
        }
      } catch {
        // Notification pode não existir (Safari antigo) — o banner na
        // própria página, abaixo, já cobre esse caso.
      }
    }, msAteAlerta);
    return () => {
      if (reminderTimeoutRef.current) window.clearTimeout(reminderTimeoutRef.current);
    };
  }, [lembreteAtivo, pushAtivo, timing, isCircuito, circuitoConfig]);

  async function ativarLembrete() {
    setLembreteErro(null);

    // Caminho principal: Web Push — o alerta chega mesmo com o app
    // fechado/o celular no bolso, porque quem dispara é o servidor
    // (fa_push_claim_due + cron), não uma aba aberta no navegador.
    if (isPushSupported()) {
      try {
        const permission = await Notification.requestPermission();
        if (permission === "granted") {
          const subscription = await subscribeToPush();
          const keys = subscription ? pushSubscriptionToKeys(subscription) : null;
          if (keys) {
            await registrarAcompanharPush(code, keys);
            setPushAtivo(true);
            setLembreteAtivo(true);
            await logAcompanharEvento(code, "LEMBRETE_ATIVADO", { via: "PUSH" }).catch(() => {});
            return;
          }
        }
      } catch {
        // Cai no fallback abaixo — ex.: subscribe falhou, VAPID ainda não
        // configurada no servidor, ou permissão negada.
      }
    }

    // Fallback: notificação só funciona com a página aberta (Safari fora
    // do modo instalado, navegador sem suporte a Push, ou falha acima).
    try {
      if (!("Notification" in window)) {
        setLembreteErro("Este navegador não avisa automaticamente — deixe a página aberta para acompanhar por aqui.");
        setLembreteAtivo(true);
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setLembreteErro("Sem permissão de notificação — deixe a página aberta para acompanhar por aqui.");
      } else {
        setLembreteErro(
          "Este navegador não avisa em segundo plano — no iPhone, toque em Compartilhar → Adicionar à Tela de Início para receber o aviso mesmo com o app fechado. Por enquanto, deixe a página aberta.",
        );
      }
      setLembreteAtivo(true);
      await logAcompanharEvento(code, "LEMBRETE_ATIVADO", { via: "PAGINA_ABERTA" }).catch(() => {});
    } catch {
      setLembreteErro("Não deu para ativar o lembrete agora — deixe a página aberta para acompanhar por aqui.");
    }
  }

  async function pedirRenovacao(minutes: number, cents?: number) {
    setRenovacaoPedida(minutes);
    try {
      await logAcompanharEvento(code, "RENOVACAO_SOLICITADA", { minutes, cents, requestedAtMs: Date.now() });
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
          activity={sessao.activity}
          assetKind={sessao.plan.assetKind}
          timing={timing}
          isPausada={sessao.status === "PAUSADA"}
          lembreteAtivo={lembreteAtivo}
          pushAtivo={pushAtivo}
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
  activity,
  assetKind,
  timing,
  isPausada,
  lembreteAtivo,
  pushAtivo,
  lembreteErro,
  onAtivarLembrete,
  renovacaoPedida,
  onPedirRenovacao,
}: {
  childFirstName: string;
  sensoryTags: string[];
  activity: "PLAYGROUND" | "CARRINHO";
  assetKind: CircuitoAssetKind | null;
  timing: SessionTiming;
  isPausada: boolean;
  lembreteAtivo: boolean;
  pushAtivo: boolean;
  lembreteErro: string | null;
  onAtivarLembrete: () => void;
  renovacaoPedida: number | null;
  onPedirRenovacao: (minutes: number, cents?: number) => void;
}) {
  const phase = isPausada ? "PAUSADA" : timing.phase;
  const color = isPausada ? "var(--color-teal)" : PHASE_COLOR[timing.phase];
  const planDurationMinutes = Math.round(timing.durationMs / 60_000);
  const isCircuito = activity === "CARRINHO";
  const circuitoConfig = isCircuito ? getCircuitoAlertConfig(assetKind, planDurationMinutes) : null;

  const elapsedMinutes = Math.floor(timing.elapsedMs / 60_000);
  const showRenewal = isCircuito
    ? !isPausada && !!circuitoConfig && elapsedMinutes >= circuitoConfig.alertAtMinutes
    : !isPausada && (timing.phase === "VERMELHO" || timing.phase === "EXCEDENTE");

  const headline = isCircuito
    ? circuitoStatusHeadline(childFirstName, phase, assetKind ?? "CARRO")
    : statusHeadline(childFirstName, phase, sensoryTags);

  // Seleção sem envio imediato: o toque escolhe a opção, um segundo botão
  // ("Confirmar") de fato dispara onPedirRenovacao — evita clique acidental
  // vindo de um responsável distraído/celular no bolso, já que aqui não há
  // cobrança automática nenhuma envolvida, só um aviso pro balcão.
  const [selecionada, setSelecionada] = useState<{ minutes: number; cents: number } | null>(null);
  const [zoeOffers, setZoeOffers] = useState<MobileOffer[]>([]);

  useEffect(() => {
    generateMobileAcompanharSuggestions({
      childName: childFirstName,
      remainingMinutes: Math.max(0, planDurationMinutes - elapsedMinutes),
      elapsedMinutes,
      unitName: isCircuito ? "Circuito Parque Shopping" : "Playground Parque Shopping",
    }).then(setZoeOffers);
  }, [childFirstName, elapsedMinutes, planDurationMinutes, isCircuito]);

  return (
    <div style={{ width: "100%", maxWidth: 420, display: "flex", flexDirection: "column", gap: "16px" }}>
      <Card style={{ textAlign: "center", border: `2px solid ${color}` }}>
        <p style={{ margin: "0 0 8px", fontSize: "15px", color: "var(--text-muted)" }}>{headline}</p>
        <div style={{ fontFamily: "var(--font-display)", fontSize: "48px", color, lineHeight: 1 }}>
          {formatElapsed(timing.elapsedMs)}
        </div>
        <p style={{ margin: "12px 0 0", fontSize: "14px", color: "var(--text-muted)" }}>
          {timing.overMinutes > 0
            ? `${planDurationMinutes} min inclusos no pacote — ${money(timing.overCents)} adicionais até agora`
            : `${planDurationMinutes} min inclusos no pacote — ${money(0)} adicionais`}
        </p>
      </Card>

      {/* CARD ÚNICO ZOEIA — Mensagem Persuasiva & Subliminar para Venda Adicional / Prolongamento */}
      {zoeOffers.length > 0 && (() => {
        const topOffer = zoeOffers[0];
        if (!topOffer) return null;
        return (
          <Card
            style={{
              padding: "18px 20px",
              background: "linear-gradient(135deg, #f5f3ff 0%, #faf5ff 100%)",
              border: "1.5px solid #c084fc",
              borderRadius: "16px",
              display: "flex",
              flexDirection: "column",
              gap: "10px",
              boxShadow: "0 4px 14px rgba(124, 58, 237, 0.06)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span
                style={{
                  background: "linear-gradient(135deg, #7c3aed 0%, #2563eb 100%)",
                  color: "#ffffff",
                  fontWeight: "bold",
                  fontSize: "11px",
                  padding: "3px 10px",
                  borderRadius: "9999px",
                  letterSpacing: "0.5px",
                }}
              >
                ✦ DICA DA ZOEIA
              </span>
              {topOffer.badge && (
                <span style={{ fontSize: "11px", fontWeight: "bold", color: "#6b21a8", background: "#f3e8ff", padding: "2px 8px", borderRadius: "9999px" }}>
                  {topOffer.badge}
                </span>
              )}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <strong style={{ fontSize: "15px", color: "#4c1d95", lineHeight: 1.3 }}>
                {topOffer.title}
              </strong>
              <p style={{ margin: 0, fontSize: "13px", color: "#5b21b6", lineHeight: 1.5 }}>
                {topOffer.description}
              </p>
            </div>
          </Card>
        );
      })()}

      {!isPausada && !lembreteAtivo && timing.phase !== "EXCEDENTE" && (!isCircuito || circuitoConfig) && (
        <Button variant="secondary" onClick={onAtivarLembrete}>
          {isCircuito ? "🔔 Avisar quando chegar a hora de renovar" : "🔔 Avisar quando faltarem 5 minutos"}
        </Button>
      )}
      {lembreteAtivo && pushAtivo && (
        <HelpText>Aviso ativado — pode fechar o app e ir fazer suas coisas, a gente te avisa. 💛</HelpText>
      )}
      {lembreteAtivo && !pushAtivo && !lembreteErro && (
        <HelpText>Lembrete ativado — deixe esta página aberta para receber o aviso.</HelpText>
      )}
      {lembreteErro && <HelpText>{lembreteErro}</HelpText>}

      {showRenewal && isCircuito && circuitoConfig && (
        <Card>
          <p style={{ margin: "0 0 16px", fontSize: "15px" }}>{circuitoRenewalIntro(childFirstName)}</p>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {circuitoConfig.options.map((opt) => {
              const isSelected = selecionada?.minutes === opt.minutes;
              return (
                <div key={opt.minutes}>
                  <Button
                    variant={opt.highlight ? "primary" : "secondary"}
                    fullWidth
                    disabled={renovacaoPedida !== null}
                    style={isSelected ? { outline: "3px solid var(--color-teal)", outlineOffset: "2px" } : undefined}
                    onClick={() => setSelecionada(isSelected ? null : { minutes: opt.minutes, cents: opt.cents })}
                  >
                    {renovacaoPedida === opt.minutes
                      ? "Renovação solicitada! 💛"
                      : `${isSelected ? "✓ " : ""}+${opt.minutes} min — ${money(opt.cents)}`}
                    {opt.highlight ? " · recomendado" : ""}
                  </Button>
                  {opt.highlightMessage && (
                    <p style={{ margin: "6px 4px 0", fontSize: "12px", color: "var(--text-muted)" }}>{opt.highlightMessage}</p>
                  )}
                </div>
              );
            })}
          </div>
          {selecionada && renovacaoPedida === null && (
            <Button
              variant="teal"
              fullWidth
              style={{ marginTop: "10px" }}
              onClick={() => onPedirRenovacao(selecionada.minutes, selecionada.cents)}
            >
              Confirmar +{selecionada.minutes} min — {money(selecionada.cents)}
            </Button>
          )}
          <p style={{ margin: "16px 0 0", fontSize: "12px", color: "var(--text-muted)" }}>
            {circuitoAnchorMessage()} O valor é acertado com a equipe na retirada, no balcão — sem cobrança automática
            pelo celular.
          </p>
        </Card>
      )}

      {showRenewal && !isCircuito && (
        <Card>
          <p style={{ margin: "0 0 16px", fontSize: "15px" }}>{renewalIntro(planDurationMinutes, childFirstName)}</p>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {RENEWAL_OPTIONS.map((opt) => {
              const isSelected = selecionada?.minutes === opt.minutes;
              return (
                <div key={opt.minutes}>
                  <Button
                    variant={opt.highlight ? "primary" : "secondary"}
                    fullWidth
                    disabled={renovacaoPedida !== null}
                    style={isSelected ? { outline: "3px solid var(--color-teal)", outlineOffset: "2px" } : undefined}
                    onClick={() => setSelecionada(isSelected ? null : { minutes: opt.minutes, cents: opt.cents })}
                  >
                    {renovacaoPedida === opt.minutes
                      ? "Avisamos a recepção! 💛"
                      : `${isSelected ? "✓ " : ""}+${opt.minutes} min — ${money(opt.cents)}`}
                    {opt.highlight ? " · recomendado" : ""}
                  </Button>
                  {opt.highlight && (
                    <p style={{ margin: "6px 4px 0", fontSize: "12px", color: "var(--text-muted)" }}>
                      {renewalHighlightAnchor(planDurationMinutes)}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
          {selecionada && renovacaoPedida === null && (
            <Button
              variant="teal"
              fullWidth
              style={{ marginTop: "10px" }}
              onClick={() => onPedirRenovacao(selecionada.minutes, selecionada.cents)}
            >
              Confirmar +{selecionada.minutes} min — {money(selecionada.cents)}
            </Button>
          )}
          <p style={{ margin: "16px 0 0", fontSize: "12px", color: "var(--text-muted)" }}>
            Sem pressa: no balcão, o minuto avulso sai a {money(OVERAGE_RATE_CENTS_PER_MINUTE)} — renovar agora garante o
            valor combinado. O valor é acertado com a equipe no balcão, sem cobrança automática pelo celular.
          </p>
        </Card>
      )}
    </div>
  );
}
