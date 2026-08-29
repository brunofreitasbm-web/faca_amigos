import { useEffect, useState, useCallback } from "react";
import { ArrowClockwiseIcon, XIcon } from "@facaamigos/ui";
import { useAppState } from "../state/AppState.js";
import { useAuth } from "../auth/AuthContext.js";
import { Api, businessDateFor } from "../api/client.js";
import type { Unit } from "../api/client.js";
import { money } from "../format.js";

interface UnitSummary {
  unitId: string;
  unitName: string;
  revenueCents: number;
  sessionsCount: number;
}

// Cartão flat sem sombra pesada — borda fina + raio grande, igual ao
// `.m-card` da casca mobile (apps/kiosk-ui/src/mobile/mobile.css) — em
// vez do visual escuro/emoji que este widget tinha antes de usar os
// tokens do design system.
const cardSurfaceStyle: React.CSSProperties = {
  background: "var(--surface-card)",
  border: "1px solid var(--color-gray-200)",
  boxShadow: "var(--shadow-sm)",
};

const iconButtonStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "var(--text-muted)",
  fontSize: "16px",
  cursor: "pointer",
  padding: "8px",
  borderRadius: "var(--radius-sm)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

export function OwnerFloatingDashboard() {
  const { employee, units } = useAppState();
  const { can } = useAuth();

  // Verifica se o usuário é OWNER (ADMIN ou possui capacidade de gestão)
  const isOwner = employee?.role === "ADMIN" || can("notificacoes.owner_push") || can("config.rbac.write");

  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [lastUpdated, setLastUpdated] = useState<string>("");
  const [unitSummaries, setUnitSummaries] = useState<UnitSummary[]>([]);

  const totalRevenueCents = unitSummaries.reduce((acc, u) => acc + u.revenueCents, 0);
  const totalSessionsCount = unitSummaries.reduce((acc, u) => acc + u.sessionsCount, 0);

  const loadDashboardData = useCallback(async () => {
    if (!isOwner || units.length === 0) return;
    setLoading(true);

    try {
      const todayStr = businessDateFor(Date.now(), 3); // cutoff 3h

      const rawHourly = await Api.reportCheckinsByHour(null, todayStr, todayStr).catch(() => []);
      const sessionsCountByUnit = new Map<string, number>();
      for (const row of rawHourly) {
        const key = row.unit_id || row.unit_name;
        sessionsCountByUnit.set(key, (sessionsCountByUnit.get(key) ?? 0) + row.count);
      }

      const summaries: UnitSummary[] = await Promise.all(
        units.map(async (u: Unit) => {
          const cutoff = u.business_day_cutoff_hour ?? 3;
          const rev = await Api.todayRevenue(u.id, cutoff).catch(() => ({ totalCents: 0 }));
          const sessionsCount = sessionsCountByUnit.get(u.id) ?? sessionsCountByUnit.get(u.name) ?? 0;

          return {
            unitId: u.id,
            unitName: u.name,
            revenueCents: rev.totalCents,
            sessionsCount,
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

  if (!isOwner) return null;

  // Botão flutuante fechado — já mostra o total consolidado, sem
  // precisar abrir nada.
  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        aria-label={`Abrir resumo do dia. Faturamento: ${money(totalRevenueCents)}, ${totalSessionsCount} sessões.`}
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
          fontFamily: "var(--font-body)",
          fontWeight: "var(--weight-bold)" as unknown as number,
          fontSize: "var(--text-sm)",
          color: "var(--text-primary)",
          cursor: "pointer",
          ...cardSurfaceStyle,
        }}
      >
        <span aria-hidden="true" style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--color-teal)", flexShrink: 0 }} />
        <span style={{ fontFamily: "var(--font-display)", color: "var(--color-primary-hover)" }}>{money(totalRevenueCents)}</span>
        <span style={{ color: "var(--text-muted)", fontWeight: "var(--weight-medium)" as unknown as number }}>
          · {totalSessionsCount} sessões
        </span>
      </button>
    );
  }

  // Cartão compacto ancorado no canto — não é uma modal de tela cheia.
  return (
    <div
      role="region"
      aria-label="Resumo do dia — OWNER"
      onKeyDown={(e) => {
        if (e.key === "Escape") setIsOpen(false);
      }}
      style={{
        position: "fixed",
        bottom: "var(--space-6)",
        right: "var(--space-6)",
        zIndex: 999,
        width: "300px",
        maxWidth: "calc(100vw - 32px)",
        borderRadius: "20px",
        overflow: "hidden",
        fontFamily: "var(--font-body)",
        ...cardSurfaceStyle,
      }}
    >
      {/* CABEÇALHO */}
      <div
        style={{
          padding: "12px 14px",
          borderBottom: "1px solid var(--color-gray-200)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: "13px", fontWeight: "var(--weight-extrabold)" as unknown as number, color: "var(--text-primary)" }}>
            Hoje
          </span>
          <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
            {loading ? "Atualizando…" : lastUpdated ? `Atualizado às ${lastUpdated}` : ""}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "2px" }}>
          <button type="button" onClick={loadDashboardData} disabled={loading} aria-label="Atualizar agora" style={iconButtonStyle}>
            <ArrowClockwiseIcon aria-hidden="true" />
          </button>
          <button type="button" onClick={() => setIsOpen(false)} aria-label="Fechar" style={iconButtonStyle}>
            <XIcon aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* LISTA POR UNIDADE */}
      <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: "10px" }}>
        {unitSummaries.map((u) => (
          <div key={u.unitId} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
            <span
              style={{
                fontSize: "13px",
                color: "var(--text-secondary)",
                fontWeight: "var(--weight-semibold)" as unknown as number,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {u.unitName}
            </span>
            <div style={{ display: "flex", alignItems: "baseline", gap: "6px", flexShrink: 0 }}>
              <span style={{ fontSize: "14px", fontWeight: "var(--weight-extrabold)" as unknown as number, color: "var(--color-primary-hover)" }}>
                {money(u.revenueCents)}
              </span>
              <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>· {u.sessionsCount} sessões</span>
            </div>
          </div>
        ))}

        {unitSummaries.length === 0 && !loading && (
          <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>Sem dados para hoje ainda.</span>
        )}

        {units.length > 1 && unitSummaries.length > 0 && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "8px",
              marginTop: "2px",
              paddingTop: "10px",
              borderTop: "1px solid var(--color-gray-200)",
            }}
          >
            <span style={{ fontSize: "13px", color: "var(--text-primary)", fontWeight: "var(--weight-extrabold)" as unknown as number }}>
              Total
            </span>
            <div style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
              <span style={{ fontSize: "15px", fontWeight: "var(--weight-extrabold)" as unknown as number, color: "var(--color-primary-hover)" }}>
                {money(totalRevenueCents)}
              </span>
              <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>· {totalSessionsCount} sessões</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
