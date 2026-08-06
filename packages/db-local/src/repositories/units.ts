import type { Db } from "../connection.js";

export interface UnitRow {
  id: string;
  kind: "LOJA" | "QUIOSQUE";
  name: string;
  timezone: string;
  business_day_cutoff_hour: number;
  created_at_ms: number;
}

export function insertUnit(
  db: Db,
  unit: Pick<UnitRow, "id" | "kind" | "name"> & Partial<Pick<UnitRow, "timezone" | "business_day_cutoff_hour">>,
  nowMs: number,
): void {
  db.prepare(
    `INSERT INTO units (id, kind, name, timezone, business_day_cutoff_hour, created_at_ms)
     VALUES (@id, @kind, @name, @timezone, @business_day_cutoff_hour, @created_at_ms)`,
  ).run({
    timezone: "America/Belem",
    business_day_cutoff_hour: 4,
    ...unit,
    created_at_ms: nowMs,
  });
}

export function listUnits(db: Db): UnitRow[] {
  return db.prepare("SELECT * FROM units ORDER BY name").all() as unknown as UnitRow[];
}

export function getUnit(db: Db, id: string): UnitRow | undefined {
  return db.prepare("SELECT * FROM units WHERE id = ?").get(id) as unknown as UnitRow | undefined;
}

export function getAppSetting(db: Db, unitId: string, key: string): string | undefined {
  const row = db.prepare("SELECT value FROM app_settings WHERE unit_id = ? AND key = ?").get(unitId, key) as
    | { value: string }
    | undefined;
  return row?.value;
}

export function setAppSetting(db: Db, unitId: string, key: string, value: string, nowMs: number): void {
  db.prepare(
    `INSERT INTO app_settings (unit_id, key, value, updated_at_ms) VALUES (?, ?, ?, ?)
     ON CONFLICT (unit_id, key) DO UPDATE SET value = excluded.value, updated_at_ms = excluded.updated_at_ms`,
  ).run(unitId, key, value, nowMs);
}
