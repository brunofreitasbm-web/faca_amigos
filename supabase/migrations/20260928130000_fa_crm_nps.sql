-- NPS por WhatsApp. Substitui o cartão de NPS que aparecia na tela pública
-- de acompanhamento (AcompanharScreen): a pesquisa agora é enviada pelo CRM
-- e respondida no próprio WhatsApp.
--
-- Cada canal (número) é uma marca: o número do Playground pergunta sobre o
-- Playground, o do Circuito sobre o Circuito — por isso a pesquisa guarda
-- uma nota só. Fluxo: envio do template (business-initiated, exige template
-- aprovado) -> cliente responde 0-10 -> webhook grava a nota e pergunta o
-- motivo -> próxima mensagem de texto vira o comentário.

alter table fa_crm_templates add column if not exists purpose text not null default 'GERAL'
  check (purpose in ('GERAL', 'NPS'));

create table if not exists fa_crm_nps_surveys (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references fa_crm_contacts (id) on delete cascade,
  channel_id uuid not null references fa_crm_channels (id),
  status text not null default 'SENT' check (status in ('SENT', 'SCORED', 'DONE', 'EXPIRED')),
  score smallint check (score between 0 and 10),
  feedback text,
  sent_by_employee_id uuid references fa_kiosk_employees (id),
  sent_at_ms bigint not null default (extract(epoch from now()) * 1000)::bigint,
  scored_at_ms bigint,
  done_at_ms bigint
);

create index if not exists idx_fa_crm_nps_contact on fa_crm_nps_surveys (contact_id, sent_at_ms desc);
create index if not exists idx_fa_crm_nps_open on fa_crm_nps_surveys (contact_id) where status in ('SENT', 'SCORED');
create index if not exists idx_fa_crm_nps_scored on fa_crm_nps_surveys (scored_at_ms desc) where score is not null;

alter table fa_crm_nps_surveys enable row level security;

-- Leitura: quem vê o CRM. Escrita: só as Edge Functions (service role).
drop policy if exists fa_crm_nps_read on fa_crm_nps_surveys;
create policy fa_crm_nps_read on fa_crm_nps_surveys
  for select to authenticated using (fa_kiosk_can('crm.read'));

-- Painel do Owner (Visão Geral) lê as notas sem precisar de crm.read: expõe
-- só marca, nota, comentário e data — sem telefone nem nome.
create or replace function fa_crm_nps_feed(p_limit integer default 20)
returns table (id uuid, brand text, score smallint, feedback text, scored_at_ms bigint) as $$
begin
  if not (fa_kiosk_can('crm.read') or fa_kiosk_can('relatorio.read')) then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  return query
    select s.id, c.label, s.score, s.feedback, s.scored_at_ms
    from fa_crm_nps_surveys s
    join fa_crm_channels c on c.id = s.channel_id
    where s.score is not null
    order by s.scored_at_ms desc
    limit least(greatest(p_limit, 1), 100);
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function fa_crm_nps_feed(integer) from public, anon;
grant execute on function fa_crm_nps_feed(integer) to authenticated;
