import type { FastifyInstance } from "fastify";
import { getEmployee, getPinHash } from "@facaamigos/db-local";
import type { AppContext } from "../context.js";
import { loginPinSchema } from "../schemas.js";
import { parseBody } from "../validate.js";
import { verifyPin } from "../security/pin.js";

/**
 * Login offline por PIN (seção 7.1 do plano). Sem JWT/sessão real
 * ainda — a resposta devolve o funcionário e o front-end reenvia
 * `employeeId` em cada chamada sensível. É um substituto deliberado e
 * temporário: suficiente para a Fase 1 validar o fluxo operacional,
 * mas não é controle de acesso robusto (qualquer chamador pode alegar
 * ser outro employeeId). Antes de ir a campo com dinheiro de verdade,
 * isso precisa virar sessão assinada no servidor.
 */
export function registerAuthRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post("/api/auth/login-pin", async (req, reply) => {
    const body = parseBody(loginPinSchema, req.body);
    const employee = getEmployee(ctx.db, body.employeeId);
    const pinHash = getPinHash(ctx.db, body.employeeId);
    if (!employee || !employee.active || !pinHash || !verifyPin(body.pin, pinHash)) {
      return reply.code(401).send({ error: "CREDENCIAIS_INVALIDAS" });
    }
    return reply.code(200).send({ employee });
  });
}
