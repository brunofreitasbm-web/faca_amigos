import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase, migrate, listUnits, listAssets } from "@facaamigos/db-local";
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

describe("fluxo completo via HTTP", () => {
  it("check-in, painel com cotação ao vivo, checkout multi-sessão e fechamento de turno", async () => {
    const unitsRes = await app.inject({ method: "GET", url: "/api/units" });
    const units = unitsRes.json() as { id: string; kind: string }[];
    const quiosque = units.find((u) => u.kind === "QUIOSQUE")!;
    const loja = units.find((u) => u.kind === "LOJA")!;
    expect(quiosque).toBeDefined();

    const employeesRes = await app.inject({ method: "GET", url: "/api/employees" });
    const [admin] = employeesRes.json() as { id: string }[];

    const plansRes = await app.inject({ method: "GET", url: `/api/plans?unitId=${quiosque.id}&activity=CARRINHO` });
    const [plan15min] = plansRes.json() as { id: string; valueCents: number }[];

    const assetsRes = await app.inject({ method: "GET", url: `/api/assets?unitId=${quiosque.id}` });
    const [asset] = assetsRes.json() as { id: string; status: string }[];
    expect(asset.status).toBe("DISPONIVEL");

    // Turno precisa estar aberto para o checkout fechar (seção Caixa).
    const openShiftRes = await app.inject({
      method: "POST",
      url: "/api/shifts/open",
      payload: { unitId: quiosque.id, employeeId: admin.id, openingCashCents: 10000 },
    });
    expect(openShiftRes.statusCode).toBe(201);

    const checkinRes = await app.inject({
      method: "POST",
      url: "/api/checkins",
      payload: {
        unitId: quiosque.id,
        activity: "CARRINHO",
        assetId: asset.id,
        planId: plan15min.id,
        employeeId: admin.id,
        child: { fullName: "Helena Souza", birthDate: "2019-04-12", inclusiveEligible: false },
        guardian: { fullName: "Maria Souza", phoneE164: "+5591982501215" },
      },
    });
    expect(checkinRes.statusCode).toBe(201);
    const checkin = checkinRes.json() as { sessionId: string };

    // Carrinho some da lista de disponíveis (alocação condicional).
    const assetsAfter = (await app.inject({ method: "GET", url: `/api/assets?unitId=${quiosque.id}` })).json() as { status: string }[];
    expect(assetsAfter[0]!.status).toBe("EM_USO");

    // Painel: cotação ao vivo dentro do prazo.
    const activeRes = await app.inject({ method: "GET", url: `/api/sessions/active?unitId=${quiosque.id}` });
    const active = activeRes.json() as { session: { id: string }; quote: { totalCents: number } }[];
    expect(active).toHaveLength(1);
    expect(active[0]!.quote.totalCents).toBe(plan15min.valueCents);

    // Avança 18 minutos: 3 min de excedente a R$1,00.
    nowMs += 18 * 60_000;
    const activeAfter = (await app.inject({ method: "GET", url: `/api/sessions/active?unitId=${quiosque.id}` })).json() as {
      quote: { totalCents: number };
    }[];
    expect(activeAfter[0]!.quote.totalCents).toBe(plan15min.valueCents + 300);

    const checkoutRes = await app.inject({
      method: "POST",
      url: "/api/checkout",
      payload: {
        sessionIds: [checkin.sessionId],
        employeeId: admin.id,
        payments: [{ method: "PIX", amountCents: plan15min.valueCents + 300 }],
      },
    });
    expect(checkoutRes.statusCode).toBe(200);

    // Carrinho volta a ficar disponível após o checkout.
    const assetsFinal = (await app.inject({ method: "GET", url: `/api/assets?unitId=${quiosque.id}` })).json() as { status: string }[];
    expect(assetsFinal[0]!.status).toBe("DISPONIVEL");

    // Segundo checkout da mesma sessão deve falhar (já FINALIZADA).
    const doubleCheckout = await app.inject({
      method: "POST",
      url: "/api/checkout",
      payload: { sessionIds: [checkin.sessionId], employeeId: admin.id, payments: [{ method: "PIX", amountCents: 100 }] },
    });
    expect(doubleCheckout.statusCode).toBe(400);

    // Fechamento de turno: esperado bate com o que foi vendido.
    const shiftRes = await app.inject({ method: "GET", url: `/api/shifts/current?unitId=${quiosque.id}` });
    const shift = shiftRes.json() as { id: string };
    const closeRes = await app.inject({
      method: "POST",
      url: `/api/shifts/${shift.id}/close`,
      payload: { employeeId: admin.id, declared: { DINHEIRO: 10000, PIX: plan15min.valueCents + 300 } },
    });
    expect(closeRes.statusCode).toBe(200);
    const closed = closeRes.json() as { divergence: Record<string, number> };
    expect(closed.divergence.DINHEIRO).toBe(0);
    expect(closed.divergence.PIX).toBe(0);

    // Sanidade de isolamento por unidade (D9): produtos da Loja existem independente do turno do Quiosque.
    const productsRes = await app.inject({ method: "GET", url: `/api/products?unitId=${loja.id}` });
    expect(productsRes.statusCode).toBe(200);
  });
});

describe("listUnits/listAssets via repositórios (sanidade do seed)", () => {
  it("cria as duas unidades e a frota do quiosque", () => {
    const db = openDatabase(":memory:");
    migrate(db);
    seedDevData(db, nowMs);
    expect(listUnits(db)).toHaveLength(2);
    const quiosque = listUnits(db).find((u) => u.kind === "QUIOSQUE")!;
    expect(listAssets(db, quiosque.id).length).toBeGreaterThan(0);
  });
});
