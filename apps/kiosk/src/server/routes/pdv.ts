import type { FastifyInstance } from "fastify";
import {
  getProduct,
  tryDecrementStock,
  getOpenShift,
  createOrder,
  recordPayment,
  markOrderPaid,
  uuidv7,
  withTransaction,
  type OrderItemInput,
} from "@facaamigos/db-local";
import type { AppContext } from "../context.js";
import { pdvOrderBodySchema } from "../schemas.js";
import { parseBody, ConflictError, ValidationError } from "../validate.js";

export function registerPdvRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post("/api/pdv/orders", async (req, reply) => {
    const body = parseBody(pdvOrderBodySchema, req.body);
    const nowMs = ctx.nowMs();

    const shift = getOpenShift(ctx.db, body.unitId);
    if (!shift) throw new ValidationError("Não há turno aberto nesta unidade");

    const items: OrderItemInput[] = [];
    let totalCents = 0;
    for (const line of body.items) {
      const product = getProduct(ctx.db, line.productId);
      if (!product) throw new ValidationError(`Produto ${line.productId} não encontrado`);
      const lineTotal = product.price_cents * line.quantity;
      totalCents += lineTotal;
      items.push({
        itemType: "PRODUTO",
        itemNature: "PRODUTO",
        description: product.name,
        quantity: line.quantity,
        unitPriceCents: product.price_cents,
        listUnitPriceCents: product.price_cents,
        totalCents: lineTotal,
        productId: product.id,
      });
    }

    const paymentsTotal = body.payments.reduce((sum, p) => sum + p.amountCents, 0);
    if (paymentsTotal !== totalCents) {
      throw new ValidationError(`Soma dos pagamentos (${paymentsTotal}) não bate com o total (${totalCents})`);
    }

    const orderId = uuidv7(nowMs);

    withTransaction(ctx.db, () => {
      for (const line of body.items) {
        if (!tryDecrementStock(ctx.db, line.productId, line.quantity, orderId, nowMs)) {
          throw new ConflictError("Estoque insuficiente", { productId: line.productId });
        }
      }
      createOrder(ctx.db, { id: orderId, unitId: body.unitId, shiftId: shift.id, kind: "PDV", businessDate: shift.business_date }, items, nowMs);
      for (const payment of body.payments) {
        recordPayment(ctx.db, { id: uuidv7(nowMs), orderId, ...payment }, nowMs);
      }
      markOrderPaid(ctx.db, orderId, body.employeeId, nowMs);
    });

    return reply.code(200).send({ orderId, totalCents });
  });
}
