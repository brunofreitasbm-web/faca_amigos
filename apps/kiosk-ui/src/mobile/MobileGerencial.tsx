import { useState } from "react";
import type { Unit } from "../api/client.js";
import { GerencialApp } from "../screens/gerencial/GerencialApp.js";
import { MobileGerencialHome } from "./MobileGerencialHome.js";
import { MobileUnitDetail } from "./MobileUnitDetail.js";
import { MobileRelatorios } from "./MobileRelatorios.js";
import { MobileEquipe } from "./MobileEquipe.js";
import "./mobile.css";

type View = { kind: "HOME" } | { kind: "UNIT"; unit: Unit } | { kind: "RELATORIOS" } | { kind: "EQUIPE" } | { kind: "FULL" };

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
 * na aba Planos, sem nenhum resumo. Esta home mostra as 3 operações
 * juntas primeiro, com três destinos nativos (detalhe de unidade,
 * relatórios, equipe) e um caminho pro console completo quando o Owner
 * precisa mexer em cadastro de verdade.
 */
export function MobileGerencial({ units, onExit, onLogout }: { units: Unit[]; onExit: () => void; onLogout: () => void | Promise<void> }) {
  const [view, setView] = useState<View>({ kind: "HOME" });

  if (view.kind === "FULL") {
    return <GerencialApp onExit={onExit} onLogout={onLogout} />;
  }

  if (view.kind === "UNIT") {
    return <MobileUnitDetail unit={view.unit} onBack={() => setView({ kind: "HOME" })} />;
  }

  if (view.kind === "RELATORIOS") {
    return <MobileRelatorios units={units} onBack={() => setView({ kind: "HOME" })} />;
  }

  if (view.kind === "EQUIPE") {
    return <MobileEquipe units={units} onBack={() => setView({ kind: "HOME" })} />;
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
        <MobileGerencialHome
          units={units}
          onAbrirPainelCompleto={() => setView({ kind: "FULL" })}
          onAbrirUnidade={(unit) => setView({ kind: "UNIT", unit })}
          onAbrirRelatorios={() => setView({ kind: "RELATORIOS" })}
          onAbrirEquipe={() => setView({ kind: "EQUIPE" })}
        />
      </div>
    </div>
  );
}
