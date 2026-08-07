-- Restaura, só em fa_kiosk_employees, a leitura anônima removida por
-- 20260806000026_fa_kiosk_ponto_revert_anon.sql.
--
-- Motivo: o login do kiosk-ui continua "temporariamente oculto" a pedido
-- do dono (ver AppState.tsx) — na entrada do app, `Api.employees()` roda
-- como `anon` para auto-selecionar o primeiro colaborador e pular a tela
-- de login. Com a SELECT de `anon` removida pela migration 26, essa busca
-- sempre voltava 0 linhas, `employee` nunca era definido, e o app ficava
-- preso permanentemente em `<LoginScreen/>` mesmo estando "oculto" por
-- design — daí a tela de login "continuar aparecendo".
--
-- fa_kiosk_local_credentials, fa_kiosk_ponto_records e fa_kiosk_audit_log
-- permanecem só para `authenticated`: essas seguem exigindo o login real
-- via EmployeeAuthGate (bater ponto, cadastrar colaborador), que não foi
-- afetado por este bug e continua como estava.

drop policy if exists fa_kiosk_read_anon_temp on fa_kiosk_employees;
create policy fa_kiosk_read_anon_temp on fa_kiosk_employees for select to anon using (true);
