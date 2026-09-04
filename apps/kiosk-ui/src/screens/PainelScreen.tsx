import { useEffect, useState } from "react";
import { Card, Button, Select, StatusBadge, Badge, Tag, AsyncState, Modal, PrinterIcon, ShoppingCartIcon, PlusIcon, SignOutIcon, XIcon, HelpText, RevealPin, AutismRibbonIcon } from "@facaamigos/ui";
import { Api, businessDateFor } from "../api/client.js";
import type { ActiveSessionEntry, Plan, Asset } from "../api/client.js";
import { bonificacaoHoje, dentroDoPiloto } from "../bonificacao.js";
import { useActiveSessions } from "../api/useTick.js";
import { usePendingRenewals, resolveRenewal } from "../api/renewalRequests.js";
import { useAppState } from "../state/AppState.js";
import { useToast } from "../state/ToastContext.js";
import { useConfirm } from "../state/ConfirmContext.js";
import { IfCan } from "../auth/RequireCapability.js";
import { CheckoutModal } from "../components/CheckoutModal.js";
import { SaidaManualModal } from "../components/SaidaManualModal.js";
import { WristbandPrintModal } from "../components/WristbandPrintModal.js";
import type { WristbandData } from "../components/WristbandPrintModal.js";
import { SessionTimelineModal } from "../components/SessionTimelineModal.js";
import { getFriendlyWristbandCode } from "@facaamigos/domain";
import { formatAge, formatElapsed, money } from "../format.js";
import { EntradaScreen } from "./EntradaScreen.js";
import type { PreCheckinPrefill } from "./EntradaScreen.js";
import { SaidaScreen } from "./SaidaScreen.js";
import { PdvScreen } from "./PdvScreen.js";
import { WristbandQRCode } from "../components/WristbandQRCode.js";

const PAUSE_REASONS: Array<{ value: string; label: string }> = [
  { value: "BANHEIRO", label: "Foi ao banheiro" },
  { value: "SAIU_DO_ESPACO", label: "Saiu do espaço" },
  { value: "OUTRO", label: "Outro motivo" },
];

// Sessão pausada e esquecida vira o mesmo problema que o painel existe
// para evitar (criança some do controle de tempo) — por isso o card
// pisca depois desse limite, igual ao alerta de excedente.
const PAUSE_ALERT_MS = 10 * 60_000;

/**
 * Painel do parque (seção 1.3/6 do plano): contagem ascendente,
 * cor por fase, seleção de mais de 1 card para famílias com mais de
 * uma criança, medidor de capacidade e alertas de expiração.
 */
export function PainelScreen() {
  const { unit, employee } = useAppState();
  const toast = useToast();
  const confirm = useConfirm();
  const { entries, status: sessionsStatus, errorMessage: sessionsError, refetch: refetchActiveSessions } = useActiveSessions(unit?.id ?? null);
  const pendingRenewals = usePendingRenewals(entries.map((e) => e.session.id));
  const [renewalBusy, setRenewalBusy] = useState<Set<string>>(new Set());

  async function handleRenewalOutcome(sessionId: string, outcome: "APLICADA" | "DISPENSADA") {
    setRenewalBusy((prev) => new Set(prev).add(sessionId));
    try {
      await resolveRenewal(sessionId, outcome, employee?.id ?? null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não deu para atualizar o pedido de renovação.");
    } finally {
      setRenewalBusy((prev) => {
        const next = new Set(prev);
        next.delete(sessionId);
        return next;
      });
    }
  }
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [actionBusy, setActionBusy] = useState<Set<string>>(new Set());
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  // Congela o cartão de quem está sendo fechado no instante do clique em
  // "Fechar sessões" — o CheckoutModal já trava o VALOR cobrado nesse
  // mesmo instante (ver client.ts: closedAtMs), mas o card por baixo do
  // modal seguia recalculando a cada segundo via useActiveSessions, dando
  // a impressão (falsa, mas visível) de que o tempo/excedente continuava
  // subindo enquanto o operador escolhia a forma de pagamento.
  const [closingSnapshot, setClosingSnapshot] = useState<Map<string, ActiveSessionEntry>>(new Map());
  const [printData, setPrintData] = useState<WristbandData | null>(null);
  const [timelineFor, setTimelineFor] = useState<ActiveSessionEntry | null>(null);
  const [planOptions, setPlanOptions] = useState<Plan[]>([]);
  const [changingPlanFor, setChangingPlanFor] = useState<string | null>(null);
  const [pendingPlanId, setPendingPlanId] = useState<string>("");
  const [pausingFor, setPausingFor] = useState<string | null>(null);
  const [pendingPauseReason, setPendingPauseReason] = useState<string>("");
  const [dailyGoalCents, setDailyGoalCents] = useState(0);
  const [todayRevenueCents, setTodayRevenueCents] = useState(0);
  const [ticketMedioCents, setTicketMedioCents] = useState(0);
  const [ticketMinCents, setTicketMinCents] = useState(0);
  const [ticketTargetCents, setTicketTargetCents] = useState(0);
  const [todayOrdersCount, setTodayOrdersCount] = useState(0);
  const [entradaOpen, setEntradaOpen] = useState(false);
  const [preCheckinPrefill, setPreCheckinPrefill] = useState<PreCheckinPrefill | null>(null);
  const [pendingPreCheckins, setPendingPreCheckins] = useState<PreCheckinPrefill[]>([]);
  const [preCheckinBusy, setPreCheckinBusy] = useState<Set<string>>(new Set());
  const [saidaOpen, setSaidaOpen] = useState(false);
  const [pdvOpen, setPdvOpen] = useState(false);
  const [qrModalSession, setQrModalSession] = useState<{ code: string; childName: string; guardianName?: string } | null>(null);
  // Contingência: recibo perdido E etiqueta ilegível. Passa pela conferência
  // do documento antes de cair no mesmo fechamento financeiro de sempre.
  const [manualExitFor, setManualExitFor] = useState<ActiveSessionEntry | null>(null);
  const [vipChildIds, setVipChildIds] = useState<Set<string>>(new Set());
  const [assets, setAssets] = useState<Asset[]>([]);

  useEffect(() => {
    if (!unit) return;
    Api.assets(unit.id).then(setAssets).catch(() => setAssets([]));
  }, [unit, entries.length]);

  useEffect(() => {
    if (!unit) return;
    const activity = unit.kind === "QUIOSQUE" ? "CARRINHO" : "PLAYGROUND";
    Api.plans(unit.id, activity).then(setPlanOptions);
  }, [unit]);

  // Pré-cadastros enviados pelo QR de Acesso Rápido (?acesso-rapido=,
  // AcessoRapidoScreen), aguardando o balcão confirmar. Poll simples —
  // igual a usePendingRenewals — não é um dado que precisa de Realtime
  // para ficar "ao vivo", só reaparecer em alguns segundos já basta.
  function refetchPendingPreCheckins() {
    if (!unit) return;
    Api.preCheckinList(unit.id)
      .then(setPendingPreCheckins)
      .catch(() => {});
  }
  useEffect(() => {
    if (!unit) return;
    refetchPendingPreCheckins();
    const interval = setInterval(refetchPendingPreCheckins, 8000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unit?.id]);

  function openPreCheckin(item: PreCheckinPrefill) {
    setPreCheckinPrefill(item);
    setEntradaOpen(true);
  }

  async function cancelPreCheckin(item: PreCheckinPrefill) {
    const key = `${item.id}:${item.childIndex}`;
    setPreCheckinBusy((prev) => new Set(prev).add(key));
    try {
      await Api.preCheckinCancel(item.id, employee?.id);
      // Cancela o pré-cadastro inteiro (todas as crianças ainda pendentes
      // dele) — quem já ganhou pulseira não é afetado, só já não aparece
      // mais nesta lista de pendentes.
      setPendingPreCheckins((prev) => prev.filter((p) => p.id !== item.id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível descartar o pré-cadastro.");
    } finally {
      setPreCheckinBusy((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  // Selo VIP dos cards. Uma chamada para a lista inteira, refeita só quando
  // o conjunto de crianças no salão muda — o `useActiveSessions` recalcula
  // a contagem regressiva a cada segundo, e pendurar isto no mesmo tick
  // seria uma consulta por segundo para um dado que muda uma vez por visita.
  const childIdsKey = entries
    .map((e) => e.session.child_id)
    .sort()
    .join(",");
  useEffect(() => {
    if (!unit || childIdsKey === "") {
      setVipChildIds(new Set());
      return;
    }
    let cancelled = false;
    Api.vipFlags(unit.id, childIdsKey.split(","))
      .then((flags) => {
        if (cancelled) return;
        setVipChildIds(new Set([...flags.values()].filter((f) => f.is_vip).map((f) => f.child_id)));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [unit?.id, childIdsKey]);

  // Faturamento muda bem mais devagar que a ocupação — repolla num intervalo mais espaçado.
  useEffect(() => {
    if (!unit) return;
    let cancelled = false;
    async function poll() {
      try {
        const [goal, revenue, ticketMedio, ticketGoal] = await Promise.all([
          Api.todayGoal(unit!.id, unit!.business_day_cutoff_hour),
          Api.todayRevenue(unit!.id, unit!.business_day_cutoff_hour),
          Api.todayTicketMedio(unit!.id, unit!.business_day_cutoff_hour),
          Api.ticketGoal(unit!.id),
        ]);
        if (!cancelled) {
          setDailyGoalCents(goal || 0);
          setTodayRevenueCents(revenue.totalCents);
          setTicketMedioCents(ticketMedio.avgCents);
          setTodayOrdersCount(ticketMedio.ordersCount);
          setTicketMinCents(ticketGoal?.minTicketCents ?? 0);
          setTicketTargetCents(ticketGoal?.targetTicketCents ?? 0);
        }
      } catch {
        // Meta é um extra informativo — se o backend ainda não tiver essas rotas (ex: servidor não reiniciado), o Painel segue funcionando sem o banner.
      }
    }
    poll();
    const interval = setInterval(poll, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [unit]);

  async function notifyGuardian(entry: ActiveSessionEntry, channel: "WHATSAPP" | "SMS", customMessage?: string) {
    const sessionId = entry.session.id;
    const guardianName = entry.session.guardian_name_snapshot || "Responsável";
    const message =
      customMessage ??
      `Olá ${guardianName}! ${entry.session.child_name_snapshot} está no plano ${entry.plan.name} — valor atual: ${money(entry.quote.totalCents)}.`;
    setActionBusy((prev) => new Set(prev).add(sessionId));
    try {
      if (channel === "WHATSAPP") {
        const digits = (entry.session.guardian_phone_snapshot || "").replace(/\D/g, "");
        if (digits) window.open(`https://wa.me/${digits}?text=${encodeURIComponent(message)}`, "_blank");
      }
      await Api.notifySession(sessionId, { channel, message });
      if (channel === "SMS") {
        toast.success("SMS simulado — nenhum provedor configurado ainda. Registrado no histórico da sessão.");
      } else {
        toast.success("Responsável notificado.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível registrar a notificação.");
    } finally {
      setActionBusy((prev) => {
        const next = new Set(prev);
        next.delete(sessionId);
        return next;
      });
    }
  }

  async function callGuardianBack(entry: ActiveSessionEntry) {
    const guardianName = entry.session.guardian_name_snapshot || "Responsável";
    const ok = await confirm({
      title: "Chamar responsável com urgência?",
      message: `Isso envia uma mensagem urgente pelo WhatsApp para o responsável de ${entry.session.child_name_snapshot} pedindo para comparecer agora.`,
      confirmLabel: "Enviar chamado",
      cancelLabel: "Cancelar",
      variant: "danger",
    });
    if (!ok) return;
    await notifyGuardian(
      entry,
      "WHATSAPP",
      `URGENTE: ${guardianName}, por favor compareça ao parque — ${entry.session.child_name_snapshot} precisa de você (banheiro / quer ir embora).`,
    );
  }

  async function confirmChangePlan(sessionId: string) {
    if (!pendingPlanId) return;
    setActionBusy((prev) => new Set(prev).add(sessionId));
    try {
      await Api.changeSessionPlan(sessionId, pendingPlanId);
      setChangingPlanFor(null);
      setPendingPlanId("");
      toast.success("Plano atualizado.");
      // fa_kiosk_sessions muda -> Realtime dispara refetch em useActiveSessions automaticamente.
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível trocar o plano.");
    } finally {
      setActionBusy((prev) => {
        const next = new Set(prev);
        next.delete(sessionId);
        return next;
      });
    }
  }

  async function confirmPauseSession(sessionId: string) {
    if (!pendingPauseReason) return;
    setActionBusy((prev) => new Set(prev).add(sessionId));
    try {
      await Api.pauseSession(sessionId, pendingPauseReason);
      setPausingFor(null);
      setPendingPauseReason("");
      toast.success("Tempo pausado.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível pausar o tempo.");
    } finally {
      setActionBusy((prev) => {
        const next = new Set(prev);
        next.delete(sessionId);
        return next;
      });
    }
  }

  async function resumeSession(sessionId: string) {
    setActionBusy((prev) => new Set(prev).add(sessionId));
    try {
      await Api.resumeSession(sessionId);
      toast.success("Tempo retomado.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível retomar o tempo.");
    } finally {
      setActionBusy((prev) => {
        const next = new Set(prev);
        next.delete(sessionId);
        return next;
      });
    }
  }

  function guardianKeyOf(entry: ActiveSessionEntry): string {
    return entry.session.guardian_id ?? entry.session.guardian_name_snapshot ?? entry.session.id;
  }

  function toggle(sessionId: string) {
    const entry = entries.find((e) => e.session.id === sessionId);
    if (!entry) return;
    const guardianKey = guardianKeyOf(entry);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) {
        next.delete(sessionId);
        return next;
      }
      // Só permite empilhar mais de 1 card se todos forem do mesmo
      // responsável (famílias com mais de uma criança) — misturar
      // responsáveis diferentes num único fechamento não faz sentido.
      if (next.size > 0) {
        const firstSelected = entries.find((e) => next.has(e.session.id));
        const sameGuardian = firstSelected ? guardianKeyOf(firstSelected) === guardianKey : true;
        if (!sameGuardian) {
          toast.error("Só dá para selecionar mais de uma sessão do mesmo responsável.");
          return new Set([sessionId]);
        }
      }
      next.add(sessionId);
      return next;
    });
  }

  if (!unit) return null;

  const maxCapacity = unit.kind === "LOJA" ? 22 : (assets.length > 0 ? assets.length : 12);
  const currentOccupancy = entries.length;
  const occupancyPercent = Math.min(100, Math.round((currentOccupancy / maxCapacity) * 100));

  // capacityColor pinta a barra (preenchimento — a cor de marca serve,
  // só precisa de 3:1); capacityTextColor é o mesmo rótulo, mas como
  // TEXTO ao lado, que precisa de 4.5:1. --color-success (2.17:1) e
  // --color-amber (2.80:1) puros como texto falhavam os dois.
  let capacityColor = "var(--color-success)";
  let capacityTextColor = "var(--color-success-text)";
  let capacityLabel = "Capacidade Tranquila";
  if (occupancyPercent >= 90) {
    capacityColor = "var(--color-error)";
    capacityTextColor = "var(--color-error-text)";
    capacityLabel = "Capacidade Máxima / Lotação";
  } else if (occupancyPercent >= 75) {
    capacityColor = "var(--color-amber)";
    capacityTextColor = "var(--color-amber-text)";
    capacityLabel = "Alta Ocupação";
  }

  const selectedEntries = entries.filter((e) => selected.has(e.session.id));

  return (
    // height:100% + minHeight:0: o Painel ocupa exatamente o espaço do
    // <main> do shell (ver App.tsx) e nunca mais que isso — só a lista de
    // sessões (abaixo) rola internamente quando não cabe tudo. Cabeçalho,
    // meta do dia e os botões flutuantes ficam sempre visíveis, sem rolar
    // a página inteira, no computador, tablet ou celular.
    <div className="painel-shell" style={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column", padding: "clamp(12px, 2.5vw, 24px)", gap: "clamp(10px, 2vw, 20px)" }}>
      <div style={{ flexShrink: 0, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "16px" }}>
        <div>
          <h1 style={{ fontFamily: "var(--font-display)", margin: 0, fontSize: "clamp(20px, 3vw, 28px)" }}>Painel</h1>
          <p style={{ margin: "4px 0 0 0", color: "var(--text-secondary)", fontSize: "14px" }}>
            {unit.kind === "QUIOSQUE"
              ? "Acompanhamento em tempo real dos carrinhos no circuito"
              : "Acompanhamento em tempo real das crianças no playground"}
          </p>
          <HelpText style={{ marginTop: "4px" }}>
            Toque num cartão para selecioná-lo (fica com borda rosa) e depois em "Fechar sessões" para cobrar. O
            rótulo colorido (verde/amarelo/vermelho) mostra o tempo restante do plano — vermelho já ultrapassou.
          </HelpText>
        </div>

        {/* Gauge de Ocupação do Parque */}
        <div style={{ minWidth: "280px", flex: "0 1 340px" }} className="capacity-container">
          <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: "4px 10px", fontSize: "13px", fontWeight: "bold" }}>
            <span>Ocupação: {currentOccupancy} / {maxCapacity} {unit.kind === "QUIOSQUE" ? "carrinhos" : "crianças"}</span>
            <span style={{ color: capacityTextColor }}>{occupancyPercent}% ({capacityLabel})</span>
          </div>
          <div className="capacity-bar-track">
            <div className="capacity-bar-fill" style={{ width: `${occupancyPercent}%`, backgroundColor: capacityColor }} />
          </div>
        </div>
      </div>

      {/* Se já havia sessões na tela e a última reconsulta falhou (ex: uma
          troca de Realtime disparou refetch e a rede caiu), mantém o
          último dado bom visível — mas avisa, em vez de deixar a tela
          parar de atualizar em silêncio sem nenhum sinal disso. */}
      {sessionsStatus === "error" && entries.length > 0 && (
        <div
          role="alert"
          style={{ flexShrink: 0, fontSize: "13px", color: "var(--color-error-text)", background: "rgba(232,48,48,0.08)", border: "1px solid var(--color-error)", borderRadius: "10px", padding: "8px 12px" }}
        >
          ⚠️ Não foi possível atualizar o painel — os dados abaixo podem estar desatualizados.
        </div>
      )}

      {/* Pré-cadastros do QR de Acesso Rápido: o responsável já preencheu
          tudo pelo próprio celular na entrada da unidade — o operador só
          confere e toca em "Confirmar entrada" (abre EntradaScreen já
          preenchida). Fica antes da grade normal, de propósito: é fila de
          espera, não uma sessão em andamento. */}
      {pendingPreCheckins.length > 0 && (
        <div
          style={{
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            padding: "10px 12px",
            borderRadius: "14px",
            border: "1px dashed var(--color-teal)",
            background: "rgba(29, 155, 132, 0.06)",
          }}
        >
          <strong style={{ fontSize: "13px", color: "var(--color-teal-text)" }}>
            🕓 {pendingPreCheckins.length} pré-cadastro{pendingPreCheckins.length > 1 ? "s" : ""} aguardando pelo QR de
            Acesso Rápido
          </strong>
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            {pendingPreCheckins.map((item) => (
              <div
                key={`${item.id}:${item.childIndex}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "8px 10px",
                  borderRadius: "12px",
                  border: "1px solid var(--border-subtle)",
                  background: "var(--surface-card)",
                }}
              >
                <span
                  title="PIN que o responsável fala no balcão — confira antes de confirmar"
                  style={{
                    fontFamily: "var(--font-display)",
                    fontSize: "18px",
                    letterSpacing: "0.06em",
                    color: "var(--color-primary-hover)",
                    background: "rgba(240, 25, 107, 0.08)",
                    borderRadius: "10px",
                    padding: "4px 8px",
                  }}
                >
                  {item.pin}
                </span>
                <div>
                  <strong style={{ fontSize: "13px", display: "block" }}>
                    {item.childName}{(item.inclusiveEligible || (item.sensoryTags?.length ?? 0) > 0 || item.notes?.toLowerCase().includes("neuro")) && !item.childName.includes("🧩") ? " 🧩" : ""}
                    {item.totalChildren > 1 && (
                      <span style={{ fontWeight: 400, color: "var(--text-muted)" }}> ({item.childIndex + 1}/{item.totalChildren})</span>
                    )}
                  </strong>
                  <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                    {item.guardianName} · {item.planName}
                  </span>
                </div>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={preCheckinBusy.has(`${item.id}:${item.childIndex}`)}
                  onClick={() => openPreCheckin(item)}
                  title="Abrir Entrada já preenchida com os dados enviados pelo responsável"
                >
                  Confirmar
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={preCheckinBusy.has(`${item.id}:${item.childIndex}`)}
                  onClick={() => cancelPreCheckin(item)}
                  title={item.totalChildren > 1 ? "Descartar todo o pré-cadastro (todas as crianças ainda pendentes desta família)" : "Descartar este pré-cadastro (duplicado, desistência)"}
                  aria-label="Descartar pré-cadastro"
                >
                  <XIcon />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Única área com rolagem própria da tela — contida, nunca a página toda.
          No celular (.painel-scroll no app.css) isso é desligado: a
          prioridade lá é ver o quadro inteiro, então quem rola é a página. */}
      <div className="painel-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", paddingRight: "4px" }}>
        <div className="painel-grid">
        {entries.map((entry) => {
          const { session, quote, plan, asset } = closingSnapshot.get(entry.session.id) ?? entry;
          const isSelected = selected.has(session.id);
          const isExceeded = quote.timing.phase === "EXCEDENTE" || quote.timing.phase === "VERMELHO";
          const isPaused = quote.timing.isPaused;
          const isPausedTooLong = isPaused && quote.timing.pausedForMs >= PAUSE_ALERT_MS;
          const overageLine = quote.lines.find((l) => l.label.startsWith("Excedente"));
          // access_code é o código curto novo; wristband_code cobre as
          // pulseiras impressas antes da migração 20260807000007, que ainda
          // circulam no pulso de quem entrou naquele dia.
          const wristbandCode = session.access_code || session.wristband_code || session.id.slice(0, 6).toUpperCase();
          const careSummary = [...(session.sensory_tags ?? []), session.notes].filter(Boolean).join(" · ");
          const isNeurodivergent = Boolean(
            (session.sensory_tags?.length ?? 0) > 0 ||
            session.notes?.toLowerCase().includes("neuro") ||
            session.notes?.toLowerCase().includes("autis") ||
            session.notes?.toLowerCase().includes("tea") ||
            session.child_name_snapshot.includes("🧩")
          );

          return (
            <Card
              key={session.id}
              onClick={() => !isPaused && toggle(session.id)}
              // "Selecionada para cobrança" antes só existia como borda
              // rosa + fundo 4% rosa — nenhum texto/ícone de apoio, e é
              // o estado que decide quem paga. aria-pressed marca o
              // alternador pra leitor de tela; o selo "✓ Selecionada"
              // abaixo é o reforço visual que não depende só de cor.
              aria-pressed={!isPaused ? isSelected : undefined}
              // painel-card cuida de padding/gap/raio de forma fluida (app.css);
              // aqui ficam só os estilos que dependem do estado da sessão.
              // Sem animação: a marca proíbe loop infinito em UI (ver
              // print.css), então a urgência é só borda mais grossa +
              // selo de texto sempre visível (abaixo), nunca movimento.
              className="painel-card"
              // O respiro do card acompanha a largura do próprio card (cqi),
              // não a da janela — ver .painel-card em app.css. Vai em
              // bodyStyle porque é lá que os filhos ficam; `flex:1` é o que
              // permite ao rodapé de valor grudar embaixo com marginTop:auto.
              bodyStyle={{
                position: "relative",
                flex: 1,
                display: "flex",
                flexDirection: "column",
                gap: "clamp(8px, 2.5cqi, 12px)",
                padding: "clamp(12px, 4.5cqi, 18px)",
              }}
              style={{
                cursor: isPaused ? "default" : "pointer",
                display: "flex",
                flexDirection: "column",
                borderRadius: "16px",
                border: isPausedTooLong
                  ? "3px solid var(--color-amber)"
                  : isPaused
                  ? "2px dashed var(--color-amber)"
                  : isSelected
                  ? "2px solid var(--color-primary)"
                  : isExceeded
                  ? "3px solid var(--color-error)"
                  : "1px solid var(--border-subtle)",
                borderLeft: `6px solid ${plan?.color ?? "var(--border-subtle)"}`,
                background: isPaused ? "rgba(201, 144, 32, 0.06)" : isSelected ? "rgba(240, 25, 107, 0.04)" : "var(--surface-card)",
                opacity: isPaused ? 0.85 : 1,
              }}
            >
              {/* Símbolo do autismo com fundo transparente, sutil no fundo para sinalização discreta do operador sem atrapalhar a visualização */}
              {isNeurodivergent && (
                <div
                  aria-hidden="true"
                  title="Criança Neurodivergente / TEA — Sinalização para o operador"
                  style={{
                    position: "absolute",
                    right: "12px",
                    bottom: "10px",
                    opacity: 0.12,
                    pointerEvents: "none",
                    zIndex: 0,
                    userSelect: "none",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <AutismRibbonIcon width={58} height={72} />
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", position: "relative", zIndex: 1 }}>
                <div style={{ display: "flex", gap: "10px", alignItems: "flex-start", minWidth: 0, flex: 1 }}>
                  {asset && (
                    asset.photo_url ? (
                      <img
                        src={asset.photo_url}
                        alt={asset.name}
                        title={`Carrinho: ${asset.name}`}
                        className="painel-card-thumb-img"
                        style={{ objectFit: "cover", borderRadius: "12px", border: "1px solid var(--border-subtle)", flexShrink: 0 }}
                      />
                    ) : (
                      <span title={`Carrinho: ${asset.name}`} className="painel-card-thumb-emoji">
                        {asset.emoji}
                      </span>
                    )
                  )}
                  <div style={{ minWidth: 0 }}>
                    <strong className="painel-card-name" style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                      {/* Selo estático com o Símbolo oficial do Autismo, ao lado do nome:
                          sinaliza ao operador de forma visual e acolhedora. */}
                      {isNeurodivergent && (
                        <Badge
                          variant="teal"
                          title="Criança com Autismo / Neurodivergente — Atendimento Inclusivo"
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "5px",
                            padding: "2px 7px",
                            background: "rgba(0, 168, 89, 0.08)",
                            border: "1px solid rgba(0, 168, 89, 0.25)",
                          }}
                        >
                          <AutismRibbonIcon width={13} height={16} style={{ flexShrink: 0 }} />
                          <span>Neurodivergente</span>
                        </Badge>
                      )}
                      {vipChildIds.has(session.child_id) && (
                        <Badge variant="vip" title="Cliente VIP — 4 ou mais visitas nos últimos 30 dias">
                          ★ VIP
                        </Badge>
                      )}
                      {session.child_name_snapshot}{isNeurodivergent && !session.child_name_snapshot.includes("🧩") ? " 🧩" : ""}
                      {session.child_birth_date && (
                        <span style={{ fontSize: "12px", fontWeight: "normal", color: "var(--text-muted)" }}>· {formatAge(session.child_birth_date)}</span>
                      )}
                    </strong>
                    {session.guardian_name_snapshot && (
                      <span style={{ fontSize: "12px", color: "var(--text-muted)", display: "block" }}>Responsável: {session.guardian_name_snapshot}</span>
                    )}
                    <span style={{ fontSize: "12px", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap", margin: "2px 0" }}>
                      <span>Pulseira: <strong>#{getFriendlyWristbandCode(wristbandCode)}</strong></span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setQrModalSession({
                            code: wristbandCode,
                            childName: session.child_name_snapshot,
                            guardianName: session.guardian_name_snapshot || "",
                          });
                        }}
                        style={{
                          background: "rgba(240,25,107,0.08)",
                          border: "1px solid rgba(240,25,107,0.25)",
                          borderRadius: "var(--radius-full)",
                          padding: "2px 8px",
                          fontSize: "11px",
                          cursor: "pointer",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "4px",
                          color: "var(--color-primary-hover)",
                          fontWeight: "var(--weight-bold)" as unknown as number,
                        }}
                        title="Clique para visualizar o QR Code da pulseira em tamanho grande"
                      >
                        <span>📱 QR Code</span>
                      </button>
                    </span>
                    {session.exit_pin && (
                      <span style={{ fontSize: "12px", color: "var(--text-muted)", display: "block", margin: "2px 0" }}>
                        <RevealPin pin={session.exit_pin} label="PIN de saída" />
                      </span>
                    )}
                    {asset && <span style={{ fontSize: "12px", color: "var(--text-muted)", display: "block" }}>Carrinho: {asset.name}</span>}
                    {plan && (
                      <Tag color={plan.color} title="Plano de permanência escolhido para esta criança">{plan.name}</Tag>
                    )}
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px", flexShrink: 0 }}>
                  {isSelected && !isPaused && (
                    <Badge variant="solid_pink" title="Esta sessão entra no próximo fechamento">
                      ✓ Selecionada
                    </Badge>
                  )}
                </div>
              </div>

              <StatusBadge
                phase={quote.timing.phase}
                detail={formatElapsed(quote.timing.elapsedMs)}
                size="lg"
                title={isPaused ? "Tempo congelado enquanto a sessão está pausada" : "Tempo de permanência desde a entrada — base para a cobrança"}
                style={isPaused ? { opacity: 0.6 } : undefined}
              />

              {isPaused && (
                <Badge
                  variant={isPausedTooLong ? "solid_pink" : "solid_amber"}
                  title="Relógio parado — retome quando a criança voltar"
                >
                  ⏸ Pausada há {formatElapsed(quote.timing.pausedForMs)}
                  {isPausedTooLong ? " — retome agora" : ""}
                </Badge>
              )}

              {isExceeded && !isPaused && (
                <Badge variant="solid_pink" title="Tempo do plano já foi ultrapassado — minutos e valor extra somados em tempo real">
                  🔴 +{quote.timing.overMinutes} min excedente{overageLine ? ` (+${money(overageLine.cents)})` : ""}
                </Badge>
              )}

              {/* Pedido de renovação feito pelo responsável no painel público
                  (?acompanhar=) — só aparece enquanto ninguém do balcão
                  aplicar ou dispensar. "Aplicar" só marca o pedido como
                  atendido; a troca de plano em si continua pelo fluxo normal
                  (Trocar plano) ou pelo Caixa no fechamento. */}
              {pendingRenewals.has(session.id) && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    flexWrap: "wrap",
                    padding: "8px 10px",
                    borderRadius: "12px",
                    border: "1px solid rgba(240,25,107,0.25)",
                    background: "rgba(240,25,107,0.06)",
                  }}
                >
                  <Badge variant="solid_pink" title="O responsável pediu mais tempo pelo painel de acompanhamento no celular">
                    📱 Pediu +{pendingRenewals.get(session.id)!.minutes} min
                    {pendingRenewals.get(session.id)!.cents != null ? ` — ${money(pendingRenewals.get(session.id)!.cents!)}` : ""}
                  </Badge>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={renewalBusy.has(session.id)}
                    onClick={() => handleRenewalOutcome(session.id, "APLICADA")}
                  >
                    Já resolvi no balcão
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={renewalBusy.has(session.id)}
                    onClick={() => handleRenewalOutcome(session.id, "DISPENSADA")}
                  >
                    Dispensar
                  </Button>
                </div>
              )}

              {/* Saldo de pacote: o fechamento vai abater estes minutos, então
                  o valor estimado acima não é o que será cobrado. Dizer isso
                  aqui evita o operador contestar o próprio sistema no caixa. */}
              {(session.package_balance_minutes ?? 0) > 0 && (
                <Badge variant="solid_orange" title="Este responsável tem pacote pré-pago — o tempo sai do saldo no fechamento">
                  🎟️ Pacote: {session.package_balance_minutes} min de saldo
                </Badge>
              )}

              {careSummary && (
                <div style={{ fontSize: "12px", background: "rgba(201, 144, 32, 0.1)", padding: "6px 10px", borderRadius: "8px", color: "var(--color-dark)" }}>
                  💡 {careSummary}
                </div>
              )}

              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <Button
                  variant="ghost"
                  size="md"
                  title="Ver linha do tempo completa desta sessão: chegada, plano, pausas e retomadas"
                  onClick={(e) => {
                    e.stopPropagation();
                    setTimelineFor(entry);
                  }}
                >
                  📋 Sessão
                </Button>
                <Button
                  variant="primary"
                  size="md"
                  loading={actionBusy.has(session.id)}
                  disabled={actionBusy.has(session.id)}
                  title="Chamado de retorno urgente — o responsável precisa vir buscar/atender a criança agora (banheiro, quer ir embora)"
                  onClick={(e) => {
                    e.stopPropagation();
                    callGuardianBack(entry);
                  }}
                >
                  🚻 Chamado de Retorno
                </Button>
                {/* Trocar o plano de uma sessão já vendida é exceção de
                    atendimento, não rotina. Quem barra de verdade é o trigger
                    fa_kiosk_guard_session_exception (migration 20260807000006);
                    isto só evita mostrar ao Operador um botão que vai falhar. */}
                <IfCan capability="sessao.change_plan">
                  <Button
                    variant="ghost"
                    size="md"
                    disabled={actionBusy.has(session.id)}
                    title="Trocar o plano de permanência desta sessão"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPendingPlanId("");
                      setChangingPlanFor(changingPlanFor === session.id ? null : session.id);
                    }}
                  >
                    🔄 Mudar Plano
                  </Button>
                </IfCan>
                <Button
                  variant="ghost"
                  size="md"
                  title="Imprimir Pulseira Térmica"
                  aria-label="Imprimir Pulseira Térmica"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPrintData({
                      wristbandCode,
                      childName: ((session.sensory_tags?.length ?? 0) > 0 || session.notes?.toLowerCase().includes("neuro")) && !session.child_name_snapshot.includes("🧩")
                        ? `${session.child_name_snapshot} 🧩`
                        : session.child_name_snapshot,
                      guardianName: session.guardian_name_snapshot || "Responsável",
                      phone: session.guardian_phone_snapshot || "",
                      entryTime: new Date(session.checkin_at_ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
                      notes: careSummary || undefined,
                    });
                  }}
                >
                  <PrinterIcon /> Pulseira
                </Button>
                {/* Contingência de saída. Fica no card, e não escondido num
                    menu, porque é usado justamente quando algo já deu errado
                    e o operador está sob pressão com a família na frente. */}
                <Button
                  variant="ghost"
                  size="md"
                  disabled={isPaused || actionBusy.has(session.id)}
                  title={
                    isPaused
                      ? "Retome a contagem antes de liberar a criança"
                      : "Recibo perdido ou etiqueta danificada: liberar conferindo o documento do responsável"
                  }
                  onClick={(e) => {
                    e.stopPropagation();
                    setManualExitFor(entry);
                  }}
                >
                  🪪 Saída manual
                </Button>
                {isPaused ? (
                  <Button
                    variant="teal"
                    size="md"
                    loading={actionBusy.has(session.id)}
                    disabled={actionBusy.has(session.id)}
                    title="Retomar a contagem do tempo desta sessão"
                    onClick={(e) => {
                      e.stopPropagation();
                      resumeSession(session.id);
                    }}
                  >
                    ▶ Retomar
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="md"
                    disabled={actionBusy.has(session.id)}
                    title="Pausar a contagem do tempo — banheiro, saiu do espaço, etc."
                    onClick={(e) => {
                      e.stopPropagation();
                      setPendingPauseReason("");
                      setPausingFor(pausingFor === session.id ? null : session.id);
                    }}
                  >
                    ⏸ Pausar
                  </Button>
                )}
              </div>

              {pausingFor === session.id && (
                <div style={{ display: "flex", gap: "6px" }} onClick={(e) => e.stopPropagation()}>
                  <Select
                    value={pendingPauseReason}
                    title="Selecione o motivo da pausa"
                    onChange={(e) => setPendingPauseReason(e.target.value)}
                    style={{ height: "40px", fontSize: "14px" }}
                  >
                    <option value="" disabled>
                      Motivo da pausa...
                    </option>
                    {PAUSE_REASONS.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </Select>
                  <Button
                    variant="primary"
                    size="sm"
                    loading={actionBusy.has(session.id)}
                    disabled={!pendingPauseReason || actionBusy.has(session.id)}
                    title="Confirmar a pausa desta sessão"
                    onClick={() => confirmPauseSession(session.id)}
                  >
                    Confirmar
                  </Button>
                </div>
              )}

              {changingPlanFor === session.id && (
                <div style={{ display: "flex", gap: "6px" }} onClick={(e) => e.stopPropagation()}>
                  <Select
                    value={pendingPlanId}
                    title="Selecione o novo plano para esta sessão"
                    onChange={(e) => setPendingPlanId(e.target.value)}
                    style={{ height: "40px", fontSize: "14px" }}
                  >
                    <option value="" disabled>
                      Escolher novo plano...
                    </option>
                    {planOptions.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} — {money(p.valueCents)}
                      </option>
                    ))}
                  </Select>
                  <Button
                    variant="primary"
                    size="sm"
                    loading={actionBusy.has(session.id)}
                    disabled={!pendingPlanId || actionBusy.has(session.id)}
                    title="Confirmar a troca de plano desta sessão"
                    onClick={() => confirmChangePlan(session.id)}
                  >
                    Confirmar
                  </Button>
                </div>
              )}

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "auto", paddingTop: "8px", borderTop: "1px dashed var(--border-subtle)" }}>
                <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>Valor Atual:</span>
                <strong className="painel-card-total" style={{ color: "var(--color-primary-hover)" }}>{money(quote.totalCents)}</strong>
              </div>
            </Card>
          );
        })}
        {entries.length === 0 && sessionsStatus === "loading" && (
          <AsyncState kind="loading" title="Carregando sessões ativas…" style={{ gridColumn: "1 / -1" }} />
        )}
        {entries.length === 0 && sessionsStatus === "ready" && (
          <AsyncState kind="empty" title="Nenhuma criança em atividade no momento." style={{ gridColumn: "1 / -1" }} />
        )}
        {entries.length === 0 && sessionsStatus === "error" && (
          <AsyncState
            kind="error"
            title="Não foi possível carregar as sessões ativas."
            detail={sessionsError ?? undefined}
            style={{ gridColumn: "1 / -1" }}
          />
        )}
        </div>
      </div>

      {dailyGoalCents > 0 && (
        <div
          title="Progresso do faturamento de hoje em relação à meta diária configurada em Configurações → Meta"
          style={{ flexShrink: 0, minWidth: "280px", maxWidth: "480px" }}
          className="capacity-container"
        >
          <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: "4px 10px", fontSize: "12px", color: "var(--text-muted)" }}>
            <span>Meta do dia: {money(todayRevenueCents)} / {money(dailyGoalCents)}</span>
            <span>{Math.min(100, Math.round((todayRevenueCents / dailyGoalCents) * 100))}%</span>
          </div>
          <div className="capacity-bar-track">
            <div
              className="capacity-bar-fill"
              style={{
                width: `${Math.min(100, Math.round((todayRevenueCents / dailyGoalCents) * 100))}%`,
                backgroundColor: todayRevenueCents >= dailyGoalCents ? "var(--color-success)" : "var(--color-primary)",
              }}
            />
          </div>
        </div>
      )}

      {ticketTargetCents > 0 && (
        <div
          title="Ticket médio de hoje comparado ao mínimo e ao alvo configurados pelo Owner em Gerencial → Metas"
          style={{ flexShrink: 0, minWidth: "280px", maxWidth: "480px" }}
          className="capacity-container"
        >
          {(() => {
            const zoneColor =
              ticketMedioCents < ticketMinCents
                ? "var(--color-error)"
                : ticketMedioCents < ticketTargetCents
                  ? "var(--color-amber)"
                  : "var(--color-success)";
            const percent = Math.min(100, Math.round((ticketMedioCents / ticketTargetCents) * 100));
            return (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: "4px 10px", fontSize: "12px", color: "var(--text-muted)" }}>
                  <span>🌡️ Ticket Médio hoje: {money(ticketMedioCents)} (mín {money(ticketMinCents)} / alvo {money(ticketTargetCents)})</span>
                  <span style={{ color: zoneColor, fontWeight: "bold" }}>{percent}%</span>
                </div>
                <div className="capacity-bar-track">
                  <div className="capacity-bar-fill" style={{ width: `${percent}%`, backgroundColor: zoneColor }} />
                </div>
              </>
            );
          })()}
        </div>
      )}

      {unit && dentroDoPiloto(businessDateFor(Date.now(), unit.business_day_cutoff_hour)) && (() => {
        const tipo = unit.kind === "QUIOSQUE" ? "CIRCUITO" : "PLAYGROUND";
        const businessDate = businessDateFor(Date.now(), unit.business_day_cutoff_hour);
        const atual = tipo === "CIRCUITO" ? todayOrdersCount : todayRevenueCents;
        const b = bonificacaoHoje(tipo, businessDate, atual);
        const corNivel = b.nivel === "supermeta" ? "var(--color-amber)" : b.nivel === "meta" ? "var(--color-success)" : "var(--color-primary)";
        const badgeVariant = b.nivel === "supermeta" ? "solid_amber" : b.nivel === "meta" ? "green" : "neutral";
        const badgeLabel = b.nivel === "supermeta" ? "🏆 Supermeta!" : b.nivel === "meta" ? "🥈 Meta batida!" : "Em andamento";
        const atualLabel = tipo === "CIRCUITO" ? `${b.atual} locações` : money(b.atual);
        const metaLabel = tipo === "CIRCUITO" ? `${b.meta}` : money(b.meta);
        const superLabel = tipo === "CIRCUITO" ? `${b.super}` : money(b.super);
        return (
          <div
            title="Piloto de Bonificação (08/09 a 05/10) — placar ao vivo. Só conta de verdade se o caixa abrir até 10h15 e fechar sem diferença; o valor final sai do relatório oficial, não deste card."
            style={{ flexShrink: 0, minWidth: "280px", maxWidth: "480px" }}
            className="capacity-container"
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "4px 10px", fontSize: "12px", color: "var(--text-muted)" }}>
              <span>
                🎮 Bonificação de hoje: {atualLabel} (meta {metaLabel} / super {superLabel})
              </span>
              <Badge variant={badgeVariant}>{badgeLabel}</Badge>
            </div>
            <div className="capacity-bar-track">
              <div className="capacity-bar-fill" style={{ width: `${b.percent}%`, backgroundColor: corNivel }} />
            </div>
            <div style={{ fontSize: "12px", color: "var(--text-muted)", display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: "4px 10px" }}>
              <span>Bônus estimado do dia: <strong style={{ color: "var(--text-primary)" }}>{money(b.bonusCents)}</strong></span>
              <span>Vale se abrir até 10h15 e fechar sem diferença</span>
            </div>
          </div>
        );
      })()}

      {selected.size > 0 && (
        <div style={{ position: "fixed", bottom: "24px", left: "50%", transform: "translateX(-50%)", zIndex: 100 }}>
          <Button
            variant="primary"
            size="lg"
            onClick={() => {
              setClosingSnapshot(new Map(selectedEntries.map((e) => [e.session.id, e])));
              setCheckoutOpen(true);
            }}
            style={{ boxShadow: "var(--shadow-lg)" }}
          >
            Fechar {selected.size} {selected.size === 1 ? "sessão" : "sessões"}
          </Button>
        </div>
      )}

      {checkoutOpen && (
        <CheckoutModal
          entries={selectedEntries}
          onClose={() => {
            setCheckoutOpen(false);
            setClosingSnapshot(new Map());
          }}
          onDone={() => {
            setCheckoutOpen(false);
            setSelected(new Set());
            // Só solta o snapshot congelado depois que `entries` já refletir
            // o fechamento no servidor — sem isso, se o Realtime ainda não
            // tiver entregue o UPDATE de status, o card volta a renderizar a
            // partir do `entries` desatualizado (ainda ATIVA) e o
            // cronômetro/excedente parecem "continuar contando" mesmo com a
            // sessão já paga e fechada no banco.
            refetchActiveSessions().finally(() => setClosingSnapshot(new Map()));
          }}
        />
      )}

      {manualExitFor && (
        <SaidaManualModal
          entry={manualExitFor}
          onClose={() => setManualExitFor(null)}
          onAuthorized={() => {
            // Conferência registrada — a cobrança segue pelo mesmo caminho
            // do fechamento normal, para não existir uma segunda forma de
            // fechar venda no sistema.
            setSelected(new Set([manualExitFor.session.id]));
            setClosingSnapshot(new Map([[manualExitFor.session.id, manualExitFor]]));
            setManualExitFor(null);
            setCheckoutOpen(true);
            toast.success("Conferência registrada. Finalize o pagamento.");
          }}
        />
      )}

      {printData && (
        <WristbandPrintModal
          data={printData}
          onClose={() => setPrintData(null)}
        />
      )}

      {timelineFor && <SessionTimelineModal entry={timelineFor} onClose={() => setTimelineFor(null)} />}



      {/* Botões flutuantes: Painel é a tela principal — Entrada e PDV abrem por cima, sem sair dele */}
      <div style={{ position: "fixed", bottom: "24px", right: "24px", zIndex: 90, display: "flex", flexDirection: "column", gap: "14px", alignItems: "flex-end" }}>
        <Button
          variant="teal"
          size="lg"
          onClick={() => setPdvOpen(true)}
          title="Abrir PDV flutuante e fechar vendas sem sair do Painel"
          aria-label="Abrir PDV"
          style={{ borderRadius: "9999px", width: "64px", height: "64px", fontSize: "26px", boxShadow: "var(--shadow-lg)", padding: 0 }}
        >
          <ShoppingCartIcon />
        </Button>
        <Button
          variant="primary"
          size="lg"
          onClick={() => {
            setPreCheckinPrefill(null);
            setEntradaOpen(true);
          }}
          title="Fazer nova entrada sem sair do Painel"
          aria-label="Fazer nova entrada"
          style={{ borderRadius: "9999px", width: "64px", height: "64px", fontSize: "26px", boxShadow: "var(--shadow-lg)", padding: 0 }}
        >
          <PlusIcon />
        </Button>
      </div>

      {entradaOpen && (
        <Modal
          onClose={() => {
            setEntradaOpen(false);
            setPreCheckinPrefill(null);
          }}
          ariaLabel="Entrada"
          maxWidth="820px"
          padding="0"
          zIndex={150}
        >
          <EntradaScreen
            onSuccess={() => { refetchActiveSessions(); }}
            prefill={preCheckinPrefill}
            onPrefillConsumed={() => {
              setPreCheckinPrefill(null);
              refetchPendingPreCheckins();
            }}
          />
        </Modal>
      )}

      {pdvOpen && (
        <Modal onClose={() => setPdvOpen(false)} ariaLabel="PDV" maxWidth="1100px" padding="0" zIndex={150}>
          <PdvScreen />
        </Modal>
      )}

      {saidaOpen && (
        <Modal onClose={() => setSaidaOpen(false)} ariaLabel="Saída" maxWidth="600px" padding="0" zIndex={150}>
          <SaidaScreen entriesOverride={entries} />
        </Modal>
      )}

      {qrModalSession && (
        <Modal
          title={`Pulseira de ${qrModalSession.childName}`}
          onClose={() => setQrModalSession(null)}
          maxWidth="380px"
          zIndex={160}
        >
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "16px", padding: "12px 0", textAlign: "center" }}>
            <WristbandQRCode value={qrModalSession.code} size={220} />
            <div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: "22px", letterSpacing: "1px", background: "var(--surface-sunken)", color: "var(--text-primary)", padding: "8px 20px", borderRadius: "var(--radius-full)", border: "1px solid var(--border-subtle)", display: "inline-block" }}>
                #{getFriendlyWristbandCode(qrModalSession.code)}
              </div>
              {qrModalSession.guardianName && (
                <div style={{ marginTop: "8px", fontSize: "13px", color: "var(--text-muted)" }}>
                  Responsável: {qrModalSession.guardianName}
                </div>
              )}
            </div>
            <Button variant="secondary" onClick={() => setQrModalSession(null)}>
              Fechar
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

