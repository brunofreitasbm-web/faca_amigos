import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card } from "@facaamigos/ui";
import { money } from "../../format.js";

const CHART_COLORS = ["#2ECFB5", "#6366F1", "#F59E0B", "#EC4899", "#10B981", "#8B5CF6"];

const tooltipStyle = {
  background: "var(--surface-card, #ffffff)",
  border: "1px solid var(--border-subtle, #e5e7eb)",
  borderRadius: 8,
  boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
  color: "var(--text-primary, #111827)",
  fontSize: 13,
  padding: "8px 12px",
};

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card style={{ padding: "16px", background: "var(--surface-card, #ffffff)" }}>
      <h3 style={{ margin: "0 0 14px 0", fontSize: "14px", fontWeight: 600, color: "var(--text-primary, #111827)" }}>
        {title}
      </h3>
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
      <ResponsiveContainer width="100%" height={230}>
        <PieChart>
          <Pie
            data={data}
            dataKey="sessions_count"
            nameKey="plan_name"
            cx="50%"
            cy="50%"
            innerRadius={55}
            outerRadius={85}
            paddingAngle={3}
          >
            {data.map((d) => (
              <Cell key={d.plan_name} fill={d.plan_color} stroke="none" />
            ))}
          </Pie>
          <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v} venda(s)`, "Total"]} />
          <Legend wrapperStyle={{ fontSize: 12, color: "var(--text-secondary)" }} />
        </PieChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function RevenueByDayChart({ data }: { data: { business_date: string; total_cents: number }[] }) {
  if (data.length === 0) return null;
  return (
    <ChartCard title="Faturamento por dia (R$)">
      <ResponsiveContainer width="100%" height={230}>
        <AreaChart data={data} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
          <defs>
            <linearGradient id="kioskRevenueGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#2ECFB5" stopOpacity={0.4} />
              <stop offset="95%" stopColor="#2ECFB5" stopOpacity={0.0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle, #f3f4f6)" vertical={false} />
          <XAxis
            dataKey="business_date"
            tickFormatter={(d: string) => d.slice(5)}
            stroke="var(--text-secondary, #9ca3af)"
            fontSize={12}
            tickLine={false}
          />
          <YAxis
            stroke="var(--text-secondary, #9ca3af)"
            fontSize={12}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => `R$${(v / 100).toFixed(0)}`}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(v: number) => [money(v), "Faturamento"]}
            labelFormatter={(d: string) => `Data: ${d}`}
          />
          <Area
            type="monotone"
            dataKey="total_cents"
            stroke="#2ECFB5"
            strokeWidth={3}
            fillOpacity={1}
            fill="url(#kioskRevenueGrad)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function VisitsByDayChart({ data }: { data: { business_date: string; sessions_count: number }[] }) {
  if (data.length === 0) return null;
  return (
    <ChartCard title="Visitas (Check-ins) por dia">
      <ResponsiveContainer width="100%" height={230}>
        <BarChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle, #f3f4f6)" vertical={false} />
          <XAxis
            dataKey="business_date"
            tickFormatter={(d: string) => d.slice(5)}
            stroke="var(--text-secondary, #9ca3af)"
            fontSize={12}
            tickLine={false}
          />
          <YAxis stroke="var(--text-secondary, #9ca3af)" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(v: number) => [`${v} visitas`, "Total"]}
            labelFormatter={(d: string) => `Data: ${d}`}
          />
          <Bar dataKey="sessions_count" fill="#6366F1" radius={[6, 6, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function RevenueByMethodChart({ data }: { data: { method: string; total_cents: number }[] }) {
  if (data.length === 0) return null;
  return (
    <ChartCard title="Faturamento por forma de pagamento">
      <ResponsiveContainer width="100%" height={230}>
        <PieChart>
          <Pie
            data={data}
            dataKey="total_cents"
            nameKey="method"
            cx="50%"
            cy="50%"
            innerRadius={55}
            outerRadius={85}
            paddingAngle={3}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} stroke="none" />
            ))}
          </Pie>
          <Legend wrapperStyle={{ fontSize: 12, color: "var(--text-secondary)" }} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [money(v), "Faturamento"]} />
        </PieChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

/**
 * Check-ins por hora do dia, uma barra por unidade quando há mais de uma
 * (comparação lado a lado); `data` já vem pivotado (uma linha por hora,
 * uma coluna por nome de unidade) — ver pivotCheckinsByHour em
 * RelatorioScreen.tsx.
 */
export function CheckinsByHourChart({ data, unitNames }: { data: Record<string, number | string>[]; unitNames: string[] }) {
  if (data.length === 0) return null;
  return (
    <ChartCard title="Check-ins por hora do dia">
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle, #f3f4f6)" vertical={false} />
          <XAxis dataKey="hourLabel" stroke="var(--text-secondary, #9ca3af)" fontSize={12} tickLine={false} />
          <YAxis stroke="var(--text-secondary, #9ca3af)" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v: number, name: string) => [`${v} check-in(s)`, name]} />
          {unitNames.length > 1 && <Legend wrapperStyle={{ fontSize: 12, color: "var(--text-secondary)" }} />}
          {unitNames.map((name, i) => (
            <Bar key={name} dataKey={name} fill={CHART_COLORS[i % CHART_COLORS.length]} radius={[4, 4, 0, 0]} maxBarSize={unitNames.length > 1 ? 12 : 24} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function AssetUsageChart({ data }: { data: { name: string; sessions_count: number }[] }) {
  if (data.length === 0) return null;
  return (
    <ChartCard title="Uso da frota por carrinho (nº de sessões)">
      <ResponsiveContainer width="100%" height={Math.max(180, data.length * 38)}>
        <BarChart data={data} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle, #f3f4f6)" horizontal={false} />
          <XAxis type="number" stroke="var(--text-secondary, #9ca3af)" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
          <YAxis dataKey="name" type="category" stroke="var(--text-secondary, #4b5563)" fontSize={12} tickLine={false} width={110} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v} sessões`, "Uso"]} />
          <Bar dataKey="sessions_count" fill="#F59E0B" radius={[0, 6, 6, 0]} maxBarSize={22} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
