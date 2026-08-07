-- Migração para suporte a dados importados do Safoplay e filtragem por origem
-- Adiciona a coluna origin nas tabelas principais de transações, sessões e cadastros.

-- fa_kiosk_orders
alter table fa_kiosk_orders add column if not exists origin text check (origin in ('LOCAL', 'SAFOPLAY')) default 'LOCAL';
update fa_kiosk_orders set origin = 'LOCAL' where origin is null;
create index if not exists idx_fa_kiosk_orders_origin_date on fa_kiosk_orders (origin, business_date);

-- fa_kiosk_sessions
alter table fa_kiosk_sessions add column if not exists origin text check (origin in ('LOCAL', 'SAFOPLAY')) default 'LOCAL';
update fa_kiosk_sessions set origin = 'LOCAL' where origin is null;
create index if not exists idx_fa_kiosk_sessions_origin_date on fa_kiosk_sessions (origin, business_date);

-- fa_kiosk_visit_log
alter table fa_kiosk_visit_log add column if not exists origin text check (origin in ('LOCAL', 'SAFOPLAY')) default 'LOCAL';
update fa_kiosk_visit_log set origin = 'LOCAL' where origin is null;
create index if not exists idx_fa_kiosk_visit_log_origin on fa_kiosk_visit_log (origin);

-- fa_kiosk_guardians
alter table fa_kiosk_guardians add column if not exists origin text check (origin in ('LOCAL', 'SAFOPLAY')) default 'LOCAL';
update fa_kiosk_guardians set origin = 'LOCAL' where origin is null;
create index if not exists idx_fa_kiosk_guardians_origin on fa_kiosk_guardians (origin);

-- fa_kiosk_children
alter table fa_kiosk_children add column if not exists origin text check (origin in ('LOCAL', 'SAFOPLAY')) default 'LOCAL';
update fa_kiosk_children set origin = 'LOCAL' where origin is null;
create index if not exists idx_fa_kiosk_children_origin on fa_kiosk_children (origin);

-- fa_kiosk_payments
alter table fa_kiosk_payments add column if not exists origin text check (origin in ('LOCAL', 'SAFOPLAY')) default 'LOCAL';
update fa_kiosk_payments set origin = 'LOCAL' where origin is null;
create index if not exists idx_fa_kiosk_payments_origin on fa_kiosk_payments (origin);
