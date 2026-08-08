-- Banco de Talentos saiu do menu principal e passou a viver dentro do
-- Gerencial, que já é exclusivo do Owner (ADMIN, via config.write). A
-- capacidade no banco precisa acompanhar essa decisão: esconder o menu é UX,
-- quem protege de fato é a RLS — um Líder (GERENTE) continuaria enxergando
-- candidaturas e currículos por fora da UI se talentos.read/write
-- continuassem concedidos a ele aqui.
delete from fa_kiosk_role_capabilities
 where role = 'GERENTE' and capability in ('talentos.read', 'talentos.write');

insert into fa_kiosk_role_capabilities (role, capability) values
  ('ADMIN', 'talentos.read'),
  ('ADMIN', 'talentos.write')
on conflict do nothing;
