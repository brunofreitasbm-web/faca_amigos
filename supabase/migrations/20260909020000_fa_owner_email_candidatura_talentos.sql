-- E-mail das candidaturas do Banco de Talentos (formulário da landing).
--
-- O gatilho fa_owner_notify_job_application já enfileirava a notificação
-- com report_type 'CANDIDATURA_TALENTOS', mas fa_owner_email_claim_due só
-- reclamava os tipos de caixa (ABERTURA/FECHAMENTO/DIVERGENCIA_*) — então
-- todo lead do formulário ficava parado na fila com emailed_at_ms nulo e
-- nunca virava e-mail. Nada a ver com provedor de envio: o SMTP (Gmail) vem
-- funcionando; a linha simplesmente nunca era selecionada.
create or replace function public.fa_owner_email_claim_due(p_now_ms bigint)
returns table(notification_id uuid, title text, body text, recipient_email text, photo_url text)
language sql
security definer
set search_path to 'public', 'pg_temp'
as $function$
  with due as (
    update fa_kiosk_owner_notifications
    set emailed_at_ms = p_now_ms
    where emailed_at_ms is null
      and due_at_ms <= p_now_ms
      and report_type in (
        'ABERTURA', 'FECHAMENTO', 'DIVERGENCIA_FECHAMENTO', 'DIVERGENCIA_ABERTURA',
        'CANDIDATURA_TALENTOS'
      )
    returning id, title, body, photo_url
  )
  select d.id, d.title, d.body, e.email, d.photo_url
  from due d
  cross join fa_kiosk_employees e
  where e.role = 'ADMIN' and e.email is not null and length(trim(e.email)) > 0;
$function$;
