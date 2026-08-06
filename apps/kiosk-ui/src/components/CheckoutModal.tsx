import { useState } from "react";
import { Button, Card } from "@facaamigos/ui";
import { Api } from "../api/client.js";
import type { ActiveSessionEntry } from "../api/client.js";
import { useAppState } from "../state/AppState.js";
import { money } from "../format.js";

const METHODS = ["DINHEIRO", "PIX", "CREDITO", "DEBITO"] as const;

export function CheckoutModal({
  entries,
  onClose,
  onDone,
}: {
  entries: ActiveSessionEntry[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { employee } = useAppState();
  const [method, setMethod] = useState<(typeof METHODS)[number]>("PIX");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalCents = entries.reduce((sum, e) => sum + e.quote.totalCents, 0);

  async function confirm() {
    if (!employee) return;
    setBusy(true);
    setError(null);
    try {
      await Api.checkout({
        sessionIds: entries.map((e) => e.session.id),
        employeeId: employee.id,
        payments: [{ method, amountCents: totalCents }],
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao fechar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
      <Card style={{ padding: "24px", width: "420px", maxWidth: "90vw" }}>
        <h2>Fechar atendimento</h2>
        {entries.map((e) => (
          <div key={e.session.id} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
            <span>{e.session.child_name_snapshot}</span>
            <span>{money(e.quote.totalCents)}</span>
          </div>
        ))}
        <hr />
        <div style={{ display: "flex", justifyContent: "space-between", fontWeight: "bold", fontSize: "20px" }}>
          <span>Total</span>
          <span>{money(totalCents)}</span>
        </div>

        <div style={{ display: "flex", gap: "8px", margin: "16px 0", flexWrap: "wrap" }}>
          {METHODS.map((m) => (
            <Button key={m} variant={method === m ? "primary" : "secondary"} size="sm" onClick={() => setMethod(m)}>
              {m}
            </Button>
          ))}
        </div>

        {error && <p style={{ color: "var(--color-error)" }}>{error}</p>}

        <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={confirm} disabled={busy}>
            Confirmar pagamento
          </Button>
        </div>
      </Card>
    </div>
  );
}
