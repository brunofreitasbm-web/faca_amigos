import { beforeEach, describe, expect, it } from "vitest";
import { quoteForSession } from "@facaamigos/domain";
import { openDatabase } from "../src/connection.js";
import { migrate } from "../src/migrate.js";
import { uuidv7 } from "../src/id.js";
import { insertUnit } from "../src/repositories/units.js";
import { insertEmployee } from "../src/repositories/employees.js";
import { insertGuardian, insertChild, linkChildGuardian, insertVisit, getVisitLog } from "../src/repositories/guardians-children.js";
import { insertPlan, getPlan } from "../src/repositories/plans.js";
import { insertSession, getSession, tryMarkAwaitingPayment, finalizeSession } from "../src/repositories/sessions.js";
import { createOrder, markOrderPaid, recordPayment, sumPaymentsByMethodForShift } from "../src/repositories/orders.js";
import { openShift, recordCashMovement, closeShift, getOpenShift } from "../src/repositories/shifts.js";
import { appendAuditLog, listAuditLog, verifyAuditChain } from "../src/repositories/audit.js";
import type { Db } from "../src/connection.js";

let db: Db;
const NOW = 1_700_000_000_000;

beforeEach(() => {
  db = openDatabase(":memory:");
  migrate(db);
});

describe("migrate", () => {
  it("aplica a migration inicial de forma idempotente", () => {
    const first = migrate(db);
    expect(first.applied).toEqual([]); // já aplicada no beforeEach
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    expect(tables.map((t) => t.name)).toContain("sessions");
  });
});

describe("fluxo completo: check-in até fechamento de turno", () => {
  it("cobra o excedente ao vivo e fecha o turno batendo os totais por método", () => {
    const unitId = uuidv7(NOW);
    insertUnit(db, { id: unitId, kind: "QUIOSQUE", name: "Quiosque Teste" }, NOW);

    const employeeId = uuidv7(NOW);
    insertEmployee(db, { id: employeeId, full_name: "Ana Operadora", role: "OPERADOR", pis: null, cpf_last4: null }, NOW);

    const guardianId = uuidv7(NOW);
    insertGuardian(db, { id: guardianId, full_name: "Maria Souza", phone_e164: "+5591982501215" }, NOW);
    const childId = uuidv7(NOW);
    insertChild(db, { id: childId, full_name: "Helena Souza", birth_date: "2019-04-12", inclusive_eligible: 0, inclusive_proof_type: null }, NOW);
    linkChildGuardian(db, childId, guardianId);

    const planId = uuidv7(NOW);
    insertPlan(
      db,
      unitId,
      { id: planId, activity: "CARRINHO", name: "15 minutos", valueCents: 3000, durationValue: 15, durationUnit: "MINUTO", overageCentsPerMinute: 100 },
      NOW,
    );

    const sessionId = uuidv7(NOW);
    insertSession(db, {
      id: sessionId,
      unit_id: unitId,
      activity: "CARRINHO",
      asset_id: null,
      plan_id: planId,
      child_id: childId,
      child_name_snapshot: "Helena Souza",
      guardian_id: guardianId,
      wristband_code: "FA1|W|abc|hash",
      ticket_code: "FA1|T|abc|hash",
      checkin_at_ms: NOW,
      checkin_by_employee_id: employeeId,
      coupon_id: null,
      coupon_discount_cents: 0,
      free_from_loyalty: 0,
      business_date: "2026-08-05",
    });

    insertVisit(db, uuidv7(NOW), childId, "CARRINHO", NOW);
    expect(getVisitLog(db, childId)).toEqual([{ atMs: NOW }]);

    // Check-out 18 minutos depois: 3 min de excedente a R$1,00 = R$3,00.
    const checkoutAtMs = NOW + 18 * 60_000;
    const plan = getPlan(db, planId)!;
    const session = getSession(db, sessionId)!;
    const quote = quoteForSession(plan, {
      checkinAtMs: session.checkin_at_ms,
      childName: session.child_name_snapshot,
      planId: session.plan_id,
      couponDiscountCents: session.coupon_discount_cents,
      couponCode: null,
      freeFromLoyalty: Boolean(session.free_from_loyalty),
    }, checkoutAtMs);

    expect(quote.totalCents).toBe(3300);

    expect(tryMarkAwaitingPayment(db, sessionId)).toBe(true);
    expect(tryMarkAwaitingPayment(db, sessionId)).toBe(false); // segundo terminal não consegue fechar de novo

    const shiftId = uuidv7(NOW);
    openShift(db, { id: shiftId, unitId, openedByEmployeeId: employeeId, openingCashCents: 10000, businessDate: "2026-08-05" }, NOW);
    recordCashMovement(db, { id: uuidv7(NOW), shiftId, kind: "TROCO_INICIAL", amountCents: 10000, employeeId }, NOW);

    const orderId = uuidv7(checkoutAtMs);
    createOrder(
      db,
      { id: orderId, unitId, shiftId, kind: "SESSAO", businessDate: "2026-08-05" },
      quote.lines.map((l) => ({
        itemType: "SESSAO" as const,
        itemNature: "SERVICO" as const,
        description: l.label,
        quantity: 1,
        unitPriceCents: l.cents,
        listUnitPriceCents: l.cents,
        totalCents: l.cents,
        sessionId,
      })),
      checkoutAtMs,
    );
    recordPayment(db, { id: uuidv7(checkoutAtMs), orderId, method: "PIX", amountCents: quote.totalCents }, checkoutAtMs);
    markOrderPaid(db, orderId, employeeId, checkoutAtMs);
    finalizeSession(db, sessionId, checkoutAtMs, orderId);

    expect(getSession(db, sessionId)!.status).toBe("FINALIZADA");

    const byMethod = sumPaymentsByMethodForShift(db, shiftId);
    expect(byMethod).toEqual([{ method: "PIX", total_cents: 3300 }]);

    // Fechamento não-cego: declarado bate com esperado (troco + vendas em dinheiro, que aqui é zero).
    const declared = { DINHEIRO: 10000 };
    const expected = { DINHEIRO: 10000, PIX: 3300 };
    closeShift(db, shiftId, employeeId, declared, expected, checkoutAtMs + 1000);
    expect(getOpenShift(db, unitId)).toBeUndefined();

    appendAuditLog(db, { employeeId, action: "shift.close", severity: "INFO", details: { shiftId } }, checkoutAtMs + 1000);
    appendAuditLog(db, { employeeId, action: "session.checkout", severity: "INFO", details: { sessionId } }, checkoutAtMs + 1001);
    const log = listAuditLog(db, 0, checkoutAtMs + 2000);
    expect(verifyAuditChain(log)).toBe(-1);
  });
});
