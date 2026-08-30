import type { FastifyInstance } from "fastify";
import { ensureDeviceId, getTerminalUnitId, setTerminalUnitId } from "@facaamigos/db-local";
import type { AppContext } from "../context.js";
import { getUpdateStatus, checkForUpdates, applyUpdate } from "../../main/autoUpdater.js";
import { rebindPrintBridge } from "../../main/printBridgeControl.js";
import { getPrintBridgeStatus } from "../../main/printBridge.js";

export function registerSystemRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/api/system/info", async () => {
    return {
      update: getUpdateStatus(),
      now: Date.now(),
    };
  });

  app.get("/api/system/print-bridge-status", async () => {
    return getPrintBridgeStatus();
  });

  /**
   * Identifica este COMPUTADOR (não a unidade). Gravado em
   * `terminal_settings` — a versão anterior gravava em `app_settings`
   * com unit_id 'global', o que sempre falhava na FK para `units`
   * (vazia em produção) e devolvia 500 sem ninguém perceber.
   */
  app.get("/api/system/device-id", async (_req, reply) => {
    try {
      return { deviceId: ensureDeviceId(ctx.db, ctx.nowMs()) };
    } catch (err) {
      app.log.error({ err }, "[system] falha ao gerar/ler o device-id deste terminal");
      return reply.code(500).send({ error: "DEVICE_ID_INDISPONIVEL", message: err instanceof Error ? err.message : String(err) });
    }
  });

  /**
   * Unidade a que este computador pertence. É o que faz o print bridge
   * imprimir só os jobs da própria unidade — sem isso ele aceita job de
   * todas elas e a impressão de uma unidade sai também na outra.
   */
  app.get("/api/system/terminal-unit", async (_req, reply) => {
    try {
      return { unitId: getTerminalUnitId(ctx.db) ?? process.env.FACAAMIGOS_UNIT_ID ?? null };
    } catch (err) {
      app.log.error({ err }, "[system] falha ao ler a unidade deste terminal");
      return reply.code(500).send({ error: "TERMINAL_UNIT_INDISPONIVEL", message: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post<{ Body: { unitId: string } }>("/api/system/terminal-unit", async (req, reply) => {
    const { unitId } = req.body ?? {};
    if (!unitId || typeof unitId !== "string" || !unitId.trim()) {
      return reply.code(400).send({ error: "UNIT_ID_INVALIDO", message: "Informe a unidade deste computador." });
    }

    // O filtro do Realtime e o claim no Postgres comparam o unit_id como
    // texto: um UUID em maiúsculas casaria no Realtime e não casaria no
    // claim, deixando o terminal amarrado "no papel" e mudo na prática.
    const normalized = unitId.trim().toLowerCase();

    try {
      setTerminalUnitId(ctx.db, normalized, ctx.nowMs());
    } catch (err) {
      app.log.error({ err }, "[system] falha ao gravar a unidade deste terminal");
      return reply.code(500).send({ error: "TERMINAL_UNIT_NAO_SALVA", message: err instanceof Error ? err.message : String(err) });
    }

    // Reassina o Realtime na unidade nova sem exigir reinício do app: o
    // operador amarra o terminal na tela e a impressão já passa a sair
    // no lugar certo.
    rebindPrintBridge();

    return { ok: true, unitId: normalized };
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
