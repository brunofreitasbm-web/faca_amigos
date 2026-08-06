import type { Db } from "../connection.js";

export type ShiftStatus = "ABERTO" | "FECHADO";

export interface ShiftRow {
  id: string;
  unit_id: string;
  opened_by_employee_id: string;
  opened_at_ms: number;
  opening_cash_cents: number;
  status: ShiftStatus;
  closed_by_employee_id: string | null;
  closed_at_ms: number | null;
  declared_json: string | null;
  expected_json: string | null;
  business_date: string;
}

export function openShift(
  db: Db,
  s: { id: string; unitId: string; openedByEmployeeId: string; openingCashCents: number; businessDate: string },
  nowMs: number,
): void {
  db.prepare(
    `INSERT INTO shifts (id, unit_id, opened_by_employee_id, opened_at_ms, opening_cash_cents, status, business_date)
     VALUES (?, ?, ?, ?, ?, 'ABERTO', ?)`,
  ).run(s.id, s.unitId, s.openedByEmployeeId, nowMs, s.openingCashCents, s.businessDate);
}

export function getOpenShift(db: Db, unitId: string): ShiftRow | undefined {
  return db.prepare("SELECT * FROM shifts WHERE unit_id = ? AND status = 'ABERTO'").get(unitId) as unknown as ShiftRow | undefined;
}

export function getShift(db: Db, id: string): ShiftRow | undefined {
  return db.prepare("SELECT * FROM shifts WHERE id = ?").get(id) as unknown as ShiftRow | undefined;
}

/**
 * Fechamento não-cego (decisão do produto — diferente da seção 7.2 do
 * plano, que previa fechamento cego para gaveta eletrônica; aqui não
 * há gaveta, então o declarado já é digitado vendo o esperado). Grava
 * os dois lados para o relatório de divergência por método.
 */
export function closeShift(
  db: Db,
  id: string,
  closedByEmployeeId: string,
  declared: Record<string, number>,
  expected: Record<string, number>,
  nowMs: number,
): void {
  db.prepare(
    `UPDATE shifts SET status = 'FECHADO', closed_by_employee_id = ?, closed_at_ms = ?, declared_json = ?, expected_json = ?
     WHERE id = ? AND status = 'ABERTO'`,
  ).run(closedByEmployeeId, nowMs, JSON.stringify(declared), JSON.stringify(expected), id);
}

export function recordCashMovement(
  db: Db,
  m: { id: string; shiftId: string; kind: "TROCO_INICIAL" | "SANGRIA" | "SUPRIMENTO" | "AJUSTE"; amountCents: number; reason?: string; employeeId: string },
  nowMs: number,
): void {
  db.prepare(
    `INSERT INTO cash_movements (id, shift_id, kind, amount_cents, reason, employee_id, at_ms) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(m.id, m.shiftId, m.kind, m.amountCents, m.reason ?? null, m.employeeId, nowMs);
}

export function listCashMovements(db: Db, shiftId: string): { kind: string; amount_cents: number; reason: string | null }[] {
  return db.prepare("SELECT kind, amount_cents, reason FROM cash_movements WHERE shift_id = ?").all(shiftId) as unknown as {
    kind: string;
    amount_cents: number;
    reason: string | null;
  }[];
}
