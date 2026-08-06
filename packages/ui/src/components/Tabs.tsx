import { useRef } from "react";
import type { CSSProperties, KeyboardEvent } from "react";
import { Button } from "./Button.js";

export interface TabsProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  tabs: Array<{ value: T; label: string }>;
  style?: CSSProperties;
}

/**
 * Barra de abas. Existiam duas cópias idênticas desse padrão
 * (ConfiguracoesScreen e RelatorioScreen — mesmo shape de estado, mesmo
 * `Button variant={ativo?"primary":"ghost"} size="sm"` em loop) e nenhuma
 * delas usava `role="tablist"`/`role="tab"`/`aria-selected` — a aba ativa
 * era sinalizada só pela cor do preenchimento do botão, e não havia
 * navegação por seta como qualquer leitor de tela espera de um conjunto
 * de abas.
 */
export function Tabs<T extends string>({ value, onChange, tabs, style }: TabsProps<T>) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  function onKeyDown(e: KeyboardEvent, index: number) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next = e.key === "ArrowRight" ? (index + 1) % tabs.length : (index - 1 + tabs.length) % tabs.length;
    const nextTab = tabs[next]!;
    onChange(nextTab.value);
    refs.current[nextTab.value]?.focus();
  }

  return (
    <div role="tablist" style={{ display: "flex", gap: "6px", flexWrap: "wrap", margin: "16px 0", ...style }}>
      {tabs.map((t, i) => (
        <Button
          key={t.value}
          ref={(el) => { refs.current[t.value] = el; }}
          role="tab"
          aria-selected={value === t.value}
          tabIndex={value === t.value ? 0 : -1}
          variant={value === t.value ? "primary" : "ghost"}
          size="sm"
          onClick={() => onChange(t.value)}
          onKeyDown={(e) => onKeyDown(e, i)}
          title={`Abrir aba ${t.label}`}
        >
          {t.label}
        </Button>
      ))}
    </div>
  );
}
