-- CRM de WhatsApp do Playground e do Circuito (Twilio, subconta dedicada).
--
-- Fluxo: o cliente escreve para o número do WhatsApp -> Twilio chama a Edge
-- Function crm-whatsapp-webhook -> contato e mensagem caem aqui. A equipe
-- responde pela aba Gerencial > CRM WhatsApp, que chama crm-whatsapp-send.
--
-- Escrita SÓ pelas Edge Functions (service role ignora RLS): nenhum papel
-- autenticado insere mensagem direto pela SPA, então o histórico não pode
-- ser forjado nem apagado pelo navegador. A SPA só lê e edita a ficha do
-- contato (etapa do funil, nome, tags, notas).
--
-- Telefone de cliente e conteúdo de conversa são dado pessoal (LGPD): a
-- leitura exige 'crm.read'. `opt_in` registra a base legal para mensagens
-- iniciadas por nós; PARAR/SAIR do cliente vira opt_in = false no webhook.

-- Um canal = um número de WhatsApp. O número entra depois de comprado /
-- verificado (Playground e Circuito podem ter um cada). Enquanto isso, o
-- sandbox da Twilio (whatsapp:+14155238886) pode ser cadastrado aqui para testes.
create table if not exists fa_crm_channels (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid references fa_kiosk_units (id),
  label text not null,                           -- 'Playground', 'Circuito'
  whatsapp_e164 text not null unique,            -- '+5591999999999' (sem o prefixo whatsapp:)
  is_sandbox boolean not null default false,
  active boolean not null default true,
  created_at_ms bigint not null default (extract(epoch from now()) * 1000)::bigint
);

create table if not exists fa_crm_contacts (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references fa_crm_channels (id),
  phone_e164 text not null,
  name text,
  guardian_id uuid references fa_kiosk_guardians (id),   -- amarra ao cadastro do kiosk quando o telefone bate
  stage text not null default 'NOVO'
    check (stage in ('NOVO', 'EM_CONVERSA', 'INTERESSADO', 'CLIENTE', 'INATIVO')),
  tags text[] not null default '{}',
  notes text,
  opt_in boolean not null default true,          -- false após PARAR/SAIR
  unread_count integer not null default 0,
  last_inbound_ms bigint,                        -- base da janela de 24h do WhatsApp
  last_message_ms bigint,
  last_message_preview text,
  created_at_ms bigint not null default (extract(epoch from now()) * 1000)::bigint,
  unique (channel_id, phone_e164)
);

create index if not exists idx_fa_crm_contacts_inbox on fa_crm_contacts (channel_id, last_message_ms desc nulls last);
create index if not exists idx_fa_crm_contacts_stage on fa_crm_contacts (stage);
create index if not exists idx_fa_crm_contacts_guardian on fa_crm_contacts (guardian_id) where guardian_id is not null;

create table if not exists fa_crm_messages (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references fa_crm_contacts (id) on delete cascade,
  direction text not null check (direction in ('IN', 'OUT')),
  body text not null default '',
  media jsonb not null default '[]'::jsonb,      -- [{url, contentType}] das mídias recebidas
  twilio_sid text unique,                        -- idempotência: Twilio reentrega webhook
  status text not null default 'received'
    check (status in ('received', 'queued', 'sent', 'delivered', 'read', 'failed', 'undelivered')),
  error text,
  template_id uuid,
  sent_by_employee_id uuid references fa_kiosk_employees (id),
  created_at_ms bigint not null default (extract(epoch from now()) * 1000)::bigint
);

create index if not exists idx_fa_crm_messages_thread on fa_crm_messages (contact_id, created_at_ms);

-- Templates aprovados pela Meta (Content SID da Twilio). Fora da janela de
-- 24h só template pode ser enviado.
create table if not exists fa_crm_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  content_sid text not null unique,              -- 'HX...'
  preview text not null default '',              -- texto de exemplo mostrado na SPA
  variable_count integer not null default 0,     -- {{1}}, {{2}}...
  active boolean not null default true,
  created_at_ms bigint not null default (extract(epoch from now()) * 1000)::bigint
);

alter table fa_crm_messages add constraint fa_crm_messages_template_fk
  foreign key (template_id) references fa_crm_templates (id) on delete set null;

alter table fa_crm_channels enable row level security;
alter table fa_crm_contacts enable row level security;
alter table fa_crm_messages enable row level security;
alter table fa_crm_templates enable row level security;

drop policy if exists fa_crm_channels_read on fa_crm_channels;
create policy fa_crm_channels_read on fa_crm_channels
  for select to authenticated using (fa_kiosk_can('crm.read'));

drop policy if exists fa_crm_contacts_read on fa_crm_contacts;
create policy fa_crm_contacts_read on fa_crm_contacts
  for select to authenticated using (fa_kiosk_can('crm.read'));

drop policy if exists fa_crm_contacts_update on fa_crm_contacts;
create policy fa_crm_contacts_update on fa_crm_contacts
  for update to authenticated
  using (fa_kiosk_can('crm.write'))
  with check (fa_kiosk_can('crm.write'));

drop policy if exists fa_crm_messages_read on fa_crm_messages;
create policy fa_crm_messages_read on fa_crm_messages
  for select to authenticated using (fa_kiosk_can('crm.read'));

drop policy if exists fa_crm_templates_read on fa_crm_templates;
create policy fa_crm_templates_read on fa_crm_templates
  for select to authenticated using (fa_kiosk_can('crm.read'));

-- Canais e templates: gestão só do Owner (crm.admin), por policy própria.
drop policy if exists fa_crm_channels_admin on fa_crm_channels;
create policy fa_crm_channels_admin on fa_crm_channels
  for all to authenticated
  using (fa_kiosk_can('crm.admin')) with check (fa_kiosk_can('crm.admin'));

drop policy if exists fa_crm_templates_admin on fa_crm_templates;
create policy fa_crm_templates_admin on fa_crm_templates
  for all to authenticated
  using (fa_kiosk_can('crm.admin')) with check (fa_kiosk_can('crm.admin'));

-- A SPA só pode mexer na ficha; telefone, canal e contadores de mensagem
-- são do webhook. Postgres não restringe coluna em policy, então o trigger.
create or replace function fa_crm_contacts_guard_update() returns trigger as $$
begin
  if auth.role() = 'authenticated' then
    if new.channel_id is distinct from old.channel_id
       or new.phone_e164 is distinct from old.phone_e164
       or new.opt_in is distinct from old.opt_in
       or new.last_inbound_ms is distinct from old.last_inbound_ms
       or new.last_message_ms is distinct from old.last_message_ms
       or new.last_message_preview is distinct from old.last_message_preview then
      raise exception 'campo gerenciado pelo webhook' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

drop trigger if exists trg_fa_crm_contacts_guard on fa_crm_contacts;
create trigger trg_fa_crm_contacts_guard
  before update on fa_crm_contacts
  for each row execute function fa_crm_contacts_guard_update();

revoke execute on function fa_crm_contacts_guard_update() from public, anon, authenticated;

-- Marcar conversa como lida (zera unread_count). O trigger acima libera
-- unread_count de propósito: é a única coluna de contador que a SPA muda.
create or replace function fa_crm_mark_read(p_contact_id uuid) returns void as $$
begin
  if not fa_kiosk_can('crm.read') then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  update fa_crm_contacts set unread_count = 0 where id = p_contact_id and unread_count <> 0;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function fa_crm_mark_read(uuid) from public, anon;
grant execute on function fa_crm_mark_read(uuid) to authenticated;

-- Liga o contato ao responsável do kiosk pelo telefone (mesmo E.164).
create or replace function fa_crm_link_guardian() returns trigger as $$
begin
  if new.guardian_id is null then
    select g.id into new.guardian_id from fa_kiosk_guardians g where g.phone_e164 = new.phone_e164 limit 1;
    if new.guardian_id is not null and new.name is null then
      select g.full_name into new.name from fa_kiosk_guardians g where g.id = new.guardian_id;
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

drop trigger if exists trg_fa_crm_link_guardian on fa_crm_contacts;
create trigger trg_fa_crm_link_guardian
  before insert on fa_crm_contacts
  for each row execute function fa_crm_link_guardian();

revoke execute on function fa_crm_link_guardian() from public, anon, authenticated;

insert into fa_kiosk_role_capabilities (role, capability) values
  ('GERENTE', 'crm.read'),
  ('GERENTE', 'crm.write'),
  ('ADMIN', 'crm.read'),
  ('ADMIN', 'crm.write'),
  ('ADMIN', 'crm.admin')
on conflict do nothing;

-- Realtime opcional: a SPA faz polling, mas deixar publicado permite trocar
-- para postgres_changes sem nova migration.
do $$
begin
  alter publication supabase_realtime add table fa_crm_contacts;
  alter publication supabase_realtime add table fa_crm_messages;
exception when others then null;
end $$;
