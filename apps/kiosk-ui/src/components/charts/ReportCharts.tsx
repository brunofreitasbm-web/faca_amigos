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
import { Card } from "@facaamigos/ui";
import { money } from "../../format.js";

const CHART_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)"];

const tooltipStyle = {
  background: "var(--surface-card)",
  border: "1px solid var(--border-subtle)",
  borderRadius: 8,
  color: "var(--text-primary)",
  fontSize: 13,
};

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card style={{ padding: "16px" }}>
      <h3 style={{ margin: "0 0 12px 0", fontSize: "14px", color: "var(--text-secondary)" }}>{title}</h3>
      {children}
    </Card>
  );
}

/**
 * Rosca de planos vendidos. Usa a cor cadastrada de cada plano em vez da
 * paleta genérica de gráficos: é a mesma cor que identifica o plano na
 * borda esquerda dos cards do Painel, então o operador já a associa.
 */
export function PlansSoldChart({
  title,
  data,
}: {
  title: string;
  data: { plan_name: string; plan_color: string; sessions_count: number }[];
}) {
  if (data.length === 0) return null;
  return (
    <ChartCard title={title}>
      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <Pie data={data} dataKey="sessions_count" nameKey="plan_name" innerRadius={55} outerRadius={85} paddingAngle={2}>
            {data.map((d) => (
              <Cell key={d.plan_name} fill={d.plan_color} />
            ))}
          </Pie>
          <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v} venda(s)`, ""]} />
          <Legend wrapperStyle={{ fontSize: 12, color: "var(--text-secondary)" }} />
        </PieChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function RevenueByDayChart({ data }: { data: { business_date: string; total_cents: number }[] }) {
  if (data.length === 0) return null;
  return (
    <ChartCard title="Faturamento por dia">
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ left: -20 }}>
          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
          <XAxis dataKey="business_date" tickFormatter={(d: string) => d.slice(5)} stroke="var(--text-secondary)" fontSize={12} tickLine={false} />
          <YAxis stroke="var(--text-secondary)" fontSize={12} tickLine={false} axisLine={false} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [money(v), "Faturamento"]} labelFormatter={(d: string) => d} />
          <Line type="monotone" dataKey="total_cents" stroke="var(--chart-1)" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function VisitsByDayChart({ data }: { data: { business_date: string; sessions_count: number }[] }) {
  if (data.length === 0) return null;
  return (
    <ChartCard title="Visitas por dia">
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ left: -20 }}>
          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
          <XAxis dataKey="business_date" tickFormatter={(d: string) => d.slice(5)} stroke="var(--text-secondary)" fontSize={12} tickLine={false} />
          <YAxis stroke="var(--text-secondary)" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [v, "Visitas"]} labelFormatter={(d: string) => d} />
          <Bar dataKey="sessions_count" fill="var(--chart-3)" radius={[4, 4, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function RevenueByMethodChart({ data }: { data: { method: string; total_cents: number }[] }) {
  if (data.length === 0) return null;
  return (
    <ChartCard title="Faturamento por forma de pagamento">
      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <Pie data={data} dataKey="total_cents" nameKey="method" innerRadius={55} outerRadius={85} paddingAngle={2}>
            {data.map((_, i) => (
              <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
            ))}
          </Pie>
          <Legend wrapperStyle={{ fontSize: 12, color: "var(--text-secondary)" }} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [money(v), ""]} />
        </PieChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function AssetUsageChart({ data }: { data: { name: string; sessions_count: number }[] }) {
  if (data.length === 0) return null;
  return (
    <ChartCard title="Uso por carrinho (nº de sessões)">
      <ResponsiveContainer width="100%" height={Math.max(160, data.length * 36)}>
        <BarChart data={data} layout="vertical" margin={{ left: 20 }}>
          <CartesianGrid stroke="var(--chart-grid)" horizontal={false} />
          <XAxis type="number" stroke="var(--text-secondary)" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
          <YAxis dataKey="name" type="category" stroke="var(--text-secondary)" fontSize={12} tickLine={false} width={100} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [v, "Sessões"]} />
          <Bar dataKey="sessions_count" fill="var(--chart-2)" radius={[0, 4, 4, 0]} maxBarSize={20} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
