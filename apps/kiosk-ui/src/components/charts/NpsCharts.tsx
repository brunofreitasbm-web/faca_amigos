import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { npsBandColor, type NpsDashboardData } from "../../lib/nps.js";
import { ChartCard, tooltipStyle } from "./ReportCharts.js";

const AXIS = "var(--text-secondary, #9ca3af)";

/** "2026-10-05" → "05/10" */
const shortDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

export function NpsTrendChart({ data, bucket }: { data: NpsDashboardData["trend"]; bucket: "day" | "week" }) {
  return (
    <ChartCard title={bucket === "day" ? "NPS e respostas por dia" : "NPS e respostas por semana (início da semana)"}>
      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart data={data} margin={{ top: 10, right: 0, left: -15, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle, #f3f4f6)" vertical={false} />
          <XAxis dataKey="bucket" tickFormatter={shortDate} stroke={AXIS} fontSize={12} tickLine={false} />
          <YAxis yAxisId="nps" domain={[-100, 100]} stroke={AXIS} fontSize={12} tickLine={false} axisLine={false} />
          <YAxis yAxisId="count" orientation="right" allowDecimals={false} stroke={AXIS} fontSize={12} tickLine={false} axisLine={false} />
          <Tooltip
            contentStyle={tooltipStyle}
            labelFormatter={(d: string) => (bucket === "day" ? shortDate(d) : `Semana de ${shortDate(d)}`)}
            formatter={(v, name) => [v ?? "—", String(name)]}
          />
          <Bar yAxisId="count" dataKey="scored" name="Respostas" fill="#e2e8f0" barSize={28} radius={[4, 4, 0, 0]} />
          <Line yAxisId="nps" dataKey="nps" name="NPS" stroke="#6366F1" strokeWidth={3} dot={{ r: 3 }} connectNulls />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

/** Histograma das notas. `bands` pinta 0-10 por faixa do NPS; sem ele, escala 1-5 em gradiente. */
export function NpsDistributionChart({
  title,
  data,
  bands,
}: {
  title: string;
  data: { value: number; count: number }[];
  bands?: boolean;
}) {
  const fiveColors = ["#ef4444", "#f97316", "#f59e0b", "#84cc16", "#10b981"];
  return (
    <ChartCard title={title}>
      <ResponsiveContainer width="100%" height={190}>
        <BarChart data={data} margin={{ top: 10, right: 0, left: -25, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle, #f3f4f6)" vertical={false} />
          <XAxis dataKey="value" stroke={AXIS} fontSize={12} tickLine={false} />
          <YAxis allowDecimals={false} stroke={AXIS} fontSize={12} tickLine={false} axisLine={false} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v} resposta(s)`, "Total"]} labelFormatter={(n: number) => `Nota ${n}`} />
          <Bar dataKey="count" radius={[4, 4, 0, 0]}>
            {data.map((d) => (
              <Cell key={d.value} fill={bands ? npsBandColor(d.value) : fiveColors[d.value - 1]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

/** Barra empilhada promotores / neutros / detratores. */
export function NpsBandBar({ promoters, passives, detractors }: { promoters: number; passives: number; detractors: number }) {
  const total = promoters + passives + detractors;
  if (total === 0) return null;
  const parts = [
    { label: "Promotores (9–10)", n: promoters, color: "#10b981" },
    { label: "Neutros (7–8)", n: passives, color: "#f59e0b" },
    { label: "Detratores (0–6)", n: detractors, color: "#ef4444" },
  ];
  return (
    <ChartCard title="Composição das respostas">
      <div style={{ display: "flex", height: 22, borderRadius: 11, overflow: "hidden", background: "#e2e8f0" }}>
        {parts.map((p) => (
          <div key={p.label} title={`${p.label}: ${p.n}`} style={{ width: `${(p.n / total) * 100}%`, background: p.color }} />
        ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px", marginTop: 10, fontSize: 13, color: "#334155" }}>
        {parts.map((p) => (
          <span key={p.label} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: p.color }} />
            {p.label}: <strong>{p.n}</strong> ({Math.round((p.n / total) * 100)}%)
          </span>
        ))}
      </div>
    </ChartCard>
  );
}

/** Funil: enviadas → unidade → nota → equipe → espaço → contribuição. */
export function NpsFunnel({ steps }: { steps: { label: string; count: number }[] }) {
  const base = steps[0]?.count ?? 0;
  return (
    <ChartCard title="Funil de resposta">
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {steps.map((s, i) => {
          const share = base > 0 ? (s.count / base) * 100 : 0;
          const prev = i > 0 ? steps[i - 1]!.count : null;
          const drop = prev && prev > 0 ? Math.round(((prev - s.count) / prev) * 100) : null;
          return (
            <div key={s.label}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#334155", marginBottom: 3 }}>
                <span>{s.label}</span>
                <span>
                  <strong>{s.count}</strong>
                  {base > 0 && ` · ${Math.round(share)}%`}
                  {drop != null && drop > 0 && <span style={{ color: "#b91c1c" }}> · −{drop}% da etapa anterior</span>}
                </span>
              </div>
              <div style={{ height: 10, borderRadius: 5, background: "#e2e8f0", overflow: "hidden" }}>
                <div style={{ width: `${share}%`, height: "100%", background: "#6366F1" }} />
              </div>
            </div>
          );
        })}
      </div>
    </ChartCard>
  );
}
