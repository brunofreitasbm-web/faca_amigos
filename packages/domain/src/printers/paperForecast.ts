/**
 * Projeção de consumo de bobina (módulo de gestão > Bobinas).
 *
 * Cada impressão de cupom já é medida no momento em que sai da impressora
 * (`generateEscPosReceipt(...).estimatedLengthMm`, em `escpos.ts`) e abatida
 * da bobina ativa da unidade via `fa_kiosk_register_print_consumption` (ver
 * supabase/migrations/20261006120000_fa_kiosk_paper_rolls.sql). Este módulo
 * não lê nada do banco — recebe os números já buscados pela UI (Gerencial >
 * Bobinas) e devolve só a conta.
 */

/** Uma impressão de cupom já registrada, usada pra estimar o ritmo de consumo. */
export interface PaperConsumptionSample {
  /** `fa_kiosk_print_jobs.printed_at_ms` — quando o cupom saiu da impressora. */
  printedAtMs: number;
  /** `fa_kiosk_print_jobs.paper_length_mm` — comprimento estimado deste cupom. */
  lengthMm: number;
}

export interface PaperRollForecast {
  /** mm restantes na bobina ativa. Pode ficar negativo: já devia ter sido troca. */
  remainingMm: number;
  /** Consumo médio estimado, em mm por dia. */
  avgDailyMm: number;
  /** Dias restantes no ritmo médio atual. `null` quando não há consumo suficiente pra estimar (ex.: bobina acabou de ser instalada, zero impressões ainda). */
  daysToEmpty: number | null;
  /** Timestamp (ms) previsto de término. `null` sempre que `daysToEmpty` for `null`. */
  forecastDateMs: number | null;
}

/**
 * Projeta quando a bobina ATIVA de uma unidade vai acabar, a partir do que
 * já foi consumido desde que foi instalada.
 *
 * `samples` é o histórico de impressões da unidade desde `installedAtMs`
 * (cada cupom RECEIPT impresso, com seu comprimento estimado) — a tela que
 * chama isto busca essas linhas de `fa_kiosk_print_jobs` e passa aqui sem
 * agregar, pra quem decide a janela/agregação ser esta função, num lugar só.
 */
export function computePaperRollForecast(input: {
  rollLengthMm: number;
  consumedMm: number;
  installedAtMs: number;
  samples: PaperConsumptionSample[];
  nowMs?: number;
}): PaperRollForecast {
  const remainingMm = input.rollLengthMm - input.consumedMm;

  // TODO(human): calcule avgDailyMm, daysToEmpty e forecastDateMs a partir
  // de input.samples (cada impressão desde installedAtMs até nowMs).
  //
  // Pontos em aberto, de propósito — são decisões de negócio, não só de
  // código:
  //   - Janela de média: últimos 7 dias corridos, ou todo o histórico desde
  //     a troca? Uma bobina instalada há 2 dias não tem uma semana de dado.
  //   - Um dia sem nenhuma impressão (loja fechada, feriado) conta como
  //     "0 de consumo" nesse dia, ou é descontado da janela (dia que não
  //     "existiu" pra efeito de ritmo)? Isso muda bastante a média.
  //   - Com `samples` vazio (bobina nova, zero cupons ainda) `avgDailyMm`
  //     deve ser 0 e `daysToEmpty`/`forecastDateMs` ficam `null` — nunca
  //     `Infinity` ou uma divisão por zero disfarçada.
  const avgDailyMm = 0;
  const daysToEmpty: number | null = null;
  const forecastDateMs: number | null = null;

  return { remainingMm, avgDailyMm, daysToEmpty, forecastDateMs };
}
