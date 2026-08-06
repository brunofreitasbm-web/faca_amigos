import type { CSSProperties } from "react";

export interface AsyncStateProps {
  /** "Carregando…" — spinner + texto. */
  kind: "loading" | "empty" | "error";
  title: string;
  detail?: string;
  style?: CSSProperties;
}

/**
 * Bloco compartilhado pra carregando/vazio/erro.
 *
 * Existia um caso em cada tela — 36 buscas assíncronas no quiosque, 0
 * com estado de carregando, 0 com estado de erro — e o efeito prático
 * era o pior possível: "carregando" e "vazio de verdade" renderizavam
 * exatamente igual (nada), então toda tela mostrava por um instante um
 * estado vazio confiante e errado antes do dado real chegar. No Painel
 * isso significava "Nenhuma criança em atividade" bem na tela que
 * decide quem paga. Este componente não resolve tudo sozinho — cada
 * tela ainda decide QUANDO mostrar cada `kind` — mas garante que os
 * três casos ao menos *parecem* diferentes um do outro.
 */
export function AsyncState({ kind, title, detail, style }: AsyncStateProps) {
  const icon = kind === "loading" ? "⏳" : kind === "error" ? "⚠️" : "📭";
  const color = kind === "error" ? "var(--color-error-text)" : "var(--text-muted)";

  return (
    <div
      role={kind === "error" ? "alert" : undefined}
      style={{
        padding: "48px 24px",
        textAlign: "center",
        background: "var(--surface-card)",
        borderRadius: "16px",
        border: kind === "error" ? "1px solid var(--color-error)" : "1px dashed var(--border-subtle)",
        ...style,
      }}
    >
      {/* Ícone estático, sem spinner girando — mesma regra do resto do
          produto (packages/ui/src/tokens/print.css): nada de loop
          infinito de movimento em UI. */}
      <div aria-hidden="true" style={{ fontSize: "28px", marginBottom: "8px" }}>
        {icon}
      </div>
      <p style={{ fontSize: "16px", color, margin: 0, fontWeight: kind === "error" ? "bold" as const : "normal" as const }}>{title}</p>
      {detail && <p style={{ fontSize: "13px", color: "var(--text-muted)", margin: "6px 0 0 0" }}>{detail}</p>}
    </div>
  );
}
