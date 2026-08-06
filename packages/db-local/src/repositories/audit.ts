import { createHash } from "node:crypto";
import type { Db } from "../connection.js";
import { uuidv7 } from "../id.js";

/**
 * Log encadeado por hash (seção 9.3 do plano): cada linha inclui o
 * hash da anterior, tornando adulteração retroativa detectável (uma
 * linha editada quebra a cadeia a partir dali).
 */
export function appendAuditLog(
  db: Db,
  entry: { employeeId: string | null; action: string; severity: "INFO" | "ALERTA"; details?: unknown },
  nowMs: number,
): void {
  const last = db.prepare("SELECT self_hash FROM audit_log ORDER BY at_ms DESC LIMIT 1").get() as
    | { self_hash: string }
    | undefined;
  const prevHash = last?.self_hash ?? null;
  const detailsJson = entry.details ? JSON.stringify(entry.details) : null;
  const id = uuidv7(nowMs);

  const selfHash = createHash("sha256")
    .update(`${id}|${nowMs}|${entry.employeeId ?? ""}|${entry.action}|${entry.severity}|${detailsJson ?? ""}|${prevHash ?? ""}`)
    .digest("hex");

  db.prepare(
    `INSERT INTO audit_log (id, at_ms, employee_id, action, severity, details_json, prev_hash, self_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, nowMs, entry.employeeId, entry.action, entry.severity, detailsJson, prevHash, selfHash);
}

export interface AuditLogRow {
  id: string;
  at_ms: number;
  employee_id: string | null;
  action: string;
  severity: "INFO" | "ALERTA";
  details_json: string | null;
  prev_hash: string | null;
  self_hash: string;
}

export function listAuditLog(db: Db, fromMs: number, toMs: number): AuditLogRow[] {
  return db.prepare("SELECT * FROM audit_log WHERE at_ms BETWEEN ? AND ? ORDER BY at_ms").all(fromMs, toMs) as unknown as AuditLogRow[];
}

/** Reconfirma a cadeia — usado no relatório de auditoria e em testes. Devolve o índice da primeira quebra, ou -1 se íntegra. */
export function verifyAuditChain(rows: readonly AuditLogRow[]): number {
  let prevHash: string | null = null;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (row.prev_hash !== prevHash) return i;
    const expected: string = createHash("sha256")
      .update(`${row.id}|${row.at_ms}|${row.employee_id ?? ""}|${row.action}|${row.severity}|${row.details_json ?? ""}|${row.prev_hash ?? ""}`)
      .digest("hex");
    if (expected !== row.self_hash) return i;
    prevHash = row.self_hash;
  }
  return -1;
}
