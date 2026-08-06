import { Button } from "@/components/design-system";
import { createClient } from "@/lib/supabase/server";
import { SidebarNav } from "@/components/SidebarNav";
import { signOut } from "./actions";

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
          borderRight: "1px solid var(--border-subtle)",
          background: "var(--surface-raised)",
          padding: "var(--space-5)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--gap-xs)",
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-body)",
            fontWeight: "var(--weight-extrabold)" as unknown as number,
            fontSize: "18px",
            color: "var(--text-primary)",
            marginBottom: "var(--space-4)",
          }}
        >
          FaçaAmigos
        </div>
        <SidebarNav />
        <div
          style={{
            marginTop: "auto",
            fontFamily: "var(--font-body)",
            fontSize: "12px",
            color: "var(--text-muted)",
          }}
        >
          <div style={{ marginBottom: "var(--space-2)" }}>{user?.email}</div>
          <form action={signOut}>
            <Button type="submit" variant="ghost" size="sm">
              Sair
            </Button>
          </form>
        </div>
      </aside>
      <main style={{ flex: 1, padding: "var(--space-8)", background: "var(--surface-page)" }}>
        {children}
      </main>
    </div>
  );
}
