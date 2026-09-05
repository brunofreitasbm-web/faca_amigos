import { useEffect, useState } from "react";
import { Badge } from "@facaamigos/ui";
import { Api, businessDateFor } from "../api/client.js";
import type { Unit } from "../api/client.js";
import { unitBrandFor } from "../branding/unitBrand.js";
import { bonificacaoHoje, dentroDoPiloto, type UnidadeTipo } from "../bonificacao.js";
import { money } from "../format.js";

interface UnitOverview {
  unit: Unit;
  goalCents: number;
  revenueCents: number;
  ordersCount: number;
  bonificacao: ReturnType<typeof bonificacaoHoje> | null;
}

/**
 * Tela inicial padrão do Owner no celular — as 3 operações, faturamento vs
 * meta do dia e o placar do piloto de bonificação, tudo numa tela só.
 *
 * Diferente da Home do Gerencial (MobileGerencialHome, que é o ponto de
 * partida operacional dentro do modo Gerencial — dentro agora, caixa,
 * envelope — com atalhos de navegação), esta é só leitura: o Owner abre o
 * app, já vê os três números que importam pro dia e sai, sem nenhuma ação
 * de escrita. "Trocar de unidade" leva de volta à grade de módulos, de
 * onde ainda dá para entrar numa unidade específica ou no Gerencial.
 */
export function MobileOwnerOverview({ units, onTrocarUnidade }: { units: Unit[]; onTrocarUnidade: () => void }) {
  const [rows, setRows] = useState<UnitOverview[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (units.length === 0) return;
    let alive = true;

    async function load() {
      setLoading(true);
      const results = await Promise.all(
        units.map(async (unit): Promise<UnitOverview> => {
          const businessDate = businessDateFor(Date.now(), unit.business_day_cutoff_hour);
          const tipo: UnidadeTipo = unit.kind === "QUIOSQUE" ? "CIRCUITO" : "PLAYGROUND";
          const [goalCents, revenue, ticketMedio] = await Promise.all([
            Api.todayGoal(unit.id, unit.business_day_cutoff_hour).catch(() => 0),
            Api.todayRevenue(unit.id, unit.business_day_cutoff_hour).catch(() => ({ totalCents: 0 })),
            Api.todayTicketMedio(unit.id, unit.business_day_cutoff_hour).catch(() => ({ ordersCount: 0 })),
          ]);
          const atual = tipo === "CIRCUITO" ? ticketMedio.ordersCount : revenue.totalCents;
          return {
            unit,
            goalCents: goalCents || 0,
            revenueCents: revenue.totalCents,
            ordersCount: ticketMedio.ordersCount,
            bonificacao: dentroDoPiloto(businessDate) ? bonificacaoHoje(tipo, businessDate, atual) : null,
          };
        }),
      );
      if (alive) setRows(results);
      if (alive) setLoading(false);
    }

    load();
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [units]);

  return (
    <div className="m-shell">
      <div className="m-frame">
        <div className="m-navbar">
          <span className="m-title-sm m-grow">Visão geral · 3 unidades</span>
          <button
            type="button"
            onClick={onTrocarUnidade}
            style={{
              flexShrink: 0,
              border: "1px solid var(--color-gray-200)",
              borderRadius: 9999,
              background: "var(--surface-page)",
              color: "var(--text-primary)",
              fontSize: 12.5,
              fontWeight: 700,
              padding: "8px 14px",
            }}
          >
            Trocar de unidade
          </button>
        </div>

        <div className="m-scroll">
          <p style={{ margin: "0 0 14px", fontSize: 12.5, fontWeight: 600, color: "var(--text-muted)" }}>
            Só para consulta — faturamento e meta do dia, e o placar da bonificação. Nenhuma ação daqui muda dado nenhum.
          </p>

          {loading && rows.length === 0 && (
            <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text-muted)" }}>Carregando os números das 3 operações…</p>
          )}

          <div className="m-stack" style={{ gap: 12 }}>
            {rows.map(({ unit, goalCents, revenueCents, bonificacao }) => {
              const brand = unitBrandFor(unit.name);
              const goalPercent = goalCents > 0 ? Math.min(100, Math.round((revenueCents / goalCents) * 100)) : null;
              const atualLabel = bonificacao
                ? bonificacao.tipo === "CIRCUITO"
                  ? `${bonificacao.atual} locações`
                  : money(bonificacao.atual)
                : null;
              const metaLabel = bonificacao
                ? bonificacao.tipo === "CIRCUITO"
                  ? `${bonificacao.meta}`
                  : money(bonificacao.meta)
                : null;
              const superLabel = bonificacao
                ? bonificacao.tipo === "CIRCUITO"
                  ? `${bonificacao.super}`
                  : money(bonificacao.super)
                : null;
              const badgeVariant = !bonificacao
                ? "neutral"
                : bonificacao.nivel === "supermeta"
                  ? "solid_amber"
                  : bonificacao.nivel === "meta"
                    ? "green"
                    : "neutral";
              const badgeLabel = !bonificacao
                ? null
                : bonificacao.nivel === "supermeta"
                  ? "🏆 Supermeta"
                  : bonificacao.nivel === "meta"
                    ? "🥈 Meta batida"
                    : "Em andamento";

              return (
                <div key={unit.id} className="m-card" style={{ borderTop: `5px solid ${brand.accent}`, borderRadius: 20, padding: "15px 16px" }}>
                  <div className="m-row" style={{ justifyContent: "space-between", gap: 10 }}>
                    <span style={{ fontSize: 15.5, fontWeight: 800 }}>
                      {brand.icon} {brand.title}
                    </span>
                    <Badge variant={brand.badge}>{brand.location}</Badge>
                  </div>

                  <div style={{ marginTop: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>
                      <span>Faturamento hoje{goalCents > 0 ? ` / meta ${money(goalCents)}` : ""}</span>
                      <span>{money(revenueCents)}</span>
                    </div>
                    {goalPercent != null && (
                      <div className="capacity-bar-track" style={{ marginTop: 6 }}>
                        <div
                          className="capacity-bar-fill"
                          style={{
                            width: `${goalPercent}%`,
                            backgroundColor: revenueCents >= goalCents ? "var(--color-success)" : "var(--color-primary)",
                          }}
                        />
                      </div>
                    )}
                  </div>

                  {bonificacao && badgeLabel && (
                    <div style={{ marginTop: 12 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>
                        <span>
                          🎮 Bonificação: {atualLabel} (meta {metaLabel} / super {superLabel})
                        </span>
                        <Badge variant={badgeVariant}>{badgeLabel}</Badge>
                      </div>
                      <div className="capacity-bar-track" style={{ marginTop: 6 }}>
                        <div
                          className="capacity-bar-fill"
                          style={{
                            width: `${bonificacao.percent}%`,
                            backgroundColor:
                              bonificacao.nivel === "supermeta" ? "var(--color-amber)" : bonificacao.nivel === "meta" ? "var(--color-success)" : "var(--color-primary)",
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
