import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Button, BrandLockup } from "@facaamigos/ui";
import { unitBrandFor } from "./branding/unitBrand.js";
import { useAppState } from "./state/AppState.js";
import { useConfirm } from "./state/ConfirmContext.js";
import { LoginScreen } from "./screens/LoginScreen.js";
import { SelectModuleScreen } from "./screens/SelectModuleScreen.js";
import { EntradaScreen } from "./screens/EntradaScreen.js";
import { PainelScreen } from "./screens/PainelScreen.js";
import { PdvScreen } from "./screens/PdvScreen.js";
import { CaixaScreen } from "./screens/CaixaScreen.js";
import { PontoScreen } from "./screens/PontoScreen.js";
import { RelatorioScreen } from "./screens/RelatorioScreen.js";
import { ConfiguracoesScreen } from "./screens/ConfiguracoesScreen.js";

const SCREENS = [
  { value: "ENTRADA", label: "Entrada", help: "Cadastrar a chegada de uma criança: escolher o plano, identificar responsável e imprimir o comprovante" },
  { value: "PAINEL", label: "Painel", help: "Ver todas as crianças que estão no espaço agora, quanto tempo já ficaram e fechar o atendimento (cobrar) quando forem embora" },
  { value: "PDV", label: "PDV", help: "Vender produtos avulsos (loja/lanchonete), sem estar ligado a uma entrada" },
  { value: "CAIXA", label: "Caixa", help: "Abrir e fechar o turno de caixa, conferir o dinheiro e registrar sangria/suprimento" },
  { value: "PONTO", label: "Ponto", help: "Bater o ponto: registrar entrada, intervalo e saída do colaborador" },
  { value: "RELATORIO", label: "Relatório", help: "Consultar vendas, visitas, planos, movimentação de caixa e folha de ponto de períodos anteriores" },
  { value: "CONFIGURACOES", label: "Configurações", help: "Ajustar planos, produtos, cupons, metas, carrinhos, colaboradores e impressoras" },
] as const;

type Screen = (typeof SCREENS)[number]["value"];

const SCREEN_COMPONENTS: Record<Screen, () => ReactElement | null> = {
  ENTRADA: EntradaScreen,
  PAINEL: PainelScreen,
  PDV: PdvScreen,
  CAIXA: CaixaScreen,
  PONTO: PontoScreen,
  RELATORIO: RelatorioScreen,
  CONFIGURACOES: ConfiguracoesScreen,
};

export function App() {
  const { unit, setUnitId, employee } = useAppState();
  const confirm = useConfirm();
  const [screen, setScreen] = useState<Screen>("PAINEL");

  // Cada módulo/unidade selecionado sempre abre direto no Painel (tela principal do sistema).
  useEffect(() => {
    if (unit) setScreen("PAINEL");
  }, [unit?.id]);

  async function handleChangeModule() {
    const ok = await confirm({
      title: "Trocar módulo?",
      message: "Você vai sair da tela atual e voltar para a seleção de módulo.",
      confirmLabel: "Trocar módulo",
      cancelLabel: "Cancelar",
    });
    if (ok) setUnitId("");
  }

  if (!employee) return <LoginScreen />;

  // Se nenhuma operação/módulo foi selecionado ainda, exibe a Tela Inicial de Seleção de Módulo
  if (!unit) {
    return <SelectModuleScreen />;
  }

  const ScreenComponent = SCREEN_COMPONENTS[screen];
  const brand = unitBrandFor(unit.name);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Régua da operação: a faixa de cor mais persistente da tela, para
          o operador saber em que unidade está sem precisar ler nada. */}
      <div style={{ flexShrink: 0, height: "3px", background: brand.accent }} />

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
        <BrandLockup
          operation={brand.operation}
          accent={brand.accent}
          size="sm"
          title={`${brand.icon} ${unit.name}`}
        />

        <nav style={{ display: "flex", gap: "4px", flexWrap: "wrap", marginLeft: "12px" }}>
          {SCREENS.map((s) => (
            <Button
              key={s.value}
              variant={screen === s.value ? "teal" : "ghost"}
              size="sm"
              title={s.help}
              onClick={() => setScreen(s.value)}
            >
              {s.label}
            </Button>
          ))}
        </nav>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "12px" }}>
          <span style={{ fontSize: "13px", color: "var(--text-secondary)" }}>{employee.full_name}</span>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleChangeModule}
            title="Alternar para a tela inicial de seleção de módulos"
            style={{ fontSize: "12px", border: "1px solid var(--border-subtle)" }}
          >
            🔄 Trocar Módulo
          </Button>
        </div>
      </header>

      {/* flex:1 + minHeight:0 é o que faz o filho poder ser 100% de altura
          sem estourar o pai — sem minHeight:0 um flex item nunca encolhe
          abaixo do seu conteúdo, e a rolagem "vaza" pra página inteira. */}
      <main style={{ flex: 1, minHeight: 0 }}>
        <ScreenComponent />
      </main>
    </div>
  );
}

