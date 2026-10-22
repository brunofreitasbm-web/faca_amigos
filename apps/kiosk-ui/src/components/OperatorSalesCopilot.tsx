import { useEffect, useState } from "react";
import { Button, Badge } from "@facaamigos/ui";
import {
  generateOperatorSalesCopilotTip,
  type OperatorSalesCopilotTip,
} from "../lib/geminiAgent.js";
import { money } from "../format.js";
import { Emoji3D } from "./Emoji3D.js";

interface OperatorSalesCopilotProps {
  todayRevenueCents: number;
  targetRevenueCents: number;
  superRevenueCents?: number;
  ordersCount: number;
  ticketMedioCents: number;
  unitName?: string;
  unitKind?: "QUIOSQUE" | "LOJA";
  bonusLevel?: "abaixo" | "meta" | "supermeta";
  bonusEstimatedCents?: number;
}

const COMMON_OBJECTIONS = [
  {
    objection: "Achei caro",
    counter: "No plano de 60 minutos o valor por hora cai quase pela metade e a criança aproveita sem pressa!",
  },
  {
    objection: "Tenho pouco tempo",
    counter: "30 minutinhos passam voando, mas são perfeitos para ela gastar energia enquanto você resolve algo rápido aqui no shopping!",
  },
  {
    objection: "Vou só dar uma volta",
    counter: "Pode deixar a criança conosco com total segurança de pulseira identificada e monitores dedicados!",
  },
  {
    objection: "Não trouxe meia",
    counter: "Temos a meia oficial antiderrapante FaçaAmigos por um valor simbólico que já fica com você para as próximas visitas!",
  },
];

export function OperatorSalesCopilot({
  todayRevenueCents,
  targetRevenueCents,
  superRevenueCents,
  ordersCount,
  ticketMedioCents,
  unitName = "Unidade",
  unitKind = "LOJA",
  bonusLevel = "abaixo",
  bonusEstimatedCents = 0,
}: OperatorSalesCopilotProps) {
  const [tip, setTip] = useState<OperatorSalesCopilotTip | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [showObjections, setShowObjections] = useState(false);

  async function loadTip() {
    setLoading(true);
    try {
      const result = await generateOperatorSalesCopilotTip({
        todayRevenueCents,
        targetRevenueCents,
        superRevenueCents,
        ordersCount,
        ticketMedioCents,
        unitName,
        unitKind,
        bonusLevel,
        bonusEstimatedCents,
      });
      setTip(result);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  // Recarrega dica quando o nível de bonificação muda ou no primeiro mount
  useEffect(() => {
    loadTip();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bonusLevel, unitKind]);

  if (!tip && !loading) return null;

  const deltaMeta = Math.max(0, targetRevenueCents - todayRevenueCents);

  return (
    <div
      role="region"
      aria-label="Copiloto de Vendas da ZoeIA"
      style={{
        flexShrink: 0,
        background:
          bonusLevel === "supermeta"
            ? "linear-gradient(135deg, rgba(245, 158, 11, 0.12) 0%, rgba(16, 185, 129, 0.12) 100%)"
            : bonusLevel === "meta"
            ? "linear-gradient(135deg, rgba(16, 185, 129, 0.12) 0%, rgba(37, 99, 235, 0.12) 100%)"
            : "linear-gradient(135deg, rgba(124, 58, 237, 0.08) 0%, rgba(37, 99, 235, 0.08) 100%)",
        border:
          bonusLevel === "supermeta"
            ? "1.5px solid rgba(245, 158, 11, 0.5)"
            : bonusLevel === "meta"
            ? "1.5px solid rgba(16, 185, 129, 0.5)"
            : "1.5px solid rgba(124, 58, 237, 0.3)",
        borderRadius: "14px",
        padding: "10px 14px",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        boxShadow: "0 2px 8px rgba(0, 0, 0, 0.04)",
      }}
    >
      {/* Barra de Título e Controles */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "8px",
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          <Badge
            variant="vip"
            style={{
              background: "linear-gradient(135deg, #7c3aed 0%, #2563eb 100%)",
              color: "#ffffff",
              fontWeight: "bold",
              fontSize: "11px",
              padding: "3px 8px",
              borderRadius: "9999px",
            }}
          >
            ✦ ZOEIA COPILOTO
          </Badge>
          <span style={{ fontSize: "13px", fontWeight: "bold", color: "var(--text-primary)" }}>
            {tip?.headline || "Treinadora de Vendas em Tempo Real"}
          </span>
          {deltaMeta > 0 ? (
            <span
              style={{
                fontSize: "11px",
                fontWeight: 600,
                color: "var(--color-amber-text, #d97706)",
                background: "rgba(245, 158, 11, 0.1)",
                padding: "2px 8px",
                borderRadius: "6px",
              }}
            >
              Falta {money(deltaMeta)} p/ Meta de Bônus!
            </span>
          ) : (
            <span
              style={{
                fontSize: "11px",
                fontWeight: 600,
                color: "#059669",
                background: "rgba(16, 185, 129, 0.1)",
                padding: "2px 8px",
                borderRadius: "6px",
              }}
            >
              🎉 Bônus Garantido: {money(bonusEstimatedCents)}
            </span>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShowObjections((v) => !v)}
            title="Dicas rápidas para contornar objeções dos pais"
            style={{ fontSize: "11px", padding: "4px 8px", minHeight: "32px" }}
          >
            <Emoji3D e="🗣️" /> {showObjections ? "Fechar Objeções" : "Como Responder Objeções"}
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={loadTip}
            disabled={loading}
            title="Gerar nova dica tática de abordagem"
            style={{ fontSize: "11px", padding: "4px 8px", minHeight: "32px" }}
          >
            <Emoji3D e="💡" /> {loading ? "Analisando..." : "Nova Dica"}
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setExpanded((v) => !v)}
            title={expanded ? "Recolher painel da ZoeIA" : "Expandir painel da ZoeIA"}
            style={{ fontSize: "11px", padding: "4px 6px", minHeight: "32px" }}
          >
            {expanded ? "▲" : "▼"}
          </Button>
        </div>
      </div>

      {/* Conteúdo Expandido do Copiloto */}
      {expanded && tip && (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "2px" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              gap: "8px",
              background: "rgba(255, 255, 255, 0.6)",
              padding: "8px 12px",
              borderRadius: "10px",
              border: "1px solid rgba(0, 0, 0, 0.05)",
            }}
          >
            <div>
              <span style={{ fontSize: "11px", fontWeight: "bold", color: "var(--text-secondary)", textTransform: "uppercase" }}>
                🎯 Tática Imediata de Balcão:
              </span>
              <p style={{ margin: "2px 0 0", fontSize: "12px", color: "var(--text-primary)", fontWeight: 500 }}>
                {tip.tactic}
              </p>
            </div>

            <div>
              <span style={{ fontSize: "11px", fontWeight: "bold", color: "var(--text-secondary)", textTransform: "uppercase" }}>
                🗣️ Script Pronto p/ Falar:
              </span>
              <p
                style={{
                  margin: "2px 0 0",
                  fontSize: "12px",
                  color: "#4338ca",
                  fontWeight: 600,
                  fontStyle: "italic",
                }}
              >
                "{tip.suggestedScript}"
              </p>
            </div>
          </div>

          {/* Dicas de Objeção Rápida */}
          {showObjections && (
            <div
              style={{
                marginTop: "4px",
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: "8px",
                background: "rgba(243, 244, 246, 0.8)",
                padding: "8px 10px",
                borderRadius: "8px",
              }}
            >
              {COMMON_OBJECTIONS.map((obj, i) => (
                <div key={i} style={{ fontSize: "11px", display: "flex", flexDirection: "column", gap: "2px" }}>
                  <span style={{ fontWeight: "bold", color: "#b91c1c" }}>• Se o cliente disser "{obj.objection}":</span>
                  <span style={{ color: "var(--text-primary)" }}>{obj.counter}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
