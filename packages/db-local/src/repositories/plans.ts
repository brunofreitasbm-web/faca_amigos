import type { Plan } from "@facaamigos/domain";
import type { Db } from "../connection.js";

interface PlanRow {
  id: string;
  unit_id: string;
  activity: "PLAYGROUND" | "CARRINHO";
  name: string;
  value_cents: number;
  duration_value: number;
  duration_unit: "MINUTO" | "HORA";
  overage_cents_per_minute: number;
  color: string;
  active: 0 | 1;
  created_at_ms: number;
}

function toDomain(row: PlanRow): Plan {
  return {
    id: row.id,
    activity: row.activity,
    name: row.name,
    valueCents: row.value_cents,
    durationValue: row.duration_value,
    durationUnit: row.duration_unit,
    overageCentsPerMinute: row.overage_cents_per_minute,
    color: row.color,
  };
}

export function insertPlan(db: Db, unitId: string, plan: Plan, nowMs: number): void {
  db.prepare(
    `INSERT INTO plans (id, unit_id, activity, name, value_cents, duration_value, duration_unit, overage_cents_per_minute, color, active, created_at_ms)
     VALUES (@id, @unit_id, @activity, @name, @value_cents, @duration_value, @duration_unit, @overage_cents_per_minute, @color, 1, @created_at_ms)`,
  ).run({
    id: plan.id,
    unit_id: unitId,
    activity: plan.activity,
    name: plan.name,
    value_cents: plan.valueCents,
    duration_value: plan.durationValue,
    duration_unit: plan.durationUnit,
    overage_cents_per_minute: plan.overageCentsPerMinute,
    color: plan.color,
    created_at_ms: nowMs,
  });
}

export function listPlans(db: Db, unitId: string, activity?: "PLAYGROUND" | "CARRINHO"): Plan[] {
  const rows = activity
    ? (db
        .prepare("SELECT * FROM plans WHERE unit_id = ? AND activity = ? AND active = 1 ORDER BY value_cents")
        .all(unitId, activity) as unknown as PlanRow[])
    : (db.prepare("SELECT * FROM plans WHERE unit_id = ? AND active = 1 ORDER BY activity, value_cents").all(unitId) as unknown as PlanRow[]);
  return rows.map(toDomain);
}

export function getPlan(db: Db, id: string): Plan | undefined {
  const row = db.prepare("SELECT * FROM plans WHERE id = ?").get(id) as unknown as PlanRow | undefined;
  return row ? toDomain(row) : undefined;
}

export function setPlanActive(db: Db, id: string, active: boolean): void {
  db.prepare("UPDATE plans SET active = ? WHERE id = ?").run(active ? 1 : 0, id);
}
