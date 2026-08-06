import { createClient } from "@/lib/supabase/server";
import { PageTitle } from "@/components/Typography";
import { Card } from "@/components/design-system";
import {
  CheckinsByDayChart,
  RevenueByDayChart,
  RevenueByMethodChart,
  RevenueByUnitChart,
  TopProductsChart,
} from "./ReportCharts";

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function pctDelta(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? 100 : null;
  return ((current - previous) / previous) * 100;
}

function DeltaBadge({ pct }: { pct: number | null }) {
  if (pct === null) return null;
  const up = pct >= 0;
  return (
    <span style={{ fontSize: "13px", fontWeight: "var(--weight-semibold)" as unknown as number, color: up ? "var(--color-success)" : "var(--color-error)" }}>
      {up ? "▲" : "▼"} {Math.abs(pct).toFixed(0)}% vs. período anterior
    </span>
  );
}

export default async function RelatoriosPage() {
  const supabase = await createClient();
  const since = daysAgo(30);
  const previousSince = daysAgo(60);

  const [ordersRes, sessionsRes, paymentsRes, itemsRes, previousOrdersRes, previousSessionsRes] = await Promise.all([
    supabase
      .from("fa_kiosk_orders")
      .select("business_date, total_cents, unit_id, fa_kiosk_units(name)")
      .eq("status", "PAGA")
      .gte("business_date", since)
      .order("business_date"),
    supabase.from("fa_kiosk_sessions").select("business_date").gte("business_date", since),
    supabase
      .from("fa_kiosk_payments")
      .select("method, amount_cents, created_at")
      .gte("created_at", `${since}T00:00:00Z`),
    supabase
      .from("fa_kiosk_order_items")
      .select("description, total_cents, fa_kiosk_orders!inner(status, business_date)")
      .eq("fa_kiosk_orders.status", "PAGA")
      .gte("fa_kiosk_orders.business_date", since),
    // Período anterior (30 dias antes de `since`) — só para as métricas de comparação abaixo.
    supabase
      .from("fa_kiosk_orders")
      .select("total_cents")
      .eq("status", "PAGA")
      .gte("business_date", previousSince)
      .lt("business_date", since),
    supabase.from("fa_kiosk_sessions").select("id", { count: "exact", head: true }).gte("business_date", previousSince).lt("business_date", since),
  ]);

  const revenueByDayMap = new Map<string, number>();
  const revenueByUnitMap = new Map<string, number>();
  for (const o of ordersRes.data ?? []) {
    revenueByDayMap.set(o.business_date, (revenueByDayMap.get(o.business_date) ?? 0) + o.total_cents);
    const unitName = (o.fa_kiosk_units as unknown as { name: string } | null)?.name ?? "—";
    revenueByUnitMap.set(unitName, (revenueByUnitMap.get(unitName) ?? 0) + o.total_cents);
  }
  const revenueByDay = [...revenueByDayMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, revenue]) => ({ date: date.slice(5), revenue }));
  const revenueByUnit = [...revenueByUnitMap.entries()]
    .sort(([, a], [, b]) => b - a)
    .map(([unit, revenue]) => ({ unit, revenue }));

  const checkinsByDayMap = new Map<string, number>();
  for (const s of sessionsRes.data ?? []) {
    checkinsByDayMap.set(s.business_date, (checkinsByDayMap.get(s.business_date) ?? 0) + 1);
  }
  const checkinsByDay = [...checkinsByDayMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, checkins]) => ({ date: date.slice(5), checkins }));

  const METHOD_LABEL: Record<string, string> = {
    DINHEIRO: "Dinheiro",
    CARTAO_CREDITO: "Cartão de crédito",
    CARTAO_DEBITO: "Cartão de débito",
    PIX: "PIX",
  };
  const revenueByMethodMap = new Map<string, number>();
  for (const p of paymentsRes.data ?? []) {
    const label = METHOD_LABEL[p.method] ?? p.method;
    revenueByMethodMap.set(label, (revenueByMethodMap.get(label) ?? 0) + p.amount_cents);
  }
  const revenueByMethod = [...revenueByMethodMap.entries()].map(([method, amount]) => ({ method, amount }));

  const topProductsMap = new Map<string, number>();
  for (const i of itemsRes.data ?? []) {
    topProductsMap.set(i.description, (topProductsMap.get(i.description) ?? 0) + i.total_cents);
  }
  const topProducts = [...topProductsMap.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8)
    .map(([product, total]) => ({ product, total }));

  const totalRevenue = (ordersRes.data ?? []).reduce((sum, o) => sum + o.total_cents, 0);
  const totalCheckins = sessionsRes.data?.length ?? 0;
  const avgTicket = ordersRes.data && ordersRes.data.length > 0 ? totalRevenue / ordersRes.data.length : 0;

  const previousRevenue = (previousOrdersRes.data ?? []).reduce((sum, o) => sum + o.total_cents, 0);
  const previousCheckins = previousSessionsRes.count ?? 0;
  const previousAvgTicket =
    previousOrdersRes.data && previousOrdersRes.data.length > 0 ? previousRevenue / previousOrdersRes.data.length : 0;

  const kpis = [
    { label: "Faturamento no período", value: `R$ ${(totalRevenue / 100).toFixed(2)}`, delta: pctDelta(totalRevenue, previousRevenue) },
    { label: "Check-ins no período", value: String(totalCheckins), delta: pctDelta(totalCheckins, previousCheckins) },
    { label: "Ticket médio", value: `R$ ${(avgTicket / 100).toFixed(2)}`, delta: pctDelta(avgTicket, previousAvgTicket) },
  ];

  return (
    <div>
      <PageTitle>Relatórios</PageTitle>
      <p
        style={{
          fontFamily: "var(--font-body)",
          fontSize: "14px",
          color: "var(--text-muted)",
          marginTop: "-8px",
        }}
      >
        Últimos 30 dias, todas as unidades.
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: "var(--gap-lg)",
          marginBottom: "var(--gap-lg)",
        }}
      >
        {kpis.map((k) => (
          <Card key={k.label} variant="light" subtitle={k.label}>
            <div style={{ display: "flex", alignItems: "baseline", gap: "10px" }}>
              <div
                style={{
                  fontFamily: "var(--font-body)",
                  fontWeight: "var(--weight-extrabold)" as unknown as number,
                  fontSize: "28px",
                  color: "var(--text-primary)",
                }}
              >
                {k.value}
              </div>
              <DeltaBadge pct={k.delta} />
            </div>
          </Card>
        ))}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
          gap: "var(--gap-lg)",
        }}
      >
        <RevenueByDayChart data={revenueByDay} />
        <CheckinsByDayChart data={checkinsByDay} />
        <RevenueByUnitChart data={revenueByUnit} />
        <RevenueByMethodChart data={revenueByMethod} />
        <TopProductsChart data={topProducts} />
      </div>
    </div>
  );
}
