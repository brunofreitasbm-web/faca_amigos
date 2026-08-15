import { useEffect, useState } from "react";
import { Card, Tag } from "@facaamigos/ui";
import { useAppState } from "../state/AppState.js";
import {
  generateGerencialReport,
  type GerencialReport,
} from "../lib/geminiAgent.js";

interface GeminiGerencialCopilotProps {
  metricsSummary?: string;
}

export function GeminiGerencialCopilot({ metricsSummary }: GeminiGerencialCopilotProps) {
  const { unit } = useAppState();
  const [report, setReport] = useState<GerencialReport | null>(null);
  const [loading, setLoading] = useState(false);

  const defaultMetricsContext =
    metricsSummary ||
    `Unidade: ${unit?.name || "Geral"} | Faturamento Hoje: R$ 3.850,00 | Ticket Médio: R$ 48,00 | Ocupação Média: 65% | Total Visitas: 80 crianças | Meias Vendidas: 14 unidades.`;

  useEffect(() => {
    let active = true;
    setLoading(true);
    generateGerencialReport(defaultMetricsContext, unit?.name)
      .then((res) => {
        if (active) setReport(res);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [defaultMetricsContext, unit?.name]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
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
            <span style={{ fontSize: "12px", color: "#4ade80", fontWeight: "600" }}>● Análise Ativa ({unit?.name || "Unidade"})</span>
          </div>
          <h2 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: "24px", color: "#ffffff" }}>
            Painel Estratégico & Desempenho Operacional
          </h2>
          <p style={{ margin: "6px 0 0 0", color: "#c7d2fe", fontSize: "14px", maxWidth: "650px" }}>
            Projeções de receita, pontos de atenção, mapa de eficiência dos colaboradores e plano de ação diário elaborado pela ZoeIA.
          </p>
        </div>
      </section>

      {loading && (
        <Card style={{ padding: "24px", textAlign: "center", fontStyle: "italic", color: "var(--text-muted)" }}>
          ZoeIA analisando métricas, projeções e eficiência dos operadores da unidade...
        </Card>
      )}

      {report && !loading && (
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
