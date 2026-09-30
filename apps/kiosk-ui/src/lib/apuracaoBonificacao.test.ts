import { describe, expect, it } from "vitest";
import {
  agregarPorOperador,
  apurarBonificacaoPorDia,
  planRuleKey,
  type ApuracaoInput,
  type BonusPlanRule,
  type BonusProgramConfig,
  type RawGuardianPackage,
} from "./apuracaoBonificacao";

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
  planosTetoMesCents: 0,
  planRules: [],
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

// Bônus de Planos Longos: 2 horas / Day Use / Porto Seguro. Bônus fixo por
// unidade vendida, escada mensal e teto próprio — sem as travas de caixa.
describe("bônus de planos longos", () => {
  const PLANO_2H = "plano-2h";
  const PKG_DAY_USE = "pkg-day-use";
  const PKG_PORTO = "pkg-porto";
  const OUTRA = "op2";
  const K2H = planRuleKey("PLANO", PLANO_2H);
  const KDU = planRuleKey("PACOTE", PKG_DAY_USE);
  const KPS = planRuleKey("PACOTE", PKG_PORTO);

  const rules: BonusPlanRule[] = [
    { kind: "PLANO", refId: PLANO_2H, label: "2 horas", bonusCents: 300, escadaMeta: 12, escadaBonusCents: 1500, active: true, sortOrder: 1 },
    { kind: "PACOTE", refId: PKG_DAY_USE, label: "DAY USE", bonusCents: 1000, escadaMeta: 2, escadaBonusCents: 1000, active: true, sortOrder: 2 },
    { kind: "PACOTE", refId: PKG_PORTO, label: "PORTO SEGURO", bonusCents: 2500, escadaMeta: 1, escadaBonusCents: 1500, active: true, sortOrder: 3 },
  ];
  const programPlanos: BonusProgramConfig = { ...program, planosTetoMesCents: 10000, planRules: rules };

  const pacote = (over: Partial<RawGuardianPackage> = {}): RawGuardianPackage => ({
    id: "gp1",
    unit_id: PLAYGROUND,
    business_date: DIA,
    package_id: PKG_PORTO,
    sold_by_employee_id: OPERADORA,
    order_id: null,
    ...over,
  });

  function apurar(partial: Partial<ApuracaoInput>) {
    return apurarBonificacaoPorDia({
      ...input({ sessions: [], orders: [], orderItems: [] }),
      plans: [{ id: PLANO_2H, duration_unit: "MINUTO", duration_value: 120 }],
      programs: { [PLAYGROUND]: programPlanos },
      ...partial,
    });
  }

  it("2 horas paga o bônus unitário mesmo com as travas de caixa falhando", () => {
    const [dia] = apurar({
      sessions: [sessao("s1", "o1", PLANO_2H, null)],
      orders: [pedido("o1", 19200)],
      orderItems: [item("o1", "s1", 19200)],
    });
    expect(dia?.planosVendidos).toEqual({ [K2H]: 1 });
    expect(dia?.bonusPlanosCents).toBe(300);
    expect(dia?.travaAberturaOk).toBe(false); // sem turno no fixture
    expect(dia?.bonusDiaCents).toBe(0); // bônus de meta zerado pelas travas...
  });

  it("não conta sessão paga por saldo de pacote, plano fora das regras, pedido não pago nem sessão sem pedido", () => {
    const dias = apurar({
      sessions: [
        { ...sessao("s1", "o1", PLANO_2H, null), uses_package: true },
        sessao("s2", "o2", "plano-outro", null),
        sessao("s3", "o3", PLANO_2H, null),
        sessao("s4", "", PLANO_2H, null),
      ].map((s) => (s.order_id === "" ? { ...s, order_id: null } : s)),
      orders: [pedido("o1", 100), pedido("o2", 100), { ...pedido("o3", 100), status: "CANCELADA" }],
    });
    expect(dias.every((d) => d.bonusPlanosCents === 0)).toBe(true);
  });

  it("regra inativa não paga", () => {
    const [dia] = apurar({
      programs: { [PLAYGROUND]: { ...programPlanos, planRules: rules.map((r) => ({ ...r, active: false })) } },
      sessions: [sessao("s1", "o1", PLANO_2H, null)],
      orders: [pedido("o1", 19200)],
    });
    expect(dia?.bonusPlanosCents ?? 0).toBe(0);
  });

  it("irmãos no mesmo pedido: uma unidade por criança", () => {
    const [dia] = apurar({
      sessions: [sessao("s1", "o1", PLANO_2H, null), sessao("s2", "o1", PLANO_2H, null)],
      orders: [pedido("o1", 38400)],
    });
    expect(dia?.planosVendidos[K2H]).toBe(2);
    expect(dia?.bonusPlanosCents).toBe(600);
  });

  it("pacote: conta para quem vendeu, na data da venda", () => {
    const [dia] = apurar({ guardianPackages: [pacote()] });
    expect(dia).toMatchObject({ employeeId: OPERADORA, businessDate: DIA, bonusPlanosCents: 2500 });
    expect(dia?.planosVendidos).toEqual({ [KPS]: 1 });
  });

  it("pacote sem vendedor cai para quem fechou o pedido; sem os dois, não conta", () => {
    const [viaPedido] = apurar({
      orders: [{ ...pedido("o9", 84000), closed_by_employee_id: OPERADORA }],
      guardianPackages: [pacote({ sold_by_employee_id: null, order_id: "o9" })],
    });
    expect(viaPedido?.bonusPlanosCents).toBe(2500);
    expect(apurar({ guardianPackages: [pacote({ sold_by_employee_id: null })] })).toEqual([]);
  });

  it("pacote fora do período ou com pedido estornado não conta", () => {
    expect(apurar({ guardianPackages: [pacote({ business_date: "2026-09-21" })] })).toEqual([]);
    expect(
      apurar({
        orders: [{ ...pedido("o9", 84000), status: "CANCELADA" }],
        guardianPackages: [pacote({ order_id: "o9" })],
      }),
    ).toEqual([]);
    expect(apurar({ guardianPackages: [pacote({ order_id: "inexistente" })] })).toEqual([]);
  });

  it("dia só com venda de pacote aparece na apuração", () => {
    const dias = apurar({ guardianPackages: [pacote({ package_id: PKG_DAY_USE })] });
    expect(dias).toHaveLength(1);
    expect(dias[0]?.planosVendidos).toEqual({ [KDU]: 1 });
  });

  describe("agregarPorOperador", () => {
    const units = [{ id: PLAYGROUND, name: "Playground", kind: "LOJA" }];
    const employees = [
      { id: OPERADORA, full_name: "Operadora", role: "OPERADOR" },
      { id: OUTRA, full_name: "Outra", role: "OPERADOR" },
    ];
    const dia = (n: number, planos: Record<string, number>, bonusPlanosCents: number, employeeId = OPERADORA) => ({
      unitId: PLAYGROUND,
      businessDate: `2026-09-${String(n).padStart(2, "0")}`,
      employeeId,
      faturamentoCents: 0,
      pedidos: 0,
      sessoes: 0,
      sessoes1hMais: 0,
      itens: 0,
      produtosCents: 0,
      bonusProdutosCents: 0,
      travaAberturaOk: false,
      travaCaixaOk: false,
      bonusMetaCents: 0,
      bonusDiaCents: 0,
      planosVendidos: planos,
      bonusPlanosCents,
    });
    const agregar = (dias: ReturnType<typeof dia>[], program = programPlanos) =>
      agregarPorOperador(dias, units, employees, { [PLAYGROUND]: program });

    it("12 planos de 2 horas batem a escada; 11 não", () => {
      const doze = Array.from({ length: 12 }, (_, i) => dia(i + 1, { [K2H]: 1 }, 300));
      const [r12] = agregar(doze);
      expect(r12?.planosMes[0]).toMatchObject({ label: "2 horas", qtd: 12, bonusCents: 3600, escadaBatida: true });
      expect(r12?.bonusPlanosMesCents).toBe(3600 + 1500);
      expect(r12?.acumuladoPlanosMesCents).toBe(5100);
      expect(r12?.atingiuTetoPlanos).toBe(false);

      const [r11] = agregar(doze.slice(0, 11));
      expect(r11?.planosMes[0]).toMatchObject({ qtd: 11, escadaBatida: false });
      expect(r11?.acumuladoPlanosMesCents).toBe(3300);
    });

    it("aplica o teto próprio sem mexer no teto de metas e produtos", () => {
      const [r] = agregar([dia(1, { [KPS]: 3, [KDU]: 2 }, 7500 + 2000)]);
      // PS: 3×2500 + escada 1500 = 9000; DU: 2×1000 + escada 1000 = 3000 → 12000, teto 10000
      expect(r?.bonusPlanosMesCents).toBe(12000);
      expect(r?.acumuladoPlanosMesCents).toBe(10000);
      expect(r?.atingiuTetoPlanos).toBe(true);
      expect(r?.acumuladoMesCents).toBe(0);
      expect(r?.totalMesCents).toBe(10000);
    });

    it("teto 0 significa sem teto", () => {
      const [r] = agregar([dia(1, { [KPS]: 5 }, 12500)], { ...programPlanos, planosTetoMesCents: 0 });
      expect(r?.acumuladoPlanosMesCents).toBe(12500 + 1500);
      expect(r?.atingiuTetoPlanos).toBe(false);
    });

    it("unidade sem regras: planosMes vazio e total igual ao acumulado antigo", () => {
      const [r] = agregar([dia(1, {}, 0)], { ...program });
      expect(r?.planosMes).toEqual([]);
      expect(r?.acumuladoPlanosMesCents).toBe(0);
      expect(r?.totalMesCents).toBe(r?.acumuladoMesCents);
    });

    it("operadores diferentes não misturam o placar", () => {
      const rs = agregar([dia(1, { [K2H]: 1 }, 300), dia(1, { [KPS]: 1 }, 2500, OUTRA)]);
      const a = rs.find((r) => r.employeeId === OPERADORA);
      const b = rs.find((r) => r.employeeId === OUTRA);
      expect(a?.planosMes.find((p) => p.key === K2H)?.qtd).toBe(1);
      expect(a?.planosMes.find((p) => p.key === KPS)?.qtd).toBe(0);
      expect(b?.planosMes.find((p) => p.key === KPS)?.qtd).toBe(1);
      expect(b?.acumuladoPlanosMesCents).toBe(2500 + 1500);
    });
  });
});
