import { useId, useState } from "react";
import type { CSSProperties, InputHTMLAttributes } from "react";

export type InputVariant = "light" | "dark";

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "style"> {
  label?: string;
  error?: string;
  variant?: InputVariant;
  style?: CSSProperties;
}

/**
 * Portado de components/core/Input.jsx. `light` virou o padrão
 * (era `dark` na fonte) porque os formulários do quiosque — check-in,
 * PDV, caixa — são a tela mais densa em texto e leitura, e light mode
 * foi a escolha do usuário para toda a operação. Altura de 48px
 * mantida: é acima do mínimo recomendado de alvo de toque (44px),
 * relevante porque o check-in roda em tablet.
 */
export function Input({
  label,
  placeholder,
  type = "text",
  variant = "light",
  error,
  disabled = false,
  value,
  onChange,
  style: styleProp,
  id,
  ...rest
}: InputProps) {
  const [focused, setFocused] = useState(false);
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const isDark = variant === "dark";

  const borderColor = error
    ? "var(--color-error)"
    : focused
      ? "var(--color-pink)"
      : isDark
        ? "rgba(255,255,255,0.15)"
        : "var(--border-subtle)";

  const inputStyle: CSSProperties = {
    height: "48px",
    padding: "0 16px",
    borderRadius: "var(--radius-input)",
    border: `1.5px solid ${borderColor}`,
    background: isDark ? "var(--color-bg-surface)" : "var(--surface-card)",
    color: isDark ? "#FFFFFF" : "var(--text-primary)",
    fontFamily: "var(--font-body)",
    fontSize: "16px",
    fontWeight: "var(--weight-regular)" as unknown as number,
    outline: "none",
    transition: "border-color var(--transition-fast), box-shadow var(--transition-fast)",
    boxShadow: focused && !error ? "0 0 0 3px rgba(240,25,107,0.18)" : "none",
    opacity: disabled ? 0.5 : 1,
    cursor: disabled ? "not-allowed" : "text",
    width: "100%",
    boxSizing: "border-box",
    ...styleProp,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px", width: "100%" }}>
      {label && (
        <label
          htmlFor={inputId}
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
      <input
        id={inputId}
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        disabled={disabled}
        style={inputStyle}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${inputId}-error` : undefined}
        {...rest}
      />
      {error && (
        <span
          id={`${inputId}-error`}
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "12px",
            // -text, não --color-error puro: aqui é texto (4.29:1,
            // abaixo de AA), a borda logo acima pode continuar com a
            // cor de marca porque contraste de borda exige só 3:1.
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
