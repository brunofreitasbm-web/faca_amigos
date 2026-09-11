// Apuração de bonificação por operador/mês — porta para o cliente da mesma
// lógica de docs/bonificacao/apuracao_bonificacao.sql (fonte oficial do
// programa, docs/bonificacao/programa-bonificacao-set-2026.md), generalizada
// para qualquer unidade/período em vez dos IDs e datas fixas do script manual.
// Mantenha os dois em sincronia se as regras do piloto mudarem.

export type UnidadeTipo = "PLAYGROUND" | "CIRCUITO";

interface RegraDia {
  metaFat: number | null;
  superFat: number | null;
  metaLoc: number | null;
  superLoc: number | null;
  bonusMetaCents: number;
  bonusSuperCents: number;
}

// index 0 não é usado (isodow vai de 1 a 7)
const PLAYGROUND_REGRAS: readonly (RegraDia | null)[] = [
  null,
  { metaFat: 90_000, superFat: 110_000, metaLoc: null, superLoc: null, bonusMetaCents: 800, bonusSuperCents: 1200 },
  { metaFat: 90_000, superFat: 110_000, metaLoc: null, superLoc: null, bonusMetaCents: 800, bonusSuperCents: 1200 },
  { metaFat: 90_000, superFat: 110_000, metaLoc: null, superLoc: null, bonusMetaCents: 800, bonusSuperCents: 1200 },
  { metaFat: 90_000, superFat: 110_000, metaLoc: null, superLoc: null, bonusMetaCents: 800, bonusSuperCents: 1200 },
  { metaFat: 150_000, superFat: 180_000, metaLoc: null, superLoc: null, bonusMetaCents: 1200, bonusSuperCents: 1600 },
  { metaFat: 240_000, superFat: 280_000, metaLoc: null, superLoc: null, bonusMetaCents: 1200, bonusSuperCents: 1600 },
  { metaFat: 220_000, superFat: 260_000, metaLoc: null, superLoc: null, bonusMetaCents: 1200, bonusSuperCents: 1600 },
];

const CIRCUITO_REGRAS: readonly (RegraDia | null)[] = [
  null,
  { metaFat: null, superFat: null, metaLoc: 8, superLoc: 10, bonusMetaCents: 600, bonusSuperCents: 1000 },
  { metaFat: null, superFat: null, metaLoc: 8, superLoc: 10, bonusMetaCents: 600, bonusSuperCents: 1000 },
  { metaFat: null, superFat: null, metaLoc: 8, superLoc: 10, bonusMetaCents: 600, bonusSuperCents: 1000 },
  { metaFat: null, superFat: null, metaLoc: 8, superLoc: 10, bonusMetaCents: 600, bonusSuperCents: 1000 },
  { metaFat: null, superFat: null, metaLoc: 10, superLoc: 12, bonusMetaCents: 1000, bonusSuperCents: 1600 },
  { metaFat: null, superFat: null, metaLoc: 22, superLoc: 27, bonusMetaCents: 1000, bonusSuperCents: 1600 },
  { metaFat: null, superFat: null, metaLoc: 30, superLoc: 35, bonusMetaCents: 1000, bonusSuperCents: 1600 },
];

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

const ITENS_MES_BONUS_CENTS = 1000; // +R$10 ao bater 10 produtos vendidos no mês
const ITENS_MES_META = 10;
const TETO_MES_CENTS = 20_000; // R$200/mês por operador
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
  acumuladoMesCents: number; // já com o teto de R$200 aplicado
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
    for (const item of items) {
      cur.itens += item.quantity;
      cur.prodCents += item.total_cents;
      cur.bonusProdCents += (item.unit_price_cents < 4000 ? 200 : 400) * item.quantity;
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
    const regra = (tipo === "PLAYGROUND" ? PLAYGROUND_REGRAS : CIRCUITO_REGRAS)[dow];
    if (!regra) continue;

    const fat = revByKey.get(key) ?? 0;
    const pedidos = sessOrders.get(key)?.size ?? 0;
    const agg = sessAgg.get(key) ?? { sessoes: 0, sessoes1hMais: 0 };
    const prod = prodByKey.get(key) ?? { itens: 0, prodCents: 0, bonusProdCents: 0 };
    const sd = shiftsDia.get(shiftUnitDateKey(unitId, businessDate));

    const travaAberturaOk = sd?.aberturaMin !== null && sd?.aberturaMin !== undefined && sd.aberturaMin <= ABERTURA_LIMITE_HORA;
    const travaCaixaOk = Boolean(sd?.fechado) && !sd?.divergSemJustificativa;

    let bonusMetaCents = 0;
    if (tipo === "PLAYGROUND") {
      if (fat >= (regra.superFat ?? Infinity)) bonusMetaCents = regra.bonusSuperCents;
      else if (fat >= (regra.metaFat ?? Infinity)) bonusMetaCents = regra.bonusMetaCents;
      if (agg.sessoes > 0 && agg.sessoes1hMais / agg.sessoes >= 0.45) bonusMetaCents += 200;
    } else {
      if (agg.sessoes >= (regra.superLoc ?? Infinity)) bonusMetaCents = regra.bonusSuperCents;
      else if (agg.sessoes >= (regra.metaLoc ?? Infinity)) bonusMetaCents = regra.bonusMetaCents;
      bonusMetaCents += Math.max(agg.sessoes - (regra.metaLoc ?? 0), 0) * 100;
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

/** Agrega os dias em um total acumulado por operador/unidade no mês, com teto de R$200. */
export function agregarPorOperador(dias: ApuracaoDia[], units: RawUnit[], employees: RawEmployee[]): ApuracaoOperador[] {
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

    const itensMes = list.reduce((sum, d) => sum + d.itens, 0);
    const bonusItensMesCents = itensMes >= ITENS_MES_META ? ITENS_MES_BONUS_CENTS : 0;
    const somaBonusDia = list.reduce((sum, d) => sum + d.bonusDiaCents, 0);
    const acumuladoMesCents = Math.min(somaBonusDia + bonusItensMesCents, TETO_MES_CENTS);
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
      atingiuTeto: somaBonusDia + bonusItensMesCents >= TETO_MES_CENTS,
    });
  }
  return result.sort((a, b) => b.acumuladoMesCents - a.acumuladoMesCents);
}
