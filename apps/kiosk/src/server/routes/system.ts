import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";
import { getUpdateStatus, checkForUpdates, applyUpdate } from "../../main/autoUpdater.js";

export function registerSystemRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/api/system/info", async () => {
    return {
      update: getUpdateStatus(),
      now: Date.now(),
    };
  });

  /**
   * Identifica este computador (não a unidade) para o print bridge só
   * imprimir os jobs que ele mesmo enfileirou — sem isto, 2 terminais na
   * mesma unidade imprimem cada pulseira/cupom em dobro. Gerado uma vez e
   * persistido localmente; cada instalação do Electron tem o seu.
   */
  app.get("/api/system/device-id", async () => {
    const row = ctx.db.prepare("SELECT value FROM app_settings WHERE unit_id = 'global' AND key = 'device_id'").get() as
      | { value: string }
      | undefined;
    if (row?.value) return { deviceId: row.value };

    const deviceId = randomUUID();
    ctx.db
      .prepare(
        `INSERT INTO app_settings (unit_id, key, value, updated_at_ms)
         VALUES ('global', 'device_id', ?, ?)
         ON CONFLICT (unit_id, key) DO NOTHING`
      )
      .run(deviceId, Date.now());
    const persisted = ctx.db.prepare("SELECT value FROM app_settings WHERE unit_id = 'global' AND key = 'device_id'").get() as {
      value: string;
    };
    return { deviceId: persisted.value };
  });

  app.get("/api/system/terminal-unit", async () => {
    try {
      const row = ctx.db.prepare("SELECT value FROM app_settings WHERE key = 'terminal_unit_id'").get() as { value: string } | undefined;
      return { unitId: row?.value ?? process.env.FACAAMIGOS_UNIT_ID ?? null };
    } catch {
      return { unitId: process.env.FACAAMIGOS_UNIT_ID ?? null };
    }
  });

  app.post<{ Body: { unitId: string } }>("/api/system/terminal-unit", async (req) => {
    const { unitId } = req.body ?? {};
    if (!unitId || typeof unitId !== "string") {
      return { ok: false, message: "unitId inválido" };
    }
    const nowMs = Date.now();
    ctx.db
      .prepare(
        `INSERT INTO app_settings (unit_id, key, value, updated_at_ms)
         VALUES ('global', 'terminal_unit_id', ?, ?)
         ON CONFLICT (unit_id, key) DO UPDATE SET value = excluded.value, updated_at_ms = excluded.updated_at_ms`
      )
      .run(unitId.trim(), nowMs);
    return { ok: true, unitId: unitId.trim() };
  });

  app.post("/api/system/update/check", async () => {
    checkForUpdates();
    return { ok: true, update: getUpdateStatus() };
  });

  app.post("/api/system/update/apply", async () => {
    applyUpdate();
    return { ok: true };
  });
}
