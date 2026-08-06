import { useEffect, useState } from "react";
import { Button, Card, Input } from "@facaamigos/ui";
import { Api } from "../api/client.js";
import type { CashMovement, RevenueByMethod, Shift } from "../api/client.js";
import { useAppState } from "../state/AppState.js";
import { useToast } from "../state/ToastContext.js";
import { useConfirm } from "../state/ConfirmContext.js";
import { money } from "../format.js";

const METHODS = ["DINHEIRO", "PIX", "CREDITO", "DEBITO"] as const;

export function CaixaScreen() {
  const { unit, employee } = useAppState();
  const toast = useToast();
  const confirm = useConfirm();
  const [shift, setShift] = useState<Shift | null | undefined>(undefined);
  const [openingCash, setOpeningCash] = useState("0");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [movements, setMovements] = useState<CashMovement[]>([]);
  const [revenue, setRevenue] = useState<RevenueByMethod[]>([]);
  const [movementKind, setMovementKind] = useState<"SANGRIA" | "SUPRIMENTO">("SANGRIA");
  const [movementAmount, setMovementAmount] = useState("0");
  const [movementReason, setMovementReason] = useState("");

  const [closing, setClosing] = useState(false);
  const [declared, setDeclared] = useState<Record<string, string>>({ DINHEIRO: "0", PIX: "0", CREDITO: "0", DEBITO: "0" });
  const [closeResult, setCloseResult] = useState<{ expected: Record<string, number>; declared: Record<string, number>; divergence: Record<string, number> } | null>(null);

  async function refresh() {
    if (!unit) return;
    const current = await Api.currentShift(unit.id);
    setShift(current);
    if (current) {
      setMovements(await Api.cashMovements(current.id));
      setRevenue(await Api.revenueByMethod(current.id));
    }
  }

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unit]);

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
      toast.error(msg);
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
      toast.error(msg);
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
      const msg = err instanceof Error ? err.message : "Erro ao fechar turno";
      setError(msg);
      toast.error(msg);
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
        <h1 style={{ fontFamily: "var(--font-display)" }}>Abrir turno — {unit.name}</h1>
        <Input label="Troco inicial (R$)" type="number" value={openingCash} onChange={(e) => setOpeningCash(e.target.value)} />
        {error && <p style={{ color: "var(--color-error)" }}>{error}</p>}
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
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>Método</th>
              <th>Esperado</th>
              <th>Declarado</th>
              <th>Diferença</th>
            </tr>
          </thead>
          <tbody>
            {Object.keys(closeResult.divergence).map((method) => (
              <tr key={method}>
                <td>{method}</td>
                <td>{money(closeResult.expected[method] ?? 0)}</td>
                <td>{money(closeResult.declared[method] ?? 0)}</td>
                <td style={{ color: closeResult.divergence[method] === 0 ? "var(--color-teal)" : "var(--color-error)" }}>
                  {money(closeResult.divergence[method] ?? 0)}
                </td>
              </tr>
            ))}
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
        {error && <p style={{ color: "var(--color-error)" }}>{error}</p>}
        <div style={{ display: "flex", gap: "8px" }}>
          <Button variant="ghost" onClick={() => setClosing(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={handleConfirmClose} loading={busy} disabled={busy}>
            Confirmar fechamento
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: "640px", margin: "0 auto", padding: "24px", display: "flex", flexDirection: "column", gap: "20px" }}>
      <h1 style={{ fontFamily: "var(--font-display)" }}>Caixa — {unit.name}</h1>

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
        <h2>Sangria / Suprimento</h2>
        <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
          <Button variant={movementKind === "SANGRIA" ? "primary" : "secondary"} size="sm" onClick={() => setMovementKind("SANGRIA")}>
            Sangria
          </Button>
          <Button variant={movementKind === "SUPRIMENTO" ? "primary" : "secondary"} size="sm" onClick={() => setMovementKind("SUPRIMENTO")}>
            Suprimento
          </Button>
        </div>
        <Input label="Valor (R$)" type="number" value={movementAmount} onChange={(e) => setMovementAmount(e.target.value)} />
        <Input label="Motivo" value={movementReason} onChange={(e) => setMovementReason(e.target.value)} />
        <Button variant="secondary" loading={busy} disabled={busy} onClick={addMovement} style={{ marginTop: "8px" }}>
          Registrar
        </Button>

        <ul>
          {movements.map((m, i) => (
            <li key={i}>
              {m.kind}: {money(m.amount_cents)} {m.reason ? `— ${m.reason}` : ""}
            </li>
          ))}
        </ul>
      </Card>

      {error && <p style={{ color: "var(--color-error)" }}>{error}</p>}

      <Button variant="primary" size="lg" onClick={() => setClosing(true)}>
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
