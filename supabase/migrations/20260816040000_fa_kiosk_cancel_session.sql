-- Cancelar sessão sem checkout ("aceitei por engano", duplicidade, etc.).
-- A trava de quem pode fazer isso já existe desde a migration
-- fa_actor_integrity (fa_kiosk_guard_session_exception_trg): ela barra
-- qualquer UPDATE que leve fa_kiosk_sessions.status para FINALIZADA sem
-- checkout_at_ms preenchido, a menos que o autor tenha a capacidade
-- 'sessao.cancel'. Esta função só precisa fazer o UPDATE — a autorização
-- já é reforçada pelo trigger, no mesmo lugar que qualquer outra rota
-- (inclusive uma futura) teria que respeitar.

create or replace function fa_kiosk_cancel_session(p_session_id uuid, p_reason text default null) returns void as $$
begin
  update fa_kiosk_sessions set status = 'FINALIZADA' where id = p_session_id and status = 'ATIVA';
  if not found then raise exception 'SESSAO_NAO_ATIVA'; end if;
  perform fa_kiosk_log_session_event(p_session_id, 'CANCELADA', null, jsonb_build_object('reason', p_reason));
end;
$$ language plpgsql security definer;
