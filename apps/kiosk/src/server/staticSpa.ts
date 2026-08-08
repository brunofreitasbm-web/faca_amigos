import { existsSync } from "node:fs";
import { join } from "node:path";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";

/**
 * D1 do plano: este servidor serve a própria SPA (apps/kiosk-ui/dist) na
 * mesma origem do /api — o Electron carrega 127.0.0.1:7317 e os paths
 * relativos `/api/...` do client funcionam sem base URL configurável.
 */
export async function registerStaticSpa(app: FastifyInstance, uiDist: string) {
  if (!existsSync(join(uiDist, "index.html"))) {
    app.log.warn(`SPA não encontrada em ${uiDist} — servindo apenas /api (rode o build do kiosk-ui)`);
    return;
  }

  await app.register(fastifyStatic, { root: uiDist });

  // Fallback SPA: qualquer GET fora de /api e /ws devolve o index.html
  // para o roteamento client-side; o resto mantém 404 de verdade.
  app.setNotFoundHandler((req, reply) => {
    const isPageLoad = req.method === "GET" || req.method === "HEAD";
    if (!isPageLoad || req.url.startsWith("/api") || req.url.startsWith("/ws")) {
      return reply.code(404).send({ error: "NOT_FOUND" });
    }
    return reply.sendFile("index.html");
  });
}
