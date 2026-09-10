import { describe, expect, it } from "vitest";
import { agregarPorOperador, apurarBonificacaoPorDia, type RawEmployee, type RawOrder, type RawShift, type RawUnit } from "../src/lib/apuracaoBonificacao.js";

const UNIT_PLAYGROUND: RawUnit = { id: "u1", name: "Playground", kind: "PLAYGROUND" };
const EMP: RawEmployee = { id: "e1", full_name: "Operador 1", role: "OPERADOR" };

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
    });

    expect(dias).toHaveLength(1);
    expect(dias[0]?.faturamentoCents).toBe(95_000);
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
    });

    expect(dias[0]?.travaCaixaOk).toBe(false);
    expect(dias[0]?.bonusDiaCents).toBe(0);
  });
});

describe("agregarPorOperador", () => {
  it("aplica o teto de R$200/mês somando os dias do operador", () => {
    const dias = [
      { unitId: "u1", businessDate: "2026-09-08", employeeId: "e1", faturamentoCents: 0, sessoes: 0, sessoes1hMais: 0, itens: 12, produtosCents: 0, bonusProdutosCents: 0, travaAberturaOk: true, travaCaixaOk: true, bonusMetaCents: 1600, bonusDiaCents: 1600 },
      { unitId: "u1", businessDate: "2026-09-09", employeeId: "e1", faturamentoCents: 0, sessoes: 0, sessoes1hMais: 0, itens: 0, produtosCents: 0, bonusProdutosCents: 0, travaAberturaOk: true, travaCaixaOk: true, bonusMetaCents: 1600, bonusDiaCents: 1600 },
    ];
    const [op] = agregarPorOperador(dias, [UNIT_PLAYGROUND], [EMP]);
    // 1600 + 1600 + 1000 (bônus de 10+ produtos no mês) = 4200, bem abaixo do teto
    expect(op?.acumuladoMesCents).toBe(4200);
    expect(op?.itensMes).toBe(12);
    expect(op?.atingiuTeto).toBe(false);
  });
});
