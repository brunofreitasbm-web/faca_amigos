import { useState, useMemo } from "react";
import { Button, BrandLockup, HelpText } from "@facaamigos/ui";
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
import { BancoTalentosTab } from "./tabs/BancoTalentosTab.js";
import { ClientesTab } from "./tabs/ClientesTab.js";
import { CrmWhatsappTab } from "./tabs/CrmWhatsappTab.js";
import { RelatoriosSessaoTab } from "./tabs/RelatoriosSessaoTab.js";
import { OwnerAcompanhamentoTab } from "./tabs/OwnerAcompanhamentoTab.js";
import { GeminiGerencialCopilot } from "../../components/GeminiGerencialCopilot.js";

export type GerencialTab =
  | "ACOMPANHAMENTO_OWNER"
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
      { value: "ACOMPANHAMENTO_OWNER", label: "Visão Geral Owner", icon: "👑", tag: "Ao Vivo", description: "Monitoramento em tempo real do faturamento vs meta, sessões ativas e NPS." },
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
      { value: "FREQUENCIA", label: "Ponto & Frequência", icon: "⏱️", tag: "Ao Vivo", description: "Marcação legal de ponto com foto em tempo real para CLT e Estagiários." },
      { value: "OCORRENCIAS", label: "Atestados & Ocorrências", icon: "📋", description: "Lançamento de atestados médicos, faltas e justificativas do RH." },
      { value: "TALENTOS", label: "Banco de Talentos", icon: "💼", description: "Triagem de currículos recebidos na landing page do site." },
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
  const [tab, setTab] = useState<GerencialTab>("ACOMPANHAMENTO_OWNER");
  const [activeCategory, setActiveCategory] = useState<string>(() => ITEM_TO_CATEGORY["ACOMPANHAMENTO_OWNER"] || "visao_geral");
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
      <div style={{ flexShrink: 0, height: "4px", background: "linear-gradient(90deg, #6366f1 0%, #3b82f6 50%, #10b981 100%)" }} />

      {/* Header Desktop Full Width */}
      <header
        style={{
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: "16px",
          padding: "12px 32px",
          borderBottom: "1px solid var(--border-subtle, #e2e8f0)",
          background: "var(--surface-card, #ffffff)",
          flexWrap: "wrap",
          boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
        }}
      >
        <BrandLockup operation="Gerencial" accent="var(--color-primary)" size="sm" title="🗂️ Painel Gerencial" />

        {/* Omnibox Busca Rápida */}
        <div style={{ position: "relative", minWidth: "280px", maxWidth: "420px", flex: 1, margin: "0 16px" }}>
          <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
            <span style={{ position: "absolute", left: "12px", color: "var(--text-secondary, #64748b)", fontSize: "14px" }}>🔎</span>
            <input
              type="text"
              placeholder="Buscar menu gerencial... (ex: Ponto, Zoe, Planos, Bonificação)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: "100%",
                padding: "8px 12px 8px 36px",
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

      {/* Main Container Aproveitando Tela Inteira (Desktop Full Width) */}
      <main style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column" }}>
        <RequireCapability capability="config.write">
          <div className="gerencial-shell" style={{ width: "100%", padding: "20px 32px", margin: "0 auto", boxSizing: "border-box" }}>
            
            {/* Macro Categorias Principais (Top Navigation Cards) */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                gap: "12px",
                marginBottom: "20px",
              }}
            >
              {CATEGORIES.map((cat) => {
                const isActive = activeCategory === cat.id;
                const hasSelectedTab = cat.items.some((i) => i.value === tab);

                return (
                  <button
                    key={cat.id}
                    onClick={() => handleSelectCategory(cat.id)}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-start",
                      padding: "12px 16px",
                      borderRadius: "12px",
                      border: isActive ? "2px solid #3b82f6" : "1px solid var(--border-subtle, #e2e8f0)",
                      background: isActive
                        ? "linear-gradient(135deg, #ffffff 0%, #eff6ff 100%)"
                        : "var(--surface-card, #ffffff)",
                      boxShadow: isActive ? "0 4px 12px rgba(59, 130, 246, 0.15)" : "0 1px 3px rgba(0,0,0,0.02)",
                      cursor: "pointer",
                      textAlign: "left",
                      transition: "all 0.2s ease",
                      position: "relative",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", marginBottom: "6px" }}>
                      <span style={{ fontSize: "20px" }}>{cat.icon}</span>
                      {cat.badge && (
                        <span
                          style={{
                            fontSize: "10px",
                            fontWeight: 700,
                            padding: "2px 6px",
                            borderRadius: "10px",
                            background: isActive ? "#3b82f6" : "#f1f5f9",
                            color: isActive ? "#ffffff" : "#64748b",
                            textTransform: "uppercase",
                            letterSpacing: "0.05em",
                          }}
                        >
                          {cat.badge}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: "14px", fontWeight: 700, color: isActive ? "#1e40af" : "var(--text-primary, #0f172a)" }}>
                      {cat.label}
                    </div>
                    <div style={{ fontSize: "11px", color: "var(--text-secondary, #64748b)", marginTop: "2px" }}>
                      {cat.items.length} sub-módulos
                      {hasSelectedTab && !isActive && <span style={{ color: "#3b82f6", fontWeight: "bold" }}> • Ativo</span>}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Sub-Abas da Categoria Ativa (Horizontal Pills) */}
            <div
              style={{
                background: "var(--surface-card, #ffffff)",
                borderRadius: "12px",
                padding: "16px 20px",
                border: "1px solid var(--border-subtle, #e2e8f0)",
                boxShadow: "0 2px 8px rgba(0,0,0,0.03)",
                marginBottom: "20px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px", flexWrap: "wrap", gap: "8px" }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 700, display: "flex", alignItems: "center", gap: "8px", color: "#0f172a" }}>
                    <span>{currentCategory.icon}</span> {currentCategory.label}
                  </h3>
                  <p style={{ margin: "2px 0 0", fontSize: "12px", color: "#64748b" }}>{currentCategory.description}</p>
                </div>
              </div>

              {/* Sub-menu Pills list */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  flexWrap: "wrap",
                }}
              >
                {currentCategory.items.map((subItem) => {
                  const isSelected = tab === subItem.value;
                  return (
                    <button
                      key={subItem.value}
                      onClick={() => handleSelectTab(subItem.value)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        padding: "8px 14px",
                        borderRadius: "8px",
                        fontSize: "13px",
                        fontWeight: isSelected ? 700 : 500,
                        border: isSelected ? "1px solid #3b82f6" : "1px solid var(--border-subtle, #cbd5e1)",
                        background: isSelected ? "#3b82f6" : "var(--surface-input, #f8fafc)",
                        color: isSelected ? "#ffffff" : "var(--text-primary, #334155)",
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                        boxShadow: isSelected ? "0 2px 6px rgba(59, 130, 246, 0.3)" : "none",
                      }}
                    >
                      <span>{subItem.icon}</span>
                      <span>{subItem.label}</span>
                      {subItem.tag && (
                        <span
                          style={{
                            fontSize: "10px",
                            padding: "1px 5px",
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
              </div>
            </div>

            {/* Header da Aba Ativa & Dica Contextual */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "12px 18px",
                background: "linear-gradient(90deg, #f1f5f9 0%, #ffffff 100%)",
                borderRadius: "10px",
                borderLeft: "4px solid #3b82f6",
                marginBottom: "20px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <span style={{ fontSize: "22px" }}>{currentItem.icon}</span>
                <div>
                  <h2 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "#0f172a" }}>{currentItem.label}</h2>
                  <HelpText style={{ margin: 0, fontSize: "12px" }}>{currentItem.description}</HelpText>
                </div>
              </div>
            </div>

            {/* ÁREA DE CONTEÚDO EXPANDIDA (DESKTOP FULL WIDTH) */}
            <div role="tabpanel" style={{ width: "100%", flex: 1 }}>
              {tab === "ACOMPANHAMENTO_OWNER" && <OwnerAcompanhamentoTab />}
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
            </div>

          </div>
        </RequireCapability>
      </main>
    </div>
  );
}


