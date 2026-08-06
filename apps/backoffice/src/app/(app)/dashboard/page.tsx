import { Card } from "@/components/design-system";
import { createClient } from "@/lib/supabase/server";
import { PageTitle } from "@/components/Typography";

export default async function DashboardPage() {
  const supabase = await createClient();

  const [units, sessionsToday, orders] = await Promise.all([
    supabase.from("fa_kiosk_units").select("id", { count: "exact", head: true }),
    supabase
      .from("fa_kiosk_sessions")
      .select("id", { count: "exact", head: true })
      .eq("business_date", new Date().toISOString().slice(0, 10)),
    supabase
      .from("fa_kiosk_orders")
      .select("total_cents")
      .eq("business_date", new Date().toISOString().slice(0, 10))
      .eq("status", "PAGA"),
  ]);

  const revenueToday = (orders.data ?? []).reduce((sum, o) => sum + (o.total_cents ?? 0), 0);

  const cards = [
    { label: "Unidades cadastradas", value: String(units.count ?? 0) },
    { label: "Check-ins hoje", value: String(sessionsToday.count ?? 0) },
    { label: "Faturamento hoje", value: `R$ ${(revenueToday / 100).toFixed(2)}` },
  ];

  return (
    <div>
      <PageTitle>Painel</PageTitle>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: "var(--gap-lg)",
        }}
      >
        {cards.map((c) => (
          <Card key={c.label} variant="light" subtitle={c.label}>
            <div
              style={{
                fontFamily: "var(--font-body)",
                fontWeight: "var(--weight-extrabold)" as unknown as number,
                fontSize: "28px",
                color: "var(--text-primary)",
              }}
            >
              {c.value}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
