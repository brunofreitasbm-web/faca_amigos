CREATE TABLE bonus_rules (
  id TEXT PRIMARY KEY,
  unit_id TEXT NOT NULL REFERENCES units (id),
  description TEXT NOT NULL,
  reward_value_cents INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at_ms INTEGER NOT NULL
);
