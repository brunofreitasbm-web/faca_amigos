import { useEffect, useState } from "react";
import type { Unit } from "../api/client.js";
import { useActiveSessions } from "../api/useTick.js";
import { usePendingRenewals } from "../api/renewalRequests.js";
import { useAuth } from "../auth/AuthContext.js";
import { useToast } from "../state/ToastContext.js";
import { InstallPwaBanner } from "../components/InstallPwaBanner.js";
import { UpdatePwaBanner } from "../components/UpdatePwaBanner.js";
import { MobileHome } from "./MobileHome.js";
import { MobileCheckin } from "./MobileCheckin.js";
import { MobileCheckinCircuito } from "./MobileCheckinCircuito.js";
import { MobilePainel } from "./MobilePainel.js";
import { MobilePedidosTempo } from "./MobilePedidosTempo.js";
import "./mobile.css";

export type EscapeScreen = "ENTRADA" | "SAIDA" | "PAINEL" | "CAIXA" | "PONTO" | "PDV" | "RELATORIO" | "CONFIGURACOES";

type Tab = "TURNO" | "PAINEL" | "MAIS";
type View = Tab | "CHECKIN" | "PEDIDOS";

/**
 * Casca mobile do operador.
 *
 * Contém as três coisas que acontecem com a família parada na frente do
 * colaborador — a fila do turno, a entrada e o cronômetro — e mais nada.
 * Tudo o que envolve dinheiro fechando (checkout, fiscal, caixa) abre a
 * tela completa de propósito: são fluxos testados, com regra fiscal e
 * impressão, e uma segunda implementação deles no celular seria uma
 * segunda regra de negócio para divergir da primeira.
 */
export function MobileShell({
  unit,
  employeeName,
  employeeId,
  onAbrirTelaCompleta,
  onUsarVersaoCompleta,
  onTrocarModulo,
  onSair,
}: {
  unit: Unit;
  employeeName: string;
  employeeId: string;
  onAbrirTelaCompleta: (screen: EscapeScreen) => void;
  onUsarVersaoCompleta: () => void;
  onTrocarModulo: () => void;
  onSair: () => void;
}) {
  const { can } = useAuth();
  const toast = useToast();
  const [view, setView] = useState<View>("TURNO");
  const { entries, status, refetch } = useActiveSessions(unit.id);
  // Mesma fila que já existe no badge do Painel de balcão (PainelScreen.tsx)
  // — reaproveita as sessões já carregadas acima, sem abrir uma segunda
  // assinatura Realtime só para isto.
  const pendingRenewals = usePendingRenewals(entries.map((e) => e.session.id));

  // O gesto/botão "voltar" do Android fecha o check-in/pedidos em vez de
  // sair do app — sem isto o operador perde o lugar ao tocar por reflexo.
  // Só empilha estado enquanto há para onde voltar.
  useEffect(() => {
    if (view !== "CHECKIN" && view !== "PEDIDOS") return;
    history.pushState({ mobileShell: view }, "");
    const onPop = () => setView("TURNO");
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [view]);

  const activeCount = status === "ready" ? entries.length : null;

  // No Circuito (quiosque) a entrada exige escolher o veículo — o passo
  // extra que MobileCheckinCircuito resolve (busca → veículo → checklist +
  // plano/pacote), reaproveitando o mesmo fa_checkin de sempre.
  const isQuiosque = unit.kind === "QUIOSQUE";

  function abrirCompleta(screen: EscapeScreen, reason?: string) {
    if (reason) toast.success(reason);
    onAbrirTelaCompleta(screen);
  }

  const tabs: Array<{ id: Tab; label: string; show: boolean }> = [
    { id: "TURNO", label: "Turno", show: true },
    { id: "PAINEL", label: "Painel", show: can("sessao.checkout") },
    { id: "MAIS", label: "Mais", show: true },
  ];

  return (
    <div className="m-shell">
      <div className="m-frame">
        {view === "CHECKIN" ? (
          <>
            <div className="m-navbar">
              <button type="button" className="m-round" aria-label="Voltar" onClick={() => setView("TURNO")}>
                ‹
              </button>
              <span className="m-title-sm m-grow">{isQuiosque ? "Nova sessão" : "Nova entrada"}</span>
            </div>
            {isQuiosque ? (
              <MobileCheckinCircuito unitId={unit.id} employeeId={employeeId} onDone={() => void refetch()} />
            ) : (
              <MobileCheckin
                unitId={unit.id}
                employeeId={employeeId}
                onEscape={(screen, reason) => abrirCompleta(screen, reason)}
                onDone={() => void refetch()}
              />
            )}
          </>
        ) : view === "TURNO" ? (
          <MobileHome
            unit={unit}
            employeeName={employeeName}
            activeCount={activeCount}
            onNovaEntrada={() => setView("CHECKIN")}
            onAbrirTela={(screen) => abrirCompleta(screen)}
            pendingRenewalsCount={pendingRenewals.size}
            onAbrirPedidos={() => setView("PEDIDOS")}
          />
        ) : view === "PEDIDOS" ? (
          <>
            <div className="m-navbar">
              <button type="button" className="m-round" aria-label="Voltar" onClick={() => setView("TURNO")}>
                ‹
              </button>
              <span className="m-title-sm m-grow">Pedidos de tempo</span>
            </div>
            <MobilePedidosTempo entries={entries} pending={pendingRenewals} employeeId={employeeId} />
          </>
        ) : view === "PAINEL" ? (
          <MobilePainel unitId={unit.id} isQuiosque={isQuiosque} onLiberarSaida={() => abrirCompleta("SAIDA")} />
        ) : (
          <MobileMais
            unitName={unit.name}
            employeeName={employeeName}
            onAbrirTela={abrirCompleta}
            onUsarVersaoCompleta={onUsarVersaoCompleta}
            onTrocarModulo={onTrocarModulo}
            onSair={onSair}
          />
        )}

        {/* Os dois banners vivem no rodapé da casca de balcão (App.tsx), que
            a casca mobile substitui inteira no celular — sem repeti-los aqui,
            justamente quem mais precisa deles nunca os veria: é o
            InstallPwaBanner que ensina a botar o app na tela inicial (o
            "Adicionar à Tela de Início" do iOS não tem prompt programático),
            e o UpdatePwaBanner que avisa da versão nova. */}
        <InstallPwaBanner />
        <UpdatePwaBanner />

        {view !== "CHECKIN" && view !== "PEDIDOS" && (
          <nav className="m-tabbar" aria-label="Seções">
            {tabs
              .filter((t) => t.show)
              .map((t) => (
                <button
                  key={t.id}
                  type="button"
                  aria-current={view === t.id ? "page" : undefined}
                  onClick={() => setView(t.id)}
                >
                  {t.label}
                </button>
              ))}
          </nav>
        )}
      </div>
    </div>
  );
}

function MobileMais({
  unitName,
  employeeName,
  onAbrirTela,
  onUsarVersaoCompleta,
  onTrocarModulo,
  onSair,
}: {
  unitName: string;
  employeeName: string;
  onAbrirTela: (screen: EscapeScreen) => void;
  onUsarVersaoCompleta: () => void;
  onTrocarModulo: () => void;
  onSair: () => void;
}) {
  const { can } = useAuth();

  const telas: Array<{ screen: EscapeScreen; titulo: string; ajuda: string; show: boolean }> = [
    { screen: "ENTRADA", titulo: "Entrada completa", ajuda: "criança nova, cupom, pacote, carrinho, contrato", show: can("sessao.checkin") },
    { screen: "SAIDA", titulo: "Saída", ajuda: "cobrar o excedente, emitir nota e liberar", show: can("sessao.checkout") },
    { screen: "PDV", titulo: "PDV", ajuda: "vender produto avulso", show: can("pdv.sell") },
    { screen: "CAIXA", titulo: "Caixa", ajuda: "abrir turno, sangria, fechar", show: can("caixa.open_close") },
    { screen: "PONTO", titulo: "Ponto", ajuda: "entrada, intervalo e saída", show: can("ponto.self") },
    { screen: "RELATORIO", titulo: "Relatórios", ajuda: "vendas, visitas e folha de ponto", show: can("relatorio.read") },
    { screen: "CONFIGURACOES", titulo: "Configurações", ajuda: "planos, produtos, equipe, unidade", show: can("config.read") },
  ];

  return (
    <>
      <div className="m-appbar">
        <div className="m-grow">
          <p className="m-title">Mais</p>
          <p className="m-sub">
            {employeeName} · {unitName}
          </p>
        </div>
      </div>

      <div className="m-scroll">
        <p className="m-eyebrow">Telas completas do sistema</p>
        <div className="m-stack" style={{ gap: 10, marginTop: 10 }}>
          {telas
            .filter((t) => t.show)
            .map((t) => (
              <button
                key={t.screen}
                type="button"
                className="m-tap m-card"
                onClick={() => onAbrirTela(t.screen)}
                style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", font: "inherit", textAlign: "left" }}
              >
                <span className="m-grow">
                  <span style={{ display: "block", fontSize: 15.5, fontWeight: 800 }}>{t.titulo}</span>
                  <span style={{ display: "block", marginTop: 3, fontSize: 12.5, lineHeight: 1.4, fontWeight: 600, color: "var(--text-muted)" }}>
                    {t.ajuda}
                  </span>
                </span>
                <span aria-hidden="true" style={{ fontSize: 20, color: "var(--color-gray-300)", flex: "none" }}>
                  ›
                </span>
              </button>
            ))}
        </div>

        <p className="m-eyebrow" style={{ marginTop: 22 }}>
          Este aparelho
        </p>
        <div className="m-stack" style={{ gap: 10, marginTop: 10 }}>
          <button type="button" className="m-pill" onClick={onUsarVersaoCompleta}>
            Sempre abrir a versão completa
          </button>
          <button type="button" className="m-pill" onClick={onTrocarModulo}>
            Trocar de unidade
          </button>
          <button type="button" className="m-pill" onClick={onSair} style={{ color: "var(--color-primary-hover)" }}>
            Sair
          </button>
        </div>
      </div>
    </>
  );
}
