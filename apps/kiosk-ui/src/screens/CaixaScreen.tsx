import { useEffect, useState } from "react";
import { Button, Card, Input, HelpText, Modal, Tag } from "@facaamigos/ui";
import { formatCpf, isValidCpf } from "@facaamigos/domain";
import { Api } from "../api/client.js";
import type { CashMovement, RevenueByMethod, Shift, ShiftSale, FiscalDoc } from "../api/client.js";
import { useAppState } from "../state/AppState.js";
import { useConfirm } from "../state/ConfirmContext.js";
import { IfCan } from "../auth/RequireCapability.js";
import { money } from "../format.js";
import { OFFLINE_FLUSH_EVENT, OfflineQueuedError } from "../lib/supabase/offlineQueue.js";
import type { OfflineFlushDetail } from "../lib/supabase/offlineQueue.js";
import { NfceModal } from "../components/NfceModal.js";

const METHODS = ["DINHEIRO", "PIX", "CREDITO", "DEBITO"] as const;

type CloseResult = { expected: Record<string, number>; declared: Record<string, number>; divergence: Record<string, number>; justifications: Record<string, string> };

export function CaixaScreen() {
  const { unit, employee } = useAppState();
  const confirm = useConfirm();
  const [shift, setShift] = useState<Shift | null | undefined>(undefined);
  const [openingCash, setOpeningCash] = useState("0");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [movements, setMovements] = useState<CashMovement[]>([]);
  const [revenue, setRevenue] = useState<RevenueByMethod[]>([]);
  const [sales, setSales] = useState<ShiftSale[]>([]);
  const [movementKind, setMovementKind] = useState<"SANGRIA" | "SUPRIMENTO">("SANGRIA");
  const [movementAmount, setMovementAmount] = useState("0");
  const [movementReason, setMovementReason] = useState("");
  const [selectedSaleForNfce, setSelectedSaleForNfce] = useState<{
    doc: FiscalDoc | null;
    sale: ShiftSale;
  } | null>(null);

  const [nfseDocsMap, setNfseDocsMap] = useState<Record<string, FiscalDoc | null>>({});
  const [nfseLoadingMap, setNfseLoadingMap] = useState<Record<string, boolean>>({});
  const [whatsappPhoneModal, setWhatsappPhoneModal] = useState<{ sale: ShiftSale; doc: FiscalDoc } | null>(null);
  const [customWhatsappPhone, setCustomWhatsappPhone] = useState("");
  const [nfseErrorModal, setNfseErrorModal] = useState<{ sale: ShiftSale; doc: FiscalDoc } | null>(null);
  const [cpfInputModal, setCpfInputModal] = useState("");
  const [cpfUpdating, setCpfUpdating] = useState(false);

  async function loadNfseDocsForSales(salesList: ShiftSale[]) {
    const sessionSales = salesList.filter((s) => s.kind === "SESSAO");
    if (sessionSales.length === 0) return;
    const docs: Record<string, FiscalDoc | null> = {};
    await Promise.all(
      sessionSales.map(async (s) => {
        const doc = await Api.nfseDocByOrder(s.orderId).catch(() => null);
        if (doc) {
          docs[s.orderId] = doc;
        }
      })
    );
    setNfseDocsMap((prev) => ({ ...prev, ...docs }));
  }

  async function handleEmitNfse(sale: ShiftSale) {
    setNfseLoadingMap((prev) => ({ ...prev, [sale.orderId]: true }));
    try {
      await Api.requestNfse(sale.orderId);
      let attempts = 0;
      const interval = setInterval(async () => {
        attempts += 1;
        const doc = await Api.nfseDocByOrder(sale.orderId).catch(() => null);
        if (doc) {
          setNfseDocsMap((prev) => ({ ...prev, [sale.orderId]: doc }));
          if (doc.status === "AUTORIZADO" || ["BLOQUEADO", "REJEITADO", "DENEGADO", "CANCELADO"].includes(doc.status)) {
            clearInterval(interval);
            setNfseLoadingMap((prev) => ({ ...prev, [sale.orderId]: false }));
          }
        }
        if (attempts >= 10) {
          clearInterval(interval);
          setNfseLoadingMap((prev) => ({ ...prev, [sale.orderId]: false }));
        }
      }, 2000);
    } catch {
      alert("Não foi possível solicitar a emissão da NFS-e. Tente novamente.");
      setNfseLoadingMap((prev) => ({ ...prev, [sale.orderId]: false }));
    }
  }

  async function handleSendNfseWhatsapp(sale: ShiftSale, doc: FiscalDoc, overridePhone?: string) {
    const phone = overridePhone ?? sale.guardianPhone;
    if (!phone || !phone.trim()) {
      setWhatsappPhoneModal({ sale, doc });
      setCustomWhatsappPhone("");
      return;
    }

    const digits = phone.replace(/\D/g, "");
    const fullPhone = digits.length === 10 || digits.length === 11 ? `55${digits}` : digits;

    const respStr = sale.guardianName ? `Olá, ${sale.guardianName}! ` : "Olá! ";
    const valStr = money(doc.total_cents ?? sale.amountCents);
    const numStr = doc.nfse_numero ?? doc.numero ?? "—";
    const serieStr = doc.serie ?? "1";

    const messageLines = [
      `${respStr}Segue a sua Nota Fiscal de Serviços Eletrônica (NFS-e) emitida pelo FaçaAmigos:`,
      ``,
      `📄 NFS-e nº ${numStr} / Série ${serieStr}`,
      `Valor: ${valStr}`,
      doc.access_key ? `Chave: ${doc.access_key}` : null,
      ``,
      `Agradecemos a sua visita e ficamos à disposição! 🎈`,
    ].filter((l): l is string => l !== null);

    const text = encodeURIComponent(messageLines.join("\n"));
    window.open(`https://wa.me/${fullPhone}?text=${text}`, "_blank");

    try {
      await Api.markNfseSent(doc.id);
      setNfseDocsMap((prev) => ({
        ...prev,
        [sale.orderId]: { ...doc, guardian_whatsapp_sent_at_ms: Date.now() },
      }));
    } catch {
      // ignore
    }

    if (whatsappPhoneModal) {
      setWhatsappPhoneModal(null);
    }
  }

  async function openNfceForSale(sale: ShiftSale) {
    try {
      const doc = await Api.fiscalDocByOrder(sale.orderId).catch(() => null);
      setSelectedSaleForNfce({ doc, sale });
    } catch {
      setSelectedSaleForNfce({ doc: null, sale });
    }
  }

  const [closing, setClosing] = useState(false);
  const [declared, setDeclared] = useState<Record<string, string>>({ DINHEIRO: "0", PIX: "0", CREDITO: "0", DEBITO: "0" });
  const [closeJustifications, setCloseJustifications] = useState<Record<string, string>>({});
  const [closeResult, setCloseResult] = useState<CloseResult | null>(null);
  const [shiftOpenSuccessModal, setShiftOpenSuccessModal] = useState<{
    openingCashCents: number;
    openedAtMs: number;
    employeeName: string;
    unitName: string;
  } | null>(null);
  const [refreshError, setRefreshError] = useState(false);
  // Enquanto isso está preenchido, o fechamento foi enviado mas ficou na fila
  // offline (sem rede no momento) — ainda NÃO aconteceu de fato. O
  // OFFLINE_FLUSH_EVENT abaixo resolve isso quando a fila reenviar sozinha.
  const [pendingCloseKey, setPendingCloseKey] = useState<string | null>(null);

  // Mesma lógica do fechamento (pendingCloseKey) aplicada a sangria/suprimento:
  // sem isso, uma queda breve de rede fazia o operador ver "Erro" numa
  // movimentação que na verdade já tinha sido salva na fila offline — e ao
  // tentar de novo (idempotencyKey novo a cada chamada) o valor entrava
  // duplicado quando a fila reenviava sozinha. Ver fa_record_cash_movement.
  const [pendingMovementKey, setPendingMovementKey] = useState<string | null>(null);

  // Estados do Modal "Registrar Envelope"
  const [envelopeModalOpen, setEnvelopeModalOpen] = useState(false);
  const [envelopeNum, setEnvelopeNum] = useState("");
  const [envelopeVal, setEnvelopeVal] = useState("0");
  const [envelopeFundoCaixa, setEnvelopeFundoCaixa] = useState("0");
  const [envelopePhoto, setEnvelopePhoto] = useState<File | null>(null);
  const [envelopeBusy, setEnvelopeBusy] = useState(false);

  async function handleSaveEnvelope() {
    if (!unit || !employee || !shift) return;
    const amountCents = Math.round(Number(envelopeVal) * 100);
    if (amountCents <= 0) {
      alert("Informe um valor válido maior que zero para o envelope.");
      return;
    }
    if (!envelopePhoto) {
      alert("Anexe a foto do envelope antes de confirmar.");
      return;
    }
    const fundoCaixaCents = Math.round(Number(envelopeFundoCaixa) * 100);
    if (!Number.isFinite(fundoCaixaCents) || fundoCaixaCents < 0) {
      alert("Informe um valor válido para o fundo de caixa.");
      return;
    }
    setEnvelopeBusy(true);
    try {
      const photoUrl = await Api.uploadEnvelopePhoto(unit.id, envelopePhoto);
      await Api.cashMovement(shift.id, {
        employeeId: employee.id,
        kind: "SANGRIA",
        amountCents,
        envelopeNumber: envelopeNum,
        photoUrl,
        fundoCaixaCents,
      });

      alert(`Envelope #${envelopeNum} registrado com sucesso!`);
      setEnvelopeModalOpen(false);
      setEnvelopeNum("");
      setEnvelopeVal("0");
      setEnvelopeFundoCaixa("0");
      setEnvelopePhoto(null);
      await refresh();
    } catch (err) {
      if (err instanceof OfflineQueuedError) {
        // A movimentação FOI salva (fila offline) e será reenviada sozinha —
        // fechar o modal e limpar o formulário evita que o operador registre
        // o mesmo envelope de novo (o que criaria uma sangria duplicada,
        // já que cada chamada usa uma idempotencyKey nova).
        alert(`Sem conexão: envelope #${envelopeNum} foi salvo e será enviado automaticamente quando a rede voltar. Não registre este envelope novamente.`);
        setPendingMovementKey(err.idempotencyKey);
        setEnvelopeModalOpen(false);
        setEnvelopeNum("");
        setEnvelopeVal("0");
        setEnvelopeFundoCaixa("0");
        setEnvelopePhoto(null);
      } else {
        alert("Erro ao registrar o envelope.");
      }
    } finally {
      setEnvelopeBusy(false);
    }
  }

  async function refresh() {

    if (!unit) return;
    try {
      const current = await Api.currentShift(unit.id);
      setShift(current);
      if (current) {
        setMovements(await Api.cashMovements(current.id));
        setRevenue(await Api.revenueByMethod(current.id));
        const fetchedSales = await Api.shiftSales(current.id);
        setSales(fetchedSales);
        loadNfseDocsForSales(fetchedSales);
      }
      setRefreshError(false);
    } catch {
      // Repolla a cada 5s (setInterval abaixo) sem try/catch aqui virava
      // uma rejeição não tratada a cada falha, e a tela ficava com dado
      // velho sem nenhum sinal disso. Mantém o último bom na tela — só
      // acende o aviso; não troca o turno/movimentos por um vazio.
      setRefreshError(true);
    }
  }

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unit]);

  useEffect(() => {
    if (!pendingCloseKey) return;
    function onFlush(event: Event) {
      const detail = (event as CustomEvent<OfflineFlushDetail>).detail;
      if (detail.idempotencyKey !== pendingCloseKey) return;
      setPendingCloseKey(null);
      if (detail.success) {
        setCloseResult(detail.data as CloseResult);
      } else {
        // A fila desistiu (erro de regra de negócio no reenvio, ex.: turno já
        // fechado por outra via) — o fechamento não vai acontecer sozinho.
        setError("Não foi possível concluir o fechamento enviado anteriormente. Tente fechar o turno novamente.");
      }
      refresh();
    }
    window.addEventListener(OFFLINE_FLUSH_EVENT, onFlush);
    return () => window.removeEventListener(OFFLINE_FLUSH_EVENT, onFlush);
  }, [pendingCloseKey]);

  useEffect(() => {
    if (!pendingMovementKey) return;
    function onFlush(event: Event) {
      const detail = (event as CustomEvent<OfflineFlushDetail>).detail;
      if (detail.idempotencyKey !== pendingMovementKey) return;
      setPendingMovementKey(null);
      if (!detail.success) {
        // Erro de regra de negócio no reenvio (ex.: turno fechado nesse meio
        // tempo) — a movimentação NÃO aconteceu; precisa ser refeita manualmente.
        setError("Uma movimentação enviada sem conexão não pôde ser concluída. Confira o Fluxo de Dinheiro e registre novamente se necessário.");
      }
      refresh();
    }
    window.addEventListener(OFFLINE_FLUSH_EVENT, onFlush);
    return () => window.removeEventListener(OFFLINE_FLUSH_EVENT, onFlush);
  }, [pendingMovementKey]);

  async function openShift() {
    if (!unit || !employee) return;
    setBusy(true);
    setError(null);
    try {
      const openingCashCents = Math.round(Number(openingCash) * 100);
      await Api.openShift({ unitId: unit.id, employeeId: employee.id, openingCashCents });
      await refresh();
      setShiftOpenSuccessModal({
        openingCashCents,
        openedAtMs: Date.now(),
        employeeName: employee.full_name,
        unitName: unit.name,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao abrir turno";
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  async function addMovement() {
    if (!shift || !employee) return;
    setBusy(true);
    setError(null);
    try {
      await Api.cashMovement(shift.id, {
        employeeId: employee.id,
        kind: movementKind,
        amountCents: Math.round(Number(movementAmount) * 100),
        reason: movementReason || undefined,
      });
      setMovementAmount("0");
      setMovementReason("");
      await refresh();
    } catch (err) {
      if (err instanceof OfflineQueuedError) {
        // Idem ao envelope: já foi salva na fila, limpa o formulário para
        // não convidar um reenvio duplicado quando ela sincronizar sozinha.
        setPendingMovementKey(err.idempotencyKey);
        setMovementAmount("0");
        setMovementReason("");
      } else {
        const msg = err instanceof Error ? err.message : "Erro ao registrar movimentação";
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  async function confirmClose() {
    if (!shift || !employee) return;
    setBusy(true);
    setError(null);
    try {
      const declaredCents: Record<string, number> = {};
      for (const [method, value] of Object.entries(declared)) declaredCents[method] = Math.round(Number(value) * 100);
      const justificationsToSend: Record<string, string> = {};
      for (const method of METHODS) {
        const divergenceCents = (declaredCents[method] ?? 0) - expectedHint(method, revenue, movements);
        const text = (closeJustifications[method] ?? "").trim();
        if (divergenceCents !== 0 && text) justificationsToSend[method] = text;
      }
      const result = await Api.closeShift(shift.id, { employeeId: employee.id, declared: declaredCents, justifications: justificationsToSend });
      setCloseResult(result);
    } catch (err) {
      if (err instanceof OfflineQueuedError) {
        // Não é um erro de fato: a chamada foi guardada e será reenviada
        // sozinha (ver OFFLINE_FLUSH_EVENT acima). O fechamento AINDA NÃO
        // aconteceu — por isso não mostra o resumo nem sai desta tela.
        setPendingCloseKey(err.idempotencyKey);
      } else {
        const msg = err instanceof Error ? err.message : "Erro ao fechar turno";
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmClose() {
    const ok = await confirm({
      title: "Fechar turno de caixa?",
      message: "Essa ação é irreversível e vai encerrar o turno atual. Confira os valores declarados antes de continuar.",
      confirmLabel: "Fechar turno",
      cancelLabel: "Revisar valores",
      variant: "danger",
    });
    if (ok) await confirmClose();
  }

  const renderEnvelopeModal = () => {
    if (!envelopeModalOpen) return null;
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          backgroundColor: "rgba(0, 0, 0, 0.5)",
          display: "flex",
          alignItems: "safe center",
          justifyContent: "center",
          overflowY: "auto",
          padding: "24px",
          zIndex: 9999,
        }}
      >
        <Card
          style={{
            width: "90%",
            maxWidth: "450px",
            maxHeight: "calc(100dvh - 48px)",
            overflowY: "auto",
            padding: "24px",
            borderRadius: "16px",
            background: "var(--surface-card)",
          }}
        >
          <h2 style={{ marginTop: 0, fontSize: "20px" }}>✉️ Registrar Envelope (Sangria)</h2>
          <HelpText style={{ marginBottom: "16px" }}>
            Registre a retirada de valores em espécie com o número do envelope correspondente.
          </HelpText>

          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <Input
              label="Número do Envelope"
              placeholder="Ex: #104, #205..."
              value={envelopeNum}
              onChange={(e) => setEnvelopeNum(e.target.value)}
            />
            <Input
              label="Valor do Envelope (R$)"
              type="number"
              value={envelopeVal}
              onChange={(e) => setEnvelopeVal(e.target.value)}
            />
            <Input
              label="Fundo de Caixa (R$)"
              placeholder="Valor que fica na gaveta após a sangria"
              type="number"
              value={envelopeFundoCaixa}
              onChange={(e) => setEnvelopeFundoCaixa(e.target.value)}
            />
            <div>
              <label style={{ fontSize: "13px", fontWeight: "bold", display: "block", marginBottom: "4px" }}>Foto do Envelope (obrigatória — JPG ou PNG)</label>
              <input
                type="file"
                accept="image/jpeg,image/png"
                capture="environment"
                onChange={(e) => setEnvelopePhoto(e.target.files?.[0] ?? null)}
              />
            </div>

            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", marginTop: "16px" }}>
              <Button
                variant="secondary"
                disabled={envelopeBusy}
                onClick={() => setEnvelopeModalOpen(false)}
              >
                Cancelar
              </Button>
              <Button
                variant="primary"
                loading={envelopeBusy}
                disabled={
                  envelopeBusy ||
                  !!pendingMovementKey ||
                  !envelopeNum ||
                  Number(envelopeVal) <= 0 ||
                  !envelopePhoto ||
                  Number.isNaN(Number(envelopeFundoCaixa)) ||
                  Number(envelopeFundoCaixa) < 0
                }
                onClick={handleSaveEnvelope}
              >
                {pendingMovementKey ? "Aguardando conexão..." : "💾 Confirmar Registro"}
              </Button>
            </div>
          </div>
        </Card>
      </div>
    );
  };

  if (!unit || shift === undefined) return null;

  // closeResult precisa ser checado ANTES de `shift === null`: o poll de 5s
  // (useEffect acima) já busca de novo o turno assim que o fechamento é
  // confirmado, e como o turno acabou de fechar `currentShift` volta null.
  // Se o "Abrir turno" fosse checado primeiro, a tela de conferência
  // (esperado x declarado x divergência) seria substituída por "Abrir
  // turno" antes do operador conseguir ler — inclusive com divergência.
  if (closeResult) {
    return (
      <div style={{ maxWidth: "540px", margin: "40px auto", padding: "0 16px" }}>
        <Card style={{ padding: "24px", borderRadius: "18px", boxShadow: "0 10px 30px rgba(0,0,0,0.1)" }}>
          <div style={{ textAlign: "center", marginBottom: "20px" }}>
            <div
              style={{
                width: "60px",
                height: "60px",
                margin: "0 auto 12px",
                borderRadius: "50%",
                background: "linear-gradient(135deg, #3b82f6, #1d4ed8)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "28px",
                color: "#fff",
                boxShadow: "0 8px 18px rgba(59, 130, 246, 0.3)",
              }}
            >
              🏁
            </div>
            <h1 style={{ fontFamily: "var(--font-display)", fontSize: "22px", margin: "0 0 6px 0", color: "var(--text-primary)" }}>
              Turno Fechado com Sucesso!
            </h1>
            <p style={{ margin: 0, fontSize: "14px", color: "var(--text-secondary)" }}>
              Resumo de conferência de caixa · {new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
            </p>
          </div>

          <HelpText style={{ marginBottom: "16px" }}>
            "Esperado" é o valor calculado pelo sistema; "Declarado" é a contagem informada. "✓ bateu" confirma a convergência dos valores.
          </HelpText>

          <div style={{ overflowX: "auto", marginBottom: "20px" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid var(--border-subtle)" }}>
                  <th style={{ textAlign: "left", padding: "8px" }}>Método</th>
                  <th style={{ textAlign: "right", padding: "8px" }}>Esperado</th>
                  <th style={{ textAlign: "right", padding: "8px" }}>Declarado</th>
                  <th style={{ textAlign: "right", padding: "8px" }}>Diferença</th>
                  <th style={{ textAlign: "left", padding: "8px" }}>Justificativa</th>
                </tr>
              </thead>
              <tbody>
                {Object.keys(closeResult.divergence).map((method) => {
                  const balanced = closeResult.divergence[method] === 0;
                  return (
                    <tr key={method} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                      <td style={{ padding: "8px", fontWeight: "600" }}>{method}</td>
                      <td style={{ textAlign: "right", padding: "8px", fontVariantNumeric: "tabular-nums" }}>{money(closeResult.expected[method] ?? 0)}</td>
                      <td style={{ textAlign: "right", padding: "8px", fontVariantNumeric: "tabular-nums" }}>{money(closeResult.declared[method] ?? 0)}</td>
                      <td
                        style={{
                          textAlign: "right",
                          padding: "8px",
                          fontVariantNumeric: "tabular-nums",
                          fontWeight: "bold",
                          color: balanced ? "var(--color-teal-text)" : "var(--color-error-text)",
                        }}
                      >
                        {balanced ? "✓ bateu" : `⚠ ${money(closeResult.divergence[method] ?? 0)}`}
                      </td>
                      <td style={{ fontSize: "13px", padding: "8px" }}>{balanced ? "—" : closeResult.justifications[method] ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <Button
            variant="primary"
            size="lg"
            onClick={() => { setCloseResult(null); setClosing(false); setCloseJustifications({}); refresh(); }}
            style={{ width: "100%", borderRadius: "10px" }}
          >
            ✓ Entendido, Concluir Fechamento
          </Button>
        </Card>
      </div>
    );
  }

  if (shift === null) {
    return (
      <div style={{ maxWidth: "420px", margin: "60px auto", display: "flex", flexDirection: "column", gap: "16px" }}>
        <h1 style={{ fontFamily: "var(--font-display)" }}>Abrir turno</h1>
        <HelpText>
          É preciso abrir o turno de caixa antes de vender no PDV ou fechar atendimentos. Informe quanto dinheiro
          (em espécie) já está na gaveta para começar — normalmente o troco combinado com a gerência.
        </HelpText>
        <Input label="Fundo de Caixa (R$)" type="number" value={openingCash} onChange={(e) => setOpeningCash(e.target.value)} />
        {error && <p style={{ color: "var(--color-error-text)" }}>{error}</p>}
        <Button variant="primary" size="lg" loading={busy} disabled={busy} onClick={openShift}>
          Abrir turno
        </Button>
      </div>
    );
  }

  if (closing) {
    const canConfirmClose = METHODS.every((method) => {
      const divergenceCents = Math.round(Number(declared[method]) * 100) - expectedHint(method, revenue, movements);
      return divergenceCents === 0 || (closeJustifications[method] ?? "").trim().length >= 3;
    });
    return (
      <div style={{ maxWidth: "420px", margin: "40px auto", display: "flex", flexDirection: "column", gap: "12px" }}>
        {renderEnvelopeModal()}
        <h1 style={{ fontFamily: "var(--font-display)" }}>Fechar turno</h1>
        <HelpText>
          Conte o dinheiro e confira os comprovantes de cada forma de pagamento e digite o valor total que você
          encontrou em cada um. O sistema mostra ao lado o que era esperado — se o valor contado for diferente, a
          diferença aparece destacada depois de confirmar.
        </HelpText>
        <p>Digite o que foi contado por método (o sistema já mostra o esperado ao lado — sem fechamento cego):</p>
        <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>Método</th>
              <th style={{ textAlign: "right" }}>Esperado</th>
              <th style={{ textAlign: "right" }}>Declarado</th>
              <th style={{ textAlign: "right" }}>Divergência</th>
              <th style={{ textAlign: "left" }}>Justificativa</th>
            </tr>
          </thead>
          <tbody>
            {METHODS.map((method) => {
              const expectedCents = expectedHint(method, revenue, movements);
              const declaredCents = Math.round(Number(declared[method]) * 100);
              const divergenceCents = declaredCents - expectedCents;
              const hasDivergence = divergenceCents !== 0;
              return (
                <tr key={method}>
                  <td>{method}</td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(expectedCents)}</td>
                  <td style={{ textAlign: "right" }}>
                    <Input
                      type="number"
                      value={declared[method]}
                      onChange={(e) => setDeclared((prev) => ({ ...prev, [method]: e.target.value }))}
                    />
                  </td>
                  <td
                    style={{
                      textAlign: "right",
                      fontVariantNumeric: "tabular-nums",
                      color: hasDivergence ? "var(--color-error-text)" : "var(--color-teal-text)",
                    }}
                  >
                    {hasDivergence ? money(divergenceCents) : "✓"}
                  </td>
                  <td>
                    {hasDivergence && (
                      <Input
                        placeholder="Por que houve diferença? (mín. 3 caracteres)"
                        value={closeJustifications[method] ?? ""}
                        onChange={(e) => setCloseJustifications((prev) => ({ ...prev, [method]: e.target.value }))}
                      />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
        {error && <p style={{ color: "var(--color-error-text)" }}>{error}</p>}
        {pendingCloseKey && (
          <p style={{ color: "var(--color-amber)" }}>
            ⏳ Sem conexão no momento da confirmação — o fechamento foi salvo e será concluído automaticamente assim
            que a rede voltar. Não feche o turno de novo nem saia desta tela.
          </p>
        )}
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <Button variant="ghost" onClick={() => setClosing(false)} disabled={busy || !!pendingCloseKey}>
            Cancelar
          </Button>
          <Button variant="secondary" onClick={() => setEnvelopeModalOpen(true)} disabled={busy || !!pendingCloseKey}>
            ✉️ Registrar Envelope
          </Button>
          <Button variant="primary" onClick={handleConfirmClose} loading={busy} disabled={busy || !!pendingCloseKey || !canConfirmClose}>
            {pendingCloseKey ? "Aguardando conexão..." : "Confirmar fechamento"}
          </Button>
        </div>
      </div>
    );
  }


  return (
    <div style={{ maxWidth: "900px", margin: "0 auto", padding: "24px", display: "flex", flexDirection: "column", gap: "20px" }}>
      {renderEnvelopeModal()}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <h1 style={{ fontFamily: "var(--font-display)", margin: 0 }}>Caixa</h1>
          <HelpText>
            Acompanhe o faturamento e as vendas deste turno, registre retiradas/reforços de dinheiro e feche o turno no
            final do dia.
          </HelpText>
        </div>
        <Button variant="secondary" onClick={() => setEnvelopeModalOpen(true)}>
          ✉️ Registrar Envelope
        </Button>
      </div>


      {refreshError && (
        <div
          role="alert"
          style={{ fontSize: "13px", color: "var(--color-error-text)", background: "rgba(232,48,48,0.08)", border: "1px solid var(--color-error)", borderRadius: "10px", padding: "8px 12px" }}
        >
          ⚠️ Não foi possível atualizar o caixa agora — os valores abaixo podem estar desatualizados.
        </div>
      )}

      <Card style={{ padding: "16px" }}>
        <h2>Faturamento do turno</h2>
        {revenue.length === 0 && <p>Nenhuma venda ainda.</p>}
        {revenue.map((r) => (
          <div key={r.method} style={{ display: "flex", justifyContent: "space-between" }}>
            <span>{r.method}</span>
            <span>{money(r.total_cents)}</span>
          </div>
        ))}
      </Card>

      <Card style={{ padding: "16px" }}>
        <h2>Vendas do turno</h2>
        <HelpText style={{ marginBottom: "8px" }}>Cada linha é uma venda paga neste turno (entrada ou produto do PDV).</HelpText>
        {sales.length === 0 && <p>Nenhuma venda registrada ainda.</p>}
        {sales.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid var(--border-subtle)" }}>
                  <th style={{ padding: "6px 8px" }}>Código</th>
                  <th style={{ padding: "6px 8px" }}>Hora</th>
                  <th style={{ padding: "6px 8px" }}>Criança / Responsável</th>
                  <th style={{ padding: "6px 8px" }}>Pagamento</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>Desconto</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>Valor</th>
                  <th style={{ padding: "6px 8px", textAlign: "center" }}>Doc. Fiscal</th>
                </tr>
              </thead>
              <tbody>
                {sales.map((s) => (
                  <tr key={s.orderId} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                    <td style={{ padding: "6px 8px", fontFamily: "monospace", whiteSpace: "nowrap" }}>{s.orderCode ?? s.orderId.slice(0, 8).toUpperCase()}</td>
                    <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{new Date(s.createdAtMs).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</td>
                    <td style={{ padding: "6px 8px" }}>
                      {s.kind === "SESSAO" ? (
                        <>
                          <strong>{s.childNames}</strong>
                          {s.guardianName && <span style={{ display: "block", fontSize: "12px", color: "var(--text-muted)" }}>Resp: {s.guardianName}</span>}
                        </>
                      ) : (
                        <span title={s.productsSummary ?? undefined}>🛒 {s.productsSummary}</span>
                      )}
                    </td>
                    <td style={{ padding: "6px 8px" }}>{s.method}</td>
                    <td style={{ padding: "6px 8px", textAlign: "right" }}>{s.discountCents > 0 ? `−${money(s.discountCents)}` : "—"}</td>
                    <td style={{ padding: "6px 8px", textAlign: "right", fontWeight: "bold" }}>{money(s.amountCents)}</td>
                    <td style={{ padding: "6px 8px", textAlign: "center" }}>
                      {s.kind === "PDV" && (
                        <Button variant="ghost" size="sm" onClick={() => openNfceForSale(s)} title="Ver / Imprimir Cupom Fiscal NFC-e">
                          📄 NFC-e
                        </Button>
                      )}
                      {s.kind === "SESSAO" && (() => {
                        const doc = nfseDocsMap[s.orderId];
                        const isLoading = !!nfseLoadingMap[s.orderId] || (doc && ["PENDENTE", "ASSINADO", "TRANSMITIDO"].includes(doc.status));

                        if (isLoading) {
                          return (
                            <span style={{ fontSize: "12px", color: "var(--text-muted)", fontWeight: "500" }}>
                              ⏳ Emitindo...
                            </span>
                          );
                        }

                        if (doc?.status === "AUTORIZADO") {
                          const wasSent = !!doc.guardian_whatsapp_sent_at_ms;
                          return (
                            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" }}>
                              <span style={{ fontSize: "11px", color: "var(--success-color, #10b981)", fontWeight: "bold" }}>
                                ✅ NFS-e nº {doc.nfse_numero ?? doc.numero ?? "—"}
                              </span>
                              <Button
                                variant={wasSent ? "ghost" : "primary"}
                                size="sm"
                                onClick={() => handleSendNfseWhatsapp(s, doc)}
                                title="Enviar NFS-e por WhatsApp ao responsável"
                              >
                                📱 {wasSent ? "Reenviar Whats" : "Enviar Whats"}
                              </Button>
                            </div>
                          );
                        }

                        if (doc && ["BLOQUEADO", "REJEITADO", "DENEGADO", "CANCELADO"].includes(doc.status)) {
                          return (
                            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" }}>
                              <button
                                type="button"
                                onClick={() => {
                                  setNfseErrorModal({ sale: s, doc });
                                  setCpfInputModal(s.guardianCpf ? formatCpf(s.guardianCpf) : "");
                                }}
                                style={{
                                  background: "transparent",
                                  border: "none",
                                  cursor: "pointer",
                                  padding: 0,
                                  fontSize: "11px",
                                  color: "var(--error-color, #ef4444)",
                                  fontWeight: "bold",
                                  textDecoration: "underline",
                                }}
                                title="Clique para ver o motivo detalhado do erro"
                              >
                                ❌ {doc.status} (Motivo)
                              </button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleEmitNfse(s)}
                                title="Tentar emitir NFS-e novamente"
                              >
                                🔄 Tentar Novamente
                              </Button>
                            </div>
                          );
                        }

                        return (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => handleEmitNfse(s)}
                            title="Emitir Nota Fiscal de Serviço (NFS-e) sob demanda"
                          >
                            🧾 Emitir NFS-e
                          </Button>
                        );
                      })()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {selectedSaleForNfce && (
        <NfceModal
          doc={selectedSaleForNfce.doc}
          unitName={unit?.name ?? "FaçaAmigos"}
          orderCode={selectedSaleForNfce.sale.orderCode ?? undefined}
          items={[{ description: selectedSaleForNfce.sale.productsSummary ?? "Produtos PDV", quantity: 1, amountCents: selectedSaleForNfce.sale.amountCents }]}
          payments={[{ method: selectedSaleForNfce.sale.method, amountCents: selectedSaleForNfce.sale.amountCents }]}
          onClose={() => setSelectedSaleForNfce(null)}
        />
      )}

      {whatsappPhoneModal && (
        <Modal title="Enviar NFS-e por WhatsApp" onClose={() => setWhatsappPhoneModal(null)}>
          <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
            <p style={{ margin: 0, fontSize: "14px" }}>
              Informe o número de WhatsApp do responsável (<strong>{whatsappPhoneModal.sale.guardianName ?? "Responsável"}</strong>) para enviar o comprovante:
            </p>
            <Input
              label="Telefone / WhatsApp"
              placeholder="(11) 99999-9999"
              value={customWhatsappPhone}
              onChange={(e) => setCustomWhatsappPhone(e.target.value)}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "8px" }}>
              <Button variant="ghost" onClick={() => setWhatsappPhoneModal(null)}>
                Cancelar
              </Button>
              <Button
                variant="primary"
                disabled={!customWhatsappPhone.trim()}
                onClick={() => handleSendNfseWhatsapp(whatsappPhoneModal.sale, whatsappPhoneModal.doc, customWhatsappPhone)}
              >
                📱 Abrir WhatsApp
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {nfseErrorModal && (
        <Modal
          title={`❌ Detalhes da Falha na NFS-e ${nfseErrorModal.sale.orderCode ? `(#${nfseErrorModal.sale.orderCode})` : ""}`}
          onClose={() => setNfseErrorModal(null)}
          maxWidth="520px"
        >
          <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "14px" }}>
            <div style={{ background: "#FEE2E2", color: "#991B1B", padding: "12px 14px", borderRadius: "10px", fontSize: "13px" }}>
              <strong>Motivo do bloqueio / rejeição:</strong>
              <p style={{ margin: "4px 0 0 0", fontWeight: 500, lineHeight: "1.4" }}>
                {nfseErrorModal.doc.last_error || nfseErrorModal.doc.reject_message || "Documento fiscal bloqueado sem motivo especificado."}
              </p>
            </div>

            <div style={{ background: "var(--surface-sunken)", padding: "12px 14px", borderRadius: "10px", fontSize: "13px" }}>
              <div><strong>Responsável:</strong> {nfseErrorModal.sale.guardianName ?? "Não especificado"}</div>
              <div><strong>CPF Atual no Cadastro:</strong> {nfseErrorModal.sale.guardianCpf ? formatCpf(nfseErrorModal.sale.guardianCpf) : "⚠️ Sem CPF cadastrado"}</div>
            </div>

            {nfseErrorModal.sale.guardianId && (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px", background: "var(--surface-card)", border: "1px solid var(--border-subtle)", padding: "14px", borderRadius: "12px" }}>
                <strong style={{ fontSize: "13px" }}>✏️ Cadastrar/Atualizar CPF do Responsável:</strong>
                <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                  Digite o CPF correto abaixo para atualizar o cadastro e tentar a emissão novamente:
                </span>
                <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                  <Input
                    placeholder="000.000.000-00"
                    inputMode="numeric"
                    value={cpfInputModal}
                    onChange={(e) => setCpfInputModal(formatCpf(e.target.value))}
                    style={{ flex: 1, minWidth: "180px" }}
                  />
                  <Button
                    variant="primary"
                    size="sm"
                    loading={cpfUpdating}
                    disabled={cpfUpdating || !isValidCpf(cpfInputModal)}
                    onClick={async () => {
                      if (!nfseErrorModal.sale.guardianId) return;
                      setCpfUpdating(true);
                      try {
                        await Api.updateGuardianCpf(nfseErrorModal.sale.guardianId, cpfInputModal);
                        const updatedSale = { ...nfseErrorModal.sale, guardianCpf: cpfInputModal };
                        setNfseErrorModal(null);
                        await handleEmitNfse(updatedSale);
                      } catch (err) {
                        const msg = err instanceof Error ? err.message : "Erro ao atualizar CPF";
                        alert(msg);
                      } finally {
                        setCpfUpdating(false);
                      }
                    }}
                  >
                    💾 Salvar CPF e Reemitir
                  </Button>
                </div>
                {cpfInputModal.length === 14 && !isValidCpf(cpfInputModal) && (
                  <Tag color="var(--color-error)">CPF inválido</Tag>
                )}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "8px" }}>
              <Button variant="ghost" onClick={() => setNfseErrorModal(null)}>
                Fechar
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  const sale = nfseErrorModal.sale;
                  setNfseErrorModal(null);
                  handleEmitNfse(sale);
                }}
              >
                🔄 Tentar Emissão Novamente
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Sangria/suprimento tira e põe dinheiro na gaveta fora de uma venda —
          é a operação em que a diferença entre Operador e Líder tem
          consequência financeira. Esconder aqui é só cortesia: quem barra de
          verdade é o trigger fa_kiosk_guard_cash_movement (migration
          20260807000006), que recusa a inserção no banco. */}
      <IfCan capability="caixa.sangria">
      <Card style={{ padding: "16px" }}>
        <h2>Sangria / Suprimento</h2>
        <HelpText style={{ marginBottom: "8px" }}>
          Use esta seção sempre que dinheiro sair ou entrar na gaveta fora de uma venda — por exemplo, retirar para
          levar ao banco (Sangria) ou colocar troco extra (Suprimento).
        </HelpText>
        <div style={{ display: "flex", gap: "8px", marginBottom: "8px", flexWrap: "wrap" }}>
          <Button
            variant={movementKind === "SANGRIA" ? "primary" : "secondary"}
            size="sm"
            title="Retirar dinheiro da gaveta — ex.: levar ao banco, sobra de troco"
            onClick={() => setMovementKind("SANGRIA")}
          >
            Sangria (retirar dinheiro)
          </Button>
          <Button
            variant={movementKind === "SUPRIMENTO" ? "primary" : "secondary"}
            size="sm"
            title="Colocar dinheiro extra na gaveta — ex.: reforço de troco"
            onClick={() => setMovementKind("SUPRIMENTO")}
          >
            Suprimento (colocar dinheiro)
          </Button>
        </div>
        <Input label="Valor (R$)" type="number" value={movementAmount} onChange={(e) => setMovementAmount(e.target.value)} />
        <Input label="Motivo / N° Envelope" placeholder="Ex: Sangria depósito banco, envelope #104..." value={movementReason} onChange={(e) => setMovementReason(e.target.value)} />
        <Button variant="secondary" loading={busy} disabled={busy || !!pendingMovementKey} onClick={addMovement} style={{ marginTop: "8px" }}>
          {pendingMovementKey ? "Aguardando conexão..." : "Registrar Lançamento"}
        </Button>

        <ul style={{ marginTop: "12px", paddingLeft: "20px" }}>
          {movements.map((m, i) => (
            <li key={i}>
              <strong>{m.kind}</strong>: {money(m.amount_cents)} {m.reason ? `— ${m.reason}` : ""}
            </li>
          ))}
        </ul>
      </Card>
      </IfCan>

      {/* Mapeamento de Metas & Bonificação Faça Amigos (Lançamentos Diários FA) */}
      <Card style={{ padding: "20px", marginTop: "16px", borderRadius: "16px", borderTop: "4px solid var(--color-primary)" }}>
        <h2 style={{ fontSize: "18px", margin: "0 0 8px 0" }}>🏆 Módulo FA — Bonificação Diária & Locações</h2>
        <HelpText style={{ marginBottom: "16px" }}>
          Registro diário de locações e velocidade de atendimento (vendas em 30m, 1h e 2h) para cálculo automático de metas Ouro/Diamante.
        </HelpText>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px", marginBottom: "16px" }}>
          <div>
            <label style={{ fontSize: "13px", fontWeight: "bold", color: "var(--text-secondary)" }}>Total Locações no Dia</label>
            <input
              type="number"
              defaultValue="0"
              id="fa_locacoes"
              style={{ width: "100%", padding: "8px", borderRadius: "8px", border: "1px solid var(--border-subtle)", background: "var(--surface-sunken)", color: "var(--text-primary)" }}
            />
          </div>
          <div>
            <label style={{ fontSize: "13px", fontWeight: "bold", color: "var(--text-secondary)" }}>Vendas em 30 Minutos</label>
            <input
              type="number"
              defaultValue="0"
              id="fa_vendas30"
              style={{ width: "100%", padding: "8px", borderRadius: "8px", border: "1px solid var(--border-subtle)", background: "var(--surface-sunken)", color: "var(--text-primary)" }}
            />
          </div>
          <div>
            <label style={{ fontSize: "13px", fontWeight: "bold", color: "var(--text-secondary)" }}>Vendas em 1 Hora</label>
            <input
              type="number"
              defaultValue="0"
              id="fa_vendas1h"
              style={{ width: "100%", padding: "8px", borderRadius: "8px", border: "1px solid var(--border-subtle)", background: "var(--surface-sunken)", color: "var(--text-primary)" }}
            />
          </div>
          <div>
            <label style={{ fontSize: "13px", fontWeight: "bold", color: "var(--text-secondary)" }}>Vendas em 2 Horas</label>
            <input
              type="number"
              defaultValue="0"
              id="fa_vendas2h"
              style={{ width: "100%", padding: "8px", borderRadius: "8px", border: "1px solid var(--border-subtle)", background: "var(--surface-sunken)", color: "var(--text-primary)" }}
            />
          </div>
        </div>

        <Button
          variant="teal"
          size="sm"
          onClick={async () => {
            if (!unit) return;
            const loc = (document.getElementById("fa_locacoes") as HTMLInputElement)?.value;
            const v30 = (document.getElementById("fa_vendas30") as HTMLInputElement)?.value;
            const v1h = (document.getElementById("fa_vendas1h") as HTMLInputElement)?.value;
            const v2h = (document.getElementById("fa_vendas2h") as HTMLInputElement)?.value;

            try {
              await Api.saveDailyBonus({
                unitId: unit.id,
                locacoesCount: Number(loc),
                vendas30m: Number(v30),
                vendas1h: Number(v1h),
                vendas2h: Number(v2h),
              });
              alert("Lançamento de Bonificação FA salvo com sucesso!");
            } catch {
              alert("Não foi possível salvar o lançamento. Tente novamente.");
            }
          }}
          style={{ fontWeight: "bold" }}
        >
          💾 Salvar Bonificação Diária
        </Button>
      </Card>

      {error && <p style={{ color: "var(--color-error-text)" }}>{error}</p>}

      <Button
        variant="primary"
        size="lg"
        title="Encerrar o turno atual — conte o dinheiro da gaveta antes de tocar aqui"
        onClick={() => setClosing(true)}
      >
        Fechar turno
      </Button>

      {shiftOpenSuccessModal && (
        <Modal onClose={() => setShiftOpenSuccessModal(null)} ariaLabel="Confirmação de Abertura de Turno" maxWidth="460px">
          <div style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: "14px", padding: "10px 4px" }}>
            <div
              style={{
                width: "64px",
                height: "64px",
                borderRadius: "50%",
                background: "linear-gradient(135deg, #10b981, #059669)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "32px",
                color: "#fff",
                boxShadow: "0 8px 20px rgba(16, 185, 129, 0.35)",
              }}
            >
              🟢
            </div>

            <h2 style={{ margin: 0, fontSize: "22px", fontFamily: "var(--font-display)", color: "#10b981" }}>
              Turno Aberto com Sucesso!
            </h2>

            <div style={{ background: "var(--surface-sunken)", width: "100%", padding: "16px", borderRadius: "14px", display: "flex", flexDirection: "column", gap: "8px" }}>
              <div style={{ fontSize: "14px", color: "var(--text-muted)" }}>
                Unidade: <strong>{shiftOpenSuccessModal.unitName}</strong>
              </div>
              <div style={{ fontSize: "15px", fontWeight: "bold" }}>
                Operador: {shiftOpenSuccessModal.employeeName}
              </div>
              <div style={{ fontSize: "18px", color: "var(--color-teal-text)", fontWeight: "bold", background: "rgba(16, 185, 129, 0.12)", padding: "8px", borderRadius: "8px" }}>
                Fundo de Caixa Inicial: {money(shiftOpenSuccessModal.openingCashCents)}
              </div>
              <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                Horário de Abertura: {new Date(shiftOpenSuccessModal.openedAtMs).toLocaleString("pt-BR")}
              </div>
            </div>

            <div style={{ fontSize: "14px", color: "var(--text-secondary)", fontWeight: "500", fontStyle: "italic" }}>
              🚀 Desejamos um ótimo dia e excelentes vendas para toda a equipe!
            </div>

            <Button
              variant="primary"
              size="lg"
              onClick={() => setShiftOpenSuccessModal(null)}
              style={{ width: "100%", marginTop: "6px", borderRadius: "10px", background: "linear-gradient(135deg, #10b981, #059669)" }}
            >
              Iniciar Operações
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/**
 * Só um hint na tela de fechamento — o valor que realmente vale é o
 * `expected` recalculado pelo servidor na resposta de /close (a
 * mesma regra de negócio, para não haver dois lugares que podem
 * divergir).
 */
function expectedHint(method: string, revenue: RevenueByMethod[], movements: CashMovement[]): number {
  const sales = revenue.find((r) => r.method === method)?.total_cents ?? 0;
  if (method !== "DINHEIRO") return sales;
  const adjustments = movements.reduce((sum, m) => {
    if (m.kind === "SANGRIA") return sum - m.amount_cents;
    return sum + m.amount_cents; // TROCO_INICIAL, SUPRIMENTO, AJUSTE
  }, 0);
  return sales + adjustments;
}
