import { useEffect, useState } from "react";
import { Card, HelpText, Button } from "@facaamigos/ui";
import { Api } from "../../../api/client.js";
import type { UnitCashStatus } from "../../../api/client.js";
import { money } from "../../../format.js";

export function SaldoCaixaTab() {
  const [status, setStatus] = useState<UnitCashStatus[]>([]);
  const [loading, setLoading] = useState(false);

  async function loadData() {
    setLoading(true);
    try {
      setStatus(await Api.unitsCashStatus());
    } catch {
      // mantém os dados anteriores na tela em caso de falha
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, []);

  const totalAberto = status.reduce((sum, s) => sum + (s.current_cash_cents ?? 0), 0);

  return (
    <div>
      <Card style={{ padding: "20px", marginBottom: "16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
          <div>
            <h2 style={{ fontSize: "18px", margin: "0 0 8px 0" }}>💵 Saldo em Caixa</h2>
            <HelpText>Dinheiro físico na gaveta de cada loja neste momento (só lojas com turno aberto têm saldo a contar).</HelpText>
          </div>
          <Button variant="secondary" onClick={loadData} disabled={loading}>
            🔄 Atualizar
          </Button>
        </div>
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "16px", marginBottom: "20px" }}>
        {status.map((s) => (
          <Card
            key={s.unit_id}
            style={{
              padding: "18px",
              borderTop: `4px solid ${s.status === "ABERTO" ? "var(--color-teal)" : "var(--border-subtle)"}`,
            }}
          >
            <span style={{ fontSize: "13px", fontWeight: "bold", color: "var(--text-secondary)" }}>{s.unit_name}</span>
            {s.status === "ABERTO" ? (
              <>
                <h3 style={{ fontSize: "28px", margin: "8px 0 4px 0", color: "var(--color-teal-text)" }}>{money(s.current_cash_cents ?? 0)}</h3>
                <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                  🟢 Turno aberto desde {s.opened_at_ms ? new Date(s.opened_at_ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—"}
                </span>
              </>
            ) : (
              <>
                <h3 style={{ fontSize: "20px", margin: "8px 0 4px 0", color: "var(--text-muted)" }}>Turno fechado</h3>
                <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                  {s.closed_at_ms ? `Último fechamento em ${new Date(s.closed_at_ms).toLocaleString("pt-BR")}` : "Nenhum turno registrado ainda"}
                </span>
              </>
            )}
          </Card>
        ))}
      </div>

      <Card style={{ padding: "16px" }}>
        <HelpText>Total físico somado nas lojas com turno aberto agora: <strong>{money(totalAberto)}</strong></HelpText>
      </Card>
    </div>
  );
}
