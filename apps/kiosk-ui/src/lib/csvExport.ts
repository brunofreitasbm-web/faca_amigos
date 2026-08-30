import { dateTimeLabelsInTz } from "./ponto.js";

/** Formato mínimo aceito para exportação — tanto `FolhaPontoRow` (Relatório > Folha de Ponto) quanto os registros do Controle de Frequência têm essas 4 colunas. */
export interface CsvExportableRecord {
  unit_id: string;
  full_name: string;
  kind: string;
  at_ms: number;
  nsr: number;
}

const KIND_LABEL: Record<string, string> = {
  ENTRADA: "Entrada",
  SAIDA: "Saída",
  INTERVALO_INICIO: "Início intervalo",
  INTERVALO_FIM: "Fim intervalo",
};

function csvEscape(value: string): string {
  if (/[",\n;]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/**
 * Gera e baixa um CSV das marcações de ponto (mesmas linhas já mostradas em
 * Relatório > Folha de Ponto) direto no navegador, sem passar por servidor
 * nenhum — mesma ideia do `handleExportCSV` do sistema irmão Porto Terapia.
 * Separador `;` porque é o que o Excel em pt-BR reconhece sem precisar de
 * import manual de CSV.
 *
 * `unitTimezones` mapeia unit_id -> fuso IANA da unidade — sem ele, Data/Hora
 * cairiam no fuso do navegador de quem exporta, podendo jogar marcações perto
 * da meia-noite para o dia errado (mesmo bug já corrigido no Espelho de Ponto
 * e em `lib/ponto.ts`, agora propagado para esta exportação).
 */
export function exportFrequenciaCsv(rows: CsvExportableRecord[], unitTimezones: Record<string, string | null | undefined> = {}): void {
  const header = ["Data", "Hora", "Colaborador", "Marcação", "NSR"];
  const body = rows.map((r) => {
    const { dateLabel, timeLabel } = dateTimeLabelsInTz(r.at_ms, unitTimezones[r.unit_id]);
    return [dateLabel, timeLabel, r.full_name, KIND_LABEL[r.kind] ?? r.kind, String(r.nsr)];
  });

  const csv = [header, ...body].map((row) => row.map(csvEscape).join(";")).join("\n");
  // BOM UTF-8 — sem ele o Excel abre acentuação (ç, ã, é) quebrada.
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const today = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `frequencia_facaamigos_${today}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
