"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/dashboard", label: "Painel" },
  { href: "/unidades", label: "Unidades" },
  { href: "/planos", label: "Planos" },
  { href: "/produtos", label: "Produtos" },
  { href: "/cupons", label: "Cupons" },
  { href: "/funcionarios", label: "Funcionários" },
  { href: "/relatorios", label: "Relatórios" },
  { href: "/fiscal", label: "Fiscal" },
  { href: "/configuracoes", label: "Configurações" },
];

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
      {NAV.map((item) => {
        const active = pathname?.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            style={{
              padding: "8px 12px",
              borderRadius: "var(--radius-sm)",
              textDecoration: "none",
              fontFamily: "var(--font-body)",
              fontSize: "14px",
              fontWeight: active
                ? ("var(--weight-bold)" as unknown as number)
                : ("var(--weight-regular)" as unknown as number),
              color: active ? "var(--color-primary-hover)" : "var(--text-secondary)",
              background: active ? "rgba(240,25,107,0.10)" : "transparent",
            }}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
