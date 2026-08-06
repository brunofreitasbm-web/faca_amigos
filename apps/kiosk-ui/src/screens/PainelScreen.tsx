import { useEffect, useState } from "react";
import { Card, Button, StatusBadge } from "@facaamigos/ui";
import { Api } from "../api/client.js";
import type { ActiveSessionEntry } from "../api/client.js";
import { useAppState } from "../state/AppState.js";
import { CheckoutModal } from "../components/CheckoutModal.js";
import { formatElapsed, money } from "../format.js";

/**
 * Painel do parque (seção 1.3/6 do plano): contagem ascendente,
 * cor por fase, seleção de mais de 1 card para famílias com mais de
 * uma criança (popup de fechamento).
 *
 * Atualiza por polling a cada 2s em vez do canal WS (packages/kiosk/ws-tick.ts)
 * porque este ambiente de desenvolvimento não tem como validar
 * WebSocket num navegador real — o hook useTick já existe
 * (src/api/useTick.ts) para quando isso puder ser testado ao vivo.
 */
export function PainelScreen() {
  const { unit } = useAppState();
  const [entries, setEntries] = useState<ActiveSessionEntry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [checkoutOpen, setCheckoutOpen] = useState(false);

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

  const selectedEntries = entries.filter((e) => selected.has(e.session.id));

  return (
    <div style={{ padding: "24px" }}>
      <h1 style={{ fontFamily: "var(--font-display)" }}>Painel — {unit.name}</h1>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "16px", marginTop: "16px" }}>
        {entries.map(({ session, quote }) => (
          <Card
            key={session.id}
            onClick={() => toggle(session.id)}
            className={quote.timing.phase === "EXCEDENTE" ? "blinking" : undefined}
            style={{
              cursor: "pointer",
              padding: "16px",
              border: selected.has(session.id) ? "2px solid var(--color-primary)" : "1px solid var(--border-subtle)",
            }}
          >
            <strong>{session.child_name_snapshot}</strong>
            <div style={{ margin: "8px 0" }}>
              <StatusBadge phase={quote.timing.phase} detail={formatElapsed(quote.timing.elapsedMs)} />
            </div>
            <div>{money(quote.totalCents)}</div>
          </Card>
        ))}
        {entries.length === 0 && <p>Nenhuma sessão ativa.</p>}
      </div>

      {selected.size > 0 && (
        <div style={{ position: "fixed", bottom: "24px", left: "50%", transform: "translateX(-50%)" }}>
          <Button variant="primary" size="lg" onClick={() => setCheckoutOpen(true)}>
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
    </div>
  );
}
