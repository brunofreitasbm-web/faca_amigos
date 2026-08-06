import { Button } from "@facaamigos/ui";

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
 */
export function PinPad({ value, onChange, onSubmit, disabled }: PinPadProps) {
  function press(digit: string) {
    if (value.length >= 6) return;
    onChange(value + digit);
  }

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
        <Button variant="ghost" size="lg" disabled={disabled} onClick={() => onChange(value.slice(0, -1))}>
          ⌫
        </Button>
      </div>
      <Button variant="primary" size="lg" fullWidth disabled={disabled || value.length !== 6} onClick={onSubmit}>
        Entrar
      </Button>
    </div>
  );
}
