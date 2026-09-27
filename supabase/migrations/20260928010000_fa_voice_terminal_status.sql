-- Painel central de terminais (worker de transcrição de voz) — o gestor
-- via o rollout do whisper.cpp em todas as unidades numa tela só, em vez
-- de abrir Configurações > Impressoras em cada PC do balcão.
--
-- Chave é `terminal_id`, NÃO `unit_id`: uma unidade pode ter mais de um
-- terminal amarrado (ex.: um tablet de entrada + o PC do caixa), então uma
-- linha por unidade sobrescreveria o status de um pelo outro. O Gerencial
-- agrupa por unidade na tela.
--
-- Nada sensível aqui — nomes de modelo, contadores de fila, mensagens de
-- erro — mesmo espírito de fa_kiosk_fiscal_terminal_status (heartbeat
-- fiscal). Escrita só pela service role do worker (nenhuma policy de
-- insert/update para authenticated).

create table if not exists fa_kiosk_voice_terminal_status (
  terminal_id text primary key,
  unit_id uuid references fa_kiosk_units (id),
  worker_version text,
  has_service_role_key boolean not null default false,
  whisper_cli_found boolean not null default false,
  model_name text,
  model_state text check (model_state in ('ready', 'downloading', 'missing', 'error')),
  model_progress_pct integer,
  model_error text,
  queue_pending integer not null default 0,
  queue_processing integer not null default 0,
  queue_transcribed integer not null default 0,
  queue_uploaded integer not null default 0,
  queue_failed integer not null default 0,
  last_error text,
  last_heartbeat_ms bigint not null
);

create index if not exists idx_fa_voice_terminal_status_unit on fa_kiosk_voice_terminal_status (unit_id);

alter table fa_kiosk_voice_terminal_status enable row level security;

drop policy if exists fa_kiosk_voice_terminal_status_read on fa_kiosk_voice_terminal_status;
create policy fa_kiosk_voice_terminal_status_read on fa_kiosk_voice_terminal_status
  for select to authenticated
  using (fa_kiosk_can('config.terminais.read'));

-- Só Owner: é visão de infraestrutura da rede inteira, não de uma unidade
-- só (diferente de 'treinamento.transcricoes.read', que é por conteúdo).
insert into fa_kiosk_role_capabilities (role, capability) values
  ('ADMIN', 'config.terminais.read')
on conflict do nothing;
