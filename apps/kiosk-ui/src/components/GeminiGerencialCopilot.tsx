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

export type PeriodFilter = "SINCE_AUG_29" | "LAST_7_DAYS" | "LAST_30_DAYS" | "CURRENT_MONTH";

function normalizeUnitText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

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
  onlyActiveEmployees: boolean;
}

/** Busca o faturamento, visitas e planos vendidos REAIS (Supabase) no período — nunca dados fictícios. */
async function fetchRealMetrics(unitId: string | null, from: string, to: string, onlyActive: boolean): Promise<RealMetrics> {
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
    onlyActiveEmployees: onlyActive,
  };
}

function formatRealMetricsSummary(unitLabel: string, m: RealMetrics): string {
  const activeConstraint = m.onlyActiveEmployees
    ? "FILTRO DE EQUIPE: Considerar EXCLUSIVAMENTE colaboradores com contrato ATIVO atualmente. NUNCA cite nem inclua ex-funcionários demitidos antes de 29/08/2026."
    : "FILTRO DE EQUIPE: Todos os registros cadastrados.";

  if (m.ordersCount === 0 && m.totalVisits === 0) {
    return `Foco da Análise: ${unitLabel} | Período real analisado: ${m.fromDate} a ${m.toDate} | ${activeConstraint} | Nenhum dado real de vendas ou visitas registrado neste período — ainda não há base para projeções, não invente números.`;
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
    activeConstraint,
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
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>("SINCE_AUG_29");
  const [onlyActiveEmployees, setOnlyActiveEmployees] = useState<boolean>(true);

  const [report, setReport] = useState<GerencialReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [realMetricsSummary, setRealMetricsSummary] = useState<string | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(false);

  useEffect(() => {
    if (metricsSummary) return;
    let active = true;
    setMetricsLoading(true);

    const now = new Date();
    const to = isoDateLocal(now);
    let from = ZOEIA_DATA_START_DATE;

    if (periodFilter === "LAST_7_DAYS") {
      from = clampToZoeiaDataStart(isoDateLocal(new Date(Date.now() - 7 * 86_400_000)));
    } else if (periodFilter === "LAST_30_DAYS") {
      from = clampToZoeiaDataStart(isoDateLocal(new Date(Date.now() - 30 * 86_400_000)));
    } else if (periodFilter === "CURRENT_MONTH") {
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      from = clampToZoeiaDataStart(isoDateLocal(firstDay));
    } else {
      // SINCE_AUG_29
      from = ZOEIA_DATA_START_DATE;
    }

    const unitId = resolveUnitId(selectedUnit, units);
    const unitLabel = OFFICIAL_UNITS.find((u) => u.id === selectedUnit)?.name ?? selectedUnit;

    fetchRealMetrics(unitId, from, to, onlyActiveEmployees)
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
  }, [metricsSummary, selectedUnit, periodFilter, onlyActiveEmployees, units]);

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
      {/* SEÇÃO DE FILTROS AVANÇADOS PARA ANÁLISE DA ZOEIA */}
      <section
        aria-label="Filtros de Análise para a ZoeIA"
        style={{
          background: "var(--surface-card, #ffffff)",
          border: "1px solid var(--border-subtle, #e2e8f0)",
          borderRadius: "16px",
          padding: "16px 20px",
          display: "flex",
          flexDirection: "column",
          gap: "14px",
        }}
      >
        {/* FILTRO 1: UNIDADES */}
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
            <strong style={{ fontSize: "13px", color: "var(--text-primary)" }}>
              🏢 Unidade em Foco:
            </strong>
            <span style={{ fontSize: "12px", color: "var(--text-muted)", fontStyle: "italic" }}>
              3 Unidades FaçaAmigos
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
                    padding: "6px 14px",
                    borderRadius: "9999px",
                    border: isSelected ? "2px solid #7c3aed" : "1px solid var(--border-subtle, #cbd5e1)",
                    background: isSelected ? "linear-gradient(135deg, rgba(124, 58, 237, 0.12) 0%, rgba(37, 99, 235, 0.12) 100%)" : "var(--surface-card, #ffffff)",
                    color: isSelected ? "#6d28d9" : "var(--text-primary)",
                    fontWeight: isSelected ? "bold" : "500",
                    fontSize: "13px",
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                  }}
                >
                  <span>{u.badge}</span>
                  {isSelected && <span style={{ marginLeft: "4px" }}>✓</span>}
                </button>
              );
            })}
          </div>
        </div>

        {/* FILTROS 2 E 3: PERÍODO E STATUS DE EQUIPE */}
        <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", paddingTop: "8px", borderTop: "1px dashed var(--border-subtle, #e2e8f0)" }}>
          {/* PERÍODO */}
          <div style={{ flex: 1, minWidth: "260px" }}>
            <strong style={{ fontSize: "13px", display: "block", marginBottom: "6px", color: "var(--text-primary)" }}>
              📅 Período de Análise Comercial:
            </strong>
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => setPeriodFilter("SINCE_AUG_29")}
                style={{
                  padding: "5px 12px",
                  borderRadius: "8px",
                  fontSize: "12px",
                  fontWeight: periodFilter === "SINCE_AUG_29" ? "bold" : "normal",
                  background: periodFilter === "SINCE_AUG_29" ? "rgba(34, 197, 94, 0.15)" : "var(--surface-card)",
                  color: periodFilter === "SINCE_AUG_29" ? "#15803d" : "var(--text-secondary)",
                  border: periodFilter === "SINCE_AUG_29" ? "1px solid #16a34a" : "1px solid var(--border-subtle)",
                  cursor: "pointer",
                }}
              >
                Pós-29/08 (Confiável)
              </button>
              <button
                type="button"
                onClick={() => setPeriodFilter("LAST_7_DAYS")}
                style={{
                  padding: "5px 12px",
                  borderRadius: "8px",
                  fontSize: "12px",
                  fontWeight: periodFilter === "LAST_7_DAYS" ? "bold" : "normal",
                  background: periodFilter === "LAST_7_DAYS" ? "rgba(59, 130, 246, 0.15)" : "var(--surface-card)",
                  color: periodFilter === "LAST_7_DAYS" ? "#1d4ed8" : "var(--text-secondary)",
                  border: periodFilter === "LAST_7_DAYS" ? "1px solid #2563eb" : "1px solid var(--border-subtle)",
                  cursor: "pointer",
                }}
              >
                Últimos 7 Dias
              </button>
              <button
                type="button"
                onClick={() => setPeriodFilter("LAST_30_DAYS")}
                style={{
                  padding: "5px 12px",
                  borderRadius: "8px",
                  fontSize: "12px",
                  fontWeight: periodFilter === "LAST_30_DAYS" ? "bold" : "normal",
                  background: periodFilter === "LAST_30_DAYS" ? "rgba(59, 130, 246, 0.15)" : "var(--surface-card)",
                  color: periodFilter === "LAST_30_DAYS" ? "#1d4ed8" : "var(--text-secondary)",
                  border: periodFilter === "LAST_30_DAYS" ? "1px solid #2563eb" : "1px solid var(--border-subtle)",
                  cursor: "pointer",
                }}
              >
                Últimos 30 Dias
              </button>
            </div>
          </div>

          {/* STATUS DA EQUIPE / COLABORADORES */}
          <div style={{ flex: 1, minWidth: "260px" }}>
            <strong style={{ fontSize: "13px", display: "block", marginBottom: "6px", color: "var(--text-primary)" }}>
              👥 Filtro de Colaboradores:
            </strong>
            <button
              type="button"
              onClick={() => setOnlyActiveEmployees(!onlyActiveEmployees)}
              style={{
                padding: "6px 14px",
                borderRadius: "8px",
                fontSize: "12px",
                fontWeight: "bold",
                background: onlyActiveEmployees ? "rgba(34, 197, 94, 0.12)" : "rgba(239, 68, 68, 0.12)",
                color: onlyActiveEmployees ? "#15803d" : "#b91c1c",
                border: onlyActiveEmployees ? "1px solid #16a34a" : "1px solid #ef4444",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              <span>{onlyActiveEmployees ? "✓ Apenas Colaboradores Ativos (Excluir Demitidos Pós-29/08)" : "⚠️ Incluindo Registros Antigos"}</span>
            </button>
          </div>
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
          flexDirection: "column",
          gap: "12px",
          boxShadow: "0 10px 25px -5px rgba(30, 27, 75, 0.4)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div
              style={{
                width: "48px",
                height: "48px",
                borderRadius: "14px",
                background: "linear-gradient(135deg, #a855f7 0%, #ec4899 100%)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "24px",
                fontWeight: "bold",
                boxShadow: "0 4px 12px rgba(168, 85, 247, 0.4)",
              }}
            >
              ✦
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: "20px", fontWeight: "bold", color: "#ffffff", letterSpacing: "-0.02em" }}>
                ZoeIA — Diretora Comercial & Copilot Estratégico
              </h2>
              <p style={{ margin: "2px 0 0", fontSize: "13px", color: "#cbd5e1" }}>
                Análise em tempo real de faturamento, ticket médio e sugestões ativas para elevar as vendas da rede.
              </p>
            </div>
          </div>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <Tag style={{ background: "rgba(168, 85, 247, 0.2)", color: "#e9d5ff", border: "1px solid rgba(168, 85, 247, 0.4)" }}>
              {metricsLoading || loading ? "🔄 Atualizando..." : "🟢 Resposta Confiável"}
            </Tag>
          </div>
        </div>
      </section>

      {/* RESULTADO DO RELATÓRIO DA ZOEIA */}
      {loading ? (
        <Card style={{ padding: "32px", textAlign: "center", background: "var(--surface-card)" }}>
          <div style={{ fontSize: "28px", marginBottom: "12px" }}>✦</div>
          <strong style={{ fontSize: "16px", display: "block" }}>ZoeIA está consolidando as métricas e gerando estratégias comerciais...</strong>
          <p style={{ fontSize: "13px", color: "var(--text-muted)", margin: "6px 0 0" }}>
            Filtrando apenas a equipe com contrato ativo e faturamento pós-29/08/2026.
          </p>
        </Card>
      ) : report ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "16px" }}>
          {/* PROJEÇÕES & COMO AUMENTAR */}
          <Card style={{ padding: "20px", borderLeft: "4px solid #3b82f6" }}>
            <h3 style={{ margin: "0 0 12px", fontSize: "16px", color: "#1d4ed8", display: "flex", alignItems: "center", gap: "8px" }}>
              📈 Projeções & Alavancagem de Vendas
            </h3>
            <p style={{ fontSize: "14px", fontWeight: "bold", margin: "0 0 8px" }}>{report.projections.forecastText}</p>
            <p style={{ fontSize: "13px", color: "var(--text-secondary)", margin: "0 0 12px" }}>{report.projections.targetText}</p>
            <strong style={{ fontSize: "13px", display: "block", marginBottom: "6px" }}>Ações para Aumentar Faturamento:</strong>
            <ul style={{ margin: 0, paddingLeft: "20px", fontSize: "13px", color: "var(--text-primary)" }}>
              {report.projections.howToIncrease.map((item, idx) => (
                <li key={idx} style={{ marginBottom: "4px" }}>
                  {item}
                </li>
              ))}
            </ul>
          </Card>

          {/* PONTOS DE ATENÇÃO */}
          <Card style={{ padding: "20px", borderLeft: "4px solid #f59e0b" }}>
            <h3 style={{ margin: "0 0 12px", fontSize: "16px", color: "#b45309", display: "flex", alignItems: "center", gap: "8px" }}>
              ⚠️ Pontos de Atenção na Operação
            </h3>
            <div style={{ background: "rgba(245, 158, 11, 0.1)", padding: "10px 14px", borderRadius: "8px", marginBottom: "12px" }}>
              <strong style={{ fontSize: "13px", color: "#b45309", display: "block" }}>Gargalo Identificado:</strong>
              <span style={{ fontSize: "13px" }}>{report.attentionPoints.issue}</span>
            </div>
            <strong style={{ fontSize: "13px", display: "block", marginBottom: "4px" }}>Onde Melhorar:</strong>
            <p style={{ fontSize: "13px", color: "var(--text-secondary)", margin: 0 }}>{report.attentionPoints.whereToImprove}</p>
          </Card>

          {/* EFICIÊNCIA DA EQUIPE ATIVA */}
          <Card style={{ padding: "20px", borderLeft: "4px solid #10b981" }}>
            <h3 style={{ margin: "0 0 12px", fontSize: "16px", color: "#047857", display: "flex", alignItems: "center", gap: "8px" }}>
              👥 Performance da Equipe Ativa
            </h3>
            <div style={{ marginBottom: "12px", background: "rgba(16, 185, 129, 0.08)", padding: "10px 12px", borderRadius: "8px" }}>
              <span style={{ fontSize: "11px", fontWeight: "bold", textTransform: "uppercase", color: "#047857" }}>
                🌟 Operador Destaque ({report.operatorPerformance.topOperatorName})
              </span>
              <p style={{ fontSize: "13px", margin: "4px 0 2px", fontWeight: "bold" }}>{report.operatorPerformance.topOperatorMetric}</p>
              <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>{report.operatorPerformance.topOperatorReason}</span>
            </div>

            <div style={{ background: "rgba(99, 102, 241, 0.08)", padding: "10px 12px", borderRadius: "8px" }}>
              <span style={{ fontSize: "11px", fontWeight: "bold", textTransform: "uppercase", color: "#4338ca" }}>
                🎯 Suporte/Treinamento ({report.operatorPerformance.needsTrainingOperatorName})
              </span>
              <p style={{ fontSize: "13px", margin: "4px 0 2px" }}>{report.operatorPerformance.needsTrainingMetric}</p>
              <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                <strong>Ação Recomendada:</strong> {report.operatorPerformance.needsTrainingAction}
              </span>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
