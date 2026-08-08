import { useEffect, useState } from "react";
import { Card, HelpText, Button } from "@facaamigos/ui";
import { Api } from "../../../api/client.js";
import type { EnvelopeMovement } from "../../../api/client.js";
import { useAppState } from "../../../state/AppState.js";
import { money } from "../../../format.js";

export function FotosEnvelopeTab() {
  const { units } = useAppState();
  const [selectedUnit, setSelectedUnit] = useState<string>("todas");
  const [movements, setMovements] = useState<EnvelopeMovement[]>([]);
  const [employeeNames, setEmployeeNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [zoomPhoto, setZoomPhoto] = useState<string | null>(null);

  async function loadData() {
    setLoading(true);
    try {
      const [rows, employees] = await Promise.all([
        Api.envelopeMovements(selectedUnit === "todas" ? null : selectedUnit),
        Api.employees(),
      ]);
      setMovements(rows);
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
      {zoomPhoto && (
        <div
          onClick={() => setZoomPhoto(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, cursor: "zoom-out" }}
        >
          <img src={zoomPhoto} alt="Foto do envelope" style={{ maxWidth: "90%", maxHeight: "90%", borderRadius: "12px" }} />
        </div>
      )}

      <Card style={{ padding: "20px", marginBottom: "16px" }}>
        <h2 style={{ fontSize: "18px", margin: "0 0 8px 0" }}>✉️ Fotos de Envelope</h2>
        <HelpText style={{ marginBottom: "16px" }}>
          Registros de envelope de cada loja, com valor, operador responsável e foto (quando anexada no fechamento).
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
        <h3 style={{ fontSize: "16px", marginTop: 0 }}>Envelopes Registrados ({movements.length})</h3>
        {movements.length === 0 ? (
          <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>Nenhum envelope registrado.</p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "12px" }}>
            {movements.map((m) => (
              <Card key={m.id} style={{ padding: "12px", display: "flex", flexDirection: "column", gap: "8px" }}>
                {m.photo_url ? (
                  <img
                    src={m.photo_url}
                    alt={`Envelope #${m.envelope_number}`}
                    onClick={() => setZoomPhoto(m.photo_url)}
                    style={{ width: "100%", height: "140px", objectFit: "cover", borderRadius: "8px", cursor: "zoom-in" }}
                  />
                ) : (
                  <div style={{ width: "100%", height: "140px", borderRadius: "8px", background: "var(--surface-sunken)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: "12px" }}>
                    Sem foto
                  </div>
                )}
                <div>
                  <strong style={{ color: "var(--color-primary)" }}>✉️ #{m.envelope_number}</strong>
                  <div style={{ fontSize: "18px", fontWeight: "bold" }}>{money(m.amount_cents)}</div>
                  <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>{new Date(m.at_ms).toLocaleString("pt-BR")}</div>
                  <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>{employeeNames[m.employee_id] ?? "—"}</div>
                  {m.reason && <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>{m.reason}</div>}
                </div>
              </Card>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
