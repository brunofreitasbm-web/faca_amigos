import { useEffect, useState } from "react";
import { RevealPin, AutismRibbonIcon } from "@facaamigos/ui";
import { Api } from "../api/client.js";
import type { ActiveSessionEntry, Asset } from "../api/client.js";
import { useActiveSessions } from "../api/useTick.js";
import { useAuth } from "../auth/AuthContext.js";
import { useToast } from "../state/ToastContext.js";

/** mm:ss até uma hora, depois 1h07 — o formato que o operador lê de relance. */
function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h${String(m).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function planLabel(entry: ActiveSessionEntry): string {
  const mins = Math.round(entry.quote.timing.durationMs / 60000);
  if (mins >= 60 && mins % 60 === 0) return `${mins / 60}h`;
  return `${mins} min`;
}

/**
 * Cor do cartão = urgência, não decoração.
 *
 * Verde/âmbar/rosa espelham exatamente a régua do Painel de balcão: o
 * excedente é o único estado que custa dinheiro a quem não olhou a tempo,
 * então é o único que usa a cor de ação da marca.
 */
function urgency(entry: ActiveSessionEntry): { color: string; status: string } {
  const { timing } = entry.quote;
  if (timing.isPaused) return { color: "var(--text-muted)", status: "Pausada" };
  if (timing.overMinutes > 0) {
    return { color: "var(--color-primary-hover)", status: `Excedente de ${timing.overMinutes} min — cobrar na saída` };
  }
  const leftMin = Math.ceil((timing.durationMs - timing.elapsedMs) / 60000);
  if (leftMin <= 5) return { color: "#996D18", status: `Sai em ${leftMin} min` };
  return { color: "#1D8273", status: `Restam ${leftMin} min` };
}

export function MobilePainel({
  unitId,
  isQuiosque,
  onLiberarSaida,
}: {
  unitId: string;
  /** Circuito: acrescenta a seção "Frota" depois da lista, com o status de cada veículo. */
  isQuiosque?: boolean;
  onLiberarSaida: () => void;
}) {
  const { entries, status, errorMessage, refetch } = useActiveSessions(unitId);
  const { can } = useAuth();
  const toast = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fleet, setFleet] = useState<Asset[]>([]);

  useEffect(() => {
    if (!isQuiosque) return;
    let alive = true;
    function load() {
      Api.assets(unitId).then((rows) => alive && setFleet(rows)).catch(() => {});
    }
    load();
    const interval = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, [unitId, isQuiosque]);

  const selected = entries.find((e) => e.session.id === selectedId) ?? null;

  async function togglePause(entry: ActiveSessionEntry) {
    setBusy(true);
    try {
      if (entry.quote.timing.isPaused) {
        await Api.resumeSession(entry.session.id);
        toast.success(`${entry.session.child_name_snapshot} voltou para a pista.`);
      } else {
        await Api.pauseSession(entry.session.id, "Pausa registrada pelo celular");
        toast.success(`${entry.session.child_name_snapshot} está pausada — o tempo parou.`);
      }
      await refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível mudar a pausa.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="m-appbar">
        <div>
          <p className="m-title">Quem está dentro</p>
          <p className="m-sub">ao vivo, atualiza sozinho</p>
        </div>
        <p className="m-num" style={{ margin: 0, fontSize: 20, fontWeight: 800, color: "#1D8273", flex: "none" }}>
          {status === "ready" ? entries.length : "—"}
        </p>
      </div>

      <div className="m-scroll" style={{ paddingBottom: selected ? 300 : 20 }}>
        {status === "loading" && <p className="m-sub">Carregando o painel…</p>}

        {status === "error" && (
          <div className="m-card" style={{ borderColor: "var(--color-error)" }}>
            <p style={{ margin: 0, fontWeight: 800 }}>O painel não atualizou</p>
            <p style={{ margin: "6px 0 12px", fontSize: 13, color: "var(--text-secondary)" }}>{errorMessage}</p>
            <button type="button" className="m-pill" onClick={() => void refetch()} style={{ width: "100%" }}>
              Tentar de novo
            </button>
          </div>
        )}

        {status === "ready" && entries.length === 0 && (
          <div className="m-card">
            <p style={{ margin: 0, fontWeight: 800 }}>Ninguém em atividade agora</p>
            <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--text-secondary)" }}>
              Assim que uma entrada for confirmada, ela aparece aqui com o cronômetro correndo.
            </p>
          </div>
        )}

        <div className="m-stack" style={{ gap: 10 }}>
          {entries.map((entry) => {
            const u = urgency(entry);
            const isNeurodivergent = Boolean(
              (entry.session.sensory_tags?.length ?? 0) > 0 ||
              entry.session.notes?.toLowerCase().includes("neuro") ||
              entry.session.notes?.toLowerCase().includes("autis") ||
              entry.session.notes?.toLowerCase().includes("tea") ||
              entry.session.child_name_snapshot.includes("🧩")
            );
            return (
              <div
                key={entry.session.id}
                role="button"
                tabIndex={0}
                className="m-tap"
                onClick={() => setSelectedId(entry.session.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelectedId(entry.session.id);
                  }
                }}
                style={{
                  position: "relative",
                  overflow: "hidden",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  background: "var(--surface-card)",
                  border: "1px solid var(--color-gray-200)",
                  borderLeft: `5px solid ${u.color}`,
                  borderRadius: 20,
                  padding: "13px 15px",
                }}
              >
                {/* Símbolo do autismo discreto com fundo transparente */}
                {isNeurodivergent && (
                  <div
                    aria-hidden="true"
                    title="Criança Neurodivergente / TEA"
                    style={{
                      position: "absolute",
                      right: 14,
                      top: "50%",
                      transform: "translateY(-50%)",
                      opacity: 0.1,
                      pointerEvents: "none",
                      zIndex: 0,
                    }}
                  >
                    <AutismRibbonIcon width={36} height={45} />
                  </div>
                )}
                <div className="m-grow" style={{ position: "relative", zIndex: 1 }}>
                  <p style={{ margin: 0, fontSize: 15.5, fontWeight: 800, display: "flex", alignItems: "center", gap: 6 }}>
                    <span>{entry.session.child_name_snapshot}</span>
                    {isNeurodivergent && (
                      <span
                        title="Criança Neurodivergente / TEA — Sinalização para o operador"
                        style={{ display: "inline-flex", alignItems: "center", flexShrink: 0 }}
                      >
                        <AutismRibbonIcon width={13} height={16} />
                      </span>
                    )}
                  </p>
                  <p style={{ margin: "3px 0 0", fontSize: 12.5, fontWeight: 600, color: "var(--text-muted)" }}>
                    {entry.plan.name} · pulseira {entry.session.access_code ?? entry.session.wristband_code ?? "—"}
                  </p>

                  <p style={{ margin: "5px 0 0", fontSize: 11.5, fontWeight: 800, lineHeight: 1.35, color: u.color }}>
                    {u.status}
                  </p>
                </div>
                <div style={{ textAlign: "right", flex: "none", position: "relative", zIndex: 1 }}>
                  <p
                    className="m-num"
                    style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 22, lineHeight: 1.15, color: u.color }}
                  >
                    {clock(entry.quote.timing.elapsedMs)}
                  </p>
                  <p style={{ margin: "4px 0 0", fontSize: 11, fontWeight: 600, color: "var(--text-muted)" }}>
                    de {planLabel(entry)}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {isQuiosque && (
          <>
            <p className="m-eyebrow" style={{ margin: "22px 0 10px" }}>
              Frota
            </p>
            <div className="m-stack" style={{ gap: 8 }}>
              {fleet.map((v) => {
                const statusLabel = v.status === "DISPONIVEL" ? "Disponível" : v.status === "EM_USO" ? "Em uso" : "Manutenção";
                const statusColor = v.status === "DISPONIVEL" ? "#1A8454" : v.status === "EM_USO" ? "#996D18" : "#E61E1E";
                return (
                  <div
                    key={v.id}
                    className="m-row"
                    style={{ justifyContent: "space-between", background: "var(--surface-card)", border: "1px solid var(--color-gray-200)", borderRadius: 16, padding: "11px 14px" }}
                  >
                    <span style={{ fontSize: 13.5, fontWeight: 700 }}>{v.emoji} {v.name}</span>
                    <span style={{ fontSize: 12, fontWeight: 800, color: statusColor }}>{statusLabel}</span>
                  </div>
                );
              })}
              {fleet.length === 0 && (
                <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "var(--text-muted)" }}>Nenhum veículo cadastrado.</p>
              )}
            </div>
          </>
        )}
      </div>

      {selected && (
        <div className="m-sheet" role="dialog" aria-label={`Ações de ${selected.session.child_name_snapshot}`}>
          <div className="m-row" style={{ justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
            <p className="m-title-sm m-trunc m-grow" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span>{selected.session.child_name_snapshot}</span>
              {Boolean(
                (selected.session.sensory_tags?.length ?? 0) > 0 ||
                selected.session.notes?.toLowerCase().includes("neuro") ||
                selected.session.notes?.toLowerCase().includes("autis") ||
                selected.session.notes?.toLowerCase().includes("tea") ||
                selected.session.child_name_snapshot.includes("🧩")
              ) && (
                <span title="Criança Neurodivergente / TEA — Atendimento Inclusivo" style={{ display: "inline-flex", alignItems: "center" }}>
                  <AutismRibbonIcon width={14} height={18} />
                </span>
              )}
            </p>
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              style={{ background: "none", border: "none", font: "inherit", fontWeight: 800, fontSize: 13, color: "var(--text-muted)", cursor: "pointer" }}
            >
              Fechar
            </button>
          </div>

          <p style={{ margin: "0 0 4px", fontSize: 13, lineHeight: 1.5, fontWeight: 600, color: "var(--text-secondary)" }}>
            {selected.plan.name} · {urgency(selected).status}
          </p>
          {(selected.session.sensory_tags?.length ?? 0) > 0 && (
            <p style={{ margin: "0 0 12px", fontSize: 12.5, lineHeight: 1.5, fontWeight: 700, color: "#1D8273" }}>
              {selected.session.sensory_tags?.join(" · ")}
            </p>
          )}

          <div className="m-stack" style={{ gap: 10, marginTop: 12 }}>
            {can("sessao.checkout") && (
              <button
                type="button"
                className="m-tap"
                onClick={onLiberarSaida}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  background: "var(--color-yellow)",
                  border: "none",
                  borderRadius: 9999,
                  padding: "16px 22px",
                  font: "inherit",
                  textAlign: "left",
                }}
              >
                <span style={{ flex: 1, fontFamily: "var(--font-display)", fontSize: 18, color: "var(--color-dark)" }}>
                  Liberar saída
                </span>
                <span style={{ fontSize: 13, fontWeight: 800, color: "rgba(26,63,53,.65)", flex: "none" }}>
                  abre a tela de Saída
                </span>
              </button>
            )}
            <button type="button" className="m-pill" disabled={busy} onClick={() => void togglePause(selected)}>
              {selected.quote.timing.isPaused ? "Retomar o tempo" : "Pausar o tempo"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
