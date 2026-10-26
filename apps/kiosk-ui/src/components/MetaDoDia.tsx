import { useEffect, useState } from "react";
import { Button } from "@facaamigos/ui";
import type { BonusRule } from "../api/client.js";
import type { BonificacaoHoje } from "../bonificacao.js";
import {
  generateOperatorSalesCopilotTip,
  type OperatorSalesCopilotTip,
  type OperatorSalesCopilotContext,
} from "../lib/geminiAgent.js";
import { money } from "../format.js";
import { Emoji3D } from "./Emoji3D.js";

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

type Tom = "error" | "amber" | "teal" | "success";

const TOM_COR: Record<Tom, string> = {
  error: "var(--color-error)",
  amber: "var(--color-amber)",
  teal: "var(--color-teal)",
  success: "var(--color-success)",
};

/**
 * Faixa de cor da barra a partir do % atingido da meta (0–120).
 * Usada só para o ticket médio — a bonificação já vem com `nivel` pronto.
 */
function tomDaMeta(percent: number): Tom {
  // TODO(human)
  return "teal";
}

interface MetaDoDiaProps {
  tipo: "PLAYGROUND" | "CIRCUITO";
  /** Placar do programa de bonificação; null fora do piloto ou sem meta configurada. */
  bonus: BonificacaoHoje | null;
  ticketMedioCents: number;
  ticketMinCents: number;
  ticketTargetCents: number;
  bonusRules: BonusRule[];
  /** Contexto da dica da ZoeIA — mesmo que o antigo OperatorSalesCopilot recebia. */
  copilot: OperatorSalesCopilotContext;
}

/**
 * Bloco único "Meta do dia" do Painel. Antes eram três peças falando da
 * mesma meta (chip de ticket, chip de bonificação e a faixa do Copiloto
 * ZoeIA), cada uma com sua cor e seu "falta X" — o operador tinha que ler
 * três vezes para saber uma coisa só. Agora: uma barra, um "falta X"
 * sempre visível (balcão é touch, `title` não aparece) e a dica da IA
 * recolhida numa linha.
 */
export function MetaDoDia({ tipo, bonus, ticketMedioCents, ticketMinCents, ticketTargetCents, bonusRules, copilot }: MetaDoDiaProps) {
  const [tip, setTip] = useState<OperatorSalesCopilotTip | null>(null);
  const [tipLoading, setTipLoading] = useState(false);
  const [tipOpen, setTipOpen] = useState(false);
  const [showObjections, setShowObjections] = useState(false);

  async function loadTip() {
    setTipLoading(true);
    try {
      setTip(await generateOperatorSalesCopilotTip(copilot));
    } catch {
      // Sem dica é melhor que dica inventada — o bloco segue só com a meta.
    } finally {
      setTipLoading(false);
    }
  }

  useEffect(() => {
    loadTip();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [copilot.bonusLevel, copilot.unitKind]);

  const hasTicket = ticketTargetCents > 0;
  if (!bonus && !hasTicket && bonusRules.length === 0 && !tip) return null;

  // Bonificação é a meta que vira dinheiro para a equipe — quando existe,
  // é ela que manda na barra. Fora do piloto, a barra é o ticket médio.
  let label: string;
  let valor: string;
  let percent: number;
  let falta: string;
  let cor: string;
  if (bonus) {
    const fmt = (n: number) => (tipo === "CIRCUITO" ? `${n} loc.` : money(n));
    label = "Bonificação";
    valor = fmt(bonus.atual);
    percent = bonus.meta > 0 ? Math.min(120, Math.round((bonus.atual / bonus.meta) * 100)) : 0;
    if (bonus.nivel === "abaixo") {
      falta = `Falta ${fmt(bonus.meta - bonus.atual)} p/ meta`;
      cor = TOM_COR.teal;
    } else if (bonus.nivel === "meta") {
      falta = `Meta batida · falta ${fmt(bonus.super - bonus.atual)} p/ supermeta`;
      cor = TOM_COR.success;
    } else {
      falta = "Supermeta alcançada";
      cor = TOM_COR.amber;
    }
  } else {
    label = "Ticket médio";
    valor = money(ticketMedioCents);
    percent = Math.min(120, Math.round((ticketMedioCents / ticketTargetCents) * 100));
    const delta = ticketTargetCents - ticketMedioCents;
    falta = delta > 0 ? `Falta ${money(delta)} p/ alvo` : `Alvo batido (+${percent - 100}%)`;
    cor = TOM_COR[tomDaMeta(percent)];
  }

  const showBar = bonus || hasTicket;

  return (
    <section
      aria-label="Meta do dia"
      style={{
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        padding: "8px 12px",
        borderRadius: "12px",
        border: "1px solid var(--border-subtle)",
        background: "var(--surface-card)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "8px 14px", flexWrap: "wrap", fontSize: "13px" }}>
        {showBar && (
          <>
            <span style={{ color: "var(--text-secondary)" }}>
              {label} <strong style={{ color: "var(--text-primary)" }}>{valor}</strong>
            </span>
            <div
              role="progressbar"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={label}
              style={{ flex: "1 1 120px", maxWidth: "260px", height: "8px", borderRadius: "9999px", background: "var(--border-subtle)", overflow: "hidden" }}
            >
              <div style={{ width: `${Math.min(100, percent)}%`, height: "100%", background: cor, transition: "width 0.6s ease" }} />
            </div>
            <strong style={{ color: cor, fontSize: "12px" }}>{percent}%</strong>
            <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-primary)" }}>{falta}</span>
            {bonus && bonus.bonusCents > 0 && (
              <span style={{ fontSize: "12px", color: "var(--color-success-text)" }}>· bônus {money(bonus.bonusCents)}</span>
            )}
            {bonus && hasTicket && (
              <span
                style={{ fontSize: "12px", color: "var(--text-muted)" }}
                title={`Ticket médio de hoje (mín ${money(ticketMinCents)} / alvo ${money(ticketTargetCents)})`}
              >
                · ticket {money(ticketMedioCents)}
              </span>
            )}
          </>
        )}
        {bonusRules.length > 0 && (
          <span
            style={{ fontSize: "12px", color: "var(--text-muted)" }}
            title={bonusRules.map((r) => `${r.description} (${money(r.rewardValueCents)})`).join(" · ")}
          >
            · {bonusRules.length} regra{bonusRules.length > 1 ? "s" : ""} de bônus
          </span>
        )}
        {(tip || tipLoading) && (
          <button
            type="button"
            onClick={() => setTipOpen((v) => !v)}
            aria-expanded={tipOpen}
            style={{
              marginLeft: "auto",
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              minHeight: "32px",
              padding: "4px 10px",
              borderRadius: "9999px",
              border: "1px solid var(--border-subtle)",
              background: "transparent",
              cursor: "pointer",
              fontSize: "12px",
              color: "var(--text-primary)",
              maxWidth: "100%",
            }}
          >
            <Emoji3D e="💡" />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "320px" }}>
              {tipLoading && !tip ? "ZoeIA analisando…" : tip?.headline}
            </span>
            <span aria-hidden="true">{tipOpen ? "▲" : "▼"}</span>
          </button>
        )}
      </div>

      {tipOpen && tip && (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px", paddingTop: "6px", borderTop: "1px dashed var(--border-subtle)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "8px", fontSize: "12px" }}>
            <div>
              <strong style={{ fontSize: "11px", color: "var(--text-secondary)" }}>Tática de balcão</strong>
              <p style={{ margin: "2px 0 0" }}>{tip.tactic}</p>
            </div>
            <div>
              <strong style={{ fontSize: "11px", color: "var(--text-secondary)" }}>O que falar</strong>
              <p style={{ margin: "2px 0 0", fontStyle: "italic", color: "var(--color-primary-hover)" }}>"{tip.suggestedScript}"</p>
            </div>
          </div>
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowObjections((v) => !v)}>
              <Emoji3D e="🗣️" /> {showObjections ? "Fechar objeções" : "Responder objeções"}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={loadTip} disabled={tipLoading}>
              {tipLoading ? "Analisando…" : "Nova dica"}
            </Button>
          </div>
          {showObjections && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "8px", fontSize: "12px" }}>
              {COMMON_OBJECTIONS.map((obj) => (
                <div key={obj.objection}>
                  <strong>"{obj.objection}"</strong>
                  <div>{obj.counter}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
