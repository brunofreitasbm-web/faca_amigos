import { useEffect, useState } from "react";
import { Button, Input, Modal } from "@facaamigos/ui";
import { Api } from "../api/client.js";
import type { ActiveSessionEntry } from "../api/client.js";
import { useAppState } from "../state/AppState.js";
import { money } from "../format.js";
import { ReceiptPrintModal } from "./ReceiptPrintModal.js";
import { CashPaymentPad } from "./CashPaymentPad.js";
import type { ReceiptPrintPayload } from "@facaamigos/domain";
import { openTapCharge, savePendingTap } from "../lib/infinitepayTap.js";
import { IfCan } from "../auth/RequireCapability.js";

const METHODS = ["DINHEIRO", "PIX", "CREDITO", "DEBITO"] as const;
type PaymentMethod = (typeof METHODS)[number];

// fa_checkout() (RPC) devolve o código bruto do `raise exception` — traduz
// pros casos que o operador realmente pode encontrar em uso normal.
const ERROR_MESSAGES: Record<string, string> = {
  SEM_TURNO_ABERTO: "Não há caixa aberto nesta unidade. Abra o turno na tela Caixa antes de fechar o atendimento.",
  SESSAO_JA_FECHADA: "Uma dessas sessões já foi fechada em outro dispositivo. Feche esta janela e atualize o Painel.",
  SESSAO_NAO_ENCONTRADA: "Uma dessas sessões não foi encontrada. Feche esta janela e atualize o Painel.",
  SESSAO_PAUSADA: "A sessão está pausada. Clique em 'Retomar' no card antes de fechar o atendimento.",
};

function getRawErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null) {
    if ("message" in err && typeof (err as { message: unknown }).message === "string") {
      return (err as { message: string }).message;
    }
    if ("error" in err && typeof (err as { error: unknown }).error === "string") {
      return (err as { error: string }).error;
    }
    return JSON.stringify(err);
  }
  if (typeof err === "string") return err;
  return "Erro ao fechar atendimento";
}

function friendlyError(err: unknown): string {
  const rawMessage = getRawErrorMessage(err);
  for (const [code, userMsg] of Object.entries(ERROR_MESSAGES)) {
    if (rawMessage.includes(code)) return userMsg;
  }
  return rawMessage;
}

/**
 * O total mostrado na tela é recalculado a cada segundo no navegador, mas
 * fa_checkout() recalcula de novo no servidor no instante exato em que a
 * transação roda — se a sessão virar mais um minuto de excedente bem
 * nesse intervalo (rede + fila), o valor enviado diverge do esperado e o
 * servidor rejeita com SOMA_PAGAMENTOS_DIVERGENTE (traz "esperado N" na
 * mensagem). Em vez de obrigar o operador a perceber o erro e tentar de
 * novo, extrai o valor esperado e reenvia automaticamente uma vez.
 */
function extractExpectedCents(message: string): number | null {
  const match = message.match(/esperado (\d+)/);
  return match ? Number(match[1]) : null;
}

export function CheckoutModal({
  entries: liveEntries,
  onClose,
  onDone,
}: {
  entries: ActiveSessionEntry[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { employee, unit } = useAppState();
  // O Painel/Saída recalculam `entries` a cada segundo (contador + valor
  // ainda rodando). Ao abrir o fechamento, o operador está "fechando a
  // sessão" — o tempo e a cobrança da criança devem parar aqui, não seguir
  // subindo enquanto ele escolhe a forma de pagamento. Por isso o valor é
  // congelado na primeira renderização e ignora atualizações da prop depois
  // disso; o servidor (fa_checkout) usa esse mesmo instante como corte real.
  const [entries] = useState(liveEntries);
  // Reconstrói o instante "agora" (já corrigido pro relógio do servidor)
  // que gerou o `elapsedMs` congelado acima: checkin + pausas + elapsed.
  // É o mesmo valor que fa_checkout vai usar como teto de cobrança — não
  // precisa de outra chamada de rede pra travar o relógio do servidor de
  // novo, o congelamento acima já carrega essa informação embutida.
  const [closedAtMs] = useState(() => {
    const first = entries[0];
    return first ? first.session.checkin_at_ms + first.session.paused_ms_total + first.quote.timing.elapsedMs : Date.now();
  });
  const [method, setMethod] = useState<PaymentMethod>("PIX");
  const [secondMethod, setSecondMethod] = useState<PaymentMethod | null>(null);
  const [splitTyped, setSplitTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipts, setReceipts] = useState<ReceiptPrintPayload[]>([]);
  const [hasOpenShift, setHasOpenShift] = useState<boolean | null>(null);
  const [paidOrderId, setPaidOrderId] = useState<string | null>(null);
  const [nfseEnabled, setNfseEnabled] = useState(false);
  const [nfseState, setNfseState] = useState<"idle" | "enfileirando" | "enfileirado" | "erro">("idle");

  useEffect(() => {
    if (!unit) return;
    Api.currentShift(unit.id).then((shift) => setHasOpenShift(!!shift));
    Api.unitFiscal(unit.id)
      .then((fiscal) => setNfseEnabled(!!fiscal.nfse_enabled))
      .catch(() => setNfseEnabled(false));
  }, [unit]);

  async function requestNfse() {
    if (!paidOrderId) return;
    setNfseState("enfileirando");
    try {
      await Api.requestNfse(paidOrderId);
      setNfseState("enfileirado");
    } catch {
      setNfseState("erro");
    }
  }

  const totalCents = entries.reduce((sum, e) => sum + e.quote.totalCents, 0);
  const isSplit = secondMethod !== null;
  const splitCents = isSplit ? Math.min(totalCents, Math.max(0, Math.round(Number(splitTyped.replace(",", ".")) * 100) || 0)) : totalCents;
  const secondCents = totalCents - splitCents;
  const hasPausedSession = entries.some((e) => e.session.paused_at_ms !== null);

  function startSplit() {
    const other = METHODS.find((m) => m !== method) ?? "DINHEIRO";
    setSecondMethod(other);
    setSplitTyped((totalCents / 2 / 100).toFixed(2).replace(".", ","));
  }

  function cancelSplit() {
    setSecondMethod(null);
    setSplitTyped("");
  }

  async function confirm(amountOverrideCents?: number, isRetry = false) {
    if (!employee || !unit) return;
    setBusy(true);
    setError(null);
    const payments = isSplit
      ? [
          { method, amountCents: amountOverrideCents ?? splitCents },
          { method: secondMethod!, amountCents: secondCents },
        ]
      : [{ method, amountCents: amountOverrideCents ?? totalCents }];
    try {
      const result = await Api.checkout({
        sessionIds: entries.map((e) => e.session.id),
        employeeId: employee.id,
        payments,
        closedAtMs,
      });

      setPaidOrderId(result.orderId);
      const nowStr = new Date().toLocaleString("pt-BR");
      setReceipts(
        entries.map((e) => ({
          title: "Comprovante de Saída",
          unitName: unit.name,
          unitAddress: unit.address ?? undefined,
          unitPhone: unit.phone ?? undefined,
          unitCnpj: unit.cnpj ?? undefined,
          employeeName: employee.full_name,
          dateTime: nowStr,
          code: result.orderCode,
          items: e.quote.lines.map((l) => ({ description: l.label, amountCents: l.cents })),
          totalCents: e.quote.totalCents,
          payments: isSplit
            ? [
                { method, amountCents: Math.round((e.quote.totalCents * splitCents) / totalCents) },
                { method: secondMethod!, amountCents: e.quote.totalCents - Math.round((e.quote.totalCents * splitCents) / totalCents) },
              ]
            : [{ method, amountCents: e.quote.totalCents }],
          customerInfo: {
            childName: e.session.child_name_snapshot,
            guardianName: e.session.guardian_name_snapshot,
            phone: e.session.guardian_phone_snapshot,
          },
          footerNote: `Entrada ${new Date(e.session.checkin_at_ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} → Saída ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} (+${e.quote.timing.overMinutes}min)`,
        })),
      );
    } catch (err) {
      const message = getRawErrorMessage(err);
      const expected = !isRetry && !isSplit ? extractExpectedCents(message) : null;
      if (expected !== null) {
        await confirm(expected, true);
        return;
      }
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Cobrança por aproximação via InfiniteTap: sai para o app InfinitePay
   * (mesmo aparelho) e só volta depois do pagamento — por isso os recibos
   * são pré-montados aqui (falta só o `code`, que sai do fa_checkout depois
   * que o TapReturnScreen confirmar) e guardados no localStorage via
   * savePendingTap, já que o estado deste componente não sobrevive à saída
   * de página. Só disponível fora do pagamento dividido (isSplit) — dividir
   * uma cobrança em duas maquininhas complicaria demais o retorno pra valer
   * a pena na primeira versão.
   */
  function handleTapCharge() {
    if (!employee || !unit || isSplit || (method !== "CREDITO" && method !== "DEBITO")) return;
    const orderId = crypto.randomUUID();
    const nowStr = new Date().toLocaleString("pt-BR");
    const receiptsBase = entries.map((e) => ({
      title: "Comprovante de Saída",
      unitName: unit.name,
      unitAddress: unit.address ?? undefined,
      unitPhone: unit.phone ?? undefined,
      unitCnpj: unit.cnpj ?? undefined,
      employeeName: employee.full_name,
      dateTime: nowStr,
      items: e.quote.lines.map((l) => ({ description: l.label, amountCents: l.cents })),
      totalCents: e.quote.totalCents,
      payments: [{ method, amountCents: e.quote.totalCents }],
      customerInfo: {
        childName: e.session.child_name_snapshot,
        guardianName: e.session.guardian_name_snapshot,
        phone: e.session.guardian_phone_snapshot,
      },
      footerNote: `Entrada ${new Date(e.session.checkin_at_ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} → Saída ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} (+${e.quote.timing.overMinutes}min)`,
    }));

    savePendingTap(orderId, {
      kind: "checkout",
      sessionIds: entries.map((e) => e.session.id),
      employeeId: employee.id,
      method,
      amountCents: totalCents,
      closedAtMs,
      receiptsBase,
    });

    openTapCharge({
      amountCents: totalCents,
      method,
      orderId,
      handle: import.meta.env.VITE_INFINITEPAY_HANDLE as string | undefined,
      docNumber: unit.cnpj ?? undefined,
    });
  }

  if (receipts.length > 0) {
    return (
      <>
        {receipts.map((r, i) => (
          <ReceiptPrintModal
            key={i}
            data={r}
            onClose={() => {
              const rest = receipts.filter((_, idx) => idx !== i);
              setReceipts(rest);
              // Cupom não fiscal já imprimiu sozinho, sem tela — se a unidade
              // emite NFS-e, este é o único momento em que o operador vê algo
              // clicável para pedir a nota; senão, fecha direto como sempre.
              if (rest.length === 0 && !nfseEnabled) onDone();
            }}
          />
        ))}
      </>
    );
  }

  if (paidOrderId && nfseEnabled) {
    return (
      <Modal title="Atendimento concluído" onClose={onDone} closeOnBackdrop={false} maxWidth="380px" zIndex={100}>
        <p style={{ marginTop: 0 }}>Pagamento confirmado e cupom impresso.</p>
        <IfCan capability="nfse.emit">
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", margin: "12px 0" }}>
            <Button
              variant="secondary"
              onClick={requestNfse}
              loading={nfseState === "enfileirando"}
              disabled={nfseState === "enfileirando" || nfseState === "enfileirado"}
              title="Solicitar a Nota Fiscal de Serviço deste atendimento, enviada por e-mail ao Responsável"
            >
              🧾 Emitir Nota Fiscal Serviço
            </Button>
            {nfseState === "enfileirado" && (
              <p style={{ color: "var(--color-success-text, #15803d)", fontSize: "13px", margin: 0 }}>
                Nota fiscal solicitada — será enviada por e-mail ao Responsável em instantes.
              </p>
            )}
            {nfseState === "erro" && (
              <p style={{ color: "var(--color-error-text)", fontSize: "13px", margin: 0 }}>
                Não foi possível solicitar a nota agora. Tente novamente ou peça ao Owner para checar a unidade.
              </p>
            )}
          </div>
        </IfCan>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Button variant="primary" onClick={onDone} title="Fechar">
            Concluir
          </Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Fechar atendimento" onClose={onClose} closeOnBackdrop={false} maxWidth="420px" zIndex={100}>
      <>
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
            <Button
              key={m}
              variant={method === m ? "primary" : "secondary"}
              size="sm"
              onClick={() => setMethod(m)}
              disabled={isSplit && m === secondMethod}
              title={`Pagar via ${m}`}
            >
              {m}
            </Button>
          ))}
        </div>

        {!isSplit ? (
          <Button variant="ghost" size="sm" onClick={startSplit} style={{ marginBottom: "12px" }} title="Cobrar parte em uma forma e o restante em outra">
            ➗ Dividir em 2 formas de pagamento
          </Button>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", margin: "12px 0", padding: "12px", border: "1px dashed var(--border-subtle)", borderRadius: "12px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong style={{ fontSize: "13px" }}>Pagamento dividido</strong>
              <Button variant="ghost" size="sm" onClick={cancelSplit} title="Voltar a cobrar tudo numa forma só">
                remover divisão
              </Button>
            </div>
            <Input
              label={`Valor em ${method} (R$)`}
              placeholder="0,00"
              inputMode="decimal"
              value={splitTyped}
              onChange={(e) => setSplitTyped(e.target.value)}
            />
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              {METHODS.filter((m) => m !== method).map((m) => (
                <Button key={m} variant={secondMethod === m ? "primary" : "secondary"} size="sm" onClick={() => setSecondMethod(m)}>
                  {m}
                </Button>
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", color: "var(--text-muted)" }}>
              <span>Restante em {secondMethod}:</span>
              <strong style={{ color: secondCents < 0 ? "var(--color-error-text)" : undefined }}>{money(secondCents)}</strong>
            </div>
            {secondCents < 0 && <p style={{ color: "var(--color-error-text)", margin: 0, fontSize: "13px" }}>O valor em {method} não pode passar do total.</p>}
          </div>
        )}

        {hasOpenShift === false && (
          <div style={{ background: "#FEF3C7", color: "#92400E", padding: "12px 16px", borderRadius: "8px", border: "1px solid #F59E0B", marginBottom: "12px", fontSize: "14px" }}>
            ⚠️ <strong>Caixa fechado:</strong> não há turno aberto nesta unidade. Abra o turno na tela <strong>Caixa</strong> para poder fechar este atendimento.
          </div>
        )}

        {hasPausedSession && (
          <div style={{ background: "#FEF3C7", color: "#92400E", padding: "12px 16px", borderRadius: "8px", border: "1px solid #F59E0B", marginBottom: "12px", fontSize: "14px" }}>
            ⏸️ <strong>Sessão pausada:</strong> Uma das crianças está com o tempo pausado. Clique em <strong>Retomar</strong> no card no Painel antes de fechar.
          </div>
        )}

        {error && <p style={{ color: "var(--color-error-text)", fontWeight: 600 }}>{error}</p>}

        {method === "DINHEIRO" && !isSplit ? (
          <>
            <CashPaymentPad totalCents={totalCents} busy={busy || hasOpenShift === false || hasPausedSession} onConfirm={() => confirm()} />
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "8px" }}>
              <Button variant="ghost" onClick={onClose} disabled={busy} title="Cancelar o fechamento sem cobrar">
                Cancelar
              </Button>
            </div>
          </>
        ) : (
          <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", flexWrap: "wrap" }}>
            <Button variant="ghost" onClick={onClose} disabled={busy} title="Cancelar o fechamento sem cobrar">
              Cancelar
            </Button>
            {!isSplit && (method === "CREDITO" || method === "DEBITO") && (
              <Button
                variant="secondary"
                onClick={handleTapCharge}
                disabled={busy || hasOpenShift === false || hasPausedSession}
                title="Cobrar por aproximação usando o celular/tablet como maquininha (InfiniteTap)"
              >
                📲 Cobrar com InfiniteTap
              </Button>
            )}
            <Button
              variant="primary"
              onClick={() => confirm()}
              loading={busy}
              disabled={busy || hasOpenShift === false || hasPausedSession || (isSplit && (secondCents < 0 || splitCents <= 0))}
              title={
                hasOpenShift === false
                  ? "Abra o turno na tela Caixa antes de fechar o atendimento"
                  : hasPausedSession
                  ? "Retome a contagem da sessão no Painel antes de fechar"
                  : "Confirmar pagamento e imprimir cupom de saída"
              }
            >
              Confirmar pagamento
            </Button>
          </div>
        )}
      </>
    </Modal>
  );
}
