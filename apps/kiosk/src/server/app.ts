import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import type { AppContext } from "./context.js";
import { registerCatalogRoutes } from "./routes/catalog.js";
import { registerCheckinRoutes } from "./routes/checkin.js";
import { registerSessionRoutes } from "./routes/sessions.js";
import { registerCheckoutRoutes } from "./routes/checkout.js";
import { registerPdvRoutes } from "./routes/pdv.js";
import { registerShiftRoutes } from "./routes/shifts.js";
import { registerPontoRoutes } from "./routes/ponto.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerReportRoutes } from "./routes/reports.js";
import { registerFaturamentoRoutes } from "./routes/faturamento.js";
import { registerTickChannel } from "./ws-tick.js";
import { ValidationError, ConflictError } from "./validate.js";
import type { TlsMaterial } from "./tls.js";

export interface BuildAppOptions {
  /** Quando presente, o servidor sobe em HTTPS (seção 7.3 do plano) — ver src/server/tls.ts. */
  tls?: TlsMaterial;
}

/**
 * D1 do plano: uma única SPA servida por este processo. O Electron
 * carrega 127.0.0.1; os tablets da LAN carregam o mesmo servidor.
 * HTTPS é opt-in via `opts.tls` — desligado por padrão em dev para não
 * quebrar o proxy do Vite com certificado autoassinado; ligar quando o
 * tablet real precisar de câmera (getUserMedia exige contexto seguro).
 */
export async function buildApp(ctx: AppContext, opts: BuildAppOptions = {}) {
  // O tipo genérico de Fastify() muda com base na presença de `https` nas
  // options (overloads incompatíveis para HTTP vs HTTPS) — unificar aqui
  // para o resto do arquivo não precisar carregar essa união.
  const app: FastifyInstance = (
    opts.tls
      ? Fastify({ logger: true, https: { key: opts.tls.key, cert: opts.tls.cert } })
      : Fastify({ logger: true })
  ) as FastifyInstance;

  await app.register(cors, { origin: true });
  await app.register(websocket);

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ValidationError) {
      return reply.code(err.statusCode).send({ error: "VALIDATION_ERROR", message: err.message });
    }
    if (err instanceof ConflictError) {
      return reply
        .code(err.statusCode)
        .send({ error: "CONFLICT", message: err.message, ...err.details });
    }
    app.log.error(err);
    return reply.code(500).send({ error: "INTERNAL_ERROR" });
  });

  app.get("/api/health", async () => ({ ok: true, nowMs: ctx.nowMs() }));

  registerCatalogRoutes(app, ctx);
  registerCheckinRoutes(app, ctx);
  registerSessionRoutes(app, ctx);
  registerCheckoutRoutes(app, ctx);
  registerPdvRoutes(app, ctx);
  registerShiftRoutes(app, ctx);
  registerPontoRoutes(app, ctx);
  registerAuthRoutes(app, ctx);
  registerReportRoutes(app, ctx);
  registerFaturamentoRoutes(app, ctx);
  registerTickChannel(app, ctx);

  return app;
}
