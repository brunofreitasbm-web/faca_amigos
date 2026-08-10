export type PontoKind = "ENTRADA" | "SAIDA" | "INTERVALO_INICIO" | "INTERVALO_FIM";

export interface PontoRecordForCalc {
  kind: PontoKind;
  at_ms: number;
}

export interface WorkedMinutesResult {
  /** Minutos trabalhados no período (jornada menos intervalos), nunca negativo. */
  minutes: number;
  /** true quando alguma marcação ficou sem par (ex.: turno ainda aberto no fim do mês) — o total é aproximado. */
  incomplete: boolean;
}

/**
 * Total trabalhado a partir de marcações brutas de ponto.
 *
 * Pareia por ordem cronológica (mesmo algoritmo já usado em
 * RelatorioScreen.summarizeDailyHours), não por contagem/soma de sinal: uma
 * ENTRADA repetida sem SAÍDA no meio, ou uma SAÍDA sem ENTRADA antes, não
 * pode virar horas "prováveis" — precisa cair em `incomplete` para o
 * responsável pela folha revisar antes de fechar o pagamento.
 */
export function computeWorkedMinutes(records: PontoRecordForCalc[]): WorkedMinutesResult {
  const sorted = [...records].sort((a, b) => a.at_ms - b.at_ms);
  let workedMs = 0;
  let entradaAt: number | null = null;
  let intervaloAt: number | null = null;
  let incomplete = false;

  for (const record of sorted) {
    if (record.kind === "ENTRADA") {
      if (entradaAt !== null) incomplete = true;
      entradaAt = record.at_ms;
    } else if (record.kind === "SAIDA") {
      if (entradaAt === null) {
        incomplete = true;
      } else {
        workedMs += record.at_ms - entradaAt;
        entradaAt = null;
      }
    } else if (record.kind === "INTERVALO_INICIO") {
      if (intervaloAt !== null) incomplete = true;
      intervaloAt = record.at_ms;
    } else if (record.kind === "INTERVALO_FIM") {
      if (intervaloAt === null) {
        incomplete = true;
      } else {
        workedMs -= record.at_ms - intervaloAt;
        intervaloAt = null;
      }
    }
  }
  if (entradaAt !== null || intervaloAt !== null) incomplete = true;

  const minutes = Math.max(0, Math.round(workedMs / 60000));
  return { minutes, incomplete };
}

/** Fuso do negócio usado quando a unidade não tem timezone cadastrado — mesmo default do servidor (fa_kiosk_espelho_ponto). */
const DEFAULT_BUSINESS_TIMEZONE = "America/Belem";

/** ms UTC correspondente a um instante "de parede" (ano/mês/dia/hora local) num fuso IANA arbitrário. */
function zonedWallTimeToUtcMs(year: number, month: number, day: number, hour: number, timeZone: string): number {
  const utcGuessMs = Date.UTC(year, month - 1, day, hour);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcGuessMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtcIfLocalWereUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  const offsetMs = asUtcIfLocalWereUtc - utcGuessMs;
  return utcGuessMs - offsetMs;
}

/**
 * Início (inclusive) e fim (exclusivo) de um mês, em ms, no fuso da
 * unidade — antes calculado com offset fixo UTC-3, divergindo do fuso real
 * usado pela RPC fa_kiosk_espelho_ponto (fa_kiosk_units.timezone), o que
 * podia jogar marcações perto da meia-noite para o mês/dia errado numa
 * unidade fora de UTC-3.
 */
export function monthRangeMs(year: number, month: number, timeZone: string = DEFAULT_BUSINESS_TIMEZONE): { fromMs: number; toMs: number } {
  const fromMs = zonedWallTimeToUtcMs(year, month, 1, 0, timeZone);
  const nextMonthYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const toMs = zonedWallTimeToUtcMs(nextMonthYear, nextMonth, 1, 0, timeZone);
  return { fromMs, toMs };
}
