-- Fase 2/3 do plano fiscal: a fila de documentos e a máquina de estados.
--
-- Mesmo padrão de fa_kiosk_print_jobs (migration 07): fila por tabela +
-- Realtime + RLS onde só service_role escreve. A diferença crítica é que o
-- consumidor desta fila usa `for update skip locked` (ver fa_fiscal_claim_next
-- na migration 33) — o print bridge atual não tem essa trava e dois bridges
-- ligados imprimem duas vezes. Nota fiscal duplicada não é aceitável, então o
-- worker fiscal não pode copiar aquele padrão.
--
-- O XML NÃO fica aqui. Conta: ~2.000-3.000 documentos/mês x ~8 KB = 250-350 MB
-- por ano, contra 500 MB do free tier do Supabase — guardar XML em coluna text
-- estoura o plano gratuito no primeiro ano e quebra o requisito de custo zero.
-- A fonte primária do XML é o disco do PC do balcão; a cópia vai para o bucket
-- privado `fiscal-xml` no Storage. Aqui ficam só o ponteiro e o hash.

create table if not exists fa_kiosk_fiscal_docs (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references fa_kiosk_units (id),
  order_id uuid not null references fa_kiosk_orders (id),
  doc_type text not null default 'NFCE' check (doc_type in ('NFCE')),
  environment text not null check (environment in ('HOMOLOGACAO', 'PRODUCAO')),

  -- identificação do documento autorizado
  serie text,
  numero bigint,
  access_key text,
  protocol_number text,

  -- Máquina de estados (o diagrama completo está no plano):
  --   PENDENTE   recém-enfileirado pela venda
  --   BLOQUEADO  falta cadastro nosso (NCM, IE, CSC) — corrige no backoffice
  --              e reprocessa. NÃO entra em backoff: retentar não resolve.
  --   DESCARTADO pedido sem item de natureza PRODUTO
  --   ASSINADO   XML montado e assinado, pronto para transmitir
  --   TRANSMITIDO enviado, aguardando retorno da SEFAZ
  --   AUTORIZADO  cStat 100
  --   REJEITADO   erro de layout/dado; o número foi QUEIMADO
  --   DENEGADO    cStat 302 e afins: a nota existe e não pode ser usada
  --   A_INUTILIZAR número queimado esperando inutilização formal. Sem este
  --              estado o sistema acumula quebra de sequência invisível.
  --   CONTINGENCIA_OFFLINE emitida sem rede (tpEmis=9), DANFE já impresso e
  --              cliente já foi embora — 24h para virar AUTORIZADO.
  --   CANCELADO  evento de cancelamento aprovado
  status text not null default 'PENDENTE' check (status in (
    'PENDENTE', 'BLOQUEADO', 'DESCARTADO', 'ASSINADO', 'TRANSMITIDO',
    'AUTORIZADO', 'REJEITADO', 'DENEGADO', 'A_INUTILIZAR',
    'CONTINGENCIA_OFFLINE', 'CANCELADO'
  )),

  emission_type text not null default 'NORMAL'
    check (emission_type in ('NORMAL', 'CONTINGENCIA_OFFLINE')),
  contingency_at_ms bigint,
  contingency_reason text,

  -- espelho do valor, para conferir contra o pedido na reconciliação diária
  total_cents integer not null,

  -- Cancelamento: janela legal de 30 min na NFC-e, só GERENTE pode pedir.
  cancel_status text check (cancel_status in ('SOLICITADO', 'APROVADO', 'REJEITADO')),
  cancel_reason text,
  cancel_protocol text,
  cancel_requested_by_employee_id uuid references fa_kiosk_employees (id),
  cancel_requested_at_ms bigint,

  -- retentativa e diagnóstico
  attempts integer not null default 0,
  next_attempt_at_ms bigint not null default 0,
  last_error text,
  reject_code text,
  reject_message text,

  -- claim entre terminais (M4 do plano: segundo terminal como failover)
  claimed_by text,
  claimed_at_ms bigint,

  -- ponteiros para o XML guardado fora do Postgres
  xml_storage_path text,
  xml_sha256 text,

  created_at_ms bigint not null default (extract(epoch from now()) * 1000)::bigint,
  updated_at_ms bigint,
  authorized_at_ms bigint
);

-- Uma venda nunca gera duas notas, nem que a RPC seja reenviada.
create unique index if not exists idx_fa_kiosk_fiscal_docs_order
  on fa_kiosk_fiscal_docs (order_id) where status <> 'DESCARTADO';
create unique index if not exists idx_fa_kiosk_fiscal_docs_access_key
  on fa_kiosk_fiscal_docs (access_key) where access_key is not null;
create index if not exists idx_fa_kiosk_fiscal_docs_queue
  on fa_kiosk_fiscal_docs (status, next_attempt_at_ms)
  where status in ('PENDENTE', 'ASSINADO', 'TRANSMITIDO', 'CONTINGENCIA_OFFLINE');
create index if not exists idx_fa_kiosk_fiscal_docs_unit_status
  on fa_kiosk_fiscal_docs (unit_id, status);

do $$ begin
  alter publication supabase_realtime add table fa_kiosk_fiscal_docs;
exception when duplicate_object then null;
          when undefined_object then null;
end $$;

-- Log append-only de cada requisição/resposta. Sem isto não se depura
-- rejeição da SEFAZ nem se prova nada depois.
create table if not exists fa_kiosk_fiscal_doc_events (
  id uuid primary key default gen_random_uuid(),
  fiscal_doc_id uuid not null references fa_kiosk_fiscal_docs (id),
  kind text not null,
  http_status integer,
  cstat text,
  xmotivo text,
  -- Pode conter CPF do consumidor: RLS restringe a leitura a GERENTE+ e há
  -- expurgo aos 90 dias (migration 33). A guarda legal de 5 anos é sobre o
  -- XML, não sobre o log de depuração.
  detail_json jsonb,
  at_ms bigint not null default (extract(epoch from now()) * 1000)::bigint
);
create index if not exists idx_fa_kiosk_fiscal_doc_events_doc
  on fa_kiosk_fiscal_doc_events (fiscal_doc_id, at_ms);

-- Numeração sequencial sem buraco, por unidade/tipo/ambiente/série.
-- Não é uma sequence do Postgres porque precisamos de uma faixa independente
-- por ambiente (homologação e produção numeram separado) e porque sequence
-- não faz rollback — aqui o incremento é transacional.
create table if not exists fa_kiosk_fiscal_numbering (
  unit_id uuid not null references fa_kiosk_units (id),
  doc_type text not null,
  environment text not null,
  serie text not null,
  next_number bigint not null default 1,
  primary key (unit_id, doc_type, environment, serie)
);

create table if not exists fa_kiosk_fiscal_inutilizacoes (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references fa_kiosk_units (id),
  environment text not null,
  serie text not null,
  numero_inicial bigint not null,
  numero_final bigint not null,
  justificativa text not null,
  status text not null default 'PENDENTE' check (status in ('PENDENTE', 'HOMOLOGADA', 'ERRO')),
  protocol_number text,
  last_error text,
  at_ms bigint not null default (extract(epoch from now()) * 1000)::bigint
);

-- Heartbeat do terminal emissor (M3 do plano). É o que transforma "risco
-- silencioso" em "problema visível": sem isto, o certificado vence ou o PC
-- morre e ninguém percebe por semanas. Nada secreto mora aqui — só o nome do
-- titular do certificado, o CNPJ e a validade, todos lidos do próprio .pfx.
create table if not exists fa_kiosk_fiscal_terminal_status (
  unit_id uuid primary key references fa_kiosk_units (id),
  terminal_id text not null,
  worker_version text,
  cert_subject_cn text,
  cert_cnpj text,
  cert_not_after_ms bigint,
  csc_configured boolean not null default false,
  environment text,
  last_heartbeat_ms bigint not null,
  last_error text
);

do $$ begin
  alter publication supabase_realtime add table fa_kiosk_fiscal_terminal_status;
exception when duplicate_object then null;
          when undefined_object then null;
end $$;
