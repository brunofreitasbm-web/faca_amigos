import { useEffect } from "react";
import { Button, BackspaceIcon } from "@facaamigos/ui";

interface PinPadProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
}

/**
 * Teclado numérico clicável (princípio de produto: operação do dia a
 * dia deve ser mais clicável, digitar o mínimo). Usado para PIN de
 * login e troca rápida de operador entre atendimentos (seção 7.1).
 *
 * Além dos botões na tela, escuta o teclado físico via `keydown` global:
 * balcões com teclado numérico USB conectado não devem obrigar o operador
 * a tocar na tela para cada dígito. `document`, não um `onKeyDown` no
 * container, porque o foco pode estar em qualquer lugar (o teclado numérico
 * costuma nem ter um elemento pra focar) — e some ao desmontar, então dois
 * PinPad nunca competem pelo mesmo evento.
 */
export function PinPad({ value, onChange, onSubmit, disabled }: PinPadProps) {
  function press(digit: string) {
    if (value.length >= 6) return;
    onChange(value + digit);
  }

  useEffect(() => {
    if (disabled) return;
    function handleKeydown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        onChange((value + e.key).slice(0, 6));
      } else if (e.key === "Backspace") {
        e.preventDefault();
        onChange(value.slice(0, -1));
      } else if (e.key === "Escape") {
        e.preventDefault();
        onChange("");
      } else if (e.key === "Enter") {
        if (value.length === 6) {
          e.preventDefault();
          onSubmit();
        }
      }
    }
    document.addEventListener("keydown", handleKeydown);
    return () => document.removeEventListener("keydown", handleKeydown);
  }, [value, onChange, onSubmit, disabled]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px", alignItems: "center" }}>
      <div style={{ fontFamily: "var(--font-body)", fontSize: "28px", letterSpacing: "8px", minHeight: "36px" }}>
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
      <Button variant="primary" size="lg" fullWidth disabled={disabled || value.length !== 6} onClick={onSubmit}>
        Entrar
      </Button>
    </div>
  );
}
