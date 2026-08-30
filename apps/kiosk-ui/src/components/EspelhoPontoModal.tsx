import { useEffect, useMemo, useState } from "react";
import { Button, Modal, Select, HelpText } from "@facaamigos/ui";
import { Api } from "../api/client.js";
import type { Employee, EspelhoPonto, EspelhoPontoRecord } from "../api/client.js";
import { ROLE_LABEL } from "../auth/capabilities.js";
import { computeWorkedMinutes } from "../lib/ponto.js";

function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h${String(m).padStart(2, "0")}`;
}

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

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(`${iso}T00:00:00`).toLocaleDateString("pt-BR");
}

function formatCtps(numero: string | null, serie: string | null, uf: string | null): string {
  if (!numero) return "—";
  return [numero, serie, uf].filter(Boolean).join(" / ");
}

/** Dia (1-31) e "HH:mm" de um timestamp, no fuso da unidade — não em UTC cru. */
function dayAndTimeInTz(atMs: number, timeZone?: string | null): { day: number; time: string } {
  const tz = timeZone && timeZone.trim() ? timeZone : "America/Belem";
  try {
    const parts = new Intl.DateTimeFormat("pt-BR", {
      timeZone: tz,
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date(atMs));
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    return { day: Number(get("day")), time: `${get("hour")}:${get("minute")}` };
  } catch {
    const d = new Date(atMs);
    return {
      day: d.getDate(),
      time: `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`,
    };
  }
}

/**
 * Timbre do espelho — marca FaçaAmigos com cores fixas em hex, não
 * `var(--...)`: este bloco é copiado por `innerHTML` para dentro de um
 * `<iframe>` isolado na hora de imprimir (ver handlePrint), que não herda
 * os tokens CSS da página. Cores hardcoded são o que garante que a marca
 * saia com a cor certa tanto na prévia quanto no papel.
 */
function Timbre() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px" }}>
      <svg width="34" height="39" viewBox="0 0 64 74" fill="none" aria-hidden="true">
        <g fill="none" strokeLinecap="round" strokeWidth="12">
          <path d="M16 50 V36 a10 10 0 0 1 20 0 V44" stroke="#FFE234" />
          <path d="M28 44 V36 a10 10 0 0 1 20 0 V50" stroke="#2ECFB5" opacity="0.93" />
        </g>
        <circle cx="26" cy="66" r="6.5" fill="#F0196B" />
      </svg>
      <span style={{ fontSize: "20px", fontWeight: "bold" }}>
        <span style={{ color: "#1A3F35" }}>Faça</span>
        <span style={{ color: "#F0196B" }}>Amigos</span>
      </span>
    </div>
  );
}

interface DayRow {
  day: number;
  byKind: Record<EspelhoPontoRecord["kind"], string[]>;
  workedMinutes: number;
  incomplete: boolean;
}

/**
 * Além da grade de horários (para assinatura), também soma o total
 * trabalhado por dia com `computeWorkedMinutes` (mesmo cálculo do Controle
 * de Frequência e da Folha de Pagamento) — sem isso o Espelho de Ponto,
 * apesar do nome, nunca mostrava horas trabalhadas nem sinalizava jornada
 * incompleta, só a lista de marcações brutas.
 */
function buildDayRows(data: EspelhoPonto): DayRow[] {
  const daysInMonth = new Date(data.year, data.month, 0).getDate();
  const recordsByDay: EspelhoPontoRecord[][] = Array.from({ length: daysInMonth }, () => []);
  const rows: DayRow[] = Array.from({ length: daysInMonth }, (_, i) => ({
    day: i + 1,
    byKind: { ENTRADA: [], SAIDA: [], INTERVALO_INICIO: [], INTERVALO_FIM: [] },
    workedMinutes: 0,
    incomplete: false,
  }));
  for (const rec of data.records || []) {
    const { day, time } = dayAndTimeInTz(rec.atMs, data.timezone);
    const row = rows[day - 1];
    if (row && row.byKind && row.byKind[rec.kind]) {
      row.byKind[rec.kind].push(time);
      recordsByDay[day - 1]!.push(rec);
    }
  }
  rows.forEach((row, i) => {
    const { minutes, incomplete } = computeWorkedMinutes(recordsByDay[i]!.map((r) => ({ kind: r.kind, at_ms: r.atMs })));
    row.workedMinutes = minutes;
    row.incomplete = incomplete;
  });
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

  // Mês/ano selecionado ainda não ocorreu — nem vale chamar a API (que
  // devolveria uma tabela vazia, parecendo um bug em vez de "mês futuro").
  const isFutureMonth = year > now.getFullYear() || (year === now.getFullYear() && month > now.getMonth() + 1);

  const fetchEspelho = () => {
    if (isFutureMonth) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    Api.espelhoPonto(employee.id, year, month)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "Não foi possível gerar o espelho de ponto"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchEspelho();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employee.id, year, month, isFutureMonth]);

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
        <div style={{ marginLeft: "auto", display: "flex", gap: "8px" }}>
          <Button variant="secondary" disabled={loading} onClick={fetchEspelho}>
            🔄 Atualizar
          </Button>
          <Button variant="primary" disabled={!data || loading} onClick={handlePrint}>
            🖨️ Imprimir
          </Button>
        </div>
      </div>

      {isFutureMonth && <p style={{ color: "var(--text-muted)" }}>Este mês ainda não decorreu — escolha um mês já passado ou o atual.</p>}
      {loading && <p style={{ color: "var(--text-muted)" }}>Carregando…</p>}
      {error && <p style={{ color: "var(--color-error-text)" }}>{error}</p>}

      {data && (
        <div
          className="espelho-printable"
          style={{ background: "#fff", color: "#141414", padding: "16px", borderRadius: "8px", overflowX: "auto" }}
        >
          <Timbre />

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "10px" }}>
            <h1 style={{ margin: 0 }}>Espelho de Ponto Mensal — {MONTH_LABEL[data.month - 1]}/{data.year}</h1>
            <span style={{ fontSize: "11px", color: "#555" }}>
              Emitido em {new Date().toLocaleDateString("pt-BR")} às {new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>

          {data.units.length > 0 && (
            <div style={{ fontSize: "12px", marginBottom: "10px", paddingBottom: "10px", borderBottom: "1px solid #999" }}>
              {data.units.map((u) => (
                <div key={u.name} style={{ marginBottom: "2px" }}>
                  <strong>{u.nomeFantasia ?? u.name}</strong>
                  {u.razaoSocial ? ` — ${u.razaoSocial}` : ""}
                  {u.cnpj ? ` · CNPJ ${u.cnpj}` : ""}
                  {u.address ? ` · ${u.address}` : ""}
                  {u.phone ? ` · ${u.phone}` : ""}
                </div>
              ))}
            </div>
          )}

          <div className="header-grid">
            <div><strong>Colaborador:</strong> {data.employee.full_name}</div>
            <div><strong>CPF:</strong> {formatCpf(data.employee.cpf)}</div>
            <div><strong>RG:</strong> {data.employee.rg_numero ?? "—"}{data.employee.rg_orgao_emissor ? ` (${data.employee.rg_orgao_emissor})` : ""}</div>
            <div><strong>CTPS:</strong> {formatCtps(data.employee.ctps_numero, data.employee.ctps_serie, data.employee.ctps_uf)}</div>
            <div><strong>Data de nascimento:</strong> {formatDate(data.employee.birth_date)}</div>
            <div><strong>Data de admissão:</strong> {formatDate(data.employee.admission_date)}</div>
            <div><strong>Permissão:</strong> {ROLE_LABEL[data.employee.role]}</div>
            <div><strong>Jornada semanal contratada:</strong> {data.employee.weekly_hours_contracted ?? "—"}h</div>
          </div>

          <table>
            <thead>
              <tr>
                <th>Dia</th>
                {KIND_COLUMNS.map((c) => (
                  <th key={c.kind}>{c.label}</th>
                ))}
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.day}>
                  <td>{String(row.day).padStart(2, "0")}</td>
                  {KIND_COLUMNS.map((c) => (
                    <td key={c.kind}>{row.byKind[c.kind].join(", ") || "—"}</td>
                  ))}
                  <td>
                    {KIND_COLUMNS.every((c) => row.byKind[c.kind].length === 0) ? "—" : formatMinutes(row.workedMinutes)}
                    {row.incomplete && <span title="Marcação incompleta neste dia"> ⚠️</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <p style={{ fontSize: "12px", color: "#555", marginTop: "8px" }}>
            Total do mês: <strong>{formatMinutes(rows.reduce((sum, r) => sum + r.workedMinutes, 0))}</strong>
            {rows.some((r) => r.incomplete) && (
              <> — ⚠️ {rows.filter((r) => r.incomplete).length} dia(s) com marcação incompleta (total aproximado)</>
            )}
          </p>

          <div className="signature">
            Declaro que as marcações acima correspondem à minha jornada de trabalho no período.
            <div className="signature-line">Assinatura de {data.employee.full_name}</div>
          </div>
        </div>
      )}
    </Modal>
  );
}
