import type { Db } from "../connection.js";

export type PontoKind = "ENTRADA" | "SAIDA" | "INTERVALO_INICIO" | "INTERVALO_FIM";

export interface PontoRecordRow {
  id: string;
  employee_id: string;
  unit_id: string;
  kind: PontoKind;
  nsr: number;
  at_ms: number;
  registered_by_employee_id: string | null;
}

function nextNsr(db: Db): number {
  const row = db.prepare("SELECT MAX(nsr) AS max_nsr FROM ponto_records").get() as unknown as { max_nsr: number | null };
  return (row.max_nsr ?? 0) + 1;
}

/** Sem endpoint de exclusão por desenho (Portaria MTP 671/2021) — correção é sempre um novo registro com NSR próprio. */
export function registerPonto(
  db: Db,
  p: { id: string; employeeId: string; unitId: string; kind: PontoKind; registeredByEmployeeId?: string },
  nowMs: number,
): number {
  const nsr = nextNsr(db);
  db.prepare(
    `INSERT INTO ponto_records (id, employee_id, unit_id, kind, nsr, at_ms, registered_by_employee_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(p.id, p.employeeId, p.unitId, p.kind, nsr, nowMs, p.registeredByEmployeeId ?? p.employeeId);
  return nsr;
}

export function listPontoByEmployee(db: Db, employeeId: string, fromMs: number, toMs: number): PontoRecordRow[] {
  return db
    .prepare("SELECT * FROM ponto_records WHERE employee_id = ? AND at_ms BETWEEN ? AND ? ORDER BY at_ms")
    .all(employeeId, fromMs, toMs) as unknown as PontoRecordRow[];
}

export function lastPontoOfDay(db: Db, employeeId: string, dayStartMs: number, dayEndMs: number): PontoRecordRow | undefined {
  return db
    .prepare("SELECT * FROM ponto_records WHERE employee_id = ? AND at_ms BETWEEN ? AND ? ORDER BY at_ms DESC LIMIT 1")
    .get(employeeId, dayStartMs, dayEndMs) as unknown as PontoRecordRow | undefined;
}
