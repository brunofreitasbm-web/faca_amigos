import { useEffect, useState } from "react";
import { Card, Button, StatusBadge, Badge } from "@facaamigos/ui";
import { Api } from "../api/client.js";
import type { ActiveSessionEntry } from "../api/client.js";
import { useAppState } from "../state/AppState.js";
import { CheckoutModal } from "../components/CheckoutModal.js";
import { WristbandPrintModal } from "../components/WristbandPrintModal.js";
import type { WristbandData } from "../components/WristbandPrintModal.js";
import { formatElapsed, money } from "../format.js";

/**
 * Painel do parque (seção 1.3/6 do plano): contagem ascendente,
 * cor por fase, seleção de mais de 1 card para famílias com mais de
 * uma criança, medidor de capacidade e alertas de expiração.
 */
export function PainelScreen() {
  const { unit } = useAppState();
  const [entries, setEntries] = useState<ActiveSessionEntry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [printData, setPrintData] = useState<WristbandData | null>(null);

  useEffect(() => {
    if (!unit) return;
    let cancelled = false;
    async function poll() {
      const data = await Api.activeSessions(unit!.id);
      if (!cancelled) setEntries(data);
    }
    poll();
    const interval = setInterval(poll, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [unit]);

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
        {entries.map(({ session, quote }) => {
          const isSelected = selected.has(session.id);
          const isExceeded = quote.timing.phase === "EXCEDENTE" || quote.timing.phase === "VERMELHO";
          
          // Cálculo de alerta de tempo restante
          const remainingMs = quote.timing.durationMs - quote.timing.elapsedMs;
          const remainingMinutes = Math.ceil(remainingMs / (1000 * 60));
          const isWarningNearEnd = remainingMinutes > 0 && remainingMinutes <= 5 && (quote.timing.phase === "VERDE" || quote.timing.phase === "AMARELO");
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
                borderRadius: "16px",
                background: isSelected ? "rgba(240, 25, 107, 0.04)" : "var(--surface-card)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <strong style={{ fontSize: "17px", display: "block" }}>{session.child_name_snapshot}</strong>
                  <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>Pulseira: #{wristbandCode}</span>
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

                {isWarningNearEnd && (
                  <Badge variant="amber">⚠️ Restam {remainingMinutes} min</Badge>
                )}

                {isExceeded && (
                  <Badge variant="solid_pink">
                    🔴 EXCEDIDO (+{formatElapsed(Math.abs(remainingMs))})
                  </Badge>
                )}
              </div>

              {session.notes && (
                <div style={{ fontSize: "12px", background: "rgba(201, 144, 32, 0.1)", padding: "6px 10px", borderRadius: "8px", color: "var(--color-dark)" }}>
                  💡 {session.notes}
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
    </div>
  );
}

