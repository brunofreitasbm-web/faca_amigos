import type { Db } from "../connection.js";

export type AssetStatus = "DISPONIVEL" | "EM_USO" | "MANUTENCAO";

export interface AssetRow {
  id: string;
  unit_id: string;
  name: string;
  emoji: string;
  color: string;
  status: AssetStatus;
  odometer_minutes: number;
  maintenance_threshold_hours: number;
  created_at_ms: number;
}

export function insertAsset(db: Db, a: Omit<AssetRow, "created_at_ms" | "status" | "odometer_minutes">, nowMs: number): void {
  db.prepare(
    `INSERT INTO assets (id, unit_id, name, emoji, color, status, odometer_minutes, maintenance_threshold_hours, created_at_ms)
     VALUES (@id, @unit_id, @name, @emoji, @color, 'DISPONIVEL', 0, @maintenance_threshold_hours, @created_at_ms)`,
  ).run({ ...a, created_at_ms: nowMs });
}

export function listAssets(db: Db, unitId: string): AssetRow[] {
  return db.prepare("SELECT * FROM assets WHERE unit_id = ? ORDER BY name").all(unitId) as unknown as AssetRow[];
}

export function getAsset(db: Db, id: string): AssetRow | undefined {
  return db.prepare("SELECT * FROM assets WHERE id = ?").get(id) as unknown as AssetRow | undefined;
}

/**
 * Aloca o carrinho só se ele seguir DISPONIVEL no momento exato do
 * UPDATE (seção 5.2 do plano — mesma técnica do lock condicional de
 * sessions, para dois terminais não alocarem o mesmo carrinho).
 */
export function tryAllocateAsset(db: Db, id: string): boolean {
  const result = db.prepare("UPDATE assets SET status = 'EM_USO' WHERE id = ? AND status = 'DISPONIVEL'").run(id);
  return result.changes > 0;
}

export function releaseAsset(db: Db, id: string, usedMinutes: number): void {
  const row = getAsset(db, id);
  if (!row) return;
  const newOdometer = row.odometer_minutes + usedMinutes;
  const newStatus: AssetStatus = newOdometer / 60 >= row.maintenance_threshold_hours ? "MANUTENCAO" : "DISPONIVEL";
  db.prepare("UPDATE assets SET odometer_minutes = ?, status = ? WHERE id = ?").run(newOdometer, newStatus, id);
}

export function setAssetStatus(db: Db, id: string, status: AssetStatus): void {
  db.prepare("UPDATE assets SET status = ? WHERE id = ?").run(status, id);
}
