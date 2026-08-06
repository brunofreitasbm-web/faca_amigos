import type { Db } from "../connection.js";
import { uuidv7 } from "../id.js";

export type OrderStatus = "ABERTA" | "PAGA" | "CANCELADA";
export type PaymentMethod = "DINHEIRO" | "PIX" | "CREDITO" | "DEBITO" | "VOUCHER";

export interface OrderRow {
  id: string;
  unit_id: string;
  shift_id: string | null;
  kind: "SESSAO" | "PDV";
  total_cents: number;
  status: OrderStatus;
  closed_by_employee_id: string | null;
  closed_at_ms: number | null;
  business_date: string;
  created_at_ms: number;
}

export interface OrderItemInput {
  itemType: "SESSAO" | "PRODUTO";
  itemNature: "SERVICO" | "PRODUTO";
  description: string;
  quantity: number;
  unitPriceCents: number;
  listUnitPriceCents: number;
  totalCents: number;
  productId?: string | null;
  sessionId?: string | null;
}

export function createOrder(
  db: Db,
  order: { id: string; unitId: string; shiftId: string | null; kind: "SESSAO" | "PDV"; businessDate: string },
  items: OrderItemInput[],
  nowMs: number,
): void {
  const totalCents = items.reduce((sum, i) => sum + i.totalCents, 0);

  db.prepare(
    `INSERT INTO orders (id, unit_id, shift_id, kind, total_cents, status, business_date, created_at_ms)
     VALUES (?, ?, ?, ?, ?, 'ABERTA', ?, ?)`,
  ).run(order.id, order.unitId, order.shiftId, order.kind, totalCents, order.businessDate, nowMs);

  const insertItem = db.prepare(
    `INSERT INTO order_items (id, order_id, item_type, item_nature, description, quantity, unit_price_cents, list_unit_price_cents, total_cents, product_id, session_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const item of items) {
    insertItem.run(
      uuidv7(nowMs),
      order.id,
      item.itemType,
      item.itemNature,
      item.description,
      item.quantity,
      item.unitPriceCents,
      item.listUnitPriceCents,
      item.totalCents,
      item.productId ?? null,
      item.sessionId ?? null,
    );
  }
}

export function getOrder(db: Db, id: string): OrderRow | undefined {
  return db.prepare("SELECT * FROM orders WHERE id = ?").get(id) as unknown as OrderRow | undefined;
}

export function markOrderPaid(db: Db, id: string, employeeId: string, nowMs: number): void {
  db.prepare("UPDATE orders SET status = 'PAGA', closed_by_employee_id = ?, closed_at_ms = ? WHERE id = ?").run(
    employeeId,
    nowMs,
    id,
  );
}

export function recordPayment(
  db: Db,
  p: { id: string; orderId: string; method: PaymentMethod; amountCents: number; nsu?: string; authorization?: string; pixTxid?: string },
  nowMs: number,
): void {
  db.prepare(
    `INSERT INTO payments (id, order_id, method, amount_cents, nsu, authorization, pix_txid, created_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(p.id, p.orderId, p.method, p.amountCents, p.nsu ?? null, p.authorization ?? null, p.pixTxid ?? null, nowMs);
}

export function listPaymentsByOrder(db: Db, orderId: string): { method: PaymentMethod; amount_cents: number }[] {
  return db.prepare("SELECT method, amount_cents FROM payments WHERE order_id = ?").all(orderId) as unknown as {
    method: PaymentMethod;
    amount_cents: number;
  }[];
}

/** Faturamento do turno por método — base do fechamento não-cego (seção Caixa). */
export function sumPaymentsByMethodForShift(db: Db, shiftId: string): { method: PaymentMethod; total_cents: number }[] {
  return db
    .prepare(
      `SELECT p.method AS method, SUM(p.amount_cents) AS total_cents
       FROM payments p
       JOIN orders o ON o.id = p.order_id
       WHERE o.shift_id = ? AND o.status = 'PAGA'
       GROUP BY p.method`,
    )
    .all(shiftId) as unknown as { method: PaymentMethod; total_cents: number }[];
}
