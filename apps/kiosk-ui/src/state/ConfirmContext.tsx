import { createContext, useCallback, useContext, useState } from "react";
import type { ReactNode } from "react";
import { Button, Card } from "@facaamigos/ui";

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "default";
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

type ConfirmValue = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmValue | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const confirm = useCallback<ConfirmValue>((options) => {
    return new Promise((resolve) => {
      setPending({ ...options, resolve });
    });
  }, []);

  function resolvePending(value: boolean) {
    pending?.resolve(value);
    setPending(null);
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 200,
          }}
        >
          <Card style={{ padding: "24px", width: "420px", maxWidth: "90vw" }}>
            <h2 style={{ marginTop: 0 }}>{pending.title}</h2>
            <p style={{ color: "var(--text-secondary)" }}>{pending.message}</p>
            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", marginTop: "16px" }}>
              <Button variant="ghost" onClick={() => resolvePending(false)}>
                {pending.cancelLabel ?? "Cancelar"}
              </Button>
              <Button variant="primary" onClick={() => resolvePending(true)}>
                {pending.confirmLabel ?? "Confirmar"}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmValue {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm precisa estar dentro de <ConfirmProvider>");
  return ctx;
}
