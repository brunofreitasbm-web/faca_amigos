"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card } from "@/components/design-system";

const tooltipStyle = {
  background: "var(--surface-card, #ffffff)",
  border: "1px solid var(--border-subtle, #e5e7eb)",
  borderRadius: 8,
  boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
  color: "var(--text-primary, #111827)",
  fontSize: 13,
  padding: "8px 12px",
};

function Delta({ pct }: { pct: number | null }) {
  if (pct === null) return null;
  const up = pct >= 0;
  return (
    <span
      style={{
        fontFamily: "var(--font-body)",
        fontWeight: 600,
        fontSize: "13px",
        color: up ? "var(--color-success, #10b981)" : "var(--color-error, #ef4444)",
      }}
      title="Comparado ao dia anterior"
    >
      {up ? "▲" : "▼"} {Math.abs(pct).toFixed(0)}%
    </span>
  );
}

const kpiFormatters = {
  count: (v: number) => `${v} check-ins`,
  currency: (v: number) => `R$ ${(v / 100).toFixed(2)}`,
} as const;

export function KpiCard({
  label,
  value,
  deltaPct,
  data,
  dataKey,
  color,
  format,
}: {
  label: string;
  value: string;
  deltaPct: number | null;
  data: Record<string, number | string>[];
  dataKey: string;
  color: string;
  format: keyof typeof kpiFormatters;
}) {
  const valueFormatter = kpiFormatters[format];
  return (
    <Card variant="light" subtitle={label}>
      <div style={{ display: "flex", alignItems: "baseline", gap: "10px", marginBottom: "8px" }}>
        <div
          style={{
            fontFamily: "var(--font-body)",
            fontWeight: 800,
            fontSize: "28px",
            color: "var(--text-primary)",
          }}
        >
          {value}
        </div>
        <Delta pct={deltaPct} />
      </div>
      {data.length > 1 && (
        <ResponsiveContainer width="100%" height={48}>
          <AreaChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
            <Tooltip
              contentStyle={tooltipStyle}
              labelFormatter={(d: string) => d}
              formatter={(v: number) => [valueFormatter(v), ""]}
            />
            <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} fill={color} fillOpacity={0.15} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}

export function OverviewTrendChart({
  data,
}: {
  data: { date: string; revenue: number; checkins: number }[];
}) {
  return (
    <div
      style={{
        background: "var(--surface-card, #ffffff)",
        borderRadius: "var(--radius-card, 12px)",
        border: "1px solid var(--border-subtle, #e5e7eb)",
        padding: "var(--space-5, 20px)",
        marginTop: "var(--gap-lg, 24px)",
      }}
    >
      <h3
        style={{
          fontSize: 16,
          fontWeight: 600,
          color: "var(--text-primary, #111827)",
          margin: "0 0 16px 0",
        }}
      >
        Visão Geral dos Últimos 14 Dias (Faturamento x Check-ins)
      </h3>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle, #f3f4f6)" vertical={false} />
          <XAxis dataKey="date" stroke="var(--text-secondary, #9ca3af)" fontSize={12} tickLine={false} />
          <YAxis yAxisId="left" stroke="var(--text-secondary, #9ca3af)" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `R$${(v/100).toFixed(0)}`} />
          <YAxis yAxisId="right" orientation="right" stroke="#6366F1" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(value: number, name: string) => [
              name === "Faturamento" ? `R$ ${(value / 100).toFixed(2)}` : `${value} crianças`,
              name,
            ]}
          />
          <Legend />
          <Bar yAxisId="left" dataKey="revenue" name="Faturamento" fill="#2ECFB5" radius={[4, 4, 0, 0]} maxBarSize={20} />
          <Bar yAxisId="right" dataKey="checkins" name="Check-ins" fill="#6366F1" radius={[4, 4, 0, 0]} maxBarSize={20} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
