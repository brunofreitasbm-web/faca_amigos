"use client";

import { Area, AreaChart, ResponsiveContainer, Tooltip } from "recharts";
import { Card } from "@/components/design-system";

const tooltipStyle = {
  background: "var(--surface-card)",
  border: "1px solid var(--border-subtle)",
  borderRadius: 8,
  color: "var(--text-primary)",
  fontSize: 13,
};

function Delta({ pct }: { pct: number | null }) {
  if (pct === null) return null;
  const up = pct >= 0;
  return (
    <span
      style={{
        fontFamily: "var(--font-body)",
        fontWeight: "var(--weight-semibold)" as unknown as number,
        fontSize: "13px",
        color: up ? "var(--color-success)" : "var(--color-error)",
      }}
      title="Comparado aos 7 dias anteriores"
    >
      {up ? "▲" : "▼"} {Math.abs(pct).toFixed(0)}%
    </span>
  );
}

export function KpiCard({
  label,
  value,
  deltaPct,
  data,
  dataKey,
  color,
  valueFormatter,
}: {
  label: string;
  value: string;
  deltaPct: number | null;
  data: Record<string, number | string>[];
  dataKey: string;
  color: string;
  valueFormatter: (v: number) => string;
}) {
  return (
    <Card variant="light" subtitle={label}>
      <div style={{ display: "flex", alignItems: "baseline", gap: "10px", marginBottom: "8px" }}>
        <div
          style={{
            fontFamily: "var(--font-body)",
            fontWeight: "var(--weight-extrabold)" as unknown as number,
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
