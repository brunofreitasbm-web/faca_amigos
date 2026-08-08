import { useEffect, useState } from "react";
import { Card, HelpText, Button } from "@facaamigos/ui";
import { useAppState } from "../../../state/AppState.js";
import { money } from "../../../format.js";

interface FaStatData {
  stats: {
    totalSangriasCents: number;
    totalEnvelopes: number;
    totalLocacoes: number;
    totalVendas30m: number;
    totalVendas1h: number;
    totalVendas2h: number;
    diasComLancamento: number;
  };
  sangrias: Array<{
    id: string;
    unit_id: string;
    amount_cents: number;
    reason: string;
    envelope_number?: string;
    employee_name: string;
    created_at_ms: number;
  }>;
}

export function FaDashboardTab() {
  const { units } = useAppState();
  const [selectedUnit, setSelectedUnit] = useState<string>("todas");
  const [data, setData] = useState<FaStatData | null>(null);
  const [loading, setLoading] = useState(false);

  async function loadData() {
    setLoading(true);
    try {
      const res = await fetch(`/api/caixa/gerencial-fa-stats?unitId=${selectedUnit}`);
      if (res.ok) {
        const json = await res.json();
        setData(json);
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

  const totalVendasRapidas = (data?.stats.totalVendas30m ?? 0) + (data?.stats.totalVendas1h ?? 0) + (data?.stats.totalVendas2h ?? 0);

  return (
    <div>
      <Card style={{ padding: "20px", marginBottom: "16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
          <div>
            <h2 style={{ fontSize: "18px", margin: "0 0 8px 0" }}>📊 Dashboard FaçaAmigos</h2>
            <HelpText>Painel de performance operacional, retenção de público e métricas de velocidade de vendas.</HelpText>
          </div>

          <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
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
            <Button variant="secondary" onClick={loadData} disabled={loading}>
              🔄 Atualizar
            </Button>
          </div>
        </div>
      </Card>

      {/* Grid de Cards de Desempenho */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "16px", marginBottom: "20px" }}>
        <Card style={{ padding: "18px", background: "linear-gradient(135deg, rgba(33,150,243,0.1), rgba(33,150,243,0.02))", borderTop: "4px solid #2196f3" }}>
          <span style={{ fontSize: "13px", fontWeight: "bold", color: "var(--text-secondary)" }}>Total de Locações Registradas</span>
          <h3 style={{ fontSize: "28px", margin: "8px 0 4px 0", color: "#1976d2" }}>{data?.stats.totalLocacoes ?? 0}</h3>
          <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>Acumulado nos lançamentos</span>
        </Card>

        <Card style={{ padding: "18px", background: "linear-gradient(135deg, rgba(0,150,136,0.1), rgba(0,150,136,0.02))", borderTop: "4px solid #009688" }}>
          <span style={{ fontSize: "13px", fontWeight: "bold", color: "var(--text-secondary)" }}>Vendas em Velocidade</span>
          <h3 style={{ fontSize: "28px", margin: "8px 0 4px 0", color: "#00796b" }}>{totalVendasRapidas}</h3>
          <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>Total de vendas em 30m / 1h / 2h</span>
        </Card>

        <Card style={{ padding: "18px", background: "linear-gradient(135deg, rgba(255,152,0,0.1), rgba(255,152,0,0.02))", borderTop: "4px solid #ff9800" }}>
          <span style={{ fontSize: "13px", fontWeight: "bold", color: "var(--text-secondary)" }}>Envelopes Depositados</span>
          <h3 style={{ fontSize: "28px", margin: "8px 0 4px 0", color: "#f57c00" }}>{data?.stats.totalEnvelopes ?? 0}</h3>
          <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>Registros com numeração de envelope</span>
        </Card>

        <Card style={{ padding: "18px", background: "linear-gradient(135deg, rgba(156,39,176,0.1), rgba(156,39,176,0.02))", borderTop: "4px solid #9c27b0" }}>
          <span style={{ fontSize: "13px", fontWeight: "bold", color: "var(--text-secondary)" }}>Volume em Sangrias</span>
          <h3 style={{ fontSize: "28px", margin: "8px 0 4px 0", color: "#7b1fa2" }}>{money(data?.stats.totalSangriasCents ?? 0)}</h3>
          <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>Total recolhido das gavetas</span>
        </Card>
      </div>

      {/* Gráfico de Distribuição de Vendas Rápidas */}
      <Card style={{ padding: "20px", marginBottom: "20px" }}>
        <h3 style={{ fontSize: "16px", marginTop: 0 }}>⏱️ Distribuição do Tempo de Permanência das Vendas</h3>
        <HelpText style={{ marginBottom: "16px" }}>Compara a agilidade no atendimento e conversão por faixas de horário.</HelpText>

        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", marginBottom: "4px" }}>
              <span>Atendimento em até 30 Minutos</span>
              <strong>{data?.stats.totalVendas30m ?? 0} vendas</strong>
            </div>
            <div style={{ height: "12px", background: "var(--surface-sunken)", borderRadius: "6px", overflow: "hidden" }}>
              <div
                style={{
                  height: "100%",
                  width: `${totalVendasRapidas > 0 ? ((data?.stats.totalVendas30m ?? 0) / totalVendasRapidas) * 100 : 0}%`,
                  background: "#4caf50",
                  transition: "width 0.3s",
                }}
              />
            </div>
          </div>

          <div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", marginBottom: "4px" }}>
              <span>Atendimento em até 1 Hora</span>
              <strong>{data?.stats.totalVendas1h ?? 0} vendas</strong>
            </div>
            <div style={{ height: "12px", background: "var(--surface-sunken)", borderRadius: "6px", overflow: "hidden" }}>
              <div
                style={{
                  height: "100%",
                  width: `${totalVendasRapidas > 0 ? ((data?.stats.totalVendas1h ?? 0) / totalVendasRapidas) * 100 : 0}%`,
                  background: "#2196f3",
                  transition: "width 0.3s",
                }}
              />
            </div>
          </div>

          <div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", marginBottom: "4px" }}>
              <span>Atendimento em até 2 Horas</span>
              <strong>{data?.stats.totalVendas2h ?? 0} vendas</strong>
            </div>
            <div style={{ height: "12px", background: "var(--surface-sunken)", borderRadius: "6px", overflow: "hidden" }}>
              <div
                style={{
                  height: "100%",
                  width: `${totalVendasRapidas > 0 ? ((data?.stats.totalVendas2h ?? 0) / totalVendasRapidas) * 100 : 0}%`,
                  background: "#ff9800",
                  transition: "width 0.3s",
                }}
              />
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
