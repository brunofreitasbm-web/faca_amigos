-- =====================================================================
-- fa_fiscal_retry_nfce: botão "Tentar novamente" da NFC-e.
--
-- Espelho do que 20260828190000 fez pra NFS-e (fa_fiscal_request_nfse
-- reenfileira BLOQUEADO/REJEITADO), mas a NFC-e não tem "pedir de novo" —
-- ela é enfileirada sozinha na venda. Então a RPC recebe o documento
-- direto e o devolve pra fila zerado: PENDENTE, sem backoff, sem claim,
-- sem erro anterior. Quem corrigiu o cadastro (NCM, CSC, certificado)
-- clica e o worker pega na próxima rodada.
--
-- Só BLOQUEADO e REJEITADO voltam: AUTORIZADO/DENEGADO/CANCELADO são
-- estados finais perante a SEFAZ, e TRANSMITIDO/ASSINADO ainda estão em
-- voo — reprocessar um desses é o caminho pra nota duplicada.
--
-- REJEITADO queimou um número (ver migration 32): o worker reserva outro
-- ao reprocessar, e o número queimado continua a caminho de A_INUTILIZAR
-- pela trilha normal — esta RPC não mexe em numeração.
--
-- fa_kiosk_fiscal_doc_events.kind é texto livre (migration 32, sem CHECK),
-- então 'RETRY_SOLICITADO' entra sem alterar constraint.
-- =====================================================================
create or replace function fa_fiscal_retry_nfce(p_fiscal_doc_id uuid) returns jsonb as $$
declare
  v_doc record;
  v_now bigint := (extract(epoch from now()) * 1000)::bigint;
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

  update fa_kiosk_fiscal_docs
     set status = 'PENDENTE',
         attempts = 0,
         next_attempt_at_ms = 0,
         last_error = null,
         reject_code = null,
         reject_message = null,
         claimed_by = null,
         claimed_at_ms = null,
         updated_at_ms = v_now
   where id = p_fiscal_doc_id
   returning * into v_doc;

  insert into fa_kiosk_fiscal_doc_events (fiscal_doc_id, kind, detail_json)
  values (p_fiscal_doc_id, 'RETRY_SOLICITADO', jsonb_build_object('actor', auth.uid()));

  return jsonb_build_object('fiscalDocId', v_doc.id, 'status', v_doc.status);
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function fa_fiscal_retry_nfce(uuid) from public, anon;
grant execute on function fa_fiscal_retry_nfce(uuid) to authenticated;

-- Operador já vê o status da nota no fechamento da venda — reprocessar
-- depois de corrigir o cadastro é a extensão natural, mesmo raciocínio de
-- nfse.emit (migration 20260819000001).
insert into fa_kiosk_role_capabilities (role, capability) values
  ('OPERADOR', 'nfce.retry')
on conflict do nothing;
