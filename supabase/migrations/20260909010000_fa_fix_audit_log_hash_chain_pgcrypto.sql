-- Corrige regressão introduzida pela migration de hardening
-- 20260909000001_fa_security_definer_search_path_hardening.sql: o loop de
-- ALTER FUNCTION reescreveu o search_path de TODA função SECURITY DEFINER
-- do schema public para 'public, pg_temp', apagando o schema 'extensions'
-- (onde mora o pgcrypto) que fa_kiosk_audit_log_hash_chain precisava para
-- resolver digest(). Resultado: qualquer insert em fa_kiosk_audit_log
-- (abrir caixa, entre outras ações que geram log) passou a falhar com
-- "function digest(bytea, unknown) does not exist".
--
-- Fix definitivo (não regride de novo se um hardening futuro rodar o
-- mesmo loop): qualifica a chamada com o schema em vez de depender do
-- search_path incluir 'extensions'.
create or replace function fa_kiosk_audit_log_hash_chain() returns trigger as $$
declare
  last_hash text;
begin
  select self_hash into last_hash from fa_kiosk_audit_log order by at_ms desc, id desc limit 1;
  new.prev_hash := last_hash;
  new.self_hash := encode(
    extensions.digest(convert_to(coalesce(last_hash, '') || new.id::text || new.at_ms::text || new.action || coalesce(new.details_json::text, ''), 'UTF8'), 'sha256'),
    'hex'
  );
  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;
