import type { Db } from "../connection.js";

export interface BonusRule {
  id: string;
  unitId: string;
  description: string;
  rewardValueCents: number;
}

interface BonusRuleRow {
  id: string;
  unit_id: string;
  description: string;
  reward_value_cents: number;
  active: 0 | 1;
  created_at_ms: number;
}

function toDomain(row: BonusRuleRow): BonusRule {
  return {
    id: row.id,
    unitId: row.unit_id,
    description: row.description,
    rewardValueCents: row.reward_value_cents,
  };
}

export function insertBonusRule(db: Db, r: { id: string; unit_id: string; description: string; reward_value_cents: number }, nowMs: number): void {
  db.prepare(
    `INSERT INTO bonus_rules (id, unit_id, description, reward_value_cents, active, created_at_ms)
     VALUES (@id, @unit_id, @description, @reward_value_cents, 1, @created_at_ms)`,
  ).run({ ...r, created_at_ms: nowMs });
}

export function listActiveBonusRules(db: Db, unitId: string): BonusRule[] {
  const rows = db.prepare("SELECT * FROM bonus_rules WHERE unit_id = ? AND active = 1 ORDER BY created_at_ms").all(unitId) as unknown as BonusRuleRow[];
  return rows.map(toDomain);
}
