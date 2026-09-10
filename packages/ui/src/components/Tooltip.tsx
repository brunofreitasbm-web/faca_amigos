import { useRef, useState, type CSSProperties, type ReactNode } from "react";

export interface TooltipProps {
  label: string;
  children: ReactNode;
}

/**
 * Descritor em popup para controles que ficaram só com ícone (ex.: os
 * botões compactos do card do Painel — Sessão/Mudar Plano/Pulseira). O
 * `title` nativo já dava isso "de graça", mas sem controle de estilo/tempo
 * e sem funcionar em toque; aqui a régua decide isso explicitamente.
 */
export function Tooltip({ label, children }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement>(null);

  // TODO(human): implemente a exibição do tooltip.
  //
  // Isto roda tanto no balcão (mouse) quanto em telas de toque — hover puro
  // não existe em toque. Pontos a decidir:
  // - Quais eventos abrem/fecham (mouse enter/leave, focus/blur do botão
  //   dentro do wrapper, Escape, e o que fazer no toque)
  // - Um pequeno atraso antes de mostrar, para não "piscar" em passadas
  //   rápidas do mouse
  // - Posicionamento: acima do botão por padrão, sem vazar para fora do
  //   card em telas estreitas
  //
  // `visible`/`setVisible` já existem acima. Preencha os handlers do
  // wrapper abaixo e o estilo de posicionamento do `<span role="tooltip">`.

  const tooltipStyle: CSSProperties = {
    position: "absolute",
    zIndex: 20,
    padding: "4px 10px",
    borderRadius: "8px",
    background: "var(--color-gray-800)",
    color: "var(--text-on-primary)",
    fontSize: "12px",
    whiteSpace: "nowrap",
    pointerEvents: "none",
  };

  return (
    <span ref={wrapperRef} style={{ position: "relative", display: "inline-flex" }}>
      {children}
      {visible && (
        <span role="tooltip" style={tooltipStyle}>
          {label}
        </span>
      )}
    </span>
  );
}
