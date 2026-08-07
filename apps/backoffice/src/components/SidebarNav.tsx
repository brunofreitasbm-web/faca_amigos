"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/dashboard", label: "Painel", help: "Visão geral do negócio: faturamento e indicadores das unidades" },
  { href: "/unidades", label: "Unidades", help: "Cadastro das unidades (lojas/quiosques) do FaçaAmigos" },
  { href: "/planos", label: "Planos", help: "Planos de permanência vendidos nas unidades" },
  { href: "/produtos", label: "Produtos", help: "Itens vendidos avulsos (loja/lanchonete) nas unidades" },
  { href: "/cupons", label: "Cupons", help: "Códigos de desconto e parceria usados no check-in" },
  { href: "/funcionarios", label: "Funcionários", help: "Cadastro e acesso dos colaboradores ao sistema" },
  { href: "/relatorios", label: "Relatórios", help: "Vendas, visitas e demais números históricos" },
  { href: "/configuracoes", label: "Configurações", help: "Ajustes gerais do sistema" },
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
            title={item.help}
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
