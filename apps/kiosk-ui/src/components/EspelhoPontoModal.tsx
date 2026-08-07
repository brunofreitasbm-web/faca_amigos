import { useEffect, useMemo, useState } from "react";
import { Button, Modal, Select, HelpText } from "@facaamigos/ui";
import { Api } from "../api/client.js";
import type { Employee, EspelhoPonto, EspelhoPontoRecord } from "../api/client.js";
import { ROLE_LABEL } from "../auth/capabilities.js";

const MONTH_LABEL = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

// As 4 colunas impressas — mesmas 4 marcações que PontoScreen oferece
// (Portaria MTP 671/2021). "Entradas e Saídas" do pedido do Owner vira
// estas 4 e não só 2, porque o intervalo já é registrado hoje e omiti-lo
// faria o espelho mentir sobre a jornada real.
const KIND_COLUMNS: { kind: EspelhoPontoRecord["kind"]; label: string }[] = [
  { kind: "ENTRADA", label: "Entrada" },
  { kind: "INTERVALO_INICIO", label: "Início intervalo" },
  { kind: "INTERVALO_FIM", label: "Fim intervalo" },
  { kind: "SAIDA", label: "Saída" },
];

function formatCpf(cpf: string | null): string {
  if (!cpf) return "—";
  const d = cpf.replace(/\D/g, "");
  if (d.length !== 11) return cpf;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

/** Dia (1-31) e "HH:mm" de um timestamp, no fuso da unidade — não em UTC cru. */
function dayAndTimeInTz(atMs: number, timeZone: string): { day: number; time: string } {
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(atMs));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { day: Number(get("day")), time: `${get("hour")}:${get("minute")}` };
}

interface DayRow {
  day: number;
  byKind: Record<EspelhoPontoRecord["kind"], string[]>;
}

function buildDayRows(data: EspelhoPonto): DayRow[] {
  const daysInMonth = new Date(data.year, data.month, 0).getDate();
  const rows: DayRow[] = Array.from({ length: daysInMonth }, (_, i) => ({
    day: i + 1,
    byKind: { ENTRADA: [], SAIDA: [], INTERVALO_INICIO: [], INTERVALO_FIM: [] },
  }));
  for (const rec of data.records) {
    const { day, time } = dayAndTimeInTz(rec.atMs, data.timezone);
    const row = rows[day - 1];
    if (row) row.byKind[rec.kind].push(time);
  }
  return rows;
}

interface EspelhoPontoModalProps {
  employee: Employee;
  onClose: () => void;
}

/**
 * Gera e imprime o espelho de ponto mensal — cabeçalho de identificação
 * (nome, CPF, função, mês) + uma linha por dia do mês com as 4 marcações,
 * e uma linha final para a assinatura física. Nunca mostra PIN: a RPC que
 * alimenta esta tela (fa_kiosk_espelho_ponto) não lê fa_kiosk_local_credentials.
 */
export function EspelhoPontoModal({ employee, onClose }: EspelhoPontoModalProps) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [data, setData] = useState<EspelhoPonto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    Api.espelhoPonto(employee.id, year, month)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "Não foi possível gerar o espelho de ponto"))
      .finally(() => setLoading(false));
  }, [employee.id, year, month]);

  const rows = useMemo(() => (data ? buildDayRows(data) : []), [data]);

  const yearOptions = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i);

  function handlePrint() {
    const printableElement = document.querySelector(".espelho-printable");
    if (!printableElement) {
      window.print();
      return;
    }

    let iframe = document.getElementById("fa-espelho-print-iframe") as HTMLIFrameElement | null;
    if (!iframe) {
      iframe = document.createElement("iframe");
      iframe.id = "fa-espelho-print-iframe";
      iframe.style.position = "fixed";
      iframe.style.right = "0";
      iframe.style.bottom = "0";
      iframe.style.width = "0";
      iframe.style.height = "0";
      iframe.style.border = "0";
      iframe.style.visibility = "hidden";
      document.body.appendChild(iframe);
    }

    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) {
      window.print();
      return;
    }

    doc.open();
    doc.write(`
      <!DOCTYPE html>
      <html lang="pt-BR">
        <head>
          <meta charset="UTF-8">
          <title>Espelho de Ponto — ${employee.full_name}</title>
          <style>
            @page { size: A4 portrait; margin: 14mm; }
            html, body { margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; color: #141414; }
            .espelho-printable { width: 100%; }
            h1 { font-size: 16px; margin: 0 0 4px; }
            .header-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 24px; font-size: 12px; margin-bottom: 14px; border-bottom: 1px solid #999; padding-bottom: 10px; }
            table { width: 100%; border-collapse: collapse; font-size: 11px; }
            th, td { border: 1px solid #999; padding: 4px 6px; text-align: center; }
            th { background: #eee; }
            .signature { margin-top: 40px; font-size: 12px; }
            .signature-line { margin-top: 40px; border-top: 1px solid #141414; width: 320px; text-align: center; padding-top: 4px; }
          </style>
        </head>
        <body>
          ${printableElement.innerHTML}
        </body>
      </html>
    `);
    doc.close();

    setTimeout(() => {
      try {
        iframe?.contentWindow?.focus();
        iframe?.contentWindow?.print();
      } catch (err) {
        console.error("Erro ao imprimir espelho de ponto:", err);
      }
    }, 150);
  }

  return (
    <Modal title="Espelho de Ponto Mensal" onClose={onClose} maxWidth="820px" bodyStyle={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <HelpText>
        Gera a folha de ponto do mês para conferência e assinatura física do colaborador. O PIN nunca aparece aqui.
      </HelpText>

      <div style={{ display: "flex", gap: "8px", alignItems: "flex-end" }}>
        <Select label="Mês" value={String(month)} onChange={(e) => setMonth(Number(e.target.value))}>
          {MONTH_LABEL.map((label, i) => (
            <option key={label} value={i + 1}>
              {label}
            </option>
          ))}
        </Select>
        <Select label="Ano" value={String(year)} onChange={(e) => setYear(Number(e.target.value))}>
          {yearOptions.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </Select>
        <Button variant="primary" disabled={!data || loading} onClick={handlePrint} style={{ marginLeft: "auto" }}>
          🖨️ Imprimir
        </Button>
      </div>

      {loading && <p style={{ color: "var(--text-muted)" }}>Carregando…</p>}
      {error && <p style={{ color: "var(--color-error-text)" }}>{error}</p>}

      {data && (
        <div
          className="espelho-printable"
          style={{ background: "#fff", color: "#141414", padding: "16px", borderRadius: "8px", overflowX: "auto" }}
        >
          <h1>Espelho de Ponto Mensal — {MONTH_LABEL[data.month - 1]}/{data.year}</h1>
          <div className="header-grid">
            <div><strong>Colaborador:</strong> {data.employee.full_name}</div>
            <div><strong>CPF:</strong> {formatCpf(data.employee.cpf)}</div>
            <div><strong>Função:</strong> {data.employee.position ?? ROLE_LABEL[data.employee.role]}</div>
            <div><strong>Jornada semanal contratada:</strong> {data.employee.weekly_hours_contracted ?? "—"}h</div>
          </div>

          <table>
            <thead>
              <tr>
                <th>Dia</th>
                {KIND_COLUMNS.map((c) => (
                  <th key={c.kind}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.day}>
                  <td>{String(row.day).padStart(2, "0")}</td>
                  {KIND_COLUMNS.map((c) => (
                    <td key={c.kind}>{row.byKind[c.kind].join(", ") || "—"}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>

          <div className="signature">
            Declaro que as marcações acima correspondem à minha jornada de trabalho no período.
            <div className="signature-line">Assinatura de {data.employee.full_name}</div>
          </div>
        </div>
      )}
    </Modal>
  );
}
