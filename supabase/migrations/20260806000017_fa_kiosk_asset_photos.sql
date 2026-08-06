-- Foto do carrinho (JPG/PNG), cadastrada em Configurações → Frota e
-- exibida no Painel para sessões de CARRINHO.
alter table fa_kiosk_assets add column if not exists photo_url text;

-- Escrita direta de fa_kiosk_assets pelo cliente anônimo: mesma situação
-- temporária da migration 16 (login do kiosk-ui oculto a pedido do dono,
-- sem sessão Supabase Auth) — sem isto, Configurações → Frota (criar
-- carrinho / trocar foto) falha por RLS, já que a migration 09 só libera
-- escrita para `authenticated` com papel GERENTE/ADMIN. Reverter junto
-- com a 16 quando o login real (Fase 1) voltar a ser exigido.
drop policy if exists fa_kiosk_assets_write_anon_temp on fa_kiosk_assets;
create policy fa_kiosk_assets_write_anon_temp on fa_kiosk_assets for all to anon using (true) with check (true);

-- Bucket de fotos de carrinho — leitura pública (Painel/Entrada exibem a
-- foto sem autenticação), upload liberado ao anon pela mesma razão acima.
insert into storage.buckets (id, name, public)
values ('carrinho-fotos', 'carrinho-fotos', true)
on conflict (id) do nothing;

drop policy if exists fa_kiosk_carrinho_fotos_read on storage.objects;
create policy fa_kiosk_carrinho_fotos_read on storage.objects for select
  using (bucket_id = 'carrinho-fotos');

drop policy if exists fa_kiosk_carrinho_fotos_write_anon_temp on storage.objects;
create policy fa_kiosk_carrinho_fotos_write_anon_temp on storage.objects for all to anon
  using (bucket_id = 'carrinho-fotos') with check (bucket_id = 'carrinho-fotos');
