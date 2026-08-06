-- Fase 3: suporte a reenvio idempotente quando o totem enfileira uma
-- chamada localmente (IndexedDB) por causa de uma queda breve de rede e
-- reenvia depois. Cada RPC transacional (fa_checkin, fa_checkout,
-- fa_create_pdv_order, fa_close_shift, fa_register_ponto) deve chamar
-- fa_kiosk_check_idempotency() no início e fa_kiosk_store_idempotency()
-- antes de retornar, para que um reenvio da mesma idempotency_key
-- devolva o resultado já processado em vez de duplicar o efeito.
create table if not exists fa_kiosk_idempotency_keys (
  idempotency_key text primary key,
  rpc_name text not null,
  result_json jsonb,
  created_at_ms bigint not null default (extract(epoch from now()) * 1000)::bigint
);
create index if not exists idx_fa_kiosk_idempotency_created on fa_kiosk_idempotency_keys (created_at_ms);

create or replace function fa_kiosk_check_idempotency(p_key text) returns jsonb as $$
  select result_json from fa_kiosk_idempotency_keys where idempotency_key = p_key;
$$ language sql stable;

create or replace function fa_kiosk_store_idempotency(p_key text, p_rpc_name text, p_result jsonb) returns void as $$
  insert into fa_kiosk_idempotency_keys (idempotency_key, rpc_name, result_json)
  values (p_key, p_rpc_name, p_result)
  on conflict (idempotency_key) do nothing;
$$ language sql volatile;
