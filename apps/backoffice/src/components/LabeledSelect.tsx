import type { SelectHTMLAttributes } from "react";

export interface LabeledSelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
}

export function LabeledSelect({ label, children, ...rest }: LabeledSelectProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      <label
        style={{
          fontFamily: "var(--font-body)",
          fontWeight: "var(--weight-semibold)" as unknown as number,
          fontSize: "13px",
          color: "var(--text-secondary)",
        }}
      >
        {label}
      </label>
      <select className="fa-select" {...rest}>
        {children}
      </select>
    </div>
  );
}
