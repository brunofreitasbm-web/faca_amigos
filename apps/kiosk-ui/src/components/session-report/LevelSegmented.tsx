import type { CSSProperties } from "react";
import { SESSION_REPORT_LEVELS, SESSION_REPORT_LEVEL_LABEL, type SessionReportLevel } from "@facaamigos/domain";

/** Cor de fundo do botão selecionado e cor do texto sobre ela (contraste AA). */
const LEVEL_STYLE: Record<SessionReportLevel, { bg: string; fg: string }> = {
  APOIO: { bg: "var(--color-amber)", fg: "#1a1a1a" },
  DESENVOLVENDO: { bg: "var(--color-teal)", fg: "#0b2e28" },
  AUTONOMO: { bg: "var(--color-primary)", fg: "#ffffff" },
};

interface Props {
  value: SessionReportLevel | null | undefined;
  onChange?: (next: SessionReportLevel | null) => void;
  /** Só exibe (histórico do Gerencial): botões não clicáveis e menores. */
  readOnly?: boolean;
  /** Nome do item, para leitores de tela. */
  label: string;
}

/**
 * Três botões grandes, um toque por item. Tocar no já selecionado desmarca
 * (item volta a "não respondido"), para o profissional corrigir sem menu.
 */
export function LevelSegmented({ value, onChange, readOnly = false, label }: Props) {
  const height = readOnly ? 34 : 56;
  return (
    <div role="group" aria-label={label} style={{ display: "flex", gap: "6px", width: "100%" }}>
      {SESSION_REPORT_LEVELS.map((level) => {
        const selected = value === level;
        const meta = SESSION_REPORT_LEVEL_LABEL[level];
        const s = LEVEL_STYLE[level];
        const style: CSSProperties = {
          flex: 1,
          minHeight: `${height}px`,
          padding: readOnly ? "4px 6px" : "6px 8px",
          borderRadius: "12px",
          border: selected ? "2px solid transparent" : "1px solid var(--border-subtle)",
          background: selected ? s.bg : "var(--surface-card)",
          color: selected ? s.fg : "var(--text-muted)",
          fontFamily: "inherit",
          fontSize: readOnly ? "12px" : "14px",
          fontWeight: selected ? 700 : 500,
          lineHeight: 1.15,
          cursor: readOnly ? "default" : "pointer",
          opacity: readOnly && !selected ? 0.45 : 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "4px",
          flexWrap: "wrap",
          textAlign: "center",
        };
        return (
          <button
            key={level}
            type="button"
            aria-pressed={selected}
            disabled={readOnly}
            onClick={() => onChange?.(selected ? null : level)}
            style={style}
          >
            <span aria-hidden="true">{meta.emoji}</span>
            <span>{meta.short}</span>
          </button>
        );
      })}
    </div>
  );
}
