import { useId, useState } from "react";
import type { CSSProperties, ReactNode, SelectHTMLAttributes } from "react";

export type SelectVariant = "light" | "dark";

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "style"> {
  label?: string;
  error?: string;
  variant?: SelectVariant;
  style?: CSSProperties;
  children: ReactNode;
}

/**
 * Select do design system, irmão do Input (mesma altura de 48px, mesmo
 * anel de foco rosa). Existe porque `<select>` cru herda o cromo do
 * navegador (seta, fonte, borda) e destoa dos campos ao redor — mesmo
 * problema que motivou o Input customizado, só que ainda não resolvido
 * para select em nenhuma tela do quiosque (Painel, Entrada, Caixa,
 * Relatório, Configurações usavam `<select style={...}>` ad-hoc, cada
 * um com seu próprio raio/borda). A seta é um SVG proprio via
 * background-image porque `appearance: none` remove a nativa e navegadores
 * não deixam estilizar a seta original com CSS puro.
 */
export function Select({
  label,
  error,
  variant = "light",
  disabled = false,
  value,
  onChange,
  style: styleProp,
  id,
  children,
  ...rest
}: SelectProps) {
  const [focused, setFocused] = useState(false);
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const isDark = variant === "dark";

  const borderColor = error
    ? "var(--color-error)"
    : focused
      ? "var(--color-pink)"
      : isDark
        ? "rgba(255,255,255,0.15)"
        : "var(--border-subtle)";

  const caretColor = isDark ? "%23FFFFFF" : "%235A636E";

  const selectStyle: CSSProperties = {
    height: "48px",
    padding: "0 40px 0 16px",
    borderRadius: "var(--radius-input)",
    border: `1.5px solid ${borderColor}`,
    background: `${isDark ? "var(--color-bg-surface)" : "var(--surface-card)"} url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 256 256'%3E%3Cpath fill='${caretColor}' d='M213.66,101.66l-80,80a8,8,0,0,1-11.32,0l-80-80A8,8,0,0,1,53.66,90.34L128,164.69l74.34-74.35a8,8,0,0,1,11.32,11.32Z'/%3E%3C/svg%3E") no-repeat right 14px center`,
    color: isDark ? "#FFFFFF" : "var(--text-primary)",
    fontFamily: "var(--font-body)",
    fontSize: "16px",
    fontWeight: "var(--weight-regular)" as unknown as number,
    outline: "none",
    appearance: "none",
    WebkitAppearance: "none",
    transition: "border-color var(--transition-fast), box-shadow var(--transition-fast)",
    boxShadow: focused && !error ? "0 0 0 3px rgba(240,25,107,0.18)" : "none",
    opacity: disabled ? 0.5 : 1,
    cursor: disabled ? "not-allowed" : "pointer",
    width: "100%",
    boxSizing: "border-box",
    ...styleProp,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px", width: "100%" }}>
      {label && (
        <label
          htmlFor={selectId}
          style={{
            fontFamily: "var(--font-body)",
            fontWeight: "var(--weight-semibold)" as unknown as number,
            fontSize: "13px",
            color: isDark ? "rgba(255,255,255,0.65)" : "var(--text-secondary)",
            letterSpacing: "0.02em",
          }}
        >
          {label}
        </label>
      )}
      <select
        id={selectId}
        value={value}
        onChange={onChange}
        disabled={disabled}
        style={selectStyle}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${selectId}-error` : undefined}
        {...rest}
      >
        {children}
      </select>
      {error && (
        <span
          id={`${selectId}-error`}
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "12px",
            color: "var(--color-error-text)",
            fontWeight: "var(--weight-medium)" as unknown as number,
          }}
        >
          {error}
        </span>
      )}
    </div>
  );
}
