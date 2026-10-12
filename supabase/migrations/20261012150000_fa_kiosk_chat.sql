-- Chat interno colaborador <-> dono. Uma conversa 1:1 por colaborador, histórico
-- permanente (append-only: sem UPDATE/DELETE de mensagem por ninguém). O dono
-- responde pelo Telegram (bot próprio, funções chat-telegram-*), sem login.
-- Escrita só por RPC security definer; leitura por RLS. Ver
-- docs/TELEGRAM_CHAT_INTERNO.md para o passo a passo de ativação.

-- ---------------------------------------------------------------------
-- 1. Tabelas
-- ---------------------------------------------------------------------
create table if not exists fa_kiosk_chat_threads (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null unique references fa_kiosk_employees (id),
  last_message_at_ms bigint not null default (extract(epoch from now()) * 1000)::bigint,
  -- Até onde cada ponta já leu (1:1, então duas colunas bastam).
  employee_last_read_ms bigint not null default 0,
  owner_last_read_ms bigint not null default 0,
  created_at_ms bigint not null default (extract(epoch from now()) * 1000)::bigint
);

create table if not exists fa_kiosk_chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references fa_kiosk_chat_threads (id),
  sender_employee_id uuid not null references fa_kiosk_employees (id),
  from_owner boolean not null default false,
  body text not null default '' check (char_length(body) <= 4000),
  attachment_path text,
  -- unit_id, screen, app_version, ua (preenchido pelo cliente; validado em fa_chat_insert_message)
  context jsonb not null default '{}'::jsonb,
  -- Telegram: id da notificação enviada ao dono (mensagem do colaborador) ou id
  -- da resposta do dono (from_owner). Serve para ligar reply -> thread.
  telegram_message_id bigint,
  telegram_claimed_at_ms bigint,
  telegram_sent_at_ms bigint,
  -- resposta do dono já marcada com 👀 no Telegram (colaborador leu)
  telegram_read_reacted_at_ms bigint,
  created_at_ms bigint not null default (extract(epoch from now()) * 1000)::bigint,
  check (body <> '' or attachment_path is not null)
);
create index if not exists idx_fa_chat_messages_thread on fa_kiosk_chat_messages (thread_id, created_at_ms);
create unique index if not exists idx_fa_chat_messages_tg on fa_kiosk_chat_messages (telegram_message_id)
  where telegram_message_id is not null;
create index if not exists idx_fa_chat_messages_unsent on fa_kiosk_chat_messages (created_at_ms)
  where from_owner = false and telegram_sent_at_ms is null;

-- Configuração do chat (ex.: owner_employee_id usado como remetente das respostas do Telegram).
create table if not exists fa_chat_config (
  key text primary key,
  value text not null
);
alter table fa_chat_config enable row level security;
-- sem policy: só service_role / funções security definer

-- ---------------------------------------------------------------------
-- 2. Capacidades
-- ---------------------------------------------------------------------
insert into fa_kiosk_role_capabilities (role, capability) values
  ('ESTAGIARIO', 'chat.usar'),
  ('OPERADOR', 'chat.usar'),
  ('GERENTE', 'chat.usar'),
  ('ADMIN', 'chat.usar'),
  ('ADMIN', 'chat.admin')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 3. RLS (leitura). Sem policy de insert/update/delete: append-only por RPC.
-- ---------------------------------------------------------------------
alter table fa_kiosk_chat_threads enable row level security;
alter table fa_kiosk_chat_messages enable row level security;

drop policy if exists fa_chat_threads_read on fa_kiosk_chat_threads;
create policy fa_chat_threads_read on fa_kiosk_chat_threads
  for select to authenticated
  using (employee_id = fa_kiosk_current_employee_id() or fa_kiosk_can('chat.admin'));

drop policy if exists fa_chat_messages_read on fa_kiosk_chat_messages;
create policy fa_chat_messages_read on fa_kiosk_chat_messages
  for select to authenticated
  using (
    exists (
      select 1 from fa_kiosk_chat_threads t
      where t.id = thread_id
        and (t.employee_id = fa_kiosk_current_employee_id() or fa_kiosk_can('chat.admin'))
    )
  );

do $$
begin
  alter publication supabase_realtime add table fa_kiosk_chat_messages;
exception when others then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table fa_kiosk_chat_threads;
exception when others then null;
end $$;

-- ---------------------------------------------------------------------
-- 4. Funções
-- ---------------------------------------------------------------------
create or replace function fa_chat_owner_employee_id() returns uuid as $$
declare
  v_cfg text;
  v_id uuid;
  v_n integer;
begin
  select value into v_cfg from fa_chat_config where key = 'owner_employee_id';
  if v_cfg is not null then return v_cfg::uuid; end if;
  select count(*), min(id::text)::uuid into v_n, v_id
    from fa_kiosk_employees where role = 'ADMIN' and active;
  if v_n = 1 then return v_id; end if;
  return null;
end;
$$ language plpgsql stable security definer set search_path = public, pg_temp;
revoke execute on function fa_chat_owner_employee_id() from public, anon, authenticated;
grant execute on function fa_chat_owner_employee_id() to service_role;

-- Núcleo da gravação, compartilhado pela RPC do app e pelo webhook do Telegram.
-- Não confere permissão: quem chama já conferiu.
create or replace function fa_chat_insert_message(
  p_id uuid,
  p_thread_id uuid,
  p_sender_employee_id uuid,
  p_from_owner boolean,
  p_body text,
  p_attachment_path text,
  p_context jsonb,
  p_telegram_message_id bigint
) returns fa_kiosk_chat_messages as $$
declare
  v_now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
  v_ctx jsonb := '{}'::jsonb;
  v_body text := btrim(coalesce(p_body, ''));
  k text;
  v_row fa_kiosk_chat_messages;
begin
  if char_length(v_body) > 4000 then
    raise exception 'mensagem longa demais' using errcode = '22023';
  end if;
  if v_body = '' and p_attachment_path is null then
    raise exception 'mensagem vazia' using errcode = '22023';
  end if;
  -- Só chaves conhecidas, texto curto: nada de dado sensível ou payload grande.
  if p_context is not null and jsonb_typeof(p_context) = 'object' then
    foreach k in array array['unit_id', 'screen', 'app_version', 'ua'] loop
      if p_context ? k and jsonb_typeof(p_context -> k) = 'string' then
        v_ctx := v_ctx || jsonb_build_object(k, left(p_context ->> k, 120));
      end if;
    end loop;
  end if;

  insert into fa_kiosk_chat_messages
    (id, thread_id, sender_employee_id, from_owner, body, attachment_path, context, telegram_message_id, created_at_ms)
    values (coalesce(p_id, gen_random_uuid()), p_thread_id, p_sender_employee_id, p_from_owner, v_body,
            p_attachment_path, v_ctx, p_telegram_message_id, v_now_ms)
    on conflict (id) do nothing
    returning * into v_row;
  if v_row.id is null then
    -- reenvio com o mesmo id (cliente repetiu): devolve o que já existe
    select * into v_row from fa_kiosk_chat_messages where id = p_id;
    return v_row;
  end if;

  update fa_kiosk_chat_threads set last_message_at_ms = v_now_ms where id = p_thread_id;
  return v_row;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;
revoke execute on function fa_chat_insert_message(uuid, uuid, uuid, boolean, text, text, jsonb, bigint) from public, anon, authenticated;
grant execute on function fa_chat_insert_message(uuid, uuid, uuid, boolean, text, text, jsonb, bigint) to service_role;

create or replace function fa_chat_get_or_create_my_thread() returns uuid as $$
declare
  v_emp uuid := fa_kiosk_current_employee_id();
  v_id uuid;
begin
  if v_emp is null or not fa_kiosk_can('chat.usar') then
    raise exception 'sem permissão para o chat' using errcode = '42501';
  end if;
  select id into v_id from fa_kiosk_chat_threads where employee_id = v_emp;
  if v_id is null then
    insert into fa_kiosk_chat_threads (employee_id) values (v_emp)
      on conflict (employee_id) do nothing;
    select id into v_id from fa_kiosk_chat_threads where employee_id = v_emp;
  end if;
  return v_id;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;
revoke execute on function fa_chat_get_or_create_my_thread() from public, anon;
grant execute on function fa_chat_get_or_create_my_thread() to authenticated;

-- Envio pelo app. Colaborador só escreve na própria conversa; admin em qualquer uma.
create or replace function fa_chat_send(
  p_id uuid,
  p_thread_id uuid,
  p_body text,
  p_attachment_path text,
  p_context jsonb
) returns jsonb as $$
declare
  v_emp uuid := fa_kiosk_current_employee_id();
  v_is_admin boolean := fa_kiosk_can('chat.admin');
  v_thread_emp uuid;
  v_row fa_kiosk_chat_messages;
begin
  if v_emp is null or not fa_kiosk_can('chat.usar') then
    raise exception 'sem permissão para o chat' using errcode = '42501';
  end if;
  select employee_id into v_thread_emp from fa_kiosk_chat_threads where id = p_thread_id;
  if v_thread_emp is null then
    raise exception 'conversa não encontrada' using errcode = '22023';
  end if;
  if v_thread_emp <> v_emp and not v_is_admin then
    raise exception 'conversa de outro colaborador' using errcode = '42501';
  end if;
  -- anexo só dentro da pasta da própria conversa
  if p_attachment_path is not null and split_part(p_attachment_path, '/', 1) <> p_thread_id::text then
    raise exception 'anexo inválido' using errcode = '22023';
  end if;

  v_row := fa_chat_insert_message(
    p_id, p_thread_id, v_emp,
    -- mensagem do admin na própria conversa de admin (dono testando) não é "do dono"
    v_is_admin and v_thread_emp <> v_emp,
    p_body, p_attachment_path, p_context, null
  );
  return jsonb_build_object('id', v_row.id, 'atMs', v_row.created_at_ms);
end;
$$ language plpgsql security definer set search_path = public, pg_temp;
revoke execute on function fa_chat_send(uuid, uuid, text, text, jsonb) from public, anon;
grant execute on function fa_chat_send(uuid, uuid, text, text, jsonb) to authenticated;

-- Marca como lido do ponto de vista de quem chama (colaborador na própria
-- conversa, ou admin em qualquer uma). Devolve o instante gravado.
create or replace function fa_chat_mark_read(p_thread_id uuid) returns bigint as $$
declare
  v_emp uuid := fa_kiosk_current_employee_id();
  v_now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
  v_thread_emp uuid;
begin
  if v_emp is null or not fa_kiosk_can('chat.usar') then
    raise exception 'sem permissão para o chat' using errcode = '42501';
  end if;
  select employee_id into v_thread_emp from fa_kiosk_chat_threads where id = p_thread_id;
  if v_thread_emp is null then return 0; end if;
  if v_thread_emp = v_emp then
    update fa_kiosk_chat_threads set employee_last_read_ms = v_now_ms where id = p_thread_id;
  elsif fa_kiosk_can('chat.admin') then
    update fa_kiosk_chat_threads set owner_last_read_ms = v_now_ms where id = p_thread_id;
  else
    raise exception 'conversa de outro colaborador' using errcode = '42501';
  end if;
  return v_now_ms;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;
revoke execute on function fa_chat_mark_read(uuid) from public, anon;
grant execute on function fa_chat_mark_read(uuid) to authenticated;

-- Contagem de respostas do dono ainda não lidas pelo colaborador logado.
create or replace function fa_chat_my_unread() returns integer as $$
  select count(*)::integer
    from fa_kiosk_chat_messages m
    join fa_kiosk_chat_threads t on t.id = m.thread_id
   where t.employee_id = fa_kiosk_current_employee_id()
     and m.from_owner
     and m.created_at_ms > t.employee_last_read_ms;
$$ language sql stable security definer set search_path = public, pg_temp;
revoke execute on function fa_chat_my_unread() from public, anon;
grant execute on function fa_chat_my_unread() to authenticated;

-- Dica na tela de PIN (antes do login): só quantas conversas têm resposta do
-- dono pendente. Sem nome, sem texto. É a única notificação possível num
-- tablet compartilhado sem push.
create or replace function fa_chat_unread_hint() returns integer as $$
  select count(distinct t.id)::integer
    from fa_kiosk_chat_threads t
    join fa_kiosk_chat_messages m on m.thread_id = t.id
   where m.from_owner and m.created_at_ms > t.employee_last_read_ms;
$$ language sql stable security definer set search_path = public, pg_temp;
revoke execute on function fa_chat_unread_hint() from public;
grant execute on function fa_chat_unread_hint() to anon, authenticated;

-- Dono respondeu pelo Telegram -> grava como mensagem do dono. Só service_role.
create or replace function fa_chat_owner_reply(
  p_thread_id uuid,
  p_body text,
  p_telegram_message_id bigint
) returns fa_kiosk_chat_messages as $$
declare
  v_owner uuid := fa_chat_owner_employee_id();
begin
  if v_owner is null then
    raise exception 'owner_employee_id não configurado' using errcode = '22023';
  end if;
  return fa_chat_insert_message(null, p_thread_id, v_owner, true, p_body, null, null, p_telegram_message_id);
end;
$$ language plpgsql security definer set search_path = public, pg_temp;
revoke execute on function fa_chat_owner_reply(uuid, text, bigint) from public, anon, authenticated;
grant execute on function fa_chat_owner_reply(uuid, text, bigint) to service_role;

-- ---------------------------------------------------------------------
-- 5. Aviso ao dono (Telegram): disparo imediato por trigger + varredura
-- ---------------------------------------------------------------------
-- A função chat-telegram-notify é pública (verify_jwt=false). Ela só age sobre
-- mensagens que existem e ainda não foram reivindicadas (claim atômico), então
-- chamar de fora não vaza nada nem reenvia. A varredura (body {}) reenvia o que
-- falhou, para uma mensagem do colaborador nunca ficar sem aviso.
create or replace function fa_chat_notify_owner() returns trigger as $$
begin
  if not new.from_owner then
    perform net.http_post(
      url := 'https://ivjvpdzsfjdpyabbzzuj.supabase.co/functions/v1/chat-telegram-notify',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body := jsonb_build_object('message_id', new.id)
    );
  end if;
  return new;
exception when others then
  -- nunca bloquear o envio do colaborador por falha no aviso; a varredura cobre
  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

drop trigger if exists trg_fa_chat_notify_owner on fa_kiosk_chat_messages;
create trigger trg_fa_chat_notify_owner
  after insert on fa_kiosk_chat_messages
  for each row execute function fa_chat_notify_owner();

do $$
begin
  perform cron.unschedule('fa-chat-telegram-sweep');
exception when others then null;
end $$;

select cron.schedule(
  'fa-chat-telegram-sweep',
  '*/2 * * * *',
  $$ select net.http_post(
       url := 'https://ivjvpdzsfjdpyabbzzuj.supabase.co/functions/v1/chat-telegram-notify',
       headers := '{"Content-Type":"application/json"}'::jsonb,
       body := '{}'::jsonb
     ); $$
);

-- Reivindica (atômico) mensagens de colaborador ainda não avisadas ao dono.
-- p_id nulo = varredura (>30 s de idade, até 24 h, ou claim travado há >2 min).
create or replace function fa_chat_claim_unsent(p_id uuid) returns setof fa_kiosk_chat_messages as $$
declare
  v_now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  return query
  update fa_kiosk_chat_messages m
     set telegram_claimed_at_ms = v_now_ms
   where m.from_owner = false
     and m.telegram_sent_at_ms is null
     and (m.telegram_claimed_at_ms is null or m.telegram_claimed_at_ms < v_now_ms - 120000)
     and (
       (p_id is not null and m.id = p_id)
       or (p_id is null and m.created_at_ms < v_now_ms - 30000 and m.created_at_ms > v_now_ms - 86400000)
     )
  returning m.*;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;
revoke execute on function fa_chat_claim_unsent(uuid) from public, anon, authenticated;
grant execute on function fa_chat_claim_unsent(uuid) to service_role;

-- Colaborador abriu a conversa -> o bot troca a reação da resposta do dono para 👀.
create or replace function fa_chat_notify_read() returns trigger as $$
begin
  if new.employee_last_read_ms is distinct from old.employee_last_read_ms then
    perform net.http_post(
      url := 'https://ivjvpdzsfjdpyabbzzuj.supabase.co/functions/v1/chat-telegram-notify',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body := jsonb_build_object('read_thread_id', new.id)
    );
  end if;
  return new;
exception when others then
  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

drop trigger if exists trg_fa_chat_notify_read on fa_kiosk_chat_threads;
create trigger trg_fa_chat_notify_read
  after update of employee_last_read_ms on fa_kiosk_chat_threads
  for each row execute function fa_chat_notify_read();

-- Respostas do dono já lidas pelo colaborador e ainda sem a reação 👀 (claim atômico).
create or replace function fa_chat_claim_read_reactions(p_thread_id uuid) returns setof fa_kiosk_chat_messages as $$
declare
  v_now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  return query
  update fa_kiosk_chat_messages m
     set telegram_read_reacted_at_ms = v_now_ms
    from fa_kiosk_chat_threads t
   where t.id = m.thread_id
     and m.thread_id = p_thread_id
     and m.from_owner
     and m.telegram_message_id is not null
     and m.telegram_read_reacted_at_ms is null
     and m.created_at_ms <= t.employee_last_read_ms
  returning m.*;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;
revoke execute on function fa_chat_claim_read_reactions(uuid) from public, anon, authenticated;
grant execute on function fa_chat_claim_read_reactions(uuid) to service_role;

-- ---------------------------------------------------------------------
-- 6. Storage: anexos (foto/print), bucket privado, pasta = id da conversa
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('fa-chat-attachments', 'fa-chat-attachments', false)
on conflict (id) do nothing;

drop policy if exists fa_chat_attachments_write on storage.objects;
create policy fa_chat_attachments_write on storage.objects for insert to authenticated
  with check (
    bucket_id = 'fa-chat-attachments'
    and fa_kiosk_can('chat.usar')
    and exists (
      select 1 from fa_kiosk_chat_threads t
      where t.id::text = (storage.foldername(name))[1]
        and (t.employee_id = fa_kiosk_current_employee_id() or fa_kiosk_can('chat.admin'))
    )
  );

drop policy if exists fa_chat_attachments_read on storage.objects;
create policy fa_chat_attachments_read on storage.objects for select to authenticated
  using (
    bucket_id = 'fa-chat-attachments'
    and exists (
      select 1 from fa_kiosk_chat_threads t
      where t.id::text = (storage.foldername(name))[1]
        and (t.employee_id = fa_kiosk_current_employee_id() or fa_kiosk_can('chat.admin'))
    )
  );
-- Sem policy de update/delete: anexo também é imutável. Tamanho (≤5 MB) e tipo
-- (image/*) são validados no cliente antes do upload.
