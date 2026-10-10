import { useState, useMemo } from "react";
import { Button, BrandLockup } from "@facaamigos/ui";
import { useAppState } from "../../state/AppState.js";
import { RequireCapability } from "../../auth/RequireCapability.js";
import { ROLE_LABEL } from "../../auth/capabilities.js";
import { PlanosTab } from "./tabs/PlanosTab.js";
import { PacotesTab } from "./tabs/PacotesTab.js";
import { ProdutosTab } from "./tabs/ProdutosTab.js";
import { CuponsTab } from "./tabs/CuponsTab.js";
import { FidelidadeTab } from "./tabs/FidelidadeTab.js";
import { MetasTab } from "./tabs/MetasTab.js";
import { BonificacaoTab } from "./tabs/BonificacaoTab.js";
import { ColaboradoresTab } from "./tabs/ColaboradoresTab.js";
import { OcorrenciasTab } from "./tabs/OcorrenciasTab.js";
import { FrequenciaTab } from "./tabs/FrequenciaTab.js";
import { PermissoesTab } from "./tabs/PermissoesTab.js";
import { GerencialRelatorioTab } from "./tabs/GerencialRelatorioTab.js";
import { FolhaPagamentoTab } from "./tabs/FolhaPagamentoTab.js";
import { PassagemTurnoTab } from "./tabs/PassagemTurnoTab.js";
import { AberturaFechamentoTab } from "./tabs/AberturaFechamentoTab.js";
import { FotosEnvelopeTab } from "./tabs/FotosEnvelopeTab.js";
import { SaldoEnvelopesTab } from "./tabs/SaldoEnvelopesTab.js";
import { HistoricoTab } from "./tabs/HistoricoTab.js";
import { AuditoriaTab } from "./tabs/AuditoriaTab.js";
import { ContratoTab } from "./tabs/ContratoTab.js";
import { BobinasTab } from "./tabs/BobinasTab.js";
import { BancoTalentosTab } from "./tabs/BancoTalentosTab.js";
import { ClientesTab } from "./tabs/ClientesTab.js";
import { CrmWhatsappTab } from "./tabs/CrmWhatsappTab.js";
import { RelatoriosSessaoTab } from "./tabs/RelatoriosSessaoTab.js";
import { OwnerAcompanhamentoTab } from "./tabs/OwnerAcompanhamentoTab.js";
import { NpsDashboardTab } from "./tabs/NpsDashboardTab.js";
import { GeminiGerencialCopilot } from "../../components/GeminiGerencialCopilot.js";

export type GerencialTab =
  | "ACOMPANHAMENTO_OWNER"
  | "NPS_DASHBOARD"
  | "PLANOS"
  | "PACOTES"
  | "PRODUTOS"
  | "CUPONS"
  | "FIDELIDADE"
  | "METAS"
  | "COLABORADORES"
  | "FREQUENCIA"
  | "OCORRENCIAS"
  | "PERMISSOES"
  | "CLIENTES"
  | "CRM_WHATSAPP"
  | "RELATORIOS_SESSAO"
  | "RELATORIOS"
  | "FOLHA"
  | "BONIFICACAO"
  | "ABERTURA_FECHAMENTO"
  | "PASSAGEM_TURNO"
  | "FOTOS_ENVELOPE"
  | "SALDO_ENVELOPES"
  | "HISTORICO"
  | "AUDITORIA"
  | "CONTRATO"
  | "TALENTOS"
  | "BOBINAS"
  | "COPILOT_IA";

interface ModuleItem {
  value: GerencialTab;
  label: string;
  icon: string;
  tag?: string;
  description: string;
}

interface ModuleCategory {
  id: string;
  label: string;
  icon: string;
  badge?: string;
  description: string;
  items: ModuleItem[];
}

const CATEGORIES: ModuleCategory[] = [
  {
    id: "visao_geral",
    label: "Visão Geral & IA",
    icon: "⚡",
    badge: "Estratégico",
    description: "Cockpit executivo, assistente de vendas e inteligência de mercado",
    items: [
      { value: "NPS_DASHBOARD", label: "Dashboard NPS", icon: "📈", tag: "Novo", description: "NPS, equipe e espaço por unidade, taxa de resposta, tendência, detratores a tratar e contribuições dos responsáveis." },
      { value: "COPILOT_IA", label: "ZoeIA (Copilot)", icon: "✦", tag: "IA Vendas", description: "Assistente comercial humana para sugestões automáticas e aumento de ticket médio." },
      { value: "RELATORIOS", label: "Relatórios Consolidados", icon: "📊", description: "Vendas, visitas, planos e sessões unificadas da rede." },
    ],
  },
  {
    id: "comercial",
    label: "Comercial & Vendas",
    icon: "🏷️",
    badge: "Receita",
    description: "Engenharia de preços, catálogo de produtos, pacotes VIP e fidelidade",
    items: [
      { value: "PLANOS", label: "Planos de Preços", icon: "🎟️", description: "Cadastre planos e defina valores e vigência por unidade." },
      { value: "PACOTES", label: "Pacotes VIP", icon: "🎁", tag: "Ticket Alto", description: "Catálogo de pacotes de horas oferecidos como upgrade VIP." },
      { value: "PRODUTOS", label: "Produtos & Bar", icon: "🍿", description: "Itens vendidos avulsos no PDV e controle de estoque por loja." },
      { value: "CUPONS", label: "Cupons & Descontos", icon: "🎟️", description: "Códigos de desconto e campanhas de parceiros." },
      { value: "FIDELIDADE", label: "Programa Fidelidade", icon: "⭐", description: "Recompensas automáticas para encantar e reter clientes recorrentes." },
      { value: "CONTRATO", label: "Modelo de Contrato", icon: "📄", description: "Contrato impresso para prestação de serviços em planos de 2h+." },
    ],
  },
  {
    id: "financeiro_metas",
    label: "Metas & Financeiro",
    icon: "💰",
    badge: "Desempenho",
    description: "Aceleração de vendas diárias, bonificação da equipe e folha de pagamento",
    items: [
      { value: "METAS", label: "Metas Diárias", icon: "🎯", tag: "Bônus", description: "Regras de aceleradores de faturamento para comissionamento." },
      { value: "BONIFICACAO", label: "Extrato de Bonificação", icon: "💵", description: "Saldo mensal de bonificação por operador com teto de R$200." },
      { value: "FOLHA", label: "Folha de Pagamento", icon: "📄", description: "Extrato mensal de salários, dados bancários e exportação Bradesco." },
    ],
  },
  {
    id: "pessoas",
    label: "Equipe & Clientes",
    icon: "👥",
    badge: "RH & CRM",
    description: "Gestão da equipe, controle legal de ponto, recrutamento e clientes",
    items: [
      { value: "COLABORADORES", label: "Equipe & Operadores", icon: "👤", description: "Cadastro unificado da equipe e permissões por unidade." },
      { value: "CLIENTES", label: "Base de Clientes", icon: "🧑‍🤝‍🧑", description: "Consulta e histórico centralizado de responsáveis e crianças da rede." },
      { value: "CRM_WHATSAPP", label: "CRM WhatsApp", icon: "💬", tag: "Novo", description: "Conversas e funil de clientes do Playground e do Circuito pelo WhatsApp." },
      { value: "RELATORIOS_SESSAO", label: "Olhar FaçaAmigos", icon: "📝", tag: "Novo", description: "Mapa de observação de cada visita de 1h+, quem preencheu, prazo de 40 min e a mensagem enviada ao responsável." },
      { value: "PERMISSOES", label: "Permissões de Acesso", icon: "🔒", description: "Nível de acesso (Operador, Líder ou Owner) exigido por ação." },
    ],
  },
  {
    id: "caixa_operacoes",
    label: "Caixa & Auditoria",
    icon: "🛡️",
    badge: "Segurança",
    description: "Conferência de sangrias, livro de turnos e rastreabilidade financeira",
    items: [
      { value: "ABERTURA_FECHAMENTO", label: "Abertura & Fechamento", icon: "🔑", description: "Horários de caixa, responsável e troco inicial por loja." },
      { value: "PASSAGEM_TURNO", label: "Passagem de Turno", icon: "📖", description: "Livro de registro diário repassado entre operadores de turno." },
      { value: "SALDO_ENVELOPES", label: "Saldo em Envelopes", icon: "✉️", description: "Acompanhamento do dinheiro retido em sangrias nos cofres." },
      { value: "FOTOS_ENVELOPE", label: "Fotos de Sangria", icon: "📸", description: "Comprovantes visuais das sangrias registradas nos PDVs." },
      { value: "HISTORICO", label: "Fluxograma de Caixa", icon: "🔄", description: "Rastreabilidade do fluxo de caixa e movimentação por turno." },
      { value: "AUDITORIA", label: "Log de Auditoria", icon: "🛡️", description: "Histórico de ações sensíveis, logins e alterações de dados." },
      { value: "BOBINAS", label: "Bobinas de Cupom", icon: "🧻", tag: "Novo", description: "Consumo de papel térmico por unidade, previsão de término e troca de bobina." },
    ],
  },
];

// Mapeamento rápido de item -> categoria
const ITEM_TO_CATEGORY: Record<GerencialTab, string> = CATEGORIES.reduce((acc, cat) => {
  cat.items.forEach((item) => {
    acc[item.value] = cat.id;
  });
  return acc;
}, {} as Record<GerencialTab, string>);

const ALL_ITEMS: (ModuleItem & { categoryLabel: string })[] = CATEGORIES.flatMap((cat) =>
  cat.items.map((item) => ({ ...item, categoryLabel: cat.label }))
);

export function GerencialApp({ onExit, onLogout }: { onExit: () => void; onLogout: () => void | Promise<void> }) {
  const { employee } = useAppState();
  const [tab, setTab] = useState<GerencialTab>("COPILOT_IA");
  const [activeCategory, setActiveCategory] = useState<string>(() => ITEM_TO_CATEGORY["COPILOT_IA"] || "visao_geral");
  const [searchQuery, setSearchQuery] = useState("");

  const handleSelectTab = (newTab: GerencialTab) => {
    setTab(newTab);
    const catId = ITEM_TO_CATEGORY[newTab] || "visao_geral";
    setActiveCategory(catId);
  };

  const handleSelectCategory = (catId: string) => {
    setActiveCategory(catId);
    const cat = CATEGORIES.find((c) => c.id === catId);
    if (cat && cat.items.length > 0) {
      const currentItemInCat = cat.items.find((i) => i.value === tab);
      if (!currentItemInCat) {
        const first = cat.items[0];
        if (first) {
          setTab(first.value);
        }
      }
    }
  };

  const currentCategory: ModuleCategory = useMemo(() => {
    const found = CATEGORIES.find((c) => c.id === activeCategory);
    return found ? found : (CATEGORIES[0] as ModuleCategory);
  }, [activeCategory]);

  const currentItem: ModuleItem = useMemo(() => {
    const found = ALL_ITEMS.find((i) => i.value === tab);
    return found ? found : (ALL_ITEMS[0] as ModuleItem);
  }, [tab]);

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase().trim();
    return ALL_ITEMS.filter(
      (item) => item.label.toLowerCase().includes(q) || item.description.toLowerCase().includes(q) || item.categoryLabel.toLowerCase().includes(q)
    );
  }, [searchQuery]);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--background-default, #f8fafc)" }}>
      <div style={{ flexShrink: 0, height: "3px", background: "linear-gradient(90deg, #6366f1 0%, #3b82f6 50%, #10b981 100%)" }} />

      {/* Header Desktop Full Width */}
      <header
        style={{
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: "12px",
          padding: "6px 20px",
          borderBottom: "1px solid var(--border-subtle, #e2e8f0)",
          background: "var(--surface-card, #ffffff)",
          flexWrap: "wrap",
          boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
        }}
      >
        <BrandLockup operation="Gerencial" accent="var(--color-primary)" size="sm" title="🗂️ Painel Gerencial" />

        {/* Omnibox Busca Rápida */}
        <div style={{ position: "relative", minWidth: "280px", maxWidth: "420px", flex: 1, margin: "0 8px" }}>
          <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
            <span style={{ position: "absolute", left: "12px", color: "var(--text-secondary, #64748b)", fontSize: "14px" }}>🔎</span>
            <input
              type="text"
              placeholder="Buscar menu gerencial... (ex: Ponto, Zoe, Planos, Bonificação)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: "100%",
                padding: "5px 12px 5px 36px",
                fontSize: "13px",
                borderRadius: "8px",
                border: "1px solid var(--border-subtle, #cbd5e1)",
                background: "var(--surface-input, #f1f5f9)",
                outline: "none",
                transition: "all 0.2s ease",
              }}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                style={{
                  position: "absolute",
                  right: "10px",
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  color: "#64748b",
                  fontSize: "12px",
                }}
              >
                ✕
              </button>
            )}
          </div>

          {/* Popup Resultados de Busca */}
          {searchResults.length > 0 && (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 6px)",
                left: 0,
                right: 0,
                maxHeight: "320px",
                overflowY: "auto",
                background: "#ffffff",
                border: "1px solid #cbd5e1",
                borderRadius: "10px",
                boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.15)",
                zIndex: 1000,
                padding: "6px",
              }}
            >
              <div style={{ padding: "6px 10px", fontSize: "11px", fontWeight: "bold", color: "#64748b", textTransform: "uppercase" }}>
                {searchResults.length} módulo(s) encontrado(s)
              </div>
              {searchResults.map((res) => (
                <div
                  key={res.value}
                  onClick={() => {
                    handleSelectTab(res.value);
                    setSearchQuery("");
                  }}
                  style={{
                    padding: "8px 12px",
                    borderRadius: "6px",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    background: tab === res.value ? "#eff6ff" : "transparent",
                    transition: "background 0.15s",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#f1f5f9")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = tab === res.value ? "#eff6ff" : "transparent")}
                >
                  <span style={{ fontSize: "18px" }}>{res.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "13px", fontWeight: 600, color: "#0f172a" }}>{res.label}</div>
                    <div style={{ fontSize: "11px", color: "#64748b", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
                      {res.categoryLabel} · {res.description}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "12px" }}>
          {employee && (
            <span style={{ fontSize: "13px", color: "var(--text-secondary, #475569)", fontWeight: 600 }}>
              {employee.full_name} · <span style={{ color: "#3b82f6" }}>{ROLE_LABEL[employee.role]}</span>
            </span>
          )}
          <Button variant="ghost" size="sm" onClick={onExit} style={{ fontSize: "12px", border: "1px solid var(--border-subtle, #cbd5e1)" }}>
            Sair do Gerencial
          </Button>
          <Button variant="ghost" size="sm" onClick={onLogout} style={{ fontSize: "12px", border: "1px solid var(--border-subtle, #cbd5e1)" }}>
            Sair
          </Button>
        </div>
      </header>

      {/* Navegação compacta e fixa: só o conteúdo rola */}
      <RequireCapability capability="config.write">
        <nav
          aria-label="Menu gerencial"
          style={{
            flexShrink: 0,
            padding: "8px 20px 0",
            background: "var(--surface-card, #ffffff)",
            borderBottom: "1px solid var(--border-subtle, #e2e8f0)",
          }}
        >
          {/* Categorias: uma linha de abas */}
          <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
            {CATEGORIES.map((cat) => {
              const isActive = activeCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => handleSelectCategory(cat.id)}
                  title={`${cat.description} (${cat.items.length} itens)`}
                  aria-pressed={isActive}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "6px 14px",
                    fontSize: "13px",
                    fontWeight: isActive ? 700 : 500,
                    border: "none",
                    borderBottom: isActive ? "3px solid #3b82f6" : "3px solid transparent",
                    background: "transparent",
                    color: isActive ? "#1e40af" : "var(--text-secondary, #475569)",
                    cursor: "pointer",
                  }}
                >
                  <span>{cat.icon}</span>
                  <span>{cat.label}</span>
                </button>
              );
            })}
          </div>

          {/* Sub-itens da categoria ativa */}
          <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap", padding: "8px 0" }}>
            {currentCategory.items.map((subItem) => {
              const isSelected = tab === subItem.value;
              return (
                <button
                  key={subItem.value}
                  type="button"
                  onClick={() => handleSelectTab(subItem.value)}
                  title={subItem.description}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "5px",
                    padding: "4px 10px",
                    borderRadius: "6px",
                    fontSize: "12px",
                    fontWeight: isSelected ? 700 : 500,
                    border: isSelected ? "1px solid #3b82f6" : "1px solid var(--border-subtle, #cbd5e1)",
                    background: isSelected ? "#3b82f6" : "var(--surface-input, #f8fafc)",
                    color: isSelected ? "#ffffff" : "var(--text-primary, #334155)",
                    cursor: "pointer",
                  }}
                >
                  <span>{subItem.icon}</span>
                  <span>{subItem.label}</span>
                  {subItem.tag && (
                    <span
                      style={{
                        fontSize: "9px",
                        padding: "0 4px",
                        borderRadius: "4px",
                        background: isSelected ? "rgba(255,255,255,0.25)" : "#e2e8f0",
                        color: isSelected ? "#ffffff" : "#475569",
                        fontWeight: 700,
                      }}
                    >
                      {subItem.tag}
                    </span>
                  )}
                </button>
              );
            })}
            {/* Descrição da aba ativa na mesma linha, em vez de uma faixa própria */}
            <span
              style={{
                marginLeft: "8px",
                flex: "1 1 240px",
                minWidth: 0,
                fontSize: "11px",
                color: "var(--text-secondary, #64748b)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={currentItem.description}
            >
              {currentItem.description}
            </span>
          </div>
        </nav>

        <main style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column" }}>
          <div className="gerencial-shell" style={{ width: "100%", padding: "12px 20px 16px", margin: "0 auto", boxSizing: "border-box" }}>
            {/* ÁREA DE CONTEÚDO EXPANDIDA (DESKTOP FULL WIDTH) */}
            <div role="tabpanel" style={{ width: "100%", flex: 1 }}>
              {tab === "ACOMPANHAMENTO_OWNER" && <OwnerAcompanhamentoTab />}
              {tab === "NPS_DASHBOARD" && <NpsDashboardTab />}
              {tab === "COPILOT_IA" && <GeminiGerencialCopilot />}
              {tab === "PLANOS" && <PlanosTab />}
              {tab === "PACOTES" && <PacotesTab />}
              {tab === "PRODUTOS" && <ProdutosTab />}
              {tab === "CUPONS" && <CuponsTab />}
              {tab === "FIDELIDADE" && <FidelidadeTab />}
              {tab === "METAS" && <MetasTab />}
              {tab === "COLABORADORES" && <ColaboradoresTab />}
              {tab === "FREQUENCIA" && <FrequenciaTab />}
              {tab === "OCORRENCIAS" && <OcorrenciasTab />}
              {tab === "PERMISSOES" && <PermissoesTab />}
              {tab === "CLIENTES" && <ClientesTab />}
              {tab === "CRM_WHATSAPP" && <CrmWhatsappTab />}
              {tab === "RELATORIOS_SESSAO" && <RelatoriosSessaoTab />}
              {tab === "TALENTOS" && <BancoTalentosTab />}
              {tab === "FOLHA" && <FolhaPagamentoTab />}
              {tab === "BONIFICACAO" && <BonificacaoTab />}
              {tab === "RELATORIOS" && <GerencialRelatorioTab />}
              {tab === "ABERTURA_FECHAMENTO" && <AberturaFechamentoTab />}
              {tab === "PASSAGEM_TURNO" && <PassagemTurnoTab />}
              {tab === "FOTOS_ENVELOPE" && <FotosEnvelopeTab />}
              {tab === "SALDO_ENVELOPES" && <SaldoEnvelopesTab />}
              {tab === "HISTORICO" && <HistoricoTab />}
              {tab === "AUDITORIA" && <AuditoriaTab />}
              {tab === "CONTRATO" && <ContratoTab />}
              {tab === "BOBINAS" && <BobinasTab />}
            </div>

          </div>
        </main>
      </RequireCapability>
    </div>
  );
}


