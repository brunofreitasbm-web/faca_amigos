-- Web Push "O Olhar FaçaAmigos está pronto" para o responsável.
--
-- Reaproveita fa_kiosk_push_subscriptions e o cron push-alert-dispatch (a cada
-- minuto). O aviso de fim de tempo saiu do painel (virou WhatsApp), então as
-- inscrições do Olhar entram com o alerta de tempo já consumido (sent_at_ms
-- preenchido): fa_push_claim_due não as pega e ninguém recebe aviso de tempo
-- que não pediu.
--
-- O push NÃO leva o token do PDF: só abre o painel (?acompanhar=<código>), que
-- já mostra o OlharCard com o botão.

alter table fa_kiosk_push_subscriptions
  add column if not exists olhar_notified_at_ms bigint;

create index if not exists idx_fa_push_subs_olhar_pending
  on fa_kiosk_push_subscriptions (session_id) where olhar_notified_at_ms is null;

-- ---------------------------------------------------------------------
-- Inscrição pública (painel do responsável)
-- ---------------------------------------------------------------------
-- anon chama com o código da sessão. O endpoint é uma URL que o servidor vai
-- acionar, então só aceita os serviços de push conhecidos (evita usar a função
-- para fazer POST em endereço arbitrário) e limita inscrições por sessão.
create or replace function fa_acompanhar_registrar_push_olhar(
  p_code text, p_endpoint text, p_p256dh text, p_auth text
) returns jsonb as $$
declare
  v_code text := fa_kiosk_normalize_access_code(p_code);
  v_s record;
  v_now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  if v_code = '' or not fa_kiosk_verify_access_code(v_code) then
    raise exception 'CODIGO_INVALIDO';
  end if;
  if p_endpoint is null or length(p_endpoint) > 1000
     or p_endpoint !~ '^https://(fcm\.googleapis\.com|[a-z0-9-]+\.push\.services\.mozilla\.com|[a-z0-9.-]*push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)/'
     or coalesce(length(p_p256dh), 0) not between 20 and 200
     or coalesce(length(p_auth), 0) not between 10 and 100 then
    raise exception 'ENDPOINT_INVALIDO';
  end if;

  select * into v_s from fa_kiosk_sessions where access_code = v_code;
  if not found then
    raise exception 'SESSAO_NAO_ENCONTRADA';
  end if;
  -- Depois do checkout só vale enquanto o Olhar ainda pode sair.
  if v_s.status = 'FINALIZADA' and coalesce(v_s.checkout_at_ms, 0) < v_now_ms - 86400000 then
    raise exception 'SESSAO_ENCERRADA';
  end if;
  if exists (
    select 1 from fa_kiosk_session_reports r
    where r.session_id = v_s.id and r.pdf_path is not null and r.public_token is not null
  ) then
    return jsonb_build_object('status', 'JA_PRONTO');
  end if;
  if (select count(*) from fa_kiosk_push_subscriptions where session_id = v_s.id) >= 5
     and not exists (select 1 from fa_kiosk_push_subscriptions where session_id = v_s.id and endpoint = p_endpoint) then
    raise exception 'LIMITE_DE_INSCRICOES';
  end if;

  insert into fa_kiosk_push_subscriptions (session_id, endpoint, p256dh, auth, alert_due_at_ms, sent_at_ms)
    values (v_s.id, p_endpoint, p_p256dh, p_auth, v_now_ms, v_now_ms)
    on conflict (session_id, endpoint) do update
      set p256dh = excluded.p256dh, auth = excluded.auth;

  return jsonb_build_object('status', 'OK');
end;
$$ language plpgsql volatile security definer set search_path = public, pg_temp;

revoke execute on function fa_acompanhar_registrar_push_olhar(text, text, text, text) from public;
grant execute on function fa_acompanhar_registrar_push_olhar(text, text, text, text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- Reivindicação atômica (só service_role, chamada pelo push-alert-dispatch)
-- ---------------------------------------------------------------------
-- Pega as inscrições cuja sessão já tem o PDF gerado e que ainda não foram
-- avisadas. Só relatórios gerados nas últimas 24 h: inscrições antigas nunca
-- disparam aviso atrasado. Cada inscrição é avisada uma vez (regerar o PDF não
-- repete).
create or replace function fa_push_claim_olhar(p_now_ms bigint) returns table (
  endpoint text, p256dh text, auth text, access_code text, child_first_name text
) as $$
begin
  return query
  update fa_kiosk_push_subscriptions ps
  set olhar_notified_at_ms = p_now_ms
  from fa_kiosk_sessions s
  where ps.session_id = s.id
    and ps.olhar_notified_at_ms is null
    and exists (
      select 1 from fa_kiosk_session_reports r
      where r.session_id = s.id
        and r.pdf_path is not null
        and r.public_token is not null
        and r.pdf_generated_at_ms > p_now_ms - 86400000
    )
  returning ps.endpoint, ps.p256dh, ps.auth, s.access_code, split_part(s.child_name_snapshot, ' ', 1);
end;
$$ language plpgsql volatile security definer set search_path = public, pg_temp;

-- O Supabase concede EXECUTE direto a anon/authenticated em funções novas; `from public` não remove.
-- Esta função devolve chaves de push e códigos de acesso: só o service_role pode chamar.
revoke execute on function fa_push_claim_olhar(bigint) from public, anon, authenticated;
grant execute on function fa_push_claim_olhar(bigint) to service_role;
