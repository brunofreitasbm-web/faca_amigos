-- Compêndio mensal de vendas: interpreta as transcrições de check-in/
-- check-out (fa_kiosk_voice_transcripts, migration 20260927210000) com a
-- API Gemini e produz um resumo estruturado para preparar a Reunião de
-- Alinhamento Mensal (padrões de venda adicional, objeções recorrentes,
-- pontos por operador, plano de ação). Gerado:
--   (a) automaticamente todo dia 1 às 06h (UTC), para o mês anterior, por
--       unidade e um consolidado da rede (unit_id = null) — ver cron abaixo;
--   (b) sob demanda no Gerencial, a qualquer período, por quem tem
--       'treinamento.compendio.gerar' — a função valida a capacidade.
--
-- O texto das transcrições nunca sai daqui só por si: quem lê o compêndio
-- precisa da MESMA capacidade de leitura das transcrições
-- ('treinamento.transcricoes.read'), e o compêndio em si já é um resumo
-- (sem falas literais, por instrução no prompt da function), reduzindo a
-- exposição do texto bruto na tela do Gerencial.

create table if not exists fa_kiosk_sales_compendiums (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid references fa_kiosk_units (id),      -- null = consolidado de toda a rede
  period_start_ms bigint not null,
  period_end_ms bigint not null,
  generated_by_employee_id uuid references fa_kiosk_employees (id),  -- null = gerado pelo cron mensal
  transcript_count integer not null default 0,
  gemini_model text not null,
  compendium jsonb,               -- ver formato no prompt de sales-compendium-generate/index.ts
  status text not null default 'DONE' check (status in ('DONE', 'EMPTY', 'FAILED')),
  error text,
  created_at_ms bigint not null default (extract(epoch from now()) * 1000)::bigint
);

create index if not exists idx_fa_sales_compendium_unit_period on fa_kiosk_sales_compendiums (unit_id, period_start_ms desc);

alter table fa_kiosk_sales_compendiums enable row level security;

drop policy if exists fa_kiosk_sales_compendium_read on fa_kiosk_sales_compendiums;
create policy fa_kiosk_sales_compendium_read on fa_kiosk_sales_compendiums
  for select to authenticated
  using (fa_kiosk_can('treinamento.transcricoes.read'));

-- Sem policy de insert/update para authenticated: a geração manual passa
-- pela Edge Function sales-compendium-generate (valida
-- 'treinamento.compendio.gerar' e grava com a service role); a automática
-- é o cron, também com service role.

insert into fa_kiosk_role_capabilities (role, capability) values
  ('ADMIN', 'treinamento.compendio.gerar')
on conflict do nothing;

-- Cron: todo dia 1 do mês às 06h UTC, cobrindo o mês anterior. Não
-- sensível a minuto (1x/mês), então sem a preocupação de sobreposição dos
-- crons de 1x/minuto — mas ainda assim a function reivindica unidade por
-- unidade e é segura contra reexecução (on conflict do nothing por
-- unit_id+período, ver função abaixo).
do $$
begin
  perform cron.unschedule('fa-sales-compendium-monthly');
exception when others then null;
end $$;

select cron.schedule(
  'fa-sales-compendium-monthly',
  '0 6 1 * *',
  $$ select net.http_post(
       url := 'https://ivjvpdzsfjdpyabbzzuj.supabase.co/functions/v1/sales-compendium-dispatch',
       headers := '{"Content-Type":"application/json"}'::jsonb,
       body := '{}'::jsonb
     ); $$
);

-- Evita duplicar o compêndio automático do mesmo mês/unidade se o cron
-- rodar de novo (retry manual, ou dois disparos no mesmo dia por engano).
create unique index if not exists uq_fa_sales_compendium_auto_period
  on fa_kiosk_sales_compendiums (coalesce(unit_id, '00000000-0000-0000-0000-000000000000'), period_start_ms)
  where generated_by_employee_id is null;
