import { useEffect, useState } from "react";
import { Card, Modal } from "@facaamigos/ui";
import { Api } from "../api/client.js";
import type { ActiveSessionEntry, SessionEvent } from "../api/client.js";
import { supabase } from "../lib/supabase/client.js";

const PAUSE_REASON_LABEL: Record<string, string> = {
  BANHEIRO: "Foi ao banheiro",
  SAIU_DO_ESPACO: "Saiu do espaço",
  OUTRO: "Outro motivo",
};

const DOCUMENT_LABEL: Record<string, string> = {
  RG: "RG",
  CNH: "CNH",
  PASSAPORTE: "Passaporte",
  CTPS_DIGITAL: "Documento digital (gov.br / CTPS)",
  OUTRO: "Outro documento com foto",
};

interface TimelineStep {
  atMs: number;
  label: string;
  color: string;
  employeeName: string | null;
  detail?: string;
}

function stepFor(event: SessionEvent): TimelineStep {
  switch (event.kind) {
    case "PAUSADA": {
      const reason = (event.payload?.reason as string | undefined) ?? "OUTRO";
      return {
        atMs: event.at_ms,
        label: `⏸ Cobrança congelada: ${PAUSE_REASON_LABEL[reason] ?? reason}`,
        color: "var(--color-amber)",
        employeeName: event.employee_name,
      };
    }
    case "RETOMADA":
      return { atMs: event.at_ms, label: "▶ Cobrança retomada", color: "var(--color-teal)", employeeName: event.employee_name };
    case "TROCA_PLANO":
      return { atMs: event.at_ms, label: "🔄 Plano alterado", color: "var(--color-primary)", employeeName: event.employee_name };
    case "NOTIFICACAO_WHATSAPP":
    case "NOTIFICACAO_SMS_SIMULADA":
      return {
        atMs: event.at_ms,
        label: `📲 Notificação enviada (${event.kind === "NOTIFICACAO_WHATSAPP" ? "WhatsApp" : "SMS"})`,
        color: "var(--color-teal)",
        employeeName: event.employee_name,
        detail: event.payload?.message as string | undefined,
      };
    case "SAIDA_QR_ESCANEADA":
      return {
        atMs: event.at_ms,
        label: "📷 Pulseira lida na saída",
        color: "var(--color-teal)",
        employeeName: event.employee_name,
      };
    // Esta é a linha que dá valor probatório à saída de contingência: sem os
    // detalhes do documento visíveis aqui, o registro existiria no banco e
    // ninguém conseguiria consultá-lo quando precisasse.
    case "SAIDA_MANUAL_AUTORIZADA": {
      const p = event.payload ?? {};
      const documento = DOCUMENT_LABEL[p.documentKind as string] ?? (p.documentKind as string) ?? "documento";
      const quem = (p.guardianName as string | undefined) ?? "pessoa não cadastrada";
      const autorizado = p.authorizedPickup === true;
      return {
        atMs: event.at_ms,
        label: `🪪 Saída manual autorizada — retirada por ${quem}`,
        color: autorizado ? "var(--color-primary)" : "var(--color-amber)",
        employeeName: event.employee_name,
        detail: [
          `Documento conferido: ${documento}`,
          p.documentNote ? `(${p.documentNote as string})` : null,
          autorizado ? "Responsável cadastrado." : "⚠️ EXCEÇÃO — não consta no cadastro.",
          p.reason ? `Justificativa: ${p.reason as string}` : null,
        ]
          .filter(Boolean)
          .join(" "),
      };
    }
    case "REIMPRESSAO_ENTRADA":
      return {
        atMs: event.at_ms,
        label: "🖨️ Pulseira e recibo reimpressos",
        color: "var(--border-subtle)",
        employeeName: event.employee_name,
      };
    default:
      return { atMs: event.at_ms, label: event.kind, color: "var(--border-subtle)", employeeName: event.employee_name };
  }
}

export function SessionTimelineModal({ entry, onClose }: { entry: ActiveSessionEntry; onClose: () => void }) {
  const [steps, setSteps] = useState<TimelineStep[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [events, checkinEmployee] = await Promise.all([
        Api.sessionEvents(entry.session.id),
        entry.session.checkin_by_employee_id
          ? supabase().from("fa_kiosk_employees").select("full_name").eq("id", entry.session.checkin_by_employee_id).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      if (cancelled) return;
      const arrival: TimelineStep = {
        atMs: entry.session.checkin_at_ms,
        label: "🚪 Chegou no espaço",
        color: "var(--color-primary)",
        employeeName: (checkinEmployee.data as { full_name: string } | null)?.full_name ?? null,
      };
      const planAssigned: TimelineStep = {
        atMs: entry.session.checkin_at_ms,
        label: `🎫 Plano atribuído: ${entry.plan.name}`,
        color: entry.plan.color,
        employeeName: arrival.employeeName,
      };
      const started: TimelineStep = { atMs: entry.session.checkin_at_ms, label: "▶ Cobrança iniciada", color: "var(--color-teal)", employeeName: arrival.employeeName };
      setSteps([arrival, planAssigned, started, ...events.map(stepFor)]);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [entry]);

  return (
    <Modal title={`Sessão — ${entry.session.child_name_snapshot}`} onClose={onClose} maxWidth="520px" zIndex={200}>
      {!steps ? (
        <p style={{ color: "var(--text-muted)" }}>Carregando…</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px", maxHeight: "60vh", overflowY: "auto" }}>
          {steps.map((s, i) => (
            <Card key={i} style={{ padding: "12px", borderLeft: `4px solid ${s.color}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "8px" }}>
                <strong style={{ fontSize: "14px" }}>{s.label}</strong>
                <span style={{ fontSize: "12px", color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                  {new Date(s.atMs).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}{" "}
                  ({new Date(s.atMs).toLocaleDateString("pt-BR")})
                </span>
              </div>
              <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "4px" }}>
                👤 Colaborador: {s.employeeName ?? "—"}
              </div>
              {s.detail && <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>💬 Comentário: {s.detail}</div>}
            </Card>
          ))}
        </div>
      )}
    </Modal>
  );
}
