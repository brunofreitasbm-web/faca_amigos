import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "./actions";

const NAV = [
  { href: "/dashboard", label: "Painel" },
  { href: "/unidades", label: "Unidades" },
  { href: "/planos", label: "Planos" },
  { href: "/produtos", label: "Produtos" },
  { href: "/funcionarios", label: "Funcionários" },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <aside
        style={{
          width: 220,
          borderRight: "1px solid var(--border)",
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 16 }}>FaçaAmigos</div>
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            style={{
              padding: "8px 10px",
              borderRadius: 6,
              textDecoration: "none",
              color: "var(--text)",
            }}
          >
            {item.label}
          </Link>
        ))}
        <div style={{ marginTop: "auto", fontSize: 12, color: "var(--muted)" }}>
          <div style={{ marginBottom: 8 }}>{user?.email}</div>
          <form action={signOut}>
            <button type="submit" className="secondary">
              Sair
            </button>
          </form>
        </div>
      </aside>
      <main style={{ flex: 1, padding: 32 }}>{children}</main>
    </div>
  );
}
