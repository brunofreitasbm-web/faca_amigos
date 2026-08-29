import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase, migrate } from "@facaamigos/db-local";
import { buildApp } from "../src/server/app.js";
import type { FastifyInstance } from "fastify";

/**
 * De propósito SEM seedDevData: em produção a tabela local `units` está
 * vazia (o seed só roda com FACAAMIGOS_SEED_DEV=true). Foi essa
 * diferença que escondeu o bug — shopping.spec.ts semeia, e com `units`
 * populada a FK de app_settings passa. Sem semear, a versão antiga
 * destas rotas estourava FOREIGN KEY constraint failed, devolvia 500 e o
 * terminal nunca sabia a que unidade pertencia: o print bridge então
 * aceitava job de TODAS as unidades e a impressão de uma unidade saía
 * também na outra.
 */
let app: FastifyInstance;
const nowMs = 1_700_000_000_000;

beforeEach(async () => {
  const db = openDatabase(":memory:");
  migrate(db);
  app = await buildApp({ db, hmacKey: "test-key", nowMs: () => nowMs });
});

describe("rotas de identidade do terminal (banco sem units, como em produção)", () => {
  it("gera e persiste o device-id sem depender da tabela units", async () => {
    const first = await app.inject({ method: "GET", url: "/api/system/device-id" });
    expect(first.statusCode).toBe(200);
    const deviceId = first.json().deviceId as string;
    expect(deviceId).toMatch(/^[0-9a-f-]{36}$/);

    const second = await app.inject({ method: "GET", url: "/api/system/device-id" });
    expect(second.statusCode).toBe(200);
    expect(second.json().deviceId).toBe(deviceId);
  });

  it("grava e devolve a unidade deste terminal", async () => {
    const before = await app.inject({ method: "GET", url: "/api/system/terminal-unit" });
    expect(before.statusCode).toBe(200);
    expect(before.json().unitId).toBeNull();

    const saved = await app.inject({
      method: "POST",
      url: "/api/system/terminal-unit",
      payload: { unitId: "E43BA7A8-BD5F-47AD-B81D-DAE7EA19D504" },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().ok).toBe(true);

    // Normalizado em minúsculas: o filtro do Realtime e o claim comparam
    // o unit_id como texto, e um casaria enquanto o outro não.
    expect(saved.json().unitId).toBe("e43ba7a8-bd5f-47ad-b81d-dae7ea19d504");

    const after = await app.inject({ method: "GET", url: "/api/system/terminal-unit" });
    expect(after.json().unitId).toBe("e43ba7a8-bd5f-47ad-b81d-dae7ea19d504");
  });

  it("recusa unidade vazia sem gravar nada", async () => {
    const res = await app.inject({ method: "POST", url: "/api/system/terminal-unit", payload: { unitId: "  " } });
    expect(res.statusCode).toBe(400);

    const after = await app.inject({ method: "GET", url: "/api/system/terminal-unit" });
    expect(after.json().unitId).toBeNull();
  });
});
