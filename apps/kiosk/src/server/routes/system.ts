import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";
import { getUpdateStatus, checkForUpdates, applyUpdate } from "../../main/autoUpdater.js";

export function registerSystemRoutes(app: FastifyInstance, _ctx: AppContext): void {
  app.get("/api/system/info", async () => {
    return {
      update: getUpdateStatus(),
      now: Date.now(),
    };
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
