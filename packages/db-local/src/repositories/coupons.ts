import type { Db } from "../connection.js";

export interface CouponRow {
  id: string;
  unit_id: string;
  code: string;
  kind: "MINUTOS_EXTRA" | "DESCONTO_PCT" | "DESCONTO_VALOR";
  value: number;
  max_uses: number;
  used_count: number;
  active: 0 | 1;
  description: string | null;
  created_at_ms: number;
}

export function insertCoupon(db: Db, c: Omit<CouponRow, "created_at_ms" | "used_count" | "active">, nowMs: number): void {
  db.prepare(
    `INSERT INTO coupons (id, unit_id, code, kind, value, max_uses, used_count, active, description, created_at_ms)
     VALUES (@id, @unit_id, @code, @kind, @value, @max_uses, 0, 1, @description, @created_at_ms)`,
  ).run({ ...c, created_at_ms: nowMs });
}

export function findActiveCoupon(db: Db, unitId: string, code: string): CouponRow | undefined {
  return db
    .prepare(
      `SELECT * FROM coupons WHERE unit_id = ? AND code = ? AND active = 1 AND (max_uses = 0 OR used_count < max_uses)`,
    )
    .get(unitId, code) as unknown as CouponRow | undefined;
}

/** Incrementa uso só se ainda houver saldo — evita corrida entre dois check-ins simultâneos no limite do cupom. */
export function tryConsumeCoupon(db: Db, id: string): boolean {
  const result = db
    .prepare("UPDATE coupons SET used_count = used_count + 1 WHERE id = ? AND (max_uses = 0 OR used_count < max_uses)")
    .run(id);
  return result.changes > 0;
}

export function listCoupons(db: Db, unitId: string): CouponRow[] {
  return db.prepare("SELECT * FROM coupons WHERE unit_id = ? ORDER BY code").all(unitId) as unknown as CouponRow[];
}
