import { useEffect, useState, useCallback } from "react";
import { Modal } from "@facaamigos/ui";
import { useAppState } from "../state/AppState.js";
import { useAuth } from "../auth/AuthContext.js";
import { Api } from "../api/client.js";
import type { Unit } from "../api/client.js";
import { money } from "../format.js";

interface UnitSummary {
  unitId: string;
  unitName: string;
  revenueCents: number;
  sessionsCount: number;
  ticketMedioCents: number;
  minTicketCents: number;
  targetTicketCents: number;
}

// Cartão flat sem sombra (borda 1px + raio 24px), igual ao `.m-card` da
// casca mobile (apps/kiosk-ui/src/mobile/mobile.css) — este painel segue
// a mesma linguagem visual minimalista em vez do Card sombreado de
// packages/ui, que é pensado para as telas de balcão do desktop.
const flatCardStyle: React.CSSProperties = {
  background: "var(--surface-card)",
  border: "1px solid var(--color-gray-200)",
  borderRadius: "24px",
  padding: "14px 16px",
};

const flatPillStyle: React.CSSProperties = {
  borderRadius: "var(--radius-full)",
  padding: "10px 16px",
  minHeight: "40px",
  fontFamily: "var(--font-body)",
  fontSize: "var(--text-sm)",
  fontWeight: "var(--weight-bold)" as unknown as number,
  border: "1px solid var(--color-gray-200)",
  background: "var(--surface-page)",
  color: "var(--text-primary)",
  cursor: "pointer",
  whiteSpace: "nowrap",
  flexShrink: 0,
};

export function OwnerFloatingDashboard() {
  const { employee, units } = useAppState();
  const { can } = useAuth();

  // Verifica se o usuário é OWNER (ADMIN ou possui capacidade de gestão)
  const isOwner = employee?.role === "ADMIN" || can("notificacoes.owner_push") || can("config.rbac.write");

  const [isOpen, setIsOpen] = useState<boolean>(true);
  const [isMinimized, setIsMinimized] = useState<boolean>(false);
  const [selectedUnitId, setSelectedUnitId] = useState<string>("");

  const [loading, setLoading] = useState<boolean>(true);
  const [lastUpdated, setLastUpdated] = useState<string>("");

  const [unitSummaries, setUnitSummaries] = useState<UnitSummary[]>([]);

  // Totais do negócio inteiro — usados só no resumo do widget minimizado/FAB,
  // já que não existe mais uma aba de visão consolidada no painel aberto.
  const totalRevenueCents = unitSummaries.reduce((acc, u) => acc + u.revenueCents, 0);
  const totalSessionsCount = unitSummaries.reduce((acc, u) => acc + u.sessionsCount, 0);

  // Recarregar dados
  const loadDashboardData = useCallback(async () => {
    if (!isOwner || units.length === 0) return;
    setLoading(true);

    try {
      const cutoffFallback = 3;

      const summaries: UnitSummary[] = await Promise.all(
        units.map(async (u: Unit) => {
          const cutoff = u.business_day_cutoff_hour ?? cutoffFallback;
          const [rev, tm, goal] = await Promise.all([
            Api.todayRevenue(u.id, cutoff).catch(() => ({ totalCents: 0 })),
            Api.todayTicketMedio(u.id, cutoff).catch(() => ({
              totalCents: 0,
              ordersCount: 0,
              avgCents: 0,
            })),
            Api.ticketGoal(u.id).catch(() => null),
          ]);

          return {
            unitId: u.id,
            unitName: u.name,
            revenueCents: rev.totalCents,
            sessionsCount: tm.ordersCount,
            ticketMedioCents: tm.avgCents,
            minTicketCents: goal?.minTicketCents ?? 0,
            targetTicketCents: goal?.targetTicketCents ?? 0,
          };
        })
      );

      setUnitSummaries(summaries);
      setLastUpdated(
        new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
      );
    } catch (err) {
      console.error("Erro ao carregar Dashboard Flutuante OWNER:", err);
    } finally {
      setLoading(false);
    }
  }, [isOwner, units]);

  useEffect(() => {
    if (isOwner) {
      loadDashboardData();
      const interval = setInterval(loadDashboardData, 60000); // 1 minuto
      return () => clearInterval(interval);
    }
  }, [isOwner, loadDashboardData]);

  // Seleciona a primeira unidade assim que a lista carrega — não existe
  // mais visão consolidada, então sempre há uma unidade específica ativa.
  useEffect(() => {
    if (!selectedUnitId && units.length > 0) {
      setSelectedUnitId(units[0]!.id);
    }
  }, [units, selectedUnitId]);

  if (!isOwner) return null;

  // Filtragem dos dados exibidos no card principal
  const activeSummary = unitSummaries.find((u) => u.unitId === selectedUnitId) ?? {
    revenueCents: 0,
    sessionsCount: 0,
    ticketMedioCents: 0,
    minTicketCents: 0,
    targetTicketCents: 0,
  };

  // Status visual do Ticket Médio — reaproveita a paleta de semáforo
  // operacional (packages/ui/src/tokens/status.css), a mesma usada no
  // resto do quiosque para "bom / atenção / ruim", em vez de inventar
  // uma escala de cor nova só para este painel.
  const ticketStatus =
    activeSummary.targetTicketCents > 0
      ? activeSummary.ticketMedioCents >= activeSummary.targetTicketCents
        ? { label: "Meta atingida", fg: "var(--status-verde-text)" }
        : activeSummary.ticketMedioCents >= activeSummary.minTicketCents
        ? { label: "Na média", fg: "var(--status-amarelo-text)" }
        : { label: "Abaixo do alvo", fg: "var(--status-vermelho-text)" }
      : { label: "Meta não definida", fg: "var(--text-muted)" };

  // 1. Caso esteja totalmente fechado
  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => {
          setIsOpen(true);
          setIsMinimized(false);
        }}
        style={{
          position: "fixed",
          bottom: "var(--space-6)",
          right: "var(--space-6)",
          zIndex: 999,
          display: "flex",
          alignItems: "center",
          gap: "var(--space-2)",
          minHeight: "44px",
          padding: "10px 18px",
          borderRadius: "var(--radius-full)",
          background: "var(--surface-card)",
          border: "1px solid var(--color-gray-200)",
          boxShadow: "var(--shadow-sm)",
          color: "var(--text-primary)",
          fontFamily: "var(--font-body)",
          fontWeight: "var(--weight-bold)" as unknown as number,
          fontSize: "var(--text-sm)",
          cursor: "pointer",
        }}
      >
        <span aria-hidden="true" style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--color-teal)", flexShrink: 0 }} />
        Painel OWNER
      </button>
    );
  }

  // 2. Caso esteja minimizado (widget flutuante)
  if (isMinimized) {
    return (
      <button
        type="button"
        onClick={() => setIsMinimized(false)}
        aria-label={`Expandir Painel OWNER. Faturamento de hoje: ${money(totalRevenueCents)}, ${totalSessionsCount} visitas.`}
        style={{
          position: "fixed",
          bottom: "var(--space-6)",
          right: "var(--space-6)",
          zIndex: 999,
          display: "flex",
          alignItems: "center",
          gap: "var(--space-3)",
          minHeight: "44px",
          padding: "10px 16px",
          borderRadius: "var(--radius-full)",
          background: "var(--surface-card)",
          border: "1px solid var(--color-gray-200)",
          boxShadow: "var(--shadow-sm)",
          color: "var(--text-primary)",
          cursor: "pointer",
          fontFamily: "var(--font-body)",
        }}
      >
        <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
          <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>OWNER · hoje</span>
          <span style={{ fontFamily: "var(--font-display)", fontSize: "18px", color: "var(--color-primary-hover)" }}>
            {money(totalRevenueCents)}
          </span>
        </span>
      </button>
    );
  }

  // 3. Caso esteja aberto — reaproveita o Modal compartilhado (foco preso,
  // Escape para fechar, devolução de foco, role="dialog") em vez do overlay
  // artesanal anterior, igual aos outros diálogos do produto. O conteúdo
  // segue o visual flat da casca mobile (MobileGerencialHome): cartões com
  // borda fina em vez de sombra, números grandes em --font-display, sem
  // gráfico nem painel de dicas — só o essencial pra bater o olho.
  return (
    <Modal title="Painel OWNER" onClose={() => setIsOpen(false)} maxWidth="420px" zIndex={1000}>
      <div style={{ fontFamily: "var(--font-body)", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
        <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
          {loading ? "Atualizando…" : lastUpdated ? `Atualizado às ${lastUpdated}` : ""}
        </span>

        {/* SELETOR DE UNIDADE */}
        {units.length > 1 && (
          <div role="group" aria-label="Filtrar unidade" style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", overflowX: "auto", paddingBottom: "2px" }}>
            {units.map((u) => {
              const active = selectedUnitId === u.id;
              return (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => setSelectedUnitId(u.id)}
                  aria-pressed={active}
                  style={{
                    ...flatPillStyle,
                    background: active ? "var(--color-teal)" : "var(--surface-page)",
                    borderColor: active ? "var(--color-teal)" : "var(--color-gray-200)",
                    color: active ? "var(--text-on-primary)" : "var(--text-primary)",
                  }}
                >
                  {u.name}
                </button>
              );
            })}
          </div>
        )}

        {/* FATURAMENTO + SESSÕES */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-3)" }}>
          <div style={flatCardStyle}>
            <p style={{ margin: 0, fontSize: "12px", fontWeight: "var(--weight-semibold)" as unknown as number, color: "var(--text-muted)" }}>
              Faturamento hoje
            </p>
            <p style={{ margin: "4px 0 0", fontFamily: "var(--font-display)", fontSize: "24px", color: "var(--color-primary-hover)" }}>
              {money(activeSummary.revenueCents)}
            </p>
          </div>
          <div style={flatCardStyle}>
            <p style={{ margin: 0, fontSize: "12px", fontWeight: "var(--weight-semibold)" as unknown as number, color: "var(--text-muted)" }}>
              Atendimentos
            </p>
            <p style={{ margin: "4px 0 0", fontFamily: "var(--font-display)", fontSize: "24px", color: "#1D8273" }}>
              {activeSummary.sessionsCount}
            </p>
          </div>
        </div>

        {/* TICKET MÉDIO */}
        <div style={flatCardStyle}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <p style={{ margin: 0, fontSize: "12px", fontWeight: "var(--weight-semibold)" as unknown as number, color: "var(--text-muted)" }}>
              Ticket médio
            </p>
            <span style={{ fontSize: "12px", fontWeight: "var(--weight-bold)" as unknown as number, color: ticketStatus.fg }}>
              {ticketStatus.label}
            </span>
          </div>
          <p style={{ margin: "4px 0 0", fontFamily: "var(--font-display)", fontSize: "24px", color: "var(--text-primary)" }}>
            {money(activeSummary.ticketMedioCents)}
          </p>
          {activeSummary.targetTicketCents > 0 && (
            <p style={{ margin: "6px 0 0", fontSize: "12px", color: "var(--text-muted)" }}>
              Mínimo {money(activeSummary.minTicketCents)} · Alvo {money(activeSummary.targetTicketCents)}
            </p>
          )}
        </div>

        {/* AÇÕES */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-2)" }}>
          <button type="button" style={flatPillStyle} onClick={loadDashboardData} disabled={loading}>
            {loading ? "Atualizando…" : "Atualizar"}
          </button>
          <button type="button" style={flatPillStyle} onClick={() => setIsMinimized(true)}>
            Minimizar
          </button>
        </div>
      </div>
    </Modal>
  );
}
