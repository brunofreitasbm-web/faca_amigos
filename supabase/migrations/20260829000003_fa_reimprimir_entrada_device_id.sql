-- fa_reimprimir_entrada não passava p_device_id para
-- fa_kiosk_enqueue_entry_prints, então todo job de reimpressão saía sem
-- origin_device_id — e por origin_device_id nulo ser aceito por qualquer
-- terminal da unidade (ver 20260828210000), uma reimpressão pedida no
-- terminal de uma unidade saía também na impressora da outra unidade
-- (Circuito e Playground compartilham o mesmo unit_id).

create or replace function fa_reimprimir_entrada(
  p_session_id uuid,
  p_employee_id uuid default null,
  p_device_id text default null
)
returns jsonb as $$
declare v_s record;
begin
  select * into v_s from fa_kiosk_sessions where id = p_session_id;
  if not found then raise exception 'SESSAO_NAO_ENCONTRADA'; end if;
  if v_s.access_code is null then
    update fa_kiosk_sessions set access_code = fa_kiosk_new_access_code() where id = p_session_id;
    select * into v_s from fa_kiosk_sessions where id = p_session_id;
  end if;
  perform fa_kiosk_enqueue_entry_prints(p_session_id, p_device_id);
  perform fa_kiosk_log_session_event(p_session_id, 'REIMPRESSAO_ENTRADA', p_employee_id, null);
  return jsonb_build_object('accessCode', v_s.access_code);
end;
$$ language plpgsql volatile security definer set search_path = public, pg_temp;
