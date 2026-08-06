import type { FastifyInstance } from "fastify";
import {
  openShift,
  getOpenShift,
  getShift,
  closeShift,
  recordCashMovement,
  listCashMovements,
  sumPaymentsByMethodForShift,
  getUnit,
  uuidv7,
} from "@facaamigos/db-local";
import type { AppContext } from "../context.js";
import { cashMovementBodySchema, closeShiftBodySchema, openShiftBodySchema } from "../schemas.js";
import { parseBody, ValidationError } from "../validate.js";
import { businessDateFor } from "../business-date.js";

export function registerShiftRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get<{ Querystring: { unitId: string } }>("/api/shifts/current", async (req) => {
    const shift = getOpenShift(ctx.db, req.query.unitId);
    return shift ?? null;
  });

  app.post("/api/shifts/open", async (req, reply) => {
    const body = parseBody(openShiftBodySchema, req.body);
    if (getOpenShift(ctx.db, body.unitId)) throw new ValidationError("Já existe um turno aberto nesta unidade");
    const unit = getUnit(ctx.db, body.unitId);
    if (!unit) throw new ValidationError("Unidade não encontrada");

    const nowMs = ctx.nowMs();
    const id = uuidv7(nowMs);
    openShift(ctx.db, { id, unitId: body.unitId, openedByEmployeeId: body.employeeId, openingCashCents: body.openingCashCents, businessDate: businessDateFor(nowMs, unit.business_day_cutoff_hour) }, nowMs);
    recordCashMovement(ctx.db, { id: uuidv7(nowMs), shiftId: id, kind: "TROCO_INICIAL", amountCents: body.openingCashCents, employeeId: body.employeeId }, nowMs);
    return reply.code(201).send({ id });
  });

  app.get<{ Params: { id: string } }>("/api/shifts/:id/cash-movements", async (req) => listCashMovements(ctx.db, req.params.id));

  app.get<{ Params: { id: string } }>("/api/shifts/:id/revenue-by-method", async (req) => sumPaymentsByMethodForShift(ctx.db, req.params.id));

  app.post<{ Params: { id: string } }>("/api/shifts/:id/cash-movements", async (req, reply) => {
    const body = parseBody(cashMovementBodySchema, req.body);
    const shift = getShift(ctx.db, req.params.id);
    if (!shift || shift.status !== "ABERTO") throw new ValidationError("Turno inexistente ou já fechado");
    const nowMs = ctx.nowMs();
    recordCashMovement(ctx.db, { id: uuidv7(nowMs), shiftId: shift.id, kind: body.kind, amountCents: body.amountCents, reason: body.reason, employeeId: body.employeeId }, nowMs);
    return reply.code(201).send({ ok: true });
  });

  /**
   * Fechamento não-cego (decisão de produto — sem gaveta eletrônica,
   * o operador já vê o esperado por método ao declarar). `expected` é
   * sempre recalculado no servidor a partir dos pagamentos reais, nunca
   * aceito do cliente — o dado que sustenta a divergência não pode vir
   * de quem está sendo conferido.
   */
  app.post<{ Params: { id: string } }>("/api/shifts/:id/close", async (req, reply) => {
    const body = parseBody(closeShiftBodySchema, req.body);
    const shift = getShift(ctx.db, req.params.id);
    if (!shift || shift.status !== "ABERTO") throw new ValidationError("Turno inexistente ou já fechado");

    const byMethod = sumPaymentsByMethodForShift(ctx.db, shift.id);
    const cashMovements = listCashMovements(ctx.db, shift.id);

    const expected: Record<string, number> = {};
    for (const { method, total_cents } of byMethod) expected[method] = total_cents;
    const cashAdjustments = cashMovements.reduce((sum, m) => {
      if (m.kind === "SUPRIMENTO" || m.kind === "TROCO_INICIAL") return sum + m.amount_cents;
      if (m.kind === "SANGRIA") return sum - m.amount_cents;
      return sum + m.amount_cents; // AJUSTE pode ser positivo ou negativo
    }, 0);
    expected.DINHEIRO = (expected.DINHEIRO ?? 0) + cashAdjustments;

    const nowMs = ctx.nowMs();
    closeShift(ctx.db, shift.id, body.employeeId, body.declared, expected, nowMs);

    const divergence: Record<string, number> = {};
    for (const method of new Set([...Object.keys(expected), ...Object.keys(body.declared)])) {
      divergence[method] = (body.declared[method] ?? 0) - (expected[method] ?? 0);
    }

    return reply.code(200).send({ expected, declared: body.declared, divergence });
  });
}
