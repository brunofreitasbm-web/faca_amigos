import { useEffect, useState } from "react";
import { Card, Button, StatusBadge, Badge, Tag } from "@facaamigos/ui";
import { Api } from "../api/client.js";
import type { ActiveSessionEntry, Plan } from "../api/client.js";
import { useActiveSessions } from "../api/useTick.js";
import { useAppState } from "../state/AppState.js";
import { useToast } from "../state/ToastContext.js";
import { useConfirm } from "../state/ConfirmContext.js";
import { CheckoutModal } from "../components/CheckoutModal.js";
import { WristbandPrintModal } from "../components/WristbandPrintModal.js";
import type { WristbandData } from "../components/WristbandPrintModal.js";
import { formatAge, formatElapsed, money } from "../format.js";
import { EntradaScreen } from "./EntradaScreen.js";
import { PdvScreen } from "./PdvScreen.js";

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
  const { unit } = useAppState();
  const toast = useToast();
  const confirm = useConfirm();
  const entries = useActiveSessions(unit?.id ?? null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [actionBusy, setActionBusy] = useState<Set<string>>(new Set());
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [printData, setPrintData] = useState<WristbandData | null>(null);
  const [planOptions, setPlanOptions] = useState<Plan[]>([]);
  const [changingPlanFor, setChangingPlanFor] = useState<string | null>(null);
  const [pendingPlanId, setPendingPlanId] = useState<string>("");
  const [pausingFor, setPausingFor] = useState<string | null>(null);
  const [pendingPauseReason, setPendingPauseReason] = useState<string>("");
  const [dailyGoalCents, setDailyGoalCents] = useState(0);
  const [todayRevenueCents, setTodayRevenueCents] = useState(0);
  const [entradaOpen, setEntradaOpen] = useState(false);
  const [pdvOpen, setPdvOpen] = useState(false);

  useEffect(() => {
    if (!unit) return;
    const activity = unit.kind === "QUIOSQUE" ? "CARRINHO" : "PLAYGROUND";
    Api.plans(unit.id, activity).then(setPlanOptions);
  }, [unit]);

  // Faturamento muda bem mais devagar que a ocupação — repolla num intervalo mais espaçado.
  useEffect(() => {
    if (!unit) return;
    let cancelled = false;
    async function poll() {
      try {
        const [goal, revenue] = await Promise.all([
          Api.unitSetting(unit!.id, "daily_goal_cents"),
          Api.todayRevenue(unit!.id, unit!.business_day_cutoff_hour),
        ]);
        if (!cancelled) {
          setDailyGoalCents(Number(goal.value) || 0);
          setTodayRevenueCents(revenue.totalCents);
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

  function toggle(sessionId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
  }

  if (!unit) return null;

  const maxCapacity = unit.kind === "LOJA" ? 22 : 10;
  const currentOccupancy = entries.length;
  const occupancyPercent = Math.min(100, Math.round((currentOccupancy / maxCapacity) * 100));

  let capacityColor = "var(--color-success)";
  let capacityLabel = "Capacidade Tranquila";
  if (occupancyPercent >= 90) {
    capacityColor = "var(--color-error)";
    capacityLabel = "Capacidade Máxima / Lotação";
  } else if (occupancyPercent >= 75) {
    capacityColor = "var(--color-amber)";
    capacityLabel = "Alta Ocupação";
  }

  const selectedEntries = entries.filter((e) => selected.has(e.session.id));

  return (
    // height:100% + minHeight:0: o Painel ocupa exatamente o espaço do
    // <main> do shell (ver App.tsx) e nunca mais que isso — só a lista de
    // sessões (abaixo) rola internamente quando não cabe tudo. Cabeçalho,
    // meta do dia e os botões flutuantes ficam sempre visíveis, sem rolar
    // a página inteira, no computador, tablet ou celular.
    <div style={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column", padding: "clamp(12px, 2.5vw, 24px)", gap: "clamp(10px, 2vw, 20px)" }}>
      <div style={{ flexShrink: 0, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "16px" }}>
        <div>
          <h1 style={{ fontFamily: "var(--font-display)", margin: 0, fontSize: "clamp(20px, 3vw, 28px)" }}>Painel</h1>
          <p style={{ margin: "4px 0 0 0", color: "var(--text-secondary)", fontSize: "14px" }}>
            Acompanhamento em tempo real das crianças no playground
          </p>
        </div>

        {/* Gauge de Ocupação do Parque */}
        <div style={{ minWidth: "280px" }} className="capacity-container">
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", fontWeight: "bold" }}>
            <span>Ocupação: {currentOccupancy} / {maxCapacity} crianças</span>
            <span style={{ color: capacityColor }}>{occupancyPercent}% ({capacityLabel})</span>
          </div>
          <div className="capacity-bar-track">
            <div className="capacity-bar-fill" style={{ width: `${occupancyPercent}%`, backgroundColor: capacityColor }} />
          </div>
        </div>
      </div>

      {/* Única área com rolagem própria da tela — contida, nunca a página toda. */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", paddingRight: "4px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "16px" }}>
        {entries.map((entry) => {
          const { session, quote, plan, asset } = entry;
          const isSelected = selected.has(session.id);
          const isExceeded = quote.timing.phase === "EXCEDENTE" || quote.timing.phase === "VERMELHO";
          const isPaused = quote.timing.isPaused;
          const isPausedTooLong = isPaused && quote.timing.pausedForMs >= PAUSE_ALERT_MS;
          const overageLine = quote.lines.find((l) => l.label.startsWith("Excedente"));
          const wristbandCode = session.wristband_code || session.id.slice(0, 6).toUpperCase();

          return (
            <Card
              key={session.id}
              onClick={() => !isPaused && toggle(session.id)}
              className={(isExceeded && !isPaused) || isPausedTooLong ? "blinking" : undefined}
              style={{
                cursor: isPaused ? "default" : "pointer",
                padding: "16px",
                display: "flex",
                flexDirection: "column",
                gap: "10px",
                border: isPaused
                  ? "2px dashed var(--color-amber)"
                  : isSelected
                  ? "2px solid var(--color-primary)"
                  : isExceeded
                  ? "2px solid var(--color-error)"
                  : "1px solid var(--border-subtle)",
                borderLeft: `6px solid ${plan?.color ?? "var(--border-subtle)"}`,
                borderRadius: "16px",
                background: isPaused ? "rgba(201, 144, 32, 0.06)" : isSelected ? "rgba(240, 25, 107, 0.04)" : "var(--surface-card)",
                opacity: isPaused ? 0.85 : 1,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
                  {asset && (
                    asset.photo_url ? (
                      <img
                        src={asset.photo_url}
                        alt={asset.name}
                        title={`Carrinho: ${asset.name}`}
                        style={{ width: "44px", height: "44px", objectFit: "cover", borderRadius: "12px", border: "1px solid var(--border-subtle)", flexShrink: 0 }}
                      />
                    ) : (
                      <span title={`Carrinho: ${asset.name}`} style={{ fontSize: "32px", lineHeight: "44px" }}>
                        {asset.emoji}
                      </span>
                    )
                  )}
                  <div>
                    <strong style={{ fontSize: "18px", display: "block" }}>
                      {session.child_name_snapshot}
                      {session.child_birth_date && (
                        <span style={{ fontSize: "12px", fontWeight: "normal", color: "var(--text-muted)" }}> · {formatAge(session.child_birth_date)}</span>
                      )}
                    </strong>
                    {session.guardian_name_snapshot && (
                      <span style={{ fontSize: "12px", color: "var(--text-muted)", display: "block" }}>Responsável: {session.guardian_name_snapshot}</span>
                    )}
                    <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>Pulseira: #{wristbandCode}</span>
                    {asset && <span style={{ fontSize: "12px", color: "var(--text-muted)", display: "block" }}>Carrinho: {asset.name}</span>}
                    {plan && (
                      <Tag color={plan.color} title="Plano de permanência escolhido para esta criança">{plan.name}</Tag>
                    )}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  title="Imprimir Pulseira Térmica"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPrintData({
                      wristbandCode,
                      childName: session.child_name_snapshot,
                      guardianName: session.guardian_name_snapshot || "Responsável",
                      phone: session.guardian_phone_snapshot || "",
                      entryTime: new Date(session.checkin_at_ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
                      notes: session.notes,
                    });
                  }}
                >
                  🖨️
                </Button>
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
                </Badge>
              )}

              {isExceeded && !isPaused && (
                <Badge variant="solid_pink" title="Tempo do plano já foi ultrapassado — minutos e valor extra somados em tempo real">
                  🔴 +{quote.timing.overMinutes} min excedente{overageLine ? ` (+${money(overageLine.cents)})` : ""}
                </Badge>
              )}

              {session.notes && (
                <div style={{ fontSize: "12px", background: "rgba(201, 144, 32, 0.1)", padding: "6px 10px", borderRadius: "8px", color: "var(--color-dark)" }}>
                  💡 {session.notes}
                </div>
              )}

              <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                <Button
                  variant="primary"
                  size="sm"
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
                <Button
                  variant="ghost"
                  size="sm"
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
                {isPaused ? (
                  <Button
                    variant="teal"
                    size="sm"
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
                    size="sm"
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
                  <select
                    value={pendingPauseReason}
                    title="Selecione o motivo da pausa"
                    onChange={(e) => setPendingPauseReason(e.target.value)}
                    style={{ flex: 1, padding: "8px", borderRadius: "10px", border: "1px solid var(--border-subtle)" }}
                  >
                    <option value="" disabled>
                      Motivo da pausa...
                    </option>
                    {PAUSE_REASONS.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
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
                  <select
                    value={pendingPlanId}
                    title="Selecione o novo plano para esta sessão"
                    onChange={(e) => setPendingPlanId(e.target.value)}
                    style={{ flex: 1, padding: "8px", borderRadius: "10px", border: "1px solid var(--border-subtle)" }}
                  >
                    <option value="" disabled>
                      Escolher novo plano...
                    </option>
                    {planOptions.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} — {money(p.valueCents)}
                      </option>
                    ))}
                  </select>
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
                <strong style={{ fontSize: "18px", color: "var(--color-primary)" }}>{money(quote.totalCents)}</strong>
              </div>
            </Card>
          );
        })}
        {entries.length === 0 && (
          <div style={{ gridColumn: "1 / -1", padding: "48px", textAlign: "center", background: "var(--surface-card)", borderRadius: "16px", border: "1px dashed var(--border-subtle)" }}>
            <p style={{ fontSize: "16px", color: "var(--text-muted)", margin: 0 }}>Nenhuma criança em atividade no momento.</p>
          </div>
        )}
        </div>
      </div>

      {dailyGoalCents > 0 && (
        <div
          title="Progresso do faturamento de hoje em relação à meta diária configurada em Configurações → Meta"
          style={{ flexShrink: 0, minWidth: "280px" }}
          className="capacity-container"
        >
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "var(--text-muted)" }}>
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

      {selected.size > 0 && (
        <div style={{ position: "fixed", bottom: "24px", left: "50%", transform: "translateX(-50%)", zIndex: 100 }}>
          <Button variant="primary" size="lg" onClick={() => setCheckoutOpen(true)} style={{ boxShadow: "var(--shadow-lg)" }}>
            Fechar {selected.size} {selected.size === 1 ? "sessão" : "sessões"}
          </Button>
        </div>
      )}

      {checkoutOpen && (
        <CheckoutModal
          entries={selectedEntries}
          onClose={() => setCheckoutOpen(false)}
          onDone={() => {
            setCheckoutOpen(false);
            setSelected(new Set());
          }}
        />
      )}

      {printData && (
        <WristbandPrintModal
          data={printData}
          onClose={() => setPrintData(null)}
        />
      )}

      {/* Botões flutuantes: Painel é a tela principal — Entrada e PDV abrem por cima, sem sair dele */}
      <div style={{ position: "fixed", bottom: "24px", right: "24px", zIndex: 90, display: "flex", flexDirection: "column", gap: "14px", alignItems: "flex-end" }}>
        <Button
          variant="teal"
          size="lg"
          onClick={() => setPdvOpen(true)}
          title="Abrir PDV flutuante e fechar vendas sem sair do Painel"
          style={{ borderRadius: "9999px", width: "64px", height: "64px", fontSize: "26px", boxShadow: "var(--shadow-lg)", padding: 0 }}
        >
          🛒
        </Button>
        <Button
          variant="primary"
          size="lg"
          onClick={() => setEntradaOpen(true)}
          title="Fazer nova entrada sem sair do Painel"
          style={{ borderRadius: "9999px", width: "64px", height: "64px", fontSize: "26px", boxShadow: "var(--shadow-lg)", padding: 0 }}
        >
          ➕
        </Button>
      </div>

      {entradaOpen && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 150, display: "flex", justifyContent: "center", overflowY: "auto", padding: "24px" }}
          onClick={() => setEntradaOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: "var(--surface-bg, var(--surface-card))", borderRadius: "24px", maxWidth: "820px", width: "100%", height: "fit-content", position: "relative", boxShadow: "var(--shadow-lg)" }}
          >
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEntradaOpen(false)}
              title="Fechar e voltar ao Painel"
              style={{ position: "absolute", top: "12px", right: "12px", zIndex: 1 }}
            >
              ✕
            </Button>
            <EntradaScreen />
          </div>
        </div>
      )}

      {pdvOpen && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 150, display: "flex", justifyContent: "center", overflowY: "auto", padding: "24px" }}
          onClick={() => setPdvOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: "var(--surface-bg, var(--surface-card))", borderRadius: "24px", maxWidth: "1100px", width: "100%", height: "fit-content", position: "relative", boxShadow: "var(--shadow-lg)" }}
          >
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPdvOpen(false)}
              title="Fechar e voltar ao Painel"
              style={{ position: "absolute", top: "12px", right: "12px", zIndex: 1 }}
            >
              ✕
            </Button>
            <PdvScreen />
          </div>
        </div>
      )}
    </div>
  );
}

