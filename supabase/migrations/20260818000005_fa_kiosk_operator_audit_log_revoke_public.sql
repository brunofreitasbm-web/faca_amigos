-- Funções de trigger não podem ser chamadas fora do contexto de trigger
-- (Postgres recusa em runtime), mas o Postgres ainda concede EXECUTE a
-- PUBLIC por padrão, o que expõe cada uma como RPC pública no PostgREST e
-- dispara o advisor "SECURITY DEFINER function executable by anon". Fecha
-- essa via de chamada, seguindo o mesmo padrão de fa_config_rpc.sql.
revoke execute on function fa_kiosk_audit_ponto_trg() from public, anon, authenticated;
revoke execute on function fa_kiosk_audit_session_checkin_trg() from public, anon, authenticated;
revoke execute on function fa_kiosk_audit_session_finish_trg() from public, anon, authenticated;
revoke execute on function fa_kiosk_audit_shift_open_trg() from public, anon, authenticated;
revoke execute on function fa_kiosk_audit_shift_close_trg() from public, anon, authenticated;
revoke execute on function fa_kiosk_audit_cash_movement_trg() from public, anon, authenticated;
revoke execute on function fa_kiosk_audit_envelope_collect_trg() from public, anon, authenticated;
