import { useState, useEffect, useCallback, type CSSProperties } from "react";
import { Button, Select, Badge, HelpText } from "@facaamigos/ui";
import { useAppState } from "../../../state/AppState.js";
import {
  Api,
  type FolhaPagamentoEmployee,
  type ClosedRun,
  type ClosedPayrollItem,
  type PayrollCloseItem,
} from "../../../api/client.js";
import { PayrollCsvDownloadButton } from "./PayrollCsvDownloadButton.js";
import { ROLE_LABEL } from "../../../auth/capabilities.js";

const MONTH_LABEL = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

interface RowState {
  salaryBase: string;
  bankCode: string;
  bankAgencia: string;
  bankAgenciaDv: string;
  bankConta: string;
  bankContaDv: string;
  bankAccountType: string;
  pixKey: string;
  adjustment: string;
  adjustmentNote: string;
}

const cellStyle: CSSProperties = {
  padding: "10px 12px",
  fontSize: "13px",
  color: "var(--text-primary)",
  borderBottom: "1px solid var(--border-subtle)",
  verticalAlign: "middle",
};

const inputStyle: CSSProperties = {
  width: "100%",
  padding: "6px 8px",
  borderRadius: "6px",
  border: "1px solid var(--border-subtle)",
  background: "var(--surface-subtle)",
  color: "var(--text-primary)",
  fontSize: "13px",
};

const BLANK_ROW_STATE: RowState = {
  salaryBase: "",
  bankCode: "",
  bankAgencia: "",
  bankAgenciaDv: "",
  bankConta: "",
  bankContaDv: "",
  bankAccountType: "CORRENTE",
  pixKey: "",
  adjustment: "0,00",
  adjustmentNote: "",
};

function centsToInput(cents: number | null): string {
  return cents == null ? "" : (cents / 100).toFixed(2);
}

function inputToCents(value: string): number {
  const normalized = value.trim().replace(",", ".");
  if (normalized === "") return 0;
  const n = Number(normalized);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h${String(m).padStart(2, "0")}`;
}

function formatCentsBRL(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function buildInitialRowState(employees: FolhaPagamentoEmployee[]): Record<string, RowState> {
  return Object.fromEntries(
    employees.map((e) => [
      e.id,
      {
        salaryBase: centsToInput(e.salaryBaseCents),
        bankCode: e.bankCode ?? "",
        bankAgencia: e.bankAgencia ?? "",
        bankAgenciaDv: e.bankAgenciaDv ?? "",
        bankConta: e.bankConta ?? "",
        bankContaDv: e.bankContaDv ?? "",
        bankAccountType: e.bankAccountType ?? "CORRENTE",
        pixKey: e.pixKey ?? "",
        adjustment: "0,00",
        adjustmentNote: "",
      } satisfies RowState,
    ]),
  );
}

function ClosedPayrollView({ closedRun }: { closedRun: ClosedRun }) {
  return (
    <div style={{ marginTop: "16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px", flexWrap: "wrap" }}>
        <Badge variant="green">Folha fechada</Badge>
        <span style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
          Fechada em {new Date(closedRun.createdAtMs).toLocaleString("pt-BR")} — Total: <strong>{formatCentsBRL(closedRun.totalCents)}</strong>
        </span>
        <div style={{ marginLeft: "auto" }}>
          <PayrollCsvDownloadButton items={closedRun.items} filenameSuffix={`${closedRun.year}_${closedRun.month}`} />
        </div>
      </div>
      <div style={{ background: "var(--surface-card)", borderRadius: "var(--radius-lg)", overflow: "auto", border: "1px solid var(--border-subtle)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["Colaborador", "CPF", "Salário base", "Ajuste", "Total Líquido", "Dados Bancários"].map((h) => (
                <th key={h} style={{ textAlign: "left", padding: "10px 12px", fontSize: "12px", color: "var(--text-secondary)", borderBottom: "1.5px solid var(--border-subtle)", textTransform: "uppercase" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {closedRun.items.map((item) => (
              <tr key={item.id}>
                <td style={cellStyle}>
                  <strong style={{ color: "var(--text-primary)" }}>{item.full_name_snapshot}</strong>
                </td>
                <td style={cellStyle}>{item.cpf_snapshot ?? "—"}</td>
                <td style={cellStyle}>{formatCentsBRL(item.salary_base_cents)}</td>
                <td style={cellStyle}>{formatCentsBRL(item.adjustment_cents)}</td>
                <td style={{ ...cellStyle, fontWeight: 600, color: "var(--color-primary)" }}>{formatCentsBRL(item.total_cents)}</td>
                <td style={cellStyle}>
                  {item.bank_code_snapshot ? `Bco ${item.bank_code_snapshot} / Ag ${item.bank_agencia_snapshot}-${item.bank_agencia_dv_snapshot || "0"} / CC ${item.bank_conta_snapshot}-${item.bank_conta_dv_snapshot || "0"}` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function FolhaPagamentoTab() {
  const { units } = useAppState();
  const now = new Date();
  const [selectedUnitId, setSelectedUnitId] = useState<string>(() => units[0]?.id ?? "");
  const [year, setYear] = useState<number>(now.getFullYear());
  const [month, setMonth] = useState<number>(now.getMonth() + 1);

  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [tablesMissing, setTablesMissing] = useState<boolean>(false);

  const [employees, setEmployees] = useState<FolhaPagamentoEmployee[]>([]);
  const [runs, setRuns] = useState<ClosedRun[]>([]);
  const [closedRun, setClosedRun] = useState<ClosedRun | null>(null);

  const [rowState, setRowState] = useState<Record<string, RowState>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [closing, setClosing] = useState<boolean>(false);
  const [closeError, setCloseError] = useState<string | null>(null);

  const yearOptions = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i);

  const loadData = useCallback(async () => {
    if (!selectedUnitId) return;
    setLoading(true);
    setError(null);
    try {
      const timezone = units.find((u) => u.id === selectedUnitId)?.timezone ?? undefined;
      const res = await Api.getFolhaPagamentoData(selectedUnitId, year, month, timezone);
      setEmployees(res.employees);
      setRuns(res.runs);
      setClosedRun(res.closedRun);
      setTablesMissing(res.tablesMissing);
      setRowState(buildInitialRowState(res.employees));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar folha de pagamento");
    } finally {
      setLoading(false);
    }
  }, [selectedUnitId, year, month, units]);


  useEffect(() => {
    loadData();
  }, [loadData]);

  function getRow(employeeId: string): RowState {
    return rowState[employeeId] ?? BLANK_ROW_STATE;
  }

  function updateRow(employeeId: string, patch: Partial<RowState>) {
    setRowState((prev) => ({ ...prev, [employeeId]: { ...(prev[employeeId] ?? BLANK_ROW_STATE), ...patch } }));
  }

  async function handleSaveRow(employeeId: string) {
    const state = getRow(employeeId);
    setSavingId(employeeId);
    setSaveError(null);
    try {
      await Api.updatePayrollInfo(employeeId, {
        salaryBaseCents: inputToCents(state.salaryBase),
        bankCode: state.bankCode || null,
        bankAgencia: state.bankAgencia || null,
        bankAgenciaDv: state.bankAgenciaDv || null,
        bankConta: state.bankConta || null,
        bankContaDv: state.bankContaDv || null,
        bankAccountType: state.bankAccountType || null,
        pixKey: state.pixKey || null,
      });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Erro ao salvar dados bancários");
    } finally {
      setSavingId(null);
    }
  }

  async function handleClosePayroll() {
    if (!selectedUnitId) return;
    setClosing(true);
    setCloseError(null);
    try {
      const items: PayrollCloseItem[] = employees.map((e) => {
        const state = getRow(e.id);
        const salaryBaseCents = inputToCents(state.salaryBase);
        const adjustmentCents = inputToCents(state.adjustment);
        return {
          employeeId: e.id,
          fullName: e.fullName,
          cpf: e.cpf,
          bankCode: state.bankCode || null,
          bankAgencia: state.bankAgencia || null,
          bankAgenciaDv: state.bankAgenciaDv || null,
          bankConta: state.bankConta || null,
          bankContaDv: state.bankContaDv || null,
          bankAccountType: state.bankAccountType || null,
          salaryBaseCents,
          adjustmentCents,
          adjustmentNote: state.adjustmentNote || null,
          totalCents: salaryBaseCents + adjustmentCents,
          hoursContracted: e.weeklyHoursContracted,
          hoursWorkedMinutes: e.workedMinutes,
        };
      });

      await Api.closePayrollRun(selectedUnitId, year, month, items);
      await loadData();
    } catch (err) {
      setCloseError(err instanceof Error ? err.message : "Erro ao fechar folha do mês");
    } finally {
      setClosing(false);
    }
  }

  const totalCents = employees.reduce((sum, e) => {
    const state = getRow(e.id);
    return sum + inputToCents(state.salaryBase) + inputToCents(state.adjustment);
  }, 0);

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: "16px", padding: "16px", margin: "16px 0", borderRadius: "var(--radius-lg)", background: "var(--surface-card)", border: "1px solid var(--border-subtle)" }}>
        <div style={{ width: "200px" }}>
          <Select label="Unidade" value={selectedUnitId} onChange={(e) => setSelectedUnitId(e.target.value)}>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </div>
        <div style={{ width: "160px" }}>
          <Select label="Mês" value={String(month)} onChange={(e) => setMonth(Number(e.target.value))}>
            {MONTH_LABEL.map((label, i) => (
              <option key={label} value={i + 1}>
                {label}
              </option>
            ))}
          </Select>
        </div>
        <div style={{ width: "120px" }}>
          <Select label="Ano" value={String(year)} onChange={(e) => setYear(Number(e.target.value))}>
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {loading && <p style={{ color: "var(--text-secondary)", fontSize: "14px" }}>Carregando folha de pagamento...</p>}
      {error && <p style={{ color: "var(--color-error-text)", fontSize: "14px" }}>{error}</p>}

      {tablesMissing && (
        <div style={{ padding: "14px 18px", marginBottom: "16px", borderRadius: "8px", background: "rgba(234, 179, 8, 0.12)", border: "1px solid rgba(234, 179, 8, 0.3)", color: "var(--text-primary)" }}>
          <strong style={{ display: "block", marginBottom: "4px" }}>⚠️ Tabelas da Folha de Pagamento pendentes no Supabase</strong>
          <p style={{ margin: 0, fontSize: "13px", lineHeight: "1.5", color: "var(--text-secondary)" }}>
            As tabelas da folha (<code>fa_kiosk_employee_payroll_info</code> e <code>fa_kiosk_payroll_runs</code>) ainda não foram criadas no banco de dados do Supabase. Para habilitar o salvamento de dados bancários e fechamento da folha no ambiente online, execute a migration <code>20260807000013_fa_kiosk_payroll.sql</code> no <strong>SQL Editor</strong> do painel Supabase.
          </p>
        </div>
      )}

      {!loading && !error && (

        <>
          {closedRun ? (
            <ClosedPayrollView closedRun={closedRun} />
          ) : employees.length === 0 ? (
            <HelpText>Nenhum colaborador ativo nesta unidade para o período selecionado.</HelpText>
          ) : (
            <div>
              <div style={{ background: "var(--surface-card)", borderRadius: "var(--radius-lg)", overflow: "auto", border: "1px solid var(--border-subtle)" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      {[
                        "Colaborador", "CPF", "Horas no mês", "Salário base (R$)",
                        "Banco", "Agência", "Conta", "Tipo", "Ajuste (R$)", "Total Líquido", "",
                      ].map((h) => (
                        <th key={h} style={{ textAlign: "left", padding: "10px 12px", fontSize: "12px", color: "var(--text-secondary)", borderBottom: "1.5px solid var(--border-subtle)", whiteSpace: "nowrap", textTransform: "uppercase" }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {employees.map((e) => {
                      const state = getRow(e.id);
                      const rowTotalCents = inputToCents(state.salaryBase) + inputToCents(state.adjustment);
                      return (
                        <tr key={e.id}>
                          <td style={cellStyle}>
                            <strong style={{ color: "var(--text-primary)" }}>{e.fullName}</strong>
                            <div style={{ fontSize: "11px", color: "var(--text-secondary)" }}>Permissão: {ROLE_LABEL[e.role]}</div>
                          </td>
                          <td style={cellStyle}>{e.cpf ?? "—"}</td>
                          <td style={cellStyle}>
                            {formatMinutes(e.workedMinutes)}
                            {e.workedIncomplete && <div style={{ fontSize: "11px", color: "var(--color-error-text)" }}>marcação incompleta</div>}
                          </td>
                          <td style={{ ...cellStyle, minWidth: "100px" }}>
                            <input type="text" inputMode="decimal" value={state.salaryBase} onChange={(ev) => updateRow(e.id, { salaryBase: ev.target.value })} style={inputStyle} placeholder="0,00" />
                          </td>
                          <td style={{ ...cellStyle, minWidth: "70px" }}>
                            <input type="text" value={state.bankCode} onChange={(ev) => updateRow(e.id, { bankCode: ev.target.value })} style={inputStyle} placeholder="237" />
                          </td>
                          <td style={{ ...cellStyle, minWidth: "110px" }}>
                            <div style={{ display: "flex", gap: "4px" }}>
                              <input type="text" value={state.bankAgencia} onChange={(ev) => updateRow(e.id, { bankAgencia: ev.target.value })} style={inputStyle} placeholder="Agência" />
                              <input type="text" value={state.bankAgenciaDv} onChange={(ev) => updateRow(e.id, { bankAgenciaDv: ev.target.value })} style={{ ...inputStyle, width: "38px" }} placeholder="DV" />
                            </div>
                          </td>
                          <td style={{ ...cellStyle, minWidth: "130px" }}>
                            <div style={{ display: "flex", gap: "4px" }}>
                              <input type="text" value={state.bankConta} onChange={(ev) => updateRow(e.id, { bankConta: ev.target.value })} style={inputStyle} placeholder="Conta" />
                              <input type="text" value={state.bankContaDv} onChange={(ev) => updateRow(e.id, { bankContaDv: ev.target.value })} style={{ ...inputStyle, width: "38px" }} placeholder="DV" />
                            </div>
                          </td>
                          <td style={{ ...cellStyle, minWidth: "100px" }}>
                            <select value={state.bankAccountType} onChange={(ev) => updateRow(e.id, { bankAccountType: ev.target.value })} className="fa-select" style={inputStyle}>
                              <option value="CORRENTE">Corrente</option>
                              <option value="POUPANCA">Poupança</option>
                            </select>
                          </td>
                          <td style={{ ...cellStyle, minWidth: "90px" }}>
                            <input type="text" inputMode="decimal" value={state.adjustment} onChange={(ev) => updateRow(e.id, { adjustment: ev.target.value })} style={inputStyle} />
                          </td>
                          <td style={{ ...cellStyle, fontWeight: 600, whiteSpace: "nowrap", color: "var(--color-primary)" }}>{formatCentsBRL(rowTotalCents)}</td>
                          <td style={cellStyle}>
                            <Button type="button" variant="ghost" size="sm" loading={savingId === e.id} onClick={() => handleSaveRow(e.id)}>
                              Salvar
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {saveError && <p style={{ color: "var(--color-error-text)", fontSize: "13px", marginTop: "8px" }}>{saveError}</p>}

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "16px" }}>
                <strong style={{ fontSize: "15px" }}>Total da folha: {formatCentsBRL(totalCents)}</strong>
                <Button type="button" variant="teal" loading={closing} disabled={employees.length === 0} onClick={handleClosePayroll}>
                  Fechar Folha do Mês ({month.toString().padStart(2, "0")}/{year})
                </Button>
              </div>
              {closeError && <p style={{ color: "var(--color-error-text)", fontSize: "13px", marginTop: "8px" }}>{closeError}</p>}
            </div>
          )}

          {runs.length > 0 && (
            <div style={{ marginTop: "32px" }}>
              <h3 style={{ fontSize: "16px", fontFamily: "var(--font-display)", marginBottom: "12px" }}>Histórico de Folhas Fechadas</h3>
              <div style={{ background: "var(--surface-card)", borderRadius: "var(--radius-lg)", overflow: "auto", border: "1px solid var(--border-subtle)" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      {["Período", "Fechada em", "Total", "Ação"].map((h) => (
                        <th key={h} style={{ textAlign: "left", padding: "10px 12px", fontSize: "12px", color: "var(--text-secondary)", borderBottom: "1.5px solid var(--border-subtle)", textTransform: "uppercase" }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map((r) => (
                      <tr key={r.id}>
                        <td style={cellStyle}>
                          <strong>{MONTH_LABEL[r.month - 1]} / {r.year}</strong>
                        </td>
                        <td style={cellStyle}>{new Date(r.createdAtMs).toLocaleString("pt-BR")}</td>
                        <td style={{ ...cellStyle, fontWeight: 600 }}>{formatCentsBRL(r.totalCents)}</td>
                        <td style={cellStyle}>
                          <PayrollCsvDownloadButton items={r.items} filenameSuffix={`${r.year}_${r.month}`} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
