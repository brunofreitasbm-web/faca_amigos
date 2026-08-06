import { useState } from "react";
import type { ReactElement } from "react";
import { Button } from "@facaamigos/ui";
import { useAppState } from "./state/AppState.js";
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
  const { units, unit, setUnitId, employee } = useAppState();
  const [screen, setScreen] = useState<Screen>("ENTRADA");

  // Tela de login omitida por enquanto (pedido explícito) — AppState
  // já entra automaticamente com o primeiro colaborador cadastrado.
  if (!employee) return null;

  const ScreenComponent = SCREEN_COMPONENTS[screen];

  return (
    <div>
      <header style={{ display: "flex", alignItems: "center", gap: "16px", padding: "12px 24px", borderBottom: "1px solid var(--border-subtle)", flexWrap: "wrap" }}>
        <strong style={{ fontFamily: "var(--font-display)" }}>FaçaAmigos</strong>

        <div style={{ display: "flex", gap: "4px" }}>
          {units.map((u) => (
            <Button key={u.id} variant={unit?.id === u.id ? "primary" : "ghost"} size="sm" onClick={() => setUnitId(u.id)}>
              {u.name}
            </Button>
          ))}
        </div>

        <nav style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
          {SCREENS.map((s) => (
            <Button key={s.value} variant={screen === s.value ? "teal" : "ghost"} size="sm" onClick={() => setScreen(s.value)}>
              {s.label}
            </Button>
          ))}
        </nav>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "8px" }}>
          <span>{employee.full_name}</span>
        </div>
      </header>

      <main>
        <ScreenComponent />
      </main>
    </div>
  );
}
