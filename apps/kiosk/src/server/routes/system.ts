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
