-- ---------------------------------------------------------------------
-- Fix: Remove o overload legado de fa_owner_report_enqueue (6 parâmetros)
-- deixado no PostgreSQL após a adição do parâmetro p_photo_url.
--
-- Sem este DROP, chamadas com 5 argumentos literais (como no fa_owner_report_build_abertura)
-- causam o erro: function fa_owner_report_enqueue(uuid, unknown, date, text, text) is not unique.
-- ---------------------------------------------------------------------

-- 1. Remove todas as assinaturas antigas e sobrecarregadas
drop function if exists public.fa_owner_report_enqueue(uuid, text, date, text, text);
drop function if exists fa_owner_report_enqueue(uuid, text, date, text, text);
drop function if exists public.fa_owner_report_enqueue(uuid, text, date, text, text, text);
drop function if exists fa_owner_report_enqueue(uuid, text, date, text, text, text);
drop function if exists public.fa_owner_report_enqueue(uuid, text, date, text, text, text, text);
drop function if exists fa_owner_report_enqueue(uuid, text, date, text, text, text, text);

-- 2. Recria a assinatura atualizada e única com 7 parâmetros
create or replace function public.fa_owner_report_enqueue(
  p_unit_id uuid, p_report_type text, p_business_date date, p_title text, p_body text,
  p_dedupe_key text default null, p_photo_url text default null
) returns void as $$
begin
  if p_dedupe_key is not null then
    insert into fa_kiosk_owner_notifications (unit_id, report_type, business_date, title, body, due_at_ms, dedupe_key, photo_url)
      values (p_unit_id, p_report_type, p_business_date, p_title, p_body, (extract(epoch from now()) * 1000)::bigint, p_dedupe_key, p_photo_url)
      on conflict (report_type, dedupe_key) where dedupe_key is not null do nothing;
  else
    insert into fa_kiosk_owner_notifications (unit_id, report_type, business_date, title, body, due_at_ms, photo_url)
      values (p_unit_id, p_report_type, p_business_date, p_title, p_body, (extract(epoch from now()) * 1000)::bigint, p_photo_url)
      on conflict (unit_id, report_type, business_date) where dedupe_key is null do nothing;
  end if;
end;
$$ language plpgsql volatile security definer;
