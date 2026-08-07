import { createClient } from "@/lib/supabase/server";
import { PageTitle } from "@/components/Typography";
import { Card } from "@/components/design-system";
import { ReportFilters } from "./ReportFilters";
import {
  CheckinsByDayChart,
  HourlyPeakChart,
  RevenueByDayChart,
  RevenueByMethodChart,
  RevenueByUnitChart,
  TopProductsChart,
} from "./ReportCharts";

function getPeriodDates(period: string, customFrom?: string, customTo?: string) {
  const now = new Date();
  const isoDate = (d: Date) => d.toISOString().slice(0, 10);

  let sinceDate = new Date();
  let untilDate = new Date();
  let prevSinceDate = new Date();
  let prevUntilDate = new Date();

  if (period === "today") {
    sinceDate = new Date(now);
    untilDate = new Date(now);
    prevSinceDate = new Date(now);
    prevSinceDate.setDate(now.getDate() - 1);
    prevUntilDate = new Date(prevSinceDate);
  } else if (period === "yesterday") {
    sinceDate = new Date(now);
    sinceDate.setDate(now.getDate() - 1);
    untilDate = new Date(sinceDate);
    prevSinceDate = new Date(now);
    prevSinceDate.setDate(now.getDate() - 2);
    prevUntilDate = new Date(prevSinceDate);
  } else if (period === "7d") {
    sinceDate.setDate(now.getDate() - 7);
    prevSinceDate.setDate(now.getDate() - 14);
    prevUntilDate.setDate(now.getDate() - 7);
  } else if (period === "90d") {
    sinceDate.setDate(now.getDate() - 90);
    prevSinceDate.setDate(now.getDate() - 180);
    prevUntilDate.setDate(now.getDate() - 90);
  } else if (period === "this_month") {
    sinceDate = new Date(now.getFullYear(), now.getMonth(), 1);
    prevSinceDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    prevUntilDate = new Date(now.getFullYear(), now.getMonth(), 0);
  } else if (period === "last_month") {
    sinceDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    untilDate = new Date(now.getFullYear(), now.getMonth(), 0);
    prevSinceDate = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    prevUntilDate = new Date(now.getFullYear(), now.getMonth() - 1, 0);
  } else if (period === "this_year") {
    sinceDate = new Date(now.getFullYear(), 0, 1);
    prevSinceDate = new Date(now.getFullYear() - 1, 0, 1);
    prevUntilDate = new Date(now.getFullYear() - 1, 11, 31);
  } else if (period === "last_year") {
    sinceDate = new Date(now.getFullYear() - 1, 0, 1);
    untilDate = new Date(now.getFullYear() - 1, 11, 31);
    prevSinceDate = new Date(now.getFullYear() - 2, 0, 1);
    prevUntilDate = new Date(now.getFullYear() - 2, 11, 31);
  } else if (period === "custom" && customFrom && customTo) {
    sinceDate = new Date(customFrom);
    untilDate = new Date(customTo);
    const diffTime = Math.abs(untilDate.getTime() - sinceDate.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) || 1;
    prevSinceDate = new Date(sinceDate);
    prevSinceDate.setDate(sinceDate.getDate() - diffDays);
    prevUntilDate = new Date(sinceDate);
  } else {
    // 30d por padrão
    sinceDate.setDate(now.getDate() - 30);
    prevSinceDate.setDate(now.getDate() - 60);
    prevUntilDate.setDate(now.getDate() - 30);
  }

  return {
    since: isoDate(sinceDate),
    until: isoDate(untilDate),
    previousSince: isoDate(prevSinceDate),
    previousUntil: isoDate(prevUntilDate),
  };
}

function pctDelta(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? 100 : null;
  return ((current - previous) / previous) * 100;
}

function DeltaBadge({ pct }: { pct: number | null }) {
  if (pct === null) return null;
  const up = pct >= 0;
  return (
    <span
      style={{
        fontSize: "13px",
        fontWeight: 600,
        color: up ? "var(--color-success, #10b981)" : "var(--color-error, #ef4444)",
      }}
    >
      {up ? "▲" : "▼"} {Math.abs(pct).toFixed(0)}% vs. período anterior
    </span>
  );
}

interface PageProps {
  searchParams: Promise<{
    period?: string;
    origin?: string;
    unitId?: string;
    from?: string;
    to?: string;
  }>;
}

export default async function RelatoriosPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const period = params.period ?? "30d";
  const origin = params.origin ?? "ALL";
  const unitId = params.unitId ?? "all";
  const from = params.from ?? "";
  const to = params.to ?? "";

  const supabase = await createClient();
  const { since, until, previousSince, previousUntil } = getPeriodDates(period, from, to);

  // Busca lista de unidades para o filtro
  const unitsRes = await supabase.from("fa_kiosk_units").select("id, name").order("name");
  const units = unitsRes.data ?? [];

  // Query base de ordens no período atual
  let ordersQuery = supabase
    .from("fa_kiosk_orders")
    .select("business_date, total_cents, unit_id, created_at, fa_kiosk_units(name)")
    .eq("status", "PAGA")
    .gte("business_date", since)
    .lte("business_date", until);

  let sessionsQuery = supabase
    .from("fa_kiosk_sessions")
    .select("business_date, created_at_ms, unit_id")
    .gte("business_date", since)
    .lte("business_date", until);

  let paymentsQuery = supabase
    .from("fa_kiosk_payments")
    .select("method, amount_cents, created_at")
    .gte("created_at", `${since}T00:00:00Z`)
    .lte("created_at", `${until}T23:59:59Z`);

  let itemsQuery = supabase
    .from("fa_kiosk_order_items")
    .select("description, total_cents, fa_kiosk_orders!inner(status, business_date, unit_id)")
    .eq("fa_kiosk_orders.status", "PAGA")
    .gte("fa_kiosk_orders.business_date", since)
    .lte("fa_kiosk_orders.business_date", until);

  let prevOrdersQuery = supabase
    .from("fa_kiosk_orders")
    .select("total_cents")
    .eq("status", "PAGA")
    .gte("business_date", previousSince)
    .lte("business_date", previousUntil);

  let prevSessionsQuery = supabase
    .from("fa_kiosk_sessions")
    .select("id", { count: "exact", head: true })
    .gte("business_date", previousSince)
    .lte("business_date", previousUntil);

  // Aplicar filtro de Unidade
  if (unitId !== "all") {
    ordersQuery = ordersQuery.eq("unit_id", unitId);
    sessionsQuery = sessionsQuery.eq("unit_id", unitId);
    itemsQuery = itemsQuery.eq("fa_kiosk_orders.unit_id", unitId);
    prevOrdersQuery = prevOrdersQuery.eq("unit_id", unitId);
    prevSessionsQuery = prevSessionsQuery.eq("unit_id", unitId);
  }

  // Aplicar filtro de Origem (Local vs Safoplay)
  if (origin !== "ALL") {
    ordersQuery = ordersQuery.eq("origin", origin);
    sessionsQuery = sessionsQuery.eq("origin", origin);
    itemsQuery = itemsQuery.eq("fa_kiosk_orders.origin", origin);
    prevOrdersQuery = prevOrdersQuery.eq("origin", origin);
    prevSessionsQuery = prevSessionsQuery.eq("origin", origin);
    paymentsQuery = paymentsQuery.eq("origin", origin);
  }

  const [ordersRes, sessionsRes, paymentsRes, itemsRes, previousOrdersRes, previousSessionsRes] =
    await Promise.all([
      ordersQuery.order("business_date"),
      sessionsQuery,
      paymentsQuery,
      itemsQuery,
      prevOrdersQuery,
      prevSessionsQuery,
    ]);

  // Agrupamento Faturamento por Dia e por Unidade
  const revenueByDayMap = new Map<string, number>();
  const revenueByUnitMap = new Map<string, number>();
  for (const o of ordersRes.data ?? []) {
    revenueByDayMap.set(o.business_date, (revenueByDayMap.get(o.business_date) ?? 0) + o.total_cents);
    const unitName = (o.fa_kiosk_units as unknown as { name: string } | null)?.name ?? "Unidade";
    revenueByUnitMap.set(unitName, (revenueByUnitMap.get(unitName) ?? 0) + o.total_cents);
  }

  const revenueByDay = [...revenueByDayMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, revenue]) => ({ date: date.slice(5), revenue }));

  const revenueByUnit = [...revenueByUnitMap.entries()]
    .sort(([, a], [, b]) => b - a)
    .map(([unit, revenue]) => ({ unit, revenue }));

  // Agrupamento Check-ins por Dia
  const checkinsByDayMap = new Map<string, number>();
  for (const s of sessionsRes.data ?? []) {
    checkinsByDayMap.set(s.business_date, (checkinsByDayMap.get(s.business_date) ?? 0) + 1);
  }
  const checkinsByDay = [...checkinsByDayMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, checkins]) => ({ date: date.slice(5), checkins }));

  // Agrupamento por Horário de Pico (08h às 22h)
  const hourlyMap = new Map<number, number>();
  for (let h = 8; h <= 22; h++) hourlyMap.set(h, 0);

  for (const s of sessionsRes.data ?? []) {
    if (s.created_at_ms) {
      const hour = new Date(Number(s.created_at_ms)).getHours();
      if (hour >= 8 && hour <= 22) {
        hourlyMap.set(hour, (hourlyMap.get(hour) ?? 0) + 1);
      }
    }
  }
  const hourlyPeak = [...hourlyMap.entries()].map(([h, count]) => ({
    hour: `${String(h).padStart(2, "0")}:00`,
    checkins: count,
  }));

  // Descobrir o horário de pico máximo
  const peakHourEntry = [...hourlyMap.entries()].sort(([, a], [, b]) => b - a)[0];
  const peakHourText =
    peakHourEntry && peakHourEntry[1] > 0
      ? `${String(peakHourEntry[0]).padStart(2, "0")}:00 - ${String(peakHourEntry[0] + 1).padStart(2, "0")}:00`
      : "Sem dados suficientes";

  // Formas de Pagamento
  const METHOD_LABEL: Record<string, string> = {
    DINHEIRO: "Dinheiro",
    CARTAO_CREDITO: "Cartão de Crédito",
    CARTAO_DEBITO: "Cartão de Débito",
    PIX: "PIX",
  };
  const revenueByMethodMap = new Map<string, number>();
  for (const p of paymentsRes.data ?? []) {
    const label = METHOD_LABEL[p.method] ?? p.method;
    revenueByMethodMap.set(label, (revenueByMethodMap.get(label) ?? 0) + p.amount_cents);
  }
  const revenueByMethod = [...revenueByMethodMap.entries()].map(([method, amount]) => ({ method, amount }));

  // Produtos Mais Vendidos
  const topProductsMap = new Map<string, number>();
  for (const i of itemsRes.data ?? []) {
    topProductsMap.set(i.description, (topProductsMap.get(i.description) ?? 0) + i.total_cents);
  }
  const topProducts = [...topProductsMap.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, 7)
    .map(([product, total]) => ({ product, total }));

  // Totais & Métricas
  const totalRevenue = (ordersRes.data ?? []).reduce((sum, o) => sum + o.total_cents, 0);
  const totalCheckins = sessionsRes.data?.length ?? 0;
  const avgTicket = ordersRes.data && ordersRes.data.length > 0 ? totalRevenue / ordersRes.data.length : 0;

  const previousRevenue = (previousOrdersRes.data ?? []).reduce((sum, o) => sum + o.total_cents, 0);
  const previousCheckins = previousSessionsRes.count ?? 0;
  const previousAvgTicket =
    previousOrdersRes.data && previousOrdersRes.data.length > 0
      ? previousRevenue / previousOrdersRes.data.length
      : 0;

  const deltaRevenue = pctDelta(totalRevenue, previousRevenue);
  const deltaCheckins = pctDelta(totalCheckins, previousCheckins);
  const deltaAvgTicket = pctDelta(avgTicket, previousAvgTicket);

  const kpis = [
    { label: "Faturamento Total", value: `R$ ${(totalRevenue / 100).toFixed(2)}`, delta: deltaRevenue },
    { label: "Total de Check-ins", value: String(totalCheckins), delta: deltaCheckins },
    { label: "Ticket Médio por Pedido", value: `R$ ${(avgTicket / 100).toFixed(2)}`, delta: deltaAvgTicket },
    { label: "Horário de Maior Pico", value: peakHourText, delta: null },
  ];

  // Dados estruturados para o botão de exportar CSV
  const exportData = {
    kpis: kpis.map((k) => ({
      label: k.label,
      value: k.value,
      delta: k.delta !== null ? `${k.delta >= 0 ? "+" : ""}${k.delta.toFixed(1)}%` : "N/A",
    })),
    revenueByDay,
    topProducts,
    revenueByMethod,
  };

  return (
    <div>
      <PageTitle description="Análise gráfica detalhada das vendas, check-ins e operação do Faça Amigos (incluindo dados importados do Safoplay).">
        Relatórios
      </PageTitle>

      {/* Filtros de Período, Origem, Unidade e Exportação CSV */}
      <ReportFilters
        units={units}
        currentPeriod={period}
        currentOrigin={origin}
        currentUnitId={unitId}
        currentFrom={from}
        currentTo={to}
        exportData={exportData}
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))",
          gap: "var(--gap-lg, 16px)",
          marginBottom: "var(--gap-lg, 24px)",
        }}
      >
        {kpis.map((k) => (
          <Card key={k.label} variant="light" subtitle={k.label}>
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <div
                style={{
                  fontFamily: "var(--font-body)",
                  fontWeight: 800,
                  fontSize: "26px",
                  color: "var(--text-primary)",
                  letterSpacing: "-0.5px",
                }}
              >
                {k.value}
              </div>
              {k.delta !== null && <DeltaBadge pct={k.delta} />}
            </div>
          </Card>
        ))}
      </div>

      {/* Grid de Gráficos Recharts */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 480px), 1fr))",
          gap: "var(--gap-lg, 20px)",
        }}
      >
        <RevenueByDayChart data={revenueByDay} />
        <CheckinsByDayChart data={checkinsByDay} />
        <HourlyPeakChart data={hourlyPeak} />
        <RevenueByUnitChart data={revenueByUnit} />
        <RevenueByMethodChart data={revenueByMethod} />
        <TopProductsChart data={topProducts} />
      </div>
    </div>
  );
}
