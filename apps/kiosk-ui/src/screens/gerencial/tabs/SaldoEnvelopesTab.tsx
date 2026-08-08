import { useEffect, useState } from "react";
import { Card, HelpText, Button } from "@facaamigos/ui";
import { Api } from "../../../api/client.js";
import type { UnitEnvelopeBalance, UnitCashStatus } from "../../../api/client.js";
import { useAppState } from "../../../state/AppState.js";
import { money } from "../../../format.js";

export function SaldoEnvelopesTab() {
  const { employee } = useAppState();
  const [balances, setBalances] = useState<UnitEnvelopeBalance[]>([]);
  const [cashStatus, setCashStatus] = useState<UnitCashStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [collectingUnit, setCollectingUnit] = useState<string | null>(null);

  async function loadData() {
    setLoading(true);
    try {
      const [envelopes, cash] = await Promise.all([Api.unitsEnvelopeBalance(), Api.unitsCashStatus()]);
      setBalances(envelopes);
      setCashStatus(cash);
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

  async function handleCollect(b: UnitEnvelopeBalance) {
    if (!employee) return;
    const ok = window.confirm(
      `Confirmar recolhimento de ${b.pending_count} envelope(s) da loja ${b.unit_name}, totalizando ${money(b.pending_cents)}?\n\nUse apenas quando os envelopes forem retirados fisicamente da loja.`,
    );
    if (!ok) return;
    setCollectingUnit(b.unit_id);
    try {
      await Api.collectEnvelopes(b.unit_id, employee.id);
      await loadData();
    } catch {
      alert("Erro ao registrar o recolhimento. Tente novamente.");
    } finally {
      setCollectingUnit(null);
    }
  }

  const totalPendente = balances.reduce((sum, b) => sum + b.pending_cents, 0);
  const cashByUnit = new Map(cashStatus.map((s) => [s.unit_id, s]));

  return (
    <div>
      <Card style={{ padding: "20px", marginBottom: "16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
          <div>
            <h2 style={{ fontSize: "18px", margin: "0 0 8px 0" }}>✉️ Saldo em Envelopes</h2>
            <HelpText>
              Quanto cada loja tem guardado em envelopes de sangria ainda não recolhidos. Ao retirar os envelopes da loja, use "Marcar como
              recolhidos" para zerar o saldo.
            </HelpText>
          </div>
          <Button variant="secondary" onClick={loadData} disabled={loading}>
            🔄 Atualizar
          </Button>
        </div>
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "16px", marginBottom: "20px" }}>
        {balances.map((b) => {
          const cash = cashByUnit.get(b.unit_id);
          return (
            <Card
              key={b.unit_id}
              style={{
                padding: "18px",
                borderTop: `4px solid ${b.pending_count > 0 ? "var(--color-primary)" : "var(--border-subtle)"}`,
                display: "flex",
                flexDirection: "column",
                gap: "4px",
              }}
            >
              <span style={{ fontSize: "13px", fontWeight: "bold", color: "var(--text-secondary)" }}>{b.unit_name}</span>
              <h3
                style={{
                  fontSize: "28px",
                  margin: "4px 0 0 0",
                  color: b.pending_count > 0 ? "var(--color-primary)" : "var(--text-muted)",
                }}
              >
                {money(b.pending_cents)}
              </h3>
              <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                {b.pending_count > 0
                  ? `✉️ ${b.pending_count} envelope(s) na loja${b.oldest_pending_at_ms ? ` · mais antigo em ${new Date(b.oldest_pending_at_ms).toLocaleDateString("pt-BR")}` : ""}`
                  : "Nenhum envelope aguardando recolhimento"}
              </span>
              {b.last_collected_at_ms && (
                <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                  Último recolhimento em {new Date(b.last_collected_at_ms).toLocaleString("pt-BR")}
                </span>
              )}
              {cash?.status === "ABERTO" && (
                <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                  💵 Na gaveta agora: {money(cash.current_cash_cents ?? 0)} (turno aberto)
                </span>
              )}
              {b.pending_count > 0 && (
                <Button
                  variant="secondary"
                  size="sm"
                  loading={collectingUnit === b.unit_id}
                  disabled={collectingUnit !== null}
                  onClick={() => handleCollect(b)}
                  style={{ marginTop: "8px", alignSelf: "flex-start" }}
                >
                  ✅ Marcar como recolhidos
                </Button>
              )}
            </Card>
          );
        })}
      </div>

      <Card style={{ padding: "16px" }}>
        <HelpText>
          Total em envelopes aguardando recolhimento em todas as lojas: <strong>{money(totalPendente)}</strong>
        </HelpText>
      </Card>
    </div>
  );
}
