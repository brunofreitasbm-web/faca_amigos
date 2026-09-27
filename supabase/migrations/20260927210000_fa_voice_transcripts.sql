-- Base de conhecimento de venda adicional: transcrição das conversas de
-- balcão (check-in e check-out) gravadas pelo kiosk e transcritas LOCALMENTE
-- no PC do quiosque com whisper.cpp (apps/kiosk/src/main/voiceWorker.ts).
--
-- O ÁUDIO NUNCA CHEGA AQUI. O WAV vive alguns minutos no disco do terminal
-- (userData/voz/inbox) e é apagado assim que a transcrição termina — só o
-- texto sobe, já com CPF/telefone falados mascarados pelo worker. Voz é
-- dado pessoal (LGPD art. 5º, I); texto de atendimento também, por isso a
-- leitura é gated por capacidade própria e o INSERT só acontece pela
-- chave secreta do terminal (service role ignora RLS) — nenhum papel
-- autenticado escreve nesta tabela pela SPA.
--
-- `session_ids` é array e não FK: uma conversa de check-in cobre a família
-- inteira (irmãos = N sessões) e um check-out pode fechar N sessões num
-- pedido só. O join com fa_kiosk_sessions/fa_kiosk_upsell_offers é feito
-- pela UI (Api.voiceTranscriptSessions).

create table if not exists fa_kiosk_voice_transcripts (
  id uuid primary key,                                   -- = recordingId gerado no cliente (idempotência)
  unit_id uuid not null references fa_kiosk_units (id),
  employee_id uuid references fa_kiosk_employees (id),
  session_ids uuid[] not null default '{}',
  order_id uuid references fa_kiosk_orders (id),
  momento text not null check (momento in ('CHECKIN', 'CHECKOUT')),
  outcome text check (outcome in ('SUCCESS', 'ABANDONED', 'CAPPED')),
  started_at_ms bigint not null,
  ended_at_ms bigint not null,
  duration_ms integer not null,
  terminal_id text,
  client_label text,
  whisper_model text not null,
  worker_version text,
  transcript text not null default '',
  segments jsonb not null default '[]'::jsonb,
  status text not null default 'DONE' check (status in ('DONE', 'EMPTY', 'FAILED')),
  error text,
  -- Fase opcional (Gemini): rótulo Operador/Cliente, oferta feita, objeção,
  -- resultado. Preenchido depois, pela SPA, sob treinamento.transcricoes.write.
  analysis jsonb,
  analysis_at_ms bigint,
  search_tsv tsvector generated always as (to_tsvector('portuguese', coalesce(transcript, ''))) stored,
  created_at_ms bigint not null default (extract(epoch from now()) * 1000)::bigint
);

create index if not exists idx_fa_voice_tr_unit_time on fa_kiosk_voice_transcripts (unit_id, started_at_ms desc);
create index if not exists idx_fa_voice_tr_employee on fa_kiosk_voice_transcripts (employee_id, started_at_ms desc);
create index if not exists idx_fa_voice_tr_sessions on fa_kiosk_voice_transcripts using gin (session_ids);
create index if not exists idx_fa_voice_tr_order on fa_kiosk_voice_transcripts (order_id) where order_id is not null;
create index if not exists idx_fa_voice_tr_search on fa_kiosk_voice_transcripts using gin (search_tsv);

alter table fa_kiosk_voice_transcripts enable row level security;

drop policy if exists fa_kiosk_voice_transcripts_read on fa_kiosk_voice_transcripts;
create policy fa_kiosk_voice_transcripts_read on fa_kiosk_voice_transcripts
  for select to authenticated
  using (fa_kiosk_can('treinamento.transcricoes.read'));

-- Só `analysis`/`analysis_at_ms` mudam pela SPA; o texto transcrito é
-- imutável do ponto de vista do cliente. Postgres não restringe colunas em
-- policy, então a imutabilidade do texto é garantida pelo trigger abaixo.
drop policy if exists fa_kiosk_voice_transcripts_analysis on fa_kiosk_voice_transcripts;
create policy fa_kiosk_voice_transcripts_analysis on fa_kiosk_voice_transcripts
  for update to authenticated
  using (fa_kiosk_can('treinamento.transcricoes.write'))
  with check (fa_kiosk_can('treinamento.transcricoes.write'));

create or replace function fa_kiosk_voice_transcripts_guard_update() returns trigger as $$
begin
  -- service role (worker) passa livre; usuário autenticado só mexe na análise.
  if auth.role() = 'authenticated' then
    if new.transcript is distinct from old.transcript
       or new.segments is distinct from old.segments
       or new.session_ids is distinct from old.session_ids
       or new.unit_id is distinct from old.unit_id
       or new.employee_id is distinct from old.employee_id
       or new.momento is distinct from old.momento
       or new.status is distinct from old.status then
      raise exception 'apenas a análise pode ser editada' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

drop trigger if exists trg_fa_kiosk_voice_transcripts_guard on fa_kiosk_voice_transcripts;
create trigger trg_fa_kiosk_voice_transcripts_guard
  before update on fa_kiosk_voice_transcripts
  for each row execute function fa_kiosk_voice_transcripts_guard_update();

-- Só o gatilho acima chama esta função — nunca precisa de EXECUTE
-- concedido a ninguém. Sem este revoke, o linter de segurança do Supabase
-- acusa (corretamente) que anon/authenticated podiam invocar
-- /rest/v1/rpc/fa_kiosk_voice_transcripts_guard_update, uma função
-- SECURITY DEFINER — mesmo padrão já usado em fa_kiosk_enroll_face
-- (migration fa_kiosk_employees_face_enrollment).
revoke execute on function fa_kiosk_voice_transcripts_guard_update() from public, anon, authenticated;

-- Capacidades: leitura para Líder (GERENTE) e Owner (ADMIN); anotação/análise
-- só Owner. Declarar em GERENTE já propaga a ADMIN por herança de rank
-- (ver 20260807000002_fa_rbac_capabilities.sql), mas a linha explícita de
-- ADMIN não custa nada e deixa a intenção legível.
insert into fa_kiosk_role_capabilities (role, capability) values
  ('GERENTE', 'treinamento.transcricoes.read'),
  ('ADMIN', 'treinamento.transcricoes.read'),
  ('ADMIN', 'treinamento.transcricoes.write')
on conflict do nothing;

-- Flags por unidade lidas pela SPA e pelo worker (fa_kiosk_app_settings):
--   voice_recording_enabled  '1' | '0'   (padrão LIGADO — ver voiceRecorder.ts:
--                            ausência da linha ou '1' grava; só '0' explícito desliga)
--   voice_whisper_model      'ggml-small' | 'ggml-base' | 'ggml-medium-q5_0'
--   voice_transcribe_hours   'always' | 'closed'
-- Nenhuma linha semeada: o default fica no código do cliente (opt-out, não
-- opt-in), de propósito — a gravação já nasce ativa assim que este build
-- chega ao terminal, sem depender de o gestor entrar em Configurações.
