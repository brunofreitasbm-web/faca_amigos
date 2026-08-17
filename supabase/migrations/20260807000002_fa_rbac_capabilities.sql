-- RBAC de 3 níveis — Operador / Líder / Owner.
--
-- Os VALORES no banco continuam 'OPERADOR' / 'GERENTE' / 'ADMIN' (check
-- constraint da migration 01, referenciados pelas Edge Functions e por todo
-- o histórico de fa_kiosk_employees). O que muda é só o rótulo na UI:
--   OPERADOR -> "Operador"   GERENTE -> "Líder"   ADMIN -> "Owner"
-- Renomear os valores exigiria tocar constraint + linhas + funções + policies
-- de uma vez, com risco de deixar um 'ADMIN' hardcoded para trás que falharia
-- em silêncio. O rótulo resolve o mesmo problema visível com risco zero.
--
-- A decisão de "quem pode o quê" mora EXCLUSIVAMENTE aqui, em
-- fa_kiosk_role_capabilities. As policies, as RPCs de configuração e o menu
-- do kiosk-ui leem todos desta mesma tabela — a UI nunca reimplementa a
-- regra, ela só reflete o que o banco já decidiu. Adicionar uma capacidade
-- nova é um INSERT: nenhum código de UI muda, e é impossível a UI liberar
-- algo que o banco nega.

-- Ranking numérico para a herança hierárquica virar um `<=` só, em vez de
-- uma cadeia de CASE espalhada por cada policy.
create or replace function fa_kiosk_role_rank(p_role text) returns int as $$
  select case p_role
    when 'OPERADOR' then 1
    when 'GERENTE'  then 2
    when 'ADMIN'    then 3
    else 0
  end;
$$ language sql immutable set search_path = public, pg_temp;

create table if not exists fa_kiosk_role_capabilities (
  role       text not null check (role in ('OPERADOR', 'GERENTE', 'ADMIN')),
  capability text not null,
  primary key (role, capability)
);

-- Cada linha declara a capacidade no papel MÍNIMO que a possui; a herança
-- (Owner tem tudo do Líder, que tem tudo do Operador) é resolvida por
-- fa_kiosk_can abaixo, não repetindo linhas aqui.
insert into fa_kiosk_role_capabilities (role, capability) values
  -- Operador: caixa e vendas, nada além disso.
  ('OPERADOR', 'sessao.checkin'),
  ('OPERADOR', 'sessao.checkout'),
  ('OPERADOR', 'pdv.sell'),
  ('OPERADOR', 'caixa.open_close'),
  ('OPERADOR', 'ponto.self'),
  -- Líder: operação estendida — as exceções que o Operador não decide sozinho.
  ('GERENTE',  'sessao.change_plan'),
  ('GERENTE',  'venda.estorno'),
  ('GERENTE',  'caixa.sangria'),
  ('GERENTE',  'desconto.manual'),
  ('GERENTE',  'relatorio.read'),
  -- Owner: exclusividade de cancelamento de sessões e do menu Configurações.
  ('ADMIN',    'sessao.cancel'),
  ('ADMIN',    'config.read'),
  ('ADMIN',    'config.write'),
  ('ADMIN',    'config.employees.write'),
  ('ADMIN',    'config.unit.write'),
  ('ADMIN',    'config.fiscal.write'),
  ('ADMIN',    'config.terms.write')
on conflict do nothing;

-- O predicado único de autorização do sistema. Usado pelas policies de RLS,
-- pelas RPCs de configuração e pelas Edge Functions (via rpc) — uma
-- implementação só, impossível de divergir entre camadas.
--
-- `security definer` porque precisa ler fa_kiosk_employees e
-- fa_kiosk_role_capabilities independentemente das policies do chamador; o
-- `set search_path` fechado é o que impede sequestro de resolução de nomes
-- dentro de uma função privilegiada.
create or replace function fa_kiosk_can(p_capability text) returns boolean as $$
  select exists (
    select 1
      from fa_kiosk_employees e
      join fa_kiosk_role_capabilities rc
        on fa_kiosk_role_rank(rc.role) <= fa_kiosk_role_rank(e.role)
     where e.auth_user_id = auth.uid()
       and e.active
       and rc.capability = p_capability
  );
$$ language sql stable security definer set search_path = public, pg_temp;

-- Anon jamais pode nada: sem sessão não há colaborador, e a função já
-- retornaria false — mas revogar o EXECUTE fecha também o caminho de usar a
-- função como oráculo para descobrir capacidades.
revoke all on function fa_kiosk_can(text) from public, anon;
grant execute on function fa_kiosk_can(text) to authenticated;

-- O que o kiosk-ui lê para montar o menu. Deliberadamente uma VIEW e não a
-- tabela crua: o cliente enxerga só as capacidades DELE, nunca a matriz
-- inteira (que revelaria a superfície administrativa a um Operador).
-- Fica com security definer (padrão da view) de propósito — o `authenticated`
-- não tem, e não deve ter, SELECT em fa_kiosk_role_capabilities.
create or replace view fa_kiosk_my_capabilities as
  select rc.capability
    from fa_kiosk_employees e
    join fa_kiosk_role_capabilities rc
      on fa_kiosk_role_rank(rc.role) <= fa_kiosk_role_rank(e.role)
   where e.auth_user_id = auth.uid()
     and e.active;

revoke all on fa_kiosk_role_capabilities from anon, authenticated;
revoke all on fa_kiosk_my_capabilities from anon;
grant select on fa_kiosk_my_capabilities to authenticated;

alter table fa_kiosk_role_capabilities enable row level security;
-- Sem nenhuma policy: nem anon nem authenticated leem a matriz diretamente.

-- Escrita das tabelas de configuração: era `fa_kiosk_has_role('GERENTE')`
-- (migration 09), o que deixava o LÍDER editar planos, preços e cupons. O
-- requisito é exclusividade do Owner — a policy passa a exigir config.write.
do $$
declare
  t text;
begin
  foreach t in array array['fa_kiosk_units', 'fa_kiosk_app_settings', 'fa_kiosk_plans',
                            'fa_kiosk_products', 'fa_kiosk_bonus_rules', 'fa_kiosk_assets',
                            'fa_kiosk_coupons', 'fa_kiosk_loyalty_rules']
  loop
    execute format('drop policy if exists fa_kiosk_write_manager on %I', t);
    execute format('drop policy if exists fa_kiosk_write_owner on %I', t);
    execute format($f$create policy fa_kiosk_write_owner on %I for all to authenticated
                        using (fa_kiosk_can('config.write'))
                        with check (fa_kiosk_can('config.write'))$f$, t);
  end loop;
end $$;

drop policy if exists fa_kiosk_employees_write_admin on fa_kiosk_employees;
drop policy if exists fa_kiosk_employees_write_owner on fa_kiosk_employees;
create policy fa_kiosk_employees_write_owner on fa_kiosk_employees for all to authenticated
  using (fa_kiosk_can('config.employees.write'))
  with check (fa_kiosk_can('config.employees.write'));
