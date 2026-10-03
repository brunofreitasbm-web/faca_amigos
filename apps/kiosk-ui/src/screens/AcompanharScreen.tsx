import { useEffect, useRef } from "react";
import type { SessionTiming } from "@facaamigos/domain";
import { money } from "@facaamigos/domain";
import { Card, BrandLockup, HelpText } from "@facaamigos/ui";
import { useAcompanhar } from "../api/useAcompanhar.js";
import { formatElapsed } from "../format.js";
import { logAcompanharEvento } from "../api/acompanhar.js";
import { statusHeadline } from "./acompanhar/copy.js";
import { circuitoStatusHeadline, type CircuitoAssetKind } from "./acompanhar/copyCircuito.js";
import { MapeamentoBanner } from "./acompanhar/MapeamentoBanner.js";
import { FidelidadeBannerCard } from "./acompanhar/FidelidadeBannerCard.js";
import { OfertaCard } from "./acompanhar/OfertaCard.js";
import { ofertaParaSessao } from "./acompanhar/ofertaSite.js";
import { RenovarCard } from "./acompanhar/RenovarCard.js";
import { opcoesDeRenovacao } from "./acompanhar/renovarSite.js";

/**
 * Painel público do responsável — aberto sem login pelo QR mostrado no
 * check-in (ver EntradaScreen). Fora do fluxo de autenticação (mesmo
 * espírito de OnboardingInviteScreen): vive num branch de App.tsx que
 * roda antes de qualquer checagem de sessão salva.
 *
 * Só acompanha o tempo. O aviso de fim de plano e a oferta de renovação
 * saíram daqui e passaram a ser enviados por WhatsApp pelo CRM
 * (crm-renewal-alert-dispatch), como o NPS.
 */
export function AcompanharScreen({ code }: { code: string }) {
  const { status, sessao, timing, errorMessage } = useAcompanhar(code);
  const qrAbertoLogged = useRef(false);

  useEffect(() => {
    if (qrAbertoLogged.current || status !== "ready" || !sessao) return;
    if (sessao.status === "ATIVA" || sessao.status === "PAUSADA") {
      qrAbertoLogged.current = true;
      logAcompanharEvento(code, "QR_ABERTO").catch(() => {});
    }
  }, [status, sessao, code]);


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
          childVisitCount={sessao.childVisitCount}
          sensoryTags={sessao.sensoryTags}
          activity={sessao.activity}
          assetKind={sessao.plan.assetKind}
          timing={timing}
          isPausada={sessao.status === "PAUSADA"}
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
  childVisitCount = 8,
  sensoryTags,
  activity,
  assetKind,
  timing,
  isPausada,
}: {
  childFirstName: string;
  childVisitCount?: number;
  sensoryTags: string[];
  activity: "PLAYGROUND" | "CARRINHO";
  assetKind: CircuitoAssetKind | null;
  timing: SessionTiming;
  isPausada: boolean;
}) {
  const phase = isPausada ? "PAUSADA" : timing.phase;
  const color = isPausada ? "var(--color-teal)" : PHASE_COLOR[timing.phase];
  const planDurationMinutes = Math.round(timing.durationMs / 60_000);
  const isCircuito = activity === "CARRINHO" || assetKind === "PELUCIA";

  const headline = isCircuito
    ? circuitoStatusHeadline(childFirstName, phase, assetKind ?? "CARRO")
    : statusHeadline(childFirstName, phase, sensoryTags);

  const renovar = opcoesDeRenovacao({
    activity,
    isPausada,
    childFirstName,
    remainingMs: timing.durationMs - timing.elapsedMs,
  });

  const oferta = ofertaParaSessao({
    activity,
    isPausada,
    childFirstName,
    childVisitCount,
    planDurationMinutes,
    remainingMs: timing.durationMs - timing.elapsedMs,
    nowMs: Date.now(),
  });

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

      {/* Renovação pelo WhatsApp, nos últimos 15 min do plano ou no excedente. O botão abre o WhatsApp do CRM com o pedido escrito. */}
      {renovar && <RenovarCard childFirstName={childFirstName} opcoes={renovar} />}

      {/* Oferta de produto, só nos últimos 15 min do plano (ou no excedente); o botão abre o WhatsApp do CRM. */}
      {oferta && <OfertaCard oferta={oferta} />}

      {/* Card do Programa de Fidelidade com visual do progresso de visitas */}
      <FidelidadeBannerCard childFirstName={childFirstName} visitCount={childVisitCount} />

      {/* Convite discreto ao Mapeamento Comportamental do Instituto — sempre
          abaixo do bloco de tempo, nunca sobrepondo. Ver MapeamentoBanner:
          some nos últimos 5 min e lembra a dispensa. */}
      <MapeamentoBanner timing={timing} isPausada={isPausada} />
    </div>
  );
}
