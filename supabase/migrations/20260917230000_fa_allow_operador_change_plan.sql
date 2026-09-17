-- Conceder a capacidade 'sessao.change_plan' (Trocar plano) ao papel OPERADOR.
-- Com a estrutura hierárquica de capacidades RBAC (OPERADOR <= GERENTE <= ADMIN), 
-- Operador, Líder (Gerente) e Owner (Admin) passam a ter a capacidade de trocar o plano de sessões em andamento.

delete from fa_kiosk_role_capabilities where capability = 'sessao.change_plan';

insert into fa_kiosk_role_capabilities (role, capability) values
  ('OPERADOR', 'sessao.change_plan')
on conflict do nothing;
