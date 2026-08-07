import type { CSSProperties, ReactNode } from "react";

export interface HelpTextProps {
  children: ReactNode;
  icon?: ReactNode;
  style?: CSSProperties;
}

/**
 * Legenda curta e sempre visível (não é tooltip de hover — o quiosque é
 * touch, ninguém passa o mouse em cima de nada) explicando em português
 * simples o que uma tela, seção ou grupo de botões faz. Existe porque o
 * operador do balcão é leigo em sistemas: rótulos como "Confirmar" ou
 * "PIX" fazem sentido pra quem já usa o sistema há meses, não pra quem
 * está treinando na primeira semana.
 */
export function HelpText({ children, icon = "ℹ️", style }: HelpTextProps) {
  return (
    <p
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "6px",
        margin: 0,
        fontSize: "13px",
        lineHeight: "var(--leading-normal)" as unknown as number,
        color: "var(--text-muted)",
        ...style,
      }}
    >
      <span aria-hidden="true">{icon}</span>
      <span>{children}</span>
    </p>
  );
}
