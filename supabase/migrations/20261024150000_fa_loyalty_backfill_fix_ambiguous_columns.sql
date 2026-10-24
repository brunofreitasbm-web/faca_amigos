-- fa_loyalty_backfill_missing_rewards falhava com "column reference devidos is
-- ambiguous" (42702): as colunas de saída (RETURNS TABLE) têm o mesmo nome dos
-- aliases da consulta interna. #variable_conflict use_column resolve em favor
-- da coluna; as atribuições às variáveis de saída seguem iguais.
create or replace function fa_loyalty_backfill_missing_rewards(p_dry_run boolean default true)
returns table (child_id uuid, child_name text, rule_id uuid, visitas integer, devidos integer, existentes integer, concedidos integer)
as $$
#variable_conflict use_column
declare
  r record;
  i integer;
begin
  for r in
    with sig as (
      select distinct activity, trigger_visits, reward_kind, reward_value
      from fa_kiosk_loyalty_rules where active and trigger_visits > 0
    ), x as (
      select c.id as cid, c.full_name, s.*, t.n::integer as visitas,
        (t.n / s.trigger_visits)::integer as devidos,
        (select count(*) from fa_kiosk_loyalty_rewards w join fa_kiosk_loyalty_rules ru on ru.id = w.rule_id
          where w.child_id = c.id and ru.activity = s.activity and ru.trigger_visits = s.trigger_visits
            and ru.reward_kind = s.reward_kind and ru.reward_value = s.reward_value)::integer as existentes,
        (select ru.id from fa_kiosk_loyalty_rules ru
          where ru.active and ru.activity = s.activity and ru.trigger_visits = s.trigger_visits
            and ru.reward_kind = s.reward_kind and ru.reward_value = s.reward_value
          order by (ru.unit_id = (select se.unit_id from fa_kiosk_sessions se where se.child_id = c.id
                                  order by se.checkin_at_ms desc limit 1)) desc limit 1) as rid
      from fa_kiosk_children c
      join (select vl.child_id, count(*) n from fa_kiosk_visit_log vl group by 1) t on t.child_id = c.id
      cross join sig s
      where exists (select 1 from fa_kiosk_sessions se where se.child_id = c.id)
        and exists (select 1 from fa_kiosk_visit_log v where v.child_id = c.id and v.activity = s.activity)
    )
    select * from x where x.devidos > x.existentes
  loop
    if not p_dry_run then
      for i in 1 .. (r.devidos - r.existentes) loop
        insert into fa_kiosk_loyalty_rewards (child_id, rule_id, earned_at_ms)
          values (r.cid, r.rid, (extract(epoch from now()) * 1000)::bigint - 1000 * i);
      end loop;
    end if;
    child_id := r.cid; child_name := r.full_name; rule_id := r.rid;
    visitas := r.visitas; devidos := r.devidos; existentes := r.existentes;
    concedidos := case when p_dry_run then 0 else r.devidos - r.existentes end;
    return next;
  end loop;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function fa_loyalty_backfill_missing_rewards(boolean) from public, anon, authenticated;
grant execute on function fa_loyalty_backfill_missing_rewards(boolean) to service_role;
