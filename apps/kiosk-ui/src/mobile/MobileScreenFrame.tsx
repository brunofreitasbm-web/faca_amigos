import type { ReactNode } from "react";
import { MobileNavBar } from "./MobileNav.js";
import "./mobile.css";

/**
 * Casca do modo celular para uma tela COMPLETA e não-reescrita (Saída,
 * Caixa hoje; outras podem entrar depois).
 *
 * A decisão de produto foi não duplicar as telas que fecham dinheiro —
 * checkout, conferência de caixa, fiscal — numa segunda implementação
 * dentro da MobileShell, porque uma segunda regra de cobrança que possa
 * divergir da primeira é exatamente o tipo de bug caro nesse domínio (ver
 * mobile/MobileShell.tsx). Este componente é a alternativa: veste a tela
 * REAL (SaidaScreen, CaixaScreen — sem alterar sua lógica) com a mesma
 * barra de status e navegação do resto do modo celular, em vez de deixar
 * o operador cair de volta no cabeçalho de balcão (marca + menu
 * hambúrguer) no meio de um fluxo que começou no celular.
 *
 * A tela filha controla seu próprio scroll interno (ambas já fazem isso
 * hoje — Saída com `overflowY:auto` no próprio contêiner, Caixa por
 * herdar o scroll do body). O `overflow-y:auto` aqui é wallpaper: nunca
 * ativa quando a tela filha já rolou, mas cobre o caso de uma tela futura
 * que não tenha o próprio scroll.
 */
export function MobileScreenFrame({ title, onBack, backLabel = "Voltar", children }: { title: string; onBack: () => void; backLabel?: string; children: ReactNode }) {
  return (
    <div className="m-shell">
      <div className="m-frame">
        <MobileNavBar title={title} backLabel={backLabel} onBack={onBack} />
        <div className="m-scroll" style={{ padding: 0, overflowX: "auto" }}>
          {children}
        </div>
      </div>
    </div>
  );
}
