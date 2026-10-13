-- Telegram: FECHAMENTO e DIVERGENCIA_FECHAMENTO de um mesmo fechamento viravam
-- duas mensagens com o mesmo assunto. Agora sai só o FECHAMENTO (que já traz o
-- bloco de divergências) e ele leva os botões Conferido / Pedir justificativa /
-- Pendência, gravados no id da DIVERGENCIA_FECHAMENTO (é esse id que
-- fa_owner_divergence_status e o owner-telegram-webhook conhecem).
--
-- As duas notificações nascem na mesma transação de fa_owner_notify_on_shift_change
-- (now() constante), então o par é (unit_id, due_at_ms). Push e e-mail seguem
-- recebendo as duas, como antes. Divergência abaixo do limiar continua sem
-- alerta e sem botões; o FECHAMENTO dela sai normal.
--
-- Muda o tipo de retorno (nova coluna divergence_id), por isso drop + create.
drop function if exists public.fa_owner_telegram_claim_due(bigint);

create function public.fa_owner_telegram_claim_due(p_now_ms bigint)
 returns table(
   notification_id uuid,
   report_type text,
   title text,
   body text,
   photo_url text,
   due_at_ms bigint,
   divergence_id uuid
 )
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
  -- divergência abaixo do limiar: não vira alerta avulso (continua no corpo do fechamento e no resumo do dia)
  update fa_kiosk_owner_notifications n
     set telegram_sent_at_ms = p_now_ms
   where n.telegram_sent_at_ms is null
     and n.due_at_ms <= p_now_ms
     and n.report_type in ('DIVERGENCIA_ABERTURA', 'DIVERGENCIA_FECHAMENTO')
     and n.amount_cents is not null
     and n.amount_cents < fa_owner_telegram_divergence_threshold();

  -- divergência do fechamento: a mensagem do FECHAMENTO do mesmo fechamento já
  -- a contém; não manda a segunda.
  update fa_kiosk_owner_notifications n
     set telegram_sent_at_ms = p_now_ms
   where n.telegram_sent_at_ms is null
     and n.due_at_ms <= p_now_ms
     and n.report_type = 'DIVERGENCIA_FECHAMENTO'
     and exists (
       select 1 from fa_kiosk_owner_notifications f
        where f.report_type = 'FECHAMENTO'
          and f.unit_id = n.unit_id
          and f.due_at_ms = n.due_at_ms
     );

  return query
  with claimed as (
    update fa_kiosk_owner_notifications n
       set telegram_sent_at_ms = p_now_ms
     where n.telegram_sent_at_ms is null
       and n.due_at_ms <= p_now_ms
       and n.report_type in (
         'ABERTURA', 'FECHAMENTO', 'DIVERGENCIA_ABERTURA', 'DIVERGENCIA_FECHAMENTO',
         'CANDIDATURA_TALENTOS', 'OCORRENCIA_COLABORADOR', 'AVALIACAO_NEGATIVA',
         'RESUMO_DIARIO', 'RESUMO_SEMANAL_CONSOLIDADO'
       )
    returning n.id, n.unit_id, n.report_type, n.title, n.body, n.photo_url, n.due_at_ms
  )
  select c.id, c.report_type, c.title, c.body, c.photo_url, c.due_at_ms,
         case when c.report_type = 'FECHAMENTO' then (
           select d.id from fa_kiosk_owner_notifications d
            where d.report_type = 'DIVERGENCIA_FECHAMENTO'
              and d.unit_id = c.unit_id
              and d.due_at_ms = c.due_at_ms
              and d.amount_cents >= fa_owner_telegram_divergence_threshold()
            limit 1
         ) end
    from claimed c;
end;
$function$;

revoke all on function public.fa_owner_telegram_claim_due(bigint) from public, anon, authenticated;
grant execute on function public.fa_owner_telegram_claim_due(bigint) to service_role;
