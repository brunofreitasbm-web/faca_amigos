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
  */
export function computeWorkedMinutes(records: PontoRecordForCalc[]): WorkedMinutesResult {
  const countByKind: Record<PontoKind, number> = {
    ENTRADA: 0,
    SAIDA: 0,
    INTERVALO_INICIO: 0,
    INTERVALO_FIM: 0,
  };
  let sumMs = 0;
  const SIGN_BY_KIND: Record<PontoKind, 1 | -1> = {
    SAIDA: 1,
    ENTRADA: -1,
    INTERVALO_INICIO: 1,
    INTERVALO_FIM: -1,
  };

  for (const record of records) {
    countByKind[record.kind] += 1;
    sumMs += SIGN_BY_KIND[record.kind] * record.at_ms;
  }

  const incomplete = countByKind.ENTRADA !== countByKind.SAIDA || countByKind.INTERVALO_INICIO !== countByKind.INTERVALO_FIM;
  const minutes = Math.max(0, Math.round(sumMs / 60000));

  return { minutes, incomplete };
}

const BUSINESS_TIMEZONE_UTC_OFFSET_MS = 3 * 60 * 60 * 1000;

/** Início (inclusive) e fim (exclusivo) de um mês, em ms, no fuso do negócio (UTC-3). */
export function monthRangeMs(year: number, month: number): { fromMs: number; toMs: number } {
  return {
    fromMs: Date.UTC(year, month - 1, 1) + BUSINESS_TIMEZONE_UTC_OFFSET_MS,
    toMs: Date.UTC(year, month, 1) + BUSINESS_TIMEZONE_UTC_OFFSET_MS,
  };
}
