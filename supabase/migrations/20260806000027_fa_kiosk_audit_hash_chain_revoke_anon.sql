-- get_advisors apontou fa_kiosk_audit_log_hash_chain() (trigger da trilha
-- de auditoria de ponto) como chamável direto via /rest/v1/rpc por `anon`
-- e por `authenticated` — ela só deveria rodar como trigger de INSERT em
-- fa_kiosk_audit_log, nunca invocada solta. Revoga a execução direta;
-- o disparo via trigger continua funcionando (não depende de EXECUTE).

revoke execute on function fa_kiosk_audit_log_hash_chain() from public, anon, authenticated;
