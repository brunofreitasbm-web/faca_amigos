-- =====================================================================
-- Correção da Rejeição 539 (Duplicidade de NFC-e):
--
-- Quando a SEFAZ rejeita uma NFC-e por duplicidade de chave de acesso (cStat 539),
-- a chave antiga NÃO PODE ser reutilizada ao tentar novamente.
--
-- Esta RPC zera access_key e numero quando o documento rejeitado/bloqueado teve
-- código 539 ou erro de duplicidade, forçando o worker de transmissão a reservar
-- uma nova numeração e gerar uma nova chave de acesso limpa ao reenviar.
-- =====================================================================

create or replace function fa_fiscal_retry_nfce(p_fiscal_doc_id uuid) returns jsonb as $$
declare
  v_doc record;
  v_now bigint := (extract(epoch from now()) * 1000)::bigint;
  v_is_duplicidade boolean;
begin
  if not fa_kiosk_can('nfce.retry') then
    raise exception 'sem permissão para reprocessar NFC-e' using errcode = '42501';
  end if;

  select * into v_doc from fa_kiosk_fiscal_docs where id = p_fiscal_doc_id and doc_type = 'NFCE';
  if not found then
    raise exception 'NFCE_NAO_ENCONTRADA';
  end if;
  if v_doc.status not in ('BLOQUEADO', 'REJEITADO') then
    raise exception 'NFCE_STATUS_INVALIDO: %', v_doc.status;
  end if;

  v_is_duplicidade := (
    coalesce(v_doc.reject_code, '') = '539' or
    coalesce(v_doc.last_error, '') ilike '%539%' or
    coalesce(v_doc.last_error, '') ilike '%duplicidade%' or
    coalesce(v_doc.reject_message, '') ilike '%539%' or
    coalesce(v_doc.reject_message, '') ilike '%duplicidade%'
  );

  update fa_kiosk_fiscal_docs
     set status = 'PENDENTE',
         attempts = 0,
         next_attempt_at_ms = 0,
         last_error = null,
         reject_code = null,
         reject_message = null,
         claimed_by = null,
         claimed_at_ms = null,
         access_key = case when v_is_duplicidade then null else access_key end,
         numero = case when v_is_duplicidade then null else numero end,
         updated_at_ms = v_now
   where id = p_fiscal_doc_id
   returning * into v_doc;

  insert into fa_kiosk_fiscal_doc_events (fiscal_doc_id, kind, detail_json)
  values (p_fiscal_doc_id, 'RETRY_SOLICITADO', jsonb_build_object('actor', auth.uid(), 'cleared_key', v_is_duplicidade));

  return jsonb_build_object('fiscalDocId', v_doc.id, 'status', v_doc.status);
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

-- Saneia documentos atualmente travados com erro 539 para permitirem reenvio imediato
update fa_kiosk_fiscal_docs
   set access_key = null,
       numero = null,
       status = 'PENDENTE',
       attempts = 0,
       next_attempt_at_ms = 0,
       last_error = null,
       reject_code = null,
       reject_message = null,
       claimed_by = null,
       claimed_at_ms = null,
       updated_at_ms = (extract(epoch from now()) * 1000)::bigint
 where doc_type = 'NFCE'
   and (
     coalesce(reject_code, '') = '539' or
     coalesce(last_error, '') ilike '%539%' or
     coalesce(last_error, '') ilike '%duplicidade%' or
     coalesce(reject_message, '') ilike '%539%' or
     coalesce(reject_message, '') ilike '%duplicidade%'
   );
