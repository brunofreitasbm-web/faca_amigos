import { useState } from "react";
import { Button, Badge, HelpText } from "@facaamigos/ui";
import { Api } from "../api/client.js";
import type { UpsellOffer } from "../api/client.js";
import { useAppState } from "../state/AppState.js";
import { useToast } from "../state/ToastContext.js";
import { CashPaymentPad } from "./CashPaymentPad.js";
import { money } from "../format.js";

const METHODS = ["PIX", "CREDITO", "DEBITO", "DINHEIRO"] as const;

interface UpsellOfferCardProps {
  offer: UpsellOffer;
  /** Chamado depois de vender ou recusar — a tela some com o card. */
  onResolved: (outcome: "ACEITA" | "RECUSADA") => void;
}

/**
 * Card de oferta de upgrade — o script de venda que o operador LÊ.
 *
 * Três decisões de interface, todas ditadas pelo balcão e não pela tela:
 *
 * 1. POSIÇÃO. Fica acima do nome da criança, antes de qualquer campo. O
 *    operador tem um instante entre reconhecer a família e começar a
 *    digitar; se a oferta aparecesse depois do formulário, ela chegaria
 *    quando a conversa já virou "então é o plano de 1 hora?" — tarde
 *    demais para propor outra coisa.
 *
 * 2. TIPOGRAFIA. O script é 18px/1.6 com o texto quebrando em linhas
 *    curtas. Não é estética: é um texto para ser lido em voz alta, de
 *    relance, olhando para cima entre uma frase e outra. Os quatro
 *    números que mudam a decisão (gasto, diferença, custo/hora antes e
 *    depois) aparecem também como chips separados, porque procurar um
 *    valor no meio de um parágrafo é onde o operador tropeça e o cliente
 *    percebe que está sendo lido um roteiro.
 *
 * 3. AS DUAS AÇÕES TÊM O MESMO PESO VISUAL. "Recusado" não é um link
 *    apagadinho no canto. Um botão de recusa escondido não faz o cliente
 *    aceitar mais — faz o operador não registrar a recusa, e aí o
 *    cooldown de 15 dias nunca é aplicado e a mesma família ouve o mesmo
 *    script na visita seguinte. O registro honesto da recusa é o que
 *    protege a relação com o cliente.
 *
 * A cor é o laranja de conversão da paleta (`--color-orange`), o único
 * lugar do sistema onde ela aparece — nada mais no fluxo de Entrada é
 * laranja, então o card não compete com o verde (confirmação) nem com o
 * rosa (ação primária).
 */
export function UpsellOfferCard({ offer, onResolved }: UpsellOfferCardProps) {
  const { employee } = useAppState();
  const toast = useToast();
  const [paying, setPaying] = useState(false);
  const [method, setMethod] = useState<(typeof METHODS)[number]>("PIX");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pkg = offer.package;
  if (!offer.eligible || !pkg || !offer.offerId) return null;

  const deltaCents = offer.deltaCents ?? 0;

  async function recusar() {
    if (!offer.offerId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await Api.upsellRecusar(offer.offerId, employee?.id);
      toast.success(`Recusa registrada. Esta oferta não volta a aparecer por ${res.cooldownDays} dias.`);
      onResolved("RECUSADA");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível registrar a recusa.");
    } finally {
      setBusy(false);
    }
  }

  async function vender() {
    if (!offer.offerId || !employee) return;
    setBusy(true);
    setError(null);
    try {
      const res = await Api.upsellVenderPacote({
        offerId: offer.offerId,
        employeeId: employee.id,
        payments: [{ method, amountCents: deltaCents }],
      });
      toast.success(`Upgrade vendido! Código ${res.orderCode} — comprovante enviado para impressão.`);
      onResolved("ACEITA");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível concluir o upgrade.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-label="Oferta de upgrade"
      style={{
        border: "2px solid var(--color-orange)",
        background: "rgba(255, 122, 0, 0.06)",
        borderRadius: "18px",
        padding: "18px 20px",
        display: "flex",
        flexDirection: "column",
        gap: "14px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
        <Badge variant="vip" title={`${offer.visitsInWindow} visitas nos últimos ${offer.visitsWindowDays} dias`}>
          ★ VIP
        </Badge>
        <strong style={{ fontFamily: "var(--font-display)", fontSize: "16px", color: "var(--color-orange-text)" }}>
          Oportunidade de upgrade
        </strong>
        <span style={{ fontSize: "13px", color: "var(--text-muted)" }}>
          {offer.childName} · responsável: {offer.guardianName || "—"}
        </span>
      </div>

      {/* O script. Fonte grande e medida de linha curta para leitura em voz
          alta de relance — ver o comentário de cabeçalho do componente. */}
      <blockquote
        style={{
          margin: 0,
          fontSize: "18px",
          lineHeight: 1.6,
          color: "var(--text-primary)",
          borderLeft: "4px solid var(--color-orange)",
          paddingLeft: "14px",
          maxWidth: "60ch",
        }}
      >
        {offer.scriptText}
      </blockquote>

      {/* Os quatro números da decisão, fora do parágrafo. */}
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        <Figure label="Já investiu no mês" value={money(offer.spendCents ?? 0)} />
        <Figure label="Paga agora" value={money(deltaCents)} emphasis />
        <Figure label="Custo/hora hoje" value={money(offer.hourlyAvulsoCents ?? 0)} strike />
        <Figure label="Custo/hora no pacote" value={money(offer.hourlyPlanCents ?? 0)} emphasis />
      </div>

      {!paying ? (
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
          <Button
            variant="primary"
            size="lg"
            disabled={busy}
            onClick={() => setPaying(true)}
            style={{ flex: 1, minWidth: "240px", borderRadius: "9999px", background: "var(--color-orange-text)" }}
            title={`Cobrar ${money(deltaCents)} e ativar o ${pkg.name}`}
          >
            ✓ Upgrade Aceito (Ir para Pagamento)
          </Button>
          <Button
            variant="secondary"
            size="lg"
            loading={busy}
            disabled={busy}
            onClick={recusar}
            style={{ flex: 1, minWidth: "240px", borderRadius: "9999px" }}
            title="Registrar que o responsável não quis — a oferta fica bloqueada por 15 dias"
          >
            ✕ Recusado (Aplicar Cooldown)
          </Button>
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "10px",
            padding: "14px",
            borderRadius: "14px",
            background: "var(--surface-card)",
            border: "1px solid var(--border-subtle)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: "8px" }}>
            <strong style={{ fontSize: "16px" }}>{pkg.name}</strong>
            <span style={{ fontSize: "22px", fontWeight: "bold", color: "var(--color-orange-text)" }}>{money(deltaCents)}</span>
          </div>
          <HelpText style={{ margin: 0 }}>
            {(pkg.includedMinutes / 60).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} h incluídas, válidas por{" "}
            {pkg.validityDays} dias. Cobrando só a diferença para o valor de tabela ({money(pkg.priceCents)}).
          </HelpText>

          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {METHODS.map((m) => (
              <Button
                key={m}
                variant={method === m ? "primary" : "secondary"}
                size="sm"
                onClick={() => setMethod(m)}
                title={`Receber via ${m}`}
              >
                {m}
              </Button>
            ))}
          </div>

          {error && <p style={{ color: "var(--color-error-text)", margin: 0, fontWeight: "bold" }}>{error}</p>}

          {method === "DINHEIRO" ? (
            <CashPaymentPad totalCents={deltaCents} busy={busy} onConfirm={() => vender()} />
          ) : (
            <Button variant="primary" size="lg" fullWidth loading={busy} disabled={busy} onClick={vender}>
              Confirmar upgrade — {money(deltaCents)}
            </Button>
          )}

          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setPaying(false)}>
            Voltar sem cobrar
          </Button>
        </div>
      )}

      {error && !paying && <p style={{ color: "var(--color-error-text)", margin: 0, fontWeight: "bold" }}>{error}</p>}
    </section>
  );
}

function Figure({ label, value, emphasis, strike }: { label: string; value: string; emphasis?: boolean; strike?: boolean }) {
  return (
    <div
      style={{
        padding: "8px 12px",
        borderRadius: "12px",
        background: emphasis ? "rgba(255, 122, 0, 0.14)" : "var(--surface-card)",
        border: `1px solid ${emphasis ? "var(--color-orange)" : "var(--border-subtle)"}`,
        minWidth: "130px",
      }}
    >
      <div style={{ fontSize: "11px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
      <div
        style={{
          fontSize: "17px",
          fontWeight: "bold",
          color: emphasis ? "var(--color-orange-text)" : "var(--text-primary)",
          textDecoration: strike ? "line-through" : undefined,
        }}
      >
        {value}
      </div>
    </div>
  );
}
