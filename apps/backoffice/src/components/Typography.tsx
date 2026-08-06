import type { ReactNode } from "react";

export function PageTitle({ children }: { children: ReactNode }) {
  return (
    <h1
      style={{
        marginTop: 0,
        fontFamily: "var(--font-body)",
        fontWeight: "var(--weight-extrabold)" as unknown as number,
        fontSize: "24px",
        color: "var(--text-primary)",
      }}
    >
      {children}
    </h1>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2
      style={{
        fontFamily: "var(--font-body)",
        fontWeight: "var(--weight-bold)" as unknown as number,
        fontSize: "15px",
        color: "var(--text-primary)",
        marginTop: "var(--space-8)",
        marginBottom: "var(--space-3)",
      }}
    >
      {children}
    </h2>
  );
}
