// Regras do Piloto de Bonificação (Circuito + Playground), Fase 1 —
// mesma tabela de metas/valores de docs/bonificacao/programa-bonificacao-set-2026.md
// e docs/bonificacao/apuracao_bonificacao.sql. Cálculo 100% no cliente: não
// existe ainda meta por dia da semana no banco (fa_kiosk_app_settings.daily_goal_cents
// é um valor único por unidade — ver Fase 2 no documento), então este módulo
// só espelha as mesmas regras para o Painel poder mostrar o progresso ao vivo.
//
// Isto é o placar do piloto (08/09 a 05/10/2026), não a apuração oficial:
// quem decide o bônus pago é `apuracao_bonificacao.sql`, que também aplica
// as travas de abertura de caixa e de divergência de fechamento — nenhuma
// das duas trava entra nesta conta, de propósito, porque o Painel não tem
// esse dado à mão durante o turno. Depois da recalibração de 06/10, atualize
// as tabelas abaixo (ou remova o bloco do Painel) para não deixar uma meta
// velha no ar.

export type UnidadeTipo = "PLAYGROUND" | "CIRCUITO";

interface RegraDia {
  meta: number;
  super: number;
  bonusMetaCents: number;
  bonusSuperCents: number;
}

const PLAYGROUND_SEMANA: RegraDia = { meta: 90_000, super: 110_000, bonusMetaCents: 800, bonusSuperCents: 1200 };
// Índice 0 não é usado (dias vão de 1 a 7); mantém o acesso por isodow direto e tipado.
const PLAYGROUND_REGRAS: readonly RegraDia[] = [
  PLAYGROUND_SEMANA,
  PLAYGROUND_SEMANA, // 1 = segunda
  PLAYGROUND_SEMANA, // 2 = terça
  PLAYGROUND_SEMANA, // 3 = quarta
  PLAYGROUND_SEMANA, // 4 = quinta
  { meta: 150_000, super: 180_000, bonusMetaCents: 1200, bonusSuperCents: 1600 }, // 5 = sexta
  { meta: 240_000, super: 280_000, bonusMetaCents: 1200, bonusSuperCents: 1600 }, // 6 = sábado
  { meta: 220_000, super: 260_000, bonusMetaCents: 1200, bonusSuperCents: 1600 }, // 7 = domingo
];

const CIRCUITO_SEMANA: RegraDia = { meta: 8, super: 10, bonusMetaCents: 600, bonusSuperCents: 1000 };
const CIRCUITO_REGRAS: readonly RegraDia[] = [
  CIRCUITO_SEMANA,
  CIRCUITO_SEMANA, // 1 = segunda
  CIRCUITO_SEMANA, // 2 = terça
  CIRCUITO_SEMANA, // 3 = quarta
  CIRCUITO_SEMANA, // 4 = quinta
  { meta: 10, super: 12, bonusMetaCents: 1000, bonusSuperCents: 1600 }, // 5 = sexta
  { meta: 22, super: 27, bonusMetaCents: 1000, bonusSuperCents: 1600 }, // 6 = sábado
  { meta: 30, super: 35, bonusMetaCents: 1000, bonusSuperCents: 1600 }, // 7 = domingo
];

/** Dia da semana ISO (1=segunda … 7=domingo) a partir de um business_date "AAAA-MM-DD". */
export function diaSemanaISO(businessDate: string): number {
  const partes = businessDate.split("-").map(Number);
  const y = partes[0] ?? 1970;
  const m = partes[1] ?? 1;
  const d = partes[2] ?? 1;
  const jsDow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=domingo
  return jsDow === 0 ? 7 : jsDow;
}

export interface BonificacaoHoje {
  tipo: UnidadeTipo;
  dow: number;
  /** Faturamento (Playground, em centavos) ou nº de locações (Circuito). */
  atual: number;
  meta: number;
  super: number;
  percent: number;
  nivel: "abaixo" | "meta" | "supermeta";
  bonusCents: number;
}

export function bonificacaoHoje(tipo: UnidadeTipo, businessDate: string, atual: number): BonificacaoHoje {
  const dow = diaSemanaISO(businessDate);
  const regra = (tipo === "PLAYGROUND" ? PLAYGROUND_REGRAS : CIRCUITO_REGRAS)[dow] ?? CIRCUITO_SEMANA;
  let nivel: BonificacaoHoje["nivel"] = "abaixo";
  let bonusCents = 0;
  if (atual >= regra.super) {
    nivel = "supermeta";
    bonusCents = regra.bonusSuperCents;
  } else if (atual >= regra.meta) {
    nivel = "meta";
    bonusCents = regra.bonusMetaCents;
  }
  // Circuito: +R$1 por locação acima da meta, some com o bônus da meta ou da
  // supermeta — mesma regra de docs/bonificacao/apuracao_bonificacao.sql.
  if (tipo === "CIRCUITO" && atual > regra.meta) {
    bonusCents += (atual - regra.meta) * 100;
  }
  const percent = Math.min(100, Math.round((atual / regra.super) * 100));
  return { tipo, dow, atual, meta: regra.meta, super: regra.super, percent, nivel, bonusCents };
}

export const PILOTO_INICIO = "2026-09-08";
export const PILOTO_FIM = "2026-10-05";

/** true enquanto o business_date de hoje estiver dentro da janela do piloto. */
export function dentroDoPiloto(businessDate: string): boolean {
  return businessDate >= PILOTO_INICIO && businessDate <= PILOTO_FIM;
}
