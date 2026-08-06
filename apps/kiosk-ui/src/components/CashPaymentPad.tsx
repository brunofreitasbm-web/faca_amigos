import { useState } from "react";
import { Button } from "@facaamigos/ui";
import { money } from "../format.js";

const BANKNOTES_CENTS = [200, 500, 1000, 2000, 5000, 10000];

interface CashPaymentPadProps {
  totalCents: number;
  busy: boolean;
  onConfirm: (tenderedCents: number) => void;
}

/**
 * Cobrança em dinheiro por cédula (seção do plano sobre reduzir erro humano
 * no caixa): o operador toca as cédulas recebidas em vez de digitar/calcular
 * troco de cabeça. O valor recebido é só para exibir o troco em destaque —
 * a API de fechamento/PDV continua recebendo apenas o valor total cobrado.
 */
export function CashPaymentPad({ totalCents, busy, onConfirm }: CashPaymentPadProps) {
  const [tenderedCents, setTenderedCents] = useState(0);

  const changeCents = tenderedCents - totalCents;
  const canConfirm = tenderedCents >= totalCents;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
        {BANKNOTES_CENTS.map((note) => (
          <Button
            key={note}
            variant="secondary"
            size="lg"
            title={`Somar cédula de ${money(note)} ao valor recebido`}
            onClick={() => setTenderedCents((prev) => prev + note)}
            style={{ minWidth: "84px", fontSize: "16px", fontWeight: "bold" }}
          >
            {money(note)}
          </Button>
        ))}
        <Button
          variant="secondary"
          size="lg"
          title="Definir o valor recebido como exatamente o total devido"
          onClick={() => setTenderedCents(totalCents)}
          style={{ minWidth: "84px", fontSize: "14px" }}
        >
          Valor Exato
        </Button>
        <Button variant="ghost" size="lg" title="Zerar o valor recebido" onClick={() => setTenderedCents(0)}>
          Limpar
        </Button>
      </div>

      <div
        style={{
          textAlign: "center",
          padding: "16px",
          borderRadius: "16px",
          background: canConfirm ? "rgba(46, 207, 181, 0.12)" : "rgba(240, 25, 107, 0.06)",
          border: `2px solid ${canConfirm ? "var(--color-teal)" : "var(--border-subtle)"}`,
        }}
      >
        <div style={{ fontSize: "13px", color: "var(--text-muted)" }}>Recebido: {money(tenderedCents)}</div>
        <div style={{ fontSize: "32px", fontWeight: "bold", color: canConfirm ? "var(--color-teal)" : "var(--color-primary)" }}>
          {canConfirm ? `Troco: ${money(changeCents)}` : `Faltam ${money(totalCents - tenderedCents)}`}
        </div>
      </div>

      <Button
        variant="primary"
        fullWidth
        loading={busy}
        disabled={busy || !canConfirm}
        onClick={() => onConfirm(tenderedCents)}
        title="Confirmar o pagamento em dinheiro com o valor recebido informado"
      >
        Confirmar Pagamento
      </Button>
    </div>
  );
}
