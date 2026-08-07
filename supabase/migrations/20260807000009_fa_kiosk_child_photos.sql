-- Foto opcional da criança, capturada pela câmera no formulário de cadastro
-- (webcam apenas — sem upload de arquivo) para identificação visual pelo
-- monitor no salão.
--
-- ⚠️ Ao contrário de `carrinho-fotos` (migration 20260806000017), este
-- bucket NÃO é público: é foto de criança, dado sensível para fins de LGPD,
-- diferente de foto de equipamento. A escrita do caminho na tabela também
-- não usa policy de UPDATE direto — segue a mesma regra documentada na
-- migration 20260806000016 ("INSERT/UPDATE continuam só via função
-- SECURITY DEFINER"), então o caminho é gravado por `fa_set_child_photo_path`.
alter table fa_kiosk_children add column if not exists photo_path text;

insert into storage.buckets (id, name, public)
values ('crianca-fotos', 'crianca-fotos', false)
on conflict (id) do nothing;

-- Upload liberado ao `anon` pela mesma razão temporária das demais escritas
-- deste app (kiosk-ui ainda sem sessão Supabase Auth — ver migration
-- 20260806000016). Sem SELECT para anon: a foto não é lida de volta por
-- este formulário, e nada aqui deve virar uma URL pública.
drop policy if exists fa_kiosk_crianca_fotos_write_anon_temp on storage.objects;
create policy fa_kiosk_crianca_fotos_write_anon_temp on storage.objects for insert to anon
  with check (bucket_id = 'crianca-fotos');

create or replace function fa_set_child_photo_path(p_child_id uuid, p_photo_path text) returns void as $$
begin
  update fa_kiosk_children set photo_path = p_photo_path where id = p_child_id;
  if not found then raise exception 'CRIANCA_NAO_ENCONTRADA'; end if;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;
