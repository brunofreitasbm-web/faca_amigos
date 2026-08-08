import { useEffect, useState } from "react";
import { Card, HelpText, Input, Button } from "@facaamigos/ui";
import { useAppState } from "../../../state/AppState.js";
import { money } from "../../../format.js";

interface SangriaItem {
  id: string;
  shift_id?: string;
  unit_id: string;
  amount_cents: number;
  reason: string;
  envelope_number?: string;
  employee_id: string;
  employee_name: string;
  created_at_ms: number;
}

export function FaHistoricoTab() {
  const { units } = useAppState();
  const [selectedUnit, setSelectedUnit] = useState<string>("todas");
  const [searchEnvelope, setSearchEnvelope] = useState("");
  const [sangrias, setSangrias] = useState<SangriaItem[]>([]);
  const [loading, setLoading] = useState(false);

  async function loadData() {
    setLoading(true);
    try {
      const res = await fetch(`/api/caixa/gerencial-fa-stats?unitId=${selectedUnit}`);
      if (res.ok) {
        const json = await res.json();
        setSangrias(json.sangrias || []);
      }
    } catch {
      // fallback
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUnit]);

  const filteredSangrias = sangrias.filter((s) => {
    if (!searchEnvelope) return true;
    const term = searchEnvelope.toLowerCase();
    return (
      (s.envelope_number && s.envelope_number.toLowerCase().includes(term)) ||
      s.reason.toLowerCase().includes(term) ||
      s.employee_name.toLowerCase().includes(term)
    );
  });

  return (
    <div>
      <Card style={{ padding: "20px", marginBottom: "16px" }}>
        <h2 style={{ fontSize: "18px", margin: "0 0 8px 0" }}>📜 Histórico de Registros de Envelopes & Sangrias</h2>
        <HelpText style={{ marginBottom: "16px" }}>
          Auditoria completa de todos os envelopes depositados, retiradas para sangria, operador responsável e data/hora do registro.
        </HelpText>

        <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: "200px" }}>
            <label style={{ fontSize: "13px", fontWeight: "bold", display: "block", marginBottom: "4px" }}>Buscar Envelope / Motivo / Operador</label>
            <Input
              placeholder="Ex: #104, Depósito banco..."
              value={searchEnvelope}
              onChange={(e) => setSearchEnvelope(e.target.value)}
            />
          </div>

          <div>
            <label style={{ fontSize: "13px", fontWeight: "bold", display: "block", marginBottom: "4px" }}>Unidade</label>
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
              <option value="todas">Todas as Unidades</option>
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

      {/* Tabela do Histórico */}
      <Card style={{ padding: "20px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
          <h3 style={{ fontSize: "16px", margin: 0 }}>Registros Encontrados ({filteredSangrias.length})</h3>
        </div>

        {filteredSangrias.length === 0 ? (
          <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>Nenhum registro de envelope ou sangria foi localizado.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px" }}>
            <thead>
              <tr style={{ borderBottom: "2px solid var(--border-subtle)", textAlign: "left" }}>
                <th style={{ padding: "10px" }}>Data / Hora</th>
                <th style={{ padding: "10px" }}>Unidade</th>
                <th style={{ padding: "10px" }}>Nº Envelope</th>
                <th style={{ padding: "10px" }}>Valor</th>
                <th style={{ padding: "10px" }}>Motivo / Obs</th>
                <th style={{ padding: "10px" }}>Operador</th>
              </tr>
            </thead>
            <tbody>
              {filteredSangrias.map((s) => (
                <tr key={s.id} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                  <td style={{ padding: "10px" }}>{new Date(s.created_at_ms).toLocaleString("pt-BR")}</td>
                  <td style={{ padding: "10px" }}>{units.find((u) => u.id === s.unit_id)?.name ?? s.unit_id}</td>
                  <td style={{ padding: "10px", fontWeight: "bold", color: s.envelope_number ? "var(--color-primary)" : "inherit" }}>
                    {s.envelope_number ? `✉️ ${s.envelope_number}` : "—"}
                  </td>
                  <td style={{ padding: "10px", fontWeight: "bold" }}>{money(s.amount_cents)}</td>
                  <td style={{ padding: "10px" }}>{s.reason}</td>
                  <td style={{ padding: "10px" }}>{s.employee_name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
