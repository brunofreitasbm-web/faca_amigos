-- Lista os pacotes com saldo (ex.: PORTO SEGURO) dos responsáveis ligados a uma
-- criança, para a Entrada mostrar o saldo antes de abrir a sessão.
--
-- Hoje o saldo de pacote só aparece como etiqueta no cartão da sessão ativa
-- (fa_kiosk_guardian_package_balance, agregado por responsável). Aqui sai uma
-- linha por pacote, com o mesmo critério de visibilidade e a mesma ordem do
-- abatimento (fa_kiosk_package_consume): pacote comprado na própria unidade
-- primeiro, depois por vencimento; pacote cross_unit vale fora da unidade de
-- compra só em unidade que não seja QUIOSQUE (os Playgrounds, não o Circuito).
--
-- Só leitura. Mesmo perfil de fa_kiosk_guardian_package_balance: sem security
-- definer (vale a RLS do usuário autenticado).

create or replace function fa_kiosk_child_package_list(p_unit_id uuid, p_child_id uuid)
returns table (
  package_id uuid, package_name text, remaining_minutes integer,
  included_minutes integer, expires_at_ms bigint
) as $$
  select gp.id, gp.package_name_snapshot, gp.remaining_minutes, gp.included_minutes, gp.expires_at_ms
    from fa_kiosk_guardian_packages gp
    join fa_kiosk_packages pk on pk.id = gp.package_id
   where gp.guardian_id in (select cg.guardian_id from fa_kiosk_child_guardians cg where cg.child_id = p_child_id)
     and (gp.unit_id = p_unit_id
          or (pk.cross_unit
              and exists (select 1 from fa_kiosk_units u where u.id = p_unit_id and u.kind <> 'QUIOSQUE')))
     and gp.expires_at_ms > (extract(epoch from now()) * 1000)::bigint
     and gp.remaining_minutes > 0
   order by (gp.unit_id = p_unit_id) desc, gp.expires_at_ms asc
$$ language sql stable set search_path = public;

revoke all on function fa_kiosk_child_package_list(uuid, uuid) from public;
grant execute on function fa_kiosk_child_package_list(uuid, uuid) to authenticated, service_role;
