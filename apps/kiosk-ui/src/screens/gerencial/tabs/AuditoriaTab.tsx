import { useEffect, useMemo, useState } from "react";
import { Card, HelpText, Button, Input, Select } from "@facaamigos/ui";
import { Api } from "../../../api/client.js";
import type { AuditLogEntry, Employee, Unit } from "../../../api/client.js";
import { ROLE_LABEL } from "../../../auth/capabilities.js";
import { auditActionLabel, formatAuditDetails } from "./auditLogFormat.js";

function startOfDayMs(dateStr: string) {
  return new Date(`${dateStr}T00:00:00`).getTime();
}

function endOfDayMs(dateStr: string) {
  return new Date(`${dateStr}T23:59:59.999`).getTime();
}

// Precisa bater com o p_limit pedido em Api.auditLog e com o teto (least(...,500)) da RPC
// fa_gerencial_audit_log: se a busca voltar exatamente esse tanto, o corte é real, não coincidência.
const AUDIT_LOG_LIMIT = 500;

function csvEscape(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows.map((row) => row.map(csvEscape).join(",")).join("\r\n");
  // BOM no início para o Excel abrir acentuação em UTF-8 corretamente.
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function AuditoriaTab() {
  const [search, setSearch] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [severity, setSeverity] = useState("");
  const [unitId, setUnitId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [rawEntries, setRawEntries] = useState<AuditLogEntry[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    Api.allEmployees().then(setEmployees).catch(() => {});
    Api.units().then(setUnits).catch(() => {});
  }, []);

  const employeeNameById = useMemo(() => new Map(employees.map((e) => [e.id, e.full_name])), [employees]);
  const unitNameById = useMemo(() => new Map(units.map((u) => [u.id, u.name])), [units]);
  const detailCtx = useMemo(
    () => ({
      employeeName: (id: unknown) => (typeof id === "string" ? (employeeNameById.get(id) ?? null) : null),
      unitName: (id: unknown) => (typeof id === "string" ? (unitNameById.get(id) ?? null) : null),
    }),
    [employeeNameById, unitNameById],
  );

  async function loadData() {
    setLoading(true);
    try {
      const rows = await Api.auditLog({
        search: search.trim() || undefined,
        employeeId: employeeId || undefined,
        severity: severity || undefined,
        startMs: startDate ? startOfDayMs(startDate) : undefined,
        endMs: endDate ? endOfDayMs(endDate) : undefined,
      });
      setRawEntries(rows);
    } catch {
      // mantém os dados anteriores na tela em caso de falha
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = setTimeout(loadData, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, employeeId, severity, startDate, endDate]);

  // unidade não vira coluna na tabela: filtra sobre details_json.unitId que os triggers já gravam.
  const entries = useMemo(
    () => (unitId ? rawEntries.filter((e) => e.details_json?.unitId === unitId) : rawEntries),
    [rawEntries, unitId],
  );
  const possiblyTruncated = rawEntries.length >= AUDIT_LOG_LIMIT;

  function handleExportCsv() {
    const header = ["Data/Hora", "Ação", "Operador", "Papel", "Severidade", "Detalhes"];
    const body = entries.map((entry) => [
      new Date(entry.at_ms).toLocaleString("pt-BR"),
      auditActionLabel(entry.action),
      entry.employee_name ?? "Sistema",
      entry.employee_role ? (ROLE_LABEL[entry.employee_role as keyof typeof ROLE_LABEL] ?? entry.employee_role) : "",
      entry.severity,
      formatAuditDetails(entry.action, entry.details_json, detailCtx).join(" | "),
    ]);
    downloadCsv(`auditoria_${new Date().toISOString().slice(0, 10)}.csv`, [header, ...body]);
  }

  return (
    <div>
      <Card style={{ padding: "20px", marginBottom: "16px" }}>
        <h2 style={{ fontSize: "18px", margin: "0 0 8px 0" }}>🔍 Auditoria</h2>
        <HelpText style={{ marginBottom: "16px" }}>
          Quem fez o quê, quando: log de ações sensíveis do sistema (login, alteração de colaborador, dados fiscais, unidades) para conferência e apuração.
        </HelpText>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px" }}>
          <Input label="Buscar (ação ou operador)" placeholder="ex.: caixa, João" value={search} onChange={(e) => setSearch(e.target.value)} />
          <Select label="Operador" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
            <option value="">Todos</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.full_name} ({ROLE_LABEL[e.role]})
              </option>
            ))}
          </Select>
          <Select label="Severidade" value={severity} onChange={(e) => setSeverity(e.target.value)}>
            <option value="">Todas</option>
            <option value="INFO">Info</option>
            <option value="ALERTA">Alerta</option>
          </Select>
          <Select label="Unidade" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
            <option value="">Todas</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
          <Input label="De" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          <Input label="Até" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>

        <div style={{ marginTop: "12px", display: "flex", gap: "8px" }}>
          <Button variant="secondary" onClick={loadData} disabled={loading}>
            🔄 Atualizar
          </Button>
          <Button variant="secondary" onClick={handleExportCsv} disabled={entries.length === 0}>
            ⬇️ Exportar CSV
          </Button>
        </div>
      </Card>

      {possiblyTruncated && (
        <Card style={{ padding: "12px 16px", marginBottom: "16px", background: "var(--color-warning-bg, rgba(217,119,6,0.1))" }}>
          <p style={{ margin: 0, fontSize: "13px", color: "var(--color-warning-text, #92400e)" }}>
            ⚠️ Mostrando os {AUDIT_LOG_LIMIT} registros mais recentes para os filtros de operador/severidade/período — pode haver
            mais. Restrinja o período (De/Até) para ver o restante.
          </p>
        </Card>
      )}

      <Card style={{ padding: "20px" }}>
        <h3 style={{ fontSize: "16px", marginTop: 0 }}>Ações Registradas ({entries.length})</h3>
        {entries.length === 0 ? (
          <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>Nenhum registro encontrado para os filtros atuais.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {entries.map((entry) => {
              const detailLines = formatAuditDetails(entry.action, entry.details_json, detailCtx);
              const hasTechnicalJson = entry.details_json && Object.keys(entry.details_json).length > 0;
              return (
                <div
                  key={entry.id}
                  style={{
                    border: "1px solid var(--border-subtle)",
                    borderRadius: "10px",
                    padding: "12px 14px",
                  }}
                >
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px" }}>
                    <span
                      style={{
                        fontSize: "11px",
                        fontWeight: "bold",
                        padding: "2px 8px",
                        borderRadius: "9999px",
                        color: entry.severity === "ALERTA" ? "var(--color-error-text)" : "var(--text-secondary)",
                        background: entry.severity === "ALERTA" ? "var(--color-error-bg, rgba(220,38,38,0.12))" : "var(--surface-sunken)",
                      }}
                    >
                      {entry.severity === "ALERTA" ? "Alerta" : "Info"}
                    </span>
                    <strong style={{ color: "var(--color-primary)" }}>{auditActionLabel(entry.action)}</strong>
                    <span style={{ fontSize: "12px", color: "var(--text-secondary)", marginLeft: "auto" }}>
                      {new Date(entry.at_ms).toLocaleString("pt-BR")}
                    </span>
                  </div>
                  <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "4px" }}>
                    {entry.employee_name ? `${entry.employee_name} (${ROLE_LABEL[entry.employee_role as keyof typeof ROLE_LABEL] ?? entry.employee_role})` : "Sistema"}
                  </div>
                  {detailLines.length > 0 && (
                    <ul style={{ margin: "8px 0 0", paddingLeft: "18px", fontSize: "13px", color: "var(--text-primary)" }}>
                      {detailLines.map((line, i) => (
                        <li key={i}>{line}</li>
                      ))}
                    </ul>
                  )}
                  {hasTechnicalJson && (
                    <div style={{ marginTop: "8px" }}>
                      <button
                        type="button"
                        onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                        style={{
                          background: "none",
                          border: "none",
                          padding: 0,
                          fontSize: "12px",
                          color: "var(--text-secondary)",
                          textDecoration: "underline",
                          cursor: "pointer",
                        }}
                      >
                        {expandedId === entry.id ? "Ocultar JSON técnico" : "Ver JSON técnico"}
                      </button>
                      {expandedId === entry.id && (
                        <pre
                          style={{
                            marginTop: "8px",
                            padding: "10px",
                            background: "var(--surface-sunken)",
                            borderRadius: "8px",
                            fontSize: "12px",
                            overflowX: "auto",
                          }}
                        >
                          {JSON.stringify(entry.details_json, null, 2)}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
