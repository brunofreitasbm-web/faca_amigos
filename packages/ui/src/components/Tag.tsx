import type { CSSProperties, HTMLAttributes, ReactNode } from "react";

export interface TagProps extends Omit<HTMLAttributes<HTMLSpanElement>, "color"> {
  children?: ReactNode;
  color?: string;
  onRemove?: () => void;
}

/**
 * Portado de components/core/Tag.jsx, reescrito para light mode — a
 * fonte era fixa em fundo escuro (`--color-bg-raised`, texto branco,
 * borda branca translúcida), que não existe nas telas do quiosque.
 */
export function Tag({ children, color, onRemove, style: styleProp, ...rest }: TagProps) {
  const accent = color ?? "var(--color-teal)";

  const style: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    padding: "6px 14px",
    borderRadius: "var(--radius-full)",
    background: "var(--surface-raised)",
    border: "1px solid var(--border-subtle)",
    fontFamily: "var(--font-body)",
    fontWeight: "var(--weight-medium)" as unknown as number,
    fontSize: "13px",
    color: "var(--text-primary)",
    lineHeight: 1,
    ...styleProp,
  };

  return (
    <span style={style} {...rest}>
      <span
        style={{
          width: "8px",
          height: "8px",
          borderRadius: "50%",
          background: accent,
          flexShrink: 0,
        }}
      />
      {children}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remover"
          style={{
            width: "16px",
            height: "16px",
            borderRadius: "50%",
            background: "var(--color-gray-300)",
            border: "none",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "10px",
            color: "var(--text-primary)",
            padding: 0,
            lineHeight: 1,
            flexShrink: 0,
          }}
        >
          ✕
        </button>
      )}
    </span>
  );
}
