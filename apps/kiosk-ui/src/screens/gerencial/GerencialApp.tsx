import { useState } from "react";
import { Button, BrandLockup, HelpText, Tabs } from "@facaamigos/ui";
import { useAppState } from "../../state/AppState.js";
import { useAuth } from "../../auth/AuthContext.js";
import { RequireCapability } from "../../auth/RequireCapability.js";
import { ROLE_LABEL, type Capability } from "../../auth/capabilities.js";
import { PlanosTab } from "./tabs/PlanosTab.js";
import { PacotesTab } from "./tabs/PacotesTab.js";
import { ProdutosTab } from "./tabs/ProdutosTab.js";
import { CuponsTab } from "./tabs/CuponsTab.js";
import { FidelidadeTab } from "./tabs/FidelidadeTab.js";
import { MetasTab } from "./tabs/MetasTab.js";
import { ColaboradoresTab } from "./tabs/ColaboradoresTab.js";
import { OcorrenciasTab } from "./tabs/OcorrenciasTab.js";
import { FrequenciaTab } from "./tabs/FrequenciaTab.js";
import { PermissoesTab } from "./tabs/PermissoesTab.js";
import { GerencialRelatorioTab } from "./tabs/GerencialRelatorioTab.js";
import { FolhaPagamentoTab } from "./tabs/FolhaPagamentoTab.js";
import { AberturaFechamentoTab } from "./tabs/AberturaFechamentoTab.js";
import { FotosEnvelopeTab } from "./tabs/FotosEnvelopeTab.js";
import { SaldoEnvelopesTab } from "./tabs/SaldoEnvelopesTab.js";
import { HistoricoTab } from "./tabs/HistoricoTab.js";
import { AuditoriaTab } from "./tabs/AuditoriaTab.js";
import { ContratoTab } from "./tabs/ContratoTab.js";
import { BancoTalentosTab } from "./tabs/BancoTalentosTab.js";
import { ClientesTab } from "./tabs/ClientesTab.js";
import { GeminiGerencialCopilot } from "../../components/GeminiGerencialCopilot.js";

type GerencialTab = "PLANOS" | "PACOTES" | "PRODUTOS" | "CUPONS" | "FIDELIDADE" | "METAS" | "COLABORADORES" | "FREQUENCIA" | "OCORRENCIAS" | "PERMISSOES" | "CLIENTES" | "RELATORIOS" | "FOLHA" | "ABERTURA_FECHAMENTO" | "FOTOS_ENVELOPE" | "SALDO_ENVELOPES" | "HISTORICO" | "AUDITORIA" | "CONTRATO" | "TALENTOS" | "COPILOT_IA";

/**
 * Capacidade exigida por aba — mesmo padrão de auth/screens.ts e da aba
 * TAB_CAPABILITY de ConfiguracoesScreen.tsx: `Record<GerencialTab, ...>`
 * quebra o build se uma aba nova nascer sem declarar o que exige.
 *
 * Todas exigem `config.write` (Owner) exceto Relatórios: o Líder já lê
 * relatório por unidade (`relatorio.read`, tela Relatório do balcão) —
 * fica igualmente aberto a ele o mesmo relatório agregado das 3 unidades
 * aqui dentro do Gerencial, sem herdar o resto do console (preço,
 * colaborador, folha etc.), que continua exclusividade do Owner.
 */
const TAB_CAPABILITY: Record<GerencialTab, Capability> = {
  COPILOT_IA: "config.write",
  PLANOS: "config.write",
  PACOTES: "config.write",
  PRODUTOS: "config.write",
  CUPONS: "config.write",
  FIDELIDADE: "config.write",
  METAS: "config.write",
  COLABORADORES: "config.write",
  FREQUENCIA: "config.write",
  OCORRENCIAS: "config.write",
  PERMISSOES: "config.write",
  CLIENTES: "config.write",
  TALENTOS: "config.write",
  FOLHA: "config.write",
  RELATORIOS: "relatorio.read",
  ABERTURA_FECHAMENTO: "config.write",
  FOTOS_ENVELOPE: "config.write",
  SALDO_ENVELOPES: "config.write",
  HISTORICO: "config.write",
  AUDITORIA: "config.write",
  CONTRATO: "config.write",
};

const TABS: { value: GerencialTab; label: string }[] = [
  { value: "COPILOT_IA", label: "✦ ZoeIA (Copilot)" },
  { value: "PLANOS", label: "Planos de Preços" },
  { value: "PACOTES", label: "Pacotes" },
  { value: "PRODUTOS", label: "Produtos" },
  { value: "CUPONS", label: "Cupons" },
  { value: "FIDELIDADE", label: "Fidelidade" },
  { value: "METAS", label: "Metas" },
  { value: "COLABORADORES", label: "Colaboradores" },
  { value: "FREQUENCIA", label: "Controle de Frequência" },
  { value: "OCORRENCIAS", label: "Ocorrências" },
  { value: "PERMISSOES", label: "Permissões" },
  { value: "CLIENTES", label: "Clientes" },
  { value: "TALENTOS", label: "Banco de Talentos" },
  { value: "FOLHA", label: "Folha de Pagamento" },
  { value: "RELATORIOS", label: "Relatórios" },
  { value: "ABERTURA_FECHAMENTO", label: "Abertura e Fechamento" },
  { value: "FOTOS_ENVELOPE", label: "Fotos de Envelope" },
  { value: "SALDO_ENVELOPES", label: "Saldo em Envelopes" },
  { value: "HISTORICO", label: "Histórico" },
  { value: "AUDITORIA", label: "Auditoria" },
  { value: "CONTRATO", label: "Contrato (Planos 2h+)" },
];

const TAB_HELP: Record<GerencialTab, string> = {
  COPILOT_IA: "ZoeIA: assistente comercial humana para sugestões automáticas de vendas, aumento de ticket médio e consultoria gerencial em tempo real.",
  PLANOS: "Cadastre um plano e escolha em quais unidades ele vale — cada unidade marcada vira sua própria linha, editável depois de forma independente.",
  PACOTES: "Catálogo de pacotes de horas oferecidos como upgrade VIP. Regras do motor VIP continuam em Configurações, dentro de cada unidade.",
  PRODUTOS: "Itens vendidos avulsos no PDV — cadastre uma vez e escolha em quais unidades o produto e o estoque existem.",
  CUPONS: "Códigos de desconto ou parceria. O mesmo código pode existir em mais de uma unidade.",
  FIDELIDADE: "Recompensas automáticas para clientes recorrentes.",
  METAS: "Regras de bonificação da equipe quando a meta diária é batida. Meta de faturamento e horário de fechamento continuam por unidade, em Configurações.",
  COLABORADORES: "Cadastro único de toda a equipe — escolha em qual(is) unidade(s) cada colaborador atua.",
  FREQUENCIA: "Marcações de ponto ao vivo (CLT e Estagiários), com foto da marcação e resumo de horas do período — o dia a dia, separado da Folha de Ponto mensal em Relatórios.",
  OCORRENCIAS: "Atestados e faltas lançados pelo RH, com anexo — separado do Ponto, que é a marcação legal batida pelo próprio colaborador.",
  PERMISSOES: "Escolha o nível mínimo de acesso (Operador, Líder ou Owner) exigido para cada ação do sistema.",
  CLIENTES: "Base de dados unificada de responsáveis e crianças cadastradas em todas as unidades da rede — consulte histórico de visitas, CPF e contatos.",
  TALENTOS: "Candidaturas recebidas pelo formulário \"Venha Fazer Parte do Nosso Time\" da landing page — analise o currículo e atualize o status conforme a triagem avança.",
  FOLHA: "Extrato mensal de salários, dados bancários e fechamento da folha para conferência e exportação/Bradesco.",
  RELATORIOS: "Vendas, visitas, planos e sessões das 3 unidades juntas, ou filtradas por uma só.",
  ABERTURA_FECHAMENTO: "Horário de abertura e fechamento do caixa de cada loja, quem abriu/fechou e o troco inicial.",
  FOTOS_ENVELOPE: "Fotos dos envelopes de sangria registrados em cada loja, com valor e operador responsável.",
  SALDO_ENVELOPES: "Quanto cada loja tem guardado em envelopes de sangria ainda não recolhidos, e o que há na gaveta agora.",
  HISTORICO: "Fluxograma visual de onde o dinheiro do turno veio e para onde foi, para facilitar a conferência.",
  AUDITORIA: "Quem fez o quê, quando: log de ações sensíveis do sistema (login, alteração de colaborador, dados fiscais, unidades) para conferência e apuração.",
  CONTRATO: "Modelo do contrato de prestação de serviços dos planos acima de 2h (banco de horas), impresso em A4 na Entrada com timbre da unidade.",
};


export function GerencialApp({ onExit, onLogout }: { onExit: () => void; onLogout: () => void | Promise<void> }) {
  const { employee } = useAppState();
  const { can } = useAuth();
  const [tab, setTab] = useState<GerencialTab>("PLANOS");
  const canFull = can("config.write");

  // Só as abas que este colaborador enxerga — e nunca a "Planos" default
  // de quem entrou sem config.write, que cairia direto num "Área restrita".
  const tabs = TABS.filter((t) => can(TAB_CAPABILITY[t.value]));
  const activeTab = tabs.some((t) => t.value === tab) ? tab : (tabs[0]?.value ?? tab);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ flexShrink: 0, height: "3px", background: "var(--color-primary)" }} />

      <header
        style={{
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: "16px",
          padding: "10px 24px",
          borderBottom: "1px solid var(--border-subtle)",
          background: "var(--surface-card)",
          flexWrap: "wrap",
        }}
      >
        <BrandLockup operation="Gerencial" accent="var(--color-primary)" size="sm" title="🗂️ Gerencial" />

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "12px" }}>
          {employee && (
            <span style={{ fontSize: "13px", color: "var(--text-secondary)", fontWeight: "var(--weight-semibold)" as unknown as number }}>
              {employee.full_name} · {ROLE_LABEL[employee.role]}
            </span>
          )}
          <Button variant="ghost" size="sm" onClick={onExit} style={{ fontSize: "12px", border: "1px solid var(--border-subtle)" }}>
            Sair do Gerencial
          </Button>
          <Button variant="ghost" size="sm" onClick={onLogout} style={{ fontSize: "12px", border: "1px solid var(--border-subtle)" }}>
            Sair
          </Button>
        </div>
      </header>

      <main style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        <RequireCapability capability={["config.write", "relatorio.read"]}>
          <div className="gerencial-shell" style={{ padding: "24px", maxWidth: "1100px", margin: "0 auto" }}>
            <h1 style={{ fontFamily: "var(--font-display)" }}>Gerencial</h1>
            <HelpText>
              {canFull
                ? "Configurações macro, fora das 3 unidades — o que é cadastrado aqui aparece nas unidades escolhidas."
                : "Relatórios das 3 unidades juntas, ou filtrados por uma só. O restante do Gerencial (preço, cadastro, folha) é exclusivo do Owner."}
            </HelpText>

            <div className="gerencial-body">
              <div className="gerencial-tabs-col">
                <Tabs value={activeTab} onChange={setTab} tabs={tabs} />
              </div>

              <div className="gerencial-content-col">
                <HelpText style={{ margin: "12px 0" }}>{TAB_HELP[activeTab]}</HelpText>

                <div role="tabpanel">
                  {/* Guardado de novo aqui dentro (não só a lista de abas
                      acima): estado residual de `tab` não deve bastar para
                      renderizar conteúdo de uma capacidade que o colaborador
                      não tem. */}
                  <RequireCapability capability={TAB_CAPABILITY[activeTab]}>
                    {activeTab === "COPILOT_IA" && <GeminiGerencialCopilot />}
                    {activeTab === "PLANOS" && <PlanosTab />}
                    {activeTab === "PACOTES" && <PacotesTab />}
                    {activeTab === "PRODUTOS" && <ProdutosTab />}
                    {activeTab === "CUPONS" && <CuponsTab />}
                    {activeTab === "FIDELIDADE" && <FidelidadeTab />}
                    {activeTab === "METAS" && <MetasTab />}
                    {activeTab === "COLABORADORES" && <ColaboradoresTab />}
                    {activeTab === "FREQUENCIA" && <FrequenciaTab />}
                    {activeTab === "OCORRENCIAS" && <OcorrenciasTab />}
                    {activeTab === "PERMISSOES" && <PermissoesTab />}
                    {activeTab === "CLIENTES" && <ClientesTab />}
                    {activeTab === "TALENTOS" && <BancoTalentosTab />}
                    {activeTab === "FOLHA" && <FolhaPagamentoTab />}
                    {activeTab === "RELATORIOS" && <GerencialRelatorioTab />}
                    {activeTab === "ABERTURA_FECHAMENTO" && <AberturaFechamentoTab />}
                    {activeTab === "FOTOS_ENVELOPE" && <FotosEnvelopeTab />}
                    {activeTab === "SALDO_ENVELOPES" && <SaldoEnvelopesTab />}
                    {activeTab === "HISTORICO" && <HistoricoTab />}
                    {activeTab === "AUDITORIA" && <AuditoriaTab />}
                    {activeTab === "CONTRATO" && <ContratoTab />}
                  </RequireCapability>
                </div>
              </div>
            </div>
          </div>
        </RequireCapability>
      </main>
    </div>
  );
}

