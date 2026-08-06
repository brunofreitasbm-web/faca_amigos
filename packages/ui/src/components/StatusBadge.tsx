import type { CSSProperties, HTMLAttributes } from "react";

export type SessionPhase = "VERDE" | "AMARELO" | "VERMELHO" | "EXCEDENTE";

const LABELS: Record<SessionPhase, string> = {
  VERDE: "no prazo",
  AMARELO: "acabando",
  VERMELHO: "estourou o tempo",
  EXCEDENTE: "excedente cobrável",
};

// Glifos simples em vez de dependência de ícone (Fase 0 não traz
// pacote de ícones ainda). Cada fase usa uma FORMA diferente, não só
// cor — reforço extra além do texto para leitura de relance e para
// não depender só de percepção de cor.
const GLYPHS: Record<SessionPhase, string> = {
  VERDE: "●",
  AMARELO: "◆",
  VERMELHO: "▲",
  EXCEDENTE: "✕",
};

export interface StatusBadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  phase: SessionPhase;
  /** Texto complementar (ex. "22:14" ou "+07:31"). Opcional. */
  detail?: string;
  size?: "sm" | "md" | "lg";
}

/**
 * Badge do semáforo operacional (seção 3.1 do plano de arquitetura).
 * Existe como componente dedicado — em vez de o card do dashboard
 * escolher uma cor "na mão" — justamente para impedir a regra que a
 * spec pede: "nunca codificar estado só por cor". Ícone + rótulo
 * textual vêm sempre juntos aqui; não há como usar só a cor.
 *
 * Paleta em packages/ui/src/tokens/status.css, com contraste WCAG AA
 * verificado e testado em test/status.spec.ts.
 */
export function StatusBadge({ phase, detail, size = "md", style: styleProp, ...rest }: StatusBadgeProps) {
  // "lg" é um layout à parte (bloco, com o tempo em destaque) em vez de
  // só um `sm`/`md` maior — o Painel usa essa variante como o elemento
  // visualmente dominante do card, porque o foco operacional #1 é o
  // tempo de permanência (entrada → cobrança), não o rótulo da fase.
  if (size === "lg") {
    const style: CSSProperties = {
      display: "flex",
      flexDirection: "column",
      gap: "2px",
      padding: "8px 12px",
      borderRadius: "var(--radius-badge)",
      background: `var(--status-${phase.toLowerCase()}-bg)`,
      color: `var(--status-${phase.toLowerCase()}-fg)`,
      fontFamily: "var(--font-body)",
      ...styleProp,
    };
    // Sem role="status" aqui: `detail` neste tamanho é o cronômetro do
    // Painel, recalculado a 1 Hz para cada card (useTick.ts) — um
    // role="status" fica reanunciando "22:14... 22:15... 22:16..." pra
    // sempre em leitor de tela, pra cada sessão ativa. É enchente, não
    // uma live region útil. O valor continua legível sob demanda; só
    // não empurra sozinho a cada segundo.
    return (
      <span style={style} {...rest}>
        <span style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "11px", fontWeight: "var(--weight-bold)" as unknown as number, textTransform: "uppercase", letterSpacing: "0.04em", opacity: 0.9 }}>
          <span aria-hidden="true">{GLYPHS[phase]}</span>
          <span>{LABELS[phase]}</span>
        </span>
        {detail && (
          <span
            style={{
              // cqi: acompanha a largura do card que contém o badge, não a
              // da janela — num monitor grande com muitas colunas estreitas
              // a janela é larga mas o card é pequeno, e é o card que manda.
              // Sem um container de consulta em volta, cqi cai na viewport
              // e o clamp segura no teto, que é o comportamento antigo.
              fontSize: "clamp(22px, 11cqi, 34px)",
              fontWeight: "var(--weight-bold)" as unknown as number,
              fontVariantNumeric: "tabular-nums",
              lineHeight: 1.1,
            }}
          >
            {detail}
          </span>
        )}
      </span>
    );
  }

  const style: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    padding: size === "sm" ? "4px 10px" : "6px 14px",
    borderRadius: "var(--radius-badge)",
    background: `var(--status-${phase.toLowerCase()}-bg)`,
    color: `var(--status-${phase.toLowerCase()}-fg)`,
    fontFamily: "var(--font-body)",
    fontWeight: "var(--weight-bold)" as unknown as number,
    fontSize: size === "sm" ? "12px" : "14px",
    lineHeight: 1,
    whiteSpace: "nowrap",
    ...styleProp,
  };

  return (
    <span style={style} role="status" {...rest}>
      <span aria-hidden="true">{GLYPHS[phase]}</span>
      <span>{LABELS[phase]}</span>
      {detail && <span style={{ opacity: 0.85, fontWeight: "var(--weight-semibold)" as unknown as number }}>{detail}</span>}
    </span>
  );
}
