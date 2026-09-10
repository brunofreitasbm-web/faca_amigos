-- Migração 0006: Módulo de Créditos Pré-pagos / Porto Seguro (saldo fracionado multi-visitas)

CREATE TABLE IF NOT EXISTS prepaid_packages (
  id TEXT PRIMARY KEY,
  unit_id TEXT NOT NULL REFERENCES units (id),
  guardian_id TEXT NOT NULL REFERENCES guardians (id),
  child_id TEXT REFERENCES children (id),
  plan_name TEXT NOT NULL,
  total_minutes INTEGER NOT NULL,
  remaining_minutes INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL,
  expires_at_ms INTEGER,
  status TEXT NOT NULL CHECK (status IN ('ATIVO', 'ESGOTADO', 'EXPIRADO', 'CANCELADO')) DEFAULT 'ATIVO',
  order_id TEXT REFERENCES orders (id),
  created_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_prepaid_packages_guardian ON prepaid_packages (guardian_id, status);
CREATE INDEX IF NOT EXISTS idx_prepaid_packages_child ON prepaid_packages (child_id, status);

CREATE TABLE IF NOT EXISTS prepaid_ledger (
  id TEXT PRIMARY KEY,
  package_id TEXT NOT NULL REFERENCES prepaid_packages (id),
  session_id TEXT REFERENCES sessions (id),
  delta_minutes INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('COMPRA_INICIAL', 'USO_SESSAO', 'AJUSTE_MANUAL', 'ESTORNO')),
  employee_id TEXT REFERENCES employees (id),
  at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_prepaid_ledger_package ON prepaid_ledger (package_id, at_ms);
