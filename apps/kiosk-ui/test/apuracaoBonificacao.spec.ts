import { describe, expect, it } from "vitest";
import {
  agregarPorOperador,
  apurarBonificacaoPorDia,
  type BonusProgramConfig,
  type BonusProgramsByUnit,
  type RawEmployee,
  type RawOrder,
  type RawShift,
  type RawUnit,
} from "../src/lib/apuracaoBonificacao.js";

const UNIT_PLAYGROUND: RawUnit = { id: "u1", name: "Playground", kind: "PLAYGROUND" };
const EMP: RawEmployee = { id: "e1", full_name: "Operador 1", role: "OPERADOR" };

// Mesmos valores do piloto (docs/bonificacao/programa-bonificacao-set-2026.md),
// só que passados como configuração em vez de hardcoded — mesma forma que
// o Owner cadastraria em Gerencial > Metas.
const PROGRAM_PLAYGROUND: BonusProgramConfig = {
  goals: [1, 2, 3, 4].map((weekday) => ({ weekday, metaValor: 90_000, superValor: 110_000, metaBonusCents: 800, superBonusCents: 1200 })),
  tetoMesCents: 20_000,
  produtoPrecoCorteCents: 4000,
  produtoBonusBaixoCents: 200,
  produtoBonusAltoCents: 400,
  itensMesMeta: 10,
  itensMesBonusCents: 1000,
  sessao1hPercentualMin: 45,
  sessao1hBonusCents: 200,
  locacaoExtraBonusCents: 0,
};
const PROGRAMS: BonusProgramsByUnit = { [UNIT_PLAYGROUND.id]: PROGRAM_PLAYGROUND };

function fechamentoOk(unitId: string, businessDate: string): RawShift {
  return {
    unit_id: unitId,
    business_date: businessDate,
    status: "FECHADO",
    opened_at_ms: Date.parse(`${businessDate}T09:00:00-03:00`),
    opened_by_employee_id: EMP.id,
    declared_json: { DINHEIRO: 1000 },
    expected_json: { DINHEIRO: 1000 },
    close_justifications_json: {},
  };
}

describe("apurarBonificacaoPorDia", () => {
  it("paga bônus de meta quando o faturamento bate a meta do dia e as travas estão ok", () => {
    // 2026-09-08 é terça-feira (dow=2): meta playground = R$900,00
    const businessDate = "2026-09-08";
    const order: RawOrder = {
      id: "o1",
      unit_id: UNIT_PLAYGROUND.id,
      business_date: businessDate,
      status: "PAGA",
      total_cents: 95_000,
      closed_by_employee_id: EMP.id,
    };
    const dias = apurarBonificacaoPorDia({
      from: businessDate,
      to: businessDate,
      sessions: [
        { unit_id: UNIT_PLAYGROUND.id, business_date: businessDate, checkin_by_employee_id: EMP.id, order_id: order.id, plan_id: null, canceled: false },
      ],
      plans: [],
      orders: [order],
      orderItems: [],
      shifts: [fechamentoOk(UNIT_PLAYGROUND.id, businessDate)],
      employees: [EMP],
      units: [UNIT_PLAYGROUND],
      programs: PROGRAMS,
    });

    expect(dias).toHaveLength(1);
    expect(dias[0]?.faturamentoCents).toBe(95_000);
    expect(dias[0]?.pedidos).toBe(1);
    expect(dias[0]?.travaAberturaOk).toBe(true);
    expect(dias[0]?.travaCaixaOk).toBe(true);
    expect(dias[0]?.bonusDiaCents).toBe(800);
  });

  it("zera o bônus do dia quando o caixa fecha com divergência sem justificativa", () => {
    const businessDate = "2026-09-08";
    const order: RawOrder = {
      id: "o1",
      unit_id: UNIT_PLAYGROUND.id,
      business_date: businessDate,
      status: "PAGA",
      total_cents: 95_000,
      closed_by_employee_id: EMP.id,
    };
    const shiftDivergente: RawShift = {
      ...fechamentoOk(UNIT_PLAYGROUND.id, businessDate),
      declared_json: { DINHEIRO: 1000 },
      expected_json: { DINHEIRO: 3500 }, // diff de R$25, acima do limite de R$20
      close_justifications_json: {},
    };
    const dias = apurarBonificacaoPorDia({
      from: businessDate,
      to: businessDate,
      sessions: [
        { unit_id: UNIT_PLAYGROUND.id, business_date: businessDate, checkin_by_employee_id: EMP.id, order_id: order.id, plan_id: null, canceled: false },
      ],
      plans: [],
      orders: [order],
      orderItems: [],
      shifts: [shiftDivergente],
      employees: [EMP],
      units: [UNIT_PLAYGROUND],
      programs: PROGRAMS,
    });

    expect(dias[0]?.travaCaixaOk).toBe(false);
    expect(dias[0]?.bonusDiaCents).toBe(0);
  });

  it("não gera bônus quando a unidade não tem programa configurado", () => {
    const businessDate = "2026-09-08";
    const order: RawOrder = {
      id: "o1",
      unit_id: UNIT_PLAYGROUND.id,
      business_date: businessDate,
      status: "PAGA",
      total_cents: 95_000,
      closed_by_employee_id: EMP.id,
    };
    const dias = apurarBonificacaoPorDia({
      from: businessDate,
      to: businessDate,
      sessions: [
        { unit_id: UNIT_PLAYGROUND.id, business_date: businessDate, checkin_by_employee_id: EMP.id, order_id: order.id, plan_id: null, canceled: false },
      ],
      plans: [],
      orders: [order],
      orderItems: [],
      shifts: [fechamentoOk(UNIT_PLAYGROUND.id, businessDate)],
      employees: [EMP],
      units: [UNIT_PLAYGROUND],
      programs: {}, // unidade nunca configurada em Gerencial > Metas
    });

    // O dia ainda aparece (ticket médio/faturamento continuam visíveis), só o bônus é zero.
    expect(dias[0]?.faturamentoCents).toBe(95_000);
    expect(dias[0]?.bonusMetaCents).toBe(0);
    expect(dias[0]?.bonusDiaCents).toBe(0);
  });

  it("aceita abertura até 12h15 no domingo e exige 10h15 nos demais dias", () => {
    // 2026-09-06 é domingo (dow=7), abertura às 11h30 está dentro do limite de 12h15
    const domingoDate = "2026-09-06";
    const shiftDomingo: RawShift = {
      ...fechamentoOk(UNIT_PLAYGROUND.id, domingoDate),
      opened_at_ms: Date.parse(`${domingoDate}T11:30:00-03:00`),
    };
    const orderDomingo: RawOrder = {
      id: "oDom",
      unit_id: UNIT_PLAYGROUND.id,
      business_date: domingoDate,
      status: "PAGA",
      total_cents: 95_000,
      closed_by_employee_id: EMP.id,
    };
    const programDomingo: BonusProgramsByUnit = {
      [UNIT_PLAYGROUND.id]: {
        ...PROGRAM_PLAYGROUND,
        goals: [{ weekday: 7, metaValor: 90_000, superValor: 110_000, metaBonusCents: 800, superBonusCents: 1200 }],
      },
    };

    const diasDom = apurarBonificacaoPorDia({
      from: domingoDate,
      to: domingoDate,
      sessions: [{ unit_id: UNIT_PLAYGROUND.id, business_date: domingoDate, checkin_by_employee_id: EMP.id, order_id: orderDomingo.id, plan_id: null, canceled: false }],
      plans: [],
      orders: [orderDomingo],
      orderItems: [],
      shifts: [shiftDomingo],
      employees: [EMP],
      units: [UNIT_PLAYGROUND],
      programs: programDomingo,
    });
    expect(diasDom[0]?.travaAberturaOk).toBe(true);

    // 2026-09-08 é terça-feira (dow=2), abertura às 11h30 estoura o limite de 10h15
    const tercaDate = "2026-09-08";
    const shiftTerca: RawShift = {
      ...fechamentoOk(UNIT_PLAYGROUND.id, tercaDate),
      opened_at_ms: Date.parse(`${tercaDate}T11:30:00-03:00`),
    };
    const orderTerca: RawOrder = {
      id: "oTerca",
      unit_id: UNIT_PLAYGROUND.id,
      business_date: tercaDate,
      status: "PAGA",
      total_cents: 95_000,
      closed_by_employee_id: EMP.id,
    };

    const diasTerca = apurarBonificacaoPorDia({
      from: tercaDate,
      to: tercaDate,
      sessions: [{ unit_id: UNIT_PLAYGROUND.id, business_date: tercaDate, checkin_by_employee_id: EMP.id, order_id: orderTerca.id, plan_id: null, canceled: false }],
      plans: [],
      orders: [orderTerca],
      orderItems: [],
      shifts: [shiftTerca],
      employees: [EMP],
      units: [UNIT_PLAYGROUND],
      programs: PROGRAMS,
    });
    expect(diasTerca[0]?.travaAberturaOk).toBe(false);
  });
});

describe("agregarPorOperador", () => {
  it("aplica o teto configurado somando os dias do operador", () => {
    const dias = [
      { unitId: "u1", businessDate: "2026-09-08", employeeId: "e1", faturamentoCents: 0, pedidos: 0, sessoes: 0, sessoes1hMais: 0, itens: 12, produtosCents: 0, bonusProdutosCents: 0, travaAberturaOk: true, travaCaixaOk: true, bonusMetaCents: 1600, bonusDiaCents: 1600 },
      { unitId: "u1", businessDate: "2026-09-09", employeeId: "e1", faturamentoCents: 0, pedidos: 0, sessoes: 0, sessoes1hMais: 0, itens: 0, produtosCents: 0, bonusProdutosCents: 0, travaAberturaOk: true, travaCaixaOk: true, bonusMetaCents: 1600, bonusDiaCents: 1600 },
    ];
    const [op] = agregarPorOperador(dias, [UNIT_PLAYGROUND], [EMP], PROGRAMS);
    // 1600 + 1600 + 1000 (bônus de 10+ produtos no mês) = 4200, bem abaixo do teto de R$200
    expect(op?.acumuladoMesCents).toBe(4200);
    expect(op?.itensMes).toBe(12);
    expect(op?.atingiuTeto).toBe(false);
  });

  it("sem programa configurado, não aplica bônus de itens do mês nem teto", () => {
    const dias = [
      { unitId: "u1", businessDate: "2026-09-08", employeeId: "e1", faturamentoCents: 0, pedidos: 0, sessoes: 0, sessoes1hMais: 0, itens: 12, produtosCents: 0, bonusProdutosCents: 0, travaAberturaOk: true, travaCaixaOk: true, bonusMetaCents: 1600, bonusDiaCents: 1600 },
    ];
    const [op] = agregarPorOperador(dias, [UNIT_PLAYGROUND], [EMP], {});
    expect(op?.acumuladoMesCents).toBe(1600); // sem o +R$10 de itens, sem teto aplicado
    expect(op?.atingiuTeto).toBe(false);
  });

  it("calcula o ticket médio do mês (faturamento ÷ pedidos)", () => {
    const dias = [
      { unitId: "u1", businessDate: "2026-09-08", employeeId: "e1", faturamentoCents: 30_000, pedidos: 3, sessoes: 0, sessoes1hMais: 0, itens: 0, produtosCents: 0, bonusProdutosCents: 0, travaAberturaOk: true, travaCaixaOk: true, bonusMetaCents: 0, bonusDiaCents: 0 },
      { unitId: "u1", businessDate: "2026-09-09", employeeId: "e1", faturamentoCents: 20_000, pedidos: 1, sessoes: 0, sessoes1hMais: 0, itens: 0, produtosCents: 0, bonusProdutosCents: 0, travaAberturaOk: true, travaCaixaOk: true, bonusMetaCents: 0, bonusDiaCents: 0 },
    ];
    const [op] = agregarPorOperador(dias, [UNIT_PLAYGROUND], [EMP], PROGRAMS);
    expect(op?.pedidosMes).toBe(4);
    // (30_000 + 20_000) / 4 pedidos = 12_500
    expect(op?.ticketMedioMesCents).toBe(12_500);
  });

  it("ticket médio do mês é zero quando não houve nenhum pedido", () => {
    const dias = [
      { unitId: "u1", businessDate: "2026-09-08", employeeId: "e1", faturamentoCents: 0, pedidos: 0, sessoes: 0, sessoes1hMais: 0, itens: 0, produtosCents: 0, bonusProdutosCents: 0, travaAberturaOk: true, travaCaixaOk: true, bonusMetaCents: 0, bonusDiaCents: 0 },
    ];
    const [op] = agregarPorOperador(dias, [UNIT_PLAYGROUND], [EMP], PROGRAMS);
    expect(op?.ticketMedioMesCents).toBe(0);
  });
});
