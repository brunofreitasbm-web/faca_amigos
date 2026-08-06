import { useState } from "react";
import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";

export type ButtonVariant = "primary" | "teal" | "secondary" | "ghost" | "amber" | "dark";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
  children?: ReactNode;
}

const SIZES: Record<ButtonSize, CSSProperties> = {
  sm: { padding: "8px 20px", fontSize: "14px", height: "36px" },
  md: { padding: "12px 28px", fontSize: "16px", height: "44px" },
  lg: { padding: "15px 36px", fontSize: "18px", height: "52px" },
};

/**
 * Botão pill do design system. Portado de
 * Branding/fa-aamigos-design-system/project/components/core/Button.jsx,
 * tipado e com React importado explicitamente (a fonte usava o global
 * `React.useState`, que não existe fora de um bundler solto).
 *
 * `primary` (rosa) é elemento grande por construção — padding generoso,
 * nunca texto solto — porque #F0196B sobre branco não passa em AA para
 * texto normal (~4.15:1). Ver packages/ui/src/tokens/colors.css.
 */
export function Button({
  variant = "primary",
  size = "md",
  disabled = false,
  loading = false,
  fullWidth = false,
  children,
  style: styleProp,
  ...rest
}: ButtonProps) {
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);

  const scale = pressed ? "scale(0.96)" : hovered ? "scale(1.02)" : "scale(1)";

  const variants: Record<ButtonVariant, CSSProperties> = {
    primary: {
      background: "var(--color-pink)",
      color: "var(--text-on-primary)",
      border: "none",
      boxShadow: hovered ? "var(--shadow-pink)" : "none",
      transform: scale,
    },
    teal: {
      background: hovered ? "var(--color-secondary-hover)" : "var(--color-teal)",
      color: "var(--text-on-primary)",
      border: "none",
      boxShadow: hovered ? "var(--shadow-teal)" : "none",
      transform: scale,
    },
    secondary: {
      background: "transparent",
      color: "var(--color-primary-hover)",
      border: "2px solid var(--color-primary-hover)",
      boxShadow: "none",
      transform: pressed ? "scale(0.96)" : "scale(1)",
    },
    ghost: {
      background: hovered ? "rgba(240,25,107,0.10)" : "transparent",
      color: "var(--color-primary-hover)",
      border: "none",
      boxShadow: "none",
      transform: pressed ? "scale(0.96)" : "scale(1)",
    },
    amber: {
      background: hovered ? "#a8780e" : "var(--color-amber)",
      color: "var(--text-on-primary)",
      border: "none",
      boxShadow: "none",
      transform: scale,
    },
    dark: {
      background: hovered ? "var(--color-gray-700)" : "var(--color-gray-800)",
      color: "var(--text-on-primary)",
      border: "none",
      boxShadow: "none",
      transform: pressed ? "scale(0.96)" : "scale(1)",
    },
  };

  const style: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    borderRadius: "var(--radius-btn)",
    fontFamily: "var(--font-body)",
    fontWeight: "var(--weight-bold)" as unknown as number,
    letterSpacing: "0.01em",
    lineHeight: 1,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.45 : 1,
    transition: "all var(--transition-fast)",
    outline: "none",
    whiteSpace: "nowrap",
    width: fullWidth ? "100%" : "auto",
    ...SIZES[size],
    ...variants[variant],
    ...styleProp,
  };

  return (
    <button
      type="button"
      style={style}
      disabled={disabled}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        setPressed(false);
      }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      {...rest}
    >
      {loading ? <span style={{ opacity: 0.7 }}>…</span> : children}
    </button>
  );
}
