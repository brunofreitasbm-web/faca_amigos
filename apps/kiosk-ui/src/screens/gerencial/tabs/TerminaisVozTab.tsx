import { useEffect, useState } from "react";
import { Card, HelpText, Tag } from "@facaamigos/ui";
import { Api } from "../../../api/client.js";
import type { VoiceTerminalStatus } from "../../../api/client.js";
import { RequireCapability } from "../../../auth/RequireCapability.js";

const POLL_INTERVAL_MS = 20_000;
/** Sem heartbeat há mais que isto, o terminal conta como offline (2x o intervalo de envio de 30s, com folga). */
const OFFLINE_AFTER_MS = 90_000;

function relativeTime(ms: number): string {
  const diffS = Math.round((Date.now() - ms) / 1000);
  if (diffS < 60) return `${diffS}s atrás`;
  if (diffS < 3600) return `${Math.round(diffS / 60)}min atrás`;
  if (diffS < 86400) return `${Math.round(diffS / 3600)}h atrás`;
  return `${Math.round(diffS / 86400)}d atrás`;
}

function modelLabel(t: VoiceTerminalStatus): string {
  if (!t.model_name) return "—";
  switch (t.model_state) {
    case "ready":
      return `${t.model_name} · pronto`;
    case "downloading":
      return `${t.model_name} · baixando ${t.model_progress_pct ?? 0}%`;
    case "error":
      return `${t.model_name} · erro`;
    default:
      return `${t.model_name} · ausente`;
  }
}

function modelColor(t: VoiceTerminalStatus): string {
  if (t.model_state === "ready") return "var(--color-teal, #2ECFB5)";
  if (t.model_state === "downloading") return "var(--color-warning, #f0ad4e)";
  return "var(--color-error)";
}

/**
 * Gerencial > Caixa & Auditoria > Terminais — painel central do rollout do
 * whisper.cpp em todos os PCs/tablets da rede. Cada terminal manda um
 * heartbeat a cada 30s (apps/kiosk/src/main/voiceWorker.ts); esta tela só
 * lê fa_kiosk_voice_terminal_status e reatualiza sozinha a cada 20s — sem
 * isto, a única forma de saber se um terminal já baixou o modelo era abrir
 * Configurações > Impressoras naquele PC específico, um por um.
 */
export function TerminaisVozTab() {
  return (
    <RequireCapability capability="config.terminais.read">
      <TerminaisVozTabContent />
    </RequireCapability>
  );
}

function TerminaisVozTabContent() {
  const [rows, setRows] = useState<VoiceTerminalStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [, forceTick] = useState(0); // reavalia "X atrás" e o semáforo online/offline sem esperar o próximo fetch

  useEffect(() => {
    let active = true;
    const load = () => Api.voiceTerminals().then((r) => active && setRows(r)).catch(() => active && setRows([])).finally(() => active && setLoading(false));
    load();
    const dataTimer = setInterval(load, POLL_INTERVAL_MS);
    const tickTimer = setInterval(() => forceTick((n) => n + 1), 10_000);
    return () => {
      active = false;
      clearInterval(dataTimer);
      clearInterval(tickTimer);
    };
  }, []);

  const online = rows.filter((r) => Date.now() - r.last_heartbeat_ms < OFFLINE_AFTER_MS).length;

  return (
    <div>
      <div style={{ marginBottom: "16px" }}>
        <h2 style={{ fontFamily: "var(--font-display)", margin: 0, fontSize: "20px" }}>🖥️ Terminais — Transcrição de Voz</h2>
        <HelpText style={{ margin: 0 }}>
          Rollout do whisper.cpp em cada PC/tablet da rede: binário, modelo baixado e fila de transcrição. Atualiza sozinho a cada {POLL_INTERVAL_MS / 1000}s.
        </HelpText>
      </div>

      <Card style={{ padding: "8px", overflowX: "auto" }}>
        <div style={{ padding: "8px 8px 0", fontSize: "13px", color: "var(--text-muted)" }}>
          {loading ? "carregando…" : `${online} de ${rows.length} terminal(is) online agora`}
        </div>
        <table className="report-table">
          <thead>
            <tr>
              <th>Unidade</th>
              <th>Terminal</th>
              <th>Status</th>
              <th>Whisper</th>
              <th>Modelo</th>
              <th>Fila</th>
              <th>Último sinal</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => {
              const isOnline = Date.now() - t.last_heartbeat_ms < OFFLINE_AFTER_MS;
              const queueBusy = t.queue_pending + t.queue_processing;
              return (
                <tr key={t.terminal_id}>
                  <td>{t.fa_kiosk_units?.name ?? "não amarrado"}</td>
                  <td style={{ fontFamily: "monospace", fontSize: "12px" }}>{t.terminal_id.slice(0, 8)}</td>
                  <td>
                    <Tag color={isOnline ? "var(--color-teal, #2ECFB5)" : "var(--border-subtle)"}>{isOnline ? "🟢 Online" : "⚪ Offline"}</Tag>
                  </td>
                  <td>{t.whisper_cli_found ? "✅" : "❌ não encontrado"}</td>
                  <td>
                    <Tag color={modelColor(t)}>{modelLabel(t)}</Tag>
                  </td>
                  <td>
                    {queueBusy > 0 ? `${queueBusy} pendente(s)` : "em dia"}
                    {t.queue_failed > 0 && <span style={{ color: "var(--color-error)" }}> · {t.queue_failed} falha(s)</span>}
                  </td>
                  <td>{relativeTime(t.last_heartbeat_ms)}</td>
                </tr>
              );
            })}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={7} style={{ textAlign: "center", padding: "24px", color: "var(--text-muted)" }}>
                  Nenhum terminal reportou ainda. Assim que um PC do balcão atualizar para a versão com transcrição de voz, ele aparece aqui.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      <HelpText style={{ marginTop: "12px" }}>
        "Offline" só significa que o terminal não mandou sinal nos últimos {Math.round(OFFLINE_AFTER_MS / 1000)}s — pode estar desligado, sem
        internet, ou com o app fechado; não afeta o caixa nem a impressão, só a transcrição de voz.
      </HelpText>
    </div>
  );
}
