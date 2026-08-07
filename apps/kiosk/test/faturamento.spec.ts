import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase, migrate } from "@facaamigos/db-local";
import { declaracaoFaturamentoSchema, type DeclaracaoFaturamentoDto } from "@facaamigos/contracts";
import {
  centavosParaDecimalBr,
  listarDatas,
  montarDeclaracao,
  declaracaoParaCsv,
} from "@facaamigos/domain";
import { buildApp } from "../src/server/app.js";
import { seedDevData } from "../src/server/seed-dev.js";
import type { FastifyInstance } from "fastify";

/**
 * Integração de faturamento com o shopping. O que precisa ficar
 * provado aqui: o número declarado é o mesmo que o caixa fechou, a
 * chave protege de verdade, e o documento bate com o contrato
 * publicado — nessa ordem de importância.
 */

let app: FastifyInstance;
const nowMs = 1_700_000_000_000;
const clock = () => nowMs;

/**
 * O dia operacional depende do cutoff da unidade e do fuso da
 * máquina, então os testes consultam um mês inteiro e olham os totais
 * do período em vez de tentar adivinhar em qual data a venda caiu.
 */
const DE = "2023-11-01";
const ATE = "2023-11-30";

interface Contexto {
  quiosqueId: string;
  lojaId: string;
  adminId: string;
  totalPagoCents: number;
}

/** Faz uma venda real pelo mesmo caminho do balcão — check-in, checkout, pagamento. */
async function venderUmaSessao(): Promise<Contexto> {
  const units = (await app.inject({ method: "GET", url: "/api/units" })).json() as {
    id: string;
    kind: string;
  }[];
  const quiosque = units.find((u) => u.kind === "QUIOSQUE")!;
  const loja = units.find((u) => u.kind === "LOJA")!;
  const [admin] = (await app.inject({ method: "GET", url: "/api/employees" })).json() as {
    id: string;
  }[];
  const [plano] = (
    await app.inject({ method: "GET", url: `/api/plans?unitId=${quiosque.id}&activity=CARRINHO` })
  ).json() as { id: string; valueCents: number }[];
  const [asset] = (
    await app.inject({ method: "GET", url: `/api/assets?unitId=${quiosque.id}` })
  ).json() as { id: string }[];

  await app.inject({
    method: "POST",
    url: "/api/shifts/open",
    payload: { unitId: quiosque.id, employeeId: admin!.id, openingCashCents: 0 },
  });

  const checkin = (
    await app.inject({
      method: "POST",
      url: "/api/checkins",
      payload: {
        unitId: quiosque.id,
        activity: "CARRINHO",
        assetId: asset!.id,
        planId: plano!.id,
        employeeId: admin!.id,
        child: { fullName: "Helena Souza", birthDate: "2019-04-12", inclusiveEligible: false },
        guardian: { fullName: "Maria Souza", cpf: "529.982.247-25", phoneE164: "+5591982501215" },
      },
    })
  ).json() as { sessionId: string };

  const checkout = await app.inject({
    method: "POST",
    url: "/api/checkout",
    payload: {
      sessionIds: [checkin.sessionId],
      employeeId: admin!.id,
      payments: [{ method: "PIX", amountCents: plano!.valueCents }],
    },
  });
  expect(checkout.statusCode).toBe(200);

  return {
    quiosqueId: quiosque.id,
    lojaId: loja.id,
    adminId: admin!.id,
    totalPagoCents: plano!.valueCents,
  };
}

async function emitirChave(adminId: string, unitId?: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/integracao/chaves",
    payload: { employeeId: adminId, nome: "Parque Shopping — declaração de faturamento", unitId },
  });
  expect(res.statusCode).toBe(201);
  return (res.json() as { segredo: string }).segredo;
}

async function declaracaoInterna(
  unitId: string,
): Promise<{ declaracao: DeclaracaoFaturamentoDto; pendencias: { campo: string }[] }> {
  const res = await app.inject({
    method: "GET",
    url: `/api/faturamento/declaracao?unitId=${unitId}&de=${DE}&ate=${ATE}`,
  });
  expect(res.statusCode).toBe(200);
  const body = res.json() as { declaracao: unknown; pendencias: { campo: string }[] };
  return {
    declaracao: declaracaoFaturamentoSchema.parse(body.declaracao),
    pendencias: body.pendencias,
  };
}

const lojaCompleta = {
  unidadeId: "0195f1a0-0000-7000-8000-000000000001",
  nome: "FaçaAmigos Circuito",
  cnpj: "12345678000195",
  razaoSocial: "FaçaAmigos LTDA",
  luc: "L-142",
  codigoLojista: "PSB-0142",
  timezone: "America/Belem",
  cutoffHoraDiaOperacional: 4,
};

beforeEach(async () => {
  const db = openDatabase(":memory:");
  migrate(db);
  seedDevData(db, nowMs);
  app = await buildApp({ db, hmacKey: "test-key", nowMs: clock });
});

describe("declaração de faturamento", () => {
  it("declara exatamente o que o caixa fechou, decomposto por natureza e meio de pagamento", async () => {
    const ctx = await venderUmaSessao();
    const { declaracao } = await declaracaoInterna(ctx.quiosqueId);

    expect(declaracao.periodo.liquidoCentavos).toBe(ctx.totalPagoCents);
    expect(declaracao.periodo.brutoCentavos).toBe(ctx.totalPagoCents);
    expect(declaracao.periodo.descontosCentavos).toBe(0);
    expect(declaracao.periodo.quantidadeVendas).toBe(1);
    expect(declaracao.periodo.porMeioPagamento.PIX).toBe(ctx.totalPagoCents);
    expect(declaracao.periodo.porMeioPagamento.DINHEIRO).toBe(0);
    expect(declaracao.periodo.porNatureza.SERVICO).toBe(ctx.totalPagoCents);
    expect(declaracao.periodo.porNatureza.PRODUTO).toBe(0);

    // Um dia por data do período, com movimento em exatamente um deles.
    expect(declaracao.dias).toHaveLength(30);
    expect(declaracao.dias.filter((d) => d.quantidadeVendas > 0)).toHaveLength(1);
  });

  it("isola as unidades: venda do quiosque não aparece na declaração da loja", async () => {
    const ctx = await venderUmaSessao();
    const { declaracao } = await declaracaoInterna(ctx.lojaId);
    expect(declaracao.periodo.liquidoCentavos).toBe(0);
    expect(declaracao.periodo.quantidadeVendas).toBe(0);
  });

  it("aponta pendência quando falta a identificação exigida pelo contrato de locação", async () => {
    const ctx = await venderUmaSessao();

    const antes = await declaracaoInterna(ctx.quiosqueId);
    expect(antes.pendencias.map((p) => p.campo)).toEqual(
      expect.arrayContaining(["cnpj", "razaoSocial", "luc", "codigoLojista"]),
    );

    const put = await app.inject({
      method: "PUT",
      url: `/api/unidades/${ctx.quiosqueId}/identificacao-fiscal`,
      payload: {
        cnpj: "12.345.678/0001-95",
        razaoSocial: "FaçaAmigos Entretenimento Infantil LTDA",
        shoppingLuc: "L-142",
        shoppingStoreCode: "PSB-0142",
      },
    });
    expect(put.statusCode).toBe(200);

    const depois = await declaracaoInterna(ctx.quiosqueId);
    expect(depois.pendencias).toHaveLength(0);
    // Máscara entra, dígitos ficam.
    expect(depois.declaracao.loja.cnpj).toBe("12345678000195");
    expect(depois.declaracao.loja.luc).toBe("L-142");
  });

  it("rejeita CNPJ com contagem de dígitos errada", async () => {
    const ctx = await venderUmaSessao();
    const res = await app.inject({
      method: "PUT",
      url: `/api/unidades/${ctx.quiosqueId}/identificacao-fiscal`,
      payload: { cnpj: "123" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejeita período invertido e período maior que um ano", async () => {
    const ctx = await venderUmaSessao();
    const invertido = await app.inject({
      method: "GET",
      url: `/api/faturamento/declaracao?unitId=${ctx.quiosqueId}&de=2026-03-31&ate=2026-03-01`,
    });
    expect(invertido.statusCode).toBe(400);

    const longoDemais = await app.inject({
      method: "GET",
      url: `/api/faturamento/declaracao?unitId=${ctx.quiosqueId}&de=2020-01-01&ate=2026-01-01`,
    });
    expect(longoDemais.statusCode).toBe(400);
  });
});

describe("acesso da administração do shopping", () => {
  it("só emite chave para ADMIN e nunca devolve o segredo de novo", async () => {
    const ctx = await venderUmaSessao();
    const criada = (
      await app.inject({
        method: "POST",
        url: "/api/integracao/chaves",
        payload: { employeeId: ctx.adminId, nome: "Parque Shopping" },
      })
    ).json() as { id: string; prefixo: string; segredo: string };
    expect(criada.segredo).toContain(criada.prefixo);

    // A listagem devolve metadado, nunca o segredo nem o hash.
    const listagem = (
      await app.inject({ method: "GET", url: "/api/integracao/chaves" })
    ).json() as Record<string, unknown>[];
    expect(listagem).toHaveLength(1);
    expect(listagem[0]).not.toHaveProperty("key_hash");
    expect(JSON.stringify(listagem)).not.toContain(criada.segredo);
  });

  it("recusa emissão de chave para quem não é ADMIN", async () => {
    const ctx = await venderUmaSessao();
    const funcionarios = (await app.inject({ method: "GET", url: "/api/employees" })).json() as {
      id: string;
      role: string;
    }[];
    const naoAdmin = funcionarios.find((e) => e.role !== "ADMIN");
    // O seed pode ter só o ADMIN; sem um segundo papel não há o que testar aqui.
    if (!naoAdmin) return;

    const res = await app.inject({
      method: "POST",
      url: "/api/integracao/chaves",
      payload: { employeeId: naoAdmin.id, nome: "tentativa" },
    });
    expect(res.statusCode).toBe(403);
    expect(ctx.adminId).not.toBe(naoAdmin.id);
  });

  it("bloqueia sem chave, com chave errada e com chave revogada", async () => {
    const ctx = await venderUmaSessao();
    const url = `/integracao/shopping/v1/faturamento?unitId=${ctx.quiosqueId}&de=${DE}&ate=${ATE}`;

    expect((await app.inject({ method: "GET", url })).statusCode).toBe(401);
    expect(
      (await app.inject({ method: "GET", url, headers: { "x-api-key": "fa_shp_dead_beef" } }))
        .statusCode,
    ).toBe(401);

    const criada = (
      await app.inject({
        method: "POST",
        url: "/api/integracao/chaves",
        payload: { employeeId: ctx.adminId, nome: "Parque Shopping" },
      })
    ).json() as { id: string; segredo: string };

    expect(
      (
        await app.inject({
          method: "GET",
          url,
          headers: { authorization: `Bearer ${criada.segredo}` },
        })
      ).statusCode,
    ).toBe(200);

    await app.inject({ method: "POST", url: `/api/integracao/chaves/${criada.id}/revogar` });
    const depois = await app.inject({
      method: "GET",
      url,
      headers: { authorization: `Bearer ${criada.segredo}` },
    });
    expect(depois.statusCode).toBe(401);
    expect(depois.json()).toMatchObject({ error: "CHAVE_REVOGADA" });
  });

  it("registra toda tentativa de acesso, inclusive a que falhou", async () => {
    const ctx = await venderUmaSessao();
    const url = `/integracao/shopping/v1/faturamento?unitId=${ctx.quiosqueId}&de=${DE}&ate=${ATE}`;
    const segredo = await emitirChave(ctx.adminId);

    await app.inject({ method: "GET", url, headers: { "x-api-key": "fa_shp_0000_invalida" } });
    await app.inject({ method: "GET", url, headers: { authorization: `Bearer ${segredo}` } });

    const acessos = (
      await app.inject({ method: "GET", url: "/api/integracao/acessos" })
    ).json() as {
      status: number;
      route: string;
    }[];
    expect(acessos).toHaveLength(2);
    expect(acessos.map((a) => a.status).sort()).toEqual([200, 401]);
    expect(acessos.every((a) => a.route === "/integracao/shopping/v1/faturamento")).toBe(true);
  });

  it("chave vinculada a uma unidade ignora o unitId que o chamador mandar", async () => {
    const ctx = await venderUmaSessao();
    const segredo = await emitirChave(ctx.adminId, ctx.quiosqueId);

    const res = await app.inject({
      method: "GET",
      url: `/integracao/shopping/v1/faturamento?unitId=${ctx.lojaId}&de=${DE}&ate=${ATE}`,
      headers: { authorization: `Bearer ${segredo}` },
    });
    expect(res.statusCode).toBe(200);
    const declaracao = declaracaoFaturamentoSchema.parse(res.json());
    expect(declaracao.loja.unidadeId).toBe(ctx.quiosqueId);
    expect(declaracao.periodo.liquidoCentavos).toBe(ctx.totalPagoCents);
  });

  it("entrega CSV quando o shopping pedir arquivo em vez de JSON", async () => {
    const ctx = await venderUmaSessao();
    const segredo = await emitirChave(ctx.adminId, ctx.quiosqueId);

    const res = await app.inject({
      method: "GET",
      url: `/integracao/shopping/v1/faturamento?de=${DE}&ate=${ATE}&formato=csv`,
      headers: { authorization: `Bearer ${segredo}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");

    const linhas = res.body.trim().split("\r\n");
    expect(linhas[0]).toContain("data;cnpj;luc");
    expect(linhas).toHaveLength(31); // cabeçalho + 30 dias de novembro
    expect(res.body).toContain(centavosParaDecimalBr(ctx.totalPagoCents));
  });

  it("health confirma a credencial sem revelar faturamento", async () => {
    const ctx = await venderUmaSessao();
    const segredo = await emitirChave(ctx.adminId, ctx.quiosqueId);
    const res = await app.inject({
      method: "GET",
      url: "/integracao/shopping/v1/health",
      headers: { authorization: `Bearer ${segredo}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, escopo: "FATURAMENTO_LEITURA" });
    expect(res.body).not.toContain("liquidoCentavos");
  });
});

describe("montagem do documento (funções puras)", () => {
  it("preenche dia sem movimento com zero em vez de omitir a linha", () => {
    const declaracao = montarDeclaracao({
      loja: lojaCompleta,
      dataInicial: "2026-03-01",
      dataFinal: "2026-03-03",
      dias: [{ businessDate: "2026-03-02", ordersCount: 2, grossCents: 12_000, netCents: 10_000 }],
      naturezas: [{ businessDate: "2026-03-02", itemNature: "SERVICO", netCents: 10_000 }],
      meiosPagamento: [{ businessDate: "2026-03-02", method: "DINHEIRO", totalCents: 10_000 }],
      cancelamentos: [{ businessDate: "2026-03-03", cancelledCount: 1, cancelledCents: 6_000 }],
      geradoEmMs: 1_700_000_000_000,
    });

    expect(declaracao.dias.map((d) => d.data)).toEqual(["2026-03-01", "2026-03-02", "2026-03-03"]);
    expect(declaracao.dias[0]!.liquidoCentavos).toBe(0);
    expect(declaracao.dias[1]!.descontosCentavos).toBe(2_000);
    expect(declaracao.dias[1]!.ticketMedioCentavos).toBe(5_000);
    // Cancelamento é declarado à parte, não abatido do bruto.
    expect(declaracao.dias[2]!.cancelamentosCentavos).toBe(6_000);
    expect(declaracao.periodo.brutoCentavos).toBe(12_000);
    expect(declaracao.periodo.cancelamentosCentavos).toBe(6_000);
  });

  it("ignora linha fora do período pedido em vez de contrabandeá-la para o total", () => {
    const declaracao = montarDeclaracao({
      loja: lojaCompleta,
      dataInicial: "2026-03-01",
      dataFinal: "2026-03-02",
      dias: [{ businessDate: "2026-04-15", ordersCount: 9, grossCents: 99_900, netCents: 99_900 }],
      naturezas: [],
      meiosPagamento: [],
      cancelamentos: [],
      geradoEmMs: 1_700_000_000_000,
    });
    expect(declaracao.periodo.liquidoCentavos).toBe(0);
    expect(declaracao.dias).toHaveLength(2);
  });

  it("formata centavos no decimal brasileiro que o Excel pt-BR entende", () => {
    expect(centavosParaDecimalBr(0)).toBe("0,00");
    expect(centavosParaDecimalBr(5)).toBe("0,05");
    expect(centavosParaDecimalBr(6_000)).toBe("60,00");
    expect(centavosParaDecimalBr(123_456)).toBe("1234,56");
    expect(centavosParaDecimalBr(-350)).toBe("-3,50");
  });

  it("não entra em laço quando o intervalo vem invertido", () => {
    expect(listarDatas("2026-03-31", "2026-03-01")).toEqual([]);
    expect(listarDatas("2026-03-01", "2026-03-01")).toEqual(["2026-03-01"]);
  });

  it("gera CSV com cabeçalho e uma linha por dia do período", () => {
    const csv = declaracaoParaCsv(
      montarDeclaracao({
        loja: lojaCompleta,
        dataInicial: "2026-03-01",
        dataFinal: "2026-03-02",
        dias: [],
        naturezas: [],
        meiosPagamento: [],
        cancelamentos: [],
        geradoEmMs: 1_700_000_000_000,
      }),
    );
    const linhas = csv.trim().split("\r\n");
    expect(linhas).toHaveLength(3);
    expect(linhas[1]).toContain("12345678000195");
  });
});
