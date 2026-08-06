import type { Role } from "@facaamigos/domain";
import type { Db } from "../connection.js";

export interface EmployeeRow {
  id: string;
  full_name: string;
  role: Role;
  pis: string | null;
  cpf_last4: string | null;
  active: 0 | 1;
  created_at_ms: number;
}

export function insertEmployee(db: Db, e: Omit<EmployeeRow, "created_at_ms" | "active">, nowMs: number): void {
  db.prepare(
    `INSERT INTO employees (id, full_name, role, pis, cpf_last4, active, created_at_ms)
     VALUES (@id, @full_name, @role, @pis, @cpf_last4, 1, @created_at_ms)`,
  ).run({ ...e, created_at_ms: nowMs });
}

export function listEmployees(db: Db, opts: { activeOnly?: boolean } = {}): EmployeeRow[] {
  const sql = opts.activeOnly
    ? "SELECT * FROM employees WHERE active = 1 ORDER BY full_name"
    : "SELECT * FROM employees ORDER BY full_name";
  return db.prepare(sql).all() as unknown as EmployeeRow[];
}

export function getEmployee(db: Db, id: string): EmployeeRow | undefined {
  return db.prepare("SELECT * FROM employees WHERE id = ?").get(id) as unknown as EmployeeRow | undefined;
}

export function setEmployeeActive(db: Db, id: string, active: boolean): void {
  db.prepare("UPDATE employees SET active = ? WHERE id = ?").run(active ? 1 : 0, id);
}

export function upsertLocalCredentials(
  db: Db,
  employeeId: string,
  pinHash: string,
  nowMs: number,
): void {
  db.prepare(
    `INSERT INTO local_credentials (employee_id, pin_hash, must_change, created_at_ms)
     VALUES (?, ?, 0, ?)
     ON CONFLICT (employee_id) DO UPDATE SET pin_hash = excluded.pin_hash`,
  ).run(employeeId, pinHash, nowMs);
}

export function getPinHash(db: Db, employeeId: string): string | undefined {
  const row = db.prepare("SELECT pin_hash FROM local_credentials WHERE employee_id = ?").get(employeeId) as
    | { pin_hash: string }
    | undefined;
  return row?.pin_hash;
}
