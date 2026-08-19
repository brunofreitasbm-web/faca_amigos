-- =====================================================================
-- NFS-e: entrega ao Responsável por WhatsApp (botão no sistema), sem
-- e-mail/Resend.
--
-- Decisão de produto (2026-08-19): a nota só é emitida se o Responsável
-- fizer questão, e nesse caso o operador entrega pelo WhatsApp — o
-- kiosk-ui abre o wa.me com o comprovante já redigido e, ao clicar,
-- registra aqui que foi enviado. Não há mais Edge Function de e-mail
-- (nfse-email-dispatch removida) nem chave de Resend.
-- =====================================================================

alter table fa_kiosk_fiscal_docs drop column if exists guardian_email_sent_at_ms;
alter table fa_kiosk_fiscal_docs add column if not exists guardian_whatsapp_sent_at_ms bigint;

-- fa_fiscal_mark_nfse_sent: chamada pelo kiosk-ui logo depois de abrir o
-- WhatsApp. Idempotente (o primeiro clique vence) e exige a mesma
-- capability do botão de emissão.
create or replace function fa_fiscal_mark_nfse_sent(p_fiscal_doc_id uuid) returns jsonb as $$
declare
  v_doc record;
  v_now bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  if not fa_kiosk_can('nfse.emit') then
    raise exception 'sem permissão para enviar nota fiscal de serviço' using errcode = '42501';
  end if;

  select * into v_doc from fa_kiosk_fiscal_docs where id = p_fiscal_doc_id and doc_type = 'NFSE';
  if not found then
    raise exception 'NFSE_NAO_ENCONTRADA';
  end if;
  if v_doc.status <> 'AUTORIZADO' then
    raise exception 'NFSE_NAO_AUTORIZADA';
  end if;

  if v_doc.guardian_whatsapp_sent_at_ms is null then
    update fa_kiosk_fiscal_docs set guardian_whatsapp_sent_at_ms = v_now, updated_at_ms = v_now
      where id = p_fiscal_doc_id;
    insert into fa_kiosk_fiscal_doc_events (fiscal_doc_id, kind, detail_json)
      values (p_fiscal_doc_id, 'WHATSAPP_ENVIADO', jsonb_build_object('actor', auth.uid()));
  end if;

  return jsonb_build_object('fiscalDocId', p_fiscal_doc_id, 'sentAtMs', coalesce(v_doc.guardian_whatsapp_sent_at_ms, v_now));
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function fa_fiscal_mark_nfse_sent(uuid) from public, anon;
grant execute on function fa_fiscal_mark_nfse_sent(uuid) to authenticated;
