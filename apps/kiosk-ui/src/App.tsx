import { useCallback, useEffect, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import {
  Button,
  BrandLockup,
  SignInIcon,
  GridIcon,
  ShoppingCartIcon,
  WalletIcon,
  ClockIcon,
  ChartBarIcon,
  GearIcon,
  ArrowClockwiseIcon,
  ListIcon,
  XIcon,
} from "@facaamigos/ui";
import { unitBrandFor } from "./branding/unitBrand.js";
import { useSwipeNavigation } from "./hooks/useSwipeNavigation.js";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts.js";
import { usePrintFailureAlerts } from "./hooks/usePrintFailureAlerts.js";
import { useAppState } from "./state/AppState.js";
import { useConfirm } from "./state/ConfirmContext.js";
import { useAuth } from "./auth/AuthContext.js";
import { RequireCapability } from "./auth/RequireCapability.js";
import { SCREEN_CAPABILITY, type Screen } from "./auth/screens.js";
import { ROLE_LABEL } from "./auth/capabilities.js";
import { LoginScreen } from "./screens/LoginScreen.js";
import { SelectModuleScreen } from "./screens/SelectModuleScreen.js";
import { OnboardingInviteScreen } from "./screens/OnboardingInviteScreen.js";
import { GeneralOnboardingScreen } from "./screens/GeneralOnboardingScreen.js";
import { AcompanharScreen } from "./screens/AcompanharScreen.js";
import { AcessoRapidoScreen } from "./screens/AcessoRapidoScreen.js";
import { EntradaScreen } from "./screens/EntradaScreen.js";
import { SaidaScreen } from "./screens/SaidaScreen.js";
import { PainelScreen } from "./screens/PainelScreen.js";
import { PdvScreen } from "./screens/PdvScreen.js";
import { CaixaScreen } from "./screens/CaixaScreen.js";
import { PontoScreen } from "./screens/PontoScreen.js";
import { RelatorioScreen } from "./screens/RelatorioScreen.js";
import { ConfiguracoesScreen } from "./screens/ConfiguracoesScreen.js";
import { AniversariosScreen } from "./screens/AniversariosScreen.js";
import { GerencialApp } from "./screens/gerencial/GerencialApp.js";
import { TapReturnScreen } from "./screens/TapReturnScreen.js";
import { parseTapReturn } from "./lib/infinitepayTap.js";
import { ConnectDeviceModal } from "./components/ConnectDeviceModal.js";
import { ConnectionStatusChip } from "./components/ConnectionStatusChip.js";
import { InstallPwaBanner } from "./components/InstallPwaBanner.js";
import { UpdatePwaBanner } from "./components/UpdatePwaBanner.js";
import { GlobalPdfReceiptModalListener } from "./components/PdfReceiptModal.js";
import { isElectronLocal } from "./pwa.js";
import { MobileShell } from "./mobile/MobileShell.js";
import { MobileScreenFrame } from "./mobile/MobileScreenFrame.js";
import { MobileGerencial } from "./mobile/MobileGerencial.js";
import { useMobileShell } from "./mobile/useMobileShell.js";

const SCREENS: ReadonlyArray<{ value: Screen; label: string; help: string; icon: ReactNode }> = [
  { value: "ENTRADA", label: "Entrada", help: "Cadastrar a chegada de uma criança: escolher o plano, identificar responsável e imprimir a pulseira e o recibo de guarda", icon: <SignInIcon /> },
  // Saída não fica na barra superior de propósito: o único caminho de
  // liberação agora é o botão flutuante amarelo dentro do Painel (ver
  // PainelScreen.tsx) — evita duas entradas concorrentes para a mesma ação.
  { value: "PAINEL", label: "Painel", help: "Ver todas as crianças que estão no espaço agora, quanto tempo já ficaram e fechar o atendimento (cobrar) quando forem embora", icon: <GridIcon /> },
  { value: "PDV", label: "PDV", help: "Vender produtos avulsos (loja/lanchonete), sem estar ligado a uma entrada", icon: <ShoppingCartIcon /> },
  { value: "CAIXA", label: "Caixa", help: "Abrir e fechar o turno de caixa, conferir o dinheiro e registrar sangria/suprimento", icon: <WalletIcon /> },
  { value: "ANIVERSARIOS", label: "Aniversários", help: "Acompanhar aniversariantes do mês e enviar cupons/felicitações", icon: <span>🎂</span> },
  { value: "PONTO", label: "Ponto", help: "Bater o ponto: registrar entrada, intervalo e saída do colaborador", icon: <ClockIcon /> },
  { value: "RELATORIO", label: "Relatório", help: "Consultar vendas, visitas, planos, movimentação de caixa e folha de ponto de períodos anteriores", icon: <ChartBarIcon /> },
  { value: "CONFIGURACOES", label: "Configurações", help: "Ajustar planos, produtos, cupons, colaboradores, unidade, dados fiscais e termos de uso", icon: <GearIcon /> },
];

const SCREEN_COMPONENTS: Record<Screen, () => ReactElement | null> = {
  ENTRADA: EntradaScreen,
  SAIDA: SaidaScreen,
  PAINEL: PainelScreen,
  PDV: PdvScreen,
  CAIXA: CaixaScreen,
  ANIVERSARIOS: AniversariosScreen,
  PONTO: PontoScreen,
  RELATORIO: RelatorioScreen,
  CONFIGURACOES: ConfiguracoesScreen,
};

export function App() {
  const { units, unit, setUnitId, gerencial, setGerencial, employee, logout, restoring } = useAppState();
  const { can, loading: loadingCapabilities } = useAuth();
  const confirm = useConfirm();
  const [screen, setScreen] = useState<Screen>("PAINEL");
  const [screenHistory, setScreenHistory] = useState<Screen[]>([]);
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  // Casca mobile: no celular o operador entra por ela, e `mobileEscape`
  // guarda a tela completa que ele pediu de dentro dela (Saída, Caixa…).
  // Enquanto for null, quem manda no celular é a casca.
  const mobile = useMobileShell();
  const [mobileEscape, setMobileEscape] = useState<Screen | null>(null);

  function navigateToScreen(newScreen: Screen) {
    if (newScreen === screen) return;
    setScreenHistory((prev) => [...prev, screen].slice(-20));
    setScreen(newScreen);
  }

  // Sair da casca mobile para uma tela completa é uma navegação normal do
  // app — só que decidida lá dentro.
  useEffect(() => {
    if (mobileEscape) setScreen(mobileEscape);
  }, [mobileEscape]);

  // Cada módulo/unidade selecionado sempre abre direto no Painel (tela principal do sistema).
  useEffect(() => {
    if (unit) {
      setScreen("PAINEL");
      setScreenHistory([]);
    }
  }, [unit?.id]);

  // Se o colaborador atual não pode ver a tela em que está — porque trocou de
  // conta no terminal, ou porque o Owner rebaixou o papel dele enquanto a
  // tela estava aberta — cai para a primeira tela permitida em vez de ficar
  // preso num "Área restrita" sem saída.
  useEffect(() => {
    if (loadingCapabilities || !employee) return;
    if (can(SCREEN_CAPABILITY[screen])) return;
    const firstAllowed = SCREENS.find((s) => can(SCREEN_CAPABILITY[s.value]));
    if (firstAllowed) setScreen(firstAllowed.value);
  }, [loadingCapabilities, employee, screen, can]);

  // Calculado antes dos retornos antecipados abaixo (tela de login, seleção
  // de módulo etc.) porque o gesto de arrastar já precisa dele — hooks não
  // podem vir depois de um `return` condicional.
  // Estagiário não "bate ponto" no vocabulário do RH — é "Controle de
  // Frequência". O papel é o único gate: a tela e a capacidade continuam
  // as mesmas (PONTO / ponto.self), só o rótulo muda pra quem só tem esse
  // acesso.
  const visibleScreens = SCREENS.filter((s) => can(SCREEN_CAPABILITY[s.value])).map((s) =>
    s.value === "PONTO" && employee?.role === "ESTAGIARIO"
      ? { ...s, label: "Controle de Frequência", help: "Registrar entrada, intervalo e saída" }
      : s,
  );

  const handleGoBack = useCallback(() => {
    if (showConnectModal) {
      setShowConnectModal(false);
      return;
    }
    if (navOpen) {
      setNavOpen(false);
      return;
    }
    setScreenHistory((prev) => {
      if (prev.length === 0) {
        const index = visibleScreens.findIndex((s) => s.value === screen);
        const prevScreen = visibleScreens[index - 1];
        if (prevScreen) {
          setScreen(prevScreen.value);
        }
        return prev;
      }
      const lastScreen = prev[prev.length - 1];
      if (lastScreen) {
        setScreen(lastScreen);
      }
      return prev.slice(0, -1);
    });
  }, [showConnectModal, navOpen, visibleScreens, screen]);

  const handleSave = useCallback(() => {
    const submitButton = document.querySelector<HTMLButtonElement>(
      "main form button[type='submit'], main button[data-save-button], main .kiosk-save-btn"
    );
    if (submitButton && !submitButton.disabled) {
      submitButton.click();
    }
  }, []);

  useKeyboardShortcuts({
    onGoBack: handleGoBack,
    onEscape: () => {
      if (showConnectModal) setShowConnectModal(false);
      if (navOpen) setNavOpen(false);
    },
    onSave: handleSave,
    enabled: !!employee && !gerencial && !!unit,
  });

  usePrintFailureAlerts(unit?.id ?? null);

  const swipeHandlers = useSwipeNavigation(
    () => {
      // Arrastar para a esquerda: próximo módulo, como virar a página.
      const index = visibleScreens.findIndex((s) => s.value === screen);
      const next = index !== -1 ? visibleScreens[index + 1] : undefined;
      if (next) navigateToScreen(next.value);
    },
    () => {
      // Arrastar para a direita: voltar no histórico / módulo anterior.
      handleGoBack();
    },
  );

  async function handleChangeModule() {
    const ok = await confirm({
      title: "Trocar módulo?",
      message: "Você vai sair da tela atual e voltar para a seleção de módulo.",
      confirmLabel: "Trocar módulo",
      cancelLabel: "Cancelar",
    });
    if (ok) {
      setUnitId("");
      setGerencial(false);
    }
  }

  async function handleLogout() {
    const ok = await confirm({
      title: "Sair?",
      message: "O terminal vai voltar para a tela de PIN. Nenhum atendimento em andamento é perdido.",
      confirmLabel: "Sair",
      cancelLabel: "Cancelar",
    });
    if (ok) await logout();
  }

  // Link de convite individual (?convite=<inviteId>.<token>): quem abre
  // ainda não tem NENHUMA conta/sessão — precisa vir ANTES até da checagem
  // de sessão salva abaixo, senão essa pessoa nunca sairia da tela de
  // "Carregando…"/login por PIN.
  const inviteParam = new URLSearchParams(window.location.search).get("convite");
  if (inviteParam) {
    const [inviteId, token] = inviteParam.split(".");
    if (inviteId && token) return <OnboardingInviteScreen inviteId={inviteId} token={token} />;
  }

  // Link Geral de auto-cadastro de estagiário (?cadastro-estagiario=<unitId>.<token>):
  // token fixo por unidade (ver botão na ColaboradoresTab), quem abre ainda
  // não tem NENHUMA conta — mesmo cuidado do branch `?convite=` acima, tem
  // que vir antes de qualquer checagem de sessão salva.
  const cadastroEstagiarioParam = new URLSearchParams(window.location.search).get("cadastro-estagiario");
  if (cadastroEstagiarioParam) {
    const [unitId, token] = cadastroEstagiarioParam.split(".");
    if (unitId && token) return <GeneralOnboardingScreen unitId={unitId} token={token} />;
  }

  // Painel do responsável (?acompanhar=<access_code>): quem abre é o pai/mãe
  // que escaneou o QR mostrado no check-in, sem NENHUMA conta no sistema —
  // mesmo espírito do branch `?convite=` acima, tem que vir antes de
  // qualquer checagem de sessão salva.
  const acompanharParam = new URLSearchParams(window.location.search).get("acompanhar");
  if (acompanharParam) {
    return <AcompanharScreen code={acompanharParam} />;
  }

  // QR Code de Acesso Rápido (?acesso-rapido=<unit_id>): cartaz fixo na
  // entrada da unidade. Mesmo espírito dos branches acima — o responsável
  // não tem NENHUMA conta, então isto também precisa vir antes de qualquer
  // checagem de sessão salva.
  const acessoRapidoParam = new URLSearchParams(window.location.search).get("acesso-rapido");
  if (acessoRapidoParam) {
    return <AcessoRapidoScreen unitId={acessoRapidoParam} />;
  }

  // Enquanto a sessão salva não foi conferida, não decide nada: mostrar a
  // tela de login por um instante para quem já está logado faz o operador
  // digitar o PIN à toa a cada refresh.
  if (restoring) {
    return <div style={{ padding: "80px", textAlign: "center", color: "var(--text-muted)" }}>Carregando…</div>;
  }

  if (!employee) return <LoginScreen />;

  // Modo Gerencial: fora do contexto das 3 unidades, é onde o Owner configura
  // o que vale para várias unidades de uma vez e vê relatórios cross-unit.
  // No celular a porta de entrada é a home "as 3 operações numa tela"
  // (MobileGerencial), não o console de 21 abas direto — ver o comentário
  // em mobile/MobileGerencial.tsx.
  if (gerencial) {
    if (mobile.active) {
      return <MobileGerencial units={units} onExit={() => setGerencial(false)} onLogout={handleLogout} />;
    }
    return <GerencialApp onExit={() => setGerencial(false)} onLogout={handleLogout} />;
  }

  // Se nenhuma operação/módulo foi selecionado ainda, exibe a Tela Inicial de Seleção de Módulo
  if (!unit) {
    return <SelectModuleScreen />;
  }

  // Retorno do app InfinitePay depois de uma cobrança por aproximação
  // (InfiniteTap, ver lib/infinitepayTap.ts). Precisa vir depois dos
  // checks de employee/unit acima porque finaliza a venda via API — mas
  // antes do resto porque não faz sentido decidir tela/módulo no meio de
  // uma cobrança pendente de confirmação.
  const tapReturn = parseTapReturn(window.location.search);
  if (tapReturn) {
    return <TapReturnScreen search={window.location.search} onDone={() => navigateToScreen("PAINEL")} />;
  }

  // Celular: a casca mobile é a porta de entrada. Só sai dela quando o
  // próprio operador pede uma tela completa (mobileEscape) ou desliga o
  // modo para este aparelho (mobile.active).
  if (mobile.active && mobileEscape === null && employee) {
    return (
      <MobileShell
        unit={unit}
        employeeName={employee.full_name}
        employeeId={employee.id}
        onAbrirTelaCompleta={(s) => setMobileEscape(s)}
        onUsarVersaoCompleta={mobile.useFullVersion}
        onTrocarModulo={handleChangeModule}
        onSair={handleLogout}
      />
    );
  }

  // Saída e Caixa continuam sendo a MESMA SaidaScreen/CaixaScreen do
  // balcão — não uma segunda implementação — só vestidas com a casca do
  // modo celular em vez do cabeçalho de balcão (marca + menu hambúrguer).
  // As demais telas de escape (Entrada completa, PDV, Ponto, Relatórios,
  // Configurações) ainda caem no fallback abaixo, com o botão flutuante
  // "Voltar ao modo celular" — ainda não vestidas.
  if (mobile.active && (mobileEscape === "SAIDA" || mobileEscape === "CAIXA") && employee) {
    const FramedComponent = SCREEN_COMPONENTS[mobileEscape];
    return (
      <MobileScreenFrame title={mobileEscape === "SAIDA" ? "Saída" : "Caixa"} onBack={() => setMobileEscape(null)}>
        <RequireCapability capability={SCREEN_CAPABILITY[mobileEscape]}>
          <FramedComponent />
        </RequireCapability>
      </MobileScreenFrame>
    );
  }

  const ScreenComponent = SCREEN_COMPONENTS[screen];
  const brand = unitBrandFor(unit.name);

  return (
    <div className="kiosk-shell" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Régua da operação: a faixa de cor mais persistente da tela, para
          o operador saber em que unidade está sem precisar ler nada. */}
      <div style={{ flexShrink: 0, height: "3px", background: brand.accent }} />

      {/* Volta para a casca mobile depois de um desvio para a tela completa.
          Sem isto o operador que tocou em "Saída" no celular fica preso nas
          telas de balcão até fechar o app. */}
      {mobile.active && mobileEscape !== null && (
        <button
          type="button"
          onClick={() => setMobileEscape(null)}
          style={{
            position: "fixed",
            left: "50%",
            transform: "translateX(-50%)",
            bottom: "calc(12px + env(safe-area-inset-bottom, 0px))",
            zIndex: 60,
            border: "none",
            borderRadius: "9999px",
            padding: "12px 20px",
            minHeight: "44px",
            background: "var(--color-dark)",
            color: "#fff",
            font: "inherit",
            fontSize: "13px",
            fontWeight: 800,
            boxShadow: "0 8px 24px rgba(0,0,0,.28)",
            cursor: "pointer",
          }}
        >
          ‹ Voltar ao modo celular
        </button>
      )}

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

        {/* Só aparece em telas de celular (ver .kiosk-nav-toggle no
            app.css) — no computador o menu completo já cabe ao lado da
            marca e fica sempre aberto. */}
        <button
          type="button"
          className="kiosk-nav-toggle"
          onClick={() => setNavOpen((open) => !open)}
          aria-expanded={navOpen}
          aria-controls="kiosk-nav-menu"
          title={navOpen ? "Fechar menu de módulos" : "Abrir menu de módulos"}
          style={{
            marginLeft: "12px",
            width: "36px",
            height: "36px",
            flexShrink: 0,
            display: "none",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "50%",
            border: "1px solid var(--border-subtle)",
            background: "var(--surface-card)",
            color: "var(--color-primary-hover)",
            cursor: "pointer",
            fontSize: "18px",
          }}
        >
          {navOpen ? <XIcon /> : <ListIcon />}
        </button>

        <nav id="kiosk-nav-menu" className={`kiosk-nav${navOpen ? " is-open" : ""}`} style={{ display: "flex", gap: "4px", flexWrap: "wrap", marginLeft: "12px" }}>
          {/* Esconder o que o colaborador não pode fazer é UX, não segurança:
              quem protege é a RLS e as RPCs fa_config_*. Por isso a tela em
              si também é guardada logo abaixo, com <RequireCapability>.
              O contorno em cada botão (mesmo os "ghost") é de propósito:
              sem ele, rótulo + ícone rosa sobre fundo branco se confundem
              com texto comum — o contorno é o que avisa "isto é clicável". */}
          {visibleScreens.map((s) => (
            <Button
              key={s.value}
              variant={screen === s.value ? "teal" : "ghost"}
              size="sm"
              title={s.help}
              onClick={() => {
                navigateToScreen(s.value);
                setNavOpen(false);
              }}
              style={{ border: screen === s.value ? "1px solid transparent" : "1px solid var(--border-subtle)" }}
            >
              {s.icon} {s.label}
            </Button>
          ))}
        </nav>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
          <ConnectionStatusChip />

          {/* Pareamento por QR: só faz sentido no computador do balcão —
              no celular/tablet quem guia a instalação é o InstallPwaBanner. */}
          {isElectronLocal() && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowConnectModal(true)}
              title="Conectar celular/tablet lendo um QR Code — instala o aplicativo no aparelho"
              style={{ fontSize: "12px", border: "1px solid var(--color-teal)", color: "var(--color-teal-text)", background: "rgba(29, 155, 132, 0.08)" }}
            >
              📱 Conectar celular/tablet
            </Button>
          )}

          <span style={{ fontSize: "13px", color: "var(--text-secondary)", fontWeight: "var(--weight-semibold)" as unknown as number }}>
            {employee.full_name} · {ROLE_LABEL[employee.role]}
          </span>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleChangeModule}
            title="Alternar para a tela inicial de seleção de módulos"
            style={{ fontSize: "12px", border: "1px solid var(--border-subtle)" }}
          >
            <ArrowClockwiseIcon /> Trocar Módulo
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleLogout}
            title="Encerrar a sessão deste colaborador no terminal"
            style={{ fontSize: "12px", border: "1px solid var(--border-subtle)" }}
          >
            Sair
          </Button>
        </div>
      </header>

      {showConnectModal && <ConnectDeviceModal onClose={() => setShowConnectModal(false)} />}

      <InstallPwaBanner />
      <UpdatePwaBanner />
      <GlobalPdfReceiptModalListener />

      {/* flex:1 + minHeight:0 é o que faz o filho poder ser 100% de altura
          sem estourar o pai — sem minHeight:0 um flex item nunca encolhe
          abaixo do seu conteúdo, e a rolagem "vaza" pra página inteira.
          Em telas de celular (ver .kiosk-main no app.css) essa contenção
          é desligada de propósito: com o cabeçalho quebrando em várias
          linhas, a altura fixa sobrava pouco espaço pro quadro — melhor
          deixar a página inteira rolar do que espremer o conteúdo. */}
      {/* Arrastar o dedo para os lados troca de módulo — gesto extra além
          da barra/menu, pensado para o celular (ver useSwipeNavigation). */}
      <main className="kiosk-main" style={{ flex: 1, minHeight: 0 }} {...swipeHandlers}>
        {ScreenComponent && (
          <RequireCapability capability={SCREEN_CAPABILITY[screen]}>
            <ScreenComponent />
          </RequireCapability>
        )}
      </main>
    </div>
  );
}
