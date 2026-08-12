-- Banco de Talentos: candidaturas recebidas pelo formulário público "Venha
-- Fazer Parte do Nosso Time" da landing page. Quem escreve é sempre a Edge
-- Function job-application-webhook (service role) — mesmo raciocínio do
-- bucket crianca-fotos (migration 20260807000009), mas aqui nem o `anon`
-- ganha policy de insert no Storage: currículo tem nome completo, e-mail e
-- telefone, dado sensível o bastante para não valer a pena abrir a exceção
-- de escrita anônima que este projeto já vem fechando.

create table if not exists fa_kiosk_job_applications (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text not null,
  phone text not null,
  course text,
  desired_area text not null,
  opportunity_type text not null check (opportunity_type in ('ESTAGIO', 'REMUNERADO', 'BOLSA')),
  resume_path text not null,
  status text not null default 'NOVO' check (status in ('NOVO', 'EM_ANALISE', 'CONTATADO', 'ARQUIVADO')),
  created_at_ms bigint not null default (extract(epoch from now()) * 1000)::bigint
);

-- Bucket privado: currículo só é lido via signed URL por quem tem
-- talentos.read, nunca por getPublicUrl.
insert into storage.buckets (id, name, public)
values ('curriculos', 'curriculos', false)
on conflict (id) do nothing;

-- Sem policy de insert para anon nem authenticated: o upload é feito pela
-- Edge Function com a service role, que ignora RLS.

-- Leitura do PDF via createSignedUrl direto do kiosk-ui, sem RPC extra —
-- mesma capacidade que guarda a tabela abaixo.
drop policy if exists fa_kiosk_curriculos_read on storage.objects;
create policy fa_kiosk_curriculos_read on storage.objects for select to authenticated
  using (bucket_id = 'curriculos' and fa_kiosk_can('talentos.read'));

insert into fa_kiosk_role_capabilities (role, capability) values
  ('GERENTE', 'talentos.read'),
  ('GERENTE', 'talentos.write')
on conflict do nothing;

alter table fa_kiosk_job_applications enable row level security;

drop policy if exists fa_kiosk_job_applications_read on fa_kiosk_job_applications;
create policy fa_kiosk_job_applications_read on fa_kiosk_job_applications
  for select to authenticated using (fa_kiosk_can('talentos.read'));

-- Só troca de status (triagem do RH) — sem policy de insert/delete direto,
-- de propósito: a candidatura só nasce pela Edge Function.
drop policy if exists fa_kiosk_job_applications_write on fa_kiosk_job_applications;
create policy fa_kiosk_job_applications_write on fa_kiosk_job_applications
  for update to authenticated
  using (fa_kiosk_can('talentos.write'))
  with check (fa_kiosk_can('talentos.write'));
