"use client";

import { useActionState } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/design-system";
import { INITIAL_ACTION_RESULT, type ActionResult } from "@/lib/action-result";
import { FormFeedback } from "./FormFeedback";

export interface EntityFormProps {
  action: (prevState: ActionResult, formData: FormData) => Promise<ActionResult>;
  submitLabel: string;
  children: ReactNode;
}

export function EntityForm({ action, submitLabel, children }: EntityFormProps) {
  const [state, formAction, pending] = useActionState(action, INITIAL_ACTION_RESULT);

  return (
    <form
      action={formAction}
      style={{
        display: "flex",
        gap: "var(--gap-sm)",
        alignItems: "flex-end",
        flexWrap: "wrap",
      }}
    >
      {children}
      <Button type="submit" variant="teal" size="sm" loading={pending}>
        {submitLabel}
      </Button>
      <FormFeedback state={state} />
    </form>
  );
}
