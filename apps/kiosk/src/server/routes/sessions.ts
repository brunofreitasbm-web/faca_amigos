import type { FastifyInstance } from "fastify";
import { quoteForSession } from "@facaamigos/domain";
import {
  listActiveSessions,
  getPlan,
  getGuardian,
  listRedeemableRewards,
  insertSessionEvent,
  changeSessionPlan,
} from "@facaamigos/db-local";
import type { AppContext } from "../context.js";
import { notifySessionSchema, changeSessionPlanSchema } from "../schemas.js";
import { parseBody, ValidationError } from "../validate.js";

export function registerSessionRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get<{ Querystring: { unitId: string } }>("/api/sessions/active", async (req) => {
    const nowMs = ctx.nowMs();
    return listActiveSessions(ctx.db, req.query.unitId).map((session) => {
      const plan = getPlan(ctx.db, session.plan_id)!;
      const guardian = getGuardian(ctx.db, session.guardian_id);
      const quote = quoteForSession(
        plan,
        {
          checkinAtMs: session.checkin_at_ms,
          childName: session.child_name_snapshot,
          planId: session.plan_id,
          couponDiscountCents: session.coupon_discount_cents,
          couponCode: null,
          freeFromLoyalty: Boolean(session.free_from_loyalty),
        },
        nowMs,
      );
      return {
        session: {
          ...session,
          guardian_name_snapshot: guardian?.full_name,
          guardian_phone_snapshot: guardian?.phone_e164,
        },
        quote,
        plan: { id: plan.id, name: plan.name, color: plan.color },
      };
    });
  });

  app.get<{ Params: { childId: string } }>("/api/children/:childId/redeemable-rewards", async (req) =>
    listRedeemableRewards(ctx.db, req.params.childId),
  );

  // Notificação ao responsável: WhatsApp é um link wa.me aberto pelo operador no
  // cliente (sem custo/API), SMS ainda não tem provedor configurado — ambos só
  // ficam registrados no histórico da sessão para auditoria.
  app.post<{ Params: { id: string } }>("/api/sessions/:id/notify", async (req, reply) => {
    const body = parseBody(notifySessionSchema, req.body);
    const nowMs = ctx.nowMs();
    insertSessionEvent(ctx.db, {
      sessionId: req.params.id,
      kind: body.channel === "WHATSAPP" ? "NOTIFICACAO_WHATSAPP" : "NOTIFICACAO_SMS_SIMULADA",
      atMs: nowMs,
      employeeId: null,
      payload: { message: body.message },
    });
    return reply.code(200).send({ ok: true, simulated: body.channel === "SMS" });
  });

  app.patch<{ Params: { id: string } }>("/api/sessions/:id/plan", async (req, reply) => {
    const body = parseBody(changeSessionPlanSchema, req.body);
    const ok = changeSessionPlan(ctx.db, req.params.id, body.planId);
    if (!ok) throw new ValidationError("Sessão não está ativa ou não existe");
    insertSessionEvent(ctx.db, {
      sessionId: req.params.id,
      kind: "TROCA_PLANO",
      atMs: ctx.nowMs(),
      employeeId: null,
      payload: { newPlanId: body.planId },
    });
    return reply.code(200).send({ ok: true });
  });
}
