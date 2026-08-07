"use client";

import { useState, type CSSProperties } from "react";
import { Badge, Button } from "@/components/design-system";
import { updatePayrollInfo, closePayrollRun, type PayrollCloseItem } from "../actions";
import { INITIAL_ACTION_RESULT } from "@/lib/action-result";
import { PayrollCsvDownloadButton } from "./PayrollCsvDownloadButton";

export interface FolhaPagamentoEmployee {
  id: string;
  fullName: string;
  cpf: string | null;
  position: string | null;
  weeklyHoursContracted: number | null;
  workedMinutes: number;
  workedIncomplete: boolean;
  salaryBaseCents: number | null;
  bankCode: string | null;
  bankAgencia: string | null;
  bankAgenciaDv: string | null;
  bankConta: string | null;
  bankContaDv: string | null;
  bankAccountType: string | null;
  pixKey: string | null;
}

export interface ClosedPayrollItem {
  id: string;
  employee_id: string | null;
  full_name_snapshot: string;
  cpf_snapshot: string | null;
  bank_code_snapshot: string | null;
  bank_agencia_snapshot: string | null;
  bank_agencia_dv_snapshot: string | null;
  bank_conta_snapshot: string | null;
  bank_conta_dv_snapshot: string | null;
  bank_account_type_snapshot: string | null;
  salary_base_cents: number;
  adjustment_cents: number;
  adjustment_note: string | null;
  total_cents: number;
  hours_contracted: number | null;
  hours_worked_minutes: number | null;
}

export interface ClosedRun {
  id: string;
  totalCents: number;
  createdAtMs: number;
  items: ClosedPayrollItem[];
}

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

const cellStyle: CSSProperties = {
  padding: "8px 12px",
  fontSize: "13px",
  color: "var(--text-primary)",
  borderBottom: "1px solid var(--border-subtle)",
  verticalAlign: "top",
};

const inputStyle: CSSProperties = {
  width: "100%",
  padding: "5px 8px",
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

/** Todo employeeId passado por props tem entrada garantida em buildInitialRowState — o fallback é só para satisfazer noUncheckedIndexedAccess. */
function getRow(state: Record<string, RowState>, employeeId: string): RowState {
  return state[employeeId] ?? BLANK_ROW_STATE;
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
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "var(--space-3)" }}>
        <Badge variant="green">Folha fechada</Badge>
        <span style={{ fontSize: "13px", color: "var(--text-muted)" }}>
          Fechada em {new Date(closedRun.createdAtMs).toLocaleString("pt-BR")} — Total: {formatCentsBRL(closedRun.totalCents)}
        </span>
        <PayrollCsvDownloadButton items={closedRun.items} filenameSuffix={String(closedRun.id).slice(0, 8)} />
      </div>
      <div style={{ background: "var(--surface-card)", borderRadius: "var(--radius-card)", overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["Colaborador", "CPF", "Salário base", "Ajuste", "Total", "Banco/Agência/Conta"].map((h) => (
                <th key={h} style={{ textAlign: "left", padding: "8px 12px", fontSize: "13px", color: "var(--text-secondary)", borderBottom: "1.5px solid var(--border-subtle)" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {closedRun.items.map((item) => (
              <tr key={item.id}>
                <td style={cellStyle}>{item.full_name_snapshot}</td>
                <td style={cellStyle}>{item.cpf_snapshot ?? "—"}</td>
                <td style={cellStyle}>{formatCentsBRL(item.salary_base_cents)}</td>
                <td style={cellStyle}>{formatCentsBRL(item.adjustment_cents)}</td>
                <td style={{ ...cellStyle, fontWeight: 600 }}>{formatCentsBRL(item.total_cents)}</td>
                <td style={cellStyle}>
                  {item.bank_code_snapshot ?? "—"} / {item.bank_agencia_snapshot ?? "—"} / {item.bank_conta_snapshot ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface FolhaPagamentoTableProps {
  unitId: string;
  year: number;
  month: number;
  employees: FolhaPagamentoEmployee[];
  closedRun: ClosedRun | null;
}

export function FolhaPagamentoTable({ unitId, year, month, employees, closedRun }: FolhaPagamentoTableProps) {
  const [rowState, setRowState] = useState<Record<string, RowState>>(() => buildInitialRowState(employees));
  const [savingId, setSavingId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);

  if (closedRun) {
    return <ClosedPayrollView closedRun={closedRun} />;
  }

  function updateRow(employeeId: string, patch: Partial<RowState>) {
    setRowState((prev) => ({ ...prev, [employeeId]: { ...getRow(prev, employeeId), ...patch } }));
  }

  async function handleSaveRow(employeeId: string) {
    const state = getRow(rowState, employeeId);
    setSavingId(employeeId);
    setSaveError(null);
    const formData = new FormData();
    formData.set("employee_id", employeeId);
    formData.set("salary_base", state.salaryBase);
    formData.set("bank_code", state.bankCode);
    formData.set("bank_agencia", state.bankAgencia);
    formData.set("bank_agencia_dv", state.bankAgenciaDv);
    formData.set("bank_conta", state.bankConta);
    formData.set("bank_conta_dv", state.bankContaDv);
    formData.set("bank_account_type", state.bankAccountType);
    formData.set("pix_key", state.pixKey);
    const result = await updatePayrollInfo(INITIAL_ACTION_RESULT, formData);
    setSavingId(null);
    if (!result.ok) setSaveError(result.message);
  }

  async function handleClose() {
    setClosing(true);
    setCloseError(null);
    const items: PayrollCloseItem[] = employees.map((e) => {
      const state = getRow(rowState, e.id);
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
    const result = await closePayrollRun(unitId, year, month, items);
    setClosing(false);
    if (!result.ok) setCloseError(result.message);
  }

  const totalCents = employees.reduce((sum, e) => {
    const state = getRow(rowState, e.id);
    return sum + inputToCents(state.salaryBase) + inputToCents(state.adjustment);
  }, 0);

  return (
    <div>
      <div style={{ background: "var(--surface-card)", borderRadius: "var(--radius-card)", overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {[
                "Colaborador", "CPF", "Jornada semanal", "Horas batidas no mês",
                "Salário base (R$)", "Banco", "Agência", "Conta", "Tipo", "Ajuste (R$)", "Total", "",
              ].map((h) => (
                <th key={h} style={{ textAlign: "left", padding: "8px 12px", fontSize: "13px", color: "var(--text-secondary)", borderBottom: "1.5px solid var(--border-subtle)", whiteSpace: "nowrap" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {employees.map((e) => {
              const state = getRow(rowState, e.id);
              const rowTotalCents = inputToCents(state.salaryBase) + inputToCents(state.adjustment);
              return (
                <tr key={e.id}>
                  <td style={cellStyle}>
                    {e.fullName}
                    {e.position && <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>{e.position}</div>}
                  </td>
                  <td style={cellStyle}>{e.cpf ?? "—"}</td>
                  <td style={cellStyle}>{e.weeklyHoursContracted != null ? `${e.weeklyHoursContracted}h/sem` : "—"}</td>
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
                      <input type="text" value={state.bankAgenciaDv} onChange={(ev) => updateRow(e.id, { bankAgenciaDv: ev.target.value })} style={{ ...inputStyle, width: "40px" }} placeholder="DV" />
                    </div>
                  </td>
                  <td style={{ ...cellStyle, minWidth: "130px" }}>
                    <div style={{ display: "flex", gap: "4px" }}>
                      <input type="text" value={state.bankConta} onChange={(ev) => updateRow(e.id, { bankConta: ev.target.value })} style={inputStyle} placeholder="Conta" />
                      <input type="text" value={state.bankContaDv} onChange={(ev) => updateRow(e.id, { bankContaDv: ev.target.value })} style={{ ...inputStyle, width: "40px" }} placeholder="DV" />
                    </div>
                  </td>
                  <td style={{ ...cellStyle, minWidth: "100px" }}>
                    <select value={state.bankAccountType} onChange={(ev) => updateRow(e.id, { bankAccountType: ev.target.value })} className="fa-select" style={inputStyle}>
                      <option value="CORRENTE">Corrente</option>
                      <option value="POUPANCA">Poupança</option>
                    </select>
                  </td>
                  <td style={{ ...cellStyle, minWidth: "100px" }}>
                    <input type="text" inputMode="decimal" value={state.adjustment} onChange={(ev) => updateRow(e.id, { adjustment: ev.target.value })} style={inputStyle} />
                  </td>
                  <td style={{ ...cellStyle, fontWeight: 600, whiteSpace: "nowrap" }}>{formatCentsBRL(rowTotalCents)}</td>
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
      {saveError && <p style={{ color: "var(--color-error-text)", fontSize: "13px" }}>{saveError}</p>}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "var(--space-4)" }}>
        <strong>Total da folha: {formatCentsBRL(totalCents)}</strong>
        <Button type="button" variant="teal" loading={closing} disabled={employees.length === 0} onClick={handleClose}>
          Fechar Folha do Mês ({month.toString().padStart(2, "0")}/{year})
        </Button>
      </div>
      {closeError && <p style={{ color: "var(--color-error-text)", fontSize: "13px" }}>{closeError}</p>}
    </div>
  );
}
