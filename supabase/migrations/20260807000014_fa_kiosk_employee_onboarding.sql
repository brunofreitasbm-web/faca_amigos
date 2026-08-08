-- Cadastro (auto-preenchimento) de Colaboradores: RH manda um único link do
-- app pro colaborador, que já entra com o PIN que ganhou no Cadastro Rápido
-- e completa os próprios dados (CTPS, RG, filiação, endereço, contato de
-- emergência, chave Pix). Mesmo raciocínio do payroll_info (migration
-- 20260807000013): esses dados NÃO entram em fa_kiosk_employees porque essa
-- tabela é lida por qualquer colaborador autenticado — iriam vazar CTPS e
-- endereço de todo mundo para qualquer Operador logado.
--
-- Diferença chave em relação ao payroll_info: aqui quem escreve é o PRÓPRIO
-- colaborador, não o Owner. Por isso não existe policy de UPDATE/INSERT
-- direta — só duas funções security definer que ignoram qualquer
-- employee_id vindo do cliente e usam sempre fa_kiosk_current_employee_id().
-- Isso torna impossível um colaborador autenticado escrever ou ler a linha
-- de outro, mesmo chamando a função diretamente via RPC.

create table if not exists fa_kiosk_employee_personal_info (
  employee_id uuid primary key references fa_kiosk_employees (id) on delete cascade,
  ctps_numero text,
  ctps_serie text,
  ctps_uf text,
  rg_numero text,
  rg_orgao_emissor text,
  nome_mae text,
  nome_pai text,
  estado_civil text,
  escolaridade text,
  raca_cor text,
  cep text,
  logradouro text,
  numero text,
  complemento text,
  bairro text,
  cidade text,
  uf text,
  emergency_contact_name text,
  emergency_contact_phone text,
  completed_at_ms bigint,
  updated_at_ms bigint not null default (extract(epoch from now()) * 1000)::bigint
);

-- Leitura/gestão administrativa reaproveita as capacidades de RH que já
-- existem para a folha de pagamento — não precisa de uma capability nova.
alter table fa_kiosk_employee_personal_info enable row level security;
drop policy if exists fa_kiosk_employee_personal_info_read on fa_kiosk_employee_personal_info;
create policy fa_kiosk_employee_personal_info_read on fa_kiosk_employee_personal_info
  for select to authenticated using (fa_kiosk_can('folha_pagamento.read'));
-- Sem policy de insert/update/delete de propósito: mesmo o Owner grava só
-- através das funções abaixo (o colaborador nas próprias, o Owner não grava
-- por enquanto — só visualiza).

-- Colaborador lê só a própria linha, mesmo sem 'folha_pagamento.read' (a
-- policy de select acima é só para o Owner/RH consultarem TODOS).
create or replace function fa_kiosk_my_personal_info()
returns setof fa_kiosk_employee_personal_info as $$
  select * from fa_kiosk_employee_personal_info
   where employee_id = fa_kiosk_current_employee_id();
$$ language sql stable security definer set search_path = public, pg_temp;

revoke all on function fa_kiosk_my_personal_info() from public, anon;
grant execute on function fa_kiosk_my_personal_info() to authenticated;

-- Upsert dos próprios dados de RH. p_payload é um jsonb com as chaves acima
-- (todas opcionais) — quem chama nunca escolhe o employee_id, é sempre o do
-- token da sessão.
create or replace function fa_kiosk_update_own_personal_info(p_payload jsonb)
returns void as $$
declare
  v_employee_id uuid := fa_kiosk_current_employee_id();
begin
  if v_employee_id is null then
    raise exception 'sessão de colaborador inválida' using errcode = '42501';
  end if;

  insert into fa_kiosk_employee_personal_info (
    employee_id, ctps_numero, ctps_serie, ctps_uf, rg_numero, rg_orgao_emissor,
    nome_mae, nome_pai, estado_civil, escolaridade, raca_cor,
    cep, logradouro, numero, complemento, bairro, cidade, uf,
    emergency_contact_name, emergency_contact_phone,
    completed_at_ms, updated_at_ms
  ) values (
    v_employee_id,
    nullif(p_payload->>'ctpsNumero', ''),
    nullif(p_payload->>'ctpsSerie', ''),
    nullif(p_payload->>'ctpsUf', ''),
    nullif(p_payload->>'rgNumero', ''),
    nullif(p_payload->>'rgOrgaoEmissor', ''),
    nullif(p_payload->>'nomeMae', ''),
    nullif(p_payload->>'nomePai', ''),
    nullif(p_payload->>'estadoCivil', ''),
    nullif(p_payload->>'escolaridade', ''),
    nullif(p_payload->>'racaCor', ''),
    nullif(p_payload->>'cep', ''),
    nullif(p_payload->>'logradouro', ''),
    nullif(p_payload->>'numero', ''),
    nullif(p_payload->>'complemento', ''),
    nullif(p_payload->>'bairro', ''),
    nullif(p_payload->>'cidade', ''),
    nullif(p_payload->>'uf', ''),
    nullif(p_payload->>'emergencyContactName', ''),
    nullif(p_payload->>'emergencyContactPhone', ''),
    (extract(epoch from now()) * 1000)::bigint,
    (extract(epoch from now()) * 1000)::bigint
  )
  on conflict (employee_id) do update set
    ctps_numero = excluded.ctps_numero,
    ctps_serie = excluded.ctps_serie,
    ctps_uf = excluded.ctps_uf,
    rg_numero = excluded.rg_numero,
    rg_orgao_emissor = excluded.rg_orgao_emissor,
    nome_mae = excluded.nome_mae,
    nome_pai = excluded.nome_pai,
    estado_civil = excluded.estado_civil,
    escolaridade = excluded.escolaridade,
    raca_cor = excluded.raca_cor,
    cep = excluded.cep,
    logradouro = excluded.logradouro,
    numero = excluded.numero,
    complemento = excluded.complemento,
    bairro = excluded.bairro,
    cidade = excluded.cidade,
    uf = excluded.uf,
    emergency_contact_name = excluded.emergency_contact_name,
    emergency_contact_phone = excluded.emergency_contact_phone,
    completed_at_ms = coalesce(fa_kiosk_employee_personal_info.completed_at_ms, excluded.completed_at_ms),
    updated_at_ms = excluded.updated_at_ms;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke all on function fa_kiosk_update_own_personal_info(jsonb) from public, anon;
grant execute on function fa_kiosk_update_own_personal_info(jsonb) to authenticated;

-- Chave Pix é o único dado bancário que o colaborador autoatende — salário e
-- conta bancária completa continuam exclusivos do Owner via
-- fa_kiosk_employee_payroll_info (capacidade folha_pagamento.write).
create or replace function fa_kiosk_update_own_pix(p_pix_key text)
returns void as $$
declare
  v_employee_id uuid := fa_kiosk_current_employee_id();
begin
  if v_employee_id is null then
    raise exception 'sessão de colaborador inválida' using errcode = '42501';
  end if;

  insert into fa_kiosk_employee_payroll_info (employee_id, pix_key, updated_at_ms)
  values (v_employee_id, nullif(p_pix_key, ''), (extract(epoch from now()) * 1000)::bigint)
  on conflict (employee_id) do update set
    pix_key = excluded.pix_key,
    updated_at_ms = excluded.updated_at_ms;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke all on function fa_kiosk_update_own_pix(text) from public, anon;
grant execute on function fa_kiosk_update_own_pix(text) to authenticated;

-- Para o RH acompanhar quem falta cobrar, sem expor os dados em si: devolve
-- só employee_id + se já preencheu, para quem tem folha_pagamento.read.
create or replace function fa_kiosk_personal_info_status()
returns table (employee_id uuid, completed boolean) as $$
  select e.id, (pi.completed_at_ms is not null)
    from fa_kiosk_employees e
    left join fa_kiosk_employee_personal_info pi on pi.employee_id = e.id
   where fa_kiosk_can('folha_pagamento.read');
$$ language sql stable security definer set search_path = public, pg_temp;

revoke all on function fa_kiosk_personal_info_status() from public, anon;
grant execute on function fa_kiosk_personal_info_status() to authenticated;
