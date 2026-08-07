"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

interface UnitOption {
  id: string;
  name: string;
}

interface ReportFiltersProps {
  units: UnitOption[];
  currentPeriod: string;
  currentUnitId: string;
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
  exportData,
}: ReportFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const createQueryString = useCallback(
    (name: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value && value !== "all" && value !== "30d") {
        params.set(name, value);
      } else {
        params.delete(name);
      }
      return params.toString();
    },
    [searchParams]
  );

  const handlePeriodChange = (period: string) => {
    const query = createQueryString("period", period);
    router.push(`?${query}`);
  };

  const handleUnitChange = (unitId: string) => {
    const query = createQueryString("unitId", unitId);
    router.push(`?${query}`);
  };

  const handleExportCSV = () => {
    const rows = [
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

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "var(--space-3)",
        marginBottom: "var(--space-5)",
        background: "var(--surface-card)",
        padding: "var(--space-3) var(--space-4)",
        borderRadius: "var(--radius-card)",
        border: "1px solid var(--border-subtle)",
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "var(--space-3)" }}>
        {/* Seletor de Período */}
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ fontSize: "13px", color: "var(--text-secondary)", fontWeight: 500 }}>Período:</span>
          <select
            value={currentPeriod}
            onChange={(e) => handlePeriodChange(e.target.value)}
            style={{
              padding: "6px 12px",
              borderRadius: "6px",
              border: "1px solid var(--border-subtle)",
              background: "var(--surface-subtle)",
              color: "var(--text-primary)",
              fontSize: "13px",
              cursor: "pointer",
              outline: "none",
            }}
          >
            <option value="7d">Últimos 7 dias</option>
            <option value="30d">Últimos 30 dias</option>
            <option value="90d">Últimos 90 dias</option>
            <option value="this_month">Este Mês</option>
          </select>
        </div>

        {/* Seletor de Unidade */}
        {units.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ fontSize: "13px", color: "var(--text-secondary)", fontWeight: 500 }}>Unidade:</span>
            <select
              value={currentUnitId}
              onChange={(e) => handleUnitChange(e.target.value)}
              style={{
                padding: "6px 12px",
                borderRadius: "6px",
                border: "1px solid var(--border-subtle)",
                background: "var(--surface-subtle)",
                color: "var(--text-primary)",
                fontSize: "13px",
                cursor: "pointer",
                outline: "none",
              }}
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
  );
}
