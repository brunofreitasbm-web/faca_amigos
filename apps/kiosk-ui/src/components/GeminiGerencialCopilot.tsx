import { useEffect, useState } from "react";
import { Card, Tag } from "@facaamigos/ui";
import { useAppState } from "../state/AppState.js";
import { Api } from "../api/client.js";
import type { Unit } from "../api/client.js";
import { money } from "../format.js";
import {
  generateGerencialReport,
  ZOEIA_DATA_START_DATE,
  clampToZoeiaDataStart,
  type GerencialReport,
} from "../lib/geminiAgent.js";

interface GeminiGerencialCopilotProps {
  metricsSummary?: string;
}

export const OFFICIAL_UNITS = [
  { id: "TODAS", name: "Rede Consolidada (3 Unidades)", badge: "🌐 Visão Geral" },
  { id: "Circuito", name: "Circuito", badge: "🏎️ Circuito Parque" },
  { id: "Playground (Parque Shopping)", name: "Playground (Parque Shopping)", badge: "🎪 Playground Parque" },
  { id: "Playground (Grão-Pará)", name: "Playground (Grão-Pará)", badge: "🎡 Playground Grão-Pará" },
] as const;

function normalizeUnitText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Os ids de `OFFICIAL_UNITS` são rótulos de exibição, não o `id` real da
 * unidade no Supabase — o nome cadastrado varia (ex.: "Faça Amigos
 * Playground (Parque Shopping)", "Circuito (Parque Shopping)"). Resolve por
 * correspondência de texto (mesmo padrão de cross-sell em geminiAgent.ts)
 * em vez de igualdade exata, que quebraria a qualquer ajuste de nome.
 */
function resolveUnitId(selectedUnitLabel: string, units: Unit[]): string | null {
  if (selectedUnitLabel === "TODAS") return null;
  const label = normalizeUnitText(selectedUnitLabel);
  if (label.includes("circuito")) {
    return units.find((u) => normalizeUnitText(u.name).includes("circuito"))?.id ?? null;
  }
  if (label.includes("grao-para") || label.includes("grao para") || label.includes("graopara")) {
    return (
      units.find((u) => {
        const n = normalizeUnitText(u.name);
        return n.includes("grao-para") || n.includes("grao para") || n.includes("bosque");
      })?.id ?? null
    );
  }
  return (
    units.find((u) => {
      const n = normalizeUnitText(u.name);
      return n.includes("parque shopping") && !n.includes("circuito");
    })?.id ?? null
  );
}

function isoDateLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

interface RealMetrics {
  fromDate: string;
  toDate: string;
  totalCents: number;
  ordersCount: number;
  avgTicketCents: number;
  totalVisits: number;
  topPlans: { name: string; count: number }[];
  byMethod: { method: string; totalCents: number }[];
}

/** Busca o faturamento, visitas e planos vendidos REAIS (Supabase) no período — nunca dados fictícios. */
async function fetchRealMetrics(unitId: string | null, from: string, to: string): Promise<RealMetrics> {
  const [sales, visits, plansSold] = await Promise.all([
    Api.reportSales(unitId, from, to),
    Api.reportVisits(unitId, from, to),
    Api.reportPlansSold(unitId, from, to),
  ]);
  const totalCents = sales.byDay.reduce((sum, d) => sum + d.total_cents, 0);
  const ordersCount = sales.byDay.reduce((sum, d) => sum + d.orders_count, 0);
  const totalVisits = visits.reduce((sum, v) => sum + v.sessions_count, 0);
  const topPlans = plansSold
    .slice()
    .sort((a, b) => b.sessions_count - a.sessions_count)
    .slice(0, 3)
    .map((p) => ({ name: p.plan_name, count: p.sessions_count }));
  const byMethod = sales.byMethod.map((m) => ({ method: m.method, totalCents: m.total_cents }));
  return {
    fromDate: from,
    toDate: to,
    totalCents,
    ordersCount,
    avgTicketCents: ordersCount > 0 ? Math.round(totalCents / ordersCount) : 0,
    totalVisits,
    topPlans,
    byMethod,
  };
}

function formatRealMetricsSummary(unitLabel: string, m: RealMetrics): string {
  if (m.ordersCount === 0 && m.totalVisits === 0) {
    return `Foco da Análise: ${unitLabel} | Período real analisado: ${m.fromDate} a ${m.toDate} | Nenhum dado real de vendas ou visitas registrado neste período — ainda não há base para projeções, não invente números.`;
  }
  const methodsText = m.byMethod.length
    ? m.byMethod.map((mm) => `${mm.method}: ${money(mm.totalCents)}`).join(", ")
    : "sem detalhamento por forma de pagamento";
  const topPlansText = m.topPlans.length
    ? m.topPlans.map((p) => `${p.name} (${p.count} sessões)`).join(", ")
    : "sem vendas de planos no período";

  return [
    `Foco da Análise: ${unitLabel}`,
    `Período real analisado: ${m.fromDate} a ${m.toDate} (dados reais; nada anterior a ${ZOEIA_DATA_START_DATE})`,
    `Faturamento total do período: ${money(m.totalCents)}`,
    `Pedidos pagos: ${m.ordersCount}`,
    `Ticket médio: ${money(m.avgTicketCents)}`,
    `Total de visitas (sessões): ${m.totalVisits}`,
    `Planos mais vendidos: ${topPlansText}`,
    `Faturamento por forma de pagamento: ${methodsText}`,
  ].join(" | ");
}

export function GeminiGerencialCopilot({ metricsSummary }: GeminiGerencialCopilotProps) {
  const { unit, units } = useAppState();
  const [selectedUnit, setSelectedUnit] = useState<string>(unit?.name || "TODAS");
  const [report, setReport] = useState<GerencialReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [realMetricsSummary, setRealMetricsSummary] = useState<string | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(false);

  // Sem `metricsSummary` explícito (uso padrão no painel), busca os números
  // reais no Supabase em vez de usar dados fictícios — só o período a
  // partir de ZOEIA_DATA_START_DATE (28/08/2026), quando o histórico de
  // teste foi limpo e o caixa passou a refletir a operação real.
  useEffect(() => {
    if (metricsSummary) return;
    let active = true;
    setMetricsLoading(true);
    const to = isoDateLocal(new Date());
    const from = clampToZoeiaDataStart(isoDateLocal(new Date(Date.now() - 30 * 86_400_000)));
    const unitId = resolveUnitId(selectedUnit, units);
    const unitLabel = OFFICIAL_UNITS.find((u) => u.id === selectedUnit)?.name ?? selectedUnit;
    fetchRealMetrics(unitId, from, to)
      .then((m) => {
        if (active) setRealMetricsSummary(formatRealMetricsSummary(unitLabel, m));
      })
      .catch(() => {
        if (active) {
          setRealMetricsSummary(
            `Foco da Análise: ${unitLabel} | Não foi possível carregar os dados reais do período (${from} a ${to}) agora — tente novamente em instantes.`,
          );
        }
      })
      .finally(() => {
        if (active) setMetricsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [metricsSummary, selectedUnit, units]);

  const activeMetricsContext = metricsSummary || realMetricsSummary;

  useEffect(() => {
    if (!activeMetricsContext) return;
    let active = true;
    setLoading(true);
    generateGerencialReport(activeMetricsContext, selectedUnit)
      .then((res) => {
        if (active) setReport(res);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [activeMetricsContext, selectedUnit]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      {/* Seletor de Unidades Oficiais da Rede */}
      <section
        aria-label="Filtro de Unidades para Análise da ZoeIA"
        style={{
          background: "var(--surface-card, #ffffff)",
          border: "1px solid var(--border-subtle, #e2e8f0)",
          borderRadius: "16px",
          padding: "14px 18px",
          display: "flex",
          flexDirection: "column",
          gap: "10px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px" }}>
          <strong style={{ fontSize: "14px", color: "var(--text-primary)" }}>
            🏢 Selecionar Unidade para Análise Estratégica da ZoeIA:
          </strong>
          <span style={{ fontSize: "12px", color: "var(--text-muted)", fontStyle: "italic" }}>
            3 Unidades da Rede FaçaAmigos
          </span>
        </div>

        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {OFFICIAL_UNITS.map((u) => {
            const isSelected = selectedUnit === u.id || (u.id === "TODAS" && selectedUnit === "TODAS");
            return (
              <button
                key={u.id}
                type="button"
                onClick={() => setSelectedUnit(u.id)}
                aria-pressed={isSelected}
                style={{
                  padding: "8px 16px",
                  borderRadius: "9999px",
                  border: isSelected ? "2px solid #7c3aed" : "1px solid var(--border-subtle, #cbd5e1)",
                  background: isSelected ? "linear-gradient(135deg, rgba(124, 58, 237, 0.12) 0%, rgba(37, 99, 235, 0.12) 100%)" : "var(--surface-card, #ffffff)",
                  color: isSelected ? "#6d28d9" : "var(--text-primary)",
                  fontWeight: isSelected ? "bold" : "500",
                  fontSize: "13px",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <span>{u.badge}</span>
                {isSelected && <span>✓</span>}
              </button>
            );
          })}
        </div>
      </section>

      {/* Banner de Cabeçalho Gerencial */}
      <section
        style={{
          background: "linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)",
          color: "#ffffff",
          borderRadius: "18px",
          padding: "24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "16px",
          boxShadow: "0 10px 25px rgba(49, 46, 129, 0.2)",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
            <span
              style={{
                background: "linear-gradient(135deg, #7c3aed 0%, #2563eb 100%)",
                color: "#ffffff",
                fontWeight: "bold",
                fontSize: "12px",
                padding: "4px 12px",
                borderRadius: "9999px",
                letterSpacing: "0.5px",
              }}
            >
              ✦ ZOEIA — DIREÇÃO COMERCIAL
            </span>
            <span style={{ fontSize: "12px", color: "#4ade80", fontWeight: "600" }}>
              ● Análise Ativa ({selectedUnit === "TODAS" ? "Rede Consolidada" : selectedUnit})
            </span>
          </div>
          <h2 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: "24px", color: "#ffffff" }}>
            Painel Estratégico & Desempenho Operacional
          </h2>
          <p style={{ margin: "6px 0 0 0", color: "#c7d2fe", fontSize: "14px", maxWidth: "650px" }}>
            Projeções de receita, pontos de atenção, mapa de eficiência dos colaboradores e plano de ação diário elaborado pela ZoeIA.
          </p>
        </div>
      </section>

      {(metricsLoading || loading) && (
        <Card style={{ padding: "24px", textAlign: "center", fontStyle: "italic", color: "var(--text-muted)" }}>
          {metricsLoading
            ? "ZoeIA carregando os dados reais de faturamento e visitas da unidade..."
            : "ZoeIA analisando métricas, projeções e eficiência dos operadores da unidade..."}
        </Card>
      )}

      {report && !loading && !metricsLoading && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "20px" }}>
          {/* CARD 1: Projeções de Faturamento & Como Aumentar */}
          <Card style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "14px", borderTop: "4px solid #3b82f6" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <strong style={{ fontSize: "16px", color: "#1e3a8a" }}>📈 Projeção & Metas de Receita</strong>
              <Tag style={{ background: "#eff6ff", color: "#1d4ed8", fontWeight: "bold" }}>Faturamento</Tag>
            </div>

            <div style={{ background: "#f0f9ff", borderRadius: "12px", padding: "12px", border: "1px solid #bae6fd" }}>
              <p style={{ margin: 0, fontSize: "13px", color: "#0369a1", fontWeight: "bold" }}>
                {report.projections.forecastText}
              </p>
              <p style={{ margin: "4px 0 0 0", fontSize: "12px", color: "#0284c7" }}>
                {report.projections.targetText}
              </p>
            </div>

            <div>
              <strong style={{ fontSize: "13px", color: "#1e293b", display: "block", marginBottom: "8px" }}>
                🎯 Como Aumentar o Faturamento Hoje:
              </strong>
              <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "13px", color: "#475569", display: "flex", flexDirection: "column", gap: "6px" }}>
                {report.projections.howToIncrease.map((action, idx) => (
                  <li key={idx}>{action}</li>
                ))}
              </ul>
            </div>
          </Card>

          {/* CARD 2: Pontos de Atenção & Onde Melhorar */}
          <Card style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "14px", borderTop: "4px solid #f59e0b" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <strong style={{ fontSize: "16px", color: "#78350f" }}>⚠️ Pontos de Atenção & Gargalos</strong>
              <Tag style={{ background: "#fffbe6", color: "#b45309", fontWeight: "bold" }}>Atenção</Tag>
            </div>

            <div style={{ background: "#fff7ed", borderRadius: "12px", padding: "12px", border: "1px solid #ffedd5" }}>
              <strong style={{ fontSize: "13px", color: "#c2410c", display: "block" }}>Gargalo Identificado:</strong>
              <p style={{ margin: "2px 0 0 0", fontSize: "13px", color: "#9a3412" }}>
                {report.attentionPoints.issue}
              </p>
            </div>

            <div>
              <strong style={{ fontSize: "13px", color: "#1e293b", display: "block", marginBottom: "4px" }}>
                🛠️ Onde e Como Melhorar:
              </strong>
              <p style={{ margin: 0, fontSize: "13px", color: "#475569", lineHeight: 1.5 }}>
                {report.attentionPoints.whereToImprove}
              </p>
            </div>
          </Card>

          {/* CARD 3: Eficiência dos Operadores (Mais Eficiente vs Necessita Treino) */}
          <Card style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "14px", borderTop: "4px solid #10b981", gridColumn: "span 1" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <strong style={{ fontSize: "16px", color: "#065f46" }}>🏆 Desempenho & Eficiência do Time</strong>
              <Tag style={{ background: "#ecfdf5", color: "#047857", fontWeight: "bold" }}>Equipe</Tag>
            </div>

            {/* Operador Mais Eficiente */}
            <div style={{ background: "#f0fdf4", borderRadius: "12px", padding: "12px", border: "1px solid #bbf7d0" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <strong style={{ fontSize: "13px", color: "#15803d" }}>🥇 Operador Mais Eficiente:</strong>
                <span style={{ fontSize: "12px", fontWeight: "bold", color: "#166534" }}>
                  {report.operatorPerformance.topOperatorName}
                </span>
              </div>
              <p style={{ margin: "4px 0 0 0", fontSize: "12px", color: "#15803d" }}>
                Métrica: <strong>{report.operatorPerformance.topOperatorMetric}</strong>
              </p>
              <p style={{ margin: "2px 0 0 0", fontSize: "11px", color: "#166534", fontStyle: "italic" }}>
                Motivo: {report.operatorPerformance.topOperatorReason}
              </p>
            </div>

            {/* Operador em Desenvolvimento */}
            <div style={{ background: "#fef2f2", borderRadius: "12px", padding: "12px", border: "1px solid #fecaca" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <strong style={{ fontSize: "13px", color: "#b91c1c" }}>🎯 Operador que Precisa de Suporte:</strong>
                <span style={{ fontSize: "12px", fontWeight: "bold", color: "#991b1b" }}>
                  {report.operatorPerformance.needsTrainingOperatorName}
                </span>
              </div>
              <p style={{ margin: "4px 0 0 0", fontSize: "12px", color: "#b91c1c" }}>
                Métrica: <strong>{report.operatorPerformance.needsTrainingMetric}</strong>
              </p>
              <p style={{ margin: "2px 0 0 0", fontSize: "11px", color: "#991b1b", fontWeight: "600" }}>
                Ação Recomendada: {report.operatorPerformance.needsTrainingAction}
              </p>
            </div>
          </Card>

          {/* CARD 4: Plano de Ação Prático ZoeIA */}
          <Card style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "14px", borderTop: "4px solid #8b5cf6" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <strong style={{ fontSize: "16px", color: "#5b21b6" }}>📋 Plano de Ação Imediato da ZoeIA</strong>
              <Tag style={{ background: "#f3e8ff", color: "#7c3aed", fontWeight: "bold" }}>O que fazer</Tag>
            </div>

            <p style={{ margin: 0, fontSize: "13px", color: "#6b21a8", lineHeight: 1.4 }}>
              Siga estes passos acionáveis hoje para maximizar as vendas e engajar a equipe da {unit?.name || "unidade"}:
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {report.actionPlan.steps.map((step, idx) => (
                <div
                  key={idx}
                  style={{
                    padding: "10px 12px",
                    background: "#ffffff",
                    borderRadius: "10px",
                    border: "1px solid #e9d5ff",
                    fontSize: "13px",
                    color: "#4c1d95",
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "8px",
                  }}
                >
                  <strong style={{ color: "#7c3aed" }}>{idx + 1}.</strong>
                  <span>{step}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
