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
import { registerPosVisitaRoutes } from "./routes/pos-visita.js";
import { registerAniversariosRoutes } from "./routes/aniversarios.js";
import { registerCaixaFaRoutes } from "./routes/caixa-fa.js";
import { registerShoppingRoutes } from "./routes/shopping.js";
import { registerSecretVaultRoutes } from "./routes/secret-vault.js";
import { registerTickChannel } from "./ws-tick.js";
import { registerStaticSpa } from "./staticSpa.js";
import { ValidationError, ConflictError } from "./validate.js";
import type { TlsMaterial } from "./tls.js";

export interface BuildAppOptions {
  /** Quando presente, o servidor sobe em HTTPS (seção 7.3 do plano) — ver src/server/tls.ts. */
  tls?: TlsMaterial;
  /**
   * Diretório do build da SPA (apps/kiosk-ui/dist). Quando presente, o
   * servidor a serve na raiz com fallback SPA — o import de `electron`
   * fica fora daqui de propósito: main.ts e start.ts resolvem o caminho.
   */
  uiDist?: string;
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
    opts.tls ? Fastify({ logger: true, https: { key: opts.tls.key, cert: opts.tls.cert } }) : Fastify({ logger: true })
  ) as FastifyInstance;

  // Servidor local: o Electron carrega 127.0.0.1 e os tablets da LAN se
  // conectam pelo IP da máquina numa rede sem DHCP fixo, então uma
  // allowlist de origens exatas não dá — mas `origin: true` (correção da
  // auditoria de 2026-08-10, item 8) ecoava QUALQUER origem, inclusive um
  // site malicioso aberto no navegador de alguém na mesma rede, que podia
  // então falar com este servidor via CORS. Restringe a localhost e às
  // faixas de IP privado (RFC 1918) onde a LAN do quiosque de fato vive.
  const LAN_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})(:\d+)?$/;
  await app.register(cors, {
    origin: (origin, cb) => {
      // Sem header Origin (chamada nativa do Electron, curl, etc.) ou LAN privada: permite.
      if (!origin || LAN_ORIGIN_RE.test(origin)) return cb(null, true);
      cb(new Error("Origem não permitida"), false);
    },
  });
  await app.register(websocket);

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ValidationError) {
      return reply.code(err.statusCode).send({ error: "VALIDATION_ERROR", message: err.message });
    }
    if (err instanceof ConflictError) {
      return reply.code(err.statusCode).send({ error: "CONFLICT", message: err.message, ...err.details });
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
  registerPosVisitaRoutes(app, ctx);
  registerAniversariosRoutes(app, ctx);
  registerCaixaFaRoutes(app, ctx);
  registerShoppingRoutes(app, ctx);
  registerSecretVaultRoutes(app, ctx);
  registerTickChannel(app, ctx);

  if (opts.uiDist) await registerStaticSpa(app, opts.uiDist);

  return app;
}


