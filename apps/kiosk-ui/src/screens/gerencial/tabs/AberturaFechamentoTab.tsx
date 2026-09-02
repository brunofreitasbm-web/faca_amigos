import { useEffect, useState } from "react";
import { Card, HelpText, Button } from "@facaamigos/ui";
import { Api } from "../../../api/client.js";
import type { UnitShiftRow } from "../../../api/client.js";
import { useAppState } from "../../../state/AppState.js";
import { money } from "../../../format.js";

function fmtDateTime(ms: number | null): string {
  if (ms === null) return "—";
  return new Date(ms).toLocaleString("pt-BR");
}

function fmtMoneyOrDash(cents: number | null): string {
  return cents === null ? "—" : money(cents);
}

/** Diferença assinada (sobra > 0, falta/quebra < 0) com cor; "—" quando não houve conferência. */
function DiffCell({ cents, negativeWord }: { cents: number | null; negativeWord: "falta" | "quebra" }) {
  if (cents === null) return <>—</>;
  if (cents === 0) return <span style={{ color: "var(--color-teal-text)" }}>✓ ok</span>;
  return (
    <span style={{ color: "var(--color-error-text)", fontWeight: "bold" }}>
      {cents > 0 ? `sobra ${money(cents)}` : `${negativeWord} ${money(Math.abs(cents))}`}
    </span>
  );
}

export function AberturaFechamentoTab() {
  const { units } = useAppState();
  const [selectedUnit, setSelectedUnit] = useState<string>("todas");
  const [shifts, setShifts] = useState<UnitShiftRow[]>([]);
  const [employeeNames, setEmployeeNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  async function loadData() {
    setLoading(true);
    try {
      const [shiftRows, employees] = await Promise.all([
        Api.unitShifts(selectedUnit === "todas" ? null : selectedUnit),
        Api.employees(),
      ]);
      setShifts(shiftRows);
      setEmployeeNames(Object.fromEntries(employees.map((e) => [e.id, e.full_name])));
    } catch {
      // mantém os dados anteriores na tela em caso de falha
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUnit]);

  return (
    <div>
      <Card style={{ padding: "20px", marginBottom: "16px" }}>
        <h2 style={{ fontSize: "18px", margin: "0 0 8px 0" }}>🕒 Abertura e Fechamento</h2>
        <HelpText style={{ marginBottom: "16px" }}>
          Horário de abertura e fechamento do caixa de cada loja, quem abriu/fechou e a conciliação do fundo de caixa: o
          fundo contado na abertura é comparado ao fundo declarado no fechamento anterior; no fechamento, o dinheiro contado
          na gaveta é comparado ao calculado (quebra/sobra), com o fundo que fica para o dia seguinte e o valor do envelope.
        </HelpText>

        <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <label style={{ fontSize: "13px", fontWeight: "bold", display: "block", marginBottom: "4px" }}>Loja</label>
            <select
              value={selectedUnit}
              onChange={(e) => setSelectedUnit(e.target.value)}
              style={{
                padding: "8px 12px",
                borderRadius: "8px",
                border: "1px solid var(--border-subtle)",
                background: "var(--surface-sunken)",
                color: "var(--text-primary)",
                height: "38px",
              }}
            >
              <option value="todas">Todas as Lojas</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>
          <div style={{ marginTop: "20px" }}>
            <Button variant="secondary" onClick={loadData} disabled={loading}>
              🔄 Atualizar
            </Button>
          </div>
        </div>
      </Card>

      <Card style={{ padding: "20px" }}>
        <h3 style={{ fontSize: "16px", marginTop: 0 }}>Turnos ({shifts.length})</h3>
        {shifts.length === 0 ? (
          <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>Nenhum turno registrado.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px", whiteSpace: "nowrap" }}>
            <thead>
              <tr style={{ borderBottom: "2px solid var(--border-subtle)", textAlign: "left" }}>
                <th style={{ padding: "8px" }}>Loja</th>
                <th style={{ padding: "8px" }}>Status</th>
                <th style={{ padding: "8px" }}>Abertura</th>
                <th style={{ padding: "8px" }}>Aberto por</th>
                <th style={{ padding: "8px" }} title="Fundo de caixa contado pelo operador na abertura">Fundo contado (abertura)</th>
                <th style={{ padding: "8px" }} title="Fundo de caixa declarado no fechamento anterior desta loja">Fundo previsto</th>
                <th style={{ padding: "8px" }}>Diverg. abertura</th>
                <th style={{ padding: "8px" }}>Fechamento</th>
                <th style={{ padding: "8px" }}>Fechado por</th>
                <th style={{ padding: "8px" }} title="Dinheiro total contado na gaveta no fechamento">Gaveta contada</th>
                <th style={{ padding: "8px" }} title="Contado − calculado (fundo inicial + vendas em dinheiro ± movimentações)">Quebra / sobra</th>
                <th style={{ padding: "8px" }}>Fundo p/ próx. dia</th>
                <th style={{ padding: "8px" }} title="Contado − fundo para o próximo dia">Envelope</th>
                <th style={{ padding: "8px" }}>Justificativas</th>
              </tr>
            </thead>
            <tbody>
              {shifts.map((s) => (
                <tr key={s.id} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                  <td style={{ padding: "8px" }}>{units.find((u) => u.id === s.unit_id)?.name ?? s.unit_id}</td>
                  <td style={{ padding: "8px" }}>
                    <span style={{ color: s.status === "ABERTO" ? "var(--color-teal-text)" : "var(--text-secondary)", fontWeight: "bold" }}>
                      {s.status === "ABERTO" ? "🟢 Aberto" : "⚪ Fechado"}
                    </span>
                  </td>
                  <td style={{ padding: "8px" }}>{fmtDateTime(s.opened_at_ms)}</td>
                  <td style={{ padding: "8px" }}>{employeeNames[s.opened_by_employee_id] ?? "—"}</td>
                  <td style={{ padding: "8px" }}>{money(s.opening_cash_cents)}</td>
                  <td style={{ padding: "8px" }}>{fmtMoneyOrDash(s.expected_opening_cash_cents)}</td>
                  <td style={{ padding: "8px" }}><DiffCell cents={s.opening_divergence_cents} negativeWord="falta" /></td>
                  <td style={{ padding: "8px" }}>{fmtDateTime(s.closed_at_ms)}</td>
                  <td style={{ padding: "8px" }}>{s.closed_by_employee_id ? employeeNames[s.closed_by_employee_id] ?? "—" : "—"}</td>
                  <td style={{ padding: "8px" }}>{fmtMoneyOrDash(s.counted_cash_cents)}</td>
                  <td style={{ padding: "8px" }}><DiffCell cents={s.cash_break_cents} negativeWord="quebra" /></td>
                  <td style={{ padding: "8px" }}>{fmtMoneyOrDash(s.next_day_float_cents)}</td>
                  <td style={{ padding: "8px" }}>{fmtMoneyOrDash(s.envelope_cents)}</td>
                  <td style={{ padding: "8px", fontSize: "12px", whiteSpace: "normal", minWidth: "180px" }}>
                    {s.close_justifications_json && Object.keys(s.close_justifications_json).length > 0
                      ? Object.entries(s.close_justifications_json).map(([method, text]) => (
                          <div key={method}>
                            <strong>{method}:</strong> {text}
                          </div>
                        ))
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </Card>
    </div>
  );
}
