-- Fase 2/3 do plano fiscal: RPCs da fila e RLS.

-- fa_fiscal_enqueue_for_order: chamada de DENTRO de fa_create_pdv_order, na
-- mesma transação da venda (migration 34). Ou a venda existe com documento
-- enfileirado, ou nenhuma das duas coisas existe.
--
-- Três regras invioláveis, e é por elas que esta função é tão curta:
--  1. Nenhuma chamada externa aqui. Um timeout da SEFAZ não pode travar a
--     fila do caixa — toda a rede acontece depois, no worker.
--  2. NUNCA lança exceção. Validação de cadastro (falta NCM, falta IE) é
--     trabalho do worker, que marca BLOQUEADO. Uma venda jamais pode falhar
--     porque um produto está sem NCM: isso pararia o caixa num sábado.
--  3. Respeita `fiscal_enabled`, que vem false por padrão.
create or replace function fa_fiscal_enqueue_for_order(p_order_id uuid) returns void as $$
declare
  v_order record;
  v_unit record;
  v_produto_cents integer;
begin
  select * into v_order from fa_kiosk_orders where id = p_order_id;
  if not found then return; end if;

  select * into v_unit from fa_kiosk_units where id = v_order.unit_id;
  if not found or not coalesce(v_unit.fiscal_enabled, false) then return; end if;

  -- Só os itens de natureza PRODUTO entram na NFC-e. Sessão é serviço
  -- (NFS-e), fora do escopo desta entrega.
  select coalesce(sum(total_cents), 0)::integer into v_produto_cents
    from fa_kiosk_order_items where order_id = p_order_id and item_nature = 'PRODUTO';
  if v_produto_cents <= 0 then return; end if;

  insert into fa_kiosk_fiscal_docs (unit_id, order_id, doc_type, environment, serie, total_cents)
    values (v_order.unit_id, p_order_id, 'NFCE',
            coalesce(v_unit.fiscal_ambiente, 'HOMOLOGACAO'),
            coalesce(v_unit.nfce_serie, 1)::text,
            v_produto_cents)
    on conflict do nothing;
exception
  when others then
    -- Regra 2 acima, explícita: falha ao enfileirar nunca derruba a venda.
    -- Vai para o log do Postgres para não sumir em silêncio; a reconciliação
    -- diária (fa_fiscal_pending_summary) é a rede de segurança que acusa a
    -- venda sem documento.
    raise warning 'fa_fiscal_enqueue_for_order falhou para order % : %', p_order_id, sqlerrm;
    return;
end;
$$ language plpgsql security definer;

-- fa_fiscal_reserve_number: incremento atômico da numeração. Número duplicado
-- ou pulado é pendência fiscal, não bug de UI — por isso nunca é o cliente
-- que decide o número.
create or replace function fa_fiscal_reserve_number(
  p_unit_id uuid,
  p_doc_type text,
  p_environment text,
  p_serie text
) returns bigint as $$
declare
  v_number bigint;
begin
  insert into fa_kiosk_fiscal_numbering (unit_id, doc_type, environment, serie, next_number)
    values (p_unit_id, p_doc_type, p_environment, p_serie, 1)
    on conflict (unit_id, doc_type, environment, serie) do nothing;

  update fa_kiosk_fiscal_numbering
    set next_number = next_number + 1
    where unit_id = p_unit_id and doc_type = p_doc_type
      and environment = p_environment and serie = p_serie
    returning next_number - 1 into v_number;

  return v_number;
end;
$$ language plpgsql security definer;

-- fa_fiscal_claim_next: o consumidor da fila.
--
-- `for update skip locked` é o que permite dois terminais rodarem ao mesmo
-- tempo sem emitir nota duplicada — eles se revezam em vez de brigar. É a
-- mitigação M4 do plano (segundo terminal como failover), e é exatamente o
-- que falta no print bridge de hoje.
--
-- Devolve o payload COMPLETO (documento + venda + itens + emitente) numa ida
-- só, para o worker não precisar de cinco round-trips por nota.
create or replace function fa_fiscal_claim_next(p_terminal_id text, p_limit integer default 5)
returns jsonb as $$
declare
  v_now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
  v_result jsonb;
begin
  with picked as (
    select id from fa_kiosk_fiscal_docs
    where status in ('PENDENTE', 'ASSINADO', 'TRANSMITIDO', 'CONTINGENCIA_OFFLINE')
      and next_attempt_at_ms <= v_now_ms
    order by created_at_ms
    limit greatest(p_limit, 1)
    for update skip locked
  ), claimed as (
    update fa_kiosk_fiscal_docs d
      set claimed_by = p_terminal_id, claimed_at_ms = v_now_ms, updated_at_ms = v_now_ms
      from picked
      where d.id = picked.id
      returning d.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'doc', jsonb_build_object(
      'id', c.id,
      'docType', c.doc_type,
      'environment', c.environment,
      'status', c.status,
      'emissionType', c.emission_type,
      'serie', c.serie,
      'numero', c.numero,
      'accessKey', c.access_key,
      'attempts', c.attempts,
      'totalCents', c.total_cents
    ),
    'order', jsonb_build_object(
      'id', o.id,
      'orderCode', o.order_code,
      'businessDate', o.business_date,
      'closedAtMs', o.closed_at_ms,
      'fiscalCpf', o.fiscal_cpf,
      'fiscalNome', o.fiscal_nome,
      'fiscalEmail', o.fiscal_email
    ),
    'unit', jsonb_build_object(
      'id', u.id,
      'cnpj', u.cnpj,
      'razaoSocial', u.razao_social,
      'nomeFantasia', u.nome_fantasia,
      'inscricaoEstadual', u.inscricao_estadual,
      'crt', u.crt,
      'endLogradouro', u.end_logradouro,
      'endNumero', u.end_numero,
      'endComplemento', u.end_complemento,
      'endBairro', u.end_bairro,
      'endMunicipioIbge', u.end_municipio_ibge,
      'endUf', u.end_uf,
      'endCep', u.end_cep,
      'fone', u.fone,
      'nfceCscId', u.nfce_csc_id,
      'nfceQrcodeUrlConsulta', u.nfce_qrcode_url_consulta
    ),
    'items', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'description', i.description,
        'quantity', i.quantity,
        'unitPriceCents', i.unit_price_cents,
        'totalCents', i.total_cents,
        'productId', i.product_id,
        'ncm', p.ncm,
        'cest', p.cest,
        'cfop', p.cfop,
        'csosn', p.csosn,
        'origem', p.origem,
        'unidadeComercial', p.unidade_comercial,
        'gtin', p.gtin,
        'pisCst', p.pis_cst,
        'cofinsCst', p.cofins_cst,
        'fiscalReady', p.fiscal_ready
      ) order by i.description), '[]'::jsonb)
      from fa_kiosk_order_items i
      left join fa_kiosk_products p on p.id = i.product_id
      where i.order_id = o.id and i.item_nature = 'PRODUTO'
    ),
    'payments', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'method', pay.method,
        'amountCents', pay.amount_cents
      )), '[]'::jsonb)
      from fa_kiosk_payments pay where pay.order_id = o.id
    )
  )), '[]'::jsonb)
  into v_result
  from claimed c
  join fa_kiosk_orders o on o.id = c.order_id
  join fa_kiosk_units u on u.id = c.unit_id;

  return v_result;
end;
$$ language plpgsql security definer;

-- fa_fiscal_request_cancel: única escrita de cliente na fila. Valida papel e
-- a janela legal de 30 minutos da NFC-e. Quem transmite o evento é o worker.
create or replace function fa_fiscal_request_cancel(
  p_fiscal_doc_id uuid,
  p_employee_id uuid,
  p_reason text
) returns jsonb as $$
declare
  v_now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
  v_doc record;
  v_role text;
begin
  select role into v_role from fa_kiosk_employees where id = p_employee_id and active;
  if v_role is null or v_role not in ('GERENTE', 'ADMIN') then
    raise exception 'SEM_PERMISSAO_CANCELAR';
  end if;

  select * into v_doc from fa_kiosk_fiscal_docs where id = p_fiscal_doc_id;
  if not found then raise exception 'DOCUMENTO_NAO_ENCONTRADO'; end if;
  if v_doc.status <> 'AUTORIZADO' then raise exception 'DOCUMENTO_NAO_AUTORIZADO'; end if;

  -- A justificativa do evento de cancelamento exige 15 caracteres no mínimo.
  if p_reason is null or length(trim(p_reason)) < 15 then
    raise exception 'JUSTIFICATIVA_CURTA';
  end if;

  if v_now_ms - coalesce(v_doc.authorized_at_ms, v_doc.created_at_ms) > 30 * 60 * 1000 then
    raise exception 'FORA_DA_JANELA_DE_30_MIN';
  end if;

  update fa_kiosk_fiscal_docs
    set cancel_status = 'SOLICITADO',
        cancel_reason = trim(p_reason),
        cancel_requested_by_employee_id = p_employee_id,
        cancel_requested_at_ms = v_now_ms,
        next_attempt_at_ms = 0,
        updated_at_ms = v_now_ms
    where id = p_fiscal_doc_id;

  return jsonb_build_object('fiscalDocId', p_fiscal_doc_id, 'cancelStatus', 'SOLICITADO');
end;
$$ language plpgsql security definer;

-- fa_fiscal_pending_summary: alimenta a tela de reconciliação diária e o
-- fechamento de turno. Compara vendas COM produto contra documentos emitidos —
-- é o que acusa uma venda que ficou sem nota.
create or replace function fa_fiscal_pending_summary(p_unit_id uuid, p_business_date date)
returns jsonb as $$
  select jsonb_build_object(
    'businessDate', p_business_date,
    'salesWithProduct', (
      select count(distinct o.id) from fa_kiosk_orders o
      join fa_kiosk_order_items i on i.order_id = o.id and i.item_nature = 'PRODUTO'
      where o.unit_id = p_unit_id and o.business_date = p_business_date and o.status = 'PAGA'
    ),
    'authorized', (select count(*) from fa_kiosk_fiscal_docs d join fa_kiosk_orders o on o.id = d.order_id
      where d.unit_id = p_unit_id and o.business_date = p_business_date and d.status = 'AUTORIZADO'),
    'pending', (select count(*) from fa_kiosk_fiscal_docs d join fa_kiosk_orders o on o.id = d.order_id
      where d.unit_id = p_unit_id and o.business_date = p_business_date
        and d.status in ('PENDENTE', 'ASSINADO', 'TRANSMITIDO')),
    'contingency', (select count(*) from fa_kiosk_fiscal_docs d join fa_kiosk_orders o on o.id = d.order_id
      where d.unit_id = p_unit_id and o.business_date = p_business_date
        and d.status = 'CONTINGENCIA_OFFLINE'),
    'blocked', (select count(*) from fa_kiosk_fiscal_docs d join fa_kiosk_orders o on o.id = d.order_id
      where d.unit_id = p_unit_id and o.business_date = p_business_date and d.status = 'BLOQUEADO'),
    'rejected', (select count(*) from fa_kiosk_fiscal_docs d join fa_kiosk_orders o on o.id = d.order_id
      where d.unit_id = p_unit_id and o.business_date = p_business_date
        and d.status in ('REJEITADO', 'DENEGADO', 'A_INUTILIZAR'))
  );
$$ language sql stable security definer;

-- Expurgo do detalhe de depuração (contém CPF). A obrigação legal de guarda
-- de 5 anos é sobre o XML, não sobre este log.
create or replace function fa_fiscal_purge_doc_events(p_older_than_days integer default 90)
returns integer as $$
declare
  v_count integer;
begin
  update fa_kiosk_fiscal_doc_events
    set detail_json = null
    where detail_json is not null
      and at_ms < (extract(epoch from now()) * 1000)::bigint - p_older_than_days::bigint * 86400000;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$ language plpgsql security definer;

-- ------------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------------

-- Documentos: o balcão e o backoffice leem para mostrar status; ninguém
-- escreve direto. Sem policy de INSERT/UPDATE/DELETE, só service_role (o
-- worker) e as funções SECURITY DEFINER acima conseguem escrever.
alter table fa_kiosk_fiscal_docs enable row level security;
drop policy if exists fa_kiosk_fiscal_docs_read on fa_kiosk_fiscal_docs;
create policy fa_kiosk_fiscal_docs_read on fa_kiosk_fiscal_docs
  for select to authenticated using (true);

-- Eventos: detail_json pode conter CPF do consumidor, então não vale o
-- padrão "todo authenticated lê" das outras tabelas.
alter table fa_kiosk_fiscal_doc_events enable row level security;
drop policy if exists fa_kiosk_fiscal_doc_events_read on fa_kiosk_fiscal_doc_events;
create policy fa_kiosk_fiscal_doc_events_read on fa_kiosk_fiscal_doc_events
  for select to authenticated using (fa_kiosk_has_role('GERENTE'));

-- Numeração: zero policies. Só as funções encostam.
alter table fa_kiosk_fiscal_numbering enable row level security;

alter table fa_kiosk_fiscal_inutilizacoes enable row level security;
drop policy if exists fa_kiosk_fiscal_inutilizacoes_read on fa_kiosk_fiscal_inutilizacoes;
create policy fa_kiosk_fiscal_inutilizacoes_read on fa_kiosk_fiscal_inutilizacoes
  for select to authenticated using (fa_kiosk_has_role('GERENTE'));

-- Status do terminal: nada sensível, e todo mundo precisa ver o semáforo.
alter table fa_kiosk_fiscal_terminal_status enable row level security;
drop policy if exists fa_kiosk_fiscal_terminal_status_read on fa_kiosk_fiscal_terminal_status;
create policy fa_kiosk_fiscal_terminal_status_read on fa_kiosk_fiscal_terminal_status
  for select to authenticated using (true);

-- O kiosk-ui hoje roda sem sessão (login temporariamente escondido, migrations
-- 16 e 26). Enquanto isso durar, `anon` também precisa enxergar o status para
-- o Painel mostrar o semáforo. Nenhuma escrita é liberada.
drop policy if exists fa_kiosk_fiscal_terminal_status_read_anon on fa_kiosk_fiscal_terminal_status;
create policy fa_kiosk_fiscal_terminal_status_read_anon on fa_kiosk_fiscal_terminal_status
  for select to anon using (true);
drop policy if exists fa_kiosk_fiscal_docs_read_anon on fa_kiosk_fiscal_docs;
create policy fa_kiosk_fiscal_docs_read_anon on fa_kiosk_fiscal_docs
  for select to anon using (true);
