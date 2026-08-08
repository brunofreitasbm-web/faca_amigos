import { useEffect, useState } from "react";
import { Card, HelpText, Input, Button } from "@facaamigos/ui";
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
  bonificacoes: Array<{
    id: string;
    unit_id: string;
    employee_name: string;
    business_date: string;
    locacoes_count: number;
    vendas_30m: number;
    vendas_1h: number;
    vendas_2h: number;
  }>;
}

export function FaMensalTab() {
  const { units } = useAppState();
  const [competencia, setCompetencia] = useState(() => new Date().toISOString().slice(0, 7)); // YYYY-MM
  const [selectedUnit, setSelectedUnit] = useState<string>("todas");
  const [data, setData] = useState<FaStatData | null>(null);
  const [loading, setLoading] = useState(false);

  async function loadData() {
    setLoading(true);
    try {
      const res = await fetch(`/api/caixa/gerencial-fa-stats?competencia=${competencia}&unitId=${selectedUnit}`);
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch {
      // fallback gracioso se offline
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [competencia, selectedUnit]);

  return (
    <div>
      <Card style={{ padding: "20px", marginBottom: "16px" }}>
        <h2 style={{ fontSize: "18px", margin: "0 0 8px 0" }}>📅 Menu Mensal — Módulo FaçaAmigos</h2>
        <HelpText style={{ marginBottom: "16px" }}>
          Visão consolidada de fechamento mensal, locações ativas, envelopes depositados e bonificações diárias por competência.
        </HelpText>

        <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap", marginBottom: "16px" }}>
          <div>
            <label style={{ fontSize: "13px", fontWeight: "bold", display: "block", marginBottom: "4px" }}>Competência (Mês/Ano)</label>
            <Input type="month" value={competencia} onChange={(e) => setCompetencia(e.target.value)} />
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
              🔄 Atualizar Dados
            </Button>
          </div>
        </div>
      </Card>

      {/* KPI Summary Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px", marginBottom: "20px" }}>
        <Card style={{ padding: "16px", borderLeft: "4px solid var(--color-primary)" }}>
          <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>Total Locações (Mês)</span>
          <h3 style={{ fontSize: "24px", margin: "4px 0 0 0" }}>{data?.stats.totalLocacoes ?? 0}</h3>
        </Card>

        <Card style={{ padding: "16px", borderLeft: "4px solid var(--color-teal)" }}>
          <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>Envelopes Registrados</span>
          <h3 style={{ fontSize: "24px", margin: "4px 0 0 0" }}>{data?.stats.totalEnvelopes ?? 0}</h3>
        </Card>

        <Card style={{ padding: "16px", borderLeft: "4px solid var(--color-warning)" }}>
          <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>Total em Sangrias/Envelopes</span>
          <h3 style={{ fontSize: "24px", margin: "4px 0 0 0" }}>{money(data?.stats.totalSangriasCents ?? 0)}</h3>
        </Card>

        <Card style={{ padding: "16px", borderLeft: "4px solid var(--color-purple, #9c27b0)" }}>
          <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>Dias com Lançamento</span>
          <h3 style={{ fontSize: "24px", margin: "4px 0 0 0" }}>{data?.stats.diasComLancamento ?? 0}</h3>
        </Card>
      </div>

      {/* Tabela de Lançamentos Mensais */}
      <Card style={{ padding: "20px" }}>
        <h3 style={{ fontSize: "16px", marginTop: 0 }}>Detalhamento Diário do Mês</h3>
        {data?.bonificacoes.length === 0 ? (
          <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>Nenhum lançamento de bonificação ou locação registrado nesta competência.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px", marginTop: "12px" }}>
            <thead>
              <tr style={{ borderBottom: "2px solid var(--border-subtle)", textAlign: "left" }}>
                <th style={{ padding: "8px" }}>Data</th>
                <th style={{ padding: "8px" }}>Colaborador</th>
                <th style={{ padding: "8px" }}>Locações</th>
                <th style={{ padding: "8px" }}>30 Min</th>
                <th style={{ padding: "8px" }}>1 Hora</th>
                <th style={{ padding: "8px" }}>2 Horas</th>
              </tr>
            </thead>
            <tbody>
              {data?.bonificacoes.map((b) => (
                <tr key={b.id} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                  <td style={{ padding: "8px" }}>{b.business_date}</td>
                  <td style={{ padding: "8px" }}>{b.employee_name}</td>
                  <td style={{ padding: "8px", fontWeight: "bold" }}>{b.locacoes_count}</td>
                  <td style={{ padding: "8px" }}>{b.vendas_30m}</td>
                  <td style={{ padding: "8px" }}>{b.vendas_1h}</td>
                  <td style={{ padding: "8px" }}>{b.vendas_2h}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
