import type { CSSProperties } from "react";
import { Card as UiCard } from "@facaamigos/ui";
import type { CardProps } from "@facaamigos/ui";

// Props de layout que as abas passam em `style` achando que valem para os
// filhos, mas o Card as aplica no elemento externo (os filhos moram num
// wrapper interno). Aqui elas vão para o miolo, onde a intenção original das
// abas passa a valer de fato.
const LAYOUT_KEYS = ["display", "flexDirection", "flexWrap", "gap", "rowGap", "columnGap", "justifyContent", "alignItems"] as const;

/**
 * Card do console gerencial: mesma aparência do Card do pacote ui, mas sem o
 * padding duplicado (o `padding` do `style` externo somava com o do miolo,
 * ~36px por lado) e com o miolo compacto. Não altera o Card do quiosque.
 */
export function Card({ style, bodyStyle, ...rest }: CardProps) {
  const outer: CSSProperties = { ...style };
  const inner: CSSProperties = { padding: "12px 14px" };
  for (const k of LAYOUT_KEYS) {
    if (outer[k] !== undefined) {
      (inner as Record<string, unknown>)[k] = outer[k];
      delete outer[k];
    }
  }
  delete outer.padding;
  return <UiCard style={outer} bodyStyle={{ ...inner, ...bodyStyle }} {...rest} />;
}


/** Formulário em grade: campos lado a lado, quebrando conforme a largura. */
export const FORM_GRID: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
  gap: "8px 12px",
  alignItems: "end",
};

/** Item que ocupa a linha inteira da FORM_GRID (título, unidades, botão). */
export const FULL_ROW: CSSProperties = { gridColumn: "1 / -1" };
