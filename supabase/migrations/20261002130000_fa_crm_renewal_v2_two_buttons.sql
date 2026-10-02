-- Aviso de fim de plano v2: só 2 botões (+30 min e +60 min do Playground), com
-- confirmação ao responsável quando o balcão aplica a renovação.
--
-- A v1 (fa_renovacao_fim_plano, 3 botões) é aposentada: com 2 opções o 3º botão
-- ficaria morto. O dispatcher usa o template ativo mais novo do purpose
-- RENOVACAO, então enquanto a Meta não aprova a v2 (crm-templates-bootstrap)
-- nada sai — caminho seguro.
update fa_crm_templates set active = false where name = 'fa_renovacao_fim_plano';

-- O Circuito tem durações próprias (10/15/20/30 min) que não cabem nos botões
-- fixos "+30 min"/"+60 min": fica de fora do aviso.
update fa_kiosk_app_settings set value = '0', updated_at_ms = (extract(epoch from now()) * 1000)::bigint
 where key = 'crm_renewal_alert' and unit_id = 'e43ba7a8-bd5f-47ad-b81d-dae7ea19d504';

-- Confirmação "Tudo certo: acrescentamos +30 min" quando o operador aplica.
insert into fa_kiosk_app_settings (unit_id, key, value, updated_at_ms)
values ('11111111-1111-1111-1111-111111111111', 'crm_notify_renewal_ok', '1', (extract(epoch from now()) * 1000)::bigint)
on conflict (unit_id, key) do update set value = '1', updated_at_ms = excluded.updated_at_ms;
