import { useState } from "react";
import type { ActiveSessionEntry } from "../api/client.js";
import type { PendingRenewal } from "../api/renewalRequests.js";
import { resolveRenewal, applyRenewal } from "../api/renewalRequests.js";
import { useToast } from "../state/ToastContext.js";
import { money } from "../format.js";

/**
 * Fila de "quer mais um tempinho?" — pedidos que o responsável fez pelo
 * próprio celular, no painel de acompanhamento (AcompanharScreen).
 *
 * Espelha o badge que já existe no Painel do balcão (PainelScreen.tsx):
 * "Dar OK" troca o plano (fa_kiosk_apply_renewal) e o valor é acertado no
 * Caixa no fechamento. Os rótulos são
 * os mesmos do balcão de propósito — um operador que já usa a versão
 * completa não deve aprender um segundo vocabulário pra mesma ação.
 */
function agoLabel(atMs: number): string {
  const minutes = Math.max(0, Math.round((Date.now() - atMs) / 60_000));
  if (minutes < 1) return "agora mesmo";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `há ${hours}h`;
}

export function MobilePedidosTempo({
  entries,
  pending,
  employeeId,
}: {
  entries: ActiveSessionEntry[];
  pending: Map<string, PendingRenewal>;
  employeeId: string;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [resolved, setResolved] = useState<Map<string, "APLICADA" | "DISPENSADA">>(new Map());

  const rows = entries
    .filter((e) => pending.has(e.session.id))
    .map((e) => ({ entry: e, request: pending.get(e.session.id)! }));

  async function resolve(sessionId: string, outcome: "APLICADA" | "DISPENSADA") {
    setBusy((prev) => new Set(prev).add(sessionId));
    try {
      if (outcome === "DISPENSADA") {
        await resolveRenewal(sessionId, outcome, employeeId);
      } else {
        const result = await applyRenewal(sessionId, employeeId);
        if (result.status !== "OK") {
          toast.error(
            result.status === "SESSAO_NAO_ATIVA"
              ? "A sessão está pausada ou encerrada. Retome a sessão e tente de novo."
              : "Não achei um plano único com esse tempo. Troque o plano pelo Painel do balcão.",
          );
          return;
        }
      }
      setResolved((prev) => new Map(prev).set(sessionId, outcome));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não deu para atualizar o pedido.");
    } finally {
      setBusy((prev) => {
        const next = new Set(prev);
        next.delete(sessionId);
        return next;
      });
    }
  }

  return (
    <div className="m-scroll">
      <p style={{ margin: "0 0 16px", fontSize: 12.5, lineHeight: 1.5, fontWeight: 600, color: "var(--text-muted)" }}>
        "Dar OK" já troca o plano da criança para somar o tempo pedido. Se não houver um plano com esse tempo
        exato, a troca é feita pelo Painel do balcão.
      </p>

      {rows.length === 0 && (
        <div className="m-card" style={{ borderRadius: 20 }}>
          <p style={{ margin: 0, fontWeight: 800 }}>Nenhum pedido agora</p>
          <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--text-secondary)" }}>
            Quando um responsável pedir mais tempo pelo celular dele, aparece aqui.
          </p>
        </div>
      )}

      <div className="m-stack" style={{ gap: 10 }}>
        {rows.map(({ entry, request }) => {
          const done = resolved.get(entry.session.id);
          const isBusy = busy.has(entry.session.id);
          return (
            <div key={entry.session.id} className="m-card" style={{ borderRadius: 20 }}>
              <div className="m-row" style={{ justifyContent: "space-between", gap: 10 }}>
                <p style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>{entry.session.child_name_snapshot}</p>
                {request.cents != null && (
                  <p className="m-num" style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 18, flex: "none" }}>
                    {money(request.cents)}
                  </p>
                )}
              </div>
              <p style={{ margin: "6px 0 12px", fontSize: 12.5, fontWeight: 600, color: "var(--text-muted)" }}>
                pediu +{request.minutes} min pelo próprio celular · {agoLabel(request.requestedAtMs)}
              </p>

              {done ? (
                <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: done === "APLICADA" ? "#1D8273" : "var(--text-muted)" }}>
                  {done === "APLICADA" ? "✓ Plano trocado, tempo somado" : "Dispensado"}
                </p>
              ) : (
                <div className="m-row" style={{ gap: 10 }}>
                  <button
                    type="button"
                    className="m-pill"
                    style={{ flex: 1 }}
                    disabled={isBusy}
                    onClick={() => void resolve(entry.session.id, "DISPENSADA")}
                  >
                    Dispensar
                  </button>
                  <button
                    type="button"
                    className="m-pill"
                    style={{ flex: 2, background: "var(--color-teal)", color: "#fff", border: "none" }}
                    disabled={isBusy}
                    onClick={() => void resolve(entry.session.id, "APLICADA")}
                  >
                    Dar OK (Ciente)
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
