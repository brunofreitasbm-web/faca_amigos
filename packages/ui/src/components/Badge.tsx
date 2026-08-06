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
  | "solid_amber";

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
      color: "#1a9c5e",
      border: "1px solid rgba(40,200,128,0.35)",
    },
    neutral: {
      background: "var(--color-gray-200)",
      color: "var(--text-secondary)",
      border: "1px solid var(--border-subtle)",
    },
    solid_pink: { background: "var(--color-pink)", color: "#fff", border: "none" },
    solid_teal: { background: "var(--color-teal)", color: "#fff", border: "none" },
    solid_amber: { background: "var(--color-amber)", color: "#fff", border: "none" },
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
    whiteSpace: "nowrap",
    ...variants[variant],
    ...styleProp,
  };

  return (
    <span style={style} {...rest}>
      {children}
    </span>
  );
}
