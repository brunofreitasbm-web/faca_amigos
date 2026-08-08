import { useEffect, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import {
  Button,
  BrandLockup,
  SignInIcon,
  GridIcon,
  QrCodeIcon,
  ShoppingCartIcon,
  WalletIcon,
  ClockIcon,
  ChartBarIcon,
  GearIcon,
  ArrowClockwiseIcon,
} from "@facaamigos/ui";
import { unitBrandFor } from "./branding/unitBrand.js";
import { useAppState } from "./state/AppState.js";
import { useConfirm } from "./state/ConfirmContext.js";
import { useAuth } from "./auth/AuthContext.js";
import { RequireCapability } from "./auth/RequireCapability.js";
import { SCREEN_CAPABILITY, type Screen } from "./auth/screens.js";
import { ROLE_LABEL } from "./auth/capabilities.js";
import { LoginScreen } from "./screens/LoginScreen.js";
import { SelectModuleScreen } from "./screens/SelectModuleScreen.js";
import { OnboardingInviteScreen } from "./screens/OnboardingInviteScreen.js";
import { EntradaScreen } from "./screens/EntradaScreen.js";
import { SaidaScreen } from "./screens/SaidaScreen.js";
import { PainelScreen } from "./screens/PainelScreen.js";
import { PdvScreen } from "./screens/PdvScreen.js";
import { CaixaScreen } from "./screens/CaixaScreen.js";
import { PontoScreen } from "./screens/PontoScreen.js";
import { RelatorioScreen } from "./screens/RelatorioScreen.js";
import { ConfiguracoesScreen } from "./screens/ConfiguracoesScreen.js";
import { PosVisitaScreen } from "./screens/PosVisitaScreen.js";
import { AniversariosScreen } from "./screens/AniversariosScreen.js";
import { BancoTalentosScreen } from "./screens/BancoTalentosScreen.js";
import { GerencialApp } from "./screens/gerencial/GerencialApp.js";
import { ConnectDeviceModal } from "./components/ConnectDeviceModal.js";
import { ConnectionStatusChip } from "./components/ConnectionStatusChip.js";
import { InstallPwaBanner } from "./components/InstallPwaBanner.js";
import { UpdatePwaBanner } from "./components/UpdatePwaBanner.js";
import { isElectronLocal } from "./pwa.js";

const SCREENS: ReadonlyArray<{ value: Screen; label: string; help: string; icon: ReactNode }> = [
  { value: "ENTRADA", label: "Entrada", help: "Cadastrar a chegada de uma criança: escolher o plano, identificar responsável e imprimir a pulseira e o recibo de guarda", icon: <SignInIcon /> },
  { value: "SAIDA", label: "Saída", help: "Liberar uma criança lendo o QR Code da pulseira ou do recibo de guarda pela câmera do celular", icon: <QrCodeIcon /> },
  { value: "PAINEL", label: "Painel", help: "Ver todas as crianças que estão no espaço agora, quanto tempo já ficaram e fechar o atendimento (cobrar) quando forem embora", icon: <GridIcon /> },
  { value: "PDV", label: "PDV", help: "Vender produtos avulsos (loja/lanchonete), sem estar ligado a uma entrada", icon: <ShoppingCartIcon /> },
  { value: "CAIXA", label: "Caixa", help: "Abrir e fechar o turno de caixa, conferir o dinheiro e registrar sangria/suprimento", icon: <WalletIcon /> },
  { value: "POS_VISITA", label: "Pós-Visita", help: "Acompanhamento de satisfação dos clientes e mensagens pós-atendimento via WhatsApp", icon: <span>📱</span> },
  { value: "ANIVERSARIOS", label: "Aniversários", help: "Acompanhar aniversariantes do mês e enviar cupons/felicitações", icon: <span>🎂</span> },
  { value: "BANCO_TALENTOS", label: "Banco de Talentos", help: "Analisar candidaturas recebidas pelo site e acompanhar a triagem de currículos", icon: <span>🌟</span> },
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
  POS_VISITA: PosVisitaScreen,
  ANIVERSARIOS: AniversariosScreen,
  BANCO_TALENTOS: BancoTalentosScreen,
  PONTO: PontoScreen,
  RELATORIO: RelatorioScreen,
  CONFIGURACOES: ConfiguracoesScreen,
};

export function App() {
  const { unit, setUnitId, gerencial, setGerencial, employee, logout, restoring } = useAppState();
  const { can, loading: loadingCapabilities } = useAuth();
  const confirm = useConfirm();
  const [screen, setScreen] = useState<Screen>("PAINEL");
  const [showConnectModal, setShowConnectModal] = useState(false);

  // Cada módulo/unidade selecionado sempre abre direto no Painel (tela principal do sistema).
  useEffect(() => {
    if (unit) setScreen("PAINEL");
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

  // Enquanto a sessão salva não foi conferida, não decide nada: mostrar a
  // tela de login por um instante para quem já está logado faz o operador
  // digitar o PIN à toa a cada refresh.
  if (restoring) {
    return <div style={{ padding: "80px", textAlign: "center", color: "var(--text-muted)" }}>Carregando…</div>;
  }

  if (!employee) return <LoginScreen />;

  // Modo Gerencial: fora do contexto das 3 unidades, é onde o Owner configura
  // o que vale para várias unidades de uma vez e vê relatórios cross-unit.
  if (gerencial) {
    return <GerencialApp onExit={() => setGerencial(false)} onLogout={handleLogout} />;
  }

  // Se nenhuma operação/módulo foi selecionado ainda, exibe a Tela Inicial de Seleção de Módulo
  if (!unit) {
    return <SelectModuleScreen />;
  }

  const visibleScreens = SCREENS.filter((s) => can(SCREEN_CAPABILITY[s.value]));
  const ScreenComponent = SCREEN_COMPONENTS[screen];
  const brand = unitBrandFor(unit.name);

  return (
    <div className="kiosk-shell" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
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
          {/* Esconder o que o colaborador não pode fazer é UX, não segurança:
              quem protege é a RLS e as RPCs fa_config_*. Por isso a tela em
              si também é guardada logo abaixo, com <RequireCapability>. */}
          {visibleScreens.map((s) => (
            <Button
              key={s.value}
              variant={screen === s.value ? "teal" : "ghost"}
              size="sm"
              title={s.help}
              onClick={() => setScreen(s.value)}
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

      {/* flex:1 + minHeight:0 é o que faz o filho poder ser 100% de altura
          sem estourar o pai — sem minHeight:0 um flex item nunca encolhe
          abaixo do seu conteúdo, e a rolagem "vaza" pra página inteira.
          Em telas de celular (ver .kiosk-main no app.css) essa contenção
          é desligada de propósito: com o cabeçalho quebrando em várias
          linhas, a altura fixa sobrava pouco espaço pro quadro — melhor
          deixar a página inteira rolar do que espremer o conteúdo. */}
      <main className="kiosk-main" style={{ flex: 1, minHeight: 0 }}>
        {ScreenComponent && (
          <RequireCapability capability={SCREEN_CAPABILITY[screen]}>
            <ScreenComponent />
          </RequireCapability>
        )}
      </main>
    </div>
  );
}
