import { useState } from "react";
import type { ReactElement } from "react";
import { Button, Badge } from "@facaamigos/ui";
import { useAppState } from "./state/AppState.js";
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
  { value: "ENTRADA", label: "Entrada" },
  { value: "PAINEL", label: "Painel" },
  { value: "PDV", label: "PDV" },
  { value: "CAIXA", label: "Caixa" },
  { value: "PONTO", label: "Ponto" },
  { value: "RELATORIO", label: "Relatório" },
  { value: "CONFIGURACOES", label: "Configurações" },
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
  const [screen, setScreen] = useState<Screen>("ENTRADA");

  if (!employee) return <LoginScreen />;

  // Se nenhuma operação/módulo foi selecionado ainda, exibe a Tela Inicial de Seleção de Módulo
  if (!unit) {
    return <SelectModuleScreen />;
  }

  const ScreenComponent = SCREEN_COMPONENTS[screen];

  let unitIcon = "📍";
  const lowerName = unit.name.toLowerCase();
  if (lowerName.includes("playground")) unitIcon = "🏰";
  else if (lowerName.includes("circuito")) unitIcon = "🏎️";
  else if (lowerName.includes("grão") || lowerName.includes("grao")) unitIcon = "🌳";

  return (
    <div>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: "16px",
          padding: "12px 24px",
          borderBottom: "1px solid var(--border-subtle)",
          background: "var(--surface-card)",
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <strong style={{ fontFamily: "var(--font-display)", fontSize: "18px", color: "var(--color-primary)" }}>
            FaçaAmigos
          </strong>

          {/* Badge de Identificação Única do Módulo Ativo */}
          <Badge variant="teal" style={{ fontSize: "13px", padding: "6px 12px" }}>
            {unitIcon} {unit.name}
          </Badge>
        </div>

        <nav style={{ display: "flex", gap: "4px", flexWrap: "wrap", marginLeft: "12px" }}>
          {SCREENS.map((s) => (
            <Button
              key={s.value}
              variant={screen === s.value ? "teal" : "ghost"}
              size="sm"
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
            onClick={() => setUnitId("")}
            title="Alternar para a tela inicial de seleção de módulos"
            style={{ fontSize: "12px", border: "1px solid var(--border-subtle)" }}
          >
            🔄 Trocar Módulo
          </Button>
        </div>
      </header>

      <main>
        <ScreenComponent />
      </main>
    </div>
  );
}

