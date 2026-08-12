-- Permitir SELECT em fa_kiosk_my_capabilities para a role 'anon'.
-- Quando não há sessão Supabase Auth ativa (auth.uid() IS NULL), a view retorna 0 linhas (200 OK com array vazio)
-- em vez de bloqueio HTTP 403 Forbidden.

grant select on fa_kiosk_my_capabilities to anon;
