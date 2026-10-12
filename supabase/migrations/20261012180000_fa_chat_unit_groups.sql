-- Chat interno: um grupo do Telegram por unidade + caixa de resposta digitada.
-- Já aplicada em produção (projeto PLAY) em 2026-10-12; idempotente.

-- Grupo do Telegram de cada unidade. Mensagem de uma unidade sem grupo cai no grupo padrão
-- (secret CHAT_TELEGRAM_CHAT_ID). Só service_role lê (sem policy).
create table if not exists fa_chat_unit_groups (
  unit_id uuid primary key references fa_kiosk_units (id),
  tg_chat_id bigint not null unique
);
alter table fa_chat_unit_groups enable row level security;

-- "Responder por texto": o bot manda uma caixa de resposta (force_reply) e a resposta digitada a ela
-- é ligada à conversa por este mapa (chat + id da mensagem da caixa -> conversa).
create table if not exists fa_chat_reply_prompts (
  tg_chat_id bigint not null,
  tg_message_id bigint not null,
  thread_id uuid not null references fa_kiosk_chat_threads (id) on delete cascade,
  admin_tg_user_id bigint not null,
  created_at_ms bigint not null default (extract(epoch from now()) * 1000)::bigint,
  primary key (tg_chat_id, tg_message_id)
);
alter table fa_chat_reply_prompts enable row level security;

-- Em qual chat do Telegram a mensagem foi enviada/respondida (a reação 👀 de leitura precisa saber).
alter table fa_kiosk_chat_messages add column if not exists telegram_chat_id bigint;

-- O Telegram numera as mensagens POR grupo; com vários grupos o mesmo número se repete. O índice único antigo
-- (só pelo número) passa a ser por grupo + número. Rodar o DROP depois do CREATE.
create unique index if not exists idx_fa_chat_messages_tg_chat on fa_kiosk_chat_messages (telegram_chat_id, telegram_message_id)
  where telegram_chat_id is not null and telegram_message_id is not null;
drop index if exists idx_fa_chat_messages_tg;
