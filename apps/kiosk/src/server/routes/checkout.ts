import type { FastifyInstance } from "fastify";
import { quoteForSession } from "@facaamigos/domain";
import {
  getSession,
  tryMarkAwaitingPayment,
  revertToActive,
  getPlan,
  releaseAsset,
  getOpenShift,
  createOrder,
  recordPayment,
  markOrderPaid,
  finalizeSession,
  redeemLoyaltyReward,
  uuidv7,
  withTransaction,
  type OrderItemInput,
} from "@facaamigos/db-local";
import type { AppContext } from "../context.js";
import { checkoutBodySchema } from "../schemas.js";
import { parseBody, ValidationError } from "../validate.js";

export function registerCheckoutRoutes(app: FastifyInstance, ctx: AppContext): void {
  // Popup de fechamento com seleção de mais de 1 card (famílias com mais de uma criança) — seção do protótipo.
  app.post("/api/checkout", async (req, reply) => {
    const body = parseBody(checkoutBodySchema, req.body);
    const nowMs = ctx.nowMs();

    const sessions = body.sessionIds.map((id) => {
      const session = getSession(ctx.db, id);
      if (!session) throw new ValidationError(`Sessão ${id} não encontrada`);
      if (session.status !== "ATIVA") throw new ValidationError(`Sessão ${id} não está ATIVA`);
      return session;
    });

    const locked: string[] = [];
    for (const session of sessions) {
      if (!tryMarkAwaitingPayment(ctx.db, session.id)) {
        for (const id of locked) revertToActive(ctx.db, id);
        return reply.code(409).send({ error: "SESSAO_JA_FECHADA", sessionId: session.id });
      }
      locked.push(session.id);
    }

    const items: OrderItemInput[] = [];
    let totalCents = 0;
    for (const [index, session] of sessions.entries()) {
      const plan = getPlan(ctx.db, session.plan_id)!;
      const freeFromLoyalty = index === 0 && body.redeemRewardIds.length > 0;
      const quote = quoteForSession(
        plan,
        {
          checkinAtMs: session.checkin_at_ms,
          childName: session.child_name_snapshot,
          planId: session.plan_id,
          couponDiscountCents: session.coupon_discount_cents,
          couponCode: null,
          freeFromLoyalty,
        },
        nowMs,
      );
      totalCents += quote.totalCents;
      for (const line of quote.lines) {
        items.push({
          itemType: "SESSAO",
          itemNature: "SERVICO",
          description: line.label,
          quantity: 1,
          unitPriceCents: line.cents,
          listUnitPriceCents: line.cents,
          totalCents: line.cents,
          sessionId: session.id,
        });
      }
    }

    const paymentsTotal = body.payments.reduce((sum, p) => sum + p.amountCents, 0);
    if (paymentsTotal !== totalCents) {
      for (const id of locked) revertToActive(ctx.db, id);
      throw new ValidationError(`Soma dos pagamentos (${paymentsTotal}) não bate com o total da cotação (${totalCents})`);
    }

    const unitId = sessions[0]!.unit_id;
    const shift = getOpenShift(ctx.db, unitId);
    if (!shift) {
      for (const id of locked) revertToActive(ctx.db, id);
      throw new ValidationError("Não há turno aberto nesta unidade");
    }

    const orderId = uuidv7(nowMs);
    withTransaction(ctx.db, () => {
      createOrder(ctx.db, { id: orderId, unitId, shiftId: shift.id, kind: "SESSAO", businessDate: shift.business_date }, items, nowMs);
      for (const payment of body.payments) {
        recordPayment(ctx.db, { id: uuidv7(nowMs), orderId, ...payment }, nowMs);
      }
      markOrderPaid(ctx.db, orderId, body.employeeId, nowMs);

      for (const session of sessions) {
        finalizeSession(ctx.db, session.id, nowMs, orderId);
        if (session.asset_id) {
          const usedMinutes = Math.ceil((nowMs - session.checkin_at_ms) / 60_000);
          releaseAsset(ctx.db, session.asset_id, usedMinutes);
        }
      }
      for (const rewardId of body.redeemRewardIds) {
        redeemLoyaltyReward(ctx.db, rewardId, sessions[0]!.id, nowMs);
      }
    });

    return reply.code(200).send({ orderId, totalCents });
  });
}
