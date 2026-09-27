import { useEffect, useState } from "react";
import { Button, Card, Checkbox, HelpText, Select, Tag } from "@facaamigos/ui";
import { Api } from "../api/client.js";
import type { VoiceStatus } from "../api/client.js";
import { useToast } from "../state/ToastContext.js";

const MODEL_OPTIONS = [
  { value: "ggml-small", label: "Pequeno (recomendado — bom em português, ~470MB)" },
  { value: "ggml-base", label: "Básico (mais rápido, menos preciso)" },
  { value: "ggml-medium-q5_0", label: "Médio (mais preciso, mais pesado para o computador)" },
];

const HOURS_OPTIONS = [
  { value: "always", label: "Sempre que houver gravação na fila" },
  { value: "closed", label: "Só fora do horário de funcionamento" },
];

/**
 * Configurações > Impressoras > "Gravação de atendimentos (treinamento)" —
 * liga/desliga a gravação de check-in/check-out desta unidade, escolhe o
 * modelo whisper e mostra o estado do worker deste terminal (ver
 * apps/kiosk/src/main/voiceWorker.ts e a rota GET /api/voz/status).
 */
export function VoiceRecordingCard({ unitId }: { unitId: string }) {
  const toast = useToast();
  const [enabled, setEnabled] = useState(false);
  const [model, setModel] = useState("ggml-small");
  const [hours, setHours] = useState("always");
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<VoiceStatus | null>(null);
  const [testingMic, setTestingMic] = useState<"idle" | "testing" | "ok" | "error">("idle");

  useEffect(() => {
    setLoading(true);
    Promise.all([
      Api.unitSetting(unitId, "voice_recording_enabled"),
      Api.unitSetting(unitId, "voice_whisper_model"),
      Api.unitSetting(unitId, "voice_transcribe_hours"),
    ])
      .then(([enabledRow, modelRow, hoursRow]) => {
        setEnabled(enabledRow.value === "1");
        setModel(modelRow.value || "ggml-small");
        setHours(hoursRow.value || "always");
      })
      .finally(() => setLoading(false));
  }, [unitId]);

  useEffect(() => {
    let active = true;
    const poll = () => Api.voiceStatus().then((s) => active && setStatus(s));
    poll();
    const id = setInterval(poll, 10_000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  async function toggle(next: boolean) {
    setEnabled(next);
    try {
      await Api.setUnitSetting(unitId, "voice_recording_enabled", next ? "1" : "0");
    } catch {
      toast.error("Não foi possível salvar. Tente novamente.");
      setEnabled(!next);
    }
  }

  async function changeModel(next: string) {
    setModel(next);
    try {
      await Api.setUnitSetting(unitId, "voice_whisper_model", next);
      toast.success("Modelo atualizado — o terminal baixa o novo modelo automaticamente se ainda não tiver.");
    } catch {
      toast.error("Não foi possível salvar o modelo.");
    }
  }

  async function changeHours(next: string) {
    setHours(next);
    try {
      await Api.setUnitSetting(unitId, "voice_transcribe_hours", next);
    } catch {
      toast.error("Não foi possível salvar.");
    }
  }

  async function testMic() {
    setTestingMic("testing");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      setTestingMic("ok");
    } catch {
      setTestingMic("error");
    }
  }

  const modelState = status?.worker.model.state;

  return (
    <Card style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
      <h2 style={{ fontFamily: "var(--font-display)", fontSize: "16px", margin: 0 }}>🎙️ Gravação de atendimentos (treinamento)</h2>
      <HelpText>
        Grava a conversa do balcão no check-in e no check-out, transcreve LOCALMENTE neste computador (nenhum áudio sai daqui) e guarda só o
        texto para treinar a equipe de vendas. <strong>O áudio é apagado assim que a transcrição termina.</strong>
      </HelpText>

      <Checkbox checked={enabled} onChange={toggle} disabled={loading} label="Gravar e transcrever conversas de entrada e saída nesta unidade" />

      {enabled && (
        <>
          <Select label="Modelo de transcrição" value={model} onChange={(e) => changeModel(e.target.value)}>
            {MODEL_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>

          <Select label="Quando transcrever" value={hours} onChange={(e) => changeHours(e.target.value)}>
            {HOURS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>

          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center", fontSize: "13px" }}>
            <span>Neste computador:</span>
            <Tag color={status?.worker.whisperCliFound ? "var(--color-teal, #2ECFB5)" : "var(--color-error)"}>
              {status?.worker.whisperCliFound ? "Whisper instalado" : "Whisper não encontrado"}
            </Tag>
            <Tag
              color={
                modelState === "ready" ? "var(--color-teal, #2ECFB5)" : modelState === "downloading" ? "var(--color-warning, #f0ad4e)" : "var(--color-error)"
              }
            >
              {modelState === "ready" && "Modelo pronto"}
              {modelState === "downloading" && `Baixando modelo (${status?.worker.model.progressPct ?? 0}%)`}
              {(modelState === "missing" || modelState === "error" || !modelState) && "Modelo indisponível"}
            </Tag>
            {status?.queue && (
              <Tag color="var(--border-subtle)">
                Fila: {status.queue.pending + status.queue.processing} pendente(s) · {status.queue.uploaded} enviada(s)
                {status.queue.failed > 0 ? ` · ${status.queue.failed} falharam` : ""}
              </Tag>
            )}
            {!status && <Tag color="var(--border-subtle)">Servidor local não respondeu — gravação indisponível neste terminal</Tag>}
          </div>
          {status?.worker.lastError && (
            <HelpText icon="⚠️" style={{ background: "#fff8e6", borderColor: "#f0ad4e" }}>
              Último erro do worker: {status.worker.lastError}
            </HelpText>
          )}

          <div>
            <Button variant="secondary" size="sm" onClick={testMic} loading={testingMic === "testing"}>
              Testar microfone
            </Button>
            {testingMic === "ok" && <span style={{ marginLeft: "8px", fontSize: "13px", color: "var(--color-teal, #2ECFB5)" }}>✅ Microfone acessível</span>}
            {testingMic === "error" && <span style={{ marginLeft: "8px", fontSize: "13px", color: "var(--color-error)" }}>❌ Sem acesso ao microfone</span>}
          </div>
        </>
      )}
    </Card>
  );
}
