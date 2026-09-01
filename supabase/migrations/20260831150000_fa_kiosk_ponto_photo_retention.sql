-- Retenção de 45 dias para fotos de marcação de ponto (bucket `ponto-fotos`,
-- coluna fa_kiosk_ponto_records.punch_photo_path). O reconhecimento facial em
-- si já roda inteiramente no cliente antes do upload (comparação do
-- descriptor contra o cadastro — ver useFaceCapture/faceRecognition.ts no
-- kiosk-ui), então a foto não participa da validação: ela só existe como
-- evidência visual que o gestor confere na aba Frequência (comparação foto
-- da marcação × foto cadastrada, PhotoCompareModal). Não há motivo pra
-- guardar isso indefinidamente, mas a marcação em si (NSR, tipo, horário)
-- continua para sempre — só a foto e sua referência são apagadas depois de
-- 45 dias. Isso não fere o princípio de imutabilidade auditável do ponto
-- (fa_kiosk_ponto_records sem policy de update/delete para o app, ver
-- fa_kiosk_ponto_audit/fa_kiosk_payroll): punch_photo_path é anexo opcional
-- de evidência, não um dos campos do registro legal (Portaria MTP 671/2021).
--
-- Mesmo padrão de fa_push_claim_due/fa_owner_push_claim_due: RPC
-- SECURITY DEFINER, só para service_role, que reivindica atomicamente um
-- lote (UPDATE...RETURNING com FOR UPDATE SKIP LOCKED) — evita duas
-- execuções sobrepostas do cron processando a mesma linha. Ela só limpa a
-- referência no banco; quem apaga o arquivo do Storage é a edge function
-- (chamado à API do Storage, não dá pra fazer por SQL puro).
create or replace function fa_kiosk_ponto_photo_retention_claim(p_cutoff_ms bigint, p_limit integer default 200)
returns table (id uuid, punch_photo_path text) as $$
  with candidates as (
    select r.id, r.punch_photo_path
    from fa_kiosk_ponto_records r
    where r.punch_photo_path is not null and r.at_ms < p_cutoff_ms
    order by r.at_ms
    limit p_limit
    for update skip locked
  )
  update fa_kiosk_ponto_records r
  set punch_photo_path = null
  from candidates c
  where r.id = c.id
  returning r.id, c.punch_photo_path;
$$ language sql volatile security definer set search_path = public, pg_temp;

revoke execute on function fa_kiosk_ponto_photo_retention_claim(bigint, integer) from public, anon, authenticated;
grant execute on function fa_kiosk_ponto_photo_retention_claim(bigint, integer) to service_role;

-- Cron: dispara a edge function uma vez por dia (às 05:15 UTC — fora do
-- horário de funcionamento das unidades, mesmo espírito de rodar fora de
-- pico). Diferente dos crons de push/relatório, isto não é sensível a
-- minuto — 45 dias de folga tornam inofensivo rodar 1x/dia.
do $$
begin
  perform cron.unschedule('fa-ponto-photo-retention');
exception when others then null;
end $$;

select cron.schedule(
  'fa-ponto-photo-retention',
  '15 5 * * *',
  $$ select net.http_post(
       url := 'https://ivjvpdzsfjdpyabbzzuj.supabase.co/functions/v1/ponto-photo-retention-dispatch',
       headers := '{"Content-Type":"application/json"}'::jsonb,
       body := '{}'::jsonb
     ); $$
);
