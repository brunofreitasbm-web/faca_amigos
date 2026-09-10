import { useState } from "react";
import { Button, Modal, HelpText } from "@facaamigos/ui";
import { Api } from "../api/client.js";
import { money } from "../format.js";
import { CashPaymentPad } from "./CashPaymentPad.js";
import { OfflineQueuedError } from "../lib/supabase/offlineQueue.js";

const METHODS = ["DINHEIRO", "PIX", "CREDITO", "DEBITO"] as const;

/**
 * Cobrança do saldo pré-pago na Entrada — "o pai paga e vai embora".
 *
 * Modelado no PdvScreen (vender uma coisa por um preço fixo), não no
 * CheckoutModal: aqui não há sessão nenhuma para fechar, só um valor
 * fixo (o preço do plano/pacote com o desconto já aplicado) a cobrar.
 */
export function PrepaidPaymentModal({
  unitId,
  employeeId,
  activity,
  planId,
  packageId,
  priceCents,
  sourceName,
  child,
  guardian,
  couponCode,
  onClose,
  onSold,
}: {
  unitId: string;
  employeeId: string;
  activity: "PLAYGROUND" | "CARRINHO";
  planId: string | null;
  packageId: string | null;
  priceCents: number;
  sourceName: string;
  child: { id?: string; fullName: string; birthDate: string; inclusiveEligible: boolean; inclusiveProofType?: string };
  guardian: { id?: string; fullName: string; cpf: string; phoneE164: string };
  couponCode?: string;
  onClose: () => void;
  onSold: (result: { creditId: string; childId: string; guardianId: string; orderId: string; chargedCents: number; minutesTotal: number }) => void;
}) {
  const [method, setMethod] = useState<(typeof METHODS)[number]>("DINHEIRO");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const result = await Api.sellPrepaidCredit({
        unitId,
        activity,
        planId,
        packageId,
        guardian,
        child,
        couponCode,
        payments: [{ method, amountCents: priceCents }],
        employeeId,
      });
      onSold(result);
    } catch (err) {
      if (err instanceof OfflineQueuedError) {
        // Sem conexão: a cobrança ficou salva na fila e será concluída
        // quando a rede voltar — nada foi confirmado ainda, então não há
        // comprovante nenhum para mostrar ou imprimir agora.
        setError("Sem conexão — a cobrança foi salva e será concluída assim que a rede voltar. Não imprima nada ainda.");
      } else {
        setError(err instanceof Error ? err.message : "Erro ao vender o saldo");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Cobrar saldo pré-pago" onClose={onClose} maxWidth="420px">
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <div>
          <strong style={{ fontSize: "16px" }}>{sourceName}</strong>
          <div style={{ fontSize: "13px", color: "var(--text-muted)" }}>para {child.fullName}</div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontWeight: "bold", fontSize: "20px" }}>
          <span>Total</span>
          <span>{money(priceCents)}</span>
        </div>

        <HelpText>Escolha como o responsável vai pagar:</HelpText>
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
          {METHODS.map((m) => (
            <Button key={m} variant={method === m ? "primary" : "secondary"} size="sm" onClick={() => setMethod(m)} title={`Pagar via ${m}`}>
              {m}
            </Button>
          ))}
        </div>

        {error && <p style={{ color: "var(--color-error-text)" }}>{error}</p>}

        {method === "DINHEIRO" ? (
          <CashPaymentPad totalCents={priceCents} busy={busy} onConfirm={() => confirm()} />
        ) : (
          <Button variant="primary" fullWidth loading={busy} disabled={busy} onClick={confirm} title="Confirmar a cobrança com o método selecionado">
            Confirmar cobrança
          </Button>
        )}
      </div>
    </Modal>
  );
}
