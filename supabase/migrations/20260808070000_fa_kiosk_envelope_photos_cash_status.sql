-- Simplificação das 3 abas gerenciais "(FA)" a pedido do dono: só precisam
-- responder 3 perguntas por loja — quando abriu/fechou o caixa, qual a foto
-- do envelope de cada sangria, e quanto dinheiro físico tem na gaveta agora.
-- As abas antigas liam de um backend legado em memória (apps/kiosk, Fastify)
-- que não persiste nada — este arquivo move a base de dados para as tabelas
-- reais (fa_kiosk_shifts / fa_kiosk_cash_movements), já lidas por `anon`
-- desde a migration 16.

-- Número do envelope e foto viram colunas estruturadas do movimento de caixa
-- (SANGRIA), em vez de embutidos como texto livre em `reason`.
alter table fa_kiosk_cash_movements add column if not exists envelope_number text;
alter table fa_kiosk_cash_movements add column if not exists photo_url text;

-- fa_record_cash_movement ganha os 2 parâmetros novos no final, com default
-- — CREATE OR REPLACE preserva a assinatura existente (callResilient/idempotência
-- de quem já chama sem eles continua funcionando).
create or replace function fa_record_cash_movement(
  p_idempotency_key text,
  p_shift_id uuid,
  p_kind text,
  p_amount_cents integer,
  p_reason text,
  p_employee_id uuid,
  p_envelope_number text default null,
  p_photo_url text default null
) returns jsonb as $$
declare
  v_cached jsonb;
  v_status text;
begin
  v_cached := fa_kiosk_check_idempotency(p_idempotency_key);
  if v_cached is not null then return v_cached; end if;

  select status into v_status from fa_kiosk_shifts where id = p_shift_id;
  if v_status is distinct from 'ABERTO' then raise exception 'TURNO_INEXISTENTE_OU_FECHADO'; end if;

  insert into fa_kiosk_cash_movements (shift_id, kind, amount_cents, reason, employee_id, at_ms, envelope_number, photo_url)
    values (p_shift_id, p_kind, p_amount_cents, p_reason, p_employee_id, (extract(epoch from now()) * 1000)::bigint, p_envelope_number, p_photo_url);

  v_cached := jsonb_build_object('ok', true);
  perform fa_kiosk_store_idempotency(p_idempotency_key, 'fa_record_cash_movement', v_cached);
  return v_cached;
end;
$$ language plpgsql security definer;

-- Bucket de fotos de envelope — leitura pública (a aba gerencial exibe sem
-- autenticação, mesma situação de `carrinho-fotos`), upload liberado ao
-- anon pela mesma razão temporária (login do kiosk-ui oculto, migration 16).
insert into storage.buckets (id, name, public)
values ('envelope-fotos', 'envelope-fotos', true)
on conflict (id) do nothing;

drop policy if exists fa_kiosk_envelope_fotos_read on storage.objects;
create policy fa_kiosk_envelope_fotos_read on storage.objects for select
  using (bucket_id = 'envelope-fotos');

drop policy if exists fa_kiosk_envelope_fotos_write_anon_temp on storage.objects;
create policy fa_kiosk_envelope_fotos_write_anon_temp on storage.objects for all to anon
  using (bucket_id = 'envelope-fotos') with check (bucket_id = 'envelope-fotos');

-- Saldo físico em caixa por unidade, agora. Mesma conta que fa_close_shift já
-- faz para o "esperado" em DINHEIRO (vendas do turno + TROCO_INICIAL/SUPRIMENTO
-- - SANGRIA ± AJUSTE) — reaproveitada aqui em vez de duplicada, para as duas
-- nunca poderem divergir. Sem turno aberto, não há gaveta em uso: o valor
-- físico é null (a aba mostra "turno fechado", não zero).
create or replace function fa_units_cash_status()
returns table (
  unit_id uuid,
  unit_name text,
  shift_id uuid,
  status text,
  opened_at_ms bigint,
  closed_at_ms bigint,
  opening_cash_cents integer,
  current_cash_cents integer
) as $$
  select
    u.id as unit_id,
    u.name as unit_name,
    s.id as shift_id,
    s.status,
    s.opened_at_ms,
    s.closed_at_ms,
    s.opening_cash_cents,
    case when s.status = 'ABERTO' then
      coalesce((
        select sum(p.amount_cents)
        from fa_kiosk_payments p join fa_kiosk_orders o on o.id = p.order_id
        where o.shift_id = s.id and p.method = 'DINHEIRO'
      ), 0)
      + coalesce((
        select sum(case
            when m.kind in ('SUPRIMENTO', 'TROCO_INICIAL') then m.amount_cents
            when m.kind = 'SANGRIA' then -m.amount_cents
            else m.amount_cents
          end)
        from fa_kiosk_cash_movements m where m.shift_id = s.id
      ), 0)
    else null end as current_cash_cents
  from fa_kiosk_units u
  left join lateral (
    select * from fa_kiosk_shifts
    where unit_id = u.id
    order by (status = 'ABERTO') desc, opened_at_ms desc
    limit 1
  ) s on true;
$$ language sql stable security definer;
