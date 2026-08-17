import { useState } from "react";
import { Button, BrandLockup, HelpText, Tabs } from "@facaamigos/ui";
import { useAppState } from "../../state/AppState.js";
import { RequireCapability } from "../../auth/RequireCapability.js";
import { ROLE_LABEL } from "../../auth/capabilities.js";
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
  const [tab, setTab] = useState<GerencialTab>("PLANOS");

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
        <RequireCapability capability="config.write">
          <div className="gerencial-shell" style={{ padding: "24px", maxWidth: "1100px", margin: "0 auto" }}>
            <h1 style={{ fontFamily: "var(--font-display)" }}>Gerencial</h1>
            <HelpText>
              Configurações macro, fora das 3 unidades — o que é cadastrado aqui aparece nas unidades escolhidas.
            </HelpText>

            <div className="gerencial-body">
              <div className="gerencial-tabs-col">
                <Tabs value={tab} onChange={setTab} tabs={TABS} />
              </div>

              <div className="gerencial-content-col">
                <HelpText style={{ margin: "12px 0" }}>{TAB_HELP[tab]}</HelpText>

                <div role="tabpanel">
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
                  {tab === "TALENTOS" && <BancoTalentosTab />}
                  {tab === "FOLHA" && <FolhaPagamentoTab />}
                  {tab === "RELATORIOS" && <GerencialRelatorioTab />}
                  {tab === "ABERTURA_FECHAMENTO" && <AberturaFechamentoTab />}
                  {tab === "FOTOS_ENVELOPE" && <FotosEnvelopeTab />}
                  {tab === "SALDO_ENVELOPES" && <SaldoEnvelopesTab />}
                  {tab === "HISTORICO" && <HistoricoTab />}
                  {tab === "AUDITORIA" && <AuditoriaTab />}
                  {tab === "CONTRATO" && <ContratoTab />}
                </div>
              </div>
            </div>
          </div>
        </RequireCapability>
      </main>
    </div>
  );
}

