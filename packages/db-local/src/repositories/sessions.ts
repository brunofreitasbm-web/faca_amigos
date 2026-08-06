import type { Db } from "../connection.js";
import { uuidv7 } from "../id.js";

export type SessionStatus = "ATIVA" | "AGUARDANDO_PAGAMENTO" | "FINALIZADA";

export interface SessionRow {
  id: string;
  unit_id: string;
  activity: "PLAYGROUND" | "CARRINHO";
  asset_id: string | null;
  plan_id: string;
  child_id: string;
  child_name_snapshot: string;
  guardian_id: string;
  wristband_code: string;
  ticket_code: string;
  checkin_at_ms: number;
  checkin_by_employee_id: string | null;
  checkout_at_ms: number | null;
  status: SessionStatus;
  coupon_id: string | null;
  coupon_discount_cents: number;
  free_from_loyalty: 0 | 1;
  order_id: string | null;
  business_date: string;
}

export function insertSession(db: Db, s: Omit<SessionRow, "checkout_at_ms" | "status" | "order_id">): void {
  db.prepare(
    `INSERT INTO sessions (id, unit_id, activity, asset_id, plan_id, child_id, child_name_snapshot, guardian_id,
       wristband_code, ticket_code, checkin_at_ms, checkin_by_employee_id, checkout_at_ms,
       status, coupon_id, coupon_discount_cents, free_from_loyalty, order_id, business_date)
     VALUES (@id, @unit_id, @activity, @asset_id, @plan_id, @child_id, @child_name_snapshot, @guardian_id,
       @wristband_code, @ticket_code, @checkin_at_ms, @checkin_by_employee_id, NULL,
       'ATIVA', @coupon_id, @coupon_discount_cents, @free_from_loyalty, NULL, @business_date)`,
  ).run(s);

  insertSessionEvent(db, { sessionId: s.id, kind: "CHECKIN", atMs: s.checkin_at_ms, employeeId: s.checkin_by_employee_id });
}

export function getSession(db: Db, id: string): SessionRow | undefined {
  return db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as unknown as SessionRow | undefined;
}

export function listActiveSessions(db: Db, unitId: string): SessionRow[] {
  return db
    .prepare("SELECT * FROM sessions WHERE unit_id = ? AND status = 'ATIVA' ORDER BY checkin_at_ms")
    .all(unitId) as unknown as SessionRow[];
}

/** Favoritagem de equipamento: último carrinho que esta criança usou, para sugerir de novo no check-in. */
export function getLastAssetIdForChild(db: Db, childId: string): string | null {
  const row = db
    .prepare(
      `SELECT asset_id FROM sessions
       WHERE child_id = ? AND activity = 'CARRINHO' AND asset_id IS NOT NULL
       ORDER BY checkin_at_ms DESC LIMIT 1`,
    )
    .get(childId) as { asset_id: string } | undefined;
  return row?.asset_id ?? null;
}

/**
 * Transição condicional (seção 5.2 do plano): só sai de ATIVA se ainda
 * estiver ATIVA no momento exato do UPDATE. `changes === 0` sinaliza
 * que outro terminal já fechou — quem chama deve tratar como 409, não
 * como sucesso silencioso.
 */
export function tryMarkAwaitingPayment(db: Db, id: string): boolean {
  const result = db.prepare("UPDATE sessions SET status = 'AGUARDANDO_PAGAMENTO' WHERE id = ? AND status = 'ATIVA'").run(id);
  return result.changes > 0;
}

export function finalizeSession(db: Db, id: string, checkoutAtMs: number, orderId: string): void {
  db.prepare("UPDATE sessions SET status = 'FINALIZADA', checkout_at_ms = ?, order_id = ? WHERE id = ?").run(
    checkoutAtMs,
    orderId,
    id,
  );
  insertSessionEvent(db, { sessionId: id, kind: "CHECKOUT", atMs: checkoutAtMs, employeeId: null });
}

/** Reverte a sessão para ATIVA se o pagamento for cancelado no meio do fechamento. */
export function revertToActive(db: Db, id: string): void {
  db.prepare("UPDATE sessions SET status = 'ATIVA' WHERE id = ? AND status = 'AGUARDANDO_PAGAMENTO'").run(id);
}

/** Troca o plano de uma sessão ainda ativa (ex: família decide estender/reduzir o tempo). */
export function changeSessionPlan(db: Db, id: string, planId: string): boolean {
  const result = db.prepare("UPDATE sessions SET plan_id = ? WHERE id = ? AND status = 'ATIVA'").run(planId, id);
  return result.changes > 0;
}

export function insertSessionEvent(
  db: Db,
  e: { sessionId: string; kind: string; atMs: number; employeeId: string | null; payload?: unknown },
): void {
  db.prepare(
    `INSERT INTO session_events (id, session_id, kind, at_ms, employee_id, payload_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(uuidv7(e.atMs), e.sessionId, e.kind, e.atMs, e.employeeId, e.payload ? JSON.stringify(e.payload) : null);
}

export function listSessionEvents(db: Db, sessionId: string): { kind: string; at_ms: number }[] {
  return db.prepare("SELECT kind, at_ms FROM session_events WHERE session_id = ? ORDER BY at_ms").all(sessionId) as unknown as {
    kind: string;
    at_ms: number;
  }[];
}
