import { useEffect, useState } from "react";
import { Button } from "@facaamigos/ui";
import type { ReceiptPrintPayload } from "@facaamigos/domain";
import { Api } from "../api/client.js";
import { ReceiptPrintModal } from "../components/ReceiptPrintModal.js";
import { clearPendingTap, parseTapReturn, readPendingTap } from "../lib/infinitepayTap.js";

/**
 * Tela que recebe o operador de volta depois de uma cobrança via InfiniteTap
 * (o app InfinitePay reabre o kiosk em `?tap_retorno=1&order_id=...`). Como
 * essa volta pode recarregar a página do zero, tudo que é preciso para
 * concluir a venda vem do localStorage (ver infinitepayTap.ts), não de
 * estado React herdado da tela que iniciou a cobrança.
 */
export function TapReturnScreen({ search, onDone }: { search: string; onDone: () => void }) {
  const [status, setStatus] = useState<"processing" | "error" | "done">("processing");
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [receipts, setReceipts] = useState<ReceiptPrintPayload[]>([]);

  useEffect(() => {
    const result = parseTapReturn(search);
    if (!result) {
      setError("Retorno do InfiniteTap inválido.");
      setStatus("error");
      return;
    }

    const pending = readPendingTap(result.orderId);
    if (!pending) {
      setError(
        "Não encontramos os dados dessa cobrança neste aparelho (aba recarregada ou cache limpo). Confira no app InfinitePay se o pagamento foi aprovado e registre a venda manualmente se necessário.",
      );
      setStatus("error");
      return;
    }

    if (!result.success) {
      clearPendingTap(result.orderId);
      setError(`O pagamento não foi concluído no InfiniteTap${result.warning ? ` (${result.warning})` : ""}. Tente novamente.`);
      setStatus("error");
      return;
    }

    (async () => {
      try {
        const payment = { method: pending.method, amountCents: pending.amountCents, nsu: result.nsu, authorization: result.authorization };
        if (pending.kind === "checkout") {
          const r = await Api.checkout({
            sessionIds: pending.sessionIds,
            employeeId: pending.employeeId,
            payments: [payment],
            closedAtMs: pending.closedAtMs,
          });
          setReceipts(pending.receiptsBase.map((base) => ({ ...base, code: r.orderCode }) as ReceiptPrintPayload));
        } else {
          const r = await Api.pdvOrder({
            unitId: pending.unitId,
            employeeId: pending.employeeId,
            items: pending.items,
            payments: [payment],
          });
          setSuccessMessage(`Venda registrada! Código: ${r.orderCode}`);
        }
        setStatus("done");
      } catch (err) {
        setError(
          err instanceof Error
            ? `Pagamento aprovado no InfiniteTap, mas houve erro ao registrar no sistema: ${err.message}. Anote o NSU/Autorização mostrados no app InfinitePay e acione o suporte.`
            : "Erro ao confirmar a cobrança.",
        );
        setStatus("error");
      } finally {
        clearPendingTap(result.orderId);
      }
    })();
  }, [search]);

  function finish() {
    window.history.replaceState({}, "", window.location.pathname);
    onDone();
  }

  if (status === "processing") {
    return <div style={{ padding: "80px", textAlign: "center", color: "var(--text-muted)" }}>Confirmando pagamento do InfiniteTap…</div>;
  }

  if (receipts.length > 0) {
    return (
      <>
        {receipts.map((r, i) => (
          <ReceiptPrintModal key={i} data={r} onClose={() => setReceipts((prev) => prev.filter((_, idx) => idx !== i))} />
        ))}
      </>
    );
  }

  return (
    <div style={{ padding: "40px", maxWidth: "480px", margin: "0 auto", textAlign: "center" }}>
      {error && <p style={{ color: "var(--color-error-text)", fontWeight: 600 }}>{error}</p>}
      {successMessage && <p style={{ color: "var(--color-teal-text)", fontWeight: 600 }}>{successMessage}</p>}
      {status === "done" && !error && !successMessage && <p style={{ color: "var(--color-teal-text)", fontWeight: 600 }}>Pagamento confirmado.</p>}
      <Button variant="primary" onClick={finish}>
        Continuar
      </Button>
    </div>
  );
}
