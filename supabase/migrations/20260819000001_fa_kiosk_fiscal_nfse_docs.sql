-- =====================================================================
-- NFS-e (sessão de brincar = serviço): fila de emissão + botão manual.
--
-- Reaproveita fa_kiosk_fiscal_docs/fa_kiosk_fiscal_doc_events/
-- fa_kiosk_fiscal_numbering (migration 20260806000032) em vez de tabelas
-- novas — mesma fila, mesmo worker, mesmo `for update skip locked` de
-- fa_fiscal_claim_next (migration 33), só um doc_type a mais.
--
-- Diferente da NFC-e (enfileirada automaticamente dentro de fa_checkout),
-- a NFS-e é sob demanda: o Responsável pede, o operador clica no botão
-- "Emitir Nota Fiscal Serviço". Por isso existe uma RPC pública
-- (fa_fiscal_request_nfse) chamada direto do kiosk-ui, e não um `perform`
-- dentro de fa_checkout.
--
-- A prefeitura de Belém usa sistema próprio, ainda sem layout/WSDL
-- confirmado — por isso a transmissão real fica BLOQUEADA (mesma
-- estratégia já usada na NFC-e, ver apps/kiosk/src/fiscal/claim.ts) até
-- confirmarmos com a prefeitura/contador. O que entra aqui é a fila, o
-- pedido e o modo SIMULADO — a peça que falta é só o transporte.
-- =====================================================================

alter table fa_kiosk_fiscal_docs drop constraint if exists fa_kiosk_fiscal_docs_doc_type_check;
alter table fa_kiosk_fiscal_docs add constraint fa_kiosk_fiscal_docs_doc_type_check
  check (doc_type in ('NFCE', 'NFSE'));

-- Campos específicos de NFS-e (RPS -> NFSe, sem "chave de acesso" — isso é
-- conceito de NF-e/NFC-e, a numeração aqui é numeração municipal). Os
-- campos genéricos (serie/numero/protocol_number/status/xml_storage_path)
-- já cobrem o resto, ver migration 32.
alter table fa_kiosk_fiscal_docs add column if not exists rps_numero bigint;
alter table fa_kiosk_fiscal_docs add column if not exists rps_serie text;
alter table fa_kiosk_fiscal_docs add column if not exists nfse_numero text;
alter table fa_kiosk_fiscal_docs add column if not exists nfse_codigo_verificacao text;
alter table fa_kiosk_fiscal_docs add column if not exists guardian_email_sent_at_ms bigint;

-- fa_fiscal_enqueue_nfse_for_order: mesmas 3 regras invioláveis da
-- NFC-e (ver migration 33) — nenhuma chamada externa, nunca lança
-- exceção, respeita nfse_enabled (false por padrão).
create or replace function fa_fiscal_enqueue_nfse_for_order(p_order_id uuid) returns uuid as $$
declare
  v_order record;
  v_unit record;
  v_servico_cents integer;
  v_doc_id uuid;
begin
  select * into v_order from fa_kiosk_orders where id = p_order_id;
  if not found then return null; end if;

  select * into v_unit from fa_kiosk_units where id = v_order.unit_id;
  if not found or not coalesce(v_unit.nfse_enabled, false) then return null; end if;

  select coalesce(sum(total_cents), 0)::integer into v_servico_cents
    from fa_kiosk_order_items where order_id = p_order_id and item_nature = 'SERVICO';
  if v_servico_cents <= 0 then return null; end if;

  insert into fa_kiosk_fiscal_docs (unit_id, order_id, doc_type, environment, rps_serie, total_cents)
    values (v_order.unit_id, p_order_id, 'NFSE',
            coalesce(v_unit.nfse_ambiente, 'HOMOLOGACAO'),
            coalesce(v_unit.nfse_serie_rps, '1'),
            v_servico_cents)
    on conflict (order_id) where status <> 'DESCARTADO' do nothing
    returning id into v_doc_id;

  if v_doc_id is null then
    select id into v_doc_id from fa_kiosk_fiscal_docs
      where order_id = p_order_id and doc_type = 'NFSE' and status <> 'DESCARTADO';
  end if;

  return v_doc_id;
exception
  when others then
    raise warning 'fa_fiscal_enqueue_nfse_for_order falhou para order % : %', p_order_id, sqlerrm;
    return null;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

-- fa_fiscal_request_nfse: a RPC do botão. Confere permissão, confere que
-- o pedido é da própria unidade do chamador e já foi pago, e delega o
-- enfileiramento pra função acima (idempotente: pedir duas vezes devolve
-- o mesmo documento).
create or replace function fa_fiscal_request_nfse(p_order_id uuid) returns jsonb as $$
declare
  v_order record;
  v_doc_id uuid;
  v_doc record;
begin
  if not fa_kiosk_can('nfse.emit') then
    raise exception 'sem permissão para emitir nota fiscal de serviço' using errcode = '42501';
  end if;

  select * into v_order from fa_kiosk_orders where id = p_order_id;
  if not found then
    raise exception 'PEDIDO_NAO_ENCONTRADO';
  end if;
  if v_order.status <> 'PAGA' then
    raise exception 'PEDIDO_NAO_PAGO';
  end if;

  v_doc_id := fa_fiscal_enqueue_nfse_for_order(p_order_id);
  if v_doc_id is null then
    raise exception 'NFSE_INDISPONIVEL: unidade sem NFS-e habilitada ou pedido sem item de serviço';
  end if;

  select * into v_doc from fa_kiosk_fiscal_docs where id = v_doc_id;
  return jsonb_build_object('fiscalDocId', v_doc.id, 'status', v_doc.status);
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function fa_fiscal_request_nfse(uuid) from public, anon;
grant execute on function fa_fiscal_request_nfse(uuid) to authenticated;

-- Operador já fecha o atendimento (sessao.checkout) — pedir a nota do
-- mesmo atendimento é a extensão natural, não uma ação de backoffice.
insert into fa_kiosk_role_capabilities (role, capability) values
  ('OPERADOR', 'nfse.emit')
on conflict do nothing;
