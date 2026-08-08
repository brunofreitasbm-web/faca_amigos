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
import { GerencialRelatorioTab } from "./tabs/GerencialRelatorioTab.js";
import { FolhaPagamentoTab } from "./tabs/FolhaPagamentoTab.js";
import { AberturaFechamentoTab } from "./tabs/AberturaFechamentoTab.js";
import { FotosEnvelopeTab } from "./tabs/FotosEnvelopeTab.js";
import { SaldoCaixaTab } from "./tabs/SaldoCaixaTab.js";
import { HistoricoTab } from "./tabs/HistoricoTab.js";

type GerencialTab = "PLANOS" | "PACOTES" | "PRODUTOS" | "CUPONS" | "FIDELIDADE" | "METAS" | "COLABORADORES" | "RELATORIOS" | "FOLHA" | "ABERTURA_FECHAMENTO" | "FOTOS_ENVELOPE" | "SALDO_CAIXA" | "HISTORICO";

const TABS: { value: GerencialTab; label: string }[] = [
  { value: "PLANOS", label: "Planos de Preços" },
  { value: "PACOTES", label: "Pacotes" },
  { value: "PRODUTOS", label: "Produtos" },
  { value: "CUPONS", label: "Cupons" },
  { value: "FIDELIDADE", label: "Fidelidade" },
  { value: "METAS", label: "Metas" },
  { value: "COLABORADORES", label: "Colaboradores" },
  { value: "FOLHA", label: "Folha de Pagamento" },
  { value: "RELATORIOS", label: "Relatórios" },
  { value: "ABERTURA_FECHAMENTO", label: "Abertura e Fechamento" },
  { value: "FOTOS_ENVELOPE", label: "Fotos de Envelope" },
  { value: "SALDO_CAIXA", label: "Saldo em Caixa" },
  { value: "HISTORICO", label: "Histórico" },
];

const TAB_HELP: Record<GerencialTab, string> = {
  PLANOS: "Cadastre um plano e escolha em quais unidades ele vale — cada unidade marcada vira sua própria linha, editável depois de forma independente.",
  PACOTES: "Catálogo de pacotes de horas oferecidos como upgrade VIP. Regras do motor VIP continuam em Configurações, dentro de cada unidade.",
  PRODUTOS: "Itens vendidos avulsos no PDV — cadastre uma vez e escolha em quais unidades o produto e o estoque existem.",
  CUPONS: "Códigos de desconto ou parceria. O mesmo código pode existir em mais de uma unidade.",
  FIDELIDADE: "Recompensas automáticas para clientes recorrentes.",
  METAS: "Regras de bonificação da equipe quando a meta diária é batida. Meta de faturamento e horário de fechamento continuam por unidade, em Configurações.",
  COLABORADORES: "Cadastro único de toda a equipe — escolha em qual(is) unidade(s) cada colaborador atua.",
  FOLHA: "Extrato mensal de salários, dados bancários e fechamento da folha para conferência e exportação/Bradesco.",
  RELATORIOS: "Vendas, visitas, planos e sessões das 3 unidades juntas, ou filtradas por uma só.",
  ABERTURA_FECHAMENTO: "Horário de abertura e fechamento do caixa de cada loja, quem abriu/fechou e o troco inicial.",
  FOTOS_ENVELOPE: "Fotos dos envelopes de sangria registrados em cada loja, com valor e operador responsável.",
  SALDO_CAIXA: "Quanto dinheiro físico tem na gaveta de cada loja neste momento.",
  HISTORICO: "Fluxograma visual de onde o dinheiro do turno veio e para onde foi, para facilitar a conferência.",
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
          <div style={{ padding: "24px", maxWidth: "900px", margin: "0 auto" }}>
            <h1 style={{ fontFamily: "var(--font-display)" }}>Gerencial</h1>
            <HelpText>
              Configurações macro, fora das 3 unidades — o que é cadastrado aqui aparece nas unidades escolhidas.
            </HelpText>
            <Tabs value={tab} onChange={setTab} tabs={TABS} />
            <HelpText style={{ margin: "12px 0" }}>{TAB_HELP[tab]}</HelpText>

            <div role="tabpanel">
              {tab === "PLANOS" && <PlanosTab />}
              {tab === "PACOTES" && <PacotesTab />}
              {tab === "PRODUTOS" && <ProdutosTab />}
              {tab === "CUPONS" && <CuponsTab />}
              {tab === "FIDELIDADE" && <FidelidadeTab />}
              {tab === "METAS" && <MetasTab />}
              {tab === "COLABORADORES" && <ColaboradoresTab />}
              {tab === "FOLHA" && <FolhaPagamentoTab />}
              {tab === "RELATORIOS" && <GerencialRelatorioTab />}
              {tab === "ABERTURA_FECHAMENTO" && <AberturaFechamentoTab />}
              {tab === "FOTOS_ENVELOPE" && <FotosEnvelopeTab />}
              {tab === "SALDO_CAIXA" && <SaldoCaixaTab />}
              {tab === "HISTORICO" && <HistoricoTab />}
            </div>
          </div>
        </RequireCapability>
      </main>
    </div>
  );
}

