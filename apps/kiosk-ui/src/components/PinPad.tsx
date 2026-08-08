import { useEffect, useState } from "react";
import { Button, BackspaceIcon } from "@facaamigos/ui";

interface PinPadProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (pin?: string) => void;
  disabled?: boolean;
  hasError?: boolean;
}

/**
 * Teclado numérico clicável (princípio de produto: operação do dia a
 * dia deve ser mais clicável, digitar o mínimo). Usado para PIN de
 * login e troca rápida de operador entre atendimentos (seção 7.1).
 *
 * Entra automaticamente ao atingir 6 dígitos (dispensa o Enter).
 * Além dos botões na tela, escuta o teclado físico via `keydown` global.
 */
export function PinPad({ value, onChange, onSubmit, disabled, hasError }: PinPadProps) {
  const [shaking, setShaking] = useState(false);

  useEffect(() => {
    if (hasError) {
      setShaking(true);
      const timer = setTimeout(() => setShaking(false), 450);
      return () => clearTimeout(timer);
    }
  }, [hasError]);

  function press(digit: string) {
    if (disabled || value.length >= 6) return;
    const next = value + digit;
    onChange(next);
    if (next.length === 6) {
      onSubmit(next);
    }
  }

  useEffect(() => {
    if (disabled) return;
    function handleKeydown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^[0-9]$/.test(e.key)) {
        if (value.length < 6) {
          e.preventDefault();
          const next = value + e.key;
          onChange(next);
          if (next.length === 6) {
            onSubmit(next);
          }
        }
      } else if (e.key === "Backspace") {
        e.preventDefault();
        onChange(value.slice(0, -1));
      } else if (e.key === "Escape") {
        e.preventDefault();
        onChange("");
      } else if (e.key === "Enter") {
        if (value.length === 6) {
          e.preventDefault();
          onSubmit(value);
        }
      }
    }
    document.addEventListener("keydown", handleKeydown);
    return () => document.removeEventListener("keydown", handleKeydown);
  }, [value, onChange, onSubmit, disabled]);

  return (
    <div className={shaking ? "pin-pad-shake" : ""} style={{ display: "flex", flexDirection: "column", gap: "12px", alignItems: "center" }}>
      <div
        style={{
          fontFamily: "var(--font-body)",
          fontSize: "28px",
          letterSpacing: "8px",
          minHeight: "36px",
          color: hasError ? "var(--color-error-text, #ef4444)" : "inherit",
          transition: "color 0.2s ease",
        }}
      >
        {"•".repeat(value.length).padEnd(6, "○")}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 64px)", gap: "10px" }}>
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <Button key={d} variant="secondary" size="lg" disabled={disabled} onClick={() => press(d)}>
            {d}
          </Button>
        ))}
        <Button variant="ghost" size="lg" disabled={disabled} onClick={() => onChange("")}>
          limpar
        </Button>
        <Button variant="secondary" size="lg" disabled={disabled} onClick={() => press("0")}>
          0
        </Button>
        <Button variant="ghost" size="lg" disabled={disabled} onClick={() => onChange(value.slice(0, -1))} aria-label="Apagar último dígito">
          <BackspaceIcon />
        </Button>
      </div>
      <Button variant="primary" size="lg" fullWidth disabled={disabled || value.length !== 6} onClick={() => onSubmit(value)}>
        {disabled ? "Validando…" : "Entrar"}
      </Button>
    </div>
  );
}
