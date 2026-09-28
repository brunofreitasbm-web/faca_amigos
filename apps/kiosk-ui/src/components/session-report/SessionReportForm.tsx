import { useEffect, useState } from "react";
import { Badge, Button, Card } from "@facaamigos/ui";
import {
  SESSION_REPORT_CATALOG,
  SESSION_REPORT_CATALOG_VERSION,
  sessionReportIsLate,
  sessionReportProgress,
  type SessionReportAnswers,
  type SessionReportLevel,
} from "@facaamigos/domain";
import { Api, type PendingSessionReport } from "../../api/client.js";
import { OfflineQueuedError } from "../../lib/supabase/offlineQueue.js";
import { useToast } from "../../state/ToastContext.js";
import { useConfirm } from "../../state/ConfirmContext.js";
import { LevelSegmented } from "./LevelSegmented.js";

const OBS_MAX = 300;

// Lista única, sem nomes de setor/profissão: qualquer profissional ou
// estagiário preenche os 16 itens, na mesma ordem, sem o formulário sugerir
// "isto aqui não é comigo". A classificação por área (Educação Física,
// Psicologia, Terapia Ocupacional, Pedagogia) continua só nos bastidores —
// em cada `item.key` e no histórico do Gerencial — para análise depois.
const ALL_ITEMS = SESSION_REPORT_CATALOG.flatMap((s) => s.items);

interface Draft {
  answers: SessionReportAnswers;
  observacao: string;
}

function draftKey(sessionId: string) {
  return `rs-draft-${sessionId}`;
}

function loadDraft(sessionId: string): Draft {
  try {
    const raw = sessionStorage.getItem(draftKey(sessionId));
    if (raw) return JSON.parse(raw) as Draft;
  } catch {
    /* storage indisponível: começa vazio */
  }
  return { answers: {}, observacao: "" };
}

export function formatCountdown(msLeft: number): string {
  const total = Math.max(0, Math.ceil(msLeft / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

interface Props {
  report: PendingSessionReport;
  /** Chamado depois de gravar; `reportId` é null quando ficou na fila offline. */
  onSubmitted: (reportId: string | null) => void;
  onClose: () => void;
}

export function SessionReportForm({ report, onSubmitted, onClose }: Props) {
  const toast = useToast();
  const confirm = useConfirm();
  const [draft, setDraft] = useState<Draft>(() => loadDraft(report.session_id));
  const [submitting, setSubmitting] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(draftKey(report.session_id), JSON.stringify(draft));
    } catch {
      /* rascunho é conveniência */
    }
  }, [draft, report.session_id]);

  const progress = sessionReportProgress(draft.answers);
  const late = sessionReportIsLate(report.checkout_at_ms, now);
  const msLeft = report.deadline_ms - now;

  const setLevel = (key: string, level: SessionReportLevel | null) =>
    setDraft((d) => {
      const answers = { ...d.answers };
      if (level == null) delete answers[key];
      else answers[key] = level;
      return { ...d, answers };
    });

  const submit = async () => {
    if (submitting) return;
    const obs = draft.observacao.trim();
    if (progress.answered < progress.total) {
      const ok = await confirm({
        title: progress.answered === 0 ? "Nenhum item marcado" : "Faltam itens",
        message:
          progress.answered === 0
            ? "O responsável vai receber uma mensagem sem detalhes. Enviar mesmo assim?"
            : `Faltam ${progress.total - progress.answered} de ${progress.total} itens. Pode enviar assim, ou voltar e completar.`,
        confirmLabel: "Enviar assim mesmo",
      });
      if (!ok) return;
    }
    setSubmitting(true);
    try {
      const res = await Api.sessionReportSubmit({
        sessionId: report.session_id,
        catalogVersion: SESSION_REPORT_CATALOG_VERSION,
        answers: draft.answers,
        observacao: obs || null,
      });
      try {
        sessionStorage.removeItem(draftKey(report.session_id));
      } catch {
        /* ignore */
      }
      toast.success(res.already_existed ? "Este relatório já tinha sido preenchido." : "Relatório salvo!");
      onSubmitted(res.id);
    } catch (e) {
      if (e instanceof OfflineQueuedError) {
        toast.success("Sem conexão: relatório guardado. Assim que a rede voltar, use “Reenviar”.");
        onSubmitted(null);
      } else {
        const msg = e instanceof Error ? e.message : "Não foi possível salvar o relatório.";
        toast.error(
          msg.includes("SESSAO_NAO_ELEGIVEL")
            ? "Esta sessão não gera relatório (menos de 1h)."
            : msg,
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px", paddingBottom: "84px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: "20px", margin: 0 }}>
            {report.child_name ?? "Criança"}
          </h2>
          <div style={{ fontSize: "13px", color: "var(--text-muted)" }}>
            {report.plan_name ?? "Plano"} · {report.eligible_minutes} min
          </div>
        </div>
        {late ? (
          <Badge variant="solid_pink">Atrasado — preencha assim mesmo</Badge>
        ) : (
          <Badge variant={msLeft < 10 * 60_000 ? "amber" : "teal"}>⏱ {formatCountdown(msLeft)}</Badge>
        )}
        <Button variant="ghost" size="sm" onClick={onClose} disabled={submitting}>
          Voltar
        </Button>
      </div>

      <div aria-live="polite" style={{ fontSize: "13px", color: "var(--text-muted)" }}>
        {progress.answered} de {progress.total} itens marcados. Toque de novo para desmarcar; pode pular o que não observou.
      </div>

      <Card bodyStyle={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {ALL_ITEMS.map((item, idx) => (
          <div
            key={item.key}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "6px",
              paddingTop: idx === 0 ? 0 : "14px",
              borderTop: idx === 0 ? undefined : "1px solid var(--border-subtle)",
            }}
          >
            <div>
              <div style={{ fontWeight: 600, fontSize: "15px" }}>{item.label}</div>
              <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>{item.hint}</div>
            </div>
            <LevelSegmented
              label={item.label}
              value={draft.answers[item.key]}
              onChange={(lvl) => setLevel(item.key, lvl)}
            />
          </div>
        ))}
      </Card>

      <Card bodyStyle={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        <label htmlFor="rs-observacao" style={{ fontWeight: 600, fontSize: "15px" }}>
          Observação <span style={{ fontWeight: 400, color: "var(--text-muted)" }}>(opcional)</span>
        </label>
        <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>
          O que a criança brincou ou fez no playground hoje. Aparece na mensagem ao responsável.
        </div>
        <textarea
          id="rs-observacao"
          value={draft.observacao}
          maxLength={OBS_MAX}
          rows={3}
          onChange={(e) => setDraft((d) => ({ ...d, observacao: e.target.value }))}
          style={{
            width: "100%",
            resize: "vertical",
            borderRadius: "12px",
            border: "1px solid var(--border-subtle)",
            padding: "10px 12px",
            fontFamily: "inherit",
            fontSize: "15px",
            boxSizing: "border-box",
          }}
        />
        <div style={{ fontSize: "12px", color: "var(--text-muted)", textAlign: "right" }}>
          {draft.observacao.length}/{OBS_MAX}
        </div>
      </Card>

      <div
        style={{
          position: "sticky",
          bottom: 0,
          padding: "12px 0",
          background: "var(--surface-page, var(--surface-card))",
          borderTop: "1px solid var(--border-subtle)",
        }}
      >
        <Button variant="primary" size="lg" fullWidth loading={submitting} onClick={submit} data-save-button>
          Enviar relatório ({progress.answered}/{progress.total})
        </Button>
      </div>
    </div>
  );
}
