-- Aviso no check-in: saldo de pacote que existe, mas em OUTRO responsável.
--
-- O saldo de pacote (fa_kiosk_guardian_packages) é abatido no checkout só
-- quando o responsável da sessão é o mesmo de quem comprou
-- (fa_kiosk_package_consume). Se o check-in resolver outro responsável —
-- cadastro duplicado, CPF/telefone digitado diferente, pacote gravado no
-- responsável errado — a criança é cobrada como avulsa e ninguém percebe até
-- o cliente reclamar no caixa.
--
-- Esta função devolve os saldos válidos da unidade que NÃO pertencem ao
-- responsável que o check-in vai usar (mesma resolução de fa_checkin: CPF,
-- depois telefone) mas estão ligados à família: comprados para esta criança,
-- de outro responsável vinculado a ela, ou de outro cadastro com o mesmo
-- CPF/telefone. Só leitura; a tela usa para avisar o operador.

create or replace function fa_kiosk_foreign_package_balance(
  p_unit_id uuid, p_child_id uuid, p_cpf text, p_phone_e164 text
) returns table (
  guardian_package_id uuid, guardian_id uuid, guardian_name text,
  package_name text, remaining_minutes integer, expires_at_ms bigint
) as $$
declare
  v_now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
  v_own uuid := null;
  v_cpf text := nullif(p_cpf, '');
  v_phone text := nullif(p_phone_e164, '');
begin
  if v_cpf is not null then
    select g.id into v_own from fa_kiosk_guardians g where g.cpf = v_cpf limit 1;
  end if;
  if v_own is null and v_phone is not null then
    select g.id into v_own from fa_kiosk_guardians g where g.phone_e164 = v_phone limit 1;
  end if;

  return query
    select gp.id, gp.guardian_id, g.full_name, gp.package_name_snapshot,
           gp.remaining_minutes, gp.expires_at_ms
      from fa_kiosk_guardian_packages gp
      join fa_kiosk_guardians g on g.id = gp.guardian_id
     where gp.unit_id = p_unit_id
       and gp.expires_at_ms > v_now_ms
       and gp.remaining_minutes > 0
       and (v_own is null or gp.guardian_id <> v_own)
       and (
         gp.child_id = p_child_id
         or gp.guardian_id in (select cg.guardian_id from fa_kiosk_child_guardians cg where cg.child_id = p_child_id)
         or (v_cpf is not null and g.cpf = v_cpf)
         or (v_phone is not null and g.phone_e164 = v_phone)
       )
       -- Se o responsável do check-in já tem saldo próprio, ele é abatido
       -- primeiro e não há surpresa de cobrança: sem aviso.
       and not exists (
         select 1 from fa_kiosk_guardian_packages own
          where own.guardian_id = v_own and own.unit_id = p_unit_id
            and own.expires_at_ms > v_now_ms and own.remaining_minutes > 0
       )
     order by gp.expires_at_ms asc;
end;
$$ language plpgsql stable security definer set search_path = public, pg_temp;

revoke all on function fa_kiosk_foreign_package_balance(uuid, uuid, text, text) from public;
grant execute on function fa_kiosk_foreign_package_balance(uuid, uuid, text, text) to authenticated, service_role;
