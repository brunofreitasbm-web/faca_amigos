import { Card } from "@/components/design-system";
import { createClient } from "@/lib/supabase/server";
import { PageTitle } from "@/components/Typography";
import { KpiCard, OverviewTrendChart } from "./DashboardCharts";

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function pctDelta(today: number, yesterday: number): number | null {
  if (yesterday === 0) return today > 0 ? 100 : null;
  return ((today - yesterday) / yesterday) * 100;
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const todayStr = daysAgo(0);
  const yesterdayStr = daysAgo(1);
  const since14 = daysAgo(13);

  const [units, orders14, sessions14] = await Promise.all([
    supabase.from("fa_kiosk_units").select("id", { count: "exact", head: true }),
    supabase
      .from("fa_kiosk_orders")
      .select("business_date, total_cents")
      .eq("status", "PAGA")
      .gte("business_date", since14)
      .order("business_date"),
    supabase.from("fa_kiosk_sessions").select("business_date").gte("business_date", since14),
  ]);

  // Preenche os 14 dias mesmo sem movimento, para o sparkline não "pular" dias vazios.
  const revenueByDayMap = new Map<string, number>();
  const checkinsByDayMap = new Map<string, number>();
  for (let i = 13; i >= 0; i--) {
    const d = daysAgo(i).slice(5);
    revenueByDayMap.set(d, 0);
    checkinsByDayMap.set(d, 0);
  }
  for (const o of orders14.data ?? []) {
    const d = o.business_date.slice(5);
    revenueByDayMap.set(d, (revenueByDayMap.get(d) ?? 0) + o.total_cents);
  }
  for (const s of sessions14.data ?? []) {
    const d = s.business_date.slice(5);
    checkinsByDayMap.set(d, (checkinsByDayMap.get(d) ?? 0) + 1);
  }
  const revenueSeries = [...revenueByDayMap.entries()].map(([date, revenue]) => ({ date, revenue }));
  const checkinsSeries = [...checkinsByDayMap.entries()].map(([date, checkins]) => ({ date, checkins }));

  const overviewData = [...revenueByDayMap.keys()].map((date) => ({
    date,
    revenue: revenueByDayMap.get(date) ?? 0,
    checkins: checkinsByDayMap.get(date) ?? 0,
  }));

  const revenueToday = revenueByDayMap.get(todayStr.slice(5)) ?? 0;
  const revenueYesterday = revenueByDayMap.get(yesterdayStr.slice(5)) ?? 0;
  const checkinsToday = checkinsByDayMap.get(todayStr.slice(5)) ?? 0;
  const checkinsYesterday = checkinsByDayMap.get(yesterdayStr.slice(5)) ?? 0;

  return (
    <div>
      <PageTitle>Painel Principal</PageTitle>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))",
          gap: "var(--gap-lg)",
        }}
      >
        <Card variant="light" subtitle="Unidades cadastradas">
          <div
            style={{
              fontFamily: "var(--font-body)",
              fontWeight: 800,
              fontSize: "28px",
              color: "var(--text-primary)",
            }}
          >
            {units.count ?? 0}
          </div>
        </Card>
        <KpiCard
          label="Check-ins hoje (vs. ontem)"
          value={String(checkinsToday)}
          deltaPct={pctDelta(checkinsToday, checkinsYesterday)}
          data={checkinsSeries}
          dataKey="checkins"
          color="var(--chart-3, #6366F1)"
          valueFormatter={(v) => `${v} check-ins`}
        />
        <KpiCard
          label="Faturamento hoje (vs. ontem)"
          value={`R$ ${(revenueToday / 100).toFixed(2)}`}
          deltaPct={pctDelta(revenueToday, revenueYesterday)}
          data={revenueSeries}
          dataKey="revenue"
          color="var(--chart-1, #2ECFB5)"
          valueFormatter={(v) => `R$ ${(v / 100).toFixed(2)}`}
        />
      </div>

      {/* Visão Geral Gráfica Recharts */}
      <OverviewTrendChart data={overviewData} />
    </div>
  );
}
