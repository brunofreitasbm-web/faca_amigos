import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, HelpText } from "@facaamigos/ui";
import { Api, type RecentSessionReport, type SessionReportWhatsappStatus } from "../api/client.js";
import { isWhatsappRefusal63049, startOfTodayMs, usePendingSessionReports, useUnsentSessionReports } from "../api/useSessionReports.js";
import { useAppState } from "../state/AppState.js";
import { useToast } from "../state/ToastContext.js";
import { SessionReportForm, formatCountdown } from "../components/session-report/SessionReportForm.js";

const STATUS_TEXT: Record<SessionReportWhatsappStatus, { label: string; tone: "teal" | "amber" | "neutral" | "solid_pink" }> = {
  PENDING: { label: "Aguardando envio", tone: "amber" },
  SENT: { label: "✅ Enviado ao responsável", tone: "teal" },
  SENT_MANUAL: { label: "✅ Enviado manualmente (PDF)", tone: "teal" },
  SKIPPED_NO_CONSENT: { label: "Responsável não autorizou WhatsApp", tone: "neutral" },
  SKIPPED_OPT_OUT: { label: "Responsável pediu para não receber", tone: "neutral" },
  SKIPPED_NO_PHONE: { label: "Sem telefone cadastrado", tone: "neutral" },
  SKIPPED_NO_CHANNEL: { label: "Sem número de WhatsApp da unidade", tone: "amber" },
  SKIPPED_NO_TEMPLATE: { label: "Aguardando modelo de mensagem aprovado", tone: "amber" },
  FAILED: { label: "Falha no envio", tone: "solid_pink" },
};

/** Estados em que reenviar pode dar certo (configuração ou consentimento podem ter mudado). */
const RETRYABLE: ReadonlySet<SessionReportWhatsappStatus> = new Set([
  "PENDING", "FAILED", "SKIPPED_NO_TEMPLATE", "SKIPPED_NO_CHANNEL", "SKIPPED_NO_CONSENT",
]);

const hhmm = (ms: number) => new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

export function RelatorioSessaoScreen() {
  const { unit } = useAppState();
  const toast = useToast();
  const { pending, loading, error, refetch } = usePendingSessionReports(unit?.id ?? null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [todayReports, setTodayReports] = useState<RecentSessionReport[]>([]);
  const { unsent, refetch: refetchUnsent } = useUnsentSessionReports(unit?.id ?? null);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const loadRecent = useCallback(async () => {
    if (!unit?.id) return;
    try {
      setTodayReports(await Api.sessionReportsRecent(unit.id, startOfTodayMs()));
    } catch {
      /* mantém a lista anterior */
    }
    void refetchUnsent();
  }, [unit?.id, refetchUnsent]);

  // Os de hoje + os não enviados de dias anteriores (que não somem à meia-noite).
  const recent = [...unsent.filter((u) => !todayReports.some((t) => t.id === u.id)), ...todayReports].sort(
    (a, b) => b.filled_at_ms - a.filled_at_ms,
  );

  useEffect(() => {
    void loadRecent();
  }, [loadRecent]);

  const dispatch = useCallback(
    async (reportId: string) => {
      setBusyIds((s) => new Set(s).add(reportId));
      try {
        const res = await Api.sessionReportDispatch(reportId);
        if (res.status === "SENT" || res.alreadySent) toast.success("Mensagem enviada ao responsável.");
        else if (res.error) toast.error(res.error);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Não foi possível enviar ao responsável.");
      } finally {
        setBusyIds((s) => {
          const next = new Set(s);
          next.delete(reportId);
          return next;
        });
        void loadRecent();
      }
    },
    [toast, loadRecent],
  );

  const handleSendManualPdf = useCallback(
    async (reportId: string) => {
      setBusyIds((s) => new Set(s).add(reportId));
      try {
        await Api.sessionReportSendManualPdf(reportId);
        toast.success("WhatsApp aberto com a mensagem padrão e o PDF!");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Não foi possível preparar o envio do PDF.");
      } finally {
        setBusyIds((s) => {
          const next = new Set(s);
          next.delete(reportId);
          return next;
        });
        void loadRecent();
      }
    },
    [toast, loadRecent],
  );

  const failedCount = unsent.length;
  const selected = pending.find((p) => p.session_id === selectedId) ?? null;

  const handleSubmitted = (reportId: string | null) => {
    setSelectedId(null);
    void refetch();
    void loadRecent();
    // Envio ao responsável não bloqueia o balcão: o status aparece em "Enviados".
    if (reportId) void dispatch(reportId);
  };

  return (
    <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "16px", overflow: "auto", height: "100%" }}>
      <style>{`
        @keyframes fa-session-report-banner-blink {
          50% { opacity: 0.55; }
        }
      `}</style>
      <div>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: "20px", margin: 0 }}>📝 Olhar FaçaAmigos</h2>
        <HelpText>
          Crianças com plano de 1h ou mais: preencha os 16 itens em até 40 minutos depois da saída. Um toque por item, qualquer
          profissional ou estagiário pode preencher — não é dividido por especialidade. O responsável recebe um resumo no WhatsApp.
        </HelpText>
      </div>

      {failedCount > 0 && (
        <div
          role="alert"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "10px 14px",
            borderRadius: "8px",
            background: "var(--color-error-text, #b3261e)",
            color: "#fff",
            fontWeight: 700,
            fontSize: "13px",
            animation: "fa-session-report-banner-blink 1s step-start infinite",
          }}
        >
          <span>⚠️</span>
          <span>
            {failedCount === 1
              ? "1 Olhar FaçaAmigos não foi enviado ao responsável."
              : `${failedCount} Olhares FaçaAmigos não foram enviados ao responsável.`}{" "}
            Reenvie ou mande o PDF manualmente abaixo; o aviso só some quando o envio der certo.
          </span>
        </div>
      )}

      <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", alignItems: "flex-start" }}>
        <div style={{ flex: "1 1 320px", minWidth: 0, maxWidth: selected ? 380 : undefined, display: "flex", flexDirection: "column", gap: "10px" }}>
          <h3 style={{ margin: 0, fontSize: "15px" }}>Pendentes ({pending.length})</h3>
          {error && (
            <div role="alert" style={{ fontSize: "13px", color: "var(--color-error-text)" }}>
              {error}
            </div>
          )}
          {!loading && pending.length === 0 && !error && (
            <Card>
              <div style={{ color: "var(--text-muted)" }}>Nenhum relatório pendente 🎉</div>
            </Card>
          )}
          {pending.map((p) => {
            const late = now > p.deadline_ms;
            const active = p.session_id === selectedId;
            return (
              <Card
                key={p.session_id}
                onClick={() => setSelectedId(p.session_id)}
                style={{ cursor: "pointer", outline: active ? "2px solid var(--color-teal)" : undefined }}
                bodyStyle={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700 }}>{p.child_name ?? "Criança"}</div>
                  <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                    {p.plan_name ?? "Plano"} · {p.eligible_minutes} min · saiu às {hhmm(p.checkout_at_ms)}
                  </div>
                </div>
                {late ? (
                  <Badge variant="solid_pink">Atrasado</Badge>
                ) : (
                  <Badge variant={p.deadline_ms - now < 10 * 60_000 ? "amber" : "teal"}>⏱ {formatCountdown(p.deadline_ms - now)}</Badge>
                )}
              </Card>
            );
          })}

          <h3 style={{ margin: "12px 0 0", fontSize: "15px" }}>Enviados ({recent.length})</h3>
          {recent.length === 0 && <div style={{ fontSize: "13px", color: "var(--text-muted)" }}>Nada enviado ainda.</div>}
          {recent.map((r) => {
            const st = STATUS_TEXT[r.whatsapp_status];
            const busy = busyIds.has(r.id);
            return (
              <Card key={r.id} bodyStyle={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                  <div style={{ fontWeight: 600, flex: 1, minWidth: 0 }}>{r.child_name_snapshot}</div>
                  {r.late && <Badge variant="amber">fora do prazo</Badge>}
                  <span style={unsent.some((u) => u.id === r.id) && !busy ? { animation: "fa-session-report-banner-blink 1s step-start infinite" } : undefined}>
                    <Badge variant={st.tone}>{busy ? "Enviando…" : st.label}</Badge>
                  </span>
                </div>
                <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                  {new Date(r.filled_at_ms).toLocaleDateString("pt-BR") !== new Date().toLocaleDateString("pt-BR") ? `${new Date(r.filled_at_ms).toLocaleDateString("pt-BR")} ` : ""}{hhmm(r.filled_at_ms)} · por {r.filled_by_name}
                </div>
                {r.whatsapp_error && (
                  <div style={{ fontSize: "12px", color: "var(--color-error-text)" }}>{r.whatsapp_error}</div>
                )}
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "4px" }}>
                  <Button
                    variant="teal"
                    size="sm"
                    loading={busy}
                    onClick={() => void handleSendManualPdf(r.id)}
                  >
                    Enviar Olhar FaçaAmigos em PDF (MANUAL)
                  </Button>
                  {!busy && RETRYABLE.has(r.whatsapp_status) && !isWhatsappRefusal63049(r.whatsapp_error) && (
                    <Button variant="secondary" size="sm" onClick={() => void dispatch(r.id)}>
                      Reenviar
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>

        {selected && (
          <div style={{ flex: "2 1 420px", minWidth: 0 }}>
            <SessionReportForm
              key={selected.session_id}
              report={selected}
              onSubmitted={handleSubmitted}
              onClose={() => setSelectedId(null)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
