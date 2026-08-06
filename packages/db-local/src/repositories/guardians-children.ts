import type { Db } from "../connection.js";

export interface GuardianRow {
  id: string;
  full_name: string;
  phone_e164: string;
  cpf: string | null;
  created_at_ms: number;
}

export interface ChildRow {
  id: string;
  full_name: string;
  birth_date: string;
  inclusive_eligible: 0 | 1;
  inclusive_proof_type: string | null;
  created_at_ms: number;
}

export function findGuardianByPhone(db: Db, phoneE164: string): GuardianRow | undefined {
  return db.prepare("SELECT * FROM guardians WHERE phone_e164 = ?").get(phoneE164) as unknown as GuardianRow | undefined;
}

export function findGuardianByCpf(db: Db, cpf: string): GuardianRow | undefined {
  return db.prepare("SELECT * FROM guardians WHERE cpf = ?").get(cpf) as unknown as GuardianRow | undefined;
}

export function insertGuardian(
  db: Db,
  g: Omit<GuardianRow, "created_at_ms" | "cpf"> & { cpf?: string | null },
  nowMs: number,
): void {
  db.prepare(
    `INSERT INTO guardians (id, full_name, phone_e164, cpf, created_at_ms) VALUES (@id, @full_name, @phone_e164, @cpf, @created_at_ms)`,
  ).run({ ...g, cpf: g.cpf ?? null, created_at_ms: nowMs });
}

export function insertChild(db: Db, c: Omit<ChildRow, "created_at_ms">, nowMs: number): void {
  db.prepare(
    `INSERT INTO children (id, full_name, birth_date, inclusive_eligible, inclusive_proof_type, created_at_ms)
     VALUES (@id, @full_name, @birth_date, @inclusive_eligible, @inclusive_proof_type, @created_at_ms)`,
  ).run({ ...c, created_at_ms: nowMs });
}

export function linkChildGuardian(db: Db, childId: string, guardianId: string, isAuthorizedPickup = true): void {
  db.prepare(
    `INSERT OR IGNORE INTO child_guardians (child_id, guardian_id, is_authorized_pickup) VALUES (?, ?, ?)`,
  ).run(childId, guardianId, isAuthorizedPickup ? 1 : 0);
}

export function getChild(db: Db, id: string): ChildRow | undefined {
  return db.prepare("SELECT * FROM children WHERE id = ?").get(id) as unknown as ChildRow | undefined;
}

export function getGuardian(db: Db, id: string): GuardianRow | undefined {
  return db.prepare("SELECT * FROM guardians WHERE id = ?").get(id) as unknown as GuardianRow | undefined;
}

/**
 * Autocomplete de match ao vivo na Entrada: filtra crianças cujo nome
 * bate, junto do telefone do responsável associado, para o operador
 * digitar o mínimo possível.
 */
export function searchChildrenByNameOrPhone(
  db: Db,
  query: string,
  limit = 10,
): (ChildRow & { phone_e164: string | null; guardian_name: string | null; cpf: string | null })[] {
  const like = `%${query}%`;
  return db
    .prepare(
      `SELECT c.*, g.phone_e164 AS phone_e164, g.full_name AS guardian_name, g.cpf AS cpf
       FROM children c
       LEFT JOIN child_guardians cg ON cg.child_id = c.id
       LEFT JOIN guardians g ON g.id = cg.guardian_id
       WHERE c.full_name LIKE ? OR g.phone_e164 LIKE ? OR g.cpf LIKE ? OR g.full_name LIKE ?
       GROUP BY c.id
       ORDER BY c.full_name
       LIMIT ?`,
    )
    .all(like, like, like, like, limit) as unknown as (ChildRow & {
    phone_e164: string | null;
    guardian_name: string | null;
    cpf: string | null;
  })[];
}

export function insertVisit(db: Db, id: string, childId: string, activity: "PLAYGROUND" | "CARRINHO", atMs: number): void {
  db.prepare(`INSERT INTO visit_log (id, child_id, activity, at_ms) VALUES (?, ?, ?, ?)`).run(id, childId, activity, atMs);
}

export function getVisitLog(db: Db, childId: string): { atMs: number }[] {
  return (db.prepare("SELECT at_ms FROM visit_log WHERE child_id = ? ORDER BY at_ms").all(childId) as unknown as { at_ms: number }[]).map(
    (r) => ({ atMs: r.at_ms }),
  );
}
