import { createClient } from "@/lib/supabase/server";

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
    { label: "Unidades cadastradas", value: units.count ?? 0 },
    { label: "Check-ins hoje", value: sessionsToday.count ?? 0 },
    { label: "Faturamento hoje", value: `R$ ${(revenueToday / 100).toFixed(2)}` },
  ];

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Painel</h1>
      <div style={{ display: "flex", gap: 16 }}>
        {cards.map((c) => (
          <div
            key={c.label}
            style={{
              background: "var(--panel)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              padding: 20,
              minWidth: 180,
            }}
          >
            <div style={{ fontSize: 13, color: "var(--muted)" }}>{c.label}</div>
            <div style={{ fontSize: 28, fontWeight: 700, marginTop: 6 }}>{c.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
