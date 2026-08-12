-- Correções da auditoria de segurança de 2026-08-10 (itens 1, 2, 4, 5).
--
-- Contexto: uma migração aplicada diretamente em produção (fora do
-- histórico versionado — "fa_kiosk_backoffice_schema") criou uma policy
-- `authenticated_full_access using(true)` em 13 tabelas centrais,
-- silenciosamente derrubando o RBAC granular de 20260807000002-6: com
-- ela, qualquer login por PIN (mesmo OPERADOR) podia ler/editar/apagar
-- qualquer linha via REST direto, sem passar por fa_kiosk_can().
--
-- Também foi descoberto um bug de causa-raiz em ALTER DEFAULT PRIVILEGES:
-- toda função e tabela nova criada pelo role `postgres` (dono das
-- migrações) herdava grant total para `anon` por padrão — por isso um
-- `revoke execute ... from public` em fa_push_claim_due (20260810000001)
-- não bastou: o grant explícito a `anon` sobrevive a esse revoke, porque
-- foi aplicado via default ACL, não via PUBLIC.

-- =====================================================================
-- 1) authenticated_full_access: dropar nas 13 tabelas. Confirmado ao
--    vivo que toda tabela já tem `fa_kiosk_read_authenticated` (SELECT)
--    e que toda escrita de aplicação passa por RPCs SECURITY DEFINER
--    (fa_checkin, fa_checkout, fa_create_pdv_order, ...) de propriedade
--    de `postgres`, que tem BYPASSRLS — ou seja, elas não dependem
--    dessa policy para funcionar.
-- =====================================================================
drop policy if exists authenticated_full_access on fa_kiosk_child_guardians;
drop policy if exists authenticated_full_access on fa_kiosk_children;
drop policy if exists authenticated_full_access on fa_kiosk_employees;
drop policy if exists authenticated_full_access on fa_kiosk_guardians;
drop policy if exists authenticated_full_access on fa_kiosk_loyalty_rules;
drop policy if exists authenticated_full_access on fa_kiosk_order_items;
drop policy if exists authenticated_full_access on fa_kiosk_orders;
drop policy if exists authenticated_full_access on fa_kiosk_payments;
drop policy if exists authenticated_full_access on fa_kiosk_plans;
drop policy if exists authenticated_full_access on fa_kiosk_products;
drop policy if exists authenticated_full_access on fa_kiosk_sessions;
drop policy if exists authenticated_full_access on fa_kiosk_units;
drop policy if exists authenticated_full_access on fa_kiosk_visit_log;

-- =====================================================================
-- 2) RPCs financeiras executáveis por `anon` sem prova de identidade.
--    Revoga explicitamente de anon/authenticated e regrant só para
--    quem precisa (fa_units_cash_status/fa_units_envelope_balance são
--    lidas pela tela de gerência, exigem sessão autenticada; as demais
--    são chamadas só pelo backend/cron via service_role).
-- =====================================================================
revoke execute on function fa_collect_envelopes(text, uuid, uuid) from anon;
revoke execute on function fa_record_cash_movement(text, uuid, text, integer, text, uuid, text, text) from anon;
revoke execute on function fa_units_cash_status() from anon;
revoke execute on function fa_units_envelope_balance() from anon;

-- fa_push_claim_due: só o pg_cron (service_role) deve chamar; o revoke
-- de PUBLIC em 20260810000001 não removeu os grants individuais
-- herdados via default ACL.
revoke execute on function fa_push_claim_due(bigint) from anon;
revoke execute on function fa_push_claim_due(bigint) from authenticated;
grant execute on function fa_push_claim_due(bigint) to service_role;

-- =====================================================================
-- Causa-raiz: ALTER DEFAULT PRIVILEGES do role `postgres` concedia a
-- `anon` privilégio total em toda TABELA nova e EXECUTE em toda FUNÇÃO
-- nova criada em `public`. Isso é o que fez os buracos "temporários"
-- reaparecerem repetidas vezes. Remove o default para `anon` — tabelas
-- e funções novas passam a exigir grant explícito para esse role.
-- (Funcionalidades públicas legítimas, como o rastreamento via
-- fa_acompanhar_*, continuam funcionando: são SECURITY DEFINER de
-- propriedade de `postgres`, com BYPASSRLS, e já têm EXECUTE concedido
-- explicitamente — não dependem do default ACL.)
-- =====================================================================
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke execute on functions from anon;

-- =====================================================================
-- 4) Buckets carrinho-fotos e envelope-fotos: policy `for all to anon
--    using(true)` permitia upload/overwrite/delete irrestrito por
--    qualquer visitante. Troca por policy de INSERT apenas, restrita a
--    `authenticated` (o login por PIN já está em produção — ver
--    supabase/functions/login-pin). carrinho-fotos já tinha a policy
--    authenticated equivalente; envelope-fotos não tinha nenhuma.
-- =====================================================================
drop policy if exists fa_kiosk_carrinho_fotos_write_anon_temp on storage.objects;
drop policy if exists fa_kiosk_envelope_fotos_write_anon_temp on storage.objects;
drop policy if exists fa_kiosk_envelope_fotos_write_authenticated on storage.objects;

create policy fa_kiosk_envelope_fotos_write_authenticated on storage.objects
  for insert to authenticated
  with check (bucket_id = 'envelope-fotos');

update storage.buckets
  set file_size_limit = 8388608, -- 8 MiB
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
  where id in ('carrinho-fotos', 'envelope-fotos');

-- =====================================================================
-- 5) fa_kiosk_assets: policy de escrita `anon` (20260806000017) nunca
--    foi revertida pelo hardening de 20260807000003, que só cuidou do
--    SELECT. Equipamento de parquinho (status/manutenção) ficava
--    editável por qualquer visitante não autenticado.
--
--    A tabela já tem `fa_kiosk_write_owner` (authenticated +
--    fa_kiosk_can('config.write')), mas essa capability é só de ADMIN
--    (ver fa_kiosk_role_capabilities) — e `client.ts` chama
--    `setAssetStatus`/`setAssetPhoto` (marcar carrinho em uso/manutenção,
--    trocar foto) como UPDATE direto na tabela, tarefa operacional do
--    dia a dia, não configuração de catálogo. Sem uma policy própria,
--    remover o anon quebraria esse fluxo para OPERADOR/GERENTE. Cobre
--    só UPDATE (sem insert/delete) para qualquer funcionário logado —
--    ainda assim bem mais restrito que o "for all to anon" anterior.
-- =====================================================================
drop policy if exists fa_kiosk_assets_write_anon_temp on fa_kiosk_assets;
drop policy if exists fa_kiosk_assets_update_authenticated on fa_kiosk_assets;

create policy fa_kiosk_assets_update_authenticated on fa_kiosk_assets
  for update to authenticated
  using (true)
  with check (true);
