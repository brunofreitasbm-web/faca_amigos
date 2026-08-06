import type { FastifyInstance } from "fastify";
import { evaluateLoyaltyRules, visitTier, planDurationMinutes, minutesUntilClosing } from "@facaamigos/domain";
import {
  findGuardianByPhone,
  findGuardianByCpf,
  insertGuardian,
  insertChild,
  linkChildGuardian,
  getPlan,
  tryAllocateAsset,
  insertSession,
  insertVisit,
  getVisitLog,
  findActiveCoupon,
  tryConsumeCoupon,
  listActiveLoyaltyRules,
  grantLoyaltyReward,
  getUnit,
  getAppSetting,
  uuidv7,
  withTransaction,
} from "@facaamigos/db-local";
import type { AppContext } from "../context.js";
import { checkinBodySchema } from "../schemas.js";
import { parseBody, ValidationError } from "../validate.js";
import { businessDateFor } from "../business-date.js";
import { ticketPayload, wristbandPayload } from "../security/codes.js";

export function registerCheckinRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post("/api/checkins", async (req, reply) => {
    const body = parseBody(checkinBodySchema, req.body);
    const nowMs = ctx.nowMs();

    const unit = getUnit(ctx.db, body.unitId);
    if (!unit) throw new ValidationError(`Unidade ${body.unitId} não encontrada`);

    const plan = getPlan(ctx.db, body.planId);
    if (!plan || plan.activity !== body.activity) throw new ValidationError("Plano inválido para a atividade selecionada");

    const closingTime = getAppSetting(ctx.db, body.unitId, "closing_time");
    if (closingTime) {
      const remaining = minutesUntilClosing(nowMs, closingTime);
      if (remaining !== null && planDurationMinutes(plan) > remaining) {
        throw new ValidationError(
          remaining > 0
            ? `Este plano não cabe até o fechamento (faltam ${remaining} min)`
            : "O shopping já está fechando — não é possível iniciar novos planos",
        );
      }
    }

    if (body.activity === "CARRINHO") {
      if (!body.assetId) throw new ValidationError("assetId é obrigatório para CARRINHO");
      if (!tryAllocateAsset(ctx.db, body.assetId)) {
        return reply.code(409).send({ error: "ASSET_INDISPONIVEL", message: "Carrinho já foi alocado por outro terminal" });
      }
    }

    let guardianId =
      body.guardian.id ??
      findGuardianByCpf(ctx.db, body.guardian.cpf)?.id ??
      findGuardianByPhone(ctx.db, body.guardian.phoneE164)?.id;
    if (!guardianId) {
      guardianId = uuidv7(nowMs);
      insertGuardian(
        ctx.db,
        { id: guardianId, full_name: body.guardian.fullName, phone_e164: body.guardian.phoneE164, cpf: body.guardian.cpf },
        nowMs,
      );
    }

    let childId = body.child.id;
    if (!childId) {
      childId = uuidv7(nowMs);
      insertChild(
        ctx.db,
        {
          id: childId,
          full_name: body.child.fullName,
          birth_date: body.child.birthDate,
          inclusive_eligible: body.child.inclusiveEligible ? 1 : 0,
          inclusive_proof_type: body.child.inclusiveProofType ?? null,
        },
        nowMs,
      );
    }
    linkChildGuardian(ctx.db, childId, guardianId);

    let couponId: string | null = null;
    let couponDiscountCents = 0;
    if (body.couponCode) {
      const coupon = findActiveCoupon(ctx.db, body.unitId, body.couponCode);
      if (!coupon) throw new ValidationError("Cupom inválido ou esgotado");
      if (!tryConsumeCoupon(ctx.db, coupon.id)) {
        return reply.code(409).send({ error: "CUPOM_ESGOTADO" });
      }
      couponId = coupon.id;
      // MINUTOS_EXTRA não desconta em dinheiro na entrada — é aplicado como tempo extra no plano (fora do escopo desta rota).
      if (coupon.kind === "DESCONTO_VALOR") couponDiscountCents = coupon.value;
      if (coupon.kind === "DESCONTO_PCT") couponDiscountCents = Math.round((plan.valueCents * coupon.value) / 100);
    }

    const sessionId = uuidv7(nowMs);
    const shortId = sessionId.replace(/-/g, "").slice(0, 12);

    withTransaction(ctx.db, () => {
      insertSession(ctx.db, {
        id: sessionId,
        unit_id: body.unitId,
        activity: body.activity,
        asset_id: body.assetId ?? null,
        plan_id: body.planId,
        child_id: childId!,
        child_name_snapshot: body.child.fullName,
        guardian_id: guardianId!,
        wristband_code: wristbandPayload(shortId, ctx.hmacKey),
        ticket_code: ticketPayload(shortId, ctx.hmacKey),
        checkin_at_ms: nowMs,
        checkin_by_employee_id: body.employeeId,
        coupon_id: couponId,
        coupon_discount_cents: couponDiscountCents,
        free_from_loyalty: 0,
        business_date: businessDateFor(nowMs, unit.business_day_cutoff_hour),
      });

      insertVisit(ctx.db, uuidv7(nowMs), childId!, body.activity, nowMs);
      const visitsAfter = getVisitLog(ctx.db, childId!).length;
      const rules = listActiveLoyaltyRules(ctx.db, body.unitId);
      for (const earned of evaluateLoyaltyRules(body.activity, visitsAfter, rules, nowMs)) {
        grantLoyaltyReward(ctx.db, childId!, earned.ruleId, earned.earnedAtMs);
      }
    });

    const badge = visitTier(getVisitLog(ctx.db, childId), nowMs);

    return reply.code(201).send({
      sessionId,
      childId,
      guardianId,
      wristbandCode: wristbandPayload(shortId, ctx.hmacKey),
      ticketCode: ticketPayload(shortId, ctx.hmacKey),
      frequencyBadge: badge,
    });
  });
}
