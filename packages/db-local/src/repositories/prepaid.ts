import type { Db } from "../connection.js";
import { withTransaction } from "../connection.js";
import { uuidv7 } from "../id.js";

export interface PrepaidPackageRecord {

  id: string;
  unitId: string;
  guardianId: string;
  childId?: string | null;
  planName: string;
  totalMinutes: number;
  remainingMinutes: number;
  amountCents: number;
  expiresAtMs?: number | null;
  status: "ATIVO" | "ESGOTADO" | "EXPIRADO" | "CANCELADO";
  orderId?: string | null;
  createdAtMs: number;
}

export interface PrepaidLedgerRecord {
  id: string;
  packageId: string;
  sessionId?: string | null;
  deltaMinutes: number;
  balanceAfter: number;
  reason: "COMPRA_INICIAL" | "USO_SESSAO" | "AJUSTE_MANUAL" | "ESTORNO";
  employeeId?: string | null;
  atMs: number;
}

interface PackageRow {
  id: string;
  unit_id: string;
  guardian_id: string;
  child_id: string | null;
  plan_name: string;
  total_minutes: number;
  remaining_minutes: number;
  amount_cents: number;
  expires_at_ms: number | null;
  status: "ATIVO" | "ESGOTADO" | "EXPIRADO" | "CANCELADO";
  order_id: string | null;
  created_at_ms: number;
}

function toDomainPackage(row: PackageRow): PrepaidPackageRecord {
  return {
    id: row.id,
    unitId: row.unit_id,
    guardianId: row.guardian_id,
    childId: row.child_id,
    planName: row.plan_name,
    totalMinutes: row.total_minutes,
    remainingMinutes: row.remaining_minutes,
    amountCents: row.amount_cents,
    expiresAtMs: row.expires_at_ms,
    status: row.status,
    orderId: row.order_id,
    createdAtMs: row.created_at_ms,
  };
}

export function createPrepaidPackage(
  db: Db,
  params: {
    unitId: string;
    guardianId: string;
    childId?: string | null;
    planName: string;
    totalMinutes: number;
    amountCents: number;
    expiresAtMs?: number | null;
    orderId?: string | null;
    employeeId?: string | null;
  },
  nowMs: number = Date.now(),
): PrepaidPackageRecord {
  const packageId = uuidv7(nowMs);
  const ledgerId = uuidv7(nowMs);


  withTransaction(db, () => {
    db.prepare(
      `INSERT INTO prepaid_packages 
        (id, unit_id, guardian_id, child_id, plan_name, total_minutes, remaining_minutes, amount_cents, expires_at_ms, status, order_id, created_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ATIVO', ?, ?)`,
    ).run(
      packageId,
      params.unitId,
      params.guardianId,
      params.childId ?? null,
      params.planName,
      params.totalMinutes,
      params.totalMinutes,
      params.amountCents,
      params.expiresAtMs ?? null,
      params.orderId ?? null,
      nowMs,
    );

    db.prepare(
      `INSERT INTO prepaid_ledger
        (id, package_id, session_id, delta_minutes, balance_after, reason, employee_id, at_ms)
       VALUES (?, ?, NULL, ?, ?, 'COMPRA_INICIAL', ?, ?)`,
    ).run(ledgerId, packageId, params.totalMinutes, params.totalMinutes, params.employeeId ?? null, nowMs);
  });

  return {
    id: packageId,
    unitId: params.unitId,
    guardianId: params.guardianId,
    childId: params.childId ?? null,
    planName: params.planName,
    totalMinutes: params.totalMinutes,
    remainingMinutes: params.totalMinutes,
    amountCents: params.amountCents,
    expiresAtMs: params.expiresAtMs ?? null,
    status: "ATIVO",
    orderId: params.orderId ?? null,
    createdAtMs: nowMs,
  };
}

export function listActivePrepaidPackages(
  db: Db,
  guardianId: string,
  childId?: string | null,
): PrepaidPackageRecord[] {
  let query = "SELECT * FROM prepaid_packages WHERE guardian_id = ? AND status = 'ATIVO'";
  const args: any[] = [guardianId];

  if (childId) {
    query += " AND (child_id IS NULL OR child_id = ?)";
    args.push(childId);
  }

  query += " ORDER BY created_at_ms ASC";

  const rows = db.prepare(query).all(...args) as unknown as PackageRow[];
  return rows.map(toDomainPackage);
}

export function getTotalRemainingPrepaidMinutes(
  db: Db,
  guardianId: string,
  childId?: string | null,
): number {
  const pkgs = listActivePrepaidPackages(db, guardianId, childId);
  return pkgs.reduce((acc, p) => acc + p.remainingMinutes, 0);
}

export function deductMinutesFromPrepaid(
  db: Db,
  params: {
    guardianId: string;
    childId?: string | null;
    sessionId?: string | null;
    minutesToDeduct: number;
    employeeId?: string | null;
  },
  nowMs: number = Date.now(),
): { minutesDeducted: number; minutesRemainingInPackage: number; remainingExcessMinutes: number } {
  const pkgs = listActivePrepaidPackages(db, params.guardianId, params.childId);

  let needed = params.minutesToDeduct;
  let totalDeducted = 0;
  let lastPackageRemaining = 0;

  withTransaction(db, () => {
    for (const pkg of pkgs) {
      if (needed <= 0) break;

      const take = Math.min(pkg.remainingMinutes, needed);
      const newBalance = pkg.remainingMinutes - take;
      const newStatus = newBalance === 0 ? "ESGOTADO" : "ATIVO";

      db.prepare(
        "UPDATE prepaid_packages SET remaining_minutes = ?, status = ? WHERE id = ?",
      ).run(newBalance, newStatus, pkg.id);

      const ledgerId = uuidv7(nowMs);
      db.prepare(
        `INSERT INTO prepaid_ledger
          (id, package_id, session_id, delta_minutes, balance_after, reason, employee_id, at_ms)
         VALUES (?, ?, ?, ?, ?, 'USO_SESSAO', ?, ?)`,
      ).run(ledgerId, pkg.id, params.sessionId ?? null, -take, newBalance, params.employeeId ?? null, nowMs);


      needed -= take;
      totalDeducted += take;
      lastPackageRemaining = newBalance;
    }
  });

  return {
    minutesDeducted: totalDeducted,
    minutesRemainingInPackage: lastPackageRemaining,
    remainingExcessMinutes: needed,
  };
}
