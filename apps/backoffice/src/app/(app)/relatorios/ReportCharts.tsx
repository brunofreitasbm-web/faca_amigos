"use client";

import {
  Area,
  AreaChart,
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

const CHART_COLORS = [
  "#2ECFB5", // Teal Principal
  "#6366F1", // Indigo
  "#F59E0B", // Âmbar / Laranja
  "#EC4899", // Rosa / Magenta
  "#10B981", // Verde
  "#8B5CF6", // Roxo
];

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "var(--surface-card, #ffffff)",
        borderRadius: "var(--radius-card, 12px)",
        boxShadow: "var(--shadow-sm, 0 1px 3px rgba(0,0,0,0.05))",
        border: "1px solid var(--border-subtle, #e5e7eb)",
        padding: "var(--space-5, 20px)",
        minWidth: 0,
      }}
    >
      <div style={{ marginBottom: 16 }}>
        <h2
          style={{
            fontFamily: "var(--font-body, inherit)",
            fontWeight: 600,
            fontSize: 15,
            margin: 0,
            color: "var(--text-primary, #111827)",
          }}
        >
          {title}
        </h2>
        {subtitle && (
          <p
            style={{
              fontSize: 12,
              color: "var(--text-secondary, #6b7280)",
              margin: "2px 0 0 0",
            }}
          >
            {subtitle}
          </p>
        )}
      </div>
      {children}
    </div>
  );
}

const tooltipStyle = {
  background: "var(--surface-card, #ffffff)",
  border: "1px solid var(--border-subtle, #e5e7eb)",
  borderRadius: 8,
  boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
  color: "var(--text-primary, #111827)",
  fontSize: 13,
  padding: "8px 12px",
};

// 1. Gráfico de Faturamento por Dia (Area Chart com Gradiente)
export function RevenueByDayChart({ data }: { data: { date: string; revenue: number }[] }) {
  return (
    <Card title="Faturamento Diário" subtitle="Evolução das vendas no período selecionado">
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={data} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
          <defs>
            <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#2ECFB5" stopOpacity={0.4} />
              <stop offset="95%" stopColor="#2ECFB5" stopOpacity={0.0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle, #f3f4f6)" vertical={false} />
          <XAxis dataKey="date" stroke="var(--text-secondary, #9ca3af)" fontSize={12} tickLine={false} />
          <YAxis
            stroke="var(--text-secondary, #9ca3af)"
            fontSize={12}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => `R$${(v / 100).toFixed(0)}`}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(v: number) => [`R$ ${(v / 100).toFixed(2)}`, "Faturamento"]}
            labelFormatter={(label) => `Data: ${label}`}
          />
          <Area
            type="monotone"
            dataKey="revenue"
            stroke="#2ECFB5"
            strokeWidth={3}
            fillOpacity={1}
            fill="url(#colorRevenue)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </Card>
  );
}

// 2. Gráfico de Check-ins por Dia (Bar Chart)
export function CheckinsByDayChart({ data }: { data: { date: string; checkins: number }[] }) {
  return (
    <Card title="Volume de Check-ins" subtitle="Quantidade de entradas de crianças por dia">
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle, #f3f4f6)" vertical={false} />
          <XAxis dataKey="date" stroke="var(--text-secondary, #9ca3af)" fontSize={12} tickLine={false} />
          <YAxis stroke="var(--text-secondary, #9ca3af)" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(v: number) => [`${v} crianças`, "Check-ins"]}
            labelFormatter={(label) => `Data: ${label}`}
          />
          <Bar dataKey="checkins" fill="#6366F1" radius={[6, 6, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </Card>
  );
}

// 3. Gráfico de Horários de Pico (Horas do Dia)
export function HourlyPeakChart({ data }: { data: { hour: string; checkins: number }[] }) {
  return (
    <Card title="Distribuição de Horários de Pico" subtitle="Volume de entradas por faixa de horário do dia">
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle, #f3f4f6)" vertical={false} />
          <XAxis dataKey="hour" stroke="var(--text-secondary, #9ca3af)" fontSize={11} tickLine={false} />
          <YAxis stroke="var(--text-secondary, #9ca3af)" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(v: number) => [`${v} movimentações`, "Fluxo"]}
            labelFormatter={(label) => `Horário: ${label}`}
          />
          <Bar dataKey="checkins" fill="#F59E0B" radius={[6, 6, 0, 0]} maxBarSize={32} />
        </BarChart>
      </ResponsiveContainer>
    </Card>
  );
}

// 4. Gráfico de Faturamento por Unidade (Bar Chart Horizontal)
export function RevenueByUnitChart({ data }: { data: { unit: string; revenue: number }[] }) {
  return (
    <Card title="Faturamento por Unidade" subtitle="Desempenho comparativo entre quiosques">
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle, #f3f4f6)" horizontal={false} />
          <XAxis type="number" stroke="var(--text-secondary, #9ca3af)" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `R$${(v/100).toFixed(0)}`} />
          <YAxis dataKey="unit" type="category" stroke="var(--text-secondary, #4b5563)" fontSize={12} tickLine={false} width={120} />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(v: number) => [`R$ ${(v / 100).toFixed(2)}`, "Faturamento"]}
          />
          <Bar dataKey="revenue" fill="#10B981" radius={[0, 6, 6, 0]} maxBarSize={24} />
        </BarChart>
      </ResponsiveContainer>
    </Card>
  );
}

// 5. Gráfico de Formas de Pagamento (Pie / Donut Chart)
export function RevenueByMethodChart({ data }: { data: { method: string; amount: number }[] }) {
  const total = data.reduce((acc, item) => acc + item.amount, 0);

  return (
    <Card title="Métodos de Pagamento" subtitle="Distribuição percentual da receita recebida">
      <ResponsiveContainer width="100%" height={280}>
        <PieChart>
          <Pie
            data={data}
            dataKey="amount"
            nameKey="method"
            cx="50%"
            cy="50%"
            innerRadius={65}
            outerRadius={95}
            paddingAngle={3}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} stroke="none" />
            ))}
          </Pie>
          <Legend
            verticalAlign="bottom"
            height={36}
            formatter={(value) => <span style={{ color: "var(--text-primary, #374151)", fontSize: 12 }}>{value}</span>}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(v: number) => [
              `R$ ${(v / 100).toFixed(2)} (${total > 0 ? ((v / total) * 100).toFixed(1) : 0}%)`,
              "Total",
            ]}
          />
        </PieChart>
      </ResponsiveContainer>
    </Card>
  );
}

// 6. Gráfico de Produtos / Planos Mais Vendidos (Bar Chart Horizontal)
export function TopProductsChart({ data }: { data: { product: string; total: number }[] }) {
  return (
    <Card title="Produtos e Planos Mais Vendidos" subtitle="Ranking por volume total de receita">
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle, #f3f4f6)" horizontal={false} />
          <XAxis type="number" stroke="var(--text-secondary, #9ca3af)" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `R$${(v/100).toFixed(0)}`} />
          <YAxis dataKey="product" type="category" stroke="var(--text-secondary, #4b5563)" fontSize={12} tickLine={false} width={130} />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(v: number) => [`R$ ${(v / 100).toFixed(2)}`, "Receita gerada"]}
          />
          <Bar dataKey="total" fill="#8B5CF6" radius={[0, 6, 6, 0]} maxBarSize={24} />
        </BarChart>
      </ResponsiveContainer>
    </Card>
  );
}
