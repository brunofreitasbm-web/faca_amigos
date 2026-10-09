-- Pacotes "cross_unit" (PORTO SEGURO) têm o saldo utilizável em qualquer unidade,
-- não só naquela em que foi comprado. A unidade de compra continua registrada em
-- fa_kiosk_guardian_packages.unit_id para relatório/bonificação.

alter table fa_kiosk_packages
  add column if not exists cross_unit boolean not null default false;

comment on column fa_kiosk_packages.cross_unit is
  'true = o saldo comprado deste pacote vale em qualquer unidade (ex.: PORTO SEGURO).';

update fa_kiosk_packages set cross_unit = true where name = 'PORTO SEGURO';

create or replace function fa_kiosk_package_consume(
  p_unit_id uuid, p_guardian_id uuid, p_minutes integer, p_now_ms bigint
) returns integer as $$
declare
  v_left integer := greatest(0, coalesce(p_minutes, 0));
  v_covered integer := 0;
  v_take integer;
  v_gp record;
begin
  if v_left = 0 or p_guardian_id is null then return 0; end if;

  for v_gp in
    select gp.* from fa_kiosk_guardian_packages gp
      join fa_kiosk_packages pk on pk.id = gp.package_id
     where gp.guardian_id = p_guardian_id
       and (gp.unit_id = p_unit_id or pk.cross_unit)
       and gp.expires_at_ms > p_now_ms and gp.remaining_minutes > 0
     order by (gp.unit_id = p_unit_id) desc, gp.expires_at_ms asc
     for update of gp
  loop
    exit when v_left = 0;
    v_take := least(v_gp.remaining_minutes, v_left);
    update fa_kiosk_guardian_packages
       set remaining_minutes = remaining_minutes - v_take
     where id = v_gp.id;
    v_covered := v_covered + v_take;
    v_left := v_left - v_take;
  end loop;

  return v_covered;
end;
$$ language plpgsql volatile security definer set search_path = public;

create or replace function fa_kiosk_guardian_package_balance(p_unit_id uuid, p_guardian_ids uuid[])
returns table (guardian_id uuid, remaining_minutes integer, expires_at_ms bigint) as $$
  select gp.guardian_id, sum(gp.remaining_minutes)::integer, min(gp.expires_at_ms)
    from fa_kiosk_guardian_packages gp
    join fa_kiosk_packages pk on pk.id = gp.package_id
   where (gp.unit_id = p_unit_id or pk.cross_unit)
     and gp.guardian_id = any(coalesce(p_guardian_ids, array[]::uuid[]))
     and gp.expires_at_ms > (extract(epoch from now()) * 1000)::bigint
     and gp.remaining_minutes > 0
   group by gp.guardian_id
$$ language sql stable set search_path = public;
