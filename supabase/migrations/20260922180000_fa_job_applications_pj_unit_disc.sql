-- Banco de Talentos — três ajustes na candidatura pública:
--
-- 1. opportunity_type aceita 'PJ': a landing page oferece PJ no formulário,
--    mas o CHECK (e a edge function) só aceitavam ESTAGIO/REMUNERADO/BOLSA,
--    então o candidato PJ recebia erro e a candidatura se perdia.
-- 2. preferred_unit: a landing envia a unidade preferida e a function
--    descartava o campo.
-- 3. Envio automático do Levantamento de Perfil DISC: a cada candidatura nova,
--    POST (pg_net) para a edge function auto-send-disc-assessment do projeto
--    Gestão de Pessoas (repo controle-de-estagiario), que gera o link e manda
--    o e-mail ao candidato. URL e segredo ficam no Vault, nunca no repositório:
--
--      select vault.create_secret('https://<ref>.supabase.co/functions/v1/auto-send-disc-assessment', 'disc_auto_webhook_url');
--      select vault.create_secret('<mesmo valor de DISC_AUTO_WEBHOOK_SECRET>', 'disc_auto_webhook_secret');
--
--    Sem os dois segredos o trigger não faz nada. Qualquer erro vira warning:
--    a candidatura nunca deixa de ser gravada por causa do e-mail. O
--    resultado da chamada fica em net._http_response (e no fa-health).

alter table fa_kiosk_job_applications
  drop constraint if exists fa_kiosk_job_applications_opportunity_type_check;
alter table fa_kiosk_job_applications
  add constraint fa_kiosk_job_applications_opportunity_type_check
  check (opportunity_type in ('ESTAGIO', 'REMUNERADO', 'BOLSA', 'PJ'));

alter table fa_kiosk_job_applications add column if not exists preferred_unit text;

create or replace function fa_job_application_disc_dispatch() returns trigger as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'disc_auto_webhook_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'disc_auto_webhook_secret';
  if v_url is null or v_secret is null then
    return new;
  end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret),
    body := jsonb_build_object(
      'candidateId', new.id::text,
      'fullName', new.full_name,
      'email', new.email,
      'phone', new.phone
    ),
    timeout_milliseconds := 10000
  );
  return new;
exception when others then
  raise warning 'fa_job_application_disc_dispatch: %', sqlerrm;
  return new;
end;
$$ language plpgsql volatile security definer set search_path = public, extensions;

revoke all on function fa_job_application_disc_dispatch() from public, anon, authenticated;

drop trigger if exists trg_fa_job_application_disc on fa_kiosk_job_applications;
create trigger trg_fa_job_application_disc
  after insert on fa_kiosk_job_applications
  for each row execute function fa_job_application_disc_dispatch();
