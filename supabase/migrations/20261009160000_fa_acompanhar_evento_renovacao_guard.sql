-- fa_acompanhar_evento é chamável por anon. Para RENOVACAO_SOLICITADA ela:
--   * gravava o evento sem olhar se já havia pedido aberto: o painel público
--     duplicava o pedido, que reaparecia depois do "Dar OK" do balcão;
--   * repassava o payload do chamador como veio. Agora que o OK troca o plano
--     sozinho (fa_kiosk_apply_renewal usa payload.minutes), o anônimo não pode
--     escolher o que entra: só `minutes` inteiro de 1 a 120 é aceito e o resto
--     do payload é descartado.
-- Pedido repetido com outro já aberto é no-op silencioso (idempotente).
create or replace function fa_acompanhar_evento(p_code text, p_kind text, p_payload jsonb default '{}'::jsonb) returns void as $$
declare
  v_code text := fa_kiosk_normalize_access_code(p_code);
  v_s record;
  v_last text;
  v_minutes integer;
  v_payload jsonb := p_payload;
begin
  if p_kind not in ('QR_ABERTO', 'LEMBRETE_ATIVADO', 'RENOVACAO_SOLICITADA') then
    raise exception 'TIPO_EVENTO_INVALIDO';
  end if;

  if v_code = '' or not fa_kiosk_verify_access_code(v_code) then
    raise exception 'CODIGO_INVALIDO';
  end if;

  select * into v_s from fa_kiosk_sessions where access_code = v_code and status <> 'FINALIZADA';
  if not found then
    raise exception 'SESSAO_NAO_ENCONTRADA';
  end if;

  if p_kind = 'RENOVACAO_SOLICITADA' then
    if v_s.status not in ('ATIVA', 'PAUSADA') then
      raise exception 'SESSAO_NAO_ENCONTRADA';
    end if;
    if jsonb_typeof(p_payload -> 'minutes') is distinct from 'number'
       or (p_payload ->> 'minutes') !~ '^[0-9]{1,3}$' then
      raise exception 'RENOVACAO_MINUTOS_INVALIDOS';
    end if;
    v_minutes := (p_payload ->> 'minutes')::integer;
    if v_minutes < 1 or v_minutes > 120 then
      raise exception 'RENOVACAO_MINUTOS_INVALIDOS';
    end if;

    -- Serializa pedidos simultâneos da mesma sessão.
    perform 1 from fa_kiosk_sessions where id = v_s.id for update;

    select e.kind into v_last from fa_kiosk_session_events e
     where e.session_id = v_s.id
       and e.kind in ('RENOVACAO_SOLICITADA', 'RENOVACAO_APLICADA', 'RENOVACAO_DISPENSADA')
     order by e.at_ms desc limit 1;
    if v_last = 'RENOVACAO_SOLICITADA' then
      return;
    end if;

    v_payload := jsonb_build_object('minutes', v_minutes, 'via', 'SITE');
  end if;

  perform fa_kiosk_log_session_event(v_s.id, p_kind, null, v_payload);
end;
$$ language plpgsql volatile security definer set search_path = public, pg_temp;

revoke execute on function fa_acompanhar_evento(text, text, jsonb) from public;
grant execute on function fa_acompanhar_evento(text, text, jsonb) to anon, authenticated, service_role;
