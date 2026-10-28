-- Bônus "1 hora + Olhar": a criança só conta se o Olhar FaçaAmigos da visita foi
-- preenchido em até 40 min da saída (fa_kiosk_session_reports.late = false).
-- Antes a regra contava toda sessão paga do plano de 1 hora (ver 20261003160000).
--
-- 1. Flag por regra, para o Owner ligar/desligar em Gerencial > Metas. Só faz
--    sentido em regra de PLANO (pacote não tem Olhar por sessão).
-- 2. Liga a flag na regra "1 hora + Olhar" do Playground (Parque Shopping).
-- 3. RPC que devolve só os ids das sessões com Olhar no prazo. O operador não
--    lê fa_kiosk_session_reports (RLS: relatorio_sessao.read ou quem preencheu),
--    e o Olhar costuma ser preenchido por outra pessoa da equipe; sem a RPC o
--    menu Minha Bonificação zeraria o bônus de quem fez o check-in.
--
-- Publicar ANTES do aplicativo: o app novo lê a coluna e chama a RPC.

alter table fa_kiosk_bonus_plan_rules
  add column if not exists exige_olhar_no_prazo boolean not null default false;

update fa_kiosk_bonus_plan_rules
   set exige_olhar_no_prazo = true,
       updated_at_ms = (extract(epoch from now()) * 1000)::bigint
 where unit_id = '11111111-1111-1111-1111-111111111111'
   and kind = 'PLANO'
   and ref_id = '26241007-1f11-4442-83de-7caa7805959e';

create or replace function fa_bonus_olhar_no_prazo(p_unit_ids uuid[], p_from date, p_to date)
returns table (session_id uuid) as $$
begin
  if not fa_kiosk_can('bonificacao.self') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  return query
    select r.session_id
    from fa_kiosk_session_reports r
    join fa_kiosk_sessions s on s.id = r.session_id
    where s.unit_id = any(p_unit_ids)
      and s.business_date between p_from and p_to
      and not r.late;
end;
$$ language plpgsql stable security definer set search_path = public, pg_temp;

revoke execute on function fa_bonus_olhar_no_prazo(uuid[], date, date) from public, anon;
grant execute on function fa_bonus_olhar_no_prazo(uuid[], date, date) to authenticated;
