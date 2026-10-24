-- Aposenta o pedido de autorização v1 (fa_pedido_autorizacao): a Meta o
-- reclassificou como MARKETING (US$ 0,0625/msg e recusas 63049 por limite de
-- marketing). A v3 (UTILITY, aprovada) já é a mais nova ativa do purpose OPTIN,
-- então os dispatchers já a usam; isto só tira o v1 do catálogo ativo para ele
-- não voltar a ser escolhido por engano. O nome também entra em RETIRED de
-- crm-templates-bootstrap, para rodar a function de novo não o reativar.
--
-- Só desativa se houver outro template OPTIN ativo, para nunca deixar o
-- purpose sem template. Idempotente.
update fa_crm_templates
   set active = false
 where name = 'fa_pedido_autorizacao'
   and exists (
     select 1 from fa_crm_templates t2
      where t2.purpose = 'OPTIN' and t2.active and t2.name <> 'fa_pedido_autorizacao'
   );
