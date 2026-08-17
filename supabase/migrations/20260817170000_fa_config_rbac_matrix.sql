-- Tela Gerencial > Permissões: permite ao Owner editar, capacidade por
-- capacidade, qual é o papel MÍNIMO que a possui (Operador/Líder/Owner).
--
-- fa_kiosk_role_capabilities já era a fonte única da verdade (migration
-- 20260807000002); o que faltava era uma porta de escrita para o cliente,
-- já que a tabela crua tem RLS sem nenhuma policy. As duas RPCs abaixo são
-- essa porta — list para montar a matriz na tela, set para gravar 1 troca.
--
-- Cada capacidade sempre mapeia para exatamente 1 papel (é a chave primária
-- (role, capability) com role variável): trocar o papel de uma capacidade é
-- um delete+insert atômico, nunca um insert solto que deixaria a capacidade
-- com dois "mínimos" ao mesmo tempo. Isso também é o que impede o Owner de
-- se autoexcluir por engano — ADMIN tem o maior rank (fa_kiosk_role_rank),
-- então `rank(role) <= rank(ADMIN)` é sempre verdadeiro não importa qual
-- papel vira o mínimo de uma capacidade.
create or replace function fa_config_list_role_capabilities()
returns table (role text, capability text) as $$
begin
  if not fa_kiosk_can('config.rbac.write') then
    raise exception 'sem permissão para ver a matriz de permissões' using errcode = '42501';
  end if;

  return query select rc.role, rc.capability from fa_kiosk_role_capabilities rc;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function fa_config_list_role_capabilities() from public, anon;
grant execute on function fa_config_list_role_capabilities() to authenticated;

create or replace function fa_config_set_capability_role(p_capability text, p_role text) returns void as $$
declare
  v_old text;
begin
  if not fa_kiosk_can('config.rbac.write') then
    raise exception 'sem permissão para editar a matriz de permissões' using errcode = '42501';
  end if;
  if p_role not in ('OPERADOR', 'GERENTE', 'ADMIN') then
    raise exception 'papel inválido' using errcode = '22023';
  end if;

  select role into v_old from fa_kiosk_role_capabilities where capability = p_capability;
  if v_old is null then
    raise exception 'capacidade não encontrada' using errcode = 'P0002';
  end if;

  delete from fa_kiosk_role_capabilities where capability = p_capability;
  insert into fa_kiosk_role_capabilities (role, capability) values (p_role, p_capability);

  perform fa_config_audit('CONFIG_RBAC_CAPABILITY_ROLE_CHANGE',
                          jsonb_build_object('capability', p_capability, 'from', v_old, 'to', p_role));
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function fa_config_set_capability_role(text, text) from public, anon;
grant execute on function fa_config_set_capability_role(text, text) to authenticated;

-- Capacidade própria para esta tela — dedicada em vez de reusar
-- config.write, para o Owner poder no futuro delegar "quem edita
-- permissões" separadamente de "quem edita planos/preços/cupons" sem
-- reabrir esta migration. Hoje só ADMIN a possui.
insert into fa_kiosk_role_capabilities (role, capability) values
  ('ADMIN', 'config.rbac.write')
on conflict do nothing;
