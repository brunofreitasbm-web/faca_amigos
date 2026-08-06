"use client";

import type { ActionResult } from "@/lib/action-result";

export function FormFeedback({ state }: { state: ActionResult }) {
  if (!state.message) return null;

  return (
    <span
      role="status"
      aria-live="polite"
      style={{
        fontFamily: "var(--font-body)",
        fontSize: "13px",
        fontWeight: "var(--weight-semibold)" as unknown as number,
        color: state.ok ? "var(--color-success)" : "var(--color-error)",
      }}
    >
      {state.message}
    </span>
  );
}
