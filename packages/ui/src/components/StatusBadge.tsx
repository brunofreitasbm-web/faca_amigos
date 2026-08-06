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
  size?: "sm" | "md";
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
