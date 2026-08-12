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

describe("Cofre de Senhas Temporário (One-Time Secret Vault)", () => {
  it("gera um link seguro e permite visualização única (destruição automática)", async () => {
    // 1. Criar segredo
    const createRes = await app.inject({
      method: "POST",
      url: "/api/secret/create",
      payload: { payload: "fa_shp_homolog_secretkey_12345", ttlHours: 24, maxViews: 1 },
    });

    expect(createRes.statusCode).toBe(200);
    const created = createRes.json();
    expect(created.ok).toBe(true);
    expect(created.id).toBeDefined();
    expect(created.secretUrl).toBe(`/segredo/${created.id}`);

    // 2. Primeira leitura (Sucesso & Destruído)
    const read1Res = await app.inject({
      method: "GET",
      url: `/api/secret/${created.id}`,
    });

    expect(read1Res.statusCode).toBe(200);
    const read1 = read1Res.json();
    expect(read1.ok).toBe(true);
    expect(read1.payload).toBe("fa_shp_homolog_secretkey_12345");
    expect(read1.destroyed).toBe(true);

    // 3. Segunda leitura (Falha 404 - Já destruído)
    const read2Res = await app.inject({
      method: "GET",
      url: `/api/secret/${created.id}`,
    });

    expect(read2Res.statusCode).toBe(404);
    expect(read2Res.json().error).toBe("SECRET_NOT_FOUND");
  });

  it("rejeita criacao sem payload", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/secret/create",
      payload: { payload: "" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("PAYLOAD_INVALIDO");
  });
});
