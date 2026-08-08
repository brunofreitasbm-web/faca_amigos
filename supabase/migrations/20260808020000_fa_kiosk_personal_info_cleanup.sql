-- Ajustes pós-lançamento do cadastro por convite:
-- 1) O módulo "Cadastro de Colaboradores" (self-service para quem já tinha
--    conta) foi removido — o único fluxo agora é o convite individual, que
--    grava direto via service role na Edge Function onboarding-complete,
--    nunca através das RPCs abaixo. Ficam órfãs, então saem.
-- 2) Campo "Cor da pele" (raça/cor) removido do cadastro por pedido do
--    usuário — a coluna sai junto.

drop function if exists fa_kiosk_update_own_personal_info(jsonb);
drop function if exists fa_kiosk_my_personal_info();
drop function if exists fa_kiosk_update_own_pix(text);
drop function if exists fa_kiosk_my_pix();

alter table fa_kiosk_employee_personal_info drop column if exists raca_cor;
