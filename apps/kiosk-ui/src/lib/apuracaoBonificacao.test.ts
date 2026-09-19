import { describe, expect, it } from "vitest";
import { apurarBonificacaoPorDia, type ApuracaoInput, type BonusProgramConfig } from "./apuracaoBonificacao";

// Aluguel avulso de pelúcia no Playground: fora da meta de faturamento e de
// sessões, conta 1 produto com o bônus baixo. Mesma regra de
// docs/bonificacao/apuracao_bonificacao.sql.

const PLAYGROUND = "pg";
const OPERADORA = "op";
const DIA = "2026-09-22"; // terça

const program: BonusProgramConfig = {
  goals: [{ weekday: 2, metaValor: 90000, superValor: 110000, metaBonusCents: 800, superBonusCents: 1200 }],
  tetoMesCents: 20000,
  produtoPrecoCorteCents: 4000,
  produtoBonusBaixoCents: 200,
  produtoBonusAltoCents: 400,
  itensMesMeta: 10,
  itensMesBonusCents: 1000,
  sessao1hPercentualMin: 45,
  sessao1hBonusCents: 200,
  locacaoExtraBonusCents: 0,
};

function input(partial: Pick<ApuracaoInput, "sessions" | "orders" | "orderItems">): ApuracaoInput {
  return {
    from: DIA,
    to: DIA,
    plans: [
      { id: "plano-1h", duration_unit: "HORA", duration_value: 1 },
      { id: "pelucia", duration_unit: "MINUTO", duration_value: 20 },
    ],
    shifts: [],
    employees: [{ id: OPERADORA, full_name: "Operadora", role: "OPERADOR" }],
    units: [{ id: PLAYGROUND, name: "Faça Amigos Playground", kind: "LOJA" }],
    programs: { [PLAYGROUND]: program },
    ...partial,
  };
}

const sessao = (id: string, orderId: string, planId: string, rental: string | null) => ({
  id,
  unit_id: PLAYGROUND,
  business_date: DIA,
  checkin_by_employee_id: OPERADORA,
  order_id: orderId,
  plan_id: planId,
  rental_kind: rental,
  canceled: false,
});
const pedido = (id: string, total: number) => ({
  id,
  unit_id: PLAYGROUND,
  business_date: DIA,
  status: "PAGA",
  total_cents: total,
  closed_by_employee_id: OPERADORA,
});
const item = (orderId: string, sessionId: string, cents: number) => ({
  order_id: orderId,
  session_id: sessionId,
  item_type: "SESSAO",
  quantity: 1,
  total_cents: cents,
  unit_price_cents: cents,
});

describe("aluguel de pelúcia na apuração", () => {
  it("sozinho: 1 produto de R$ 2, sem faturamento nem sessão", () => {
    const [dia] = apurarBonificacaoPorDia(
      input({
        sessions: [sessao("s1", "o1", "pelucia", "PELUCIA")],
        orders: [pedido("o1", 4800)],
        orderItems: [item("o1", "s1", 4800)],
      }),
    );
    expect(dia).toMatchObject({ faturamentoCents: 0, sessoes: 0, sessoes1hMais: 0, itens: 1, produtosCents: 4800, bonusProdutosCents: 200 });
  });

  it("no mesmo pedido de um irmão: faturamento só com a brincadeira", () => {
    const [dia] = apurarBonificacaoPorDia(
      input({
        sessions: [sessao("s1", "o1", "plano-1h", null), sessao("s2", "o1", "pelucia", "PELUCIA")],
        orders: [pedido("o1", 7000 + 4800)],
        orderItems: [item("o1", "s1", 7000), item("o1", "s2", 4800)],
      }),
    );
    expect(dia).toMatchObject({ faturamentoCents: 7000, sessoes: 1, sessoes1hMais: 1, itens: 1, bonusProdutosCents: 200 });
  });

  it("com excedente: continua 1 item só", () => {
    const [dia] = apurarBonificacaoPorDia(
      input({
        sessions: [sessao("s1", "o1", "pelucia", "PELUCIA")],
        orders: [pedido("o1", 6000)],
        orderItems: [item("o1", "s1", 4800), item("o1", "s1", 1200)],
      }),
    );
    expect(dia).toMatchObject({ faturamentoCents: 0, itens: 1, produtosCents: 6000, bonusProdutosCents: 200 });
  });
});
