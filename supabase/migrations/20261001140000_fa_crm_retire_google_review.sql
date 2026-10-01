-- Retira o pedido de avaliação no Google (NPS_PROMOTOR) do CRM: quem dá nota
-- 9 ou 10 deixa de receber o convite para avaliar no Google. NPS_DETRATOR
-- (nota <= 6 avisa que a gerência vai entrar em contato) continua ligado.
--
-- Já aplicado em produção por SQL direto em 2026-10-01; esta migration
-- registra o estado no repositório para ambientes novos. Idempotente.
--
-- O candidato NPS_PROMOTOR continua existindo em fa_crm_lc_candidates, mas o
-- dispatcher o pula: flag desligada e template inativo. O template também
-- entra na lista RETIRED de crm-templates-bootstrap, para que rodar a
-- function de novo não o reative.
update fa_kiosk_app_settings
   set value = '0', updated_at_ms = (extract(epoch from now()) * 1000)::bigint
 where key = 'crm_lc_nps_promotor';

update fa_crm_templates set active = false where name = 'fa_lc_nps_promotor';
