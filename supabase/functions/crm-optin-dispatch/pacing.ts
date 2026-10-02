// Ritmo da campanha de opt-in (funções puras, testadas em pacing.test.ts).
//
// O que protege o número na API oficial é a nota de qualidade (bloqueios,
// denúncias, PARAR), não o horário dos envios. Espalhar os envios ao longo do
// dia, em rodadas pequenas e irregulares, serve para o freio automático
// (index.ts) enxergar uma reação ruim da base depois de poucos envios, antes
// que um lote grande derrube a nota. A rampa só acelera enquanto a base reage bem.

export const WINDOW_START_MIN = 8 * 60; // 8h de Belém
export const WINDOW_END_MIN = 20 * 60; // 20h (exclusivo)
export const RUN_EVERY_MIN = 5; // pg_cron: */5
export const MAX_PER_RUN = 2; // "de um em um, dois em dois"

export const RAMP_BASE = 30; // meta do 1º dia
export const RAMP_FACTOR = 1.5; // 30, 45, 67, 101, 151…
export const RAMP_HOLD_RATE = 0.015; // PARAR >= 1,5% no último dia: não sobe
export const RAMP_MIN_SAMPLE = 10;

// Faixas em que os pais mais leem e respondem: pesam o dobro.
const PEAKS: Array<[number, number]> = [
  [10 * 60, 12 * 60],
  [17 * 60, 19 * 60],
];

/**
 * Nível da rampa para hoje, a partir do último dia em que a campanha enviou.
 * Sem envios nesse dia (pausada), mantém. PARAR alto (com amostra mínima), mantém.
 */
export function nextRampLevel(level: number, sentLastDay: number, declinedLastDay: number): number {
  if (sentLastDay === 0) return level;
  if (sentLastDay >= RAMP_MIN_SAMPLE && declinedLastDay / sentLastDay >= RAMP_HOLD_RATE)
    return level;
  return level + 1;
}

const rampAt = (level: number) => Math.floor(RAMP_BASE * Math.pow(RAMP_FACTOR, level));

/**
 * Meta de envios do dia: a rampa, enquanto ela sozinha fecha a fila dentro do
 * prazo; se não fecha (rampa segurada por PARAR, prazo apertado), o necessário
 * para fechar. Nunca acima do teto configurado.
 */
export function dailyTarget(
  rampLevel: number,
  dailyCap: number,
  pending: number,
  daysLeft: number,
): number {
  const days = Math.max(1, daysLeft);
  let rampCapacity = 0;
  for (let k = 0; k < days; k++) rampCapacity += Math.min(dailyCap, rampAt(rampLevel + k));
  const ramp = rampAt(rampLevel);
  const target = rampCapacity >= pending ? ramp : Math.max(ramp, Math.ceil(pending / days));
  return Math.max(0, Math.min(dailyCap, pending, target));
}

export function slotWeight(slotMin: number): number {
  return PEAKS.some(([a, b]) => slotMin >= a && slotMin < b) ? 2 : 1;
}

/**
 * Quantos envios nesta rodada (0..MAX_PER_RUN). O que falta para a meta do dia
 * é repartido entre as rodadas restantes, proporcional ao peso de cada uma, e
 * arredondado no sorteio. Por isso a sequência sai irregular (0, 1, 2, 0, 1…),
 * mas a soma do dia fica perto da meta.
 */
export function runQuota(
  target: number,
  sentToday: number,
  minuteOfDay: number,
  random: () => number = Math.random,
): number {
  const remaining = target - sentToday;
  if (remaining <= 0) return 0;
  if (minuteOfDay < WINDOW_START_MIN || minuteOfDay >= WINDOW_END_MIN) return 0;

  const current = minuteOfDay - (minuteOfDay % RUN_EVERY_MIN);
  let totalWeight = 0;
  for (let m = current; m < WINDOW_END_MIN; m += RUN_EVERY_MIN) totalWeight += slotWeight(m);

  const expected = (remaining * slotWeight(current)) / totalWeight;
  const quota = Math.floor(expected) + (random() < expected - Math.floor(expected) ? 1 : 0);
  return Math.min(quota, MAX_PER_RUN, remaining);
}

/** Pausa aleatória entre dois envios da mesma rodada: 8 a 90 s. */
export function gapMs(random: () => number = Math.random): number {
  return Math.round(8_000 + random() * 82_000);
}

// Falhas de entrega que dependem de QUEM RECEBE (sem WhatsApp, limite de
// marketing da Meta, já deu PARAR) não dizem nada sobre a saúde do número e
// não entram no freio automático. Qualquer outro código (conta travada, limite
// diário, template pausado…) ou erro sem código conta como falha do remetente.
const RECIPIENT_SIDE_ERRORS = new Set(["63003", "63024", "63033", "63049", "63050"]);

export const FAILURE_MIN_SAMPLE = 30; // base antiga sempre tem números mortos: amostra maior que a do PARAR

export function isSenderFault(error: string | null | undefined): boolean {
  const code = error?.match(/\d{5}/)?.[0];
  return !code || !RECIPIENT_SIDE_ERRORS.has(code);
}

export function senderFaultCount(rows: Array<{ error: string | null }>): number {
  return rows.filter((r) => isSenderFault(r.error)).length;
}

/** Erro que indica número sem WhatsApp: o responsável sai das próximas filas. */
export const isNoWhatsappError = (code: string | undefined) => code === "63024";
