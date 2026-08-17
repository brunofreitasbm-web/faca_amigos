import { useEffect, useState } from "react";
import { Button, Card, HelpText, Input, Select } from "@facaamigos/ui";
import { Api } from "../../../api/client.js";
import type { Employee } from "../../../api/client.js";
import { useAppState } from "../../../state/AppState.js";
import { useToast } from "../../../state/ToastContext.js";

interface OcorrenciaRow {
  id: string;
  employee_id: string;
  unit_id: string;
  tipo: "ATESTADO" | "FALTA";
  days_away: number;
  document_path: string | null;
  notes: string | null;
  created_at_ms: number;
  fa_kiosk_employees: { full_name: string } | null;
}

/**
 * Lançamento administrativo de ocorrências (atestado/falta), gap vs. o
 * sistema irmão Porto Terapia (OcorrenciasTab). Diferente do Ponto — que é
 * o próprio colaborador batendo, sozinho, sob a Portaria MTP 671/2021 —
 * aqui é sempre o RH/gerência lançando em nome de um colaborador, por isso
 * o formulário pede "para quem" em vez de vir de uma sessão autenticada.
 */
export function OcorrenciasTab() {
  const toast = useToast();
  const { units } = useAppState();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [unitFilter, setUnitFilter] = useState<string>(units[0]?.id ?? "");
  const [rows, setRows] = useState<OcorrenciaRow[]>([]);
  const [loading, setLoading] = useState(false);

  const [employeeId, setEmployeeId] = useState("");
  const [tipo, setTipo] = useState<"ATESTADO" | "FALTA">("ATESTADO");
  const [daysAway, setDaysAway] = useState("1");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Api.allEmployees().then(setEmployees);
  }, []);

  function load(unitId: string) {
    if (!unitId) return;
    setLoading(true);
    Api.ocorrencias(unitId)
      .then((r) => setRows(r as OcorrenciaRow[]))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (!unitFilter && units[0]) setUnitFilter(units[0].id);
  }, [units, unitFilter]);

  useEffect(() => load(unitFilter), [unitFilter]);

  async function registrar() {
    if (!employeeId || !unitFilter) return;
    setBusy(true);
    setError(null);
    try {
      let documentPath: string | null = null;
      if (file) {
        documentPath = await Api.uploadOcorrenciaDocumento(employeeId, file);
      }
      await Api.registerOcorrencia({
        employeeId,
        unitId: unitFilter,
        tipo,
        daysAway: Number(daysAway) || 1,
        documentPath,
        notes: notes.trim() || null,
      });
      toast.success("Ocorrência lançada.");
      setEmployeeId("");
      setDaysAway("1");
      setNotes("");
      setFile(null);
      load(unitFilter);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível lançar a ocorrência.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: "12px", marginBottom: "16px" }}>
        <div>
          <h2 style={{ fontFamily: "var(--font-display)", margin: 0, fontSize: "20px" }}>Ocorrências</h2>
          <HelpText style={{ margin: 0 }}>Atestados e faltas lançados pelo RH, por unidade.</HelpText>
        </div>
        <div style={{ width: "220px" }}>
          <Select label="Unidade" value={unitFilter} onChange={(e) => setUnitFilter(e.target.value)}>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <Card style={{ padding: "16px", marginBottom: "20px", display: "flex", flexDirection: "column", gap: "12px" }}>
        <h3 style={{ fontFamily: "var(--font-display)", fontSize: "16px", margin: 0 }}>Lançar ocorrência</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px" }}>
          <Select label="Colaborador" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
            <option value="">Selecione…</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.full_name}
              </option>
            ))}
          </Select>
          <Select label="Tipo" value={tipo} onChange={(e) => setTipo(e.target.value as "ATESTADO" | "FALTA")}>
            <option value="ATESTADO">Atestado</option>
            <option value="FALTA">Falta</option>
          </Select>
          <Input label="Dias de afastamento" type="number" min="1" value={daysAway} onChange={(e) => setDaysAway(e.target.value)} />
        </div>
        <Input label="Observações (opcional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <div>
          <label style={{ fontSize: "13px", fontWeight: "var(--weight-semibold)" as unknown as number, display: "block", marginBottom: "4px" }}>
            Anexo (atestado etc. — opcional, imagem)
          </label>
          <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </div>
        {error && <p style={{ color: "var(--color-error-text)", margin: 0 }}>{error}</p>}
        <Button variant="primary" disabled={busy || !employeeId} onClick={registrar} style={{ alignSelf: "flex-start" }}>
          Lançar ocorrência
        </Button>
      </Card>

      <Card style={{ padding: "8px", overflowX: "auto" }}>
        <table className="report-table">
          <thead>
            <tr>
              <th>Colaborador</th>
              <th>Tipo</th>
              <th>Dias</th>
              <th>Anexo</th>
              <th>Observações</th>
              <th>Lançado em</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.fa_kiosk_employees?.full_name ?? "—"}</td>
                <td>{r.tipo === "ATESTADO" ? "Atestado" : "Falta"}</td>
                <td style={{ textAlign: "center" }}>{r.days_away}</td>
                <td style={{ textAlign: "center" }}>{r.document_path ? "📎" : "—"}</td>
                <td>{r.notes ?? "—"}</td>
                <td>{new Date(r.created_at_ms).toLocaleString("pt-BR")}</td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={6} style={{ textAlign: "center", color: "var(--text-muted)", padding: "24px" }}>
                  Nenhuma ocorrência lançada nesta unidade.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
