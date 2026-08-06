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
import { formatElapsed, money } from "../format.js";
import { EntradaScreen } from "./EntradaScreen.js";
import { PdvScreen } from "./PdvScreen.js";

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
    <div style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "16px" }}>
        <div>
          <h1 style={{ fontFamily: "var(--font-display)", margin: 0 }}>Painel — {unit.name}</h1>
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

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "16px", marginTop: "8px" }}>
        {entries.map((entry) => {
          const { session, quote, plan } = entry;
          const isSelected = selected.has(session.id);
          const isExceeded = quote.timing.phase === "EXCEDENTE" || quote.timing.phase === "VERMELHO";
          const overageLine = quote.lines.find((l) => l.label.startsWith("Excedente"));
          const wristbandCode = session.wristband_code || session.id.slice(0, 6).toUpperCase();

          return (
            <Card
              key={session.id}
              onClick={() => toggle(session.id)}
              className={isExceeded ? "blinking" : undefined}
              style={{
                cursor: "pointer",
                padding: "16px",
                display: "flex",
                flexDirection: "column",
                gap: "10px",
                border: isSelected
                  ? "2px solid var(--color-primary)"
                  : isExceeded
                  ? "2px solid var(--color-error)"
                  : "1px solid var(--border-subtle)",
                borderLeft: `6px solid ${plan?.color ?? "var(--border-subtle)"}`,
                borderRadius: "16px",
                background: isSelected ? "rgba(240, 25, 107, 0.04)" : "var(--surface-card)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <strong style={{ fontSize: "17px", display: "block" }}>{session.child_name_snapshot}</strong>
                  <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>Pulseira: #{wristbandCode}</span>
                  {plan && (
                    <Tag color={plan.color} title="Plano de permanência escolhido para esta criança">{plan.name}</Tag>
                  )}
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

              <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
                <StatusBadge phase={quote.timing.phase} detail={formatElapsed(quote.timing.elapsedMs)} />

                {isExceeded && (
                  <Badge variant="solid_pink" title="Tempo do plano já foi ultrapassado — minutos e valor extra somados em tempo real">
                    🔴 +{quote.timing.overMinutes} min excedente{overageLine ? ` (+${money(overageLine.cents)})` : ""}
                  </Badge>
                )}
              </div>

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
                  title="Abrir WhatsApp com mensagem pronta para o responsável"
                  onClick={(e) => {
                    e.stopPropagation();
                    notifyGuardian(entry, "WHATSAPP");
                  }}
                >
                  💬 Notificar Responsável
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
              </div>

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

      {dailyGoalCents > 0 && (
        <div
          title="Progresso do faturamento de hoje em relação à meta diária configurada em Configurações → Meta"
          style={{ minWidth: "280px" }}
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

