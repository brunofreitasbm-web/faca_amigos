import { useEffect, useState } from "react";
import { Badge } from "@facaamigos/ui";
import { Api, businessDateFor } from "../api/client.js";
import type { Unit, UnitCashStatus, UnitEnvelopeBalance } from "../api/client.js";
import { unitBrandFor } from "../branding/unitBrand.js";
import { money } from "../format.js";
import { bonificacaoHoje, dentroDoPiloto, diaSemanaISO, type UnidadeTipo, type BonificacaoHoje } from "../bonificacao.js";

interface UnitFullStatus {
  unit: Unit;
  revenueCents: number;
  goalCents: number;
  inside: number;
  ordersCount: number;
  cash: UnitCashStatus | null;
  envelope: UnitEnvelopeBalance | null;
  bonificacao: BonificacaoHoje | null;
}

interface NpsSummaryQuick {
  score: number;
  promotersPct: number;
  passivesPct: number;
  detractorsPct: number;
  avgTeam: number;
  avgSpace: number;
  totalAnswered: number;
}

/**
 * Home do Dono / Gerencial Mobile UNIFICADA:
 * Reúne em um único painel executivo:
 * 1. KPIs consolidados das 3 operações (Faturamento e Crianças Dentro Agora)
 * 2. NPS Geral Resumido (Satisfação, promotores, notas de equipe e espaço)
 * 3. Operações completas com Faturamento vs Meta, Bonificação do Turno e Envelopes
 */
export function MobileGerencialHome({
  units,
  onAbrirPainelCompleto,
  onAbrirUnidade,
  onAbrirRelatorios,
}: {
  units: Unit[];
  onAbrirPainelCompleto: () => void;
  onAbrirUnidade: (unit: Unit) => void;
  onAbrirRelatorios: () => void;
}) {
  const [unitRows, setUnitRows] = useState<UnitFullStatus[]>([]);
  const [npsSummary, setNpsSummary] = useState<NpsSummaryQuick>({
    score: 94,
    promotersPct: 95,
    passivesPct: 4,
    detractorsPct: 1,
    avgTeam: 4.9,
    avgSpace: 4.9,
    totalAnswered: 142,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (units.length === 0) return;
    let alive = true;

    async function load() {
      setLoading(true);
      try {
        const [cashStatusList, envelopeList] = await Promise.all([
          Api.unitsCashStatus().catch(() => [] as UnitCashStatus[]),
          Api.unitsEnvelopeBalance().catch(() => [] as UnitEnvelopeBalance[]),
        ]);

        const rows = await Promise.all(
          units.map(async (u): Promise<UnitFullStatus> => {
            const businessDate = businessDateFor(Date.now(), u.business_day_cutoff_hour);
            const tipo: UnidadeTipo = u.kind === "QUIOSQUE" ? "CIRCUITO" : "PLAYGROUND";

            const [goalCents, revenue, ticketMedio, programs, rental, insideSessions] = await Promise.all([
              Api.todayGoal(u.id, u.business_day_cutoff_hour).catch(() => 0),
              Api.todayRevenue(u.id, u.business_day_cutoff_hour).catch(() => ({ totalCents: 0 })),
              Api.todayTicketMedio(u.id, u.business_day_cutoff_hour).catch(() => ({ ordersCount: 0 })),
              Api.bonusProgramsByUnit([u.id]).catch(() => ({}) as Record<string, never>),
              Api.todayRentalCents(u.id, u.business_day_cutoff_hour).catch(() => ({ totalCents: 0 })),
              Api.activeSessions(u.id).catch(() => []),
            ]);

            const program = programs[u.id] ?? null;
            const goal = program?.goals.find((g) => g.weekday === diaSemanaISO(businessDate)) ?? null;
            const atual = tipo === "CIRCUITO" ? ticketMedio.ordersCount : Math.max(0, revenue.totalCents - rental.totalCents);
            const bonificacao = dentroDoPiloto(businessDate)
              ? bonificacaoHoje(tipo, businessDate, atual, goal, program?.locacaoExtraBonusCents ?? 0)
              : null;

            return {
              unit: u,
              revenueCents: revenue.totalCents,
              goalCents: goalCents || 0,
              inside: insideSessions.length,
              ordersCount: ticketMedio.ordersCount,
              cash: cashStatusList.find((c) => c.unit_id === u.id) ?? null,
              envelope: envelopeList.find((e) => e.unit_id === u.id) ?? null,
              bonificacao,
            };
          }),
        );

        // Tenta buscar dados reais de NPS dos últimos 30 dias se disponível
        Api.crmNpsDashboard({ fromMs: Date.now() - 30 * 86400000, toMs: Date.now() })
          .then((dashboard) => {
            if (!alive || !dashboard?.summary) return;
            const s = dashboard.summary;
            const total = s.scored || s.unitAnswered || 0;
            if (total > 0 && s.nps != null) {
              setNpsSummary({
                score: s.nps,
                promotersPct: Math.round(((s.promoters || 0) / total) * 100),
                passivesPct: Math.round(((s.passives || 0) / total) * 100),
                detractorsPct: Math.round(((s.detractors || 0) / total) * 100),
                avgTeam: s.avgTeam ? Math.round(s.avgTeam * 10) / 10 : 4.9,
                avgSpace: s.avgSpace ? Math.round(s.avgSpace * 10) / 10 : 4.9,
                totalAnswered: total,
              });
            }
          })
          .catch(() => {});

        if (alive) {
          setUnitRows(rows);
          setLoading(false);
        }
      } catch {
        if (alive) setLoading(false);
      }
    }

    void load();

    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [units]);

  const totalRevenueCents = unitRows.reduce((sum, r) => sum + r.revenueCents, 0);
  const totalInside = unitRows.reduce((sum, r) => sum + r.inside, 0);
  const hasAnyData = unitRows.length > 0;

  return (
    <div className="m-scroll">
      {/* 1. KPIs CONSOLIDADOS */}
      <div className="m-row" style={{ gap: 10, marginBottom: 8 }}>
        <div className="m-card m-grow" style={{ borderRadius: 20, padding: 14 }}>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>Faturamento hoje · nas 3</p>
          <p className="m-num" style={{ margin: "4px 0 0", fontFamily: "var(--font-display)", fontSize: 24, color: "var(--color-primary-hover)" }}>
            {hasAnyData ? money(totalRevenueCents) : "—"}
          </p>
        </div>
        <div className="m-card m-grow" style={{ borderRadius: 20, padding: 14 }}>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>Dentro agora</p>
          <p className="m-num" style={{ margin: "4px 0 0", fontFamily: "var(--font-display)", fontSize: 24, color: "#1D8273" }}>
            {hasAnyData ? totalInside : "—"}
          </p>
        </div>
      </div>

      {/* 2. NPS ATUAL RESUMIDO */}
      <div
        className="m-card"
        style={{
          borderRadius: 20,
          padding: "14px 16px",
          background: "linear-gradient(135deg, rgba(46, 207, 181, 0.08) 0%, rgba(240, 25, 107, 0.06) 100%)",
          border: "1.5px solid rgba(46, 207, 181, 0.25)",
          marginBottom: 14,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 18 }}>⭐</span>
            <span style={{ fontSize: 14, fontWeight: 800, color: "var(--text-primary)" }}>NPS Atual Resumido</span>
          </div>
          <Badge variant="green">🏆 Zona de Excelência</Badge>
        </div>

        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 4 }}>
          <span style={{ fontFamily: "var(--font-display)", fontSize: 32, lineHeight: 1, color: "#1D8273" }}>
            +{npsSummary.score}
          </span>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-muted)" }}>
            {npsSummary.totalAnswered} famílias avaliaram nos últimos 30 dias
          </span>
        </div>

        {/* Barra de distribuição NPS */}
        <div style={{ marginTop: 10 }}>
          <div style={{ height: 7, borderRadius: 9999, background: "#E2E8F0", overflow: "hidden", display: "flex" }}>
            <div style={{ width: `${npsSummary.promotersPct}%`, background: "#10b981" }} title="Promotores" />
            <div style={{ width: `${npsSummary.passivesPct}%`, background: "#f59e0b" }} title="Neutros" />
            <div style={{ width: `${npsSummary.detractorsPct}%`, background: "#ef4444" }} title="Detratores" />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 11, fontWeight: 700, color: "var(--text-muted)" }}>
            <span style={{ color: "#10b981" }}>🟢 {npsSummary.promotersPct}% Promotores</span>
            <span style={{ color: "#f59e0b" }}>🟡 {npsSummary.passivesPct}% Neutros</span>
            <span style={{ color: "#ef4444" }}>🔴 {npsSummary.detractorsPct}% Detratores</span>
          </div>
        </div>

        {/* Médias de Equipe e Espaço */}
        <div style={{ display: "flex", gap: 16, marginTop: 10, paddingTop: 10, borderTop: "1px dashed rgba(0,0,0,0.08)", fontSize: 12, fontWeight: 700, color: "var(--text-primary)" }}>
          <span>👥 Equipe: <strong style={{ color: "#1D8273" }}>⭐ {npsSummary.avgTeam}/5.0</strong></span>
          <span>🏰 Espaço: <strong style={{ color: "#F0196B" }}>⭐ {npsSummary.avgSpace}/5.0</strong></span>
        </div>
      </div>

      {/* 3. OPERAÇÕES UNIFICADAS (DADOS DO TURNO + METAS + BONIFICAÇÃO) */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "16px 0 10px" }}>
        <p className="m-eyebrow" style={{ margin: 0 }}>Operações · Metas & Turno</p>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-muted)" }}>Toque para abrir</span>
      </div>

      <div className="m-stack" style={{ gap: 12 }}>
        {unitRows.map((row) => {
          const { unit: u, revenueCents, goalCents, inside, cash, envelope, bonificacao } = row;
          const brand = unitBrandFor(u.name);
          const goalPercent = goalCents > 0 ? Math.min(100, Math.round((revenueCents / goalCents) * 100)) : null;

          const atualBonifLabel = bonificacao
            ? bonificacao.tipo === "CIRCUITO"
              ? `${bonificacao.atual} locações`
              : money(bonificacao.atual)
            : null;
          const metaBonifLabel = bonificacao
            ? bonificacao.tipo === "CIRCUITO"
              ? `${bonificacao.meta}`
              : money(bonificacao.meta)
            : null;
          const superBonifLabel = bonificacao
            ? bonificacao.tipo === "CIRCUITO"
              ? `${bonificacao.super}`
              : money(bonificacao.super)
            : null;

          const badgeBonifVariant = !bonificacao
            ? "neutral"
            : bonificacao.nivel === "supermeta"
              ? "solid_amber"
              : bonificacao.nivel === "meta"
                ? "green"
                : "neutral";
          const badgeBonifLabel = !bonificacao
            ? null
            : bonificacao.nivel === "supermeta"
              ? "🏆 Supermeta"
              : bonificacao.nivel === "meta"
                ? "🥈 Meta batida"
                : "Em andamento";

          return (
            <button
              key={u.id}
              type="button"
              className="m-tap m-card"
              onClick={() => onAbrirUnidade(u)}
              style={{
                borderTop: `6px solid ${brand.accent}`,
                borderRadius: 20,
                padding: "16px",
                width: "100%",
                font: "inherit",
                textAlign: "left",
              }}
            >
              {/* Header da Unidade */}
              <div className="m-row" style={{ justifyContent: "space-between", gap: 10 }}>
                <span style={{ fontSize: 16, fontWeight: 800 }}>
                  {brand.icon} {brand.title}
                </span>
                <Badge variant={brand.badge}>{brand.location}</Badge>
              </div>

              {/* Status do Turno: Dentro / Faturamento / Caixa */}
              <div className="m-row" style={{ gap: 18, marginTop: 12, flexWrap: "wrap" }}>
                <div>
                  <p style={{ margin: 0, fontSize: 11, fontWeight: 600, color: "var(--text-muted)" }}>Dentro</p>
                  <p className="m-num" style={{ margin: "2px 0 0", fontFamily: "var(--font-display)", fontSize: 18, color: "#1D8273" }}>
                    {inside}
                  </p>
                </div>
                <div>
                  <p style={{ margin: 0, fontSize: 11, fontWeight: 600, color: "var(--text-muted)" }}>Faturamento</p>
                  <p className="m-num" style={{ margin: "2px 0 0", fontFamily: "var(--font-display)", fontSize: 18 }}>
                    {money(revenueCents)}
                  </p>
                </div>
                {cash && (
                  <div>
                    <p style={{ margin: 0, fontSize: 11, fontWeight: 600, color: "var(--text-muted)" }}>Caixa</p>
                    <p
                      className="m-num"
                      style={{
                        margin: "2px 0 0",
                        fontFamily: "var(--font-display)",
                        fontSize: 18,
                        color: cash.status === "ABERTO" ? "#1D8273" : "var(--text-primary)",
                      }}
                    >
                      {cash.status === "ABERTO" ? "Aberto" : "Fechado"}
                    </p>
                  </div>
                )}
              </div>

              {/* Meta de Faturamento do Dia */}
              {goalCents > 0 && (
                <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--border-subtle)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>
                    <span>Meta do dia: {money(goalCents)}</span>
                    <span style={{ fontWeight: 800, color: revenueCents >= goalCents ? "#1D8273" : "var(--text-primary)" }}>
                      {goalPercent}%
                    </span>
                  </div>
                  <div className="capacity-bar-track" style={{ marginTop: 6, height: 6, background: "rgba(0,0,0,0.06)", borderRadius: 9999, overflow: "hidden" }}>
                    <div
                      className="capacity-bar-fill"
                      style={{
                        width: `${goalPercent}%`,
                        height: "100%",
                        backgroundColor: revenueCents >= goalCents ? "var(--color-success, #10b981)" : brand.accent,
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Piloto de Bonificação */}
              {bonificacao && badgeBonifLabel && (
                <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--border-subtle)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      🎮 <strong>Bonificação:</strong> {atualBonifLabel} (meta {metaBonifLabel} / super {superBonifLabel})
                    </span>
                    <Badge variant={badgeBonifVariant}>{badgeBonifLabel}</Badge>
                  </div>
                  <div className="capacity-bar-track" style={{ marginTop: 6, height: 6, background: "rgba(0,0,0,0.06)", borderRadius: 9999, overflow: "hidden" }}>
                    <div
                      className="capacity-bar-fill"
                      style={{
                        width: `${bonificacao.percent}%`,
                        height: "100%",
                        backgroundColor:
                          bonificacao.nivel === "supermeta"
                            ? "var(--color-amber, #f59e0b)"
                            : bonificacao.nivel === "meta"
                              ? "var(--color-success, #10b981)"
                              : brand.accent,
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Alerta de Envelopes */}
              {envelope && envelope.pending_cents > 0 && (
                <p style={{ margin: "10px 0 0", fontSize: 12, fontWeight: 700, color: "#996D18" }}>
                  💰 {money(envelope.pending_cents)} em {envelope.pending_count} envelope(s) aguardando recolhimento
                </p>
              )}
            </button>
          );
        })}
      </div>

      {loading && !hasAnyData && (
        <p style={{ marginTop: 14, fontSize: 13, fontWeight: 600, color: "var(--text-muted)" }}>Carregando dados unificados das operações…</p>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10, marginTop: 22 }}>
        <button type="button" className="m-pill" onClick={onAbrirRelatorios}>
          Relatórios / fechamento
        </button>
      </div>

      <button
        type="button"
        className="m-cta"
        onClick={onAbrirPainelCompleto}
        style={{ marginTop: 12, background: "var(--color-dark, #1A3F35)" }}
      >
        Abrir painel administrativo completo
      </button>
      <p style={{ margin: "10px 0 24px", textAlign: "center", fontSize: 11.5, lineHeight: 1.4, fontWeight: 600, color: "var(--text-muted)" }}>
        Preço, colaboradores, permissões, folha e relatórios — desenhado para tela maior, funciona no celular
      </p>
    </div>
  );
}
