-- Atualiza fa_fiscal_request_nfse para desbloquear e reenfileirar documentos NFS-e em status BLOQUEADO ou REJEITADO
-- quando solicitados novamente via botão 'Tentar Novamente'.

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

  -- Se o documento estive bloqueado ou rejeitado, reseta para PENDENTE ao tentar novamente
  if v_doc.status in ('BLOQUEADO', 'REJEITADO') then
    update fa_kiosk_fiscal_docs
    set status = 'PENDENTE',
        attempts = 0,
        next_attempt_at_ms = (extract(epoch from now()) * 1000)::bigint,
        last_error = null,
        updated_at_ms = (extract(epoch from now()) * 1000)::bigint
    where id = v_doc_id
    returning * into v_doc;
  end if;

  return jsonb_build_object('fiscalDocId', v_doc.id, 'status', v_doc.status);
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function fa_fiscal_request_nfse(uuid) from public, anon;
grant execute on function fa_fiscal_request_nfse(uuid) to authenticated;
