import { useEffect, useState } from "react";
import { Button, Card, Input, HelpText } from "@facaamigos/ui";
import { Api } from "../api/client.js";
import type { CashMovement, RevenueByMethod, Shift, ShiftSale } from "../api/client.js";
import { useAppState } from "../state/AppState.js";
import { useConfirm } from "../state/ConfirmContext.js";
import { IfCan } from "../auth/RequireCapability.js";
import { money } from "../format.js";
import { OFFLINE_FLUSH_EVENT, OfflineQueuedError } from "../lib/supabase/offlineQueue.js";
import type { OfflineFlushDetail } from "../lib/supabase/offlineQueue.js";

const METHODS = ["DINHEIRO", "PIX", "CREDITO", "DEBITO"] as const;

type CloseResult = { expected: Record<string, number>; declared: Record<string, number>; divergence: Record<string, number> };

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

  const [closing, setClosing] = useState(false);
  const [declared, setDeclared] = useState<Record<string, string>>({ DINHEIRO: "0", PIX: "0", CREDITO: "0", DEBITO: "0" });
  const [closeResult, setCloseResult] = useState<CloseResult | null>(null);
  const [refreshError, setRefreshError] = useState(false);
  // Enquanto isso está preenchido, o fechamento foi enviado mas ficou na fila
  // offline (sem rede no momento) — ainda NÃO aconteceu de fato. O
  // OFFLINE_FLUSH_EVENT abaixo resolve isso quando a fila reenviar sozinha.
  const [pendingCloseKey, setPendingCloseKey] = useState<string | null>(null);

  async function refresh() {
    if (!unit) return;
    try {
      const current = await Api.currentShift(unit.id);
      setShift(current);
      if (current) {
        setMovements(await Api.cashMovements(current.id));
        setRevenue(await Api.revenueByMethod(current.id));
        setSales(await Api.shiftSales(current.id));
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

  async function openShift() {
    if (!unit || !employee) return;
    setBusy(true);
    setError(null);
    try {
      await Api.openShift({ unitId: unit.id, employeeId: employee.id, openingCashCents: Math.round(Number(openingCash) * 100) });
      await refresh();
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
      const msg = err instanceof Error ? err.message : "Erro ao registrar movimentação";
      setError(msg);
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
      const result = await Api.closeShift(shift.id, { employeeId: employee.id, declared: declaredCents });
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

  if (!unit || shift === undefined) return null;

  if (shift === null) {
    return (
      <div style={{ maxWidth: "420px", margin: "60px auto", display: "flex", flexDirection: "column", gap: "16px" }}>
        <h1 style={{ fontFamily: "var(--font-display)" }}>Abrir turno</h1>
        <HelpText>
          É preciso abrir o turno de caixa antes de vender no PDV ou fechar atendimentos. Informe quanto dinheiro
          (em espécie) já está na gaveta para começar — normalmente o troco combinado com a gerência.
        </HelpText>
        <Input label="Troco inicial (R$)" type="number" value={openingCash} onChange={(e) => setOpeningCash(e.target.value)} />
        {error && <p style={{ color: "var(--color-error-text)" }}>{error}</p>}
        <Button variant="primary" size="lg" loading={busy} disabled={busy} onClick={openShift}>
          Abrir turno
        </Button>
      </div>
    );
  }

  if (closeResult) {
    return (
      <div style={{ maxWidth: "480px", margin: "40px auto" }}>
        <h1 style={{ fontFamily: "var(--font-display)" }}>Turno fechado</h1>
        <HelpText>
          "Esperado" é o que o sistema calculou pelas vendas; "Declarado" é o que você contou. "✓ bateu" quer dizer
          que os dois valores são iguais — qualquer diferença aparece com o valor da falta ou sobra.
        </HelpText>
        {/* Cabeçalho e células precisam do MESMO alinhamento — antes o
            cabeçalho ficava centralizado (padrão do navegador) sobre
            valores em dinheiro sem textAlign nenhum (também padrão,
            mas "left"), então título e número nunca ficavam um sobre o
            outro nesta tabela de conferência de caixa. */}
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>Método</th>
              <th style={{ textAlign: "right" }}>Esperado</th>
              <th style={{ textAlign: "right" }}>Declarado</th>
              <th style={{ textAlign: "right" }}>Diferença</th>
            </tr>
          </thead>
          <tbody>
            {Object.keys(closeResult.divergence).map((method) => {
              const balanced = closeResult.divergence[method] === 0;
              return (
                <tr key={method}>
                  <td>{method}</td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(closeResult.expected[method] ?? 0)}</td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(closeResult.declared[method] ?? 0)}</td>
                  <td
                    style={{
                      textAlign: "right",
                      fontVariantNumeric: "tabular-nums",
                      color: balanced ? "var(--color-teal-text)" : "var(--color-error-text)",
                    }}
                  >
                    {/* Texto além da cor: "bateu"/"faltou" é o que decide
                        se o caixa fecha limpo — não pode depender só de
                        enxergar a cor. */}
                    {balanced ? "✓ bateu" : `⚠ ${money(closeResult.divergence[method] ?? 0)}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <Button variant="primary" onClick={() => { setCloseResult(null); setClosing(false); refresh(); }} style={{ marginTop: "16px" }}>
          Ir para novo turno
        </Button>
      </div>
    );
  }

  if (closing) {
    return (
      <div style={{ maxWidth: "420px", margin: "40px auto", display: "flex", flexDirection: "column", gap: "12px" }}>
        <h1 style={{ fontFamily: "var(--font-display)" }}>Fechar turno</h1>
        <HelpText>
          Conte o dinheiro e confira os comprovantes de cada forma de pagamento e digite o valor total que você
          encontrou em cada um. O sistema mostra ao lado o que era esperado — se o valor contado for diferente, a
          diferença aparece destacada depois de confirmar.
        </HelpText>
        <p>Digite o que foi contado por método (o sistema já mostra o esperado ao lado — sem fechamento cego):</p>
        {METHODS.map((method) => (
          <div key={method} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ width: "100px" }}>{method}</span>
            <span style={{ width: "100px", color: "var(--text-secondary)" }}>
              esperado {money(expectedHint(method, revenue, movements))}
            </span>
            <Input
              type="number"
              value={declared[method]}
              onChange={(e) => setDeclared((prev) => ({ ...prev, [method]: e.target.value }))}
            />
          </div>
        ))}
        {error && <p style={{ color: "var(--color-error-text)" }}>{error}</p>}
        {pendingCloseKey && (
          <p style={{ color: "var(--color-amber)" }}>
            ⏳ Sem conexão no momento da confirmação — o fechamento foi salvo e será concluído automaticamente assim
            que a rede voltar. Não feche o turno de novo nem saia desta tela.
          </p>
        )}
        <div style={{ display: "flex", gap: "8px" }}>
          <Button variant="ghost" onClick={() => setClosing(false)} disabled={busy || !!pendingCloseKey}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={handleConfirmClose} loading={busy} disabled={busy || !!pendingCloseKey}>
            {pendingCloseKey ? "Aguardando conexão..." : "Confirmar fechamento"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: "900px", margin: "0 auto", padding: "24px", display: "flex", flexDirection: "column", gap: "20px" }}>
      <h1 style={{ fontFamily: "var(--font-display)" }}>Caixa</h1>
      <HelpText>
        Acompanhe o faturamento e as vendas deste turno, registre retiradas/reforços de dinheiro e feche o turno no
        final do dia.
      </HelpText>

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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

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
        <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
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
        <Button variant="secondary" loading={busy} disabled={busy} onClick={addMovement} style={{ marginTop: "8px" }}>
          Registrar Lançamento
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
          onClick={() => {
            const loc = (document.getElementById("fa_locacoes") as HTMLInputElement)?.value;
            const v30 = (document.getElementById("fa_vendas30") as HTMLInputElement)?.value;
            const v1h = (document.getElementById("fa_vendas1h") as HTMLInputElement)?.value;
            const v2h = (document.getElementById("fa_vendas2h") as HTMLInputElement)?.value;

            fetch("/api/caixa/bonificacao-diaria", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                unit_id: unit?.id,
                employee_name: employee?.full_name,
                locacoes_count: Number(loc),
                vendas_30m: Number(v30),
                vendas_1h: Number(v1h),
                vendas_2h: Number(v2h),
              }),
            })
              .then(() => alert("Lançamento de Bonificação FA salvo com sucesso!"))
              .catch(() => alert("Lançamento registrado localmente."));
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
