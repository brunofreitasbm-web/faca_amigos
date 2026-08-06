import type { CSSProperties } from "react";

export type BrandLockupSize = "sm" | "md" | "lg";

export interface BrandLockupProps {
  /** Nome da operação exibido na faixa sob o logotipo (ex.: "Playground · Parque Shopping"). */
  operation?: string;
  /**
   * Cor da operação — token CSS ou hex. Tinge o ponto da marca e a faixa,
   * nunca o wordmark: "Faça" verde-escuro + "Amigos" rosa são fixos.
   */
  accent?: string;
  size?: BrandLockupSize;
  style?: CSSProperties;
  title?: string;
}

const SIZES: Record<BrandLockupSize, { mark: number; word: number; band: number; gap: number }> = {
  sm: { mark: 34, word: 17, band: 9.5, gap: 9 },
  md: { mark: 46, word: 23, band: 11, gap: 12 },
  lg: { mark: 76, word: 40, band: 15, gap: 18 },
};

/**
 * Marca FaçaAmigos: os dois arcos entrelaçados (amarelo + verde-água) com
 * o ponto rosa embaixo. Redesenhada como SVG em vez de usar o PNG oficial
 * por dois motivos: o ponto precisa assumir a cor da operação — impossível
 * num raster — e o PNG traz a tagline "PLAYGROUND INCLUSIVO" embutida, que
 * estaria errada no Circuito.
 */
function BrandMark({ size, accent }: { size: number; accent: string }) {
  return (
    <svg
      width={size}
      height={(size * 74) / 64}
      viewBox="0 0 64 74"
      fill="none"
      aria-hidden="true"
      style={{ flexShrink: 0, display: "block" }}
    >
      <g fill="none" strokeLinecap="round" strokeWidth="12">
        <path d="M16 50 V36 a10 10 0 0 1 20 0 V44" stroke="var(--color-yellow, #FFE234)" />
        <path d="M28 44 V36 a10 10 0 0 1 20 0 V50" stroke="var(--color-teal, #2ECFB5)" opacity="0.93" />
      </g>
      <circle cx="26" cy="66" r="6.5" fill={accent} />
    </svg>
  );
}

/**
 * Timbre da aplicação: marca + wordmark + faixa da operação.
 *
 * Substitui o par "FaçaAmigos" + badge com o nome cru da unidade que se
 * repetia no cabeçalho e no título de cada tela. A operação vira a faixa
 * sob o wordmark — a mesma posição que a tagline ocupa no logotipo
 * oficial — e é ela, junto do ponto da marca, que carrega a cor da
 * operação. Assim o operador distingue a unidade de relance sem que o
 * logotipo mude de cor.
 */
export function BrandLockup({ operation, accent = "var(--color-pink)", size = "sm", style, title }: BrandLockupProps) {
  const s = SIZES[size];

  return (
    <div style={{ display: "flex", alignItems: "center", gap: `${s.gap}px`, ...style }} title={title}>
      <BrandMark size={s.mark} accent={accent} />

      <div style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 }}>
        <span
          style={{
            fontFamily: "var(--font-display)",
            fontSize: `${s.word}px`,
            lineHeight: 1,
            letterSpacing: "-0.01em",
            whiteSpace: "nowrap",
          }}
        >
          <span style={{ color: "var(--color-dark)" }}>Faça</span>
          <span style={{ color: "var(--color-pink)" }}>Amigos</span>
        </span>

        {operation && (
          <span
            style={{
              fontFamily: "var(--font-body)",
              fontSize: `${s.band}px`,
              fontWeight: 800,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: accent,
              lineHeight: 1.2,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {operation}
          </span>
        )}
      </div>
    </div>
  );
}
