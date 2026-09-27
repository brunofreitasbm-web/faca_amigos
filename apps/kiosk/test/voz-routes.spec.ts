import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, migrate, voiceQueueStats } from "@facaamigos/db-local";
import { buildApp } from "../src/server/app.js";
import type { FastifyInstance } from "fastify";
import type { Db } from "@facaamigos/db-local";

/** Monta um WAV PCM16 mono 16kHz sintético (silêncio) — o que a rota exige do whisper.cpp. */
function buildWav(seconds: number): Buffer {
  const sampleRate = 16000;
  const n = Math.round(seconds * sampleRate);
  const data = Buffer.alloc(n * 2); // 16 bit = 2 bytes/amostra, tudo zero (silêncio)
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36, "ascii");
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const META = {
  recordingId: "018bcfe5-6800-7a62-914c-c3d6399f9f60",
  unitId: "e43ba7a8-bd5f-47ad-b81d-dae7ea19d504",
  employeeId: "11111111-1111-1111-1111-111111111111",
  momento: "CHECKIN" as const,
  startedAtMs: 1_700_000_000_000,
  endedAtMs: 1_700_000_005_000,
  durationMs: 5_000,
  sessionIds: [],
};

let app: FastifyInstance;
let db: Db;
let voiceDir: string;
const nowMs = 1_700_000_000_000;

beforeEach(async () => {
  db = openDatabase(":memory:");
  migrate(db);
  voiceDir = mkdtempSync(join(tmpdir(), "fa-voz-test-"));
  app = await buildApp({ db, hmacKey: "test-key", nowMs: () => nowMs, voiceDir });
});

afterEach(() => {
  rmSync(voiceDir, { recursive: true, force: true });
});

describe("POST /api/voz/recordings", () => {
  it("recusa quando o terminal não tem voiceDir configurado (503)", async () => {
    const dbSemVoz = openDatabase(":memory:");
    migrate(dbSemVoz);
    const appSemVoz = await buildApp({ db: dbSemVoz, hmacKey: "k", nowMs: () => nowMs });
    const res = await appSemVoz.inject({
      method: "POST",
      url: "/api/voz/recordings",
      headers: { "content-type": "application/octet-stream", "x-voz-meta": JSON.stringify(META) },
      payload: buildWav(5),
    });
    expect(res.statusCode).toBe(503);
  });

  it("grava o WAV, enfileira o job e devolve 201", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/voz/recordings",
      headers: { "content-type": "application/octet-stream", "x-voz-meta": JSON.stringify(META) },
      payload: buildWav(5),
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ ok: true, id: META.recordingId });
    expect(existsSync(join(voiceDir, "inbox", `${META.recordingId}.wav`))).toBe(true);
    expect(voiceQueueStats(db).pending).toBe(1);
  });

  it("é idempotente: reenviar o mesmo recordingId não duplica o job", async () => {
    const payload = buildWav(5);
    const headers = { "content-type": "application/octet-stream", "x-voz-meta": JSON.stringify(META) };
    await app.inject({ method: "POST", url: "/api/voz/recordings", headers, payload });
    const second = await app.inject({ method: "POST", url: "/api/voz/recordings", headers, payload });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ ok: true, duplicate: true });
    expect(voiceQueueStats(db).pending).toBe(1);
  });

  it("descarta sem gravar quando a duração é menor que o mínimo (204)", async () => {
    const meta = { ...META, durationMs: 1_000 };
    const res = await app.inject({
      method: "POST",
      url: "/api/voz/recordings",
      headers: { "content-type": "application/octet-stream", "x-voz-meta": JSON.stringify(meta) },
      payload: buildWav(1),
    });
    expect(res.statusCode).toBe(204);
    expect(voiceQueueStats(db).pending).toBe(0);
  });

  it("recusa duração acima do limite (400)", async () => {
    const meta = { ...META, durationMs: 12 * 60_000 };
    const res = await app.inject({
      method: "POST",
      url: "/api/voz/recordings",
      headers: { "content-type": "application/octet-stream", "x-voz-meta": JSON.stringify(meta) },
      payload: buildWav(5),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("DURACAO_EXCEDIDA");
  });

  it("recusa WAV que não é PCM16 mono 16kHz (400)", async () => {
    const badWav = buildWav(5);
    badWav.writeUInt32LE(44100, 24); // sample rate errado
    const res = await app.inject({
      method: "POST",
      url: "/api/voz/recordings",
      headers: { "content-type": "application/octet-stream", "x-voz-meta": JSON.stringify(META) },
      payload: badWav,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("WAV_INVALIDO");
  });

  it("recusa metadados inválidos (400)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/voz/recordings",
      headers: { "content-type": "application/octet-stream", "x-voz-meta": JSON.stringify({ ...META, unitId: "não-é-uuid" }) },
      payload: buildWav(5),
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /api/voz/status", () => {
  it("reporta disponível com a fila vazia", async () => {
    const res = await app.inject({ method: "GET", url: "/api/voz/status" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.available).toBe(true);
    expect(body.queue.pending).toBe(0);
  });
});
