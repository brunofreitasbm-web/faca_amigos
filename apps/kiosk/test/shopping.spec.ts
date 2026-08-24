import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase, migrate } from "@facaamigos/db-local";
import { buildApp } from "../src/server/app.js";
import { seedDevData } from "../src/server/seed-dev.js";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;
let nowMs = 1_700_000_000_000;
const clock = () => nowMs;

beforeEach(async () => {
  const db = openDatabase(":memory:");
  migrate(db);
  seedDevData(db, nowMs);
  app = await buildApp({ db, hmacKey: "test-key", nowMs: clock });
});

describe("API de Integração com Shopping (Faturamento & Vendas)", () => {
  it("retorna 401 CHAVE_AUSENTE quando nenhum token é enviado", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/integracao/shopping/v1/health",
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "CHAVE_AUSENTE" });
  });

  it("responde 200 ok: true no health check com token de homologação em Bearer ou X-API-Key", async () => {
    const bearerRes = await app.inject({
      method: "GET",
      url: "/integracao/shopping/v1/health",
      headers: { authorization: "Bearer fa_shp_homolog_123" },
    });
    expect(bearerRes.statusCode).toBe(200);
    expect(bearerRes.json().ok).toBe(true);

    const apiKeyRes = await app.inject({
      method: "GET",
      url: "/integracao/shopping/v1/health",
      headers: { "x-api-key": "fa_shp_homolog_123" },
    });
    expect(apiKeyRes.statusCode).toBe(200);
    expect(apiKeyRes.json().ok).toBe(true);
  });

  it("diferencia unidades no mesmo CNPJ com chaves de produção (Playground LUC PSB01003 vs Circuito LUC PSBQF122)", async () => {
    const playgroundRes = await app.inject({
      method: "GET",
      url: "/integracao/shopping/v1/faturamento?de=2026-03-01&ate=2026-03-31",
      headers: { authorization: "Bearer fa_shp_prod_playground_9a8f7e6d" },
    });
    expect(playgroundRes.statusCode).toBe(200);
    const pgData = playgroundRes.json();
    expect(pgData.loja.luc).toBe("PSB01003");
    expect(pgData.loja.codigoLojista).toBe("PSB-1316");

    const circuitoRes = await app.inject({
      method: "GET",
      url: "/integracao/shopping/v1/faturamento?de=2026-03-01&ate=2026-03-31",
      headers: { "x-api-key": "fa_shp_prod_circuito_3b2c1a0f" },
    });
    expect(circuitoRes.statusCode).toBe(200);
    const circData = circuitoRes.json();
    expect(circData.loja.luc).toBe("PSBQF122");
    expect(circData.loja.codigoLojista).toBe("PSB-1346");
    // Mesmo CNPJ para ambas as operações no mesmo shopping
    expect(pgData.loja.cnpj).toBe(circData.loja.cnpj);
  });

  it("normaliza as LUCs internas para o padrão oficial da API", async () => {
    const { resolveShoppingUnitLUC } = await import("../src/server/routes/shopping.js");
    expect(resolveShoppingUnitLUC("PSB01003")).toBe("PSB01003");
    expect(resolveShoppingUnitLUC("PSBQF122")).toBe("PSBQF122");
    expect(resolveShoppingUnitLUC("L-142")).toBe("PSBQF122");
    expect(resolveShoppingUnitLUC("L-143")).toBe("PSB01003");
  });

  it("retorna o endpoint de vendas item a item sem dados pessoais (LGPD compliant)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/integracao/shopping/v1/vendas?de=2026-03-01&ate=2026-03-31",
      headers: { authorization: "Bearer fa_shp_homolog_token" },
    });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.layoutVersao).toBe("1.0");
    expect(json.vendas).toBeDefined();
    expect(Array.isArray(json.vendas)).toBe(true);

    // Garante que não há nenhum campo pessoal no payload
    if (json.vendas.length > 0) {
      const venda = json.vendas[0];
      expect(venda).toHaveProperty("idVenda");
      expect(venda).toHaveProperty("dataHora");
      expect(venda).toHaveProperty("valorCentavos");
      expect(venda).toHaveProperty("cancelado");
      expect(venda).toHaveProperty("troca");
      expect(venda.cpf).toBeUndefined();
      expect(venda.cliente).toBeUndefined();
      expect(venda.crianca).toBeUndefined();
    }
  });

  it("suporta paginação com metadados no endpoint /vendas", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/integracao/shopping/v1/vendas?de=2026-03-01&ate=2026-03-31&pagina=1&limite=5",
      headers: { authorization: "Bearer fa_shp_homolog_token" },
    });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.paginacao).toBeDefined();
    expect(json.paginacao.pagina).toBe(1);
    expect(json.paginacao.limite).toBe(5);
    expect(json.paginacao.totalPaginas).toBeGreaterThanOrEqual(1);
    expect(typeof json.paginacao.totalRegistros).toBe("number");
  });
});
