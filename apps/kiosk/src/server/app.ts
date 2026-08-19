import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import type { AppContext } from "./context.js";
import { registerPontoRoutes } from "./routes/ponto.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerShoppingRoutes } from "./routes/shopping.js";
import { registerSecretVaultRoutes } from "./routes/secret-vault.js";
import { registerSystemRoutes } from "./routes/system.js";
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

  // catalog/checkin/checkout/pdv/shifts/sessions/reports/aniversarios/caixa-fa
  // foram removidas daqui (raio-x de 2026-08-16): a SPA em apps/kiosk-ui
  // migrou para o Supabase e nenhuma delas tinha chamador real, só os
  // próprios testes injetando HTTP nelas mesmas. ponto/auth/shopping ficam
  // por ora — risco trabalhista (ponto) e possível consumidor externo
  // (auth/shopping validam bearer/api-key, típico de integração fora do
  // monorepo) que não dava para descartar com o grep disponível aqui.
  registerPontoRoutes(app, ctx);
  registerAuthRoutes(app, ctx);
  registerShoppingRoutes(app, ctx);
  registerSecretVaultRoutes(app, ctx);
  registerSystemRoutes(app, ctx);
  registerTickChannel(app, ctx);

  if (opts.uiDist) await registerStaticSpa(app, opts.uiDist);

  return app;
}



