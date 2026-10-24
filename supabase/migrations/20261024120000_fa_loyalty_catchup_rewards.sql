-- =====================================================================
-- Fidelidade: prêmio por marco (floor(visitas / N)), não por acerto exato
-- =====================================================================
-- Bug: fa_checkin só concede prêmio quando `visitas % trigger_visits = 0`
-- no instante do check-in. Se a contagem do log pula o múltiplo (limpeza
-- de duplicatas em fa_kiosk_visit_log, importação legada, visita que não
-- entrou no log), a criança passa de 10 para 11, 12... e o prêmio nunca
-- mais é concedido — "10 visitas confirmadas e sem desconto".
--
-- Correção, sem reescrever fa_checkin (a cópia vigente está em
-- 20261013110000_fa_coupon_schedule.sql):
--   1. fa_kiosk_loyalty_rewards.milestone numera os prêmios de cada
--      (criança, regra): 1º, 2º, 3º...
--   2. BEFORE INSERT em rewards: o insert do fa_checkin (acerto exato)
--      ganha o próximo número e é descartado se já houver prêmio demais
--      para a contagem atual (idempotente, sem prêmio duplicado).
--   3. AFTER INSERT em fa_kiosk_visit_log: concede os marcos devidos que
--      faltarem (floor(total / N) - prêmios existentes). O marco mais novo
--      usa earned_at_ms = instante do check-in, então a cortesia de
--      MINUTOS_EXTRA (fa_kiosk_loyalty_apply_courtesy) cai nesta sessão;
--      os atrasados ficam em aberto para o operador resgatar no checkout.
--   4. fa_loyalty_backfill_missing_rewards(): reparo dos casos já presos,
--      NÃO executado por esta migration (concede resgates com valor
--      financeiro — rode depois de conferir o dry-run).
-- Contagem = todas as linhas do log da criança (igual ao fa_checkin).
-- =====================================================================

alter table fa_kiosk_loyalty_rewards add column if not exists milestone integer;

-- Numera o histórico (inclui duplicatas antigas: viram marcos extras e não
-- geram prêmio novo, já que contam como "prêmios existentes").
with numbered as (
  select id, row_number() over (partition by child_id, rule_id order by earned_at_ms, id) as rn
  from fa_kiosk_loyalty_rewards
  where milestone is null
)
update fa_kiosk_loyalty_rewards r set milestone = n.rn
from numbered n where r.id = n.id;

create unique index if not exists uq_fa_loyalty_rewards_child_rule_milestone
  on fa_kiosk_loyalty_rewards (child_id, rule_id, milestone);

create or replace function fa_kiosk_loyalty_reward_assign_milestone() returns trigger as $$
declare
  v_trigger integer;
  v_total integer;
  v_next integer;
begin
  if new.milestone is not null then return new; end if;

  select trigger_visits into v_trigger from fa_kiosk_loyalty_rules where id = new.rule_id;
  if v_trigger is null or v_trigger <= 0 then return new; end if;

  perform pg_advisory_xact_lock(hashtext('fa_loyalty:' || new.child_id::text));
  select count(*) into v_total from fa_kiosk_visit_log where child_id = new.child_id;
  select coalesce(max(milestone), 0) + 1 into v_next
    from fa_kiosk_loyalty_rewards where child_id = new.child_id and rule_id = new.rule_id;

  if v_next > v_total / v_trigger then return null; end if;
  new.milestone := v_next;
  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function fa_kiosk_loyalty_reward_assign_milestone() from public, anon, authenticated;

drop trigger if exists trg_fa_loyalty_reward_milestone on fa_kiosk_loyalty_rewards;
create trigger trg_fa_loyalty_reward_milestone
  before insert on fa_kiosk_loyalty_rewards
  for each row execute function fa_kiosk_loyalty_reward_assign_milestone();

create or replace function fa_kiosk_loyalty_catchup_on_visit() returns trigger as $$
declare
  v_unit_id uuid;
  v_total integer;
  v_rule record;
  v_have integer;
  v_missing integer;
  i integer;
begin
  -- A unidade vem da sessão aberta neste instante; importação legada sem
  -- sessão não concede nada aqui (vale o backfill).
  select unit_id into v_unit_id from fa_kiosk_sessions
   where child_id = new.child_id and checkin_at_ms = new.at_ms limit 1;
  if v_unit_id is null then return null; end if;

  perform pg_advisory_xact_lock(hashtext('fa_loyalty:' || new.child_id::text));
  select count(*) into v_total from fa_kiosk_visit_log where child_id = new.child_id;

  for v_rule in
    select * from fa_kiosk_loyalty_rules
    where unit_id = v_unit_id and active and trigger_visits > 0
      and (activity = new.activity or activity = 'AMBOS')
  loop
    select count(*) into v_have from fa_kiosk_loyalty_rewards
     where child_id = new.child_id and rule_id = v_rule.id;
    v_missing := v_total / v_rule.trigger_visits - v_have;
    for i in 1 .. greatest(v_missing, 0) loop
      insert into fa_kiosk_loyalty_rewards (child_id, rule_id, earned_at_ms)
        values (new.child_id, v_rule.id,
                case when i = v_missing then new.at_ms else new.at_ms - (v_missing - i + 1) end);
    end loop;
  end loop;
  return null;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function fa_kiosk_loyalty_catchup_on_visit() from public, anon, authenticated;

drop trigger if exists trg_fa_loyalty_catchup_on_visit on fa_kiosk_visit_log;
create trigger trg_fa_loyalty_catchup_on_visit
  after insert on fa_kiosk_visit_log
  for each row execute function fa_kiosk_loyalty_catchup_on_visit();

-- Reparo dos casos já presos. p_dry_run = true só lista.
create or replace function fa_loyalty_backfill_missing_rewards(p_dry_run boolean default true)
returns table (child_id uuid, child_name text, rule_id uuid, visitas integer, devidos integer, existentes integer, concedidos integer)
as $$
declare
  r record;
  i integer;
begin
  for r in
    select c.id as cid, c.full_name, ru.id as rid, t.n::integer as visitas,
           (t.n / ru.trigger_visits)::integer as devidos,
           (select count(*) from fa_kiosk_loyalty_rewards w where w.child_id = c.id and w.rule_id = ru.id)::integer as existentes
    from fa_kiosk_children c
    join (select vl.child_id, count(*) n from fa_kiosk_visit_log vl group by 1) t on t.child_id = c.id
    join (select distinct s.child_id, s.unit_id from fa_kiosk_sessions s) cu on cu.child_id = c.id
    join fa_kiosk_loyalty_rules ru on ru.unit_id = cu.unit_id and ru.active and ru.trigger_visits > 0
    where (t.n / ru.trigger_visits) > (select count(*) from fa_kiosk_loyalty_rewards w where w.child_id = c.id and w.rule_id = ru.id)
      and exists (select 1 from fa_kiosk_visit_log v where v.child_id = c.id and (v.activity = ru.activity or ru.activity = 'AMBOS'))
  loop
    if not p_dry_run then
      for i in 1 .. (r.devidos - r.existentes) loop
        -- earned_at_ms no passado: não casa com nenhuma sessão ativa, fica em aberto para resgate.
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
