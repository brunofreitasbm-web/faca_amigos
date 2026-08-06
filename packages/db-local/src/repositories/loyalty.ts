import type { LoyaltyRule } from "@facaamigos/domain";
import type { Db } from "../connection.js";
import { uuidv7 } from "../id.js";

interface LoyaltyRuleRow {
  id: string;
  unit_id: string;
  activity: "PLAYGROUND" | "CARRINHO" | "AMBOS";
  trigger_visits: number;
  reward_kind: LoyaltyRule["rewardKind"];
  reward_value: number;
  active: 0 | 1;
  created_at_ms: number;
}

function toDomain(row: LoyaltyRuleRow): LoyaltyRule {
  return {
    id: row.id,
    activity: row.activity,
    triggerVisits: row.trigger_visits,
    rewardKind: row.reward_kind,
    rewardValue: row.reward_value,
  };
}

export function insertLoyaltyRule(db: Db, r: Omit<LoyaltyRuleRow, "created_at_ms" | "active">, nowMs: number): void {
  db.prepare(
    `INSERT INTO loyalty_rules (id, unit_id, activity, trigger_visits, reward_kind, reward_value, active, created_at_ms)
     VALUES (@id, @unit_id, @activity, @trigger_visits, @reward_kind, @reward_value, 1, @created_at_ms)`,
  ).run({ ...r, created_at_ms: nowMs });
}

export function listActiveLoyaltyRules(db: Db, unitId: string): LoyaltyRule[] {
  const rows = db.prepare("SELECT * FROM loyalty_rules WHERE unit_id = ? AND active = 1").all(unitId) as unknown as LoyaltyRuleRow[];
  return rows.map(toDomain);
}

export function grantLoyaltyReward(db: Db, childId: string, ruleId: string, earnedAtMs: number): void {
  db.prepare(`INSERT INTO loyalty_rewards (id, child_id, rule_id, earned_at_ms) VALUES (?, ?, ?, ?)`).run(
    uuidv7(earnedAtMs),
    childId,
    ruleId,
    earnedAtMs,
  );
}

export interface RedeemableReward {
  id: string;
  rule_id: string;
  earned_at_ms: number;
}

export function listRedeemableRewards(db: Db, childId: string): RedeemableReward[] {
  return db
    .prepare("SELECT id, rule_id, earned_at_ms FROM loyalty_rewards WHERE child_id = ? AND redeemed_at_ms IS NULL ORDER BY earned_at_ms")
    .all(childId) as unknown as RedeemableReward[];
}

export function redeemLoyaltyReward(db: Db, rewardId: string, sessionId: string, nowMs: number): boolean {
  const result = db
    .prepare("UPDATE loyalty_rewards SET redeemed_at_ms = ?, redeemed_session_id = ? WHERE id = ? AND redeemed_at_ms IS NULL")
    .run(nowMs, sessionId, rewardId);
  return result.changes > 0;
}
