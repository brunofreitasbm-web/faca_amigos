import type { ReactNode } from "react";
import { HelpText } from "./design-system";

export function PageTitle({ children, description }: { children: ReactNode; description?: ReactNode }) {
  return (
    <div style={{ marginBottom: description ? "var(--space-3)" : undefined }}>
      <h1
        style={{
          marginTop: 0,
          marginBottom: description ? "4px" : undefined,
          fontFamily: "var(--font-body)",
          fontWeight: "var(--weight-extrabold)" as unknown as number,
          fontSize: "24px",
          color: "var(--text-primary)",
        }}
      >
        {children}
      </h1>
      {description && <HelpText>{description}</HelpText>}
    </div>
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
