import { createClient } from "@/lib/supabase/server";
import { PageTitle } from "@/components/Typography";
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

export default async function RelatoriosPage() {
  const supabase = await createClient();
  const since = daysAgo(30);

  const [ordersRes, sessionsRes, paymentsRes, itemsRes] = await Promise.all([
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
