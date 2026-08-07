import type { CSSProperties, HTMLAttributes, ReactNode } from "react";

export type BadgeVariant =
  | "pink"
  | "teal"
  | "amber"
  | "yellow"
  | "green"
  | "neutral"
  | "solid_pink"
  | "solid_teal"
  | "solid_amber"
  | "solid_orange"
  | "vip";

export interface BadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  variant?: BadgeVariant;
  children?: ReactNode;
}

/**
 * Chip de marca (não confundir com StatusBadge, que é o semáforo
 * operacional). Portado de components/core/Badge.jsx — a variante
 * `neutral` foi adaptada para light mode: a fonte usava overlays de
 * branco translúcido pensados para fundo #141414, que ficam
 * praticamente invisíveis sobre branco.
 */
export function Badge({ variant = "pink", children, style: styleProp, ...rest }: BadgeProps) {
  const variants: Record<BadgeVariant, CSSProperties> = {
    pink: {
      background: "rgba(240,25,107,0.12)",
      color: "var(--color-primary-hover)",
      border: "1px solid rgba(240,25,107,0.3)",
    },
    teal: {
      background: "rgba(46,207,181,0.15)",
      color: "#1d8571",
      border: "1px solid rgba(46,207,181,0.35)",
    },
    amber: {
      background: "rgba(201,144,32,0.15)",
      color: "#8a6316",
      border: "1px solid rgba(201,144,32,0.35)",
    },
    yellow: {
      background: "rgba(255,226,52,0.25)",
      color: "#8a6a0a",
      border: "1px solid rgba(201,166,10,0.4)",
    },
    green: {
      background: "rgba(40,200,128,0.15)",
      // Era #1a9c5e (3.52:1 sobre branco — falha AA). --color-success-text
      // é a mesma família de verde escurecida até passar (4.69:1).
      color: "var(--color-success-text)",
      border: "1px solid rgba(40,200,128,0.35)",
    },
    neutral: {
      background: "var(--color-gray-200)",
      color: "var(--text-secondary)",
      border: "1px solid var(--border-subtle)",
    },
    // Os três "solid_*" são texto branco sobre cor cheia — e as cores
    // cheias da marca (pink 4.15:1, teal 1.96:1, amber 2.80:1) não têm
    // luminância suficiente pra sustentar branco em cima com AA. Em vez
    // de trocar a cor do texto (que ficaria inconsistente com o resto
    // do badge), o fundo usa a variante -text de cada cor — a mesma
    // tonalidade, só escura o bastante pra branco em cima passar.
    solid_pink: { background: "var(--color-primary-hover)", color: "#fff", border: "none" },
    solid_teal: { background: "var(--color-teal-text)", color: "#fff", border: "none" },
    solid_amber: { background: "var(--color-amber-text)", color: "#fff", border: "none" },
    solid_orange: { background: "var(--color-orange-text)", color: "#fff", border: "none" },
    // Selo VIP. Deliberadamente ESTÁTICO (nenhuma animação, nenhum blink,
    // ao contrário do selo de frequência antigo) e no par de maior
    // contraste da paleta: amarelo da marca sobre o verde-escuro do logo,
    // 8.96:1 — mais que o dobro do exigido por AA. É informação que o
    // operador precisa captar de relance, com a família na frente dele,
    // numa lista onde tudo o mais é claro; e num espaço pensado para
    // crianças neurodivergentes, o que pisca compete com a atenção em vez
    // de dirigi-la.
    vip: {
      background: "var(--color-dark)",
      color: "var(--color-yellow)",
      border: "1px solid var(--color-dark)",
      fontWeight: 700,
      letterSpacing: "0.08em",
    },
  };

  const style: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: "5px",
    padding: "4px 10px",
    borderRadius: "var(--radius-badge)",
    fontFamily: "var(--font-body)",
    fontWeight: "var(--weight-semibold)" as unknown as number,
    fontSize: "12px",
    lineHeight: 1,
    letterSpacing: "0.02em",
    whiteSpace: "normal",
    overflowWrap: "anywhere",
    ...variants[variant],
    ...styleProp,
  };

  return (
    <span style={style} {...rest}>
      {children}
    </span>
  );
}
