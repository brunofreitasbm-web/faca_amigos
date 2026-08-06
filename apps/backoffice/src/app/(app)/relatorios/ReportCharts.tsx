"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const CHART_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)"];

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "var(--surface-card)",
        borderRadius: "var(--radius-card)",
        boxShadow: "var(--shadow-sm)",
        padding: "var(--space-5)",
        minWidth: 0,
      }}
    >
      <h2
        style={{
          fontFamily: "var(--font-body)",
          fontWeight: "var(--weight-semibold)" as unknown as number,
          fontSize: 14,
          marginTop: 0,
          marginBottom: 16,
          color: "var(--text-secondary)",
        }}
      >
        {title}
      </h2>
      {children}
    </div>
  );
}

const tooltipStyle = {
  background: "var(--surface-card)",
  border: "1px solid var(--border-subtle)",
  borderRadius: 8,
  color: "var(--text-primary)",
  fontSize: 13,
};

export function RevenueByDayChart({ data }: { data: { date: string; revenue: number }[] }) {
  return (
    <Card title="Faturamento por dia (últimos 30 dias)">
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={data} margin={{ left: -20 }}>
          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
          <XAxis dataKey="date" stroke="var(--text-secondary)" fontSize={12} tickLine={false} />
          <YAxis stroke="var(--text-secondary)" fontSize={12} tickLine={false} axisLine={false} />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(v: number) => [`R$ ${(v / 100).toFixed(2)}`, "Faturamento"]}
          />
          <Line
            type="monotone"
            dataKey="revenue"
            stroke="var(--chart-1)"
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </Card>
  );
}

export function CheckinsByDayChart({ data }: { data: { date: string; checkins: number }[] }) {
  return (
    <Card title="Check-ins por dia (últimos 30 dias)">
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} margin={{ left: -20 }}>
          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
          <XAxis dataKey="date" stroke="var(--text-secondary)" fontSize={12} tickLine={false} />
          <YAxis stroke="var(--text-secondary)" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [v, "Check-ins"]} />
          <Bar dataKey="checkins" fill="var(--chart-3)" radius={[4, 4, 0, 0]} maxBarSize={24} />
        </BarChart>
      </ResponsiveContainer>
    </Card>
  );
}

export function RevenueByUnitChart({ data }: { data: { unit: string; revenue: number }[] }) {
  return (
    <Card title="Faturamento por unidade">
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} layout="vertical" margin={{ left: 20 }}>
          <CartesianGrid stroke="var(--chart-grid)" horizontal={false} />
          <XAxis type="number" stroke="var(--text-secondary)" fontSize={12} tickLine={false} axisLine={false} />
          <YAxis dataKey="unit" type="category" stroke="var(--text-secondary)" fontSize={12} tickLine={false} width={110} />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(v: number) => [`R$ ${(v / 100).toFixed(2)}`, "Faturamento"]}
          />
          <Bar dataKey="revenue" fill="var(--chart-1)" radius={[0, 4, 4, 0]} maxBarSize={24} />
        </BarChart>
      </ResponsiveContainer>
    </Card>
  );
}

export function RevenueByMethodChart({ data }: { data: { method: string; amount: number }[] }) {
  return (
    <Card title="Faturamento por forma de pagamento">
      <ResponsiveContainer width="100%" height={260}>
        <PieChart>
          <Pie data={data} dataKey="amount" nameKey="method" innerRadius={60} outerRadius={90} paddingAngle={2}>
            {data.map((_, i) => (
              <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
            ))}
          </Pie>
          <Legend wrapperStyle={{ fontSize: 12, color: "var(--text-secondary)" }} />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(v: number) => [`R$ ${(v / 100).toFixed(2)}`, ""]}
          />
        </PieChart>
      </ResponsiveContainer>
    </Card>
  );
}

export function TopProductsChart({ data }: { data: { product: string; total: number }[] }) {
  return (
    <Card title="Produtos mais vendidos">
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} layout="vertical" margin={{ left: 20 }}>
          <CartesianGrid stroke="var(--chart-grid)" horizontal={false} />
          <XAxis type="number" stroke="var(--text-secondary)" fontSize={12} tickLine={false} axisLine={false} />
          <YAxis dataKey="product" type="category" stroke="var(--text-secondary)" fontSize={12} tickLine={false} width={110} />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(v: number) => [`R$ ${(v / 100).toFixed(2)}`, "Total vendido"]}
          />
          <Bar dataKey="total" fill="var(--chart-2)" radius={[0, 4, 4, 0]} maxBarSize={24} />
        </BarChart>
      </ResponsiveContainer>
    </Card>
  );
}
