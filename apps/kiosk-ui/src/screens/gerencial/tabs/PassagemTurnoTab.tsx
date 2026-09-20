import { useEffect, useState } from "react";
import { Button, Card, HelpText, Tag } from "@facaamigos/ui";
import { Api } from "../../../api/client.js";
import type { HandoverHistoryRow } from "../../../api/client.js";
import { useAppState } from "../../../state/AppState.js";

function fmtDateTime(ms: number | null): string {
  if (ms === null) return "—";
  return new Date(ms).toLocaleString("pt-BR");
}

function fmtDate(businessDate: string): string {
  const [ano, mes, dia] = businessDate.split("-");
  return dia && mes && ano ? `${dia}/${mes}/${ano}` : businessDate;
}

/**
 * Tempo entre abrir o modal de leitura e confirmar a ciência.
 *
 * É o número que interessa ao dono: uma ciência dada em 6 segundos num
 * texto de cinco linhas é um clique, não uma leitura. O portão tem um
 * atraso mínimo, então valores colados no piso são o sinal de alerta.
 */
function LeituraCell({ ms }: { ms: number | null }) {
  if (ms === null) return <>—</>;
  const seg = Math.round(ms / 1000);
  return <span style={{ color: seg <= 10 ? "var(--color-amber-text, var(--text-muted))" : "var(--text-muted)" }}>{seg}s</span>;
}

export function PassagemTurnoTab() {
  const { units } = useAppState();
  const [selectedUnit, setSelectedUnit] = useState<string>("todas");
  const [rows, setRows] = useState<HandoverHistoryRow[]>([]);
  const [employeeNames, setEmployeeNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  async function loadData() {
    setLoading(true);
    try {
      const [handovers, employees] = await Promise.all([
        Api.handoverHistory(selectedUnit === "todas" ? null : selectedUnit),
        Api.employees(),
      ]);
      setRows(handovers);
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

  const unitNames = Object.fromEntries(units.map((u) => [u.id, u.name]));
  const semAlteracao = rows.filter((r) => r.no_changes).length;

  return (
    <div>
      <Card style={{ padding: "20px", marginBottom: "16px" }}>
        <h2 style={{ fontSize: "18px", margin: "0 0 8px 0" }}>📓 Passagem de Turno</h2>
        <HelpText style={{ marginBottom: "16px" }}>
          O livro de registro diário entre operadores. Quem fecha o caixa é obrigado a registrar o que precisa ser
          repassado (ou declarar que não houve nada), e quem abre no dia seguinte é obrigado a ler antes de operar. O
          tempo de leitura mostra quanto tempo a pessoa ficou com o texto aberto antes de confirmar a ciência.
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

        {rows.length > 0 && (
          <p style={{ fontSize: "13px", color: "var(--text-muted)", margin: "12px 0 0" }}>
            {semAlteracao} de {rows.length} fechamentos foram registrados como “sem alteração”.
          </p>
        )}
      </Card>

      <Card style={{ padding: "20px" }}>
        <h3 style={{ fontSize: "16px", marginTop: 0 }}>Registros ({rows.length})</h3>
        {rows.length === 0 ? (
          <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>Nenhuma passagem de turno registrada.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {rows.map((r) => (
              <div
                key={r.id}
                style={{
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "10px",
                  padding: "12px 14px",
                  background: "var(--surface-sunken)",
                }}
              >
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "baseline", fontSize: "13px" }}>
                  <strong>{fmtDate(r.business_date)}</strong>
                  <span style={{ color: "var(--text-muted)" }}>{unitNames[r.unit_id] ?? "—"}</span>
                  <span style={{ color: "var(--text-muted)" }}>
                    fechado por {r.closed_by_employee_id ? (employeeNames[r.closed_by_employee_id] ?? "—") : "—"} em{" "}
                    {fmtDateTime(r.created_at_ms)}
                  </span>
                </div>

                <div style={{ marginTop: "8px" }}>
                  {r.no_changes ? (
                    <Tag>Sem alteração</Tag>
                  ) : (
                    <p style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: "14px", lineHeight: 1.5 }}>{r.conteudo}</p>
                  )}
                </div>

                <div style={{ marginTop: "8px", fontSize: "12px", color: "var(--text-muted)" }}>
                  {r.fa_kiosk_shift_handover_acks.length === 0 ? (
                    <em>Ainda não lida por ninguém.</em>
                  ) : (
                    <span>
                      Ciência:{" "}
                      {r.fa_kiosk_shift_handover_acks.map((a, i) => (
                        <span key={a.employee_id}>
                          {i > 0 ? " · " : ""}
                          {employeeNames[a.employee_id] ?? a.employee_id} em {fmtDateTime(a.acked_at_ms)} (leitura:{" "}
                          <LeituraCell ms={a.leitura_ms} />)
                        </span>
                      ))}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
