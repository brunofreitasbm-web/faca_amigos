"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";

interface UnitOption {
  id: string;
  name: string;
}

interface ReportFiltersProps {
  units: UnitOption[];
  currentPeriod: string;
  currentUnitId: string;
  currentFrom?: string;
  currentTo?: string;
  exportData: {
    kpis: { label: string; value: string; delta: string }[];
    revenueByDay: { date: string; revenue: number }[];
    topProducts: { product: string; total: number }[];
    revenueByMethod: { method: string; amount: number }[];
  };
}

export function ReportFilters({
  units,
  currentPeriod,
  currentUnitId,
  currentFrom = "",
  currentTo = "",
  exportData,
}: ReportFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [fromInput, setFromInput] = useState(currentFrom);
  const [toInput, setToInput] = useState(currentTo);

  const updateParam = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      Object.entries(updates).forEach(([key, val]) => {
        if (val && val !== "all" && val !== "ALL" && val !== "30d") {
          params.set(key, val);
        } else {
          params.delete(key);
        }
      });
      router.push(`?${params.toString()}`);
    },
    [router, searchParams]
  );

  const handlePeriodChange = (period: string) => {
    if (period === "custom") {
      updateParam({ period, from: fromInput || null, to: toInput || null });
    } else {
      updateParam({ period, from: null, to: null });
    }
  };

  const handleUnitChange = (unitId: string) => {
    updateParam({ unitId });
  };

  const handleApplyCustomDates = () => {
    updateParam({ period: "custom", from: fromInput, to: toInput });
  };

  const handleExportCSV = () => {
    const rows = [
      ["--- CABEÇALHO DO RELATÓRIO ---"],
      ["Período", currentPeriod],
      ["Unidade", currentUnitId === "all" ? "Todas as Unidades" : currentUnitId],
      [],
      ["--- RESUMO EXECUTIVO ---"],
      ["Métrica", "Valor", "Comparativo Anterior"],
      ...exportData.kpis.map((k) => [k.label, k.value, k.delta]),
      [],
      ["--- FATURAMENTO DIÁRIO ---"],
      ["Data", "Faturamento (R$)"],
      ...exportData.revenueByDay.map((r) => [r.date, (r.revenue / 100).toFixed(2)]),
      [],
      ["--- FORMAS DE PAGAMENTO ---"],
      ["Método", "Valor (R$)"],
      ...exportData.revenueByMethod.map((m) => [m.method, (m.amount / 100).toFixed(2)]),
      [],
      ["--- PRODUTOS MAIS VENDIDOS ---"],
      ["Produto", "Total (R$)"],
      ...exportData.topProducts.map((p) => [p.product, (p.total / 100).toFixed(2)]),
    ];

    const csvContent = "data:text/csv;charset=utf-8," + rows.map((e) => e.join(";")).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `relatorio_facaamigos_${currentPeriod}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const selectStyle = {
    padding: "6px 12px",
    borderRadius: "6px",
    border: "1px solid var(--border-subtle)",
    background: "var(--surface-subtle)",
    color: "var(--text-primary)",
    fontSize: "13px",
    cursor: "pointer",
    outline: "none",
  };

  const inputStyle = {
    padding: "5px 10px",
    borderRadius: "6px",
    border: "1px solid var(--border-subtle)",
    background: "var(--surface-subtle)",
    color: "var(--text-primary)",
    fontSize: "13px",
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        marginBottom: "var(--space-5)",
        background: "var(--surface-card)",
        padding: "var(--space-3) var(--space-4)",
        borderRadius: "var(--radius-card)",
        border: "1px solid var(--border-subtle)",
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-3)",
        }}
      >
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "var(--space-3)" }}>
          {/* Seletor de Período */}
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ fontSize: "13px", color: "var(--text-secondary)", fontWeight: 500 }}>Período:</span>
            <select
              value={currentPeriod}
              onChange={(e) => handlePeriodChange(e.target.value)}
              style={selectStyle}
            >
              <option value="today">Hoje (Dia)</option>
              <option value="yesterday">Ontem (Dia)</option>
              <option value="7d">Últimos 7 dias</option>
              <option value="30d">Últimos 30 dias</option>
              <option value="90d">Últimos 90 dias</option>
              <option value="this_month">Este Mês</option>
              <option value="last_month">Mês Anterior</option>
              <option value="this_year">Este Ano</option>
              <option value="last_year">Ano Anterior</option>
              <option value="custom">Período Personalizado</option>
            </select>
          </div>

          {/* Seletor de Unidade */}
          {units.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span style={{ fontSize: "13px", color: "var(--text-secondary)", fontWeight: 500 }}>Unidade:</span>
              <select
                value={currentUnitId}
                onChange={(e) => handleUnitChange(e.target.value)}
                style={selectStyle}
              >
                <option value="all">Todas as Unidades</option>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Botão de Exportar */}
        <button
          onClick={handleExportCSV}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            padding: "6px 14px",
            borderRadius: "6px",
            border: "1px solid var(--border-subtle)",
            background: "var(--brand-primary, #2ECFB5)",
            color: "#000",
            fontWeight: 600,
            fontSize: "13px",
            cursor: "pointer",
            transition: "opacity 0.2s",
          }}
          onMouseOver={(e) => (e.currentTarget.style.opacity = "0.9")}
          onMouseOut={(e) => (e.currentTarget.style.opacity = "1")}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Exportar CSV
        </button>
      </div>

      {/* Inputs de Data Customizada quando o período for 'custom' */}
      {currentPeriod === "custom" && (
        <div style={{ display: "flex", alignItems: "center", gap: "12px", paddingTop: "8px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>De:</span>
            <input
              type="date"
              value={fromInput}
              onChange={(e) => setFromInput(e.target.value)}
              style={inputStyle}
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>Até:</span>
            <input
              type="date"
              value={toInput}
              onChange={(e) => setToInput(e.target.value)}
              style={inputStyle}
            />
          </div>
          <button
            onClick={handleApplyCustomDates}
            style={{
              padding: "5px 12px",
              borderRadius: "6px",
              border: "none",
              background: "var(--surface-subtle)",
              color: "var(--text-primary)",
              fontSize: "12px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Filtrar
          </button>
        </div>
      )}
    </div>
  );
}
