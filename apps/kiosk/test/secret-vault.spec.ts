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

describe("Cofre de Senhas Temporário (Secret Vault)", () => {
  it("gera um link seguro com autodestruicao quando autoDestroy e true", async () => {
    // 1. Criar segredo com autoDestroy: true
    const createRes = await app.inject({
      method: "POST",
      url: "/api/secret/create",
      payload: { payload: "fa_shp_homolog_secretkey_12345", ttlHours: 24, autoDestroy: true },
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

  it("gera um link reutilizavel por padrao sem autodestruir na 1a leitura e envia por e-mail", async () => {
    // 1. Criar segredo com e-mail de destino
    const createRes = await app.inject({
      method: "POST",
      url: "/api/secret/create",
      payload: {
        payload: "fa_shp_homolog_persistente_999",
        recipientEmail: "desenvolvimento@shopping.com.br",
      },
    });

    expect(createRes.statusCode).toBe(200);
    const created = createRes.json();
    expect(created.ok).toBe(true);
    expect(created.emailSent).toBe(true);
    expect(created.recipientEmail).toBe("desenvolvimento@shopping.com.br");

    // 2. Primeira leitura (Sucesso & NAO destruído)
    const read1Res = await app.inject({
      method: "GET",
      url: `/api/secret/${created.id}`,
    });

    expect(read1Res.statusCode).toBe(200);
    const read1 = read1Res.json();
    expect(read1.ok).toBe(true);
    expect(read1.payload).toBe("fa_shp_homolog_persistente_999");
    expect(read1.destroyed).toBe(false);

    // 3. Segunda leitura (Ainda disponível para a equipe)
    const read2Res = await app.inject({
      method: "GET",
      url: `/api/secret/${created.id}`,
    });

    expect(read2Res.statusCode).toBe(200);
    expect(read2Res.json().payload).toBe("fa_shp_homolog_persistente_999");
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
