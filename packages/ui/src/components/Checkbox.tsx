import { useId } from "react";
import type { CSSProperties, InputHTMLAttributes, ReactNode } from "react";

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "style" | "type" | "onChange"> {
  label: ReactNode;
  helpText?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  style?: CSSProperties;
}

/**
 * Alvo de toque de 44px mesmo a caixa visual sendo menor — o quadrado
 * desenhado é decorativo, quem recebe o clique/toque é o `<label>` inteiro.
 * Importante no tablet do quiosque, onde o operador não tem meia-polegada
 * de sobra para acertar uma caixinha de 18px.
 */
export function Checkbox({ label, helpText, checked, onChange, disabled = false, id, style: styleProp, ...rest }: CheckboxProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;

  return (
    <label
      htmlFor={inputId}
      style={{
        position: "relative",
        display: "flex",
        alignItems: "flex-start",
        gap: "10px",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        minHeight: "44px",
        padding: "4px 0",
        userSelect: "none",
        ...styleProp,
      }}
    >
      <span
        aria-hidden
        style={{
          flexShrink: 0,
          width: "24px",
          height: "24px",
          marginTop: "1px",
          borderRadius: "var(--radius-sm, 6px)",
          border: `2px solid ${checked ? "var(--color-teal)" : "var(--border-subtle)"}`,
          background: checked ? "var(--color-teal)" : "var(--surface-card)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "background var(--transition-fast), border-color var(--transition-fast)",
        }}
      >
        {checked && (
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M3 8.5L6.2 12L13 4" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      <input
        id={inputId}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        style={{
          position: "absolute",
          width: "1px",
          height: "1px",
          overflow: "hidden",
          clip: "rect(0 0 0 0)",
          whiteSpace: "nowrap",
        }}
        {...rest}
      />
      <span style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
        <span style={{ fontFamily: "var(--font-body)", fontWeight: "var(--weight-semibold)" as unknown as number, fontSize: "15px", color: "var(--text-primary)" }}>
          {label}
        </span>
        {helpText && (
          <span style={{ fontFamily: "var(--font-body)", fontSize: "12px", color: "var(--text-muted)" }}>{helpText}</span>
        )}
      </span>
    </label>
  );
}
