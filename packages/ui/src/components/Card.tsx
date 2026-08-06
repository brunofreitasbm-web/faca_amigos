import { useState } from "react";
import type { CSSProperties, HTMLAttributes, MouseEvent, ReactNode } from "react";

export type CardVariant = "light" | "dark";

export interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  variant?: CardVariant;
  imageSrc?: string;
  imageAlt?: string;
  title?: ReactNode;
  subtitle?: ReactNode;
  children?: ReactNode;
  /**
   * Estilo do miolo, onde os filhos realmente moram.
   *
   * Existe porque `style` cai no elemento externo, e os filhos ficam num
   * wrapper com padding próprio — então um `display:flex` passado em
   * `style` nunca alcançava o conteúdo, e layouts que dependiam disso
   * (colunas com `gap`, rodapé empurrado com `marginTop:auto`) viravam
   * empilhamento de bloco sem espaçamento, silenciosamente.
   */
  bodyStyle?: CSSProperties;
}

/**
 * Portado de components/core/Card.jsx. Variante padrão trocada para
 * `light` (decisão do usuário: telas do quiosque são light) — a
 * variante `dark` é preservada para telas que eventualmente precisem
 * do visual do app de marca (ex. material de marketing embutido).
 */
export function Card({
  variant = "light",
  imageSrc,
  imageAlt = "",
  title,
  subtitle,
  children,
  onClick,
  style: styleProp,
  bodyStyle,
  role: roleProp,
  tabIndex: tabIndexProp,
  onKeyDown: onKeyDownProp,
  ...rest
}: CardProps) {
  const [hovered, setHovered] = useState(false);
  const isDark = variant === "dark";
  // Card com onClick é a superfície de interação mais usada do quiosque
  // (selecionar sessão, plano, carrinho, funcionário...) e sempre foi um
  // <div> puro — sem role, sem tabIndex, sem tecla. Ou seja: nenhum desses
  // fluxos era alcançável por teclado. Como o corpo do card costuma conter
  // botões reais próprios (imprimir, ações da sessão), virar um <button>
  // de verdade aninharia controle-em-controle; o padrão correto aqui é
  // div com role="button" + tabIndex + Enter/Espaço, igual a um card de
  // "ação primária" nas WAI-ARIA Authoring Practices.
  const isInteractive = Boolean(onClick);
  const role = roleProp ?? (isInteractive ? "button" : undefined);
  const tabIndex = tabIndexProp ?? (isInteractive ? 0 : undefined);

  const cardStyle: CSSProperties = {
    borderRadius: "var(--radius-card)",
    overflow: "hidden",
    background: isDark ? "var(--color-bg-card)" : "var(--surface-card)",
    boxShadow: hovered
      ? isDark
        ? "0 8px 32px rgba(0,0,0,0.5)"
        : "var(--shadow-lg)"
      : isDark
        ? "var(--shadow-md)"
        : "var(--shadow-sm)",
    cursor: onClick ? "pointer" : "default",
    transition: "box-shadow var(--transition-normal), transform var(--transition-normal)",
    transform: hovered && onClick ? "translateY(-2px)" : "translateY(0)",
    ...styleProp,
  };

  const imageStyle: CSSProperties = {
    width: "100%",
    aspectRatio: "16/9",
    objectFit: "cover",
    display: "block",
  };

  const titleStyle: CSSProperties = {
    fontFamily: "var(--font-body)",
    fontWeight: "var(--weight-extrabold)" as unknown as number,
    fontSize: "18px",
    color: isDark ? "#FFFFFF" : "var(--text-primary)",
    margin: "0 0 4px",
    lineHeight: "var(--leading-snug)" as unknown as number,
  };

  const subtitleStyle: CSSProperties = {
    fontFamily: "var(--font-body)",
    fontWeight: "var(--weight-regular)" as unknown as number,
    fontSize: "14px",
    color: isDark ? "rgba(255,255,255,0.55)" : "var(--text-muted)",
    margin: "0 0 12px",
    lineHeight: "var(--leading-normal)" as unknown as number,
  };

  return (
    <div
      style={cardStyle}
      onClick={onClick}
      role={role}
      tabIndex={tabIndex}
      onKeyDown={(e) => {
        onKeyDownProp?.(e);
        if (e.defaultPrevented) return;
        if (isInteractive && (e.key === "Enter" || e.key === " ")) {
          // Espaço rola a página em elementos focáveis por padrão do
          // navegador — precisa do preventDefault antes de disparar.
          e.preventDefault();
          onClick!(e as unknown as MouseEvent<HTMLDivElement>);
        }
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      {...rest}
    >
      {imageSrc && <img src={imageSrc} alt={imageAlt} style={imageStyle} />}
      <div style={{ padding: "16px 20px 20px", ...bodyStyle }}>
        {title && <p style={titleStyle}>{title}</p>}
        {subtitle && <p style={subtitleStyle}>{subtitle}</p>}
        {children}
      </div>
    </div>
  );
}
