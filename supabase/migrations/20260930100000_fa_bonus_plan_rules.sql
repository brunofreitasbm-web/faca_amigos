-- Bônus de Planos Longos: bônus fixo por UNIDADE vendida de planos/pacotes de
-- maior permanência (2 horas, Day Use, Porto Seguro), configurável por unidade.
-- Regras do programa: docs/bonificacao/programa-planos-longos-out-2026.md
-- Manual do operador: docs/bonificacao/manual-venda-planos-longos.md
--
-- O que muda:
--   1. fa_kiosk_bonus_plan_rules — uma linha por plano (fa_kiosk_plans) ou
--      pacote (fa_kiosk_packages) que conta para o bônus: valor por unidade
--      vendida e "escada" mensal (bater N unidades paga um prêmio único).
--      ref_id aponta para uma de duas tabelas, por isso não tem FK; linha
--      órfã é tolerada (active=false / filtrada pela lista atual de planos).
--   2. fa_kiosk_bonus_program_config.planos_teto_mes_cents — teto próprio deste
--      bônus, SEPARADO do teto de metas/produtos (teto_mes_cents). 0 = sem teto.
--   3. fa_kiosk_guardian_packages.sold_by_employee_id / business_date — a tabela
--      não sabia quem vendeu nem em que dia de negócio. Sem isso não há como
--      atribuir a venda de um pacote a um operador.
--
-- Por que TRIGGER na própria tabela e não reescrever fa_checkin: a função foi
-- redefinida em mais de 12 migrations (mesma razão de 20260807000006). Três
-- caminhos gravam em fa_kiosk_guardian_packages — fa_checkin com pacote,
-- fa_kiosk_change_session_plan (UPDATE de sessão, não INSERT) e
-- fa_upsell_vender_pacote — e um BEFORE INSERT nesta tabela cobre os três.
-- O vendedor é quem está autenticado (fa_kiosk_current_employee_id, a mesma
-- fonte de fa_kiosk_force_actor); sem sessão autenticada (service_role/seed)
-- cai para o operador que fechou o pedido, quando houver order_id.
--
-- Sem seed aqui: a migration seguinte semeia o Playground do Parque Shopping.

create table if not exists fa_kiosk_bonus_plan_rules (
  unit_id uuid not null references fa_kiosk_units (id),
  kind text not null check (kind in ('PLANO', 'PACOTE')),
  ref_id uuid not null,
  label text not null,
  bonus_cents integer not null default 0 check (bonus_cents >= 0),
  -- 0 = sem escada para esta regra
  escada_meta integer not null default 0 check (escada_meta >= 0),
  escada_bonus_cents integer not null default 0 check (escada_bonus_cents >= 0),
  active boolean not null default true,
  sort_order integer not null default 0,
  updated_at_ms bigint not null default (extract(epoch from now()) * 1000)::bigint,
  primary key (unit_id, kind, ref_id)
);

alter table fa_kiosk_bonus_plan_rules enable row level security;

create policy fa_kiosk_bonus_plan_rules_read on fa_kiosk_bonus_plan_rules
  for select to authenticated using (true);

create policy fa_kiosk_bonus_plan_rules_write on fa_kiosk_bonus_plan_rules
  for all to authenticated
  using (fa_kiosk_can('config.write'))
  with check (fa_kiosk_can('config.write'));

alter table fa_kiosk_bonus_program_config
  add column if not exists planos_teto_mes_cents integer not null default 0
    check (planos_teto_mes_cents >= 0);

alter table fa_kiosk_guardian_packages
  add column if not exists sold_by_employee_id uuid references fa_kiosk_employees (id),
  add column if not exists business_date date;

create index if not exists idx_fa_kiosk_guardian_packages_unit_bdate
  on fa_kiosk_guardian_packages (unit_id, business_date);

create or replace function fa_kiosk_guardian_package_stamp() returns trigger as $$
begin
  if new.business_date is null then
    select fa_kiosk_business_date(new.purchased_at_ms, u.business_day_cutoff_hour)
      into new.business_date
      from fa_kiosk_units u where u.id = new.unit_id;
  end if;
  if new.sold_by_employee_id is null then
    new.sold_by_employee_id := coalesce(
      fa_kiosk_current_employee_id(),
      (select o.closed_by_employee_id from fa_kiosk_orders o where o.id = new.order_id)
    );
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function fa_kiosk_guardian_package_stamp() from public, anon, authenticated;

drop trigger if exists fa_kiosk_guardian_package_stamp_trg on fa_kiosk_guardian_packages;
create trigger fa_kiosk_guardian_package_stamp_trg
  before insert on fa_kiosk_guardian_packages
  for each row execute function fa_kiosk_guardian_package_stamp();

-- Backfill do histórico (tabela pequena). A data de negócio vem do corte da
-- unidade; o vendedor só é recuperável quando o pacote tem pedido.
update fa_kiosk_guardian_packages gp
   set business_date = fa_kiosk_business_date(gp.purchased_at_ms, u.business_day_cutoff_hour)
  from fa_kiosk_units u
 where u.id = gp.unit_id and gp.business_date is null;

update fa_kiosk_guardian_packages gp
   set sold_by_employee_id = o.closed_by_employee_id
  from fa_kiosk_orders o
 where o.id = gp.order_id and gp.sold_by_employee_id is null;
