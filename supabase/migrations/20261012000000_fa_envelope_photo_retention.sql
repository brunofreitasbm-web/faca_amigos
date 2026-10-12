-- Retenção de 5 dias para fotos de envelopes já RECOLHIDOS (bucket público
-- `envelope-fotos`, coluna fa_kiosk_cash_movements.photo_url). Depois que o
-- gestor leva o envelope (collected_at_ms preenchido, ver
-- 20260808090000_fa_envelope_saldo_recolhimento), a foto só serve de
-- conferência por alguns dias; envelopes ainda PENDENTES nunca são tocados.
-- A sangria em si (valor, motivo, número do envelope) continua para sempre —
-- só a foto e sua referência são apagadas, e a aba "Fotos de Envelope" já
-- trata photo_url nulo.
--
-- Mesmo padrão de fa_kiosk_ponto_photo_retention_claim: RPC SECURITY DEFINER,
-- só para service_role, que reivindica atomicamente um lote (UPDATE...RETURNING
-- com FOR UPDATE SKIP LOCKED). Ela limpa a referência no banco; quem apaga o
-- arquivo do Storage é a edge function envelope-photo-retention-dispatch.
create or replace function fa_envelope_photo_retention_claim(p_cutoff_ms bigint, p_limit integer default 200)
returns table (id uuid, photo_url text) as $$
  with candidates as (
    select m.id, m.photo_url
    from fa_kiosk_cash_movements m
    where m.photo_url is not null
      and m.collected_at_ms is not null
      and m.collected_at_ms < p_cutoff_ms
    order by m.collected_at_ms
    limit p_limit
    for update skip locked
  )
  update fa_kiosk_cash_movements m
  set photo_url = null
  from candidates c
  where m.id = c.id
  returning m.id, c.photo_url;
$$ language sql volatile security definer set search_path = public, pg_temp;

revoke execute on function fa_envelope_photo_retention_claim(bigint, integer) from public, anon, authenticated;
grant execute on function fa_envelope_photo_retention_claim(bigint, integer) to service_role;

do $$
begin
  perform cron.unschedule('fa-envelope-photo-retention');
exception when others then null;
end $$;

-- 1x/dia às 05:30 UTC, fora do horário de funcionamento.
select cron.schedule(
  'fa-envelope-photo-retention',
  '30 5 * * *',
  $$ select net.http_post(
       url := 'https://ivjvpdzsfjdpyabbzzuj.supabase.co/functions/v1/envelope-photo-retention-dispatch',
       headers := '{"Content-Type":"application/json"}'::jsonb,
       body := '{}'::jsonb
     ); $$
);
