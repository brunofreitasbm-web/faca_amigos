// Apuração de bonificação por operador/mês — porta para o cliente da mesma
// lógica de docs/bonificacao/apuracao_bonificacao.sql (fonte oficial do
// programa, docs/bonificacao/programa-bonificacao-set-2026.md), generalizada
// para qualquer unidade/período em vez dos IDs e datas fixas do script manual.
// Mantenha os dois em sincronia se as regras do piloto mudarem.
//
// As metas/valores do programa (antes hardcoded aqui) agora vêm de fora, via
// `programs` — configurados pelo Owner em Gerencial > Metas e lidos de
// fa_kiosk_bonus_program_goals/fa_kiosk_bonus_program_config (migration
// 20260911100000). Uma unidade sem configuração simplesmente não gera bônus
// (nunca um valor adivinhado) — ver `BonusProgramConfig` abaixo.

export type UnidadeTipo = "PLAYGROUND" | "CIRCUITO";

/** Meta/supermeta do dia da semana de uma unidade (weekday: isodow 1-7). */
export interface BonusProgramGoal {
  weekday: number;
  /** Faturamento em centavos (Playground) ou nº de locações (Circuito). */
  metaValor: number;
  superValor: number;
  metaBonusCents: number;
  superBonusCents: number;
}

/** Configuração do programa de bonificação de UMA unidade, editável em Gerencial > Metas. */
export interface BonusProgramConfig {
  goals: BonusProgramGoal[];
  /** Teto de bônus (metas + produtos) por operador no mês; 0 = sem teto. */
  tetoMesCents: number;
  produtoPrecoCorteCents: number;
  produtoBonusBaixoCents: number;
  produtoBonusAltoCents: number;
  /** 0 = bônus de itens do mês desativado nesta unidade. */
  itensMesMeta: number;
  itensMesBonusCents: number;
  /** Só Playground: % mínimo (0-100) de sessões de 1h+ para o bônus extra do dia. */
  sessao1hPercentualMin: number;
  sessao1hBonusCents: number;
  /** Só Circuito: bônus por locação acima da meta do dia. */
  locacaoExtraBonusCents: number;
}

/** unitId -> configuração; uma unidade ausente do mapa está "não configurada" (zero bônus). */
export type BonusProgramsByUnit = Record<string, BonusProgramConfig>;

function metaDoDia(program: BonusProgramConfig | null, weekday: number): BonusProgramGoal | null {
  return program?.goals.find((g) => g.weekday === weekday) ?? null;
}

/** Mês atual no formato "AAAA-MM", usado como padrão dos seletores de mês. */
export function mesAtualValue(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/** Primeiro e último dia (AAAA-MM-DD) do mês no formato "AAAA-MM". */
export function rangeDoMes(mesValue: string): { from: string; to: string } {
  const [yStr, mStr] = mesValue.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  const from = `${yStr}-${mStr}-01`;
  const ultimoDia = new Date(y, m, 0).getDate();
  const to = `${yStr}-${mStr}-${String(ultimoDia).padStart(2, "0")}`;
  return { from, to };
}

/** Dia da semana ISO (1=segunda … 7=domingo) a partir de "AAAA-MM-DD". */
export function diaSemanaISO(businessDate: string): number {
  const partes = businessDate.split("-").map(Number);
  const y = partes[0] ?? 1970;
  const m = partes[1] ?? 1;
  const d = partes[2] ?? 1;
  const jsDow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return jsDow === 0 ? 7 : jsDow;
}

const ABERTURA_LIMITE_HORA = 10 * 60 + 15; // 10:15 em minutos desde 00:00
const DIVERGENCIA_SEM_JUSTIFICATIVA_LIMIT_CENTS = 2000; // R$20

export interface RawSession {
  unit_id: string;
  business_date: string;
  checkin_by_employee_id: string | null;
  order_id: string | null;
  plan_id: string | null;
  canceled: boolean;
}
export interface RawPlan {
  id: string;
  duration_unit: "HORA" | "MINUTO" | string;
  duration_value: number;
}
export interface RawOrder {
  id: string;
  unit_id: string;
  business_date: string;
  status: string;
  total_cents: number;
  closed_by_employee_id: string | null;
}
export interface RawOrderItem {
  order_id: string;
  item_type: string;
  quantity: number;
  total_cents: number;
  unit_price_cents: number;
}
export interface RawShift {
  unit_id: string;
  business_date: string;
  status: "ABERTO" | "FECHADO";
  opened_at_ms: number;
  opened_by_employee_id: string;
  declared_json: Record<string, number> | null;
  expected_json: Record<string, number> | null;
  close_justifications_json: Record<string, string> | null;
}
export interface RawEmployee {
  id: string;
  full_name: string;
  role: string;
}
export interface RawUnit {
  id: string;
  name: string;
  kind: string;
}

export interface ApuracaoInput {
  from: string;
  to: string;
  sessions: RawSession[];
  plans: RawPlan[];
  orders: RawOrder[];
  orderItems: RawOrderItem[];
  shifts: RawShift[];
  employees: RawEmployee[];
  units: RawUnit[];
  /** Configuração do programa por unidade — unidade ausente aqui não gera bônus. */
  programs: BonusProgramsByUnit;
}

export interface ApuracaoDia {
  unitId: string;
  businessDate: string;
  employeeId: string;
  faturamentoCents: number;
  /** Pedidos PAGA distintos das sessões com check-in do operador no dia (base do ticket médio). */
  pedidos: number;
  sessoes: number;
  sessoes1hMais: number;
  itens: number;
  produtosCents: number;
  bonusProdutosCents: number;
  travaAberturaOk: boolean;
  travaCaixaOk: boolean;
  bonusMetaCents: number;
  bonusDiaCents: number;
}

export interface ApuracaoOperador {
  unitId: string;
  unitName: string;
  tipo: UnidadeTipo;
  employeeId: string;
  employeeName: string;
  diasComBonus: number;
  diasTrabalhados: number;
  itensMes: number;
  pedidosMes: number;
  /** Faturamento ÷ pedidos do mês (0 se não houve pedido). */
  ticketMedioMesCents: number;
  bonusProdutosMesCents: number;
  bonusMetaMesCents: number;
  acumuladoMesCents: number; // já com o teto configurado da unidade aplicado
  atingiuTeto: boolean;
}

function tipoDaUnidade(kind: string): UnidadeTipo {
  return kind === "QUIOSQUE" ? "CIRCUITO" : "PLAYGROUND";
}

function minutosDoHorario(ms: number): number {
  // Horário local de Belém (UTC-3, sem horário de verão) para bater com a
  // trava de abertura do script SQL (`at time zone 'America/Belem'`).
  const belemMs = ms - 3 * 60 * 60 * 1000;
  const d = new Date(belemMs);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** Calcula a apuração dia a dia por operador/unidade, igual a apuracao_bonificacao.sql. */
export function apurarBonificacaoPorDia(input: ApuracaoInput): ApuracaoDia[] {
  const unitById = new Map(input.units.map((u) => [u.id, u]));
  const employeeById = new Map(input.employees.map((e) => [e.id, e]));
  const planById = new Map(input.plans.map((p) => [p.id, p]));
  const orderById = new Map(input.orders.map((o) => [o.id, o]));

  const validSessions = input.sessions.filter((s) => !s.canceled);

  // rev: faturamento (pedidos PAGA distintos das sessões com check-in do operador)
  const revKey = (unitId: string, date: string, empId: string) => `${unitId}|${date}|${empId}`;
  const sessOrders = new Map<string, Set<string>>(); // revKey -> orderIds
  for (const s of validSessions) {
    if (!s.order_id || !s.checkin_by_employee_id) continue;
    const key = revKey(s.unit_id, s.business_date, s.checkin_by_employee_id);
    const set = sessOrders.get(key) ?? new Set<string>();
    set.add(s.order_id);
    sessOrders.set(key, set);
  }
  const revByKey = new Map<string, number>();
  for (const [key, orderIds] of sessOrders) {
    let total = 0;
    for (const orderId of orderIds) {
      const o = orderById.get(orderId);
      if (o && o.status === "PAGA") total += o.total_cents;
    }
    revByKey.set(key, total);
  }

  // sess_agg: contagem de sessões e sessões >= 1h
  const sessAgg = new Map<string, { sessoes: number; sessoes1hMais: number }>();
  for (const s of validSessions) {
    if (!s.checkin_by_employee_id) continue;
    const key = revKey(s.unit_id, s.business_date, s.checkin_by_employee_id);
    const plan = s.plan_id ? planById.get(s.plan_id) : null;
    const planMin = plan ? (plan.duration_unit === "HORA" ? plan.duration_value * 60 : plan.duration_value) : 0;
    const cur = sessAgg.get(key) ?? { sessoes: 0, sessoes1hMais: 0 };
    cur.sessoes += 1;
    if (planMin >= 60) cur.sessoes1hMais += 1;
    sessAgg.set(key, cur);
  }

  // prod: itens/produtos por pedido fechado pelo operador
  const itemsByOrder = new Map<string, RawOrderItem[]>();
  for (const item of input.orderItems) {
    if (item.item_type !== "PRODUTO") continue;
    const list = itemsByOrder.get(item.order_id) ?? [];
    list.push(item);
    itemsByOrder.set(item.order_id, list);
  }
  const prodByKey = new Map<string, { itens: number; prodCents: number; bonusProdCents: number }>();
  for (const o of input.orders) {
    if (o.status !== "PAGA" || !o.closed_by_employee_id) continue;
    if (o.business_date < input.from || o.business_date > input.to) continue;
    const items = itemsByOrder.get(o.id);
    if (!items || items.length === 0) continue;
    const key = revKey(o.unit_id, o.business_date, o.closed_by_employee_id);
    const cur = prodByKey.get(key) ?? { itens: 0, prodCents: 0, bonusProdCents: 0 };
    const program = input.programs[o.unit_id] ?? null;
    for (const item of items) {
      cur.itens += item.quantity;
      cur.prodCents += item.total_cents;
      if (program) {
        const bonusPorItem = item.unit_price_cents < program.produtoPrecoCorteCents ? program.produtoBonusBaixoCents : program.produtoBonusAltoCents;
        cur.bonusProdCents += bonusPorItem * item.quantity;
      }
    }
    prodByKey.set(key, cur);
  }

  // shifts_dia: abertura, fechamento e divergência por unidade/dia
  const shiftsDia = new Map<
    string,
    { aberturaMin: number | null; fechado: boolean; divergSemJustificativa: boolean }
  >();
  const shiftUnitDateKey = (unitId: string, date: string) => `${unitId}|${date}`;
  const shiftsByUnitDate = new Map<string, RawShift[]>();
  for (const sh of input.shifts) {
    const key = shiftUnitDateKey(sh.unit_id, sh.business_date);
    const list = shiftsByUnitDate.get(key) ?? [];
    list.push(sh);
    shiftsByUnitDate.set(key, list);
  }
  for (const [key, shifts] of shiftsByUnitDate) {
    let aberturaMin: number | null = null;
    let fechado = true;
    let divergSemJustificativa = false;
    for (const sh of shifts) {
      const opener = employeeById.get(sh.opened_by_employee_id);
      if (opener?.role !== "ADMIN") {
        const min = minutosDoHorario(sh.opened_at_ms);
        if (aberturaMin === null || min < aberturaMin) aberturaMin = min;
      }
      if (sh.status !== "FECHADO") fechado = false;
      const expected = sh.expected_json ?? {};
      const declared = sh.declared_json ?? {};
      const justif = sh.close_justifications_json ?? {};
      const allKeys = new Set([...Object.keys(expected), ...Object.keys(declared)]);
      for (const k of allKeys) {
        const diff = Math.abs((declared[k] ?? 0) - (expected[k] ?? 0));
        if (diff > DIVERGENCIA_SEM_JUSTIFICATIVA_LIMIT_CENTS && !justif[k]) divergSemJustificativa = true;
      }
    }
    shiftsDia.set(key, { aberturaMin, fechado, divergSemJustificativa });
  }

  // dias: união de todas as chaves unidade/data/operador com algum dado
  const allKeys = new Set<string>([...revByKey.keys(), ...sessAgg.keys(), ...prodByKey.keys()]);
  const result: ApuracaoDia[] = [];
  for (const key of allKeys) {
    const [unitId, businessDate, employeeId] = key.split("|");
    if (!unitId || !businessDate || !employeeId) continue;
    if (businessDate < input.from || businessDate > input.to) continue;
    const unit = unitById.get(unitId);
    const employee = employeeById.get(employeeId);
    if (!unit || !employee || employee.role === "ADMIN") continue;

    const tipo = tipoDaUnidade(unit.kind);
    const dow = diaSemanaISO(businessDate);
    const program = input.programs[unitId] ?? null;
    const goal = metaDoDia(program, dow);

    const fat = revByKey.get(key) ?? 0;
    const pedidos = sessOrders.get(key)?.size ?? 0;
    const agg = sessAgg.get(key) ?? { sessoes: 0, sessoes1hMais: 0 };
    const prod = prodByKey.get(key) ?? { itens: 0, prodCents: 0, bonusProdCents: 0 };
    const sd = shiftsDia.get(shiftUnitDateKey(unitId, businessDate));

    const travaAberturaOk = sd?.aberturaMin !== null && sd?.aberturaMin !== undefined && sd.aberturaMin <= ABERTURA_LIMITE_HORA;
    const travaCaixaOk = Boolean(sd?.fechado) && !sd?.divergSemJustificativa;

    // Sem meta configurada para este dia/unidade, o bônus do dia é zero —
    // nunca um valor adivinhado (ver comentário na migration da config).
    let bonusMetaCents = 0;
    if (goal) {
      const atual = tipo === "PLAYGROUND" ? fat : agg.sessoes;
      if (atual >= goal.superValor) bonusMetaCents = goal.superBonusCents;
      else if (atual >= goal.metaValor) bonusMetaCents = goal.metaBonusCents;
      if (tipo === "PLAYGROUND" && program) {
        const fracao1h = agg.sessoes > 0 ? agg.sessoes1hMais / agg.sessoes : 0;
        if (fracao1h * 100 >= program.sessao1hPercentualMin) bonusMetaCents += program.sessao1hBonusCents;
      } else if (tipo === "CIRCUITO" && program) {
        bonusMetaCents += Math.max(agg.sessoes - goal.metaValor, 0) * program.locacaoExtraBonusCents;
      }
    }

    const bonusDiaCents = travaAberturaOk && travaCaixaOk ? bonusMetaCents + prod.bonusProdCents : 0;

    result.push({
      unitId,
      businessDate,
      employeeId,
      faturamentoCents: fat,
      pedidos,
      sessoes: agg.sessoes,
      sessoes1hMais: agg.sessoes1hMais,
      itens: prod.itens,
      produtosCents: prod.prodCents,
      bonusProdutosCents: prod.bonusProdCents,
      travaAberturaOk,
      travaCaixaOk,
      bonusMetaCents,
      bonusDiaCents,
    });
  }
  return result.sort((a, b) => a.businessDate.localeCompare(b.businessDate));
}

/** Agrega os dias em um total acumulado por operador/unidade no mês, com o teto configurado por unidade. */
export function agregarPorOperador(
  dias: ApuracaoDia[],
  units: RawUnit[],
  employees: RawEmployee[],
  programs: BonusProgramsByUnit,
): ApuracaoOperador[] {
  const unitById = new Map(units.map((u) => [u.id, u]));
  const employeeById = new Map(employees.map((e) => [e.id, e]));

  const porOperador = new Map<string, ApuracaoDia[]>();
  for (const dia of dias) {
    const key = `${dia.unitId}|${dia.employeeId}`;
    const list = porOperador.get(key) ?? [];
    list.push(dia);
    porOperador.set(key, list);
  }

  const result: ApuracaoOperador[] = [];
  for (const [key, list] of porOperador) {
    const [unitId, employeeId] = key.split("|");
    if (!unitId || !employeeId) continue;
    const unit = unitById.get(unitId);
    const employee = employeeById.get(employeeId);
    if (!unit || !employee) continue;

    const program = programs[unitId] ?? null;
    const itensMes = list.reduce((sum, d) => sum + d.itens, 0);
    const bonusItensMesCents = program && program.itensMesMeta > 0 && itensMes >= program.itensMesMeta ? program.itensMesBonusCents : 0;
    const somaBonusDia = list.reduce((sum, d) => sum + d.bonusDiaCents, 0);
    const totalAntesDoTeto = somaBonusDia + bonusItensMesCents;
    const tetoMesCents = program?.tetoMesCents ?? 0;
    const acumuladoMesCents = tetoMesCents > 0 ? Math.min(totalAntesDoTeto, tetoMesCents) : totalAntesDoTeto;
    const faturamentoMesCents = list.reduce((sum, d) => sum + d.faturamentoCents, 0);
    const pedidosMes = list.reduce((sum, d) => sum + d.pedidos, 0);

    result.push({
      unitId,
      unitName: unit.name,
      tipo: tipoDaUnidade(unit.kind),
      employeeId,
      employeeName: employee.full_name,
      diasComBonus: list.filter((d) => d.bonusDiaCents > 0).length,
      diasTrabalhados: list.length,
      itensMes,
      pedidosMes,
      ticketMedioMesCents: pedidosMes > 0 ? Math.round(faturamentoMesCents / pedidosMes) : 0,
      bonusProdutosMesCents: list.reduce((sum, d) => sum + d.bonusProdutosCents, 0),
      bonusMetaMesCents: list.reduce((sum, d) => sum + d.bonusMetaCents, 0),
      acumuladoMesCents,
      atingiuTeto: tetoMesCents > 0 && totalAntesDoTeto >= tetoMesCents,
    });
  }
  return result.sort((a, b) => b.acumuladoMesCents - a.acumuladoMesCents);
}
