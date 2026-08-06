-- Núcleo operacional local (Fase 1 do plano de arquitetura, seção 4.3).
-- Escopo: o que as telas Entrada, Painel, PDV, Caixa, Ponto,
-- Relatório e Configurações do protótipo precisam para operar de
-- verdade. Sync com a nuvem (Fase 2) ainda não existe — por isso não
-- há sync_outbox/sync_conflicts aqui ainda, mas todo registro já
-- carrega os campos que a Fase 2 vai precisar (rev, timestamps,
-- business_date) para não exigir migração destrutiva depois.

CREATE TABLE units (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('LOJA', 'QUIOSQUE')),
  name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/Belem',
  business_day_cutoff_hour INTEGER NOT NULL DEFAULT 4,
  created_at_ms INTEGER NOT NULL
);

CREATE TABLE app_settings (
  unit_id TEXT NOT NULL REFERENCES units (id),
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (unit_id, key)
);

CREATE TABLE employees (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('OPERADOR', 'GERENTE', 'ADMIN')),
  pis TEXT,
  cpf_last4 TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at_ms INTEGER NOT NULL
);

-- Hash Argon2id calculado fora do domínio puro (seção 7.1). PIN de 6
-- dígitos para troca rápida de operador; senha completa é opcional.
CREATE TABLE local_credentials (
  employee_id TEXT PRIMARY KEY REFERENCES employees (id),
  pin_hash TEXT NOT NULL,
  password_hash TEXT,
  must_change INTEGER NOT NULL DEFAULT 0,
  expires_at_ms INTEGER,
  created_at_ms INTEGER NOT NULL
);

CREATE TABLE guardians (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  phone_e164 TEXT NOT NULL UNIQUE,
  created_at_ms INTEGER NOT NULL
);

CREATE TABLE children (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  birth_date TEXT NOT NULL,
  inclusive_eligible INTEGER NOT NULL DEFAULT 0,
  inclusive_proof_type TEXT,
  created_at_ms INTEGER NOT NULL
);

CREATE TABLE child_guardians (
  child_id TEXT NOT NULL REFERENCES children (id),
  guardian_id TEXT NOT NULL REFERENCES guardians (id),
  is_authorized_pickup INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (child_id, guardian_id)
);

-- Append-only por natureza: uma visita é um fato que já aconteceu.
-- Base para o selo de frequência (packages/domain/loyalty/visit-frequency).
CREATE TABLE visit_log (
  id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL REFERENCES children (id),
  activity TEXT NOT NULL CHECK (activity IN ('PLAYGROUND', 'CARRINHO')),
  at_ms INTEGER NOT NULL
);
CREATE INDEX idx_visit_log_child ON visit_log (child_id, at_ms);

CREATE TABLE plans (
  id TEXT PRIMARY KEY,
  unit_id TEXT NOT NULL REFERENCES units (id),
  activity TEXT NOT NULL CHECK (activity IN ('PLAYGROUND', 'CARRINHO')),
  name TEXT NOT NULL,
  value_cents INTEGER NOT NULL,
  duration_value INTEGER NOT NULL,
  duration_unit TEXT NOT NULL CHECK (duration_unit IN ('MINUTO', 'HORA')),
  overage_cents_per_minute INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at_ms INTEGER NOT NULL
);

CREATE TABLE coupons (
  id TEXT PRIMARY KEY,
  unit_id TEXT NOT NULL REFERENCES units (id),
  code TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('MINUTOS_EXTRA', 'DESCONTO_PCT', 'DESCONTO_VALOR')),
  value INTEGER NOT NULL,
  max_uses INTEGER NOT NULL DEFAULT 0,
  used_count INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  description TEXT,
  created_at_ms INTEGER NOT NULL,
  UNIQUE (unit_id, code)
);

CREATE TABLE loyalty_rules (
  id TEXT PRIMARY KEY,
  unit_id TEXT NOT NULL REFERENCES units (id),
  activity TEXT NOT NULL CHECK (activity IN ('PLAYGROUND', 'CARRINHO', 'AMBOS')),
  trigger_visits INTEGER NOT NULL,
  reward_kind TEXT NOT NULL CHECK (reward_kind IN ('ENTRADA_GRATIS', 'DESCONTO_PCT', 'MINUTOS_EXTRA')),
  reward_value INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at_ms INTEGER NOT NULL
);

-- Ledger append-only (seção 4.3): saldo de recompensa nunca sofre
-- UPDATE de valor — resgate grava redeemed_at_ms/redeemed_session_id.
CREATE TABLE loyalty_rewards (
  id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL REFERENCES children (id),
  rule_id TEXT NOT NULL REFERENCES loyalty_rules (id),
  earned_at_ms INTEGER NOT NULL,
  redeemed_at_ms INTEGER,
  redeemed_session_id TEXT
);

CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  unit_id TEXT NOT NULL REFERENCES units (id),
  name TEXT NOT NULL,
  emoji TEXT NOT NULL,
  color TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('DISPONIVEL', 'EM_USO', 'MANUTENCAO')) DEFAULT 'DISPONIVEL',
  odometer_minutes INTEGER NOT NULL DEFAULT 0,
  maintenance_threshold_hours INTEGER NOT NULL DEFAULT 200,
  created_at_ms INTEGER NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  unit_id TEXT NOT NULL REFERENCES units (id),
  activity TEXT NOT NULL CHECK (activity IN ('PLAYGROUND', 'CARRINHO')),
  asset_id TEXT REFERENCES assets (id),
  plan_id TEXT NOT NULL REFERENCES plans (id),
  child_id TEXT NOT NULL REFERENCES children (id),
  child_name_snapshot TEXT NOT NULL,
  guardian_id TEXT NOT NULL REFERENCES guardians (id),
  wristband_code TEXT NOT NULL UNIQUE,
  ticket_code TEXT NOT NULL UNIQUE,
  checkin_at_ms INTEGER NOT NULL,
  checkin_by_employee_id TEXT REFERENCES employees (id),
  checkout_at_ms INTEGER,
  status TEXT NOT NULL CHECK (status IN ('ATIVA', 'AGUARDANDO_PAGAMENTO', 'FINALIZADA')) DEFAULT 'ATIVA',
  coupon_id TEXT REFERENCES coupons (id),
  coupon_discount_cents INTEGER NOT NULL DEFAULT 0,
  free_from_loyalty INTEGER NOT NULL DEFAULT 0,
  order_id TEXT,
  business_date TEXT NOT NULL
);
CREATE INDEX idx_sessions_unit_status ON sessions (unit_id, status);

-- Append-only (seção 4.3): reconstrói qualquer sessão sem depender de
-- UPDATE — inclusive para defesa jurídica sobre retirada da criança.
CREATE TABLE session_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions (id),
  kind TEXT NOT NULL,
  at_ms INTEGER NOT NULL,
  employee_id TEXT REFERENCES employees (id),
  payload_json TEXT
);
CREATE INDEX idx_session_events_session ON session_events (session_id, at_ms);

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  unit_id TEXT NOT NULL REFERENCES units (id),
  name TEXT NOT NULL,
  description TEXT,
  emoji TEXT,
  price_cents INTEGER NOT NULL,
  stock INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at_ms INTEGER NOT NULL
);

CREATE TABLE stock_movements (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products (id),
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  order_id TEXT,
  at_ms INTEGER NOT NULL
);

CREATE TABLE shifts (
  id TEXT PRIMARY KEY,
  unit_id TEXT NOT NULL REFERENCES units (id),
  opened_by_employee_id TEXT NOT NULL REFERENCES employees (id),
  opened_at_ms INTEGER NOT NULL,
  opening_cash_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('ABERTO', 'FECHADO')) DEFAULT 'ABERTO',
  closed_by_employee_id TEXT REFERENCES employees (id),
  closed_at_ms INTEGER,
  -- Fechamento cego (seção 7.2): expected_json só é calculado dentro
  -- do endpoint de fechamento, depois do declared_json chegar.
  declared_json TEXT,
  expected_json TEXT,
  business_date TEXT NOT NULL
);
CREATE INDEX idx_shifts_unit_status ON shifts (unit_id, status);

CREATE TABLE cash_movements (
  id TEXT PRIMARY KEY,
  shift_id TEXT NOT NULL REFERENCES shifts (id),
  kind TEXT NOT NULL CHECK (kind IN ('TROCO_INICIAL', 'SANGRIA', 'SUPRIMENTO', 'AJUSTE')),
  amount_cents INTEGER NOT NULL,
  reason TEXT,
  employee_id TEXT NOT NULL REFERENCES employees (id),
  at_ms INTEGER NOT NULL
);

CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  unit_id TEXT NOT NULL REFERENCES units (id),
  shift_id TEXT REFERENCES shifts (id),
  kind TEXT NOT NULL CHECK (kind IN ('SESSAO', 'PDV')),
  total_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('ABERTA', 'PAGA', 'CANCELADA')) DEFAULT 'ABERTA',
  closed_by_employee_id TEXT REFERENCES employees (id),
  closed_at_ms INTEGER,
  business_date TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL
);
CREATE INDEX idx_orders_shift ON orders (shift_id);

CREATE TABLE order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders (id),
  item_type TEXT NOT NULL CHECK (item_type IN ('SESSAO', 'PRODUTO')),
  item_nature TEXT NOT NULL CHECK (item_nature IN ('SERVICO', 'PRODUTO')),
  description TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price_cents INTEGER NOT NULL,
  list_unit_price_cents INTEGER NOT NULL,
  total_cents INTEGER NOT NULL,
  product_id TEXT REFERENCES products (id),
  session_id TEXT REFERENCES sessions (id)
);
CREATE INDEX idx_order_items_order ON order_items (order_id);

CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders (id),
  method TEXT NOT NULL CHECK (method IN ('DINHEIRO', 'PIX', 'CREDITO', 'DEBITO', 'VOUCHER')),
  amount_cents INTEGER NOT NULL,
  nsu TEXT,
  authorization TEXT,
  pix_txid TEXT,
  created_at_ms INTEGER NOT NULL
);
CREATE INDEX idx_payments_order ON payments (order_id);

-- Bater ponto (Portaria MTP 671/2021). NSR sequencial e sem endpoint
-- de exclusão por desenho — correção é sempre um novo registro.
CREATE TABLE ponto_records (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees (id),
  unit_id TEXT NOT NULL REFERENCES units (id),
  kind TEXT NOT NULL CHECK (kind IN ('ENTRADA', 'SAIDA', 'INTERVALO_INICIO', 'INTERVALO_FIM')),
  nsr INTEGER NOT NULL UNIQUE,
  at_ms INTEGER NOT NULL,
  registered_by_employee_id TEXT REFERENCES employees (id)
);
CREATE INDEX idx_ponto_employee ON ponto_records (employee_id, at_ms);

-- Encadeado por hash (seção 9.3): prev_hash/self_hash tornam
-- adulteração retroativa detectável.
CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  at_ms INTEGER NOT NULL,
  employee_id TEXT REFERENCES employees (id),
  action TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('INFO', 'ALERTA')) DEFAULT 'INFO',
  details_json TEXT,
  prev_hash TEXT,
  self_hash TEXT NOT NULL
);
