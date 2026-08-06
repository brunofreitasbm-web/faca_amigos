import type { FastifyInstance } from "fastify";
import { registerPonto, listPontoByEmployee, uuidv7 } from "@facaamigos/db-local";
import type { AppContext } from "../context.js";
import { pontoBodySchema } from "../schemas.js";
import { parseBody } from "../validate.js";

export function registerPontoRoutes(app: FastifyInstance, ctx: AppContext): void {
  // Sem endpoint de exclusão por desenho (Portaria MTP 671/2021) — ver packages/db-local/repositories/ponto.ts.
  app.post("/api/ponto", async (req, reply) => {
    const body = parseBody(pontoBodySchema, req.body);
    const nowMs = ctx.nowMs();
    const id = uuidv7(nowMs);
    const nsr = registerPonto(ctx.db, { id, employeeId: body.employeeId, unitId: body.unitId, kind: body.kind, registeredByEmployeeId: body.registeredByEmployeeId }, nowMs);
    return reply.code(201).send({ id, nsr, atMs: nowMs });
  });

  app.get<{ Params: { employeeId: string }; Querystring: { fromMs: string; toMs: string } }>(
    "/api/ponto/:employeeId",
    async (req) => listPontoByEmployee(ctx.db, req.params.employeeId, Number(req.query.fromMs), Number(req.query.toMs)),
  );
}
