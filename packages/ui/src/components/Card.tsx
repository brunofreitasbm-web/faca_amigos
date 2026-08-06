import { useState } from "react";
import type { CSSProperties, HTMLAttributes, ReactNode } from "react";

export type CardVariant = "light" | "dark";

export interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  variant?: CardVariant;
  imageSrc?: string;
  imageAlt?: string;
  title?: ReactNode;
  subtitle?: ReactNode;
  children?: ReactNode;
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
  ...rest
}: CardProps) {
  const [hovered, setHovered] = useState(false);
  const isDark = variant === "dark";

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
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      {...rest}
    >
      {imageSrc && <img src={imageSrc} alt={imageAlt} style={imageStyle} />}
      <div style={{ padding: "16px 20px 20px" }}>
        {title && <p style={titleStyle}>{title}</p>}
        {subtitle && <p style={subtitleStyle}>{subtitle}</p>}
        {children}
      </div>
    </div>
  );
}
