import { useState } from "react";
import type { Unit } from "../api/client.js";
import { GerencialApp } from "../screens/gerencial/GerencialApp.js";
import { MobileGerencialHome } from "./MobileGerencialHome.js";
import "./mobile.css";

/**
 * Entrada do Owner no modo celular.
 *
 * O console completo (GerencialApp, 21 abas — preço, colaboradores,
 * permissões, folha, fiscal) já é seu próprio "app": tem cabeçalho,
 * marca e botão de saída próprios, e a barra de abas já quebra linha
 * sozinha (packages/ui/src/components/Tabs.tsx tem flexWrap). Vestir ele
 * de novo com a barra de status do modo celular duplicaria cabeçalho —
 * por isso ele é renderizado tal como é no balcão, sem embrulho.
 *
 * O que faltava era a PRIMEIRA tela: hoje, entrar em Gerencial cai direto
 * na aba Planos, sem nenhum resumo. Esta home mostra as 3 operações juntas
 * primeiro; "Abrir painel administrativo completo" é quem leva ao console
 * de verdade.
 */
export function MobileGerencial({ units, onExit, onLogout }: { units: Unit[]; onExit: () => void; onLogout: () => void | Promise<void> }) {
  const [showFull, setShowFull] = useState(false);

  if (showFull) {
    return <GerencialApp onExit={onExit} onLogout={onLogout} />;
  }

  return (
    <div className="m-shell">
      <div className="m-frame">
        <div className="m-navbar">
          <button type="button" className="m-round" aria-label="Sair do Gerencial" onClick={onExit}>
            ‹
          </button>
          <span className="m-title-sm m-grow">Gerencial</span>
        </div>
        <MobileGerencialHome units={units} onAbrirPainelCompleto={() => setShowFull(true)} />
      </div>
    </div>
  );
}
